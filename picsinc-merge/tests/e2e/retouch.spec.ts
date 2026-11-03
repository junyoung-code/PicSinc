import {test,expect,type Page} from "@playwright/test";
import {existsSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import sharp from "sharp";
import {faceArea,regionDistance} from "../../src/features/face-retouch/engine/field";
import type {Face} from "../../src/features/face-retouch/state/model";
import {browLoops,eyeLoops,frame,insidePolygon} from "../../src/features/face-retouch/effects/geometry";
import {initialState,setControl} from "../../src/features/face-retouch/state/model";
import {mapPoint,prepare} from "../../src/features/face-retouch/engine/field";
import {operations} from "../../src/features/face-retouch/effects/operations";
import {controls} from "../../src/features/face-retouch/state/model";
const fixture=process.env.RETOUCH_FIXTURE??"test-images/four-women-20260915/01-original.png";
const output=process.env.RETOUCH_OUTPUT??"private/retouch-e2e/visual";
async function ready(page:Page){
 await expect(page.getByRole("button",{name:"PNG 저장",exact:true})).toBeEnabled({timeout:100_000});
 await expect(page.getByRole("status").filter({hasText:/미리보기 갱신 중|얼굴 기준점/})).toHaveCount(0,{timeout:100_000});
}
async function strength(page:Page,value:number){
 await page.locator("#retouch-strength").fill(String(value));await ready(page);
}
async function image(page:Page){return Buffer.from(await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((canvas:HTMLCanvasElement)=>canvas.toDataURL("image/png").split(",")[1]),"base64");}
async function raw(bytes:Buffer){return sharp(bytes).ensureAlpha().raw().toBuffer();}
async function open(page:Page,path=fixture){await page.goto("/retouch");await page.getByLabel("사진 열기",{exact:true}).setInputFiles(path);await expect(page.getByRole("button",{name:"얼굴 1",exact:true})).toBeVisible({timeout:100_000});await ready(page);}

test("all 30 controls change real pixels, neutral roundtrip, individual reset, compare and full-resolution PNG",async({page})=>{
 test.skip(!existsSync(fixture),"Set RETOUCH_FIXTURE to a local frontal photo; private fixtures are excluded from Git.");
 await mkdir(output,{recursive:true});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 const writes:string[]=[];page.on("request",r=>{if(r.method()!=="GET")writes.push(r.url());});
 await open(page);
 const original=await image(page),base=await raw(original);await writeFile(`${output}/neutral.png`,original);
 const differences:Record<string,{changed:number;max:number}>={};
 for(const [id,,group] of controls){
  await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:group,exact:true}).click();
  await page.locator(`[data-control="${id}"]`).click();await strength(page,65);
  const rendered=await image(page),pixels=await raw(rendered);let changed=0,max=0;
  for(let i=0;i<pixels.length;i+=4){const d=Math.max(Math.abs(base[i]-pixels[i]),Math.abs(base[i+1]-pixels[i+1]),Math.abs(base[i+2]-pixels[i+2]));if(d>0)changed++;max=Math.max(d,max);}
  differences[id]={changed,max};expect(changed,`${id} must change actual pixels`).toBeGreaterThan(0);
  await writeFile(`${output}/${id}-positive.png`,rendered);
  if(id!=="eyeRedness"){await strength(page,-65);const negative=await image(page);expect(negative.equals(rendered),`${id} must have bidirectional effects`).toBeFalsy();await writeFile(`${output}/${id}-negative.png`,negative);}
  await page.getByRole("button",{name:"항목 초기화",exact:true}).click();await ready(page);
  expect((await raw(await image(page))).equals(base),`${id} neutral returns to original`).toBeTruthy();
 }
 await writeFile(`${output}/pixel-checks.json`,JSON.stringify(differences,null,2));
 // Rapid input tests the generation guard; latest state wins.
 await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:"얼굴형",exact:true}).click();
 for(const n of [80,-60,20,0,45])await page.locator("#retouch-strength").fill(String(n));await ready(page);
 const latest=await image(page);await strength(page,0);await strength(page,45);expect((await image(page)).equals(latest)).toBeTruthy();
 const compare=page.getByRole("button",{name:"누르고 원본 비교"});const rect=await compare.boundingBox();await page.mouse.move(rect!.x+10,rect!.y+10);await page.mouse.down();
 expect((await raw(await image(page))).equals(base)).toBeTruthy();await page.mouse.up();expect((await image(page)).equals(latest)).toBeTruthy();
 const downloaded=page.waitForEvent("download");await page.getByRole("button",{name:"PNG 저장",exact:true}).click();const download=await downloaded;await download.saveAs(`${output}/saved.png`);
 const saved=sharp(`${output}/saved.png`),meta=await saved.metadata(),source=await sharp(fixture).metadata();expect([meta.width,meta.height]).toEqual([source.width,source.height]);
 if(meta.width!<=1600&&meta.height!<=1600)expect((await saved.ensureAlpha().raw().toBuffer()).equals(await raw(latest))).toBeTruthy();
 await page.screenshot({path:`${output}/mobile.png`,fullPage:true});expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test("multiple-face settings, protection, touch restoration, zoom/pan and reset",async({page})=>{
 test.skip(!existsSync(fixture),"Private local fixture required");await open(page);
 const first=await image(page),firstRaw=await raw(first);
 const second=page.getByRole("button",{name:"얼굴 2",exact:true});test.skip(!await second.count(),"Use a two-face fixture for this scenario");
 await strength(page,70);const edited=await image(page);
 // Face 2 is far from the first: its right half stays exactly unchanged.
 const a=await sharp(first).extract({left:Math.floor((await sharp(first).metadata()).width!/2),top:0,width:Math.floor((await sharp(first).metadata()).width!/2),height:(await sharp(first).metadata()).height!}).raw().toBuffer();
 const b=await sharp(edited).extract({left:Math.floor((await sharp(edited).metadata()).width!/2),top:0,width:Math.floor((await sharp(edited).metadata()).width!/2),height:(await sharp(edited).metadata()).height!}).raw().toBuffer();expect(b.equals(a)).toBeTruthy();
 await second.click();expect(await page.locator("#retouch-strength").inputValue()).toBe("0");await strength(page,-40);
 await page.getByRole("button",{name:"얼굴 1",exact:true}).click();expect(await page.locator("#retouch-strength").inputValue()).toBe("70");
 // Restore face 2 to isolate the first-face touch scenario.
 await second.click();await strength(page,0);await page.getByRole("button",{name:"얼굴 1",exact:true}).click();
 const beforeTouch=await image(page);await page.getByRole("button",{name:"터치 보정",exact:true}).click();
 const canvas=page.locator('canvas[aria-label="보정 미리보기"]'),box=await canvas.boundingBox();const x=box!.x+box!.width*.13,y=box!.y+box!.height*.46;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+8,y,{steps:5});await page.mouse.up();await ready(page);
 expect((await image(page)).equals(beforeTouch)).toBeFalsy();
 await page.getByRole("button",{name:"얼굴 보정",exact:true}).click();await strength(page,25);
 const changedFaceTouch=await image(page);
 await page.getByRole("button",{name:"부분 복원",exact:true}).click();await page.locator("#brush-size").fill("4.5");
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+4,y,{steps:3});await page.mouse.up();await ready(page);
 expect((await image(page)).equals(changedFaceTouch)).toBeFalsy();expect((await raw(await image(page))).equals(firstRaw)).toBeFalsy();
 await page.getByRole("button",{name:"＋",exact:true}).click();await expect(page.getByText("1.5×",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"사진 이동",exact:true}).click();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,y+15);await page.mouse.up();
 await page.getByRole("button",{name:"맞춤",exact:true}).click();await expect(page.getByText("1.0×",{exact:true})).toBeVisible();
 page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"선택 얼굴 전체 초기화",exact:true}).click();await ready(page);expect((await raw(await image(page))).equals(firstRaw)).toBeTruthy();
});

