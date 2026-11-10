import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture';
import {frame} from './geometry';
import {lipInnerLoop,lipOuterLoop} from './lips';
import {initialState,setControl,type Point} from '../state/model';
import {buildField,mapPoint,prepare,type Field} from '../engine/field';
import {jacobianFloor} from '../engine/limits';

function destination(p:Point,plan:ReturnType<typeof prepare>):Point{
 let t={...p};for(let i=0;i<40;i++){const q=mapPoint(t,plan);t={x:t.x+p.x-q.x,y:t.y+p.y-q.y};}return t;
}
function source(field:Field,p:Point,size:number):Point{
 const gx=p.x/size*(field.columns-1),gy=p.y/size*(field.rows-1),x=Math.floor(gx),y=Math.floor(gy),tx=gx-x,ty=gy-y;
 const values=[0,1].map(channel=>{
  const at=(a:number,b:number)=>field.data[(b*field.columns+a)*4+channel]*size;
  return (at(x,y)*(1-tx)+at(x+1,y)*tx)*(1-ty)+(at(x,y+1)*(1-tx)+at(x+1,y+1)*tx)*ty;
 });return {x:p.x+values[0],y:p.y+values[1]};
}
const noseIds=[168,6,197,5,1,4,44,274,2,64,97,98,99,240,294,326,327,328,460];

test('lip position translates the whole mouth rigidly through the rendered grid at both extremes and tilts',async()=>{
 for(const size of [600,1000])for(const angle of [0,.35])for(const value of [-100,100]){
  const face=fixture('a',.5,1,angle),f=frame(face,size,size),plan=prepare([face],setControl(initialState([face]),'a','lipPosition',value),size,size);
  const field=await buildField(plan);assert.ok(field);assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
  const center=f.world({x:0,y:(f.lm[0].y+f.lm[17].y)/2}),moved=destination(center,plan),delta={x:moved.x-center.x,y:moved.y-center.y};
  assert.ok((f.local(moved).y-f.local(center).y)*value<0,'the existing slider direction must remain');
  for(const i of [...lipOuterLoop,...lipInnerLoop]){
   const p=f.points[i],target={x:p.x+delta.x,y:p.y+delta.y},q=mapPoint(target,plan),sample=source(field,target,size);
   assert.ok(Math.hypot(q.x-p.x,q.y-p.y)<1e-6,`lip ${i} must receive the same translation`);
   assert.ok(Math.hypot(sample.x-p.x,sample.y-p.y)<1e-5,`interpolation must preserve lip ${i}`);
  }
 }
});

test('lip position fixes nose tip, alar wings and nostrils including interpolation',async()=>{
 for(const angle of [0,.35])for(const value of [-100,100]){
  const face=fixture('a',.5,1,angle),f=frame(face,700,700),plan=prepare([face],setControl(initialState([face]),'a','lipPosition',value),700,700);
  const field=await buildField(plan);assert.ok(field);
  for(const i of noseIds)for(const dx of [-.5,0,.5])for(const dy of [-.5,0,.5]){
   const p={x:f.points[i].x+dx,y:f.points[i].y+dy};
   assert.deepEqual(mapPoint(p,plan),p,`nose ${i} must stay fixed`);assert.deepEqual(source(field,p,700),p);
  }
 }
});

test('short philtrum limits the whole translation instead of flattening the upper lip',()=>{
 const regular=fixture(),short=fixture();short.landmarks[2]={...short.landmarks[2],y:short.landmarks[2].y+.003};
 for(const value of [-100,100]){
  const plan=(face:typeof regular)=>prepare([face],setControl(initialState([face]),face.id,'lipPosition',value),1000,1000);
  const base=plan(regular),limited=plan(short),f=frame(short,1000,1000),p=f.points[13],q=destination(p,limited),shift={x:q.x-p.x,y:q.y-p.y};
  assert.ok(Math.hypot(shift.x,shift.y)<Math.abs(destination(p,base).y-p.y),'less room must reduce the entire shift');
  for(const i of [...lipOuterLoop,...lipInnerLoop]){
   const target=destination(f.points[i],limited);
   assert.ok(Math.hypot(target.x-f.points[i].x-shift.x,target.y-f.points[i].y-shift.y)<1e-6);
  }
  assert.deepEqual(mapPoint(f.points[2],limited),f.points[2]);
 }
 const crowded=fixture();crowded.landmarks[2]={...crowded.landmarks[2],y:.547};
 for(const value of [-100,100]){
  const plan=prepare([crowded],setControl(initialState([crowded]),crowded.id,'lipPosition',value),400,400);
  for(const p of frame(crowded,400,400).points)assert.deepEqual(mapPoint(p,plan),p,'no room must stop the whole shift');
 }
});

test('lip position blends continuously into skin, protects neighbors and resets exactly',async()=>{
 const a=fixture('a',.36,.7,.2),b=fixture('b',.74,.5),faces=[a,b],size=700;
 for(const value of [-100,100]){
  const state=setControl(initialState(faces),'a','lipPosition',value),plan=prepare(faces,state,size,size),field=await buildField(plan);assert.ok(field);
  assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
  for(const p of frame(b,size,size).points)assert.deepEqual(source(field,p,size),p);
  const f=frame(a,size,size),epsilon=.001;
  for(let y=f.lm[2].y-5;y<f.lm[17].y+40;y+=1)for(let x=-80;x<=80;x+=4){
   const p=f.world({x,y}),q=mapPoint(p,plan);
   for(const axis of ['x','y'] as const){
    const before=mapPoint({...p,[axis]:p[axis]-epsilon},plan),after=mapPoint({...p,[axis]:p[axis]+epsilon},plan),jump=Math.hypot(before.x+after.x-2*q.x,before.y+after.y-2*q.y)/epsilon;
    assert.ok(jump<.005,`skin must connect smoothly: ${jump}`);
   }
  }
  const reset=await buildField(prepare(faces,setControl(state,'a','lipPosition',0),size,size));assert.ok(reset?.data.every(v=>v===0));
 }
});
