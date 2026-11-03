import type {FieldWindow} from './limits';
// Exact grid samples, not a lower-resolution mask. Bounded LRU keeps repeated
// protection/restoration calculations out of the interactive path.
type Entry={data:Float64Array;window:FieldWindow;columns:number};
const cache=new Map<string,Entry>();let bytes=0;
const budget=24*1024*1024;
export function sampledMask(key:string,window:FieldWindow,calculate:(x:number,y:number)=>number,otherwise:number,allowed=true):(x:number,y:number)=>number{
 const columns=window.x1-window.x0+1,rows=window.y1-window.y0+1,size=Math.max(0,columns*rows)*8;
 if(!allowed||size>8*1024*1024||size===0)return calculate;
 let entry=cache.get(key);
 if(entry){cache.delete(key);cache.set(key,entry);}
 else{
  while(bytes+size>budget&&cache.size){const oldest=cache.keys().next().value!,item=cache.get(oldest)!;bytes-=item.data.byteLength;cache.delete(oldest);}
  entry={data:new Float64Array(columns*rows).fill(NaN),window,columns};cache.set(key,entry);bytes+=size;
 }
 const result=entry;
 return(x,y)=>{if(x<window.x0||x>window.x1||y<window.y0||y>window.y1)return otherwise;
  const i=(y-window.y0)*columns+x-window.x0;if(Number.isNaN(result.data[i]))result.data[i]=calculate(x,y);return result.data[i];};
}
