import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { CompositionInput } from "@/core/contracts";
import type { JobView, WorkerAssignment, WorkerCompletion } from "@/core/processing";
import { supabaseServer } from "@/integrations/storage/supabase-server";
import { SupabasePhotoSessionStore } from "@/integrations/storage/supabase-photo-session-store";
import { SessionError } from "./errors";

type Auth = { inviteToken: string; participantId: string; sessionToken: string };
type Row = { id: string; session_id: string; requested_by: string; kind: "detect" | "compose"; input: any; status: JobView["status"]; result: any; lease_token: string; lease_until: string; error_code?: string; error_message?: string };
const db = () => supabaseServer();
const storage = () => db().storage.from(process.env.SUPABASE_STORAGE_BUCKET || "picsinc-merge");
const hash = (s: string) => createHash("sha256").update(s).digest();

function check(error: { message: string } | null) {
  if (!error) return;
  const known: Record<string, [number,string]> = { "Session expired": [410,"이 작업의 보관 기간이 끝났습니다."], "Forbidden": [403,"요청할 권한이 없습니다."], "Version changed": [409,"사진이나 선택이 바뀌었어요. 다시 불러와 주세요."], "No submissions": [400,"한 명 이상 제출해야 병합할 수 있습니다."] };
  const mapped = known[error.message];
  if (mapped) throw new SessionError(...mapped);
  console.error("processing database error", error.message.slice(0,120));
  throw new SessionError(503,"작업 상태를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
}

export async function authorizeProcessing(auth: Auth) {
  const store = new SupabasePhotoSessionStore();
  const session = await store.findSessionByInvite(auth.inviteToken);
  if (!session || Date.parse(session.expiresAt)<=Date.now()) {
    if (await store.isSessionDeleted(auth.inviteToken)) throw new SessionError(410,"대표자가 보정방을 삭제했습니다.","SESSION_DELETED");
    if (!session) throw new SessionError(404,"보정방을 찾을 수 없습니다.");
    throw new SessionError(410,"이 작업의 보관 기간이 끝났습니다.");
  }
  const credential = await store.findCredentials(session.id,auth.participantId);
  if (!credential || credential.sessionTokenHash!==hash(auth.sessionToken).toString("hex")) throw new SessionError(403,"이 브라우저의 참여증이 올바르지 않습니다.");
  return session;
}

export async function signedRead(path: string, expiresAt: string, download?: string, seconds=60) {
  const ttl = Math.min(seconds,Math.floor((Date.parse(expiresAt)-Date.now())/1000));
  if (ttl<1) throw new SessionError(410,"이 작업의 보관 기간이 끝났습니다.");
  const {data,error} = await storage().createSignedUrl(path,ttl,download ? {download} : undefined);
  if (error || !data) throw new SessionError(503,"파일 주소를 만들지 못했어요.");
  return data.signedUrl;
}

async function view(row: Row, expiresAt: string): Promise<JobView> {
  return {id:row.id,status:row.status,error:row.error_message || undefined,code:row.error_code || undefined,
    ...(row.status==='ready' && row.kind==='detect' && row.result?.storageKey ? {resultUrl:await signedRead(row.result.storageKey,expiresAt)} : {})};
}

export async function enqueue(auth: Auth, kind: "detect" | "compose", options: { assetId?: string; version?: number; retry?: boolean }) {
  const session=await authorizeProcessing(auth);
  if (kind==='compose' && (!Number.isSafeInteger(options.version) || options.version!<1)) throw new SessionError(400,"작업 버전이 올바르지 않습니다.");
  const {data,error}=await db().rpc('enqueue_processing_job',{p_session_id:session.id,p_participant_id:auth.participantId,p_kind:kind,p_asset_id:options.assetId || null,p_version:options.version || null,p_retry:options.retry || false});
  check(error);
  return view(data as Row,session.expiresAt);
}

export async function jobState(auth: Auth, id: string) {
  const session=await authorizeProcessing(auth);
  const {data,error}=await db().from('processing_jobs').select('*').eq('session_id',session.id).eq('id',id).maybeSingle(); check(error);
  if (!data) throw new SessionError(404,"작업을 찾을 수 없습니다.");
  const row=data as Row;
  if(row.kind==='detect' && row.input.assetId!==session.originalAssetId && row.requested_by!==auth.participantId) throw new SessionError(403,"다른 참여자의 분석은 조회할 수 없습니다.");
  return {row,session,job:await view(row,session.expiresAt)};
}

export async function originalState(auth: Auth, retry=false) {
  const session=await authorizeProcessing(auth);
  const {data:cached,error}=await db().from('original_detections').select('detection').eq('session_id',session.id).maybeSingle(); check(error);
  if (cached?.detection?.storageKey) return {status:'ready' as const,resultUrl:await signedRead(cached.detection.storageKey,session.expiresAt)};
  const job=await enqueue(auth,'detect',{assetId:session.originalAssetId,retry});
  return job;
}

export function authenticateWorker(request: Request) {
  const expected=process.env.WORKER_TOKEN;
  const value=request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
  if(!expected || expected.length<32 || !value || !timingSafeEqual(hash(value),hash(expected))) throw new SessionError(401,"Worker authentication required");
}

export async function claimWorker(): Promise<WorkerAssignment | null> {
  const {data,error}=await db().rpc('claim_processing_job'); check(error);
  if(!data) return null;
  const row=data as Row;
  try {
    const store=new SupabasePhotoSessionStore();
    const snapshot=await store.snapshot(row.session_id);
    if(!snapshot) throw new SessionError(410,'Expired');
    const {session,assets}=snapshot;
    const needed=new Map<string,string>();
    if(row.kind==='detect') {
      const photo=assets.find(a=>a.id===row.input.assetId);
      if(!photo || !(photo.id===session.originalAssetId || (photo.kind==='edited' && photo.participantId===row.requested_by))) throw new SessionError(403,'Invalid input');
      needed.set(photo.id,photo.kind);
    } else {
      const input=row.input as CompositionInput;
      needed.set(input.originalAssetId,'original');
      for(const s of input.selections) {
        if(!assets.some(a=>a.id===s.editedAssetId && a.kind==='edited' && a.participantId===s.participantId) || !assets.some(a=>a.id===s.maskAssetId && a.kind==='mask' && a.participantId===s.participantId)) throw new SessionError(403,'Invalid selection');
        needed.set(s.editedAssetId,'edited');needed.set(s.maskAssetId,'mask');
      }
      for(const s of input.overlapAssignments) {needed.set(s.editedAssetId,'edited');needed.set(s.maskAssetId,'mask');}
    }
    const files: Record<string,string>={};
    for(const [id,kind] of needed) {
      const asset=assets.find(a=>a.id===id && a.kind===kind);
      if(!asset) throw new SessionError(400,'Invalid file');
      files[id]=await signedRead(asset.storageKey,session.expiresAt,undefined,600);
    }
    const outputs: WorkerAssignment['outputs']={};
    for(const key of row.kind==='detect'?['detection']:['preview','result']) {
      const path=outputPath(row,key);
      // Keep deletion records beyond room deletion: upload capabilities last two hours.
      const {error:recordError}=await db().from('processing_output_grants').upsert({path,session_id:session.id,remove_after:session.expiresAt,capability_expires_at:new Date(Date.now()+2*60*60*1000+60000).toISOString()},{onConflict:'path'});check(recordError);
      const {data:signed,error:signError}=await storage().createSignedUploadUrl(path,{upsert:false});
      if(signError || !signed) throw new SessionError(503,'Storage unavailable');
      outputs[key]=signed;
    }
    return {id:row.id,leaseToken:row.lease_token,kind:row.kind,input:row.input,files,outputs};
  } catch(error) {
    await db().rpc('fail_processing_job',{p_id:row.id,p_lease_token:row.lease_token,p_code:error instanceof SessionError && error.status<500?'invalid_input':'transient'});
    throw error;
  }
}

function outputPath(row: Row,key: string) {return `${row.session_id}/${row.id}_${row.lease_token}_${key}.${key==='detection'?'json':'png'}`;}

export async function completeWorker(body: WorkerCompletion) {
  const {data,error}=await db().from('processing_jobs').select('*').eq('id',body.id).eq('lease_token',body.leaseToken).maybeSingle();check(error);
  if(!data) throw new SessionError(409,'Worker lease lost');
  const row=data as Row;
  if(row.status==='ready') return {ok:true};
  if(row.status!=='running' || Date.parse(row.lease_until)<=Date.now()) throw new SessionError(409,'Worker lease lost');
  const result=body.result;
  if(!result || !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width<1 || result.height<1 || result.width*result.height>40_000_000) throw new SessionError(400,'Invalid result');
  if(row.kind==='detect') {
    if(!Array.isArray(result.regions) || result.regions.length>200 || result.regions.some(r=>typeof r.id!=='string' || r.id.length>80 || !r.box || Object.values(r.box).some(n=>!Number.isFinite(n)))) throw new SessionError(400,'Invalid detection result');
  } else {
    const original=await new SupabasePhotoSessionStore().findAsset(row.session_id,row.input.originalAssetId);
    if(!original || original.width!==result.width || original.height!==result.height || !Number.isSafeInteger(result.previewWidth) || !Number.isSafeInteger(result.previewHeight) || result.previewWidth!<1 || result.previewHeight!<1 || !Number.isSafeInteger(result.unassignedOverlapPixels) || result.unassignedOverlapPixels!<0) throw new SessionError(400,'Invalid composition result');
  }
  for(const key of row.kind==='detect'?['detection']:['preview','result']) {
    const {data:info,error:fileError}=await storage().info(outputPath(row,key));
    if(fileError || !info || !info.size) throw new SessionError(409,'Output upload incomplete');
  }
  const {data:completed,error:completeError}=await db().rpc('complete_processing_job',{p_id:body.id,p_lease_token:body.leaseToken,p_result:result});check(completeError);
  if(!completed) throw new SessionError(409,'Worker lease lost or room changed');
  return {ok:true};
}

export async function updateWorker(action: 'heartbeat'|'fail', body: {id:string;leaseToken:string;errorCode?:string}) {
  const args: Record<string,unknown>={p_id:body.id,p_lease_token:body.leaseToken};
  if(action==='fail') args.p_code=['transient','invalid_input','processing_failed'].includes(body.errorCode || '')?body.errorCode:'processing_failed';
  const {data,error}=await db().rpc(action==='heartbeat'?'heartbeat_processing_job':'fail_processing_job',args);check(error);
  if(!data) throw new SessionError(409,'Worker lease lost');
  return {ok:true};
}
