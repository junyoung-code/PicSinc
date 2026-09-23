import {createClient} from '@supabase/supabase-js';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {createWorkerClient,processAssignment} from '../src/features/composition/worker-runtime';
import type {WorkerAssignment} from '../src/core/processing';
const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false}});
const bucket=db.storage.from('picsinc-merge');
const base=process.env.PICSINC_TEST_BASE_URL||'http://127.0.0.1:3141';
const post=createWorkerClient({baseUrl:base,token:process.env.WORKER_TOKEN!});
const pending=await db.from('processing_jobs').select('id').in('status',['queued','running']);
assert.equal(pending.error,null);assert.equal(pending.data!.length,0,'Other jobs pending; stop smoke test');
const bytes=await sharp({create:{width:128,height:128,channels:3,background:'#446688'}}).png().toBuffer();
let uploadId:string|undefined,roomId:string|undefined;
try {
 const r=await fetch(base+'/api/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:'YOLO smoke',contentType:'image/png',size:bytes.length})});assert.equal(r.status,201);
 const cookie=r.headers.get('set-cookie')!.split(';')[0];const u=await r.json();uploadId=u.uploadId;
 const uploaded=await fetch(u.signedUrl,{method:'PUT',headers:{'Content-Type':'image/png'},body:bytes});assert(uploaded.ok);
 const c=await fetch(base+`/api/uploads/${uploadId}/complete`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});assert.equal(c.status,201);const created=await c.json();roomId=created.session.id;
 const owned=await db.from('processing_jobs').select('id').eq('session_id',roomId).single();assert.equal(owned.error,null);
 const {job}=await post<{job:WorkerAssignment}>('claim',{});assert.equal(job.id,owned.data!.id);
 await processAssignment(job,post,new AbortController().signal);
 const finished=await db.from('processing_jobs').select('status,error_code,result').eq('id',job.id).single();assert.equal(finished.data?.status,'ready',finished.data?.error_code);
 console.log(JSON.stringify({actualYolo:true,status:finished.data!.status,width:finished.data!.result.width,height:finished.data!.result.height,regions:finished.data!.result.regions.length}));
}finally{
 if(uploadId){const u=await db.from('photo_upload_intents').select('temporary_key,final_key,session_id').eq('id',uploadId).single();if(u.data){roomId=u.data.session_id;await bucket.remove([u.data.temporary_key,u.data.final_key]);}await db.from('photo_upload_intents').delete().eq('id',uploadId);}
 if(roomId){const paths=await db.from('processing_output_grants').select('path').eq('session_id',roomId);if(paths.data?.length)await bucket.remove(paths.data.map(p=>p.path));await db.from('processing_output_grants').delete().eq('session_id',roomId);await db.from('photo_sessions').delete().eq('id',roomId);}
}
