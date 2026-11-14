import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture';
import {bounds,eyeLoops,frame} from './geometry';
import {initialState,setControl,type Point} from '../state/model';
import {buildField,mapPoint,prepare} from '../engine/field';
import {jacobianFloor} from '../engine/limits';
import {eyeContours,irisCircle,scleraWeight} from './eyes';

function destination(p:Point,plan:ReturnType<typeof prepare>):Point{
 let t={...p};for(let i=0;i<30;i++){const q=mapPoint(t,plan);t={x:t.x+p.x-q.x,y:t.y+p.y-q.y};}return t;
}

test('eye thickness moves the crease with the upper lid while tapering below the eye',async()=>{
 const face=fixture('a',.5,1,.25),f=frame(face,1000,1000);
 for(const value of [-100,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,'eyeThickness',value),1000,1000);
  for(const [upper,lower] of [[160,144],[158,153],[385,380],[387,373]]){
   const top=f.local(destination(f.points[upper],plan)),bottom=f.local(destination(f.points[lower],plan));
   assert.ok((top.y-f.lm[upper].y)*Math.sign(value)<-2);
   assert.ok((bottom.y-f.lm[lower].y)*Math.sign(value)>2);
   assert.ok(Math.abs(top.x-f.lm[upper].x)<1e-6 && Math.abs(bottom.x-f.lm[lower].x)<1e-6);
  }
  for(const id of [468,473,105,334])assert.deepEqual(mapPoint(f.points[id],plan),f.points[id]);
  for(const start of [468,473]){
   const center=f.lm[start],scale=value>0?1.27:.82;
   for(const dy of [-4,4]){
    const localScale=dy>0?1+(scale-1)*.8:scale;
    const source=f.world({x:center.x,y:center.y+dy});
    const target=f.world({x:center.x,y:center.y+dy*localScale});
    const mapped=mapPoint(target,plan);
    assert.ok(Math.hypot(mapped.x-source.x,mapped.y-source.y)<1e-6);
   }
   const movement=(dy:number)=>{
    const point=f.world({x:center.x,y:center.y+dy});
    return f.local(destination(point,plan)).y-(center.y+dy);
   };
   const upperLid=movement(-19),crease=movement(-27);
   assert.ok(upperLid*Math.sign(value)<0);
   assert.ok(Math.abs(crease-upperLid)<1);
   const lowerLid=movement(19),underEye=movement(28),outerSkin=movement(41);
   assert.ok(lowerLid*Math.sign(value)>0 && underEye*Math.sign(value)>0);
   assert.ok(Math.abs(underEye)>Math.abs(outerSkin));
   assert.ok(Math.abs(movement(56))<1e-6);
  }
  const field=await buildField(plan);assert.ok(field);
  assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
 }
});

test('eye height translates the eye and its immediate makeup without stretching them',async()=>{
 for(const angle of [0,.3])for(const value of [-100,100]){
  const face=fixture('a',.5,1,angle),f=frame(face,1000,1000),plan=prepare([face],setControl(initialState([face]),'a','eyeHeight',value),1000,1000);
  const field=await buildField(plan);
  assert.ok(field&&!field.strained,'full eye height travel must fit without reducing the slider strength');
  for(const side of [0,1]){
   const ids=eyeLoops[side],width=bounds(ids.map(i=>f.lm[i])).width,outer=f.lm[side===0?33:263];
   const makeup=[outer,...ids.slice(1,3).map(i=>({x:f.lm[i].x,y:f.lm[i].y-width*.10})),...ids.slice(4).map(i=>({x:f.lm[i].x,y:f.lm[i].y+width*.10}))];
   const op=plan.operations[side];
   for(const point of makeup){
    const source=f.world(point),target=f.world({x:point.x,y:point.y+op.dy}),q=mapPoint(target,plan);
    assert.ok(Math.hypot(q.x-source.x,q.y-source.y)<1e-6,'makeup must follow the eye rigidly');
   }
  }
 }
});

