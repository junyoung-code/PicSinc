import type { Face, Landmark } from "../state/model";
export type DetectionRegion = { x: number; y: number; width: number; height: number; mask: Uint8Array };
export function detectFaces(bitmap:ImageBitmap,retryRegions:DetectionRegion[]=[]): {result:Promise<Face[]>;cancel:()=>void} {
  const worker=new Worker("/retouch/detect.worker.js");
  let settled=false;
  let timeout:ReturnType<typeof setTimeout>;
  let rejectJob:(e:Error)=>void=()=>{};
  const result=new Promise<Face[]>((resolve,reject)=>{
    rejectJob=reject;
    const finish=()=>{settled=true;clearTimeout(timeout);worker.terminate();};
    timeout=setTimeout(()=>{finish();reject(new Error("얼굴 분석 시간이 초과됐어요. 원본을 유지했어요. 다른 사진으로 다시 시도해주세요."));},90_000);
    worker.onerror=()=>{finish();reject(new Error("얼굴 분석기를 실행하지 못했어요. 모델 준비 상태와 브라우저를 확인해주세요."));};
    worker.onmessage=e=>{
      finish();
      if(e.data.error) {reject(new Error(e.data.error));return;}
      const faces=(e.data.landmarks as Landmark[][]).filter(l=>l.length>=478 && l.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
      faces.sort((a,b)=>a[1].x-b[1].x);
      resolve(faces.map((landmarks,i)=>({id:`face-${i+1}`,landmarks})));
    };
    worker.postMessage({bitmap,retryRegions},[bitmap,...retryRegions.map(region=>region.mask.buffer)]);
  });
  return {result,cancel:()=>{if(!settled){settled=true;clearTimeout(timeout);worker.terminate();rejectJob(new Error("사진 선택이 변경됐어요."));}}};
}
