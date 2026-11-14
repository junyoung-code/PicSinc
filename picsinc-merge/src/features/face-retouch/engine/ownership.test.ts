import {test} from "node:test";
import assert from "node:assert/strict";
import {fixture} from "../effects/fixture";
import {bounds,browLoops,frame,insidePolygon} from "../effects/geometry";
import {lipOuterLoop} from "../effects/lips";
import {controls,initialState,setControl,type Point} from "../state/model";
import {buildField,faceArea,mapPoint,prepare,regionDistance,type Field} from "./field";

// Same four-vertex interpolation as renderer.ts, expressed in image pixels.
function sample(field:Field,p:Point,width:number,height:number):Point {
 const x=p.x/width*(field.columns-1),y=p.y/height*(field.rows-1);
 const left=Math.min(field.columns-2,Math.floor(x)),top=Math.min(field.rows-2,Math.floor(y));
 const fx=x-left,fy=y-top;let dx=0,dy=0;
 for(const [ox,oy,weight] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){
  const i=((top+oy)*field.columns+left+ox)*4;dx+=field.data[i]*width*weight;dy+=field.data[i+1]*height*weight;
 }
 return{x:p.x+dx,y:p.y+dy};
}

const noseOutline=[168,193,196,49,48,64,98,240,2,460,327,294,278,279,419,417];
const featureLocks=[
 {control:"noseLength",loops:[lipOuterLoop],target:2},
 {control:"lipSize",loops:[noseOutline],target:0},
 {control:"lipWidth",loops:[noseOutline],target:61},
 {control:"eyeHeight",loops:browLoops,target:468},
 {control:"faceWidth",loops:browLoops,target:234},
] as const;

for(const {control,loops,target} of featureLocks)test(`${control} protects the neighboring feature after grid interpolation`,async()=>{
 const size=1000;
 for(const [scale,angle] of [[1,0],[.55,.3]])for(const value of [-100,100]){
  const face=fixture("a",.5,scale,angle),f=frame(face,size,size);
  const plan=prepare([face],setControl(initialState([face]),face.id,control,value),size,size);
  const field=await buildField(plan);assert.ok(field);
  assert.notDeepEqual(sample(field,f.points[target],size,size),f.points[target],"the selected feature still moves");
  for(const loop of loops){
   const polygon=loop.map(id=>f.points[id]),b=bounds(polygon);
   const check=(p:Point)=>assert.deepEqual(sample(field,p,size,size),p,`${control} moved a protected point at ${value}`);
   for(const p of polygon)check(p);
   for(let y=Math.floor(b.y)+.5;y<b.y+b.height;y+=1)for(let x=Math.floor(b.x)+.5;x<b.x+b.width;x+=1){
    const p={x,y};
    if(insidePolygon(p,polygon))check(p);
   }
  }
 }
});

test("eye height feathers the eyeliner wing and translates the nearby skin patch without scaling",async()=>{
 const size=1000,face=fixture("a",.5,1,.2),f=frame(face,size,size);
 for(const value of [-100,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,"eyeHeight",value),size,size);
  const field=await buildField(plan);assert.ok(field);
  for(const [side,op] of plan.operations.entries()){
   const area=op.eyeHeight!;
   const center=f.local(op.center);
   const at=(outward:number,y:number)=>f.world({x:center.x+outward*area.width*area.outerSign,y:center.y+y});
   const movement=(p:Point)=>{
    const q=sample(field,p,size,size);
    return Math.hypot(q.x-p.x,q.y-p.y);
   };
   const eyeShift=op.dy*(field.strengths?.[`${op.owner}:${op.control}`]??1);
   const corner=f.lm[side===0?33:263];
   const alongWing=(outward:number)=>f.world({x:corner.x+outward*area.width*area.outerSign,y:corner.y});
   const base=movement(f.world({x:corner.x,y:corner.y+eyeShift}));
   const start=movement(alongWing(.10)),middle=movement(alongWing(.24)),tip=movement(alongWing(.40));
   assert.ok(base>Math.abs(eyeShift)*.97,'the outer corner follows the eyelid');
   assert.ok(base>start&&start>middle&&middle>tip,'the eyeliner tapers from the outer corner to the tip');
   assert.ok(tip>base*.20&&tip<base*.30,'the estimated tip still follows the eye slightly');
   assert.ok(movement(alongWing(.57))<base*.02,'movement fades back to zero beyond the wing');

   const dy=eyeShift*.60;
   const patchY=area.halfHeight+area.width*.26;
   for(const offset of [-3,0,3]){
    const source=at(.52,patchY+offset),target=at(.52,patchY+offset+dy);
    const mapped=sample(field,target,size,size);
    assert.ok(Math.hypot(mapped.x-source.x,mapped.y-source.y)<.001);
   }
  }
 }
});