test("failure retains original and rejects unsupported formats",async({page})=>{
 const path=resolve(output,"blank.png");await mkdir(output,{recursive:true});await sharp({create:{width:320,height:240,channels:3,background:"#b5c7d8"}}).png().toFile(path);
 await page.goto("/retouch");await page.getByLabel("사진 열기",{exact:true}).setInputFiles(path);
 await expect(page.locator("main").getByRole("alert")).toContainText("얼굴",{timeout:100_000});
 await expect(page.locator("img[alt='업로드한 원본']")).toBeVisible();
 await page.getByLabel("사진 열기",{exact:true}).setInputFiles({name:"wrong.gif",mimeType:"image/gif",buffer:Buffer.from("GIF89a")});await expect(page.locator("main").getByRole("alert")).toContainText("JPEG 또는 PNG");
});

test("mobile touch cancel, pinch and narrow-screen navigation",async({browser,browserName})=>{
 test.skip(browserName!=="chromium","CDP touch injection requires Chromium; real iOS gestures remain a device check.");
 test.skip(!existsSync(fixture),"Private fixture required");
 for(const viewport of [{width:390,height:844},{width:320,height:568}]){
  const context=await browser.newContext({viewport,hasTouch:true,isMobile:true,storageState:process.env.RETOUCH_STORAGE_STATE});const page=await context.newPage();
  await page.goto(`${process.env.RETOUCH_BASE_URL??"http://127.0.0.1:3100"}/retouch`);
  await page.getByLabel("사진 열기",{exact:true}).setInputFiles(fixture);await expect(page.getByRole("button",{name:"얼굴 1",exact:true})).toBeVisible({timeout:100_000});await ready(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  const baseline=await image(page);await page.getByRole("button",{name:"터치 보정",exact:true}).click();
  const box=await page.locator('canvas[aria-label="보정 미리보기"]').boundingBox(),x=box!.x+box!.width*.13,y=box!.y+box!.height*.46;
  const cdp=await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,id:1}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+6,y,id:1}]});await ready(page);
  expect((await image(page)).equals(baseline)).toBeFalsy();
  await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});await ready(page);expect((await image(page)).equals(baseline)).toBeTruthy();
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,id:1},{x:x+40,y,id:2}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x-10,y,id:1},{x:x+50,y,id:2}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await expect(page.getByText("1.5×",{exact:true})).toBeVisible();expect((await image(page)).equals(baseline)).toBeTruthy();
  await page.getByRole("button",{name:"맞춤",exact:true}).click();
  await page.getByRole("button",{name:"얼굴 보정",exact:true}).click();await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:"눈",exact:true}).click();
  await page.locator('[data-control="eyeOuter"]').click();await strength(page,35);
  const detected=await detectedLandmarks(page),eye=detected[0].landmarks[33];
  await page.getByRole("button",{name:"터치 보정",exact:true}).click();await page.locator('#brush-size').fill('1');await page.locator('canvas[aria-label="보정 미리보기"]').scrollIntoViewIfNeeded();
  const touchRect=await page.locator('canvas[aria-label="보정 미리보기"]').boundingBox(),tx=touchRect!.x+eye.x*touchRect!.width,ty=touchRect!.y+eye.y*touchRect!.height;
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:tx,y:ty,id:1}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:tx+6,y:ty,id:1}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await ready(page);
  const edited=await image(page);
  await page.getByRole("button",{name:"부분 복원",exact:true}).click();await page.locator('#brush-size').fill('4.5');await page.locator('canvas[aria-label="보정 미리보기"]').scrollIntoViewIfNeeded();
  const rect=await page.locator('canvas[aria-label="보정 미리보기"]').boundingBox(),ex=rect!.x+eye.x*rect!.width,ey=rect!.y+eye.y*rect!.height;
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:ex,y:ey,id:1}]});await ready(page);expect((await image(page)).equals(edited)).toBeFalsy();
  await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});await ready(page);expect((await image(page)).equals(edited)).toBeTruthy();
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:ex,y:ey,id:1}]});await ready(page);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:ex,y:ey,id:1},{x:ex+35,y:ey,id:2}]});await ready(page);expect((await image(page)).equals(edited)).toBeTruthy();
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});

  await page.screenshot({path:`${output}/mobile-${viewport.width}.png`,fullPage:true});await context.close();
 }
});

