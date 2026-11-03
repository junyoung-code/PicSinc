import {test} from "node:test";
import assert from "node:assert/strict";
import {encodedSize,validateDimensions} from "./headers";
test("PNG header size is checked before bitmap allocation",()=>{
 const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);const view=new DataView(bytes.buffer);view.setUint32(16,8000);view.setUint32(20,6000);
 assert.deepEqual(encodedSize(bytes,"image/png"),{width:8000,height:6000});assert.throws(()=>validateDimensions(8000,6000),/1,600만/);
});
test("JPEG supports baseline and progressive frame headers",()=>{
 for(const marker of [192,194]){const bytes=new Uint8Array([255,216,255,224,0,4,0,0,255,marker,0,8,8,3,0,4,0,3]);assert.deepEqual(encodedSize(bytes,"image/jpeg"),{width:1024,height:768});}
});
test("invalid headers and unprocessable dimensions are rejected",()=>{
 assert.throws(()=>encodedSize(new Uint8Array([255,216,255,224,0,1]),"image/jpeg"));assert.throws(()=>encodedSize(new Uint8Array(24),"image/png"));assert.throws(()=>validateDimensions(0,100));assert.throws(()=>validateDimensions(9000,100));assert.doesNotThrow(()=>validateDimensions(4096,2731));
});
