import assert from "node:assert/strict";
import test from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { currentSchemaDatabase } from "./retouch-room-test-db";
import { readCollaborationRequest, MAX_COLLABORATION_BODY_BYTES } from "./collaboration-request";


async function value<T>(db: PGlite, statement: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, T>>(statement, params);
  return Object.values(result.rows[0])[0];
}


const id = (n:number) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const room=id(1), owner=id(2), original=id(3), guest=id(4);
async function create(db:PGlite) {
 await value(db,`select create_photo_session($1,'invite',$2,now(),now()+interval '1 day',$3,'Owner','hash','recovery','original.png',2,2,'image/png')`,[room,original,owner]);
}
async function action(db:PGlite,participant:string,action:string,payload:unknown={}) {
 return value<any>(db,`select collaboration_action($1,$2,$3,$4)`,[room,participant,action,JSON.stringify(payload)]);
}
async function asset(db:PGlite,n:number,participant:string,kind='edited') {
 return value<any>(db,`select register_photo_asset($1)`,[JSON.stringify({id:id(n),sessionId:room,participantId:participant,kind,storageKey:`${n}.png`,width:2,height:2,contentType:'image/png'})]);
}
async function selection(db:PGlite,participant:string,n:number,region:string) {
 await asset(db,n,participant,'mask');
 await value(db,`select set_region_claim($1,$2,$3,true)`,[room,participant,region]);
 const version=await value(db,`select version from photo_sessions where id=$1`,[room]);
 await value(db,`select replace_original_selection($1,$2,$3,$4,$5)`,[room,participant,id(n),[region],version]);
 return action(db,participant,'personal-begin',{sourceMaskAssetId:id(n),selectedRegionIds:[region],mask:{id:id(n+1),storageKey:`approved-${n}.png`}});
}
async function save(db:PGlite,participant:string,token:string,n:number) {
 await asset(db,n,participant);
 return action(db,participant,'personal-save',{token,editedAssetId:id(n),state:{schemaVersion:1,edit:{}},assets:[{id:id(n+1),kind:'edited',storageKey:`isolated-${n}.png`},{id:id(n+2),kind:'mask',storageKey:`isolated-mask-${n}.png`}]});
}

