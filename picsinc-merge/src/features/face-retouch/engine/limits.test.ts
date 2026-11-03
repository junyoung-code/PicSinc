import {test} from "node:test";
import assert from "node:assert/strict";
import {unsafeCells,jacobianFloor} from "./limits";
import {fixture} from "../effects/fixture";
import {controls,initialState,setControl} from "../state/model";
import {prepare,buildField} from "./field";
test("folding map is detected and gets a shared strength estimate",()=>{
 const data=new Float32Array(3*3*4);for(let y=0;y<3;y++)for(let x=0;x<3;x++)data[(y*3+x)*4]=-x*.8;
 assert.ok(jacobianFloor(data,3,3)<0);const unsafe=unsafeCells(data,3,3,{x0:0,y0:0,x1:2,y1:2});assert.equal(unsafe.length,4);
 const factor=Math.min(...unsafe.map(c=>c.strength));assert.ok(factor>0&&factor<1);
 const scaled=data.map(v=>v*factor);assert.ok(jacobianFloor(scaled,3,3)>=.25);
});
test("combined full-range edits remain orientation-preserving without fold limiting",async()=>{
 const face=fixture();let state=initialState([face]);for(const [id] of controls)state=setControl(state,face.id,id,100);
 const field=await buildField(prepare([face],state,1000,1000));assert.ok(field);assert.equal(field.strained,false);assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
});
test("limiting an extreme face preserves a distant safe face map exactly",async()=>{
 const a=fixture("a",.2,.5),b=fixture("b",.8,.5);let state=setControl(initialState([a,b]),"b","eyeHeight",65);
 const safe=await buildField(prepare([a,b],state,1000,1000));assert.ok(safe);
 // Deliberately exceed the UI range to keep exercising the safety limiter.
 for(const [id] of controls)state={...state,settings:{...state.settings,a:{...state.settings.a,[id]:400}}};
 const limited=await buildField(prepare([a,b],state,1000,1000));assert.ok(limited);assert.ok(limited.strained);
 assert.equal(limited.strengths?.['b:eyeHeight'],undefined);
 for(let y=0;y<safe.rows;y++)for(let x=Math.ceil(safe.columns*.65);x<safe.columns;x++){
  const i:number=(y*safe.columns+x)*4;assert.equal(limited.data[i],safe.data[i]);assert.equal(limited.data[i+1],safe.data[i+1]);
 }
 assert.ok(jacobianFloor(limited.data,limited.columns,limited.rows)>=.25);
});
