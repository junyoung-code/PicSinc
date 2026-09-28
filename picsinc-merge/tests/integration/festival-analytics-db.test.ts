import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const project = new URL("../../", import.meta.url);
const sqlFile = (path: string) => readFile(new URL(path, project), "utf8");

async function currentSchemaDatabase(beforeAnalytics?: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean not null);
    create table storage.objects (id uuid primary key default gen_random_uuid());
  `);

  // These files describe the initial project state that predates the numbered
  // migrations. Cleanup SQL is intentionally excluded because it provisions
  // Supabase Vault, pg_cron, pg_net, and a deployed Edge Function URL.
  for (const path of [
    "src/integrations/storage/schema.sql",
    "src/integrations/storage/integration.sql",
    "src/integrations/storage/multiple-selections.sql",
    "src/integrations/storage/mobile-flow.sql",
  ]) {
    let sql = await sqlFile(path);
    // PGlite has PostgreSQL's built-in gen_random_uuid(), but does not package
    // Supabase's pgcrypto extension. Only the unavailable declaration is omitted.
    if (path.endsWith("schema.sql")) sql = sql.replace("create extension if not exists pgcrypto;", "");
    await db.exec(sql);
  }

  const migrationDirectory = new URL("supabase/migrations/", project);
  for (const name of (await readdir(migrationDirectory)).filter(name => name.endsWith(".sql")).sort()) {
    if (name.endsWith("_festival_analytics.sql") && beforeAnalytics) await beforeAnalytics(db);
    await db.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
  }
  return db;
}

async function value<T>(db: PGlite, statement: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, T>>(statement, params);
  return Object.values(result.rows[0])[0];
}

const ids = {
  room: "10000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000002",
  original: "10000000-0000-4000-8000-000000000003",
  originalUpload: "10000000-0000-4000-8000-000000000004",
  originalLease: "10000000-0000-4000-8000-000000000005",
  guest: "10000000-0000-4000-8000-000000000006",
  edit: "10000000-0000-4000-8000-000000000007",
  editUpload: "10000000-0000-4000-8000-000000000008",
  editLease: "10000000-0000-4000-8000-000000000009",
  mask: "10000000-0000-4000-8000-000000000010",
  festivalRoom: "20000000-0000-4000-8000-000000000001",
  festivalOwner: "20000000-0000-4000-8000-000000000002",
  festivalOriginal: "20000000-0000-4000-8000-000000000003",
  legacyRoom: "30000000-0000-4000-8000-000000000001",
  legacyOwner: "30000000-0000-4000-8000-000000000002",
  legacyOriginal: "30000000-0000-4000-8000-000000000003",
  legacyGuest: "30000000-0000-4000-8000-000000000004",
};

test("a blank local test database can reproduce the current application schema", async () => {
  const db = await currentSchemaDatabase();
  try {
    const tables = await db.query<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema='public' and table_name in (
        'photo_sessions','participants','photo_assets','processing_jobs',
        'festival_analytics_settings','festival_analytics_room_contexts','festival_analytics_events'
      ) order by table_name
    `);
    assert.deepEqual(tables.rows.map(row => row.table_name), [
      "festival_analytics_events", "festival_analytics_room_contexts",
      "festival_analytics_settings", "participants", "photo_assets",
      "photo_sessions", "processing_jobs",
    ]);
  } finally { await db.close(); }
});

