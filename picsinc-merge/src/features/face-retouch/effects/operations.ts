import { lipOuterLoop, lipFullnessShape, lipFullnessAmount, type LipFullness, type LipPosition } from "./lips";
import {contourLengths,jawCornerOffsets,type SoftContour,type LowerFace} from './face-shape';
import {eyeContours,irisCircle,type EyeArea,type EyeHeightArea,type EyeThickness} from './eyes';
import {nostrilContours,type NoseBand,type NoseLength,type NoseProtection} from './nose';
import { bounds, browLoops, eyeLoops, frame, lipLoop, mean, oval, smooth } from "./geometry";
import {controls, controlDefinitions, faceEffectAmount, type ControlId, type Face, type Point, type Settings} from "../state/model";
export type Region = { center: Point; rx: number; ry: number; angle: number; box?: boolean };
export type Operation = Region & { owner: string; control: ControlId; sx: number; sy: number; rotation: number; dx: number; dy: number; exclusions: Region[]; protectedRegions?: Region[]; feather: number; lipScaleOutline?:Point[]; lipFullness?:LipFullness & {amount:number}; lipPosition?:LipPosition; eye?:EyeArea; eyeHeight?:EyeHeightArea; eyeThickness?:EyeThickness & {brow:Region}; nose?:NoseProtection; noseLength?:NoseLength; noseBand?:NoseBand; contour?: {point:Point;delta:Point}[]; softContour?:SoftContour; lowerFace?:LowerFace; head?:{inner:number;outer:number}; pair?:{center:Point;sign:number;collar:number} };
// Core regions include makeup. Only the surrounding collar fades the transform.
function buildOperations(face: Face, settings: Settings, width: number, height: number): Operation[] {
 const f=frame(face,width,height),p=f.lm,w=f.width,h=f.height,out:Operation[]=[];
 const featureFeather=w*.035;
 const region=(ids:number[],paddingX=1.4,paddingY=1.7):Region=>{const b=bounds(ids.map(i=>p[i]));return {center:f.world({x:b.x+b.width/2,y:b.y+b.height/2}),rx:Math.max(w*.018,b.width*paddingX/2),ry:Math.max(h*.015,b.height*paddingY/2),angle:f.angle,box:true};};
 const at=(i:number,rx:number,ry:number):Region=>({center:f.world(p[i]),rx,ry,angle:f.angle});
 const v=(id:ControlId)=>settings[id]/100*controlDefinitions[id].direction;
 const add=(id:ControlId,r:Region,change:Partial<Operation>,exclusions:Region[]=[],feather=Math.min(w*.10,h*.09))=>{if(settings[id])out.push({...r,owner:face.id,control:id,sx:1,sy:1,rotation:0,dx:0,dy:0,feather,exclusions,...change});};
 const eyes=eyeLoops.map(loop=>{const r=region(loop,1.45,2.0);r.ry=Math.max(r.ry,h*.026);return r;});
 const brows=browLoops.map(loop=>region(loop,1.35,1.6));
 const browProtection=browLoops.map(loop=>region(loop,1,1));
 const noseProtection=region([168,193,417,6,197,196,419,5,1,4,44,274,98,327,2],1.25,1.10);
 const lipNoseProtection=region([168,193,417,49,279,48,278,64,294,98,327,240,460,2],1,1);
 const protectedFeatures=[...eyes,region(lipLoop,1.25,1.6),noseProtection];
 const outline=region(oval,1,1),chinY=p[152].y;
 // Only face-shape controls use this wider outer-eye/makeup protection. Eye
 // controls keep their original geometry and strengths.
 const shapeEyes=eyeLoops.map((loop,side)=>{
  const b=bounds(loop.map(i=>p[i])),sign=side===0?-1:1;
  return{center:f.world({x:b.x+b.width/2+sign*b.width*.10,y:b.y+b.height/2}),rx:b.width*.80+w*.012,ry:Math.max(b.height*1.3,h*.032)+w*.012,angle:f.angle,box:true};
 });
 const shapeProtection=[...shapeEyes,region(lipLoop,1.25,1.6),noseProtection];
 const contourPoints=oval.map(i=>p[i]),lengths=contourLengths(contourPoints),jawOffsets=jawCornerOffsets(p,w);
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
    const offset=jawOffsets.get(i);
    dx=offset?.x??0;dy=offset?.y??0;
   }
   const origin=f.world(q),target=f.world({x:q.x+dx,y:q.y+dy});return{point:origin,delta:{x:target.x-origin.x,y:target.y-origin.y}};
  });
  if(id==='faceWidth'||id==='jawAngle'){
   const exclusions=id==='jawAngle'?[...shapeProtection,at(152,w*.31,h*.105)]:shapeProtection;
   const radius=w*(id==='jawAngle'?.24:.30);
   add(id,outline,{
    softContour:{samples:contour.map((sample,i)=>({...sample,length:lengths[i]})),radius},
    protectedRegions:id==='faceWidth'?browProtection:undefined,
   },exclusions,radius);
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
  const left=f.world(a),right=f.world(b),eyeCenter=mean([left,right]);
  const eyeAngle=Math.atan2(right.y-left.y,right.x-left.x);
  const eyeVertical=outline.map(point=>(point.y-eyeCenter.y)*Math.cos(eyeAngle)-(point.x-eyeCenter.x)*Math.sin(eyeAngle));
  const eyeTop=Math.min(...eyeVertical),eyeBottom=Math.max(...eyeVertical);
  const upperLid=Math.max(1,-eyeTop),lowerLid=Math.max(1,eyeBottom);
  const thickness={
   halfWidth:Math.max(1,length*.78),
   upper:{lid:upperLid,follow:length*.14,outer:upperLid+length*.24},
   lower:{lid:lowerLid,follow:length*.17,outer:lowerLid+length*.30},
   brow:region(browLoops[side],1.15,1.15),
  };
  const thicknessRegion={center:eyeCenter,angle:eyeAngle,rx:thickness.halfWidth,ry:Math.max(thickness.upper.outer,thickness.lower.outer)};
  eyeAdd("eyeThickness",thicknessRegion,{sy:1+.72*v("eyeThickness"),eyeThickness:thickness},[],0);
  const eye=region(loop,1.15,1.25);
  eyeAdd("eyeSize",eye,{sx:1+.22*v("eyeSize"),sy:1+.22*v("eyeSize")},[],featureFeather);
  const heightBounds=bounds(eyeContours[side].map(i=>p[i]));
  const heightWidth=Math.max(1,heightBounds.width),halfHeight=heightBounds.height/2;
  const heightCenter={x:heightBounds.x+heightBounds.width/2,y:heightBounds.y+halfHeight};
  const outerCorner={x:p[outer].x-heightCenter.x,y:p[outer].y-heightCenter.y};
  const wingLength=heightWidth*.60;
  const heightRegion={center:f.world(heightCenter),angle:f.angle,rx:Math.max(heightWidth,outerCorner.x*sign+wingLength),ry:halfHeight+heightWidth*.54};
  eyeAdd("eyeHeight",heightRegion,{
   dy:-h*.0525*v("eyeHeight"),eyeHeight:{width:heightWidth,halfHeight,outerSign:sign,outerCorner,wingLength},protectedRegions:browProtection,
  },[],0);
  eyeAdd("eyeLength",eye,{sx:1+.25*v("eyeLength")},[iris],featureFeather);
  eyeAdd("eyeSpacing",eye,{dx:sign*w*.033*v("eyeSpacing")},[],featureFeather);
  eyeAdd("eyeAngle",eye,{rotation:sign*.16*v("eyeAngle")},[],featureFeather);
  eyeAdd("eyeOuter",at(outer,ew*.13,Math.max(r.ry*.7,h*.022)),{dx:sign*ew*.14*v("eyeOuter")},[iris],ew*.48);
 });
 const position=region(lipOuterLoop,1,1),mouthCenter=f.local(position.center),feather=w*.12;
 const lipScale={
  lipScaleOutline:lipOuterLoop.map(i=>({x:p[i].x-mouthCenter.x,y:p[i].y-mouthCenter.y})),
  protectedRegions:[
   lipNoseProtection,
   region([172,136,150,149],1,1),
   region([149,176,148,152,377,400,378],1,1),
   region([378,379,365,397],1,1),
  ],
 };
 const lipScaleFeather=w*.09;
 const lipSizeScale=.176*v("lipSize");
 add("lipSize",position,{...lipScale,sx:1+lipSizeScale,sy:1+lipSizeScale},[],lipScaleFeather);
 add("lipWidth",position,{...lipScale,sx:1+.20*v("lipWidth")},[],lipScaleFeather);
 // The lowest nose/nostril landmark defines the fixed edge of the philtrum.
 const noseBottom=Math.max(...[2,1,4,44,274,64,97,98,99,240,294,326,327,328,460].map(i=>p[i].y));
 // Retain the broad sampling bounds; the dedicated falloff also covers grid padding.
 add("lipPosition",region(lipOuterLoop,2.4,2.8),{dy:-h*.032*v("lipPosition"),lipPosition:{nose:noseBottom-mouthCenter.y,rx:position.rx,ry:position.ry,feather}},[],feather);
 const fullnessFeather=w*.045;
 add("lipFullness",position,{
  lipFullness:{...lipFullnessShape(p,mouthCenter,noseBottom,fullnessFeather),amount:0},
 },[],fullnessFeather);
 const nosePoints=[168,98,327,2];
 const lipTop=Math.min(...lipOuterLoop.map(i=>p[i].y));
 const noseGuard=(r:Region):NoseProtection=>{
  const offset=f.local(r.center);
  return{lipTop:lipTop-offset.y,feather:w*.04,fixed:eyeContours.map(loop=>loop.map(i=>({x:p[i].x-offset.x,y:p[i].y-offset.y})))};
 };
 [[49, 64, 98, 99], [279, 294, 327, 328]].forEach(([upper, ...ids], index) => {
  const lower = region(ids, 1.1, 1.15);
  const center = f.local(lower.center);
  // Put the upper sidewall halfway through the fade above the lower wing.
  const upperFade = 2 * Math.max(w * .02, center.y - lower.ry - p[upper].y);
  const r = {
   ...lower,
   center: f.world({ x: center.x, y: center.y - upperFade / 2 }),
   ry: lower.ry + upperFade / 2,
  };
  const side = index === 0 ? -1 : 1;
  const outward = (id: number) => side * (p[id].x - center.x);
  const nostril = nostrilContours[index].map(outward);
  const tipEdge = Math.max(outward(1), outward(2), outward(4));
  const inner = Math.max(Math.min(...nostril), tipEdge + w * .01);
  const rim = Math.max(inner, ...nostril);
  const wing = Math.max(outward(ids[0]), rim + w * .015, rim + 1);
  const nose = { ...noseGuard(r), feather: w * .025, alar: { side, inner, rim, wing, top: -r.ry, upperFade } };
  add('noseAlar', r, { dx: side * w * .028 * v('noseAlar'), nose }, [], featureFeather);
 });
 const noseSize=region(nosePoints,1.25,1.05);
 add("noseSize",noseSize,{sx:1+.20*v("noseSize"),nose:noseGuard(noseSize)},eyes,featureFeather);
 const tipBounds = bounds([1, 2, 4, ...nostrilContours.flat()].map(id => p[id]));
 const rootY = Math.max(p[168].y, p[193].y, p[417].y);
 const lengthCenterY = (rootY + lipTop) / 2;
 const lengthRegion: Region = {
  center: f.world({ x: tipBounds.x + tipBounds.width / 2, y: lengthCenterY }),
  rx: Math.max(w * .018, tipBounds.width * .65),
  ry: Math.max(h * .015, (lipTop - rootY) / 2),
  angle: f.angle,
  box: true,
 };
 const tipBottom = tipBounds.y + tipBounds.height;
 add("noseLength", lengthRegion, {
  dy: -.20 * Math.max(0, tipBottom - p[168].y) * v("noseLength"),
  noseLength: {
   root: rootY - lengthCenterY,
   tipTop: tipBounds.y - lengthCenterY,
   tipBottom: tipBottom - lengthCenterY,
   lipTop: lipTop - lengthCenterY,
  },
 }, eyes, featureFeather);
 const band=region([168,193,417,196,419,5,4,1,44,274],2,1.25),offset=f.local(band.center);
 const rows=[[168,193,417],[6,196,419],[197,196,419],[195,3,248],[5,51,281],[4,45,275],[1,44,274]].map(([center,left,right])=>({x:p[center].x-offset.x,y:p[center].y-offset.y,rx:Math.max(w*.018,Math.abs(p[left].x-p[center].x),Math.abs(p[right].x-p[center].x))})).sort((a,b)=>a.y-b.y);
 const bottom=p[4].y+(p[1].y-p[4].y)*.85-offset.y;
 for (const [id, part, widthStrength] of [['noseBridge', 'bridge', 1.35], ['noseDorsum', 'dorsum', .60]] as const)
  add(id,band,{sx:1+widthStrength*v(id),nose:noseGuard(band),noseBand:{rows,part,split:(p[6].y+p[197].y)/2-offset.y,blend:w*.04,bottom,topFade:w*.035,bottomFade:Math.max(1,bottom-(p[4].y-offset.y)),feather:w*.07}},[],w*.10);
 const tip=region([1,4,44,274,2],1.45,1.3);
 add("noseTip",tip,{sx:1+.23*v("noseTip"),nose:noseGuard(tip)});
 browLoops.forEach((loop,side)=>{
  const browAdd=(id:ControlId,area:Region,change:Partial<Operation>)=>add(id,area,{...change,pair:{center:mean(brows.map(b=>b.center)),sign:side===0?-1:1,collar:w*.02}},[],featureFeather);
  const r=region(loop,1.15,1.25),sign=side===0?-1:1,b=bounds(loop.map(i=>p[i]));
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
 return template.filter(o=>settings[o.control]).map(o=>{
  const value=settings[o.control];
  const factor=o.control==='jawAngle'
   ?Math.sign(value)*Math.pow(Math.abs(value)/100,1.8)*(value<0?.75:1)
   :faceEffectAmount(value)/100;
  const verticalFactor=o.eyeThickness&&factor>0?factor*1.5:factor;
  return{...o,sx:1+(o.sx-1)*factor,sy:1+(o.sy-1)*verticalFactor,dx:o.dx*factor,dy:o.dy*factor,rotation:o.rotation*factor,
  lipFullness:o.lipFullness?{...o.lipFullness,amount:lipFullnessAmount(factor)}:undefined,
  contour:o.contour?.map(v=>({point:v.point,delta:{x:v.delta.x*factor,y:v.delta.y*factor}})),
  softContour:o.softContour?{...o.softContour,samples:o.softContour.samples.map(v=>({...v,delta:{x:v.delta.x*factor,y:v.delta.y*factor}}))}:undefined,
  lowerFace:o.lowerFace?{...o.lowerFace,amount:o.lowerFace.amount*factor}:undefined};});
}
