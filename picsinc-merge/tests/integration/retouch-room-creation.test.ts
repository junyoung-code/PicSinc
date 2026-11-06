import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { currentSchemaDatabase } from '../../src/features/photo-session/retouch-room-test-db';

async function value<T = any>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, params);
  return Object.values(result.rows[0])[0];
}
async function intent(db: PGlite, retouch: boolean) {
  const upload = randomUUID(), room = randomUUID(), owner = randomUUID(), asset = randomUUID(), lease = randomUUID();
  await db.query(`insert into photo_upload_intents(id,kind,session_id,participant_id,asset_id,invite_token,nickname,owner_hash,session_token_hash,recovery_token_hash,content_type,byte_size,temporary_key,final_key,expires_at,status,lease_token,lease_expires_at,retouch_room)
    values($1,'original',$2,$3,$4,$5,'Owner','hash','session-hash',$6,'image/png',100,$7,$8,now()+interval '1 hour','verifying',$9,now()+interval '1 minute',$10)`,
    [upload, room, owner, asset, randomUUID(), randomUUID(), `uploads/${upload}.png`, `${room}/${asset}.png`, lease, retouch]);
  const finish = (width = 2, height = 2, hash = 'hash', lock = lease) => value(db, `select finalize_original_upload($1,$2,$3,$4,$5,'image/png')`, [upload, hash, lock, width, height]);
  const action = (participant: string, action: string) => value(db, 'select collaboration_action($1,$2,$3)', [room, participant, action]);
  return { upload, room, owner, asset, lease, finish, action };
}

test('dedicated retouch original is atomically a lobby through the shared finalizer; replay does not queue work', async () => {
  const db = await currentSchemaDatabase();
  try {
    const r = await intent(db, true);
    await assert.rejects(() => r.finish(2, 2, 'other-owner'), /Upload unauthorized/);
    await assert.rejects(() => r.finish(2, 2, 'hash', randomUUID()), /Upload lease lost/);
    assert.equal(await value(db, 'select count(*)::int from photo_sessions'), 0);
    await r.finish();
    await r.finish(); // Same entry point as /api/uploads completion, including lost-response replay.
    assert.equal(await value(db, 'select count(*)::int from photo_sessions'), 1);
    assert.equal(await value(db, 'select count(*)::int from processing_jobs'), 0);
    assert.equal((await r.action(r.owner, 'read')).phase, 'lobby');
    assert.equal(await value(db, `select extract(epoch from (expires_at-created_at))::int from photo_sessions where id=$1`, [r.room]), 86400);
    await assert.rejects(() => value(db, `select enqueue_processing_job($1,$2,'detect',$3)`, [r.room, r.owner, r.asset]), /Collaboration locked/);
    const guest = randomUUID();
    await value(db, `select join_retouch_room($1,$2,'Guest','guest-hash','guest-recovery')`, [r.room, guest]);
    await assert.rejects(() => r.action(guest, 'start'), /Forbidden/);
    const started = await r.action(r.owner, 'start');
    assert.deepEqual(new Set(started.rosterIds), new Set([r.owner, guest]));
    assert.equal(await value(db, 'select count(*)::int from processing_jobs'), 1);
    await assert.rejects(() => value(db, `select join_retouch_room($1,$2,'Late','late-hash','late-recovery')`, [r.room, randomUUID()]), /Collaboration locked/);
    await assert.rejects(() => r.action(r.owner, 'start'), /Collaboration locked/);
    await r.finish();
    assert.equal((await r.action(r.owner, 'read')).phase, 'personal');
    assert.equal(await value(db, 'select count(*)::int from processing_jobs'), 1);
    await db.query(`update photo_sessions set expires_at=now()-interval '1 second' where id=$1`, [r.room]);
    await assert.rejects(() => r.action(r.owner, 'read'), /Session expired/);
    await assert.rejects(() => value(db, `select join_retouch_room($1,$2,'Late','late-hash','late-recovery')`, [r.room, randomUUID()]), /Session expired/);
  } finally { await db.close(); }
});

test('retouch dimension limits cannot be bypassed through ordinary completion, while merge dimensions and automatic detection remain unchanged', async () => {
  const db = await currentSchemaDatabase();
  try {
    const retouch = await intent(db, true);
    await assert.rejects(() => retouch.finish(4001, 4000), /Retouch image too large/);
    await assert.rejects(() => retouch.finish(8193, 1), /Retouch image too large/);
    assert.equal(await value(db, 'select count(*)::int from photo_sessions'), 0);
    assert.equal(await value(db, 'select count(*)::int from session_collaboration'), 0);
    assert.equal(await value(db, 'select status from photo_upload_intents where id=$1', [retouch.upload]), 'verifying');
    const merge = await intent(db, false);
    await merge.finish(4001, 4000);
    assert.equal((await merge.action(merge.owner, 'read')).enabled, false);
    await assert.rejects(() => value(db, `select join_retouch_room($1,$2,'Wrong entry','guest-hash','guest-recovery')`, [merge.room, randomUUID()]), /Retouch room required/);
    assert.equal(await value(db, 'select count(*)::int from participants where session_id=$1', [merge.room]), 1);
    assert.equal(await value(db, 'select count(*)::int from participant_credentials where session_id=$1', [merge.room]), 1);
    assert.equal(await value(db, 'select count(*)::int from processing_jobs'), 1);
    await retouch.finish();
    assert.equal(await value(db, 'select count(*)::int from processing_jobs'), 1);
    assert.equal((await retouch.action(retouch.owner, 'read')).phase, 'lobby');
    await assert.rejects(() => db.query(`update photo_upload_intents set kind='edited' where id=$1`, [retouch.upload]), /retouch_original_only/);
    assert.equal(await value(db, `select has_table_privilege('anon','photo_upload_intents','insert')`), false);
    assert.equal(await value(db, `select has_function_privilege('authenticated','finalize_original_upload(uuid,text,uuid,integer,integer,text)','execute')`), false);
    assert.equal(await value(db, `select has_function_privilege('anon','enqueue_original_detection()','execute')`), false);
    assert.equal(await value(db, `select has_function_privilege('authenticated','join_retouch_room(uuid,uuid,text,text,text)','execute')`), false);
  } finally { await db.close(); }
});

test('expired retouch upload never creates a room', async () => {
  const db = await currentSchemaDatabase();
  try {
    const r = await intent(db, true);
    await db.query(`update photo_upload_intents set expires_at=now()-interval '1 second' where id=$1`, [r.upload]);
    await assert.rejects(() => r.finish(), /Upload expired/);
    assert.equal(await value(db, 'select count(*)::int from photo_sessions'), 0);
  } finally { await db.close(); }
});
