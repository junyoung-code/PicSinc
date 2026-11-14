import {test} from "node:test";
import assert from "node:assert/strict";
import {unsafeCells,jacobianFloor} from "./limits";
import {fixture} from "../effects/fixture";
import {controls,initialState,restoreTouch,setControl} from "../state/model";
import {splitDrag} from "../touch/coordinates";
import {prepare,buildField} from "./field";
test("folding map is detected and gets a shared strength estimate",()=>{
 const data=new Float32Array(3*3*4);for(let y=0;y<3;y++)for(let x=0;x<3;x++)data[(y*3+x)*4]=-x*.8;
 assert.ok(jacobianFloor(data,3,3)<0);const unsafe=unsafeCells(data,3,3,{x0:0,y0:0,x1:2,y1:2});assert.equal(unsafe.length,4);
 const factor=Math.min(...unsafe.map(c=>c.strength));assert.ok(factor>0&&factor<1);
 const scaled=data.map(v=>v*factor);assert.ok(jacobianFloor(scaled,3,3)>=.25);
});
test("combined full-range edits remain orientation-preserving after any required limiting",async()=>{
 const face=fixture();let state=initialState([face]);for(const [id] of controls)state=setControl(state,face.id,id,100);
 const field=await buildField(prepare([face],state,1000,1000));assert.ok(field);assert.ok(jacobianFloor(field.data,field.columns,field.rows)>=.25);
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

test("partial restoration keeps facial strength and a separate touch on the same face", async () => {
 const face = fixture(), size = 640;
 const base = setControl(setControl(initialState([face]), face.id, "faceWidth", 85), face.id, "eyeSize", 85);
 const from = {x: size * .34, y: size * .45}, to = {x: size * .387, y: size * .456};
 const repeated = Array.from({length: 4}, () => splitDrag(face.id, from, to, 14)).flat();
 const distant = splitDrag(face.id, {x: 390, y: 330}, {x: 400, y: 330}, 12);
 const state = {...base, strokes: [...repeated, ...distant]};
 const before = await buildField(prepare([face], state, size, size));
 const partial = await buildField(prepare([face], restoreTouch(state, face.id, from, 14), size, size));
 const full = await buildField(prepare([face], restoreTouch(state, face.id, to, 48, from), size, size));
 const baseline = await buildField(prepare([face], {...base, strokes: distant}, size, size));
 assert.ok(before && partial && full && baseline);
 assert.ok(partial.strained, "the partial erase exercises the safety limiter");
 assert.ok(jacobianFloor(partial.data, partial.columns, partial.rows) >= .25);
 for (const control of ["faceWidth", "eyeSize"]) {
  const key = `${face.id}:${control}`;
  assert.equal(partial.strengths?.[key], before.strengths?.[key], `${control} stays fixed during restoration`);
 }
 const localIndex = (point: {x: number; y: number}) =>
  (Math.round(point.y / size * (partial.rows - 1)) * partial.columns + Math.round(point.x / size * (partial.columns - 1))) * 4;
 const sample = (data: Float32Array, point: {x: number; y: number}) => data.slice(localIndex(point), localIndex(point) + 2);
 assert.notDeepEqual(sample(before.data, from), sample(partial.data, from));
 assert.deepEqual(sample(partial.data, from), sample(baseline.data, from));
 assert.deepEqual(sample(partial.data, distant[0].from), sample(before.data, distant[0].from));
 assert.deepEqual(full.data, baseline.data);
});
