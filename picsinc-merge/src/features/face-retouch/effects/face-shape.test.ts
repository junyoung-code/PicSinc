import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture';
import {eyeLoops,frame,lipLoop,oval} from './geometry';
import {initialState,setControl,type Point} from '../state/model';
import {buildField,mapPoint,prepare} from '../engine/field';
import {jacobianFloor} from '../engine/limits';

test('face width keeps the outer eye makeup fixed in both directions and at a tilt',()=>{
 for(const angle of [0,.35])for(const scale of [.45,1])for(const value of [-100,100]){
  const face=fixture('face',.5,scale,angle),f=frame(face,1000,1000);
  const plan=prepare([face],setControl(initialState([face]),face.id,'faceWidth',value),1000,1000);
  for(const sign of [-1,1])for(const y of [-70,-60,-50]){
   const p=f.world({x:sign*180*scale,y:y*scale});
   assert.deepEqual(mapPoint(p,plan),p,'makeup outside the eye landmarks must stay fixed');
  }
 }
});

test('width and jaw displacement have no derivative jumps at contour vertices',()=>{
 const face=fixture(),f=frame(face,1000,1000),epsilon=.01;
 for(const id of ['faceWidth','jawAngle'] as const)for(const value of [-100,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,id,value),1000,1000);
  for(const i of oval)for(const axis of ['x','y'] as const){
   const p=f.points[i],q=mapPoint(p,plan);
   const a=mapPoint({...p,[axis]:p[axis]-epsilon},plan),b=mapPoint({...p,[axis]:p[axis]+epsilon},plan);
   const jump=Math.hypot(a.x+b.x-2*q.x,a.y+b.y-2*q.y)/epsilon;
   assert.ok(jump<.005,`${id} contour ${i} ${axis}: derivative jump ${jump}`);
  }
 }
});

// Recover the destination of a source landmark from the renderer's inverse map.
function destination(p:Point,plan:ReturnType<typeof prepare>):Point{
 let target={...p};
 for(let i=0;i<24;i++){const source=mapPoint(target,plan);target={x:target.x+p.x-source.x,y:target.y+p.y-source.y};}
 return target;
}

test('lower face preserves nose-to-mouth/chin proportions and translates the entire mouth rigidly',()=>{
 for(const angle of [0,.3])for(const value of [-100,100]){
  const face=fixture('face',.5,1,angle),f=frame(face,1000,1000);
  const plan=prepare([face],setControl(initialState([face]),face.id,'lowerFace',value),1000,1000);
  for(const i of [...eyeLoops.flat(),168,1,2,98,327])assert.deepEqual(mapPoint(f.points[i],plan),f.points[i]);
  const mouth={x:0,y:(f.lm[0].y+f.lm[17].y)/2},nose=f.lm[2],chin=f.lm[152];
  const movedMouth=f.local(destination(f.world(mouth),plan)),movedChin=f.local(destination(f.world(chin),plan));
  assert.ok((movedChin.y-chin.y)*value<0,'positive shortens and negative lengthens');
  assert.ok(Math.abs((movedMouth.y-nose.y)/(movedChin.y-nose.y)-(mouth.y-nose.y)/(chin.y-nose.y))<1e-5);
  assert.ok(Math.abs(movedMouth.x-mouth.x)<1e-7);
  const shifts=[...lipLoop,13,14,78,308].map(i=>{const q=destination(f.points[i],plan);return{x:q.x-f.points[i].x,y:q.y-f.points[i].y};});
  for(const shift of shifts)assert.ok(Math.hypot(shift.x-shifts[0].x,shift.y-shifts[0].y)<1e-6,'mouth shape must not stretch');
 }
});

test('jaw softening moves the jaw corners inward without moving the chin tip',()=>{
 const face=fixture(),f=frame(face,1000,1000);
 for(const value of [-100,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,'jawAngle',value),1000,1000);
  assert.deepEqual(mapPoint(f.points[152],plan),f.points[152]);
  for(const i of [172,397]){
   const q=f.local(destination(f.points[i],plan));
   assert.ok((Math.abs(q.x)-Math.abs(f.lm[i].x))*value<0);
  }
 }
});

test('combined shape controls remain invertible, preserve a neighboring face and reset exactly',async()=>{
 const face=fixture('a',.37,.7,.25),neighbor=fixture('b',.72,.5),faces=[face,neighbor];
 for(const value of [-100,100]){
  let state=initialState(faces);
  for(const id of ['faceWidth','lowerFace','jawAngle'] as const)state=setControl(state,'a',id,value);
  const plan=prepare(faces,state,700,700),field=await buildField(plan);
  assert.ok(field);assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
  for(const p of frame(neighbor,700,700).points)assert.deepEqual(mapPoint(p,plan),p);
  for(const id of ['faceWidth','lowerFace','jawAngle'] as const)state=setControl(state,'a',id,0);
  const neutral=await buildField(prepare(faces,state,700,700));assert.ok(neutral?.data.every(v=>v===0));
 }
});
