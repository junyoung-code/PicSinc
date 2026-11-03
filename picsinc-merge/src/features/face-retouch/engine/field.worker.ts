import {buildField,type Prepared} from "./field";
const scope=globalThis as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:unknown,transfer?:Transferable[])=>void};
let current=0;
scope.onmessage=async ({data}:{data:{id:number;plan?:Prepared;cancel?:boolean}})=>{
 current=data.id;if(data.cancel||!data.plan)return;const id=data.id;
 try{
  const result=await buildField(data.plan,()=>current===id);
  if(result&&current===id)scope.postMessage({id,result},[result.data.buffer]);
 }catch(e){if(current===id)scope.postMessage({id,error:(e as Error).message});}
};
