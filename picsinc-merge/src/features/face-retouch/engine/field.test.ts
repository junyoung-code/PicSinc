import {test} from "node:test";
import assert from "node:assert/strict";
import {fixture} from "../effects/fixture";
import {controls,initialState,restoreTouch,setControl} from "../state/model";
import {buildField,colorSuppression,mapPoint,prepare} from "./field";
import {eyeLoops,frame} from "../effects/geometry";
import {jacobianFloor} from "./limits";
const face=fixture(),w=1000,h=1000;
const points=Array.from({length:80},(_,y)=>Array.from({length:80},(_,x)=>({x:x*10+100,y:y*10+100}))).flat();

test("neutral preserves every original coordinate; same inputs are deterministic",async()=>{
 const plan=prepare([face],initialState([face]),w,h);
 for(const p of points)assert.deepEqual(mapPoint(p,plan),p);
 const a=await buildField(plan),b=await buildField(plan);assert.deepEqual(a?.data,b?.data);assert.ok(a?.data.every(v=>v===0));
});
for(const [id] of controls.filter(c=>c[0]!=="eyeRedness")) test(`${id}: actual bidirectional local deformation, finite mapping`,()=>{
 const base=initialState([face]),positive=prepare([face],setControl(base,face.id,id,100),w,h),negative=prepare([face],setControl(base,face.id,id,-100),w,h);
 let changed=0,different=0;
 for(const p of points){const a=mapPoint(p,positive),b=mapPoint(p,negative);assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y));if(Math.hypot(a.x-p.x,a.y-p.y)>.1)changed++;if(Math.hypot(a.x-b.x,a.y-b.y)>.2)different++;}
 assert.ok(changed>2,`${id} had no effect`);assert.ok(different>2,`${id} did not reverse`);
 assert.deepEqual(mapPoint({x:50,y:50},positive),{x:50,y:50});
});
test("face width anchors preserve eyes, nose, mouth at +100 and -100",()=>{
 for(const value of [-100,100]){
  const plan=prepare([face],setControl(initialState([face]),face.id,"faceWidth",value),w,h);
  for(const i of [...eyeLoops.flat(),1,168,2,0,17,13,14,61,291]){const p={x:face.landmarks[i].x*w,y:face.landmarks[i].y*h};assert.deepEqual(mapPoint(p,plan),p);}
 }
});
test("similarly named operations are different coordinate maps",()=>{
 for(const ids of [["eyeSize","eyeThickness","eyeLength","eyeHeight","eyeSpacing","eyeInner","eyeOuter","eyeLower"],["noseSize","noseLength","noseAlar","noseBridge","noseDorsum","noseTip"],["lipSize","lipWidth","lipPosition","lipFullness"]] as const){
  const fingerprints=ids.map(id=>points.map(p=>mapPoint(p,prepare([face],setControl(initialState([face]),face.id,id,80),w,h))).map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(";"));assert.equal(new Set(fingerprints).size,ids.length);
 }
});
test("position movement follows head tilt",()=>{
 const tilted=fixture("a",.5,1,.3),f=frame(tilted,w,h),p=f.world({x:(f.lm[33].x+f.lm[133].x)/2,y:(f.lm[33].y+f.lm[133].y)/2});
 const q=mapPoint(p,prepare([tilted],setControl(initialState([tilted]),"a","eyeHeight",50),w,h));
 assert.ok(q.y>p.y);assert.ok(q.x<p.x);assert.ok(Math.abs((q.x-p.x)/(q.y-p.y)+Math.tan(.3))<.01);
});
test("restoration removes only local touch, preserves geometry, other areas and future touch",()=>{
 let state=setControl(initialState([face]),face.id,"chinLength",30);
 state={...state,strokes:[{owner:face.id,from:{x:500,y:620},to:{x:508,y:620},radius:40,strength:.75},{owner:face.id,from:{x:380,y:490},to:{x:387,y:490},radius:25,strength:.75}]};
 const base=prepare([face],{...state,strokes:[]},w,h),before=prepare([face],state,w,h);
 const restored=restoreTouch(state,face.id,{x:500,y:620},30),after=prepare([face],restored,w,h);
 assert.notDeepEqual(mapPoint({x:500,y:620},before),mapPoint({x:500,y:620},base));
 assert.deepEqual(mapPoint({x:500,y:620},after),mapPoint({x:500,y:620},base));
 assert.deepEqual(mapPoint({x:380,y:490},after),mapPoint({x:380,y:490},before));
 const future=prepare([face],{...restored,strokes:[...restored.strokes,state.strokes[0]]},w,h);
 assert.notDeepEqual(mapPoint({x:500,y:620},future),mapPoint({x:500,y:620},base));
});
test("neighboring faces remain exact and limitation is reported",()=>{
 const a=fixture("a",.40,.8),b=fixture("b",.66,.8);let state=initialState([a,b]);
 for(const [id] of controls)state=setControl(state,"a",id,60);
 const plan=prepare([a,b],state,w,h);assert.ok(plan.limited);
 for(const lm of b.landmarks){const p={x:lm.x*w,y:lm.y*h};assert.deepEqual(mapPoint(p,plan),p);}
});
test("obsolete field calculation is canceled",async()=>{assert.equal(await buildField(prepare([face],initialState([face]),w,h),()=>false),null);});
test("in-flight calculation yields to cancellation and a subsequent edit remains usable",async()=>{
 let state=initialState([face]);for(const [id] of controls)state=setControl(state,face.id,id,100);
 let current=true;
 const calculation=buildField(prepare([face],state,w,h),()=>current);
 const cancel=new MessageChannel();
 cancel.port1.onmessage=()=>{current=false;cancel.port1.close();cancel.port2.close();};
 cancel.port2.postMessage(null);
 assert.equal(await calculation,null);
 const next=await buildField(prepare([face],initialState([face]),w,h));
 assert.ok(next?.data.every(value=>value===0));
});
test("detected small faces without editable settings still protect their coordinates",()=>{
 const a=fixture("a",.40,.8),small=fixture("small",.56,.22);
 const state=setControl(initialState([a]),"a","faceWidth",100);
 const plan=prepare([a,small],state,w,h);assert.ok(plan.limited);
 assert.ok(!plan.operations.some(o=>o.owner===small.id));
 for(const lm of small.landmarks){const p={x:lm.x*w,y:lm.y*h};assert.deepEqual(mapPoint(p,plan),p);}
});
test("localized computation matches a dense whole-image calculation exactly",async()=>{
 const a=fixture("a",.32,.6,.3),b=fixture("b",.75,.5,-.2);
 let state=initialState([a,b]);for(const [id] of controls)state=setControl(state,"a",id,70);
 state=setControl(state,"b","eyeHeight",-80);
 state={...state,strokes:[{owner:"a",from:{x:155,y:290},to:{x:178,y:295},radius:35,strength:.75},{owner:"b",from:{x:370,y:210},to:{x:364,y:208},radius:20,strength:.75}]};
 state=restoreTouch(state,"a",{x:165,y:193},24,{x:200,y:191});
 const plan=prepare([a,b],state,480,480),field=await buildField(plan);assert.ok(field);
 const dense=new Float32Array(field.data.length);
 for(let y=0;y<field.rows;y++)for(let x=0;x<field.columns;x++){
  const p={x:x/(field.columns-1)*480,y:y/(field.rows-1)*480},q=mapPoint(p,plan,field.strengths),i=(y*field.columns+x)*4;dense[i]=(q.x-p.x)/480;dense[i+1]=(q.y-p.y)/480;dense[i+2]=colorSuppression(p,plan);
 }
 assert.deepEqual(field.data,dense);assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
});

test("whole-photo touch works without a face and restoration preserves its input baseline", async()=>{
 let state=initialState([{id:"__touch",landmarks:[]}]);
 const p={x:40,y:40};
 state={...state,strokes:[{owner:"__touch",from:p,to:{x:48,y:40},radius:20,strength:.5}]};
 const plan=prepare([],state,400,400,"global");
 assert.notDeepEqual(mapPoint(p,plan),p);
 const f=await buildField(plan);assert.ok(f?.data.some(v=>v!==0));
 const restored=prepare([],restoreTouch(state,"__touch",p,25),400,400,"global");
 assert.deepEqual(mapPoint(p,restored),p);
 assert.deepEqual(mapPoint({x:350,y:350},plan),{x:350,y:350});
});

 test("room touch area does not produce a false neighboring-face warning",()=>{
 const state=setControl(initialState([face]),face.id,"eyeOuter",50);
 assert.equal(prepare([face],state,w,h,"region").limited,false);
 const touch={...state,strokes:[{owner:"__touch",from:{x:500,y:500},to:{x:510,y:500},radius:30,strength:.5}]};
 assert.equal(prepare([face],touch,w,h,"region").limited,false);
 });
