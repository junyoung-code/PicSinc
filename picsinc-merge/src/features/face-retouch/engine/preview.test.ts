import {test} from "node:test";
import assert from "node:assert/strict";
import {PreviewQueue,type PreviewRequest} from "./preview";
import {fixture} from "../effects/fixture";
import {initialState,setControl} from "../state/model";
import {prepare,type Field} from "./field";
const face=fixture();
const job=(version:number):PreviewRequest=>({version,faces:[face],plan:prepare([face],setControl(initialState([face]),face.id,"faceWidth",version),1000,1000)});
const field:Field={data:new Float32Array(16),columns:2,rows:2,limited:false,strained:false};
const tick=()=>new Promise<void>(r=>setImmediate(r));
test("continuous input finishes frames and coalesces waiting inputs to the latest",async()=>{
 const started:number[]=[],drawn:number[]=[],pending:Array<(f:Field|null)=>void>=[];let cancelled=0;
 const queue=new PreviewQueue({compute:p=>{started.push(p.state.settings[face.id].faceWidth);return new Promise(r=>pending.push(r));},cancel:()=>cancelled++},(_,j)=>drawn.push(j.version),()=>assert.fail("unexpected error"));
 queue.request(job(1));queue.request(job(2));queue.request(job(3));
 assert.deepEqual(started,[1]);assert.equal(cancelled,0);
 pending.shift()!(field);await tick();assert.deepEqual(drawn,[1]);assert.deepEqual(started,[1,3]);
 queue.request(job(4));pending.shift()!(field);await tick();assert.deepEqual(drawn,[1,3]);assert.deepEqual(started,[1,3,4]);
 pending.shift()!(field);await tick();assert.deepEqual(drawn,[1,3,4]);queue.dispose();
});
test("replacing a photo cancels work and prevents old-frame publication",async()=>{
 let finish:(f:Field|null)=>void=()=>{};let cancelled=0;
 const queue=new PreviewQueue({compute:()=>new Promise(r=>finish=r),cancel:()=>cancelled++},()=>assert.fail("disposed frame"),()=>assert.fail("disposed error"));
 queue.request(job(1));queue.request(job(2));queue.dispose();finish(field);await tick();assert.equal(cancelled,1);
});
test("failed intermediate calculation does not lose the latest queued input",async()=>{
 let fail:(e:Error)=>void=()=>{};let calls=0;const drawn:number[]=[],errors:number[]=[];
 const queue=new PreviewQueue({compute:()=>++calls===1?new Promise((_,r)=>fail=r):Promise.resolve(field),cancel:()=>{}},(_,j)=>drawn.push(j.version),(_,j)=>errors.push(j.version));
 queue.request(job(1));queue.request(job(2));fail(new Error("simulated"));await tick();assert.deepEqual(errors,[1]);assert.deepEqual(drawn,[2]);queue.dispose();
});
