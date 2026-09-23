// One-time transition: preserve existing IDs and bytes; never rerun detection.
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
const files=db.storage.from(process.env.SUPABASE_STORAGE_BUCKET||'picsinc-merge');
function checked(r){if(r.error) throw new Error(r.error.message);return r.data;}
const rows=checked(await db.from('original_detections').select('session_id,detection'));
let migrated=0;
for(const row of rows){
 const s=checked(await db.from('photo_sessions').select('id,owner_participant_id,original_asset_id').eq('id',row.session_id).maybeSingle());
 if(!s) continue;
 let summary=row.detection;
 if(!summary.storageKey){
  const bytes=Buffer.from(JSON.stringify(row.detection));
  const digest=createHash('sha256').update(bytes).digest('hex');
  const path=`${s.id}/legacy-detection-${digest}.json`;
  const upload=await files.upload(path,bytes,{contentType:'application/json',upsert:false});
  if(upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw new Error(upload.error.message);
  const blob=checked(await files.download(path));
  if(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')!==digest) throw new Error('Cache verification failed');
  summary={width:row.detection.width,height:row.detection.height,regions:row.detection.regions.map(({id,box})=>({id,box})),storageKey:path};
  checked(await db.from('original_detections').update({detection:summary}).eq('session_id',s.id));
  migrated++;
 }
 checked(await db.from('processing_jobs').upsert({session_id:s.id,requested_by:s.owner_participant_id,kind:'detect',dedupe_key:`detect:${s.original_asset_id}`,input:{assetId:s.original_asset_id,width:summary.width,height:summary.height},status:'ready',result:summary},{onConflict:'dedupe_key',ignoreDuplicates:true}));
}
console.log(JSON.stringify({existing:rows.length,migrated,bytesVerified:true}));
