"use client";
import type { CompositeResult } from "./contracts";
import type { JobView } from "./processing";
import type { DetectedRegions } from "@/features/region-editor/detected-regions";
import { request, jsonRequest, RequestError } from "@/features/mobile-flow/client";

type PreparedUpload={uploadId:string;signedUrl:string;token:string;path:string};
type UploadAttempt = { prepared?: PreparedUpload; uploaded: boolean; pending?: Promise<any> };
// Keep the same intent after a lost completion response. Blob keys release naturally
// when the page no longer holds the selected photo or mask.
const uploads = new WeakMap<Blob, Map<string, UploadAttempt>>();

function canRetryUpload(error: unknown) {
  if (error instanceof TypeError) return true; // fetch network failure
  if (!(error instanceof RequestError)) return false;
  return error.status === 429 || error.status >= 500 && error.status <= 599
    || error.status === 409 && ["Upload busy", "파일을 확인하고 있습니다. 잠시 후 다시 시도해 주세요."].includes(error.message);
}
async function retryUpload<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (attempt >= 2 || !canRetryUpload(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
async function sendUpload(prepareUrl:string,file:Blob,metadata:Record<string,unknown>,completeBody:Record<string,unknown>) {
  let byRequest = uploads.get(file);
  if (!byRequest) { byRequest = new Map(); uploads.set(file, byRequest); }
  const key = JSON.stringify([prepareUrl, metadata, completeBody]);
  let state = byRequest.get(key);
  if (!state) { state = { uploaded: false }; byRequest.set(key, state); }
  if (state.pending) return state.pending;
  const attempt = state;
  attempt.pending = (async () => {
    const prepared = attempt.prepared ??= await retryUpload(() => request<PreparedUpload>(prepareUrl, jsonRequest({ ...metadata, contentType: file.type || 'image/png', size: file.size })));
    if (!attempt.uploaded) {
      await retryUpload(async () => {
        const response = await fetch(prepared.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'image/png' }, body: file, credentials: 'omit' });
        if (response.ok) return;
        const body = await response.json().catch(() => null);
        // A previous PUT can succeed while its response is lost. Never overwrite:
        // completion will read and validate the immutable object already there.
        if (response.status === 409 || (response.status === 400 && body?.error === 'Duplicate')) return;
        throw new RequestError('사진을 업로드하지 못했어요. 다시 시도해 주세요.', response.status);
      });
      attempt.uploaded = true;
    }
    return retryUpload(() => request<any>(`/api/uploads/${prepared.uploadId}/complete`, jsonRequest(completeBody)));
  })();
  try { return await attempt.pending; }
  catch (error) {
    if (error instanceof RequestError && [404, 410].includes(error.status)) byRequest.delete(key);
    throw error;
  } finally { attempt.pending = undefined; }
}
export function uploadOriginal(nickname:string,file:File):Promise<{shareUrl:string;recoveryUrl:string;session:{inviteToken:string}}> {
  return sendUpload('/api/uploads',file,{nickname},{});
}
export function uploadAsset(base:string,kind:'edited'|'mask',file:Blob):Promise<{asset:{id:string}}> {
  const inviteToken=base.split('/').filter(Boolean).at(-1);
  return sendUpload(`${base}/uploads/${kind}`,file,{}, {inviteToken});
}

async function waitJob(base:string,job:JobView,onStatus?:(status:string)=>void):Promise<JobView> {
  while(true) {
    onStatus?.(job.status);
    if(job.status==='ready') return job;
    if(job.status==='failed') throw new RequestError(job.error || '처리하지 못했어요. 다시 시도해 주세요.',job.code==='version_changed'?409:503);
    await new Promise(resolve=>setTimeout(resolve,3000));
    const result=await request<{job:JobView}>(`${base}/jobs/${job.id}`);
    job=result.job;
  }
}
export async function detectRemote(base:string,assetId:string,onStatus?:(status:string)=>void):Promise<DetectedRegions> {
  const response=await request<{job:JobView}>(`${base}/assets/${assetId}/regions`,{method:'POST'});
  const job=await waitJob(base,response.job,onStatus);
  if(!job.resultUrl) throw new Error('분석 결과를 찾을 수 없습니다.');
  let result=await fetch(job.resultUrl,{credentials:'omit',cache:'no-store'});
  if(!result.ok) {
    const fresh=await request<{job:JobView}>(`${base}/jobs/${job.id}`);
    if(fresh.job.resultUrl) result=await fetch(fresh.job.resultUrl,{credentials:'omit',cache:'no-store'});
  }
  if(!result.ok) throw new Error('분석 결과를 불러오지 못했어요. 다시 시도해 주세요.');
  return result.json();
}
export async function composeRemote(base:string,expectedVersion:number,onStatus?:(status:string)=>void):Promise<{result:CompositeResult}> {
  const response=await request<{job?:JobView;result?:CompositeResult}>(`${base}/compose`,jsonRequest({expectedVersion}));
  if(response.result) return {result:response.result};
  if(!response.job) throw new Error('병합 작업을 찾을 수 없습니다.');
  await waitJob(base,response.job,onStatus);
  const snapshot=await request<{result:CompositeResult;session:{version:number}}>(base);
  if(!snapshot.result || snapshot.result.version!==expectedVersion || snapshot.session.version!==expectedVersion) throw new RequestError('사진이나 선택이 바뀌었어요. 다시 병합해 주세요.',409);
  return {result:snapshot.result};
}