test("large photo export preserves original resolution and GPU failure keeps source",async({page})=>{
 test.skip(!existsSync(fixture),"Private fixture required");
 const large=resolve(output,"large.jpg");await mkdir(output,{recursive:true});await sharp(fixture).resize({width:4096}).jpeg({quality:92}).toFile(large);
 await open(page,large);await strength(page,30);const previewMeta=await sharp(await image(page)).metadata();expect(previewMeta.width).toBe(1600);
 const downloaded=page.waitForEvent("download");await page.getByRole("button",{name:"PNG 저장",exact:true}).click();const download=await downloaded;await download.saveAs(`${output}/large-saved.png`);
 const saved=await sharp(`${output}/large-saved.png`).metadata(),original=await sharp(large).metadata();expect([saved.width,saved.height]).toEqual([original.width,original.height]);
 await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext());
 await page.locator("#retouch-strength").fill("40");await expect(page.locator("main").getByRole("alert")).toContainText("원본",{timeout:100_000});
 await expect(page.locator('canvas[aria-label="보정 미리보기"]')).toBeHidden();await expect(page.locator("img[alt='업로드한 원본']")).toBeVisible();await expect(page.getByRole("button",{name:"PNG 저장",exact:true})).toBeDisabled();
});

async function detectedLandmarks(page:Page):Promise<Face[]>{
 return page.evaluate(async()=>{
  const blob=await fetch((document.querySelector("img[alt='업로드한 원본']") as HTMLImageElement).src).then(r=>r.blob());const bitmap=await createImageBitmap(blob);
  const landmarks=await new Promise<{x:number;y:number}[][]>((resolve,reject)=>{const worker=new Worker("/retouch/detect.worker.js");worker.onmessage=e=>{worker.terminate();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.landmarks);};worker.onerror=()=>{worker.terminate();reject(new Error("fixture detector failed"));};worker.postMessage({bitmap},[bitmap]);});
  return landmarks.sort((a,b)=>a[1].x-b[1].x).map((landmarks,i)=>({id:`face-${i+1}`,landmarks}));
 });
}
test("real facial-feature anchors and irises are protected",async({page})=>{
 test.skip(!existsSync(fixture),"Private fixture required");await open(page);const original=await raw(await image(page)),meta=await sharp(await image(page)).metadata(),faces=await detectedLandmarks(page);
 await strength(page,65);let rendered=await raw(await image(page));
 function samePatch(index:number,size=2){const p=faces[0].landmarks[index],cx=Math.round(p.x*meta.width!),cy=Math.round(p.y*meta.height!);for(let y=cy-size;y<=cy+size;y++)for(let x=cx-size;x<=cx+size;x++){const i=(y*meta.width!+x)*4;expect([...rendered.subarray(i,i+4)],`protected landmark ${index}`).toEqual([...original.subarray(i,i+4)]);}}
 for(const i of [468,473,1,13,14])samePatch(i);
 await strength(page,0);await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:"눈",exact:true}).click();await page.locator('[data-control="eyeRedness"]').click();await strength(page,100);rendered=await raw(await image(page));samePatch(468);samePatch(473);
});

