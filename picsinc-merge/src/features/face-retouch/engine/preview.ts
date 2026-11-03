import type {Face} from "../state/model";
import type {Field,Prepared} from "./field";

export type PreviewRequest={plan:Prepared;faces:Face[];version:number};
type Computer={compute:(plan:Prepared)=>Promise<Field|null>;cancel:()=>void};
// Finish a frame while the pointer keeps moving. Retain only the latest waiting
// input, rather than starving every render by cancelling it on the next event.
export class PreviewQueue {
 private waiting:PreviewRequest|null=null;
 private running=false;
 private disposed=false;
 constructor(private computer:Computer,private rendered:(field:Field,job:PreviewRequest)=>void,private failed:(error:Error,job:PreviewRequest)=>void){}
 request(job:PreviewRequest){
  if(this.disposed)return;
  this.waiting=job;
  if(!job.plan.operations.length&&!job.plan.state.strokes.length)this.computer.cancel();
  if(!this.running)void this.drain();
 }
 private async drain(){
  this.running=true;
  while(this.waiting&&!this.disposed){
   const job=this.waiting;this.waiting=null;
   try{const field=await this.computer.compute(job.plan);if(field&&!this.disposed)this.rendered(field,job);}
   catch(e){if(!this.disposed)this.failed(e as Error,job);}
  }
  this.running=false;
 }
 dispose(){this.disposed=true;this.waiting=null;this.computer.cancel();}
}