for(const center of [.66,.82])test(`final settings are independent of slider history, neighbor at ${center}`,async()=>{
 const faces=[fixture("a",.4,.8),fixture("b",center,.8)],base=initialState(faces);
 const first=setControl(setControl(setControl(base,"a","faceWidth",20),"b","eyeSize",10),"a","faceWidth",30);
 const second=setControl(setControl(setControl(base,"b","eyeSize",60),"a","faceWidth",30),"b","eyeSize",10);
 assert.deepEqual(first.settings,second.settings);assert.equal(first.settings.b.eyeSize,10);
 const a=await buildField(prepare(faces,first,480,480)),b=await buildField(prepare(faces,second,480,480));
 assert.ok(a&&b);assert.deepEqual(a.data,b.data);
 const onlyB=prepare(faces,setControl(base,"b","eyeSize",10),480,480),both=prepare(faces,first,480,480);
 let changed=0;
 for(const lm of faces[1].landmarks){const p={x:lm.x*480,y:lm.y*480},q=mapPoint(p,onlyB);assert.deepEqual(mapPoint(p,both),q);if(Math.hypot(q.x-p.x,q.y-p.y)>1e-6)changed++;}
 assert.ok(changed>0,"B's own nonneutral edit must survive A's edit");
});

for(const mode of ["shape","touch","combination"] as const)for(const [size,angle,scale] of [[480,0,.8],[713,.37,.8],[480,-.25,.22]])test(`${mode}: interpolated field protects the full neighbor ellipse (${size}, ${angle}, ${scale})`,async()=>{
 const a=fixture("a",.4,.8),b=fixture("b",.66,scale,angle),area=faceArea(b,size,size);
 let state=setControl(initialState([a]),"a","faceWidth",mode==="shape"?100:0);
 if(mode==="combination")for(const [id] of controls)state=setControl(state,"a",id,100);
 if(mode==="touch")state={...state,strokes:[{owner:"a",from:{x:size*.42,y:size*.45},to:{x:size*.36,y:size*.45},radius:size*.15,strength:.75}]};
 const plan=prepare([a,b],state,size,size),field=await buildField(plan);
 assert.ok(field);let moved=0,maxLeak=0;
 for(let n=0;n<1440;n++){
  const theta=n/1440*Math.PI*2,dx=Math.cos(theta)*area.rx*(1-1e-8),dy=Math.sin(theta)*area.ry*(1-1e-8);
  const p={x:area.center.x+dx*Math.cos(area.angle)-dy*Math.sin(area.angle),y:area.center.y+dx*Math.sin(area.angle)+dy*Math.cos(area.angle)};
  assert.deepEqual(mapPoint(p,plan),p,"direct coordinate map is already protected");
  const q=sample(field,p,size,size);maxLeak=Math.max(maxLeak,Math.hypot(q.x-p.x,q.y-p.y));
 }
 for(let i=0;i<field.data.length;i+=4)if(field.data[i]||field.data[i+1])moved++;
 assert.ok(moved>0,"A's edit must still work");assert.ok(maxLeak<1e-9,`interpolation leaked ${maxLeak} pixels into B`);
 // A changed output outside the protected ellipse must not borrow B's
 // source texels, including the four taps used by GL.LINEAR.
 for(let y=0;y<size;y+=2)for(let x=0;x<size;x+=2){
  const p={x:x+.5,y:y+.5};if(regionDistance(p,area)<=1)continue;
  const q=sample(field,p,size,size);if(Math.hypot(q.x-p.x,q.y-p.y)<1e-9)continue;
  const left=Math.floor(q.x-.5),top=Math.floor(q.y-.5);
  for(const ox of [0,1])for(const oy of [0,1])assert.ok(regionDistance({x:left+ox+.5,y:top+oy+.5},area)>1,"changed output samples a neighbor source pixel");
 }
});
