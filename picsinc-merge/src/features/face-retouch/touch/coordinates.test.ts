import {test} from "node:test";
import assert from "node:assert/strict";
import {imagePoint,splitDrag} from "./coordinates";
test("same image point at fit and after zoom/pan",()=>{
 const fitted=imagePoint({x:150,y:200},{left:50,top:100,width:200,height:400},1000,2000);
 const zoomed=imagePoint({x:200,y:450},{left:-100,top:150,width:600,height:1200},1000,2000);
 assert.deepEqual(fitted,{x:500,y:500});assert.deepEqual(zoomed,fitted);
});
test("touch sampling is stored in image coordinates with bounded steps",()=>{
 const s=splitDrag("a",{x:0,y:0},{x:100,y:0},20);assert.equal(s.length,25);
 assert.deepEqual(s[0].from,{x:0,y:0});assert.deepEqual(s.at(-1)?.to,{x:100,y:0});
 assert.ok(s.every(q=>Math.hypot(q.to.x-q.from.x,q.to.y-q.from.y)<=4));
});

test("fine touch strengths remain distinct below the previous 0.1 floor",()=>{
 const strengths=[.01,.03,.075,.1].map(strength=>splitDrag("a",{x:10,y:10},{x:11,y:10},2,strength)[0].strength);
 assert.deepEqual(strengths,[.01,.03,.075,.1]);
 assert.equal(splitDrag("a",{x:10,y:10},{x:11,y:10},2)[0].strength,.06);
});