test("nearby-face protection and simulated occlusion limitations",async({page})=>{
 test.skip(!existsSync(fixture),"Default four-face fixture required");
 const source=await sharp(fixture).metadata();test.skip(source.width!==1536||source.height!==1024,"This stress fixture uses the default photo coordinates");
 const first=await sharp(fixture).extract({left:30,top:200,width:340,height:420}).png().toBuffer();const second=await sharp(fixture).extract({left:420,top:200,width:340,height:420}).png().toBuffer();
 const close=resolve(output,"nearby.png");await sharp({create:{width:615,height:420,channels:3,background:"#c4c4c4"}}).composite([{input:first,left:0,top:0},{input:second,left:275,top:0}]).png().toFile(close);
 await open(page,close);await expect(page.getByRole("button",{name:"얼굴 2",exact:true})).toBeVisible();
 const faces=await detectedLandmarks(page),baseline=await image(page),base=await raw(baseline);await strength(page,100);
 const rendered=await image(page),pixels=await raw(rendered),area=faceArea(faces[1],615,420);
 let protectedCount=0,changedProtected=0;for(let y=0;y<420;y++)for(let x=0;x<615;x++)if(regionDistance({x:x+.5,y:y+.5},area)<1){const i=(y*615+x)*4;if(!pixels.subarray(i,i+4).equals(base.subarray(i,i+4)))changedProtected++;protectedCount++;}expect(protectedCount).toBeGreaterThan(1000);expect(changedProtected).toBe(0);
 await writeFile(`${output}/nearby-before.png`,baseline);await writeFile(`${output}/nearby-after.png`,rendered);await expect(page.getByText("다른 얼굴과 가까운 변형은 보호 영역에서 제한돼요.")).toBeVisible();
 const covered=resolve(output,"occluded.png");const cover=await sharp({create:{width:66,height:36,channels:3,background:"#bfc3c5"}}).png().toBuffer();await sharp(fixture).composite([{input:cover,left:125,top:350}]).png().toFile(covered);
 page.once("dialog",d=>d.accept());await page.getByLabel("사진 열기",{exact:true}).setInputFiles(covered);await expect(page.getByRole("button",{name:"얼굴 1",exact:true})).toBeVisible({timeout:100_000});await ready(page);
 const occludedBefore=await image(page);await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:"눈",exact:true}).click();await page.locator('[data-control="eyeSize"]').click();await strength(page,65);const occludedAfter=await image(page);
 await writeFile(`${output}/occluded-before.png`,occludedBefore);await writeFile(`${output}/occluded-after.png`,occludedAfter);
 // This test checks source retention, not ownership of the covering object.
 await expect(page.locator("img[alt='업로드한 원본']")).toBeVisible();expect(occludedBefore.equals(occludedAfter)).toBeFalsy();
 await page.screenshot({path:`${output}/occluded-screen.png`,fullPage:true});
});

test("calculation Worker failure keeps original and permits retry",async({page})=>{
 test.skip(!existsSync(fixture),"Private fixture required");
 await page.route(/(?:field_worker_ts|turbopack-worker-).*\.js/,route=>route.abort());await page.goto("/retouch");await page.getByLabel("사진 열기",{exact:true}).setInputFiles(fixture);
 await expect(page.getByRole("button",{name:"얼굴 1",exact:true})).toBeVisible({timeout:100_000});await expect(page.locator("main").getByRole("alert")).toContainText("Worker",{timeout:100_000});
 await expect(page.locator('canvas[aria-label="보정 미리보기"]')).toBeHidden();await expect(page.locator("img[alt='업로드한 원본']")).toBeVisible();await expect(page.locator("#retouch-strength")).toBeEnabled();await expect(page.getByRole("button",{name:"PNG 저장",exact:true})).toBeDisabled();
 await page.unroute(/(?:field_worker_ts|turbopack-worker-).*\.js/);await strength(page,40);await expect(page.locator('canvas[aria-label="보정 미리보기"]')).toBeVisible();
});

