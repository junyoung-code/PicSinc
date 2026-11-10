import { lipOuterLoop, lipInnerLoop, type LipShape, type LipPosition } from "./lips";
import {contourLengths,roundedContour,type SoftContour,type LowerFace} from './face-shape';
import {eyeContours,irisCircle,type EyeArea} from './eyes';
import {nostrilContours,type NoseBand,type NoseProtection} from './nose';
import { bounds, browLoops, eyeLoops, frame, lipLoop, mean, oval, smooth } from "./geometry";
import {controls, controlDefinitions, faceEffectAmount, type ControlId, type Face, type Point, type Settings} from "../state/model";
export type Region = { center: Point; rx: number; ry: number; angle: number; box?: boolean };
export type Operation = Region & { owner: string; control: ControlId; sx: number; sy: number; rotation: number; dx: number; dy: number; exclusions: Region[]; feather: number; lip?:LipShape; lipPosition?:LipPosition; eye?:EyeArea; nose?:NoseProtection; noseBand?:NoseBand; contour?: {point:Point;delta:Point}[]; softContour?:SoftContour; lowerFace?:LowerFace; head?:{inner:number;outer:number}; pair?:{center:Point;sign:number;collar:number} };
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
 const outline=region(oval,1,1),chinY=p[152].y;
 // Only face-shape controls use this wider outer-eye/makeup protection. Eye
 // controls keep their original geometry and strengths.
 const shapeEyes=eyeLoops.map((loop,side)=>{
  const b=bounds(loop.map(i=>p[i])),sign=side===0?-1:1;
  return{center:f.world({x:b.x+b.width/2+sign*b.width*.10,y:b.y+b.height/2}),rx:b.width*.80+w*.012,ry:Math.max(b.height*1.3,h*.032)+w*.012,angle:f.angle,box:true};
 });
 const shapeProtection=[...shapeEyes,region(lipLoop,1.25,1.6),noseProtection];
 const contourPoints=oval.map(i=>p[i]),lengths=contourLengths(contourPoints),rounded=roundedContour(contourPoints,w*.38);
 for(const id of ["faceWidth","lowerFace","cheekbone","chinLength","jawAngle"] as const){
  if(id==='lowerFace'){
   const mouth=bounds(lipOuterLoop.map(i=>p[i])),nose=p[2].y,outlineBounds=bounds(contourPoints),offsetY=outlineBounds.y+outlineBounds.height/2;
   const mouthCenter=mouth.y+mouth.height/2;
   // Keep a small collar around the lips rigid, including grid interpolation.
   const mouthTop=Math.max(nose+(mouth.y-nose)*.65,mouth.y-w*.012);
   add(id,outline,{lowerFace:{nose:nose-offsetY,chin:chinY-offsetY,mouthTop:mouthTop-offsetY,mouthBottom:mouth.y+mouth.height+w*.012-offsetY,mouthCenter:mouthCenter-offsetY,amount:.16*v(id)}},[],w*.27);
   continue;
  }
  const contour=oval.map(i=>{const q=p[i],sign=Math.sign(q.x),chin=smooth((q.y-p[17].y)/(chinY-p[17].y));let dx=0,dy=0;
   if(id==="faceWidth")dx=q.x*.13*v(id)*(1-smooth((Math.abs(q.y-p[234].y)-h*.25)/(h*.3)));
   if(id==="cheekbone")dx=sign*w*.05*v(id)*(1-smooth(Math.abs(q.y-p[93].y)/(h*.22)));
   if(id==="chinLength")dy=h*.065*v(id)*chin;
   if(id==="jawAngle"){
    const cheek=p[sign<0?93:323].y,jaw=p[sign<0?172:397].y;
    const band=smooth((q.y-cheek)/Math.max(h*.05,jaw-cheek))*(1-smooth((q.y-jaw)/Math.max(h*.05,chinY-jaw)));
    const target=rounded[oval.indexOf(i)],x=q.x-target.x,y=q.y-target.y;
    const limit=Math.min(1,w*.06/Math.max(1e-6,Math.hypot(x,y)));
    dx=x*band*v(id)*limit;dy=y*band*v(id)*limit;
   }
   const origin=f.world(q),target=f.world({x:q.x+dx,y:q.y+dy});return{point:origin,delta:{x:target.x-origin.x,y:target.y-origin.y}};
  });
  if(id==='faceWidth'||id==='jawAngle'){
   const exclusions=id==='jawAngle'?[...shapeProtection,at(152,w*.10,h*.04)]:shapeProtection;
   add(id,outline,{softContour:{samples:contour.map((sample,i)=>({...sample,length:lengths[i]})),radius:w*.30}},exclusions,w*.30);
  }else add(id,outline,{contour},protectedFeatures,w*.27);
 }
 eyeLoops.forEach((loop,side)=>{
  const eyeAdd=(id:ControlId,area:Region,change:Partial<Operation>,extra:Region[]=[],feather?:number)=>add(id,area,{...change,pair:{center:mean(eyes.map(e=>e.center)),sign:side===0?-1:1,collar:w*.02}},extra,feather);
  const r=eyes[side],ew=bounds(loop.map(i=>p[i])).width,sign=side===0?-1:1;
  const start=side===0?468:473,irisPoints=[0,1,2,3,4].map(k=>p[start+k]);
  const iris=region([start,start+1,start+2,start+3,start+4],1.2,1.2);iris.box=false;
  // Iris exclusions cover the entire disk and a smooth collar for the sclera.
  iris.rx=iris.ry=Math.max(...irisPoints.map(q=>Math.hypot(q.x-p[start].x,q.y-p[start].y)))*1.35;
  const outer=side===0?33:263;
  const guardedIris=irisCircle(f.points,side),outline=eyeContours[side].map(i=>f.points[i]);
  const eyelid=(ids:number[],factors:number[],dx:number,dy:number,radius:number):SoftContour=>{
   const points=ids.map(i=>f.points[i]),lengths=contourLengths(points);
   return{radius:Math.max(1,radius),samples:points.map((point,i)=>({point,length:lengths[i],delta:{x:(dx*Math.cos(f.angle)-dy*Math.sin(f.angle))*factors[i],y:(dx*Math.sin(f.angle)+dy*Math.cos(f.angle))*factors[i]}}))};
  };
  // Openings act in the original eye frame before whole-eye transforms. During
  // inverse mapping those transforms are undone first, so the iris mask follows
  // height/size/spacing/angle without a second detection or new state format.
  eyeAdd('eyeInner',r,{softContour:eyelid(side===0?[158,133,153]:[385,362,380],[.65,1,.65],-sign*ew*.13*v('eyeInner'),0,ew*.70),eye:{padding:0,feather:ew*.3,iris:guardedIris}},[],ew*.70);
  const a=p[side===0?33:362],b=p[side===0?133:263],length=Math.max(1e-6,Math.hypot(b.x-a.x,b.y-a.y)),nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length;
  const normal={x:nx*Math.cos(f.angle)-ny*Math.sin(f.angle),y:nx*Math.sin(f.angle)+ny*Math.cos(f.angle)};
  eyeAdd('eyeLower',r,{softContour:eyelid(side===0?[33,144,153]:[263,373,380],[.2,1,.35],0,ew*.10*v('eyeLower'),ew*.40),eye:{padding:0,feather:ew*.3,iris:guardedIris,lower:{point:f.world(a),normal,fade:Math.max(2,bounds(eyeContours[side].map(i=>p[i])).height*.35)}}},[],ew*.40);
  eyeAdd("eyeSize",r,{sx:1+.22*v("eyeSize"),sy:1+.22*v("eyeSize")});
  eyeAdd("eyeHeight",{...r,rx:r.rx+ew*.26,ry:r.ry+ew*.26},{dy:-h*.035*v("eyeHeight"),eye:{outline,padding:ew*.26,feather:ew*.35}},[],ew*.35);
  eyeAdd("eyeThickness",r,{sy:1+.30*v("eyeThickness")},[iris]);
  eyeAdd("eyeLength",r,{sx:1+.25*v("eyeLength")},[iris]);
  eyeAdd("eyeSpacing",r,{dx:sign*w*.033*v("eyeSpacing")});
  eyeAdd("eyeAngle",r,{rotation:sign*.16*v("eyeAngle")});
  eyeAdd("eyeOuter",at(outer,ew*.13,Math.max(r.ry*.7,h*.022)),{dx:sign*ew*.14*v("eyeOuter")},[iris],ew*.48);
 });
 const mouth=region(lipLoop,1.45,1.65);
 add("lipSize",mouth,{sx:1+.22*v("lipSize"),sy:1+.22*v("lipSize")});
 add("lipWidth",mouth,{sx:1+.25*v("lipWidth")});
 const position=region(lipOuterLoop,1,1),mouthCenter=f.local(position.center),feather=w*.12;
 // The lowest nose/nostril landmark defines the fixed edge of the philtrum.
 const noseBottom=Math.max(...[2,1,4,44,274,64,97,98,99,240,294,326,327,328,460].map(i=>p[i].y));
 // Retain the broad sampling bounds; the dedicated falloff also covers grid padding.
 add("lipPosition",region(lipOuterLoop,2.4,2.8),{dy:-h*.04*v("lipPosition"),lipPosition:{nose:noseBottom-mouthCenter.y,rx:position.rx,ry:position.ry,feather}},[],feather);
 add("lipFullness",region(lipOuterLoop,1,1),{sy:1+.32*v("lipFullness"),lip:{outer:lipOuterLoop.map(i=>f.points[i]),inner:lipInnerLoop.map(i=>f.points[i]),feather:Math.max(1,h*.002)}},[],0);
 const nose=region([168,98,327,2],1.4,1.15);
 const lipTop=Math.min(...lipOuterLoop.map(i=>p[i].y));
 const noseGuard=(r:Region,protectNostrils=false):NoseProtection=>{
  const offset=f.local(r.center);
  const fixed=[...eyeContours,...(protectNostrils?nostrilContours:[])];
  return{lipTop:lipTop-offset.y,feather:w*(protectNostrils ? .025 : .04),fixed:fixed.map(loop=>loop.map(i=>({x:p[i].x-offset.x,y:p[i].y-offset.y})))};
 };
 // Alar motion precedes whole-nose transforms, so its nostril protection also
 // follows size/length/tip edits without moving the holes a second time.
 [[49,48,64,98],[279,278,294,327]].forEach((ids,side)=>{
  const r=region(ids,1.35,1.5);
  add('noseAlar',r,{dx:(side===0?-1:1)*w*.035*v('noseAlar'),nose:noseGuard(r,true)},[],w*.06);
 });
 add("noseSize",nose,{sx:1+.20*v("noseSize"),nose:noseGuard(nose)},eyes);
 add("noseLength",nose,{sy:1+.20*v("noseLength")},eyes);
 const band=region([168,193,417,196,419,5,4,1,44,274],2,1.25),offset=f.local(band.center);
 const rows=[[168,193,417],[6,196,419],[197,196,419],[195,3,248],[5,51,281],[4,45,275],[1,44,274]].map(([center,left,right])=>({x:p[center].x-offset.x,y:p[center].y-offset.y,rx:Math.max(w*.018,Math.abs(p[left].x-p[center].x),Math.abs(p[right].x-p[center].x))})).sort((a,b)=>a.y-b.y);
 const bottom=p[4].y+(p[1].y-p[4].y)*.85-offset.y;
 for(const [id,part] of [['noseBridge','bridge'],['noseDorsum','dorsum']] as const)
  add(id,band,{sx:1+.30*v(id),nose:noseGuard(band),noseBand:{rows,part,split:(p[6].y+p[197].y)/2-offset.y,blend:w*.04,bottom,topFade:w*.035,bottomFade:Math.max(1,bottom-(p[4].y-offset.y)),feather:w*.07}},[],w*.10);
 const tip=region([1,4,44,274,2],1.45,1.3);
 add("noseTip",tip,{sx:1+.23*v("noseTip"),nose:noseGuard(tip)});
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
  contour:o.contour?.map(v=>({point:v.point,delta:{x:v.delta.x*factor,y:v.delta.y*factor}})),
  softContour:o.softContour?{...o.softContour,samples:o.softContour.samples.map(v=>({...v,delta:{x:v.delta.x*factor,y:v.delta.y*factor}}))}:undefined,
  lowerFace:o.lowerFace?{...o.lowerFace,amount:o.lowerFace.amount*factor}:undefined};});
}
