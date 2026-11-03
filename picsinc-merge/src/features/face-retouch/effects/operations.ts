import { lipOuterLoop, lipInnerLoop, type LipShape } from "./lips";
import { bounds, browLoops, eyeLoops, frame, lipLoop, mean, oval, smooth } from "./geometry";
import {controls, controlDefinitions, faceEffectAmount, type ControlId, type Face, type Point, type Settings} from "../state/model";
export type Region = { center: Point; rx: number; ry: number; angle: number; box?: boolean };
export type Operation = Region & { owner: string; control: ControlId; sx: number; sy: number; rotation: number; dx: number; dy: number; exclusions: Region[]; feather: number; legacyFalloff?:boolean; lip?:LipShape; contour?: {point:Point;delta:Point}[]; head?:{inner:number;outer:number}; verticalClip?:boolean; pair?:{center:Point;sign:number;collar:number} };
// Core regions include makeup. Only the surrounding collar fades the transform.
function buildOperations(face: Face, settings: Settings, width: number, height: number): Operation[] {
 const f=frame(face,width,height),p=f.lm,w=f.width,h=f.height,out:Operation[]=[];
 const region=(ids:number[],paddingX=1.4,paddingY=1.7):Region=>{const b=bounds(ids.map(i=>p[i]));return {center:f.world({x:b.x+b.width/2,y:b.y+b.height/2}),rx:Math.max(w*.018,b.width*paddingX/2),ry:Math.max(h*.015,b.height*paddingY/2),angle:f.angle,box:true};};
 const at=(i:number,rx:number,ry:number):Region=>({center:f.world(p[i]),rx,ry,angle:f.angle});
 const v=(id:ControlId)=>settings[id]/100*controlDefinitions[id].direction;
 const add=(id:ControlId,r:Region,change:Partial<Operation>,exclusions:Region[]=[],feather=Math.min(w*.10,h*.09))=>{if(settings[id])out.push({...r,owner:face.id,control:id,sx:1,sy:1,rotation:0,dx:0,dy:0,feather,exclusions,...change});};
 const eyes=eyeLoops.map(loop=>{const r=region(loop,1.45,2.0);r.ry=Math.max(r.ry,h*.026);return r;});
 const brows=browLoops.map(loop=>region(loop,1.35,1.6));
 const noseProtection=region([168,193,417,6,197,196,419,5,1,4,44,274,98,327,2],1.25,1.10);
 const protectedFeatures=[...eyes,region(lipLoop,1.25,1.6),noseProtection];
 const outline=region(oval,1,1),eyeY=mean(eyeLoops.flat().map(i=>p[i])).y,chinY=p[152].y;
 for(const id of ["faceWidth","lowerFace","cheekbone","chinLength","jawAngle"] as const){
  const contour=oval.map(i=>{const q=p[i],sign=Math.sign(q.x),lower=smooth((q.y-eyeY)/(chinY-eyeY)),chin=smooth((q.y-p[17].y)/(chinY-p[17].y));let dx=0,dy=0;
   if(id==="faceWidth")dx=sign*w*.065*v(id)*(1-smooth((Math.abs(q.y-p[234].y)-h*.25)/(h*.3)));
   if(id==="lowerFace"){dx=-q.x*.075*lower*v(id);dy=-(q.y-eyeY)*.09*lower*v(id);}
   if(id==="cheekbone")dx=sign*w*.05*v(id)*(1-smooth(Math.abs(q.y-p[93].y)/(h*.22)));
   if(id==="chinLength")dy=h*.065*v(id)*chin;
   if(id==="jawAngle"){const band=smooth((q.y-eyeY)/(h*.22))*(1-smooth((q.y-p[172].y)/(h*.18)));dx=sign*w*.038*v(id)*band;dy=h*.012*v(id)*band;}
   const origin=f.world(q),target=f.world({x:q.x+dx,y:q.y+dy});return{point:origin,delta:{x:target.x-origin.x,y:target.y-origin.y}};
  });
  add(id,outline,{contour},protectedFeatures,w*.27);
 }
 eyeLoops.forEach((loop,side)=>{
  const eyeAdd=(id:ControlId,area:Region,change:Partial<Operation>,extra:Region[]=[],feather?:number)=>add(id,area,{...change,pair:{center:mean(eyes.map(e=>e.center)),sign:side===0?-1:1,collar:w*.02}},extra,feather);
  const r=eyes[side],ew=bounds(loop.map(i=>p[i])).width,sign=side===0?-1:1;
  const start=side===0?468:473,irisPoints=[0,1,2,3,4].map(k=>p[start+k]);
  const iris=region([start,start+1,start+2,start+3,start+4],1.2,1.2);iris.box=false;
  // Iris exclusions cover the entire disk and a smooth collar for the sclera.
  iris.rx=iris.ry=Math.max(...irisPoints.map(q=>Math.hypot(q.x-p[start].x,q.y-p[start].y)))*1.35;
  eyeAdd("eyeSize",r,{sx:1+.22*v("eyeSize"),sy:1+.22*v("eyeSize")});
  eyeAdd("eyeHeight",r,{dy:-h*.035*v("eyeHeight")});
  eyeAdd("eyeThickness",r,{sy:1+.30*v("eyeThickness")},[iris]);
  eyeAdd("eyeLength",r,{sx:1+.25*v("eyeLength")},[iris]);
  eyeAdd("eyeSpacing",r,{dx:sign*w*.033*v("eyeSpacing")});
  eyeAdd("eyeAngle",r,{rotation:sign*.16*v("eyeAngle")});
  const inner=side===0?133:362,outer=side===0?33:263,lower=side===0?144:373;
  eyeAdd("eyeInner",at(inner,ew*.13,Math.max(r.ry*.7,h*.022)),{dx:-sign*ew*.13*v("eyeInner")},[iris],ew*.60);
  eyeAdd("eyeOuter",at(outer,ew*.13,Math.max(r.ry*.7,h*.022)),{dx:sign*ew*.14*v("eyeOuter")},[iris],ew*.48);
  eyeAdd("eyeLower",{center:f.world(mean([p[outer],p[lower]])),rx:ew*.24,ry:Math.max(h*.022,r.ry*.65),angle:f.angle},{dy:ew*.10*v("eyeLower")},[iris],ew*.4);
 });
 const mouth=region(lipLoop,1.45,1.65);
 add("lipSize",mouth,{sx:1+.22*v("lipSize"),sy:1+.22*v("lipSize")});
 add("lipWidth",mouth,{sx:1+.25*v("lipWidth")});
 // Nose protection flattened the upper lip in the photo comparison. Retain
 // the previous position envelope, as required by the conditional acceptance.
 add("lipPosition",{...region(lipLoop,2.4,2.8),box:false},{dy:-h*.04*v("lipPosition"),legacyFalloff:true});
 add("lipFullness",region(lipOuterLoop,1,1),{sy:1+.32*v("lipFullness"),lip:{outer:lipOuterLoop.map(i=>f.points[i]),inner:lipInnerLoop.map(i=>f.points[i]),feather:Math.max(1,h*.002)}},[],0);
 const nose=region([168,98,327,2],1.4,1.15);
 add("noseSize",nose,{sx:1+.20*v("noseSize"),sy:1+.20*v("noseSize")},eyes);
 add("noseLength",nose,{sy:1+.20*v("noseLength")},eyes);
 // Scale each alar wing about its own center instead of moving both wings apart.
 for(const ids of [[64,97,98,99,240],[294,326,327,328,460]])
  add("noseAlar",region(ids,1.35,1.5),{sx:1+.23*v("noseAlar"),sy:1+.23*v("noseAlar")},[],w*.035);
 // Split at one anatomical boundary; feather stays inside each vertical band.
 const axis=(p[168].x+p[6].x+p[1].x)/3,split=(p[6].y+p[197].y)/2;
 const band=(top:number,bottom:number,rx:number):Region=>({center:f.world({x:axis,y:(top+bottom)/2}),rx,ry:Math.abs(bottom-top)/2,angle:f.angle,box:true});
 add("noseBridge",band(p[168].y,split,w*.085),{sx:1+.30*v("noseBridge"),verticalClip:true},[],w*.07);
 add("noseDorsum",band(split,p[4].y,w*.079),{sx:1+.30*v("noseDorsum"),verticalClip:true},[],w*.07);
 add("noseTip",region([1,4,44,274,2],1.45,1.3),{sx:1+.23*v("noseTip"),sy:1+.23*v("noseTip")});
 browLoops.forEach((loop,side)=>{
  const browAdd=(id:ControlId,area:Region,change:Partial<Operation>)=>add(id,area,{...change,pair:{center:mean(brows.map(b=>b.center)),sign:side===0?-1:1,collar:w*.02}});
  const r=region(loop,1.35,1.6),sign=side===0?-1:1,b=bounds(loop.map(i=>p[i]));
  browAdd("browHeight",r,{dy:-h*.04*v("browHeight")});
  browAdd("browHeadSpacing",r,{dx:sign*w*.035*v("browHeadSpacing"),head:{inner:side===0?b.x+b.width:b.x,outer:side===0?b.x:b.x+b.width}});
  browAdd("browThickness",r,{sy:1+.40*v("browThickness")});
  browAdd("browSpacing",r,{dx:sign*w*.035*v("browSpacing")});
  browAdd("browAngle",r,{rotation:sign*.18*v("browAngle")});
 });
 return out;
}

// Geometry and protection regions are immutable for a photo. Clone only the
// numeric effect strengths when a slider changes.
const geometryCache=new WeakMap<Face,Map<string,Operation[]>>();
export function operations(face:Face,settings:Settings,width:number,height:number):Operation[]{
 let cache=geometryCache.get(face);if(!cache){cache=new Map();geometryCache.set(face,cache);}
 const key=`${width}:${height}`;let template=cache.get(key);
 if(!template){template=buildOperations(face,Object.fromEntries(controls.map(([id])=>[id,100])) as Settings,width,height);cache.set(key,template);}
 return template.filter(o=>settings[o.control]).map(o=>{const factor=faceEffectAmount(settings[o.control])/100;return{...o,sx:1+(o.sx-1)*factor,sy:1+(o.sy-1)*factor,dx:o.dx*factor,dy:o.dy*factor,rotation:o.rotation*factor,
  contour:o.contour?.map(v=>({point:v.point,delta:{x:v.delta.x*factor,y:v.delta.y*factor}}))};});
}