test("small detected neighbor is protected while excluded from editing",async({page})=>{
 test.skip(!existsSync(fixture),"Default four-face fixture required");
 const source=await sharp(fixture).metadata();test.skip(source.width!==1536||source.height!==1024,"Default photo coordinates required");
 await mkdir(output,{recursive:true});
 const first=await sharp(fixture).extract({left:30,top:200,width:340,height:420}).png().toBuffer();
 const second=await sharp(fixture).extract({left:420,top:200,width:340,height:420}).resize(170,210).png().toBuffer();
 const path=resolve(output,"small-neighbor.png");await sharp({create:{width:415,height:420,channels:3,background:"#c4c4c4"}}).composite([{input:first,left:0,top:0},{input:second,left:245,top:110}]).png().toFile(path);
 await open(page,path);const faces=await detectedLandmarks(page);expect(faces).toHaveLength(2);
 await expect(page.getByRole("button",{name:"얼굴 2",exact:true})).toHaveCount(0);await expect(page.getByText(/너무 작은 얼굴은 제외/)).toBeVisible();
 const before=await image(page),base=await raw(before);await strength(page,100);const after=await image(page),pixels=await raw(after),area=faceArea(faces[1],415,420);
 let protectedCount=0,changedProtected=0;for(let y=0;y<420;y++)for(let x=0;x<415;x++)if(regionDistance({x:x+.5,y:y+.5},area)<1){const i=(y*415+x)*4;if(!pixels.subarray(i,i+4).equals(base.subarray(i,i+4)))changedProtected++;protectedCount++;}
 expect(protectedCount).toBeGreaterThan(1000);expect(changedProtected).toBe(0);expect(after.equals(before)).toBeFalsy();
 await writeFile(`${output}/small-neighbor-before.png`,before);await writeFile(`${output}/small-neighbor-after.png`,after);
 // Inject a known small detection overlapping an eye to isolate color-mask
 // ownership, independently of whether the detector recognizes occluded faces.
 const eye=faces[0].landmarks[468],center=faces[0].landmarks[1];
 const nested=faces[0].landmarks.map(p=>({...p,x:eye.x+(p.x-center.x)*.2,y:eye.y+(p.y-center.y)*.2}));
 await page.route("**/retouch/detect.worker.js",route=>route.fulfill({contentType:"application/javascript",body:`self.onmessage=({data:{bitmap}})=>{bitmap.close();self.postMessage({landmarks:${JSON.stringify([faces[0].landmarks,nested])}});};`}));
 page.once("dialog",d=>d.accept());await page.getByLabel("사진 열기",{exact:true}).setInputFiles(path);await ready(page);
 const maskBase=await raw(await image(page));await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:"눈",exact:true}).click();await page.locator('[data-control="eyeRedness"]').click();await strength(page,100);
 const masked=await raw(await image(page)),nestedArea=faceArea({id:"small",landmarks:nested},415,420);
 let changedMask=0;for(let y=0;y<420;y++)for(let x=0;x<415;x++)if(regionDistance({x,y},nestedArea)<.9){const i=(y*415+x)*4;if(!masked.subarray(i,i+4).equals(maskBase.subarray(i,i+4)))changedMask++;}
 expect(changedMask).toBe(0);expect(masked.equals(maskBase)).toBeFalsy();
});

test("slider and touch render continuously before the pointer is released",async({page})=>{
 test.skip(!existsSync(fixture),"Default four-face fixture required");await open(page);
 const source=await sharp(fixture).metadata();test.skip(source.width!==1536||source.height!==1024,"Default photo coordinates required");
 await page.evaluate(()=>{
  const draw=WebGL2RenderingContext.prototype.drawArrays;
  (window as unknown as {retouchFrames:number[]}).retouchFrames=[];
  WebGL2RenderingContext.prototype.drawArrays=function(...args:Parameters<typeof draw>){(window as unknown as {retouchFrames:number[]}).retouchFrames.push(performance.now());return draw.apply(this,args);};
 });
 const slider=await page.evaluate(async()=>{
  const input=document.querySelector<HTMLInputElement>('#retouch-strength')!,set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  const frames=(window as unknown as {retouchFrames:number[]}).retouchFrames;frames.length=0;const started=performance.now();
  for(let i=0;i<60;i++){set.call(input,String(10+i));input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,16));}
  return {duration:performance.now()-started,frames:frames.map(t=>t-started)};
 });
 expect(slider.frames.length,"moving slider must publish frames during input").toBeGreaterThan(8);
 expect(slider.frames[0],"first slider update latency").toBeLessThan(250);
 await ready(page);await writeFile(`${output}/live-slider.png`,await image(page));
 await strength(page,0);await page.getByRole("button",{name:"터치 보정",exact:true}).click();await page.locator('#brush-size').fill('3');
 const base=await image(page),box=await page.locator('canvas[aria-label="보정 미리보기"]').boundingBox(),x=box!.x+box!.width*.13,y=box!.y+box!.height*.46;
 await page.evaluate(()=>{(window as unknown as {retouchFrames:number[]}).retouchFrames.length=0;});
 await page.mouse.move(x,y);await page.mouse.down();
 for(let i=1;i<=50;i++){await page.mouse.move(x+Math.sin(i*.12)*12,y+i*.15);await page.waitForTimeout(16);}
 // Read pixels while the pointer is still down: a deferred mouse-up-only result
 // would remain identical to the starting image and publish no ongoing frames.
 const during=await image(page),touchFrames=await page.evaluate(()=>(window as unknown as {retouchFrames:number[]}).retouchFrames);
 expect(during.equals(base)).toBeFalsy();expect(touchFrames.length).toBeGreaterThan(8);
 await page.mouse.up();await ready(page);await writeFile(`${output}/live-touch.png`,await image(page));
 await writeFile(`${output}/live-timings.json`,JSON.stringify({slider,touchFrames:touchFrames.length},null,2));
});