test('lower opening moves the outer lower lid without dragging the upper lid or iris',()=>{
 for(const value of [-100,100]){
  const face=fixture(),f=frame(face,1000,1000),plan=prepare([face],setControl(initialState([face]),face.id,'eyeLower',value),1000,1000);
  for(const i of [160,158,385,387])assert.deepEqual(mapPoint(f.points[i],plan),f.points[i]);
  for(const start of [468,473])for(let i=0;i<40;i++){
   const p={x:f.points[start].x+14*Math.cos(i*Math.PI/20),y:f.points[start].y+14*Math.sin(i*Math.PI/20)};
   assert.deepEqual(mapPoint(p,plan),p);
  }
  for(const i of [144,373])assert.ok((destination(f.points[i],plan).y-f.points[i].y)*value>0);
 }
});

test('inner and lower openings preserve the whole iris after size, height, spacing and angle',()=>{
 const face=fixture(),f=frame(face,1000,1000);
 for(const sign of [-1,1]){
  let state=initialState([face]);for(const id of ['eyeSize','eyeHeight','eyeSpacing','eyeAngle'] as const)state=setControl(state,face.id,id,100*sign);
  const base=prepare([face],state,1000,1000);
  for(const id of ['eyeInner','eyeLower'] as const){
   const combined=prepare([face],setControl(state,face.id,id,100),1000,1000);
   for(const start of [468,473])for(let a=0;a<40;a++){
    const source={x:f.points[start].x+14*Math.cos(a*Math.PI/20),y:f.points[start].y+14*Math.sin(a*Math.PI/20)},p=destination(source,base),q=mapPoint(p,combined);
    assert.ok(Math.hypot(q.x-source.x,q.y-source.y)<1e-6,`${id} must not add iris displacement`);
   }
  }
 }
});

test('requested eye controls remain safe together and protect neighboring faces',async()=>{
 const a=fixture('a',.38,.7,.2),b=fixture('b',.70,.5),faces=[a,b];
 for(const value of [-100,100]){
  let state=initialState(faces);for(const id of ['eyeHeight','eyeInner','eyeLower'] as const)state=setControl(state,'a',id,value);
  const plan=prepare(faces,state,700,700),field=await buildField(plan);assert.ok(field);
  assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
  for(const p of frame(b,700,700).points)assert.deepEqual(mapPoint(p,plan),p);
 }
});

test('inner opening spreads over both inner eyelids with a continuous falloff',()=>{
 const face=fixture(),f=frame(face,1000,1000);
 for(const value of [-100,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,'eyeInner',value),1000,1000);
  for(const i of [158,133,153,385,362,380]){
   const p=f.points[i],q=destination(p,plan),sign=i<300?1:-1;
   assert.ok((q.x-p.x)*sign*value>0);
  }
  const epsilon=.01;
  for(let y=300;y<480;y+=2)for(let x=350;x<480;x+=2){
   const a=mapPoint({x:x-epsilon,y},plan),b=mapPoint({x,y},plan),c=mapPoint({x:x+epsilon,y},plan);
   assert.ok(Math.hypot(a.x+c.x-2*b.x,a.y+c.y-2*b.y)/epsilon<.005);
  }
 }
});

test('sclera mask stays inside the eyelids, feathers inward and excludes the full iris',()=>{
 const f=frame(fixture(),1000,1000);
 for(const side of [0,1]){
  const outline=eyeContours[side].map(i=>f.points[i]),iris=irisCircle(f.points,side);
  for(const p of outline)assert.equal(scleraWeight(p,outline,iris,2),0);
  for(let a=0;a<40;a++)assert.equal(scleraWeight({x:iris.center.x+iris.radius*Math.cos(a*Math.PI/20),y:iris.center.y+iris.radius*Math.sin(a*Math.PI/20)},outline,iris,2),0);
  const p={x:iris.center.x+(side===0?1:-1)*30,y:iris.center.y};
  assert.ok(scleraWeight(p,outline,iris,2)>.9);
  assert.equal(scleraWeight({x:p.x,y:p.y-50},outline,iris,2),0);
 }
});
