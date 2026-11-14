import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture';
import {frame} from './geometry';
import {lipOuterLoop} from './lips';
import {eyeContours} from './eyes';
import {initialState,setControl,type ControlId,type Point} from '../state/model';
import {prepare,mapPoint,buildField,type Field} from '../engine/field';
import {jacobianFloor} from '../engine/limits';

const ids=['noseSize','noseAlar','noseBridge','noseDorsum','noseTip'] as const;
function planFor(face:ReturnType<typeof fixture>,values:Partial<Record<ControlId,number>>,size=1000){
 let state=initialState([face]);for(const [id,v] of Object.entries(values))state=setControl(state,face.id,id as ControlId,v!);
 return prepare([face],state,size,size);
}
function sample(field:Field,p:Point,size:number):Point{
 const gx=p.x/size*(field.columns-1),gy=p.y/size*(field.rows-1),x=Math.floor(gx),y=Math.floor(gy),tx=gx-x,ty=gy-y;
 const shift=[0,1].map(c=>{const at=(x:number,y:number)=>field.data[(y*field.columns+x)*4+c]*size;return(at(x,y)*(1-tx)+at(x+1,y)*tx)*(1-ty)+(at(x,y+1)*(1-tx)+at(x+1,y+1)*tx)*ty;});
 return{x:p.x+shift[0],y:p.y+shift[1]};
}
function destination(p:Point,plan:ReturnType<typeof prepare>){let t={...p};for(let i=0;i<40;i++){const q=mapPoint(t,plan);t={x:t.x+p.x-q.x,y:t.y+p.y-q.y};}return t;}

test('requested nose controls only move horizontally in the face frame',()=>{
 for(const angle of [0,.35])for(const value of [-100,100])for(const id of ids){
  const face=fixture('a',.5,1,angle),f=frame(face,1000,1000),plan=planFor(face,{[id]:value});
  for(let y=f.lm[168].y-20;y<f.lm[2].y+20;y+=4)for(let x=-80;x<=80;x+=4){
   const p={x,y},q=f.local(mapPoint(f.world(p),plan));assert.ok(Math.abs(q.y-p.y)<1e-7,`${id} changed vertical position`);
  }
 }
});

test('alar adjustment moves the lower outer wings most and the nostril edges slightly',async()=>{
 for(const angle of [0,.35])for(const value of [-100,100]){
  const face=fixture('a',.5,1,angle),size=700,f=frame(face,size,size),plan=planFor(face,{noseAlar:value},size),field=await buildField(plan);assert.ok(field);
  for (const [wing, rim, upper, side] of [[64,98,49,-1],[294,327,279,1]]) {
   const move = (id: number) => (f.local(sample(field, f.points[id], size)).x - f.lm[id].x) * side * Math.sign(value);
   const wingMove = move(wing), rimMove = move(rim);
   assert.ok(wingMove > .1, 'lower wing moves in the requested direction');
   assert.ok(rimMove > .01 && rimMove < wingMove / 2, 'nostril edge follows by a smaller amount');
   const upperRatio = move(upper) / wingMove;
   assert.ok(upperRatio > .3 && upperRatio < .7, 'upper sidewall follows by about half');
  }
  for (const id of [1, 2, 4, ...lipOuterLoop]) assert.deepEqual(sample(field, f.points[id], size), f.points[id]);
 }
});

test('bridge/dorsum overlap has no stationary seam or double strength and follows the nose axis',()=>{
 const face=fixture(),f=frame(face,1000,1000),split=(f.lm[6].y+f.lm[197].y)/2;
 for (const sign of [-1, 1]) {
  const bridge = sign * 40, dorsum = sign * 90;
  const upper=planFor(face,{noseBridge:bridge}),lower=planFor(face,{noseDorsum:dorsum}),both=planFor(face,{noseBridge:bridge,noseDorsum:dorsum});
  for(const y of [split-1,split,split+1]){
   const p=f.world({x:10,y}),a=mapPoint(p,upper),b=mapPoint(p,lower),q=mapPoint(p,both);
   assert.ok(Math.abs(a.x-p.x)>.1&&Math.abs(b.x-p.x)>.1,'both bands must contribute through the shared boundary');
   assert.ok(Math.abs(q.x-p.x-(a.x-p.x)-(b.x-p.x))<1e-7,'blend once without sequential scale amplification');
   assert.ok(Math.abs(q.x-p.x-10*(1/(1-.135*sign)-1))<1e-7,'equal width strengths produce a uniform width through the seam');
  }
 }
 const curved=fixture();for(const i of [5,51,281])curved.landmarks[i]={...curved.landmarks[i],x:curved.landmarks[i].x+.008};
 const center=frame(curved,1000,1000).points[5];assert.deepEqual(mapPoint(center,planFor(curved,{noseBridge:100,noseDorsum:100})),center,'the local centerline stays fixed');
});

test('dorsum reaches below the old endpoint and fades before the tip center',()=>{
 const face=fixture(),f=frame(face,1000,1000);
 for(const value of [-100,100]){
  const plan=planFor(face,{noseDorsum:value}),p=f.world({x:12,y:(f.lm[4].y+f.lm[1].y)/2});
  assert.ok(Math.abs(mapPoint(p,plan).x-p.x)>.1,'dorsum must extend toward the upper tip');
  assert.deepEqual(mapPoint(f.points[1],plan),f.points[1]);
 }
});

test('nose controls preserve eyes and lip pixels, connect smoothly and remain safe together',async()=>{
 for(const value of [-100,100]){
  const face=fixture(),size=700,f=frame(face,size,size),values=Object.fromEntries(ids.map(id=>[id,value])),plan=planFor(face,values,size),field=await buildField(plan);assert.ok(field);
  assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
  for(const id of [...lipOuterLoop,...eyeContours.flat()]){assert.deepEqual(mapPoint(f.points[id],plan),f.points[id]);assert.deepEqual(sample(field,f.points[id],size),f.points[id]);}
  const epsilon=.001;
  for(let y=f.lm[168].y;y<f.lm[2].y+15;y+=1)for(let x=-50;x<=50;x+=3){
   const p=f.world({x,y}),q=mapPoint(p,plan),a=mapPoint({x:p.x,y:p.y-epsilon},plan),b=mapPoint({x:p.x,y:p.y+epsilon},plan);
   assert.ok(Math.hypot(a.x+b.x-2*q.x,a.y+b.y-2*q.y)/epsilon<.005,'no derivative jump between nose bands');
  }
 }
});

test('alar motion follows other nose edits and resetting preserves those edits',()=>{
 const face=fixture('a',.5,1,.3),f=frame(face,1000,1000);
 for(const value of [-100,100]){
  const values={noseSize:65,noseLength:65,noseBridge:65,noseDorsum:65,noseTip:65},base=planFor(face,values),combined=planFor(face,{...values,noseAlar:value});
  const alarOnly=planFor(face,{noseAlar:value});
  for(const id of [1,2,4,64,98,294,327]){
   const target=destination(f.points[id],base),source=mapPoint(target,base);
   const expected=mapPoint(source,alarOnly),actual=mapPoint(target,combined);
   assert.ok(Math.hypot(actual.x-expected.x,actual.y-expected.y)<1e-6,'apply alar motion at the source nose');
  }
  const reset=planFor(face,{...values,noseAlar:0});
  for(const p of f.points)assert.deepEqual(mapPoint(p,reset),mapPoint(p,base));
 }
});
