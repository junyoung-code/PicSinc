import { mkdir, copyFile, writeFile, readFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const vendor=resolve(root,"public/retouch/vendor");
await mkdir(resolve(vendor,"wasm"),{recursive:true});
const bundle=await readFile(resolve(root,"node_modules/@mediapipe/tasks-vision/vision_bundle.cjs"),"utf8");
await writeFile(resolve(vendor,"vision_bundle.js"),`self.MediaPipe={};(function(exports){${bundle}\n})(self.MediaPipe);`);
for(const name of ["wasm/vision_wasm_internal.js","wasm/vision_wasm_internal.wasm","wasm/vision_wasm_nosimd_internal.js","wasm/vision_wasm_nosimd_internal.wasm"]) {
  await copyFile(resolve(root,"node_modules/@mediapipe/tasks-vision",name),resolve(vendor,name));
}
const model=resolve(vendor,"face_landmarker.task");
const expected="64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
try {await readFile(model);}catch {
  const response=await fetch("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task");
  if(!response.ok) throw new Error(`MediaPipe model download failed: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<3_000_000) throw new Error("Unexpected model size");
  if(digest(bytes)!==expected) throw new Error("MediaPipe model checksum mismatch");
  await writeFile(`${model}.tmp`,bytes);await rename(`${model}.tmp`,model);
}
const hash=digest(await readFile(model));
if(hash!==expected) throw new Error("Cached MediaPipe model checksum mismatch; remove public/retouch/vendor/face_landmarker.task and rerun setup");
console.log(`Local MediaPipe assets ready. Model SHA-256: ${hash}`);
