import type {Field,Prepared} from "./field";
type Pending={id:number;resolve:(field:Field|null)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
export class FieldComputer {
 private worker!:Worker;
 private id=0;
 private pending:Pending|null=null;
 private broken=false;
 constructor(){this.start();}
 private start(){
  const worker=new Worker(new URL("./field.worker.ts",import.meta.url),{type:"module"});this.worker=worker;this.broken=false;
  worker.onmessage=({data}:{data:{id:number;result:Field;error?:string}})=>{
   const pending=this.pending;if(this.worker!==worker||!pending||pending.id!==data.id)return;
   this.pending=null;clearTimeout(pending.timer);if(data.error)pending.reject(new Error(data.error));else pending.resolve(data.result);
  };
  worker.onerror=()=>{if(this.worker!==worker)return;this.fail("좌표 계산 Worker를 실행하지 못했어요. 원본과 설정을 유지했어요. 새로고침하거나 사진을 다시 선택해주세요.");};
 }
 private fail(message:string){
  this.worker.terminate();this.broken=true;
  const pending=this.pending;this.pending=null;if(pending){clearTimeout(pending.timer);pending.reject(new Error(message));}
 }
 compute(plan:Prepared):Promise<Field|null>{
  this.cancel();if(this.broken)this.start();const id=++this.id;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{if(this.pending?.id===id)this.fail("이 조합의 계산이 30초를 넘었어요. 원본과 설정을 유지했어요. 터치 기록을 줄이거나 강도를 낮춰 다시 시도해주세요.");},30_000);
   this.pending={id,resolve,reject,timer};this.worker.postMessage({id,plan});
  });
 }
 cancel(){const pending=this.pending;this.pending=null;if(pending){clearTimeout(pending.timer);pending.resolve(null);}if(!this.broken)this.worker.postMessage({id:++this.id,cancel:true});}
 dispose(){this.cancel();this.worker.terminate();this.broken=true;}
}