test('collaborative rooms freeze roster, isolate completion from other saves, lock global edits and final state',async()=>{
 const db=await currentSchemaDatabase();
 try {
  await create(db);
  await action(db,owner,'enable');
  assert.equal((await action(db,owner,'read')).phase,'lobby');
  assert.equal(await value(db,'select count(*)::int from processing_jobs'),0);
  await assert.rejects(()=>value(db,`select enqueue_processing_job($1,$2,'detect',$3)`,[room,owner,original]),/Collaboration locked/);
  await value(db,`select join_photo_session($1,$2,'Guest','guest-hash','guest-recovery')`,[room,guest]);
  await assert.rejects(()=>action(db,guest,'start'),/Forbidden/);
  const started=await action(db,owner,'start');
  assert.deepEqual(started.rosterIds,[owner,guest]);
  assert.equal(await value(db,'select count(*)::int from processing_jobs'),1);
  await assert.rejects(()=>value(db,`select join_photo_session($1,$2,'Late','late-hash','late-recovery')`,[room,id(5)]),/Collaboration locked/);
  await value(db,`select cache_original_detection($1,$2)`,[room,JSON.stringify({width:2,height:2,regions:[{id:'a'},{id:'b'}]})]);
  const own=await selection(db,owner,10,'a');
  const other=await selection(db,guest,20,'b');
  assert.ok(own.personalMaskAssetId);
  assert.equal((await action(db,guest,'read')).personalToken,other.personalToken);
  assert.notEqual(own.personalToken,other.personalToken);
  await assert.rejects(()=>value(db,`select set_region_claim($1,$2,'a',false)`,[room,owner]),/Collaboration locked/);
  await assert.rejects(()=>action(db,owner,'compose'),/All participants required/);
  await save(db,owner,own.personalToken,30);
  const replay=await action(db,owner,'personal-save',{token:own.personalToken,editedAssetId:id(30)});
  assert.deepEqual(replay.completedIds,[owner]);
  const receipt=await action(db,owner,'receipt',{action:'personal-save',token:own.personalToken,editedAssetId:id(30)});
  assert.deepEqual(receipt.completedIds,[owner]);
  await assert.rejects(()=>action(db,owner,'personal-save',{token:own.personalToken,editedAssetId:id(31)}),/Edit token expired/);
  await assert.rejects(()=>asset(db,33,owner),/Collaboration locked/);
  await assert.rejects(()=>value(db,`select replace_selection($1,$2,$3,$4,1,true)`,[room,guest,id(20),id(20)]),/Collaboration locked/);
  const saved=await save(db,guest,other.personalToken,40);
  assert.deepEqual(saved.completedIds,[owner,guest]);
  await assert.rejects(()=>action(db,owner,'personal-begin'),/Collaboration locked/);
  const composed=await action(db,owner,'compose'); assert.equal(composed.phase,'composing'); assert.ok(composed.job.id);
  await assert.rejects(()=>asset(db,50,owner),/Collaboration locked/);
  await assert.rejects(()=>action(db,owner,'open-global',{resultAssetId:id(51)}),/Composition required/);
  const version=await value(db,'select version from photo_sessions where id=$1',[room]);
  await value(db,`select publish_composition($1,$2,$3)`,[JSON.stringify({sessionId:room,version,previewAssetId:id(51),resultAssetId:id(52),width:2,height:2,unassignedOverlapPixels:0}),JSON.stringify([{id:id(51),sessionId:room,kind:'preview',storageKey:'preview.png',width:2,height:2},{id:id(52),sessionId:room,kind:'result',storageKey:'result.png',width:2,height:2}]),owner]);
  await action(db,owner,'open-global',{resultAssetId:id(52)});
  const lock=await action(db,guest,'acquire');
  assert.ok(lock.editToken);
  assert.equal((await action(db,owner,'read')).editToken,null);
  await assert.rejects(()=>action(db,owner,'acquire'),/Editor busy/);
  await assert.rejects(()=>action(db,owner,'end-global'),/Editor busy/);
  await asset(db,60,guest);
  assert.equal(await value(db,'select submitted from participants where id=$1',[guest]),true);
  await assert.rejects(()=>action(db,guest,'save',{token:lock.editToken,baseVersion:99,editedAssetId:id(60),state:{},asset:{id:id(61),storageKey:'global-61.png'}}),/Version changed/);
  assert.equal((await action(db,guest,'read')).editToken,lock.editToken);
  const global=await action(db,guest,'save',{token:lock.editToken,baseVersion:0,editedAssetId:id(60),state:{stroke:1},asset:{id:id(61),storageKey:'global-61.png'}});
  const globalReplay=await action(db,guest,'save',{token:lock.editToken,baseVersion:0,editedAssetId:id(60)});
  assert.equal(globalReplay.version,1);
  assert.equal(await value(db,'select count(*)::int from global_edit_history'),1);
  assert.equal(global.version,1); assert.equal(global.editorId,null); assert.equal(global.latestAssetId,id(61));
  assert.equal(global.history[0].state,undefined);
  assert.deepEqual(await value(db,'select state from global_edit_history'),{stroke:1});
  const next=await action(db,owner,'acquire');
  assert.equal(next.latestAssetId,id(61));
  await db.exec(`update session_collaboration set lease_until=now()-interval '1 second'`);
  const replacement=await action(db,guest,'acquire'); assert.notEqual(replacement.editToken,next.editToken);
  await assert.rejects(()=>action(db,owner,'heartbeat',{token:next.editToken}),/Edit token expired/);
  await action(db,guest,'cancel',{token:replacement.editToken});
  await assert.rejects(()=>action(db,guest,'end-global'),/Forbidden/);
  await action(db,owner,'end-global');
  await assert.rejects(()=>action(db,guest,'finalize'),/Forbidden/);
  await assert.rejects(()=>action(db,guest,'acquire'),/Collaboration locked/);
  const final=await action(db,owner,'finalize'); assert.equal(final.phase,'final'); assert.equal(final.latestAssetId,id(61));
  assert.equal((await action(db,guest,'read')).latestAssetId,final.latestAssetId);
  await assert.rejects(()=>action(db,owner,'acquire'),/Collaboration locked/);
  await assert.rejects(()=>asset(db,70,owner),/Collaboration locked/);
  await assert.rejects(()=>value(db,`select enqueue_processing_job($1,$2,'compose',null,$3)`,[room,owner,version]),/Collaboration locked/);
  await db.query(`update processing_jobs set status='running',lease_token=$1,lease_until=now()+interval '1 minute' where id=$2`,[id(90),composed.job.id]);
  assert.equal(await value(db,`select complete_processing_job($1,$2,$3)`,[composed.job.id,id(90),JSON.stringify({width:2,height:2})]),false);
  assert.equal(await value(db,`select has_function_privilege('anon','collaboration_action(uuid,uuid,text,jsonb)','execute')`),false);
 } finally {await db.close();}
});

test('new merge rooms automatically enqueue detection without collaboration and accept external edits',async()=>{
 const db=await currentSchemaDatabase();
 try {
  await create(db);
  assert.equal((await action(db,owner,'read')).enabled,false);
  assert.equal(await value(db,'select count(*)::int from processing_jobs'),1);
  await value(db,`select join_photo_session($1,$2,'Guest','hash','recovery-2')`,[room,guest]);
  await asset(db,80,guest);
  const j=await value<any>(db,`select enqueue_processing_job($1,$2,'detect',$3)`,[room,owner,original]);
  assert.equal(j.status,'queued');
  assert.equal(await value(db,'select count(*)::int from processing_jobs'),1);
 } finally {await db.close();}
});

