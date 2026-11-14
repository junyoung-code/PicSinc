import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { isolatePersonalEdit, intersectAuthorizedMask } from '@/features/composition/compose';
import { supabaseServer } from '@/integrations/storage/supabase-server';
import { SupabasePhotoSessionStore, SupabasePrivateFileStore } from '@/integrations/storage/supabase-photo-session-store';
import { authorizeProcessing } from './processing-service';
import { SessionError } from './errors';
import { decodeMask, verifyPhotoBytes } from './image-validation';
import type { CollaborationAction, CollaborationView } from './collaboration-types';
import { readCompositionJob } from './collaboration-job';
export type { CollaborationAction, CollaborationView, CollaborationPhase } from './collaboration-types';

type Auth = { inviteToken: string; participantId: string; sessionToken: string };
const actions = new Set(['enable','start','personal-begin','personal-cancel','personal-save','compose','compose-finished','open-global','acquire','heartbeat','cancel','save','end-global','finalize','read']);
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function collaborationError(error: { message: string } | null) {
  if (!error) return;
  const messages: Record<string,string> = {
    'Collaboration locked':'현재 단계에서는 수정할 수 없어요.', 'Collaboration required':'협업 보정방을 시작해 주세요.',
    'Selection required':'자신의 인물 영역을 선택하고 저장해 주세요.', 'Edit token expired':'편집 권한이 만료됐어요. 다시 편집을 시작해 주세요.',
    'All participants required':'모든 참여자가 개인 보정을 완료해야 해요.', 'Composition required':'최신 사진 합치기가 끝난 후 진행해 주세요.',
    'Editor busy':'다른 참여자의 편집이 끝난 후 진행해 주세요.', 'Version changed':'사진이나 선택이 바뀌었어요. 다시 불러와 주세요.',
    'Nobody finished':'아직 보정을 끝낸 사람이 없어요.',
  };
  if (error.message==='Forbidden') throw new SessionError(403,'이 작업을 수정할 권한이 없습니다.');
  if (error.message==='Session expired') throw new SessionError(410,'이 작업의 보관 기간이 끝났습니다.');
  if (messages[error.message]) throw new SessionError(409,messages[error.message],'COLLABORATION_CONFLICT');
  throw new SessionError(503,'협업 상태를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
}

export async function collaboration(auth: Auth, input: CollaborationAction | { action: 'read' }): Promise<CollaborationView> {
  if (!input || typeof input!=='object' || !actions.has(input.action)) throw new SessionError(400,'요청 형식이 올바르지 않습니다.');
  if (['personal-save','save','heartbeat','cancel','personal-cancel'].includes(input.action) && !uuid((input as {token?:unknown}).token)) throw new SessionError(400,'편집 권한이 올바르지 않습니다.');
  if (['personal-save','save'].includes(input.action) && !uuid((input as {editedAssetId?:unknown}).editedAssetId)) throw new SessionError(400,'사진 정보가 올바르지 않습니다.');
  if (input.action==='open-global' && !uuid(input.resultAssetId)) throw new SessionError(400,'사진 정보가 올바르지 않습니다.');
  if (input.action==='save' && (!Number.isSafeInteger(input.baseVersion) || input.baseVersion<0)) throw new SessionError(400,'작업 버전이 올바르지 않습니다.');
  if ((input.action==='personal-save' || input.action==='save') && (!input.state || typeof input.state!=='object' || Array.isArray(input.state) || Buffer.byteLength(JSON.stringify(input.state))>4*1024*1024)) throw new SessionError(400,'보정 기록이 너무 큽니다.');
  const session=await authorizeProcessing(auth);
  const db=supabaseServer();
  const rpc=async (action:string,payload:unknown={}) => {
    const {data,error}=await db.rpc('collaboration_action',{p_session_id:session.id,p_participant_id:auth.participantId,p_action:action,p_payload:payload});
    collaborationError(error); return data as CollaborationView;
  };
  const store=new SupabasePhotoSessionStore(); const files=new SupabasePrivateFileStore();
  const uploaded: string[]=[];
  const put=async (bytes:Buffer,kind:'mask'|'edited'|'result') => {
    const id=randomUUID(); const storageKey=`${session.id}/${id}.png`;
    await files.put(storageKey,bytes,'image/png'); uploaded.push(storageKey);
    return {id,storageKey,kind};
  };
  const removeUnreferenced=async () => {
    if (!uploaded.length) return;
    try {
      // RPC responses can be lost after commit. Retain accepted assets, and let
      // expiry cleanup handle uncertain DB responses instead of deleting them.
      const {data,error}=await db.from('photo_assets').select('storage_key').in('storage_key',uploaded);
      if (!error && data) {
        const referenced=new Set(data.map(a=>a.storage_key));
        await files.remove(uploaded.filter(key=>!referenced.has(key)));
      }
    } catch { /* cleanup must not replace the original save outcome */ }
  };
  const bytes=async (id:string) => {
    const asset=await store.findAsset(session.id,id);
    if (!asset) throw new SessionError(404,'사진을 찾을 수 없습니다.');
    return {asset,buffer:Buffer.from(await (await files.get(asset.storageKey)).arrayBuffer())};
  };
  try {
    if (input.action === 'read') {
      const current = await rpc('read');
      if (current.enabled && current.phase === 'composing') {
        const job = await readCompositionJob(db, session);
        if (job) return {...current, job};
      }
      return current;
    }
    if (input.action==='personal-begin') {
      const current=await rpc('read');
      if (current.personalToken) return current;
      const snapshot=await store.snapshot(session.id);
      const selection=snapshot?.originalSelections.find(s=>s.participantId===auth.participantId);
      if (!selection || !selection.selectedRegionIds.length) throw new SessionError(409,'자신의 인물 영역을 선택하고 저장해 주세요.');
      const detectionRecord=await store.findOriginalDetection(session.id) as unknown as {storageKey?:string;regions:{id:string;maskPngBase64:string}[]}|null;
      const detection=detectionRecord?.storageKey ? JSON.parse(await (await files.get(detectionRecord.storageKey)).text()) : detectionRecord;
      const claims=await store.listRegionClaims(session.id);
      const ids=new Set(selection.selectedRegionIds.filter(id=>claims.some(c=>c.regionId===id && c.participantId===auth.participantId)));
      const mask=await intersectAuthorizedMask({mask:(await bytes(selection.maskAssetId)).buffer,authorizedMasks:(detection?.regions ?? []).filter((r:{id:string})=>ids.has(r.id)).map((r:{maskPngBase64:string})=>Buffer.from(r.maskPngBase64,'base64'))});
      if (!(await decodeMask(mask)).selected.some(Boolean)) throw new SessionError(409,'선택 영역이 비어 있어요. 인물 영역을 다시 선택해 주세요.');
      const saved=await put(mask,'mask');
      const begun=await rpc(input.action,{sourceMaskAssetId:selection.maskAssetId,selectedRegionIds:selection.selectedRegionIds,mask:saved});
      // A second tab may have won the begin race; its frozen mask is authoritative.
      if (begun.personalMaskAssetId!==saved.id) await files.remove([saved.storageKey]).catch(()=>{});
      return begun;
    }
    if (input.action==='personal-save' || input.action==='save') {
      const receipt=await rpc('receipt',{action:input.action,token:input.token,editedAssetId:input.editedAssetId});
      if (receipt) return receipt;
      const current=await rpc('read');
      const personal=input.action==='personal-save';
      if (personal ? current.phase!=='personal' || current.personalToken!==input.token : current.phase!=='global' || current.editToken!==input.token || current.version!==input.baseVersion) {
        // Another identical request can commit between the receipt and state reads.
        const committed=await rpc('receipt',{action:input.action,token:input.token,editedAssetId:input.editedAssetId});
        if (committed) return committed;
        throw new SessionError(409,'편집 권한이 만료됐어요. 다시 편집을 시작해 주세요.');
      }
      const edit=await bytes(input.editedAssetId);
      if (edit.asset.kind!=='edited' || edit.asset.participantId!==auth.participantId) throw new SessionError(403,'본인의 보정 사진만 저장할 수 있습니다.');
      const original=await bytes(session.originalAssetId);
      await verifyPhotoBytes(edit.buffer,{width:original.asset.width,height:original.asset.height});
      if (personal) {
        if (!current.personalMaskAssetId) throw new SessionError(409,'인물 영역을 다시 선택해 주세요.');
        const mask=(await bytes(current.personalMaskAssetId)).buffer;
        const isolated=await isolatePersonalEdit({original:original.buffer,edited:edit.buffer,mask});
        const result=await put(isolated,'edited'); const savedMask=await put(mask,'mask');
        const saved=await rpc(input.action,{...input,assets:[result,savedMask]});
        await removeUnreferenced(); return saved;
      }
      const png=await sharp(edit.buffer).rotate().toColourspace('srgb').png().toBuffer();
      const saved=await rpc(input.action,{...input,asset:await put(png,'result')});
      await removeUnreferenced(); return saved;
    }
    if (input.action==='compose-finished') {
      // Owner only, enforced in the DB: compose now without friends who have not finished (B-028).
      const {data,error}=await db.rpc('compose_finished_only',{p_session_id:session.id,p_participant_id:auth.participantId});
      collaborationError(error); return data as CollaborationView;
    }
    return await rpc(input.action,input);
  } catch(error) {
    await removeUnreferenced();
    throw error;
  }
}