test("five strength levels per control and mixed extremes use actual pixels",async({page})=>{
 test.setTimeout(240_000);
 test.skip(!existsSync(fixture),"Private fixture required");await mkdir(output,{recursive:true});await open(page);
 const base=await raw(await image(page)),report:Record<string,number[]>={};
 for(const [id,,group] of controls){
  await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:group,exact:true}).click();await page.locator(`[data-control="${id}"]`).click();
  report[id]=[];const values=id==="eyeRedness"?[0,25,50,75,100]:[-100,-50,0,50,100];
  for(const value of values){await strength(page,value);const bytes=await image(page),pixels=await raw(bytes);let changed=0;
   for(let i=0;i<pixels.length;i+=4)if(!pixels.subarray(i,i+4).equals(base.subarray(i,i+4)))changed++;
   report[id].push(changed);if(value===0)expect(pixels.equals(base),`${id} neutral`).toBeTruthy();else expect(changed,`${id} ${value}`).toBeGreaterThan(0);
   await writeFile(`${output}/${id}-${value}.png`,bytes);
  }
  await strength(page,0);
 }
 for(const sign of [-1,1]){
  for(const [id,,group] of controls){await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:group,exact:true}).click();await page.locator(`[data-control="${id}"]`).click();await strength(page,id==="eyeRedness"?100:sign*100);}
  await writeFile(`${output}/combination-${sign}.png`,await image(page));
  page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"선택 얼굴 전체 초기화",exact:true}).click();await ready(page);expect((await raw(await image(page))).equals(base)).toBeTruthy();
 }
 await writeFile(`${output}/five-level-checks.json`,JSON.stringify(report,null,2));
});

test("restore preserves geometry and redness and permits new edits",async({page})=>{
 test.skip(!existsSync(fixture),"Private fixture required");await mkdir(output,{recursive:true});await open(page);
 const original=await image(page),base=await raw(original),meta=await sharp(original).metadata(),faces=await detectedLandmarks(page);
 await writeFile(`${output}/landmarks.json`,JSON.stringify(faces));
 const iris=faces[0].landmarks[468],box=await page.locator('canvas[aria-label="보정 미리보기"]').boundingBox(),cx=box!.x+iris.x*box!.width,cy=box!.y+iris.y*box!.height;
 const select=async(id:string)=>{await page.getByRole("button",{name:"얼굴 보정",exact:true}).click();await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:"눈",exact:true}).click();await page.locator(`[data-control="${id}"]`).click();};
 const patch=(pixels:Buffer)=>{const rows:Buffer[]=[];for(let y=Math.round(iris.y*meta.height!)-10;y<=Math.round(iris.y*meta.height!)+10;y++){const x=Math.round(iris.x*meta.width!)-10;rows.push(pixels.subarray((y*meta.width!+x)*4,(y*meta.width!+x+21)*4));}return Buffer.concat(rows);};
 await select("eyeSize");await strength(page,70);await select("eyeRedness");await strength(page,75);const before=await image(page);
 expect(patch(await raw(before)).equals(patch(base))).toBeFalsy();
 await page.getByRole("button",{name:"부분 복원",exact:true}).click();await page.locator("#brush-size").fill("4.5");
 await page.mouse.move(cx-8,cy);await page.mouse.down();await page.mouse.move(cx+8,cy);await page.mouse.up();await ready(page);
 const restored=await image(page);expect((await raw(restored)).equals(await raw(before))).toBeTruthy();
 await page.getByRole("button",{name:"선택 얼굴 터치 초기화",exact:true}).click();await ready(page);expect((await image(page)).equals(restored)).toBeTruthy();
 await select("eyeSize");await strength(page,80);const newSize=await image(page);expect(patch(await raw(newSize)).equals(patch(base))).toBeFalsy();
 await select("eyeRedness");await strength(page,100);const newColor=await image(page);expect((await raw(newColor)).equals(await raw(newSize))).toBeFalsy();
 await page.getByRole("button",{name:"터치 보정",exact:true}).click();await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+5,cy,{steps:4});await page.mouse.up();await ready(page);expect((await image(page)).equals(newColor)).toBeFalsy();
 const after=await image(page),downloaded=page.waitForEvent("download");await page.getByRole("button",{name:"PNG 저장",exact:true}).click();await (await downloaded).saveAs(`${output}/restore-saved.png`);
 if(meta.width!<=1600&&meta.height!<=1600)expect((await sharp(`${output}/restore-saved.png`).ensureAlpha().raw().toBuffer()).equals(await raw(after))).toBeTruthy();
 for(const [name,bytes] of [["restore-original",original],["restore-before",before],["restore-after",restored],["restore-new-size",newSize],["restore-new-color",newColor],["restore-new-touch",after]] as const)await writeFile(`${output}/${name}.png`,bytes);
});


