import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture';
import {browLoops,eyeLoops,frame} from './geometry';
import {initialState,restoreTouch,setControl,resetTouch} from '../state/model';
import {mapPoint,prepare} from '../engine/field';
const face=fixture(),w=1000,h=1000;
test('eye and brow height translate their whole area by the same distance',()=>{
 for(const [id,loops] of [['eyeHeight',eyeLoops],['browHeight',browLoops]] as const){
  const plan=prepare([face],setControl(initialState([face]),face.id,id,100),w,h);
  for(const loop of loops){const shifts=loop.map(i=>{const p={x:face.landmarks[i].x*w,y:face.landmarks[i].y*h},q=mapPoint(p,plan);return{x:q.x-p.x,y:q.y-p.y};});
   for(const shift of shifts){assert.ok(Math.abs(shift.x-shifts[0].x)<1e-7);assert.ok(Math.abs(shift.y-shifts[0].y)<1e-7);}
  }
 }
});
test('restoration preserves all facial controls and redness',()=>{
 const p=frame(face,w,h).points[33];let state=setControl(initialState([face]),face.id,'eyeSize',80);
 const before=mapPoint(p,prepare([face],state,w,h));
 state=restoreTouch(state,face.id,p,35);
 assert.deepEqual(mapPoint(p,prepare([face],state,w,h)),before);
 assert.deepEqual(mapPoint(p,prepare([face],resetTouch(state,face.id),w,h)),before);
});
test('redness is one-way and eyebrow head is the thirtieth control',()=>{
 assert.equal(setControl(initialState([face]),face.id,'eyeRedness',-50).settings[face.id].eyeRedness,0);
 assert.ok('browHeadSpacing' in initialState([face]).settings[face.id]);
});

test('iris disk is unchanged by thickness, length and all opening controls',()=>{
 for(const id of ['eyeThickness','eyeLength','eyeInner','eyeOuter','eyeLower'] as const)for(const value of [-100,-50,50,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,id,value),w,h),f=frame(face,w,h);
  for(const start of [468,473])for(let y=-8;y<=8;y+=4)for(let x=-8;x<=8;x+=4){const p={x:f.points[start].x+x,y:f.points[start].y+y};assert.deepEqual(mapPoint(p,plan),p,`${id} iris disk`);}
 }
});
test('eye size scales both eyes and iris by the same ratio across the full core',()=>{
 for(const value of [-100,-50,0,50,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,'eyeSize',value),w,h),scale=1+.055*value/100;
  for(const side of [0,1]){const center={x:(side===0?.415:.585)*w,y:.39*h};
   for(const i of [...eyeLoops[side],...Array.from({length:5},(_,k)=>(side===0?468:473)+k)]){
    const origin={x:face.landmarks[i].x*w,y:face.landmarks[i].y*h},target={x:center.x+(origin.x-center.x)*scale,y:center.y+(origin.y-center.y)*scale},q=mapPoint(target,plan);
    assert.ok(Math.hypot(q.x-origin.x,q.y-origin.y)<1e-7,`eyeSize ${value} landmark ${i}`);
   }
  }
 }
});
test('nose size and tip scale both axes equally; alar wings scale about their centers',()=>{
 for(const value of [-100,-50,50,100])for(const id of ['noseSize','noseTip','noseAlar'] as const){
  const ops=prepare([face],setControl(initialState([face]),face.id,id,value),w,h).operations;
  assert.equal(ops.length,id==='noseAlar'?2:1);
  for(const op of ops){assert.equal(op.sx,op.sy);assert.notEqual(op.sx,1);assert.ok(op.dx===0);assert.ok(op.dy===0);}
 }
});
test('bridge and dorsum never affect the same original point',()=>{
 const bridge=prepare([face],setControl(initialState([face]),face.id,'noseBridge',80),w,h);
 const dorsum=prepare([face],setControl(initialState([face]),face.id,'noseDorsum',80),w,h);
 let changed=0;
 for(let x=430;x<570;x+=3)for(let y=330;y<540;y+=3){const p={x,y},a=mapPoint(p,bridge),b=mapPoint(p,dorsum);
 const ac=Math.hypot(a.x-x,a.y-y)>1e-8,bc=Math.hypot(b.x-x,b.y-y)>1e-8;
 assert.ok(!(ac&&bc));if(ac||bc)changed++;
 }assert.ok(changed>100);
});
test('eyebrow head moves its inner end and fixes its outer end',()=>{
 for(const value of [-100,-50,50,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,'browHeadSpacing',value),w,h),f=frame(face,w,h);
  for(const side of [0,1]){const loop=browLoops[side],sorted=loop.map(i=>f.points[i]).sort((a,b)=>a.x-b.x),tail=sorted[side===0?0:sorted.length-1],head=sorted[side===0?sorted.length-1:0];
   assert.deepEqual(mapPoint(tail,plan),tail);const middle={x:(tail.x+head.x)/2,y:(tail.y+head.y)/2};assert.deepEqual(mapPoint(middle,plan),middle);assert.equal(mapPoint(head,plan).y,head.y);assert.ok(Math.abs(mapPoint(head,plan).x-head.x)>1);
  }
 }
});
test('restore path erases only existing touch, keeping face settings and later touch',()=>{
 const p={x:360,y:390};let state=setControl(initialState([face]),face.id,'eyeSize',60);
 const base=prepare([face],state,w,h);
 state={...state,strokes:[{owner:face.id,from:{x:400,y:390},to:{x:410,y:390},radius:20,strength:.5}]};
 state=restoreTouch(state,face.id,{x:470,y:390},35,p);
 const plan=prepare([face],state,w,h);
 for(let x=360;x<=470;x+=5)assert.deepEqual(mapPoint({x,y:390},plan),mapPoint({x,y:390},base));
 state={...state,strokes:[...state.strokes,state.strokes[0]]};
 assert.notDeepEqual(mapPoint({x:400,y:390},prepare([face],state,w,h)),mapPoint({x:400,y:390},base));
});
