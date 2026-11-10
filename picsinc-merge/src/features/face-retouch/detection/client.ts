import type { Face, Landmark } from "../state/model";
import { classifyDetectionError, parseDiagnostic, recordDetectionFailure, type DetectionDiagnostic } from './diagnostics';
export type DetectionRegion = { x: number; y: number; width: number; height: number; mask: Uint8Array };
export function detectFaces(bitmap:ImageBitmap,regions?:DetectionRegion[]): {result:Promise<Face[]>;cancel:()=>void} {
  const started=Date.now(),width=bitmap.width,height=bitmap.height,regionCount=regions?.length??0;
  const diagnostic=(stage:DetectionDiagnostic['stage'],error?:unknown):DetectionDiagnostic=>({stage,...classifyDetectionError(error),width,height,regionCount,regionIndex:-1,cropWidth:0,cropHeight:0,elapsedMs:Math.max(0,Math.min(86400000,Date.now()-started))});
  let worker:Worker;
  try{worker=new Worker("/retouch/detect.worker.js");}catch(error){recordDetectionFailure(diagnostic('worker-create',error));throw error;}
  let settled=false;
  let timeout:ReturnType<typeof setTimeout>;
  let rejectJob:(e:Error)=>void=()=>{};
  const result=new Promise<Face[]>((resolve,reject)=>{
    rejectJob=reject;
    const finish=()=>{settled=true;clearTimeout(timeout);worker.terminate();};
    timeout=setTimeout(()=>{finish();recordDetectionFailure({...diagnostic('worker-timeout'),reason:'timeout'});reject(new Error("얼굴 분석 시간이 초과됐어요. 원본을 유지했어요. 다른 사진으로 다시 시도해주세요."));},90_000);
    worker.onerror=event=>{finish();recordDetectionFailure(diagnostic('worker-error',event.error??{message:event.message}));reject(new Error("얼굴 분석기를 실행하지 못했어요. 모델 준비 상태와 브라우저를 확인해주세요."));};
    worker.onmessage=e=>{
      finish();
      if(e.data.error) {recordDetectionFailure(parseDiagnostic(e.data.diagnostic)??diagnostic('worker-error'));reject(new Error(e.data.error));return;}
      const faces=(e.data.landmarks as Landmark[][]).filter(l=>l.length>=478 && l.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
      faces.sort((a,b)=>a[1].x-b[1].x);
      resolve(faces.map((landmarks,i)=>({id:`face-${i+1}`,landmarks})));
    };
    worker.postMessage({bitmap,regions},[bitmap,...(regions??[]).map(region=>region.mask.buffer)]);
  });
  return {result,cancel:()=>{if(!settled){settled=true;clearTimeout(timeout);worker.terminate();rejectJob(new Error("사진 선택이 변경됐어요."));}}};
}