test("whole feature areas preserve shape, irises and makeup on the photo",async({page})=>{
 test.skip(!existsSync(fixture),"Private fixture required");await open(page);
 const meta=await sharp(await image(page)).metadata(),w=meta.width!,h=meta.height!,faces=await detectedLandmarks(page),face=faces[0],f=frame(face,w,h);
 const base=await raw(await image(page));
 for(const [id,loops] of [["eyeHeight",eyeLoops],["browHeight",browLoops]] as const)for(const value of [-100,-50,0,50,100]){
  const plan=prepare(faces,setControl(initialState(faces),face.id,id,value),w,h),ops=plan.operations;
  loops.forEach((loop,side)=>{for(const i of loop){const p=f.points[i],o=ops[side];if(!o)continue;
   const target={x:p.x-o.dy*Math.sin(f.angle),y:p.y+o.dy*Math.cos(f.angle)},q=mapPoint(target,plan);expect(Math.hypot(q.x-p.x,q.y-p.y),`${id} ${value} whole feature`).toBeLessThan(.001);
  }});
 }
 const select=async(id:string,group:string)=>{await page.getByRole("navigation",{name:"보정 부위"}).getByRole("button",{name:group,exact:true}).click();await page.locator(`[data-control="${id}"]`).click();};
 const check=(pixels:Buffer,contains:(p:{x:number;y:number})=>boolean)=>{let count=0,changed=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(contains({x:x+.5,y:y+.5})){const i=(y*w+x)*4;count++;if(!pixels.subarray(i,i+4).equals(base.subarray(i,i+4)))changed++;}expect(count).toBeGreaterThan(5);expect(changed).toBe(0);};
 const {regionDistance}=await import("../../src/features/face-retouch/engine/field");
 await select("faceWidth","얼굴형");await strength(page,100);
 const regions=operations(face,setControl(initialState([face]),face.id,"faceWidth",100).settings[face.id],w,h)[0].exclusions.slice(0,2);
 check(await raw(await image(page)),p=>regions.some(r=>regionDistance(p,r)<.85));await strength(page,0);
 for(const id of ["eyeThickness","eyeLength","eyeInner","eyeOuter","eyeLower","eyeRedness"]){await select(id,"눈");await strength(page,100);
  check(await raw(await image(page)),p=>[468,473].some(start=>{const r=Math.max(...[1,2,3,4].map(k=>Math.hypot(f.points[start+k].x-f.points[start].x,f.points[start+k].y-f.points[start].y)));return Math.hypot(p.x-f.points[start].x,p.y-f.points[start].y)<r*.8;}));await strength(page,0);
 }
 await select("noseAlar","코");await strength(page,100);
 expect((await raw(await image(page))).equals(base)).toBeFalsy();
});

