import {test} from "node:test";
import assert from "node:assert/strict";
import {initialState,neutral,resetFace,restoreTouch,setControl} from "./model";
import {fixture} from "../effects/fixture";

test("face settings are independent; individual reset and invalid inputs",()=>{
 const state=initialState([fixture("a"),fixture("b")]);
 const next=setControl(setControl(state,"a","eyeSize",30),"b","eyeSize",70);
 assert.equal(state.settings.a.eyeSize,0);assert.equal(next.settings.a.eyeSize,30);assert.equal(next.settings.b.eyeSize,70);
 const reset=setControl(next,"a","eyeSize",0);assert.equal(reset.settings.b.eyeSize,70);
 assert.equal(setControl(reset,"a","chinLength",Infinity).settings.a.chinLength,0);
 assert.equal(setControl(reset,"a","chinLength",300).settings.a.chinLength,100);
});
test("reset face removes its touch but preserves other-face restore cutoffs",()=>{
 let state=initialState([fixture("a"),fixture("b")]);
 const stroke=(owner:string)=>({owner,from:{x:0,y:0},to:{x:1,y:0},radius:10,strength:1});
 state={...setControl(state,"b","lipSize",42),strokes:[stroke("a"),stroke("b")]};
 state=restoreTouch(state,"b",{x:0,y:0},10);
 state={...state,strokes:[...state.strokes,stroke("b")]};
 const reset=resetFace(state,"a");
 assert.deepEqual(reset.settings.a,neutral());assert.equal(reset.settings.b.lipSize,42);
 assert.equal(reset.strokes.length,2);assert.equal(reset.restores[0].through,1);
});