test("durable festival events cover retries, repeat milestones, room context, and room deletion", async () => {
  const db = await currentSchemaDatabase(async database => {
    await database.query(`select create_photo_session($1,'legacy-invite',$2,now(),now()+interval '24 hours',$3,'Legacy Owner','legacy-session','legacy-recovery','legacy/original.png',100,100,'image/png')`, [ids.legacyRoom, ids.legacyOriginal, ids.legacyOwner]);
  });
  try {
    assert.equal(await value<string>(db, "select event_context from festival_analytics_room_contexts where session_id=$1", [ids.legacyRoom]), "test");
    await db.exec("update festival_analytics_settings set event_context='festival' where singleton=true");
    await db.query("select join_photo_session($1,$2,'Legacy Guest','legacy-guest-session','legacy-guest-recovery')", [ids.legacyRoom, ids.legacyGuest]);
    assert.deepEqual((await db.query<{ event_context: string }>("select distinct event_context from festival_analytics_events where session_id=$1", [ids.legacyRoom])).rows, [{ event_context: "test" }], "rooms created before the migration remain usable and classified as test");
    await db.exec("update festival_analytics_settings set event_context='test' where singleton=true");

    await db.query(`
      insert into photo_upload_intents (
        id,kind,session_id,participant_id,asset_id,invite_token,nickname,owner_hash,
        session_token_hash,recovery_token_hash,content_type,byte_size,temporary_key,
        final_key,expires_at,status,lease_token,lease_expires_at
      ) values ($1,'original',$2,$3,$4,'private-invite','Owner','bootstrap-hash',
        'owner-session-hash','owner-recovery-hash','image/png',100,'uploads/original/source.png',
        'room/original.png',now()+interval '2 hours','verifying',$5,now()+interval '2 minutes')
    `, [ids.originalUpload, ids.room, ids.owner, ids.original, ids.originalLease]);

    await db.query("select finalize_original_upload($1,$2,$3,100,100,'image/png')", [ids.originalUpload, "bootstrap-hash", ids.originalLease]);
    await db.query("select finalize_original_upload($1,$2,$3,100,100,'image/png')", [ids.originalUpload, "bootstrap-hash", ids.originalLease]);
    assert.equal(await value<number>(db, "select count(*)::int from festival_analytics_events where session_id=$1", [ids.room]), 2);
    assert.equal(await value<number>(db, "select count(*)::int from festival_analytics_events where session_id=$1 and event_name='participant_joined'", [ids.room]), 1, "the owner is counted once");

    // Switching the global default while the test room is active must not split it.
    await db.exec("update festival_analytics_settings set event_context='festival' where singleton=true");
    await db.query("select join_photo_session($1,$2,'Guest','guest-session-hash','guest-recovery-hash')", [ids.room, ids.guest]);

    await db.query(`
      insert into photo_upload_intents (
        id,kind,session_id,participant_id,asset_id,invite_token,nickname,owner_hash,
        content_type,byte_size,temporary_key,final_key,expires_at,status,lease_token,lease_expires_at
      ) values ($1,'edited',$2,$3,$4,'private-invite',null,'guest-session-hash',
        'image/png',100,'uploads/edit/source.png','room/edit.png',now()+interval '2 hours',
        'verifying',$5,now()+interval '2 minutes')
    `, [ids.editUpload, ids.room, ids.guest, ids.edit, ids.editLease]);
    await db.query("select finalize_session_upload($1,$2,$3,100,100,'image/png')", [ids.editUpload, "guest-session-hash", ids.editLease]);
    await db.query("select finalize_session_upload($1,$2,$3,100,100,'image/png')", [ids.editUpload, "guest-session-hash", ids.editLease]);
    assert.equal(await value<number>(db, "select count(*)::int from festival_analytics_events where asset_id=$1", [ids.edit]), 1, "upload completion retry is deduplicated");

    await db.query("select register_photo_asset($1::jsonb)", [JSON.stringify({
      id: ids.mask, sessionId: ids.room, participantId: ids.guest, kind: "mask",
      storageKey: "room/mask.png", width: 100, height: 100, contentType: "image/png",
    })]);
    let version = await value<number>(db, "select version from photo_sessions where id=$1", [ids.room]);
    version = await value<number>(db, "select replace_original_selection($1,$2,$3,array[]::text[],$4)", [ids.room, ids.guest, ids.mask, version]);
    version = await value<number>(db, "select replace_selection($1,$2,$3,$4,$5,true)", [ids.room, ids.guest, ids.edit, ids.mask, version]);
    const staleRetry = await value<number | null>(db, "select replace_selection($1,$2,$3,$4,$5,true)", [ids.room, ids.guest, ids.edit, ids.mask, version - 1]);
    assert.equal(staleRetry, null);
    assert.equal(await value<number>(db, "select count(*)::int from festival_analytics_events where session_id=$1 and event_name='area_submitted'", [ids.room]), 1);

    // The automatic original-detection job is unrelated to this composition test.
    await db.query("delete from processing_jobs where kind='detect'");
    async function compose(expectedVersion: number) {
      await db.query("select enqueue_processing_job($1,$2,'compose',null,$3,false)", [ids.room, ids.owner, expectedVersion]);
      const job = await value<{ id: string; lease_token: string }>(db, "select claim_processing_job()");
      const result = JSON.stringify({ width: 100, height: 100, previewWidth: 50, previewHeight: 50, unassignedOverlapPixels: 0 });
      assert.equal(await value<boolean>(db, "select complete_processing_job($1,$2,$3::jsonb)", [job.id, job.lease_token, result]), true);
      assert.equal(await value<boolean>(db, "select complete_processing_job($1,$2,$3::jsonb)", [job.id, job.lease_token, result]), true, "completion response retry is idempotent");
    }
    await compose(version);

    version = await value<number>(db, "select replace_selection($1,$2,$3,$4,$5,true)", [ids.room, ids.guest, ids.edit, ids.mask, version]);
    await compose(version);
    assert.equal(await value<number>(db, "select count(*)::int from festival_analytics_events where session_id=$1 and event_name='area_submitted'", [ids.room]), 2, "repeat submissions remain raw events");
    assert.equal(await value<number>(db, "select count(*)::int from festival_analytics_events where session_id=$1 and event_name='composition_succeeded'", [ids.room]), 2, "new-version compositions remain raw events");
    assert.equal(await value<number>(db, "select count(*)::int from festival_analytics_first_completions where session_id=$1", [ids.room]), 2, "dashboard view keeps one submission and one composition milestone");
    assert.deepEqual((await db.query<{ event_context: string }>("select distinct event_context from festival_analytics_events where session_id=$1", [ids.room])).rows, [{ event_context: "test" }]);

    await db.query(`select create_photo_session($1,'festival-invite',$2,now(),now()+interval '24 hours',$3,'Festival Owner','festival-session','festival-recovery','festival/original.png',100,100,'image/png')`, [ids.festivalRoom, ids.festivalOriginal, ids.festivalOwner]);
    assert.deepEqual((await db.query<{ event_context: string }>("select distinct event_context from festival_analytics_events where session_id=$1", [ids.festivalRoom])).rows, [{ event_context: "festival" }]);

    const beforeDelete = await value<number>(db, "select count(*)::int from festival_analytics_events where session_id=$1", [ids.room]);
    await db.query("update photo_sessions set expires_at=now()-interval '1 minute' where id=$1", [ids.room]);
    await db.query("delete from photo_sessions where id=$1 and expires_at<=now()", [ids.room]);
    assert.equal(await value<number>(db, "select count(*)::int from photo_sessions where id=$1", [ids.room]), 0);
    assert.equal(await value<number>(db, "select count(*)::int from participants where session_id=$1", [ids.room]), 0);
    assert.equal(await value<number>(db, "select count(*)::int from photo_assets where session_id=$1", [ids.room]), 0);
    assert.equal(await value<number>(db, "select count(*)::int from festival_analytics_events where session_id=$1", [ids.room]), beforeDelete, "analytics survive room cascade deletion");
  } finally { await db.close(); }
});