test("touch feedback: live magnifier, direction, strength and per-gesture undo",async({page})=>{
 test.skip(!existsSync(fixture),"Private local fixture required");
 await mkdir(output,{recursive:true});await open(page);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'터치 보정',exact:true}).click();
 await expect(page.locator('#brush-size')).toHaveValue('4');
 await expect(page.locator('#brush-size')).toHaveAttribute('min','1');
 await expect(page.locator('#brush-size')).toHaveAttribute('max','20');
 await expect(page.locator('#touch-strength')).toHaveValue('6');
 await expect(page.locator('#touch-strength')).toHaveAttribute('min','2');
 await expect(page.locator('#touch-strength')).toHaveAttribute('max','20');
 await page.locator('#brush-size').fill('20');await page.locator('#touch-strength').fill('6');
 const source=page.locator('canvas[aria-label="보정 미리보기"]');await source.scrollIntoViewIfNeeded();
 const box=(await source.boundingBox())!,x=box.x+box.width*.13,y=box.y+box.height*.46;
 const baseline=await image(page);
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+9,y-3,{steps:5});await ready(page);
 await expect(page.getByTestId('touch-direction')).toBeVisible();
 const lens=page.getByTestId('touch-magnifier');await expect(lens).toBeVisible();
 // Compare the lens with the completed main frame, not just its initial contents.
 const sameFrame=await page.evaluate(({x,y})=>{
  const src=document.querySelector<HTMLCanvasElement>('canvas[aria-label="보정 미리보기"]')!;
  const dest=document.querySelector<HTMLCanvasElement>('canvas[aria-label="터치 위치 확대 보기"]')!;
  const rect=src.getBoundingClientRect(),span=dest.clientWidth/rect.width*src.width/2;
  const guide=document.querySelector<SVGSVGElement>('[data-testid="touch-guide"]')!,circle=guide.querySelector(':scope > circle') as SVGCircleElement;
  const actualX=rect.left+circle.cx.baseVal.value/guide.viewBox.baseVal.width*rect.width;
  const actualY=rect.top+circle.cy.baseVal.value/guide.viewBox.baseVal.height*rect.height;
  const cursorError=Math.max(Math.abs(x-actualX),Math.abs(y-actualY));
  const expected=document.createElement('canvas');expected.width=dest.width;expected.height=dest.height;
  const ctx=expected.getContext('2d')!;ctx.fillStyle='#171719';ctx.fillRect(0,0,expected.width,expected.height);
  ctx.drawImage(src,(actualX-rect.left)/rect.width*src.width-span/2,(actualY-rect.top)/rect.height*src.height-span/2,span,span,0,0,expected.width,expected.height);
  const a=ctx.getImageData(0,0,dest.width,dest.height).data,b=dest.getContext('2d')!.getImageData(0,0,dest.width,dest.height).data;
  let max=0,total=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);total+=d;}
  return {max,mean:total/a.length,cursorError};
 },{x:x+9,y:y-3});
 // WebKit rounds input to CSS pixels; compare the displayed cursor crop.
 expect(sameFrame.cursorError).toBeLessThanOrEqual(1);
 console.log("lens comparison",sameFrame);expect(sameFrame.max).toBeLessThanOrEqual(1);expect(sameFrame.mean).toBeLessThan(.001);
 const weak=await image(page);expect(weak.equals(baseline)).toBeFalsy();
 await page.screenshot({path:`${output}/touch-feedback-active.png`,fullPage:true});
 await page.mouse.up();await ready(page);await expect(lens).toHaveCount(0);
 expect((await image(page)).equals(weak)).toBeTruthy();
 await page.getByRole('button',{name:'마지막 터치 취소',exact:true}).click();await ready(page);
 expect((await image(page)).equals(baseline)).toBeTruthy();
 await page.locator('#touch-strength').fill('20');await source.scrollIntoViewIfNeeded();
 const b=(await source.boundingBox())!,sx=b.x+b.width*.13,sy=b.y+b.height*.46;
 await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+9,sy-3,{steps:5});await page.mouse.up();await ready(page);
 const strong=await image(page);expect(strong.equals(weak)).toBeFalsy();
 await page.getByRole('button',{name:'부분 복원',exact:true}).click();await page.locator('#brush-size').fill('20');await source.scrollIntoViewIfNeeded();
 const r=(await source.boundingBox())!;await page.mouse.click(r.x+r.width*.13,r.y+r.height*.46);await ready(page);
 expect((await image(page)).equals(strong)).toBeFalsy();
 await page.getByRole('button',{name:'마지막 터치 취소',exact:true}).click();await ready(page);
 expect((await image(page)).equals(strong)).toBeTruthy();
 // Later facial edits survive undoing the earlier touch.
 await page.getByRole('button',{name:'얼굴 보정',exact:true}).click();await strength(page,25);
 await page.getByRole('button',{name:'터치 보정',exact:true}).click();
 await page.getByRole('button',{name:'마지막 터치 취소',exact:true}).click();await ready(page);
 await page.getByRole('button',{name:'얼굴 보정',exact:true}).click();await expect(page.locator('#retouch-strength')).toHaveValue('25');
 await strength(page,0);expect((await image(page)).equals(baseline)).toBeTruthy();
 await page.getByRole('button',{name:'터치 보정',exact:true}).click();await source.scrollIntoViewIfNeeded();
 const last=(await source.boundingBox())!,lx=last.x+last.width*.13,ly=last.y+last.height*.46;
 await page.mouse.move(lx,ly);await page.mouse.down();await page.mouse.move(lx+6,ly,{steps:3});await ready(page);
 expect((await image(page)).equals(baseline)).toBeFalsy();
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await ready(page);
 expect((await image(page)).equals(baseline)).toBeTruthy();await expect(lens).toHaveCount(0);
 await page.mouse.up();await expect(page.getByRole('button',{name:'마지막 터치 취소',exact:true})).toBeDisabled();
 expect(errors).toEqual([]);
});

test('lip fullness changes only lip tissue and leaves philtrum, chin and mouth cavity pixels intact',async({page})=>{
 test.skip(!existsSync(fixture),'Private frontal photo required');await mkdir(output,{recursive:true});await open(page);
 const {lipOuterLoop,lipInnerLoop}=await import('../../src/features/face-retouch/effects/lips');
 const faces=await detectedLandmarks(page),face=faces[0];
 await page.getByRole('navigation',{name:'보정 부위'}).getByRole('button',{name:'입술',exact:true}).click();await page.locator('[data-control="lipFullness"]').click();
 const before=await image(page),base=await raw(before),meta=await sharp(before).metadata(),width=meta.width!,height=meta.height!;
 const outer=lipOuterLoop.map(i=>({x:face.landmarks[i].x*width,y:face.landmarks[i].y*height})),inner=lipInnerLoop.map(i=>({x:face.landmarks[i].x*width,y:face.landmarks[i].y*height}));
 for(const value of [-100,100]){
  await strength(page,value);const after=await image(page),pixels=await raw(after);let changed=0;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==base[i]||pixels[i+1]!==base[i+1]||pixels[i+2]!==base[i+2]){
   const p={x:(i/4)%width+.5,y:Math.floor(i/4/width)+.5};
   expect(insidePolygon(p,outer)&&!insidePolygon(p,inner),`outside-lip change at ${p.x},${p.y}`).toBeTruthy();changed++;
  }
  expect(changed).toBeGreaterThan(20);await writeFile(`${output}/lip-only-${value}.png`,after);
 }
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'PNG 저장',exact:true}).click();const saved=await download;await saved.saveAs(`${output}/lip-only-saved.png`);
 expect((await raw(await image(page))).equals(await sharp(`${output}/lip-only-saved.png`).ensureAlpha().raw().toBuffer())).toBeTruthy();
 await strength(page,0);expect((await image(page)).equals(before)).toBeTruthy();await writeFile(`${output}/lip-only-original.png`,before);
});