test('failed personal save rolls back completion, cancellation unlocks selection, and stale global saves cannot publish',async()=>{
 const db=await currentSchemaDatabase();
 try {
  await create(db); await action(db,owner,'enable'); await action(db,owner,'start');
  await value(db,`select cache_original_detection($1,$2)`,[room,JSON.stringify({width:2,height:2,regions:[{id:'a'}]})]);
  const begun=await selection(db,owner,100,'a');
  const again=await action(db,owner,'personal-begin');
  assert.equal(again.personalToken,begun.personalToken);
  assert.equal(again.personalMaskAssetId,begun.personalMaskAssetId);
  await asset(db,110,owner);
  await assert.rejects(()=>action(db,owner,'personal-save',{token:begun.personalToken,editedAssetId:id(110),state:{},assets:[{id:id(111),kind:'edited',storageKey:'only-edit.png'}]}),/Invalid save/);
  assert.equal((await action(db,owner,'read')).personalToken,begun.personalToken);
  assert.equal(await value(db,'select count(*)::int from photo_assets where id=$1',[id(111)]),0);
  assert.equal(await value(db,'select submitted from participants where id=$1',[owner]),false);
  await action(db,owner,'personal-cancel',{token:begun.personalToken});
  await value(db,`select set_region_claim($1,$2,'a',false)`,[room,owner]);
  await assert.rejects(()=>action(db,owner,'personal-begin'),/Selection required/);
  await db.query(`update session_collaboration set phase='global',editor_id=$1,edit_token=$2,lease_until=now()-interval '1 second' where session_id=$3`,[owner,id(120),room]);
  await assert.rejects(()=>action(db,owner,'save',{token:id(120),baseVersion:0,editedAssetId:id(110),state:{},asset:{id:id(121),storageKey:'stale.png'}}),/Edit token expired/);
  assert.equal(await value(db,'select count(*)::int from global_edit_history'),0);
 } finally {await db.close();}
});


test('collaboration request reader enforces declared and chunked body limits',async()=>{
 assert.deepEqual(await readCollaborationRequest(new Request('http://local',{method:'POST',body:'{"action":"start"}'})),{action:'start'});
 await assert.rejects(()=>readCollaborationRequest(new Request('http://local',{method:'POST',headers:{'content-length':String(MAX_COLLABORATION_BODY_BYTES+1)},body:'{}'})),(e:any)=>e.status===413);
 let canceled=false;
 const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(MAX_COLLABORATION_BODY_BYTES));controller.enqueue(new Uint8Array(1));},cancel(){canceled=true;}});
 await assert.rejects(()=>readCollaborationRequest(new Request('http://local',{method:'POST',body,duplex:'half'} as RequestInit)),(e:any)=>e.status===413);
 assert.equal(canceled,true);
 await assert.rejects(()=>readCollaborationRequest(new Request('http://local',{method:'POST',body:'{'})),SyntaxError);
});

test('direct upload finalization starts merge rooms and explicit collaboration still checks asset registration',async()=>{
 const db=await currentSchemaDatabase();
 try {
  const intent=async(n:number,kind:string,assetId:string)=>db.query(`insert into photo_upload_intents(id,kind,session_id,participant_id,asset_id,invite_token,nickname,owner_hash,session_token_hash,recovery_token_hash,content_type,byte_size,temporary_key,final_key,expires_at,status,lease_token,lease_expires_at) values($1,$2,$3,$4,$5,'invite','Owner','hash','hash','recovery','image/png',100,$6,$7,now()+interval '1 hour','verifying',$8,now()+interval '1 minute')`,[id(n),kind,room,owner,assetId,`temp-${n}.png`,`file-${n}.png`,id(n+1)]);
  await intent(200,'original',original);
  await value(db,`select finalize_original_upload($1,'hash',$2,2,2,'image/png')`,[id(200),id(201)]);
  assert.equal((await action(db,owner,'read')).enabled,false);
  assert.equal(await value(db,'select count(*)::int from processing_jobs'),1);
  await action(db,owner,'enable');
  assert.equal((await action(db,owner,'read')).phase,'lobby');
  assert.equal(await value(db,'select count(*)::int from processing_jobs'),0);
  await action(db,owner,'start');
  await value(db,`select cache_original_detection($1,$2)`,[room,JSON.stringify({width:2,height:2,regions:[{id:'a'}]})]);
  const begun=await selection(db,owner,210,'a');
  await intent(220,'edited',id(222));
  await value(db,`select finalize_session_upload($1,'hash',$2,2,2,'image/png')`,[id(220),id(221)]);
  assert.equal((await action(db,owner,'read')).personalToken,begun.personalToken);
  await save(db,owner,begun.personalToken,230);
  await intent(240,'edited',id(242));
  await assert.rejects(()=>value(db,`select finalize_session_upload($1,'hash',$2,2,2,'image/png')`,[id(240),id(241)]),/Collaboration locked/);
  assert.equal(await value(db,'select count(*)::int from photo_assets where id=$1',[id(242)]),0);
  assert.equal(await value(db,'select submitted from participants where id=$1',[owner]),true);
 } finally {await db.close();}
});
