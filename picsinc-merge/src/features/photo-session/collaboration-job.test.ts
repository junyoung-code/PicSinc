import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { readCompositionJob } from './collaboration-job';

test('composition status reads only the authorized room and current version without worker data', async () => {
  let called = false;
  const db = createClient('https://example.invalid', 'test-key', {global:{fetch:async input => {
    called = true;
    const url = new URL(String(input));
    assert.equal(url.pathname, '/rest/v1/processing_jobs');
    assert.equal(url.searchParams.get('session_id'), 'eq.authorized-room');
    assert.equal(url.searchParams.get('kind'), 'eq.compose');
    assert.equal(url.searchParams.get('dedupe_key'), 'eq.compose:authorized-room:7');
    assert.equal(url.searchParams.get('select'), 'id,status,error_code,error_message');
    return Response.json({id:'job-7',status:'failed',error_code:'worker_lost',error_message:'처리가 중단됐어요.',input:{privatePath:'hidden'},lease_token:'secret'});
  }}});
  assert.deepEqual(await readCompositionJob(db, {id:'authorized-room',version:7}), {id:'job-7',status:'failed',code:'worker_lost',error:'처리가 중단됐어요.'});
  assert.equal(called, true);
});

test('missing composition job stays absent; database errors do not masquerade as processing', async () => {
  const missing = createClient('https://example.invalid', 'test-key', {global:{fetch:async () => Response.json(null)}});
  assert.equal(await readCompositionJob(missing, {id:'room',version:1}), undefined);
  const failed = createClient('https://example.invalid', 'test-key', {global:{fetch:async () => Response.json({message:'private database error'}, {status:400})}});
  await assert.rejects(() => readCompositionJob(failed, {id:'room',version:1}), (error: any) => error.status === 503 && !error.message.includes('private'));
});
