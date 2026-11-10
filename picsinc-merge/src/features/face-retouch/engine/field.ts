import { lipWeight } from "../effects/lips";
import {contourShift,lowerFaceSource} from '../effects/face-shape';
import { TOUCH_SUPPORT } from "../touch/coordinates";
import { unsafeCells, type FieldWindow } from "./limits";
import { bounds, frame, oval, smooth } from "../effects/geometry";
import { operations, type Operation, type Region } from "../effects/operations";
import type { EditState, Face, Point, Restore } from "../state/model";
import {sampledMask} from './masks';
import {currentRestores,restoreWeight} from './restoration';
export type Prepared = { operations: Operation[]; areas: Record<string,Region>; state: EditState; width: number; height: number; limited: boolean; touchScope?: "region" | "global" };
const regionCache=new WeakMap<Region,{c:number;s:number}>();
function trig(r:Region){let t=regionCache.get(r);if(!t){t={c:Math.cos(r.angle),s:Math.sin(r.angle)};regionCache.set(r,t);}return t;}
function local(p:Point,r:Region):Point{const {c,s}=trig(r),x=p.x-r.center.x,y=p.y-r.center.y;return{x:x*c+y*s,y:-x*s+y*c};}
export function regionDistance(p:Point,r:Region):number {
 const q=local(p,r);return r.box?Math.max(Math.abs(q.x)/r.rx,Math.abs(q.y)/r.ry):Math.hypot(q.x/r.rx,q.y/r.ry);
}
function outside(p:Point,r:Region):number{
 const q=local(p,r);
 if(r.box)return Math.hypot(Math.max(0,Math.abs(q.x)-r.rx),Math.max(0,Math.abs(q.y)-r.ry));
 return Math.max(0,Math.hypot(q.x/r.rx,q.y/r.ry)-1)*Math.min(r.rx,r.ry);
}
export function faceArea(face: Face,width:number,height:number):Region {
 const f=frame(face,width,height),b=bounds(oval.map(i=>f.lm[i]));
 return {center:f.world({x:b.x+b.width/2,y:b.y+b.height/2}),rx:b.width*.64,ry:b.height*.64,angle:f.angle};
}
// Reuse immutable feature geometry and protection regions while settings change.
const faceCache=new WeakMap<Face,Map<string,Region>>();
function cachedArea(face:Face,w:number,h:number){let cache=faceCache.get(face);if(!cache){cache=new Map();faceCache.set(face,cache);}const key=`${w}:${h}`;let area=cache.get(key);if(!area){area=faceArea(face,w,h);cache.set(key,area);}return area;}
export function prepare(faces:Face[],state:EditState,width:number,height:number,touchScope?:"region"|"global"):Prepared {
 const areas=Object.fromEntries(faces.map(f=>[f.id,cachedArea(f,width,height)]));
 if(touchScope)areas["__touch"]={center:{x:width/2,y:height/2},rx:width,ry:height,angle:0,box:true};
 const ops=faces.flatMap(f=>state.settings[f.id]?operations(f,state.settings[f.id],width,height):[]);
 const limited=ops.some(o=>Object.entries(areas).some(([id,r])=>id!=="__touch" && id!==o.owner && Math.hypot(o.center.x-r.center.x,o.center.y-r.center.y)<supportRadius(o)+Math.max(r.rx,r.ry))) || state.strokes.some(o=>o.owner!=="__touch"&&Object.entries(areas).some(([id,r])=>id!=="__touch" && id!==o.owner && regionDistance(o.from,r)<1.5));
 return {operations:ops,areas,state,width,height,limited:touchScope==="global"?false:limited,touchScope};
}
const areaEntries=new WeakMap<Prepared["areas"],Array<[string,Region]>>();
function protection(p:Point,owner:string,plan:Prepared):number {
 const areas=plan.areas;
 // Zero every grid vertex that can contribute to a protected output pixel.
 // The extra source-pixel diagonal also keeps linear texture taps outside it.
 const guard=gridGeometry(plan).guard+Math.SQRT2;
 let entries=areaEntries.get(areas);if(!entries){entries=Object.entries(areas);areaEntries.set(areas,entries);}
 let weight=1;for(const [id,r] of entries)if(id!==owner&&id!=="__touch"){
  const padding=guard/Math.min(r.rx,r.ry),radius=Math.max(r.rx,r.ry)*(1.25+padding);
  if(Math.abs(p.x-r.center.x)>=radius||Math.abs(p.y-r.center.y)>=radius)continue;
  weight*=smooth((regionDistance(p,r)-1-padding)/.25);if(!weight)break;
 }return weight;
}
const inverseCache=new WeakMap<Operation,Map<number,{cr:number;sr:number;ix:number;iy:number}>>();
function inverse(p:Point,o:Operation,scale:number):Point {
 let cache=inverseCache.get(o);if(!cache){cache=new Map();inverseCache.set(o,cache);}
 let coefficients=cache.get(scale);if(!coefficients){coefficients={cr:Math.cos(o.rotation*scale),sr:Math.sin(o.rotation*scale),ix:1/(1+(o.sx-1)*scale),iy:1/(1+(o.sy-1)*scale)};cache.set(scale,coefficients);}
 const q=local(p,o),{c,s}=trig(o);let dx=o.dx*scale,dy=o.dy*scale;
 if(o.head){const x=q.x; // x relative to the brow center
  const centerLocalOffset=(o.head.inner+o.head.outer)/2;
  const headWeight=smooth(((x+centerLocalOffset-o.head.outer)/(o.head.inner-o.head.outer)-.55)/.45);
  dx*=headWeight;dy*=headWeight;
 }
 const u=q.x-dx,v=q.y-dy,{cr,sr,ix,iy}=coefficients;
 const a=(u*cr+v*sr)*ix,b=(-u*sr+v*cr)*iy;
 return {x:o.center.x+a*c-b*s,y:o.center.y+a*s+b*c};
}
type Projection={index:number;t:number;distance:number};
function contourProjection(p:Point,line:NonNullable<Operation["contour"]>):Projection{
 let best=Infinity,index=0,tBest=0;
 for(let i=0;i<line.length;i++){
  const a=line[i],b=line[(i+1)%line.length],dx=b.point.x-a.point.x,dy=b.point.y-a.point.y,len=dx*dx+dy*dy;
  const t=len?Math.max(0,Math.min(1,((p.x-a.point.x)*dx+(p.y-a.point.y)*dy)/len)):0,d=(p.x-a.point.x-dx*t)**2+(p.y-a.point.y-dy*t)**2;
  if(d<best){best=d;index=i;tBest=t;}
 }
 return{index,t:tBest,distance:Math.sqrt(best)};
}
function contourInverse(p:Point,o:Operation,scale:number,projection:Projection):{q:Point;weight:number}{
 const a=o.contour![projection.index],b=o.contour![(projection.index+1)%o.contour!.length],t=projection.t;
 const delta={x:a.delta.x+(b.delta.x-a.delta.x)*t,y:a.delta.y+(b.delta.y-a.delta.y)*t};
 return{q:{x:p.x-delta.x*scale,y:p.y-delta.y*scale},weight:1-smooth(projection.distance/o.feather)};
}
export function supportRadius(o:Operation):number{
 return Math.hypot(o.rx,o.ry)*Math.max(1,o.sx,o.sy)+o.feather+Math.hypot(o.dx,o.dy);
}
type Compiled={opRestores:number[][];touchRestores:number[][];redness:Record<string,number[]>;opKeys:string[];radii:number[];restoreBins:Map<string,number[]>};
const compiledCache=new WeakMap<Prepared,Compiled>();
function compiled(plan:Prepared):Compiled{
 let c=compiledCache.get(plan);if(c)return c;
 const indices=(items:Restore[])=>items.map(r=>plan.state.restores.indexOf(r));
 const restoreBins=new Map<string,number[]>();
 plan.state.restores.forEach((r,i)=>{for(let y=Math.floor((Math.min(r.from.y,r.center.y)-r.radius)/64);y<=Math.floor((Math.max(r.from.y,r.center.y)+r.radius)/64);y++)for(let x=Math.floor((Math.min(r.from.x,r.center.x)-r.radius)/64);x<=Math.floor((Math.max(r.from.x,r.center.x)+r.radius)/64);x++){const key=`${x}:${y}`,list=restoreBins.get(key)??[];list.push(i);restoreBins.set(key,list);}});
 c={restoreBins,opKeys:plan.operations.map(o=>`${o.owner}:${o.control}`),radii:plan.operations.map(supportRadius),opRestores:plan.operations.map(o=>indices(currentRestores(plan.state,o.owner,o.control))),touchRestores:plan.state.strokes.map((s,i)=>indices(plan.state.restores.filter(r=>r.owner===s.owner&&i<r.through))),redness:Object.fromEntries(Object.keys(plan.state.settings).map(id=>[id,indices(currentRestores(plan.state,id,'eyeRedness'))]))};
 compiledCache.set(plan,c);return c;
}
function pointWeights(point:Point,plan:Prepared,sample?:(i:number)=>number){
 if(!plan.state.restores.length)return [];
 const weights:number[]=[];
 for(const i of compiled(plan).restoreBins.get(`${Math.floor(point.x/64)}:${Math.floor(point.y/64)}`)??[])weights[i]=sample?sample(i):restoreWeight(point,plan.state.restores[i]);
 return weights;
}
function minimum(indices:number[],weights:number[]){let v=1;for(const i of indices)v=Math.min(v,weights[i]??1);return v;}
export function colorSuppression(point:Point,plan:Prepared,weights=pointWeights(point,plan)):number{
 let amount=0;for(const [owner,list] of Object.entries(compiled(plan).redness))if(plan.state.settings[owner].eyeRedness&&regionDistance(point,plan.areas[owner])<1.25)amount=Math.max(amount,(1-minimum(list,weights))*protection(point,owner,plan));return amount;
}
export type Strengths=Record<string,number>;
export function mapPoint(point:Point,plan:Prepared,strengths:Strengths={},weights=pointWeights(point,plan),pointProtection?:Record<string,number>,contourSamples?:Record<string,Projection>):Point {
 let p={...point};const contourReferences:Record<string,Point>={},projections:Record<string,Projection>={};const cache=compiled(plan),protectedWeights:Record<string,number>=pointProtection??{};
 const protect=(owner:string)=>owner==="__touch"?1:protectedWeights[owner]??(protectedWeights[owner]=protection(point,owner,plan));
 for(let i=plan.state.strokes.length-1;i>=0;i--){
  const stroke=plan.state.strokes[i],area=plan.areas[stroke.owner],outer=stroke.radius*TOUCH_SUPPORT;if(!area)continue;
  if(Math.abs(point.x-stroke.from.x)>=outer||Math.abs(point.y-stroke.from.y)>=outer)continue;
  const d=Math.hypot(point.x-stroke.from.x,point.y-stroke.from.y)/outer;if(d>=1)continue;
  let weight=(1-smooth(d))*stroke.strength*(strengths[`${stroke.owner}:touch`]??1)*(1-smooth((regionDistance(point,area)-1)/.35));
  weight*=protect(stroke.owner)*minimum(cache.touchRestores[i],weights);if(!weight)continue;
  const q={x:p.x-(stroke.to.x-stroke.from.x)*weight,y:p.y-(stroke.to.y-stroke.from.y)*weight},safe=stroke.owner==="__touch"?1:protection(q,stroke.owner,plan);
  p={x:p.x+(q.x-p.x)*safe,y:p.y+(q.y-p.y)*safe};
 }
 for(let i=plan.operations.length-1;i>=0;i--){
  const o=plan.operations[i],radius=cache.radii[i];if(Math.abs(p.x-o.center.x)>radius||Math.abs(p.y-o.center.y)>radius)continue;
  let weight=protect(o.owner)*minimum(cache.opRestores[i],weights);
  if(o.verticalClip)weight*=smooth((o.ry-Math.abs(local(point,o).y))/Math.max(1,o.ry*.3));
  if(o.pair){const {c,s}=trig(o);weight*=smooth(((point.x-o.pair.center.x)*c+(point.y-o.pair.center.y)*s)*o.pair.sign/o.pair.collar);}
  if(!weight)continue;
  const scale=strengths[cache.opKeys[i]]??1;
  let q:Point;
  if(o.softContour){
   const delta=contourShift(p,o.softContour);q={x:p.x-delta.x*scale,y:p.y-delta.y*scale};
  }
  else if(o.lowerFace){
   const y=local(p,o).y,shift=lowerFaceSource(y,o.lowerFace,scale)-y,{c,s}=trig(o);
   q={x:p.x-shift*s,y:p.y+shift*c};
   weight*=1-smooth(Math.min(outside(p,o),outside(q,o))/o.feather);
  }
  else if(o.contour){
   const reference=contourReferences[o.owner]??(contourReferences[o.owner]={...p});
   const projection=projections[o.owner]??(projections[o.owner]=reference.x===point.x&&reference.y===point.y&&contourSamples?.[o.owner]?contourSamples[o.owner]:contourProjection(reference,o.contour));
   const result=contourInverse(reference,o,scale,projection);q={x:p.x+result.q.x-reference.x,y:p.y+result.q.y-reference.y};weight*=result.weight;
  }
  else if(o.lip){q=inverse(p,o,scale);weight*=lipWeight(point,o.lip,gridGeometry(plan).guard);}
  else{q=inverse(p,o,scale);weight*=o.legacyFalloff?1-smooth((regionDistance(p,o)-.5)/.5):1-smooth(Math.min(outside(p,o),outside(q,o))/o.feather);}
  if(!weight)continue;
  for(const r of o.exclusions){const collar=Math.max(2,Math.min(r.rx,r.ry)*.65);weight*=smooth(Math.min(outside(point,r),outside(q,r))/collar);}
  weight*=protection(q,o.owner,plan);
  p={x:p.x+(q.x-p.x)*weight,y:p.y+(q.y-p.y)*weight};
 }
 return {x:Math.max(0,Math.min(plan.width,p.x)),y:Math.max(0,Math.min(plan.height,p.y))};
}
export type Field = { data: Float32Array; columns: number; rows: number; limited: boolean; strained: boolean; strengths?:Strengths };
const gridCache=new WeakMap<Prepared,{columns:number;rows:number;guard:number}>();
function gridGeometry(plan:Prepared){
 let grid=gridCache.get(plan);if(grid)return grid;
 const minFace=Math.min(...Object.values(plan.areas).map(r=>r.rx*2),plan.width,plan.height),step=Math.max(1.5,minFace/100,Math.max(plan.width,plan.height)/1536);
 const columns=Math.ceil(plan.width/step)+1,rows=Math.ceil(plan.height/step)+1;
 grid={columns,rows,guard:Math.hypot(plan.width/(columns-1),plan.height/(rows-1))};gridCache.set(plan,grid);return grid;
}
function yieldCalculation():Promise<void>{
 // A task boundary lets newer Worker messages cancel this calculation. Nested
 // timers acquire a minimum delay in WebKit, adding idle time to long edits.
 return new Promise(resolve=>{
  const channel=new MessageChannel();
  channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};
  channel.port2.postMessage(null);
 });
}
export async function buildField(plan:Prepared,isCurrent:()=>boolean=()=>true):Promise<Field|null> {
 if(!isCurrent())return null;
 const colorOwners=Object.keys(plan.state.settings).filter(id=>plan.state.settings[id].eyeRedness&&compiled(plan).redness[id].length);
 if(!plan.operations.length&&!plan.state.strokes.length&&!colorOwners.length)return {data:new Float32Array(16),columns:2,rows:2,limited:plan.limited,strained:false};
 const {columns,rows}=gridGeometry(plan),data=new Float32Array(columns*rows*4);
 const supports=[...plan.operations.map(o=>({x:o.center.x,y:o.center.y,r:supportRadius(o),key:`${o.owner}:${o.control}`})),...plan.state.strokes.filter(s=>plan.areas[s.owner]).map(s=>({x:s.from.x,y:s.from.y,r:s.radius*TOUCH_SUPPORT,key:`${s.owner}:touch`})),...colorOwners.map(id=>({x:plan.areas[id].center.x,y:plan.areas[id].center.y,r:Math.max(plan.areas[id].rx,plan.areas[id].ry)*1.25,key:''}))];
 if(!supports.length)return {data:new Float32Array(16),columns:2,rows:2,limited:plan.limited,strained:false};
 const window:FieldWindow={x0:Math.max(0,Math.floor(Math.min(...supports.map(s=>s.x-s.r))/plan.width*(columns-1))-1),y0:Math.max(0,Math.floor(Math.min(...supports.map(s=>s.y-s.r))/plan.height*(rows-1))-1),x1:Math.min(columns-1,Math.ceil(Math.max(...supports.map(s=>s.x+s.r))/plan.width*(columns-1))+1),y1:Math.min(rows-1,Math.ceil(Math.max(...supports.map(s=>s.y+s.r))/plan.height*(rows-1))+1)};
 const gridKey=`${plan.width}:${plan.height}:${columns}:${rows}`;
 const gridPoint=(x:number,y:number)=>({x:x/(columns-1)*plan.width,y:y/(rows-1)*plan.height});
 const maskWindow=(x0:number,y0:number,x1:number,y1:number):FieldWindow=>({x0:Math.max(0,Math.floor(x0/plan.width*(columns-1))),y0:Math.max(0,Math.floor(y0/plan.height*(rows-1))),x1:Math.min(columns-1,Math.ceil(x1/plan.width*(columns-1))),y1:Math.min(rows-1,Math.ceil(y1/plan.height*(rows-1)))});
 let maskBytes=0;
 const mask=(key:string,window:FieldWindow,calculate:(x:number,y:number)=>number,otherwise:number)=>{
  const size=Math.max(0,(window.x1-window.x0+1)*(window.y1-window.y0+1))*8;
  const allowed=size<=8*1024*1024&&maskBytes+size<=24*1024*1024;
  if(allowed)maskBytes+=size;
  return sampledMask(key,window,calculate,otherwise,allowed);
 };
 const restores=plan.state.restores.map(r=>mask(`r:${gridKey}:${JSON.stringify([r.from,r.center,r.radius])}`,maskWindow(Math.min(r.from.x,r.center.x)-r.radius,Math.min(r.from.y,r.center.y)-r.radius,Math.max(r.from.x,r.center.x)+r.radius,Math.max(r.from.y,r.center.y)+r.radius),(x,y)=>restoreWeight(gridPoint(x,y),r),1));
 const owners=[...new Set([...plan.operations.map(o=>o.owner),...plan.state.strokes.map(s=>s.owner)])];
 const protects=Object.fromEntries(owners.map(owner=>[owner,mask(`p:${gridKey}:${owner}:${JSON.stringify(plan.areas)}`,{x0:0,y0:0,x1:columns-1,y1:rows-1},(x,y)=>protection(gridPoint(x,y),owner,plan),1)]));
 const contourMasks:Record<string,((x:number,y:number)=>Projection)>={};
 for(const o of plan.operations)if(o.contour&&!contourMasks[o.owner]){
  const key=`c:${gridKey}:${JSON.stringify(o.contour.map(v=>v.point))}`;
  let lastX=-1,lastY=-1,last:Projection;
  const sample=(x:number,y:number)=>{if(x!==lastX||y!==lastY){lastX=x;lastY=y;last=contourProjection(gridPoint(x,y),o.contour!);}return last;};
  const all={x0:0,y0:0,x1:columns-1,y1:rows-1};
  const indices=mask(`${key}:index`,all,(x,y)=>sample(x,y).index,0),fractions=mask(`${key}:t`,all,(x,y)=>sample(x,y).t,0),distances=mask(`${key}:distance`,all,(x,y)=>sample(x,y).distance,Infinity);
  contourMasks[o.owner]=(x,y)=>({index:indices(x,y),t:fractions(x,y),distance:distances(x,y)});
 }
 // Sampling functions and owner lists stay fixed for this field. Reuse their
 // per-point records instead of allocating entries/arrays at every grid vertex.
 const protectionSamplers=owners.map(owner=>({owner,sample:protects[owner]}));
 const contourSamplers=Object.entries(contourMasks);
 const protectionWeights:Record<string,number>={},contourSamples:Record<string,Projection>={};
 const strengths:Strengths={};let strained=false,yielded=performance.now();
 for(let attempt=0;attempt<32;attempt++){
  for(let y=window.y0;y<=window.y1;y++){
   for(let x=window.x0;x<=window.x1;x++){
    for(const {owner,sample} of protectionSamplers)protectionWeights[owner]=sample(x,y);
    for(const [owner,sample] of contourSamplers)contourSamples[owner]=sample(x,y);
    const p={x:x/(columns-1)*plan.width,y:y/(rows-1)*plan.height},weights=pointWeights(p,plan,i=>restores[i](x,y)),q=mapPoint(p,plan,strengths,weights,protectionWeights,contourSamples),i=(y*columns+x)*4;
    data[i]=(q.x-p.x)/plan.width;data[i+1]=(q.y-p.y)/plan.height;
    if(attempt===0&&colorOwners.length)data[i+2]=colorSuppression(p,plan,weights);
   }
   if(performance.now()-yielded>=6){await yieldCalculation();if(!isCurrent())return null;yielded=performance.now();}
  }
  const unsafe=unsafeCells(data,columns,rows,window);
  if(!unsafe.length)return{data,columns,rows,limited:plan.limited,strained,strengths};
  strained=true;const affected=new Map<string,number>();
  for(const cell of unsafe){const p={x:(cell.x+.5)/(columns-1)*plan.width,y:(cell.y+.5)/(rows-1)*plan.height};for(const s of supports)if(s.key&&Math.abs(p.x-s.x)<s.r&&Math.abs(p.y-s.y)<s.r)affected.set(s.key,Math.min(affected.get(s.key)??1,cell.strength));}
  if(!affected.size)break;
  // Recompute the same continuous transform at a lower shared strength. Never
  // damp individual vertices inside an eye or eyebrow differently.
  for(const [key,factor] of affected)strengths[key]=(strengths[key]??1)*factor;
 }
 throw new Error("이 조합의 변형을 안전하게 계산하지 못했어요. 원본과 설정을 유지했어요. 강도를 낮춰 다시 시도해주세요.");
}
