import {test,expect,type Page} from '@playwright/test';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {frame,insidePolygon} from '../../src/features/face-retouch/effects/geometry';
import {eyeContours} from '../../src/features/face-retouch/effects/eyes';
import {lipOuterLoop} from '../../src/features/face-retouch/effects/lips';
import {nostrilContours} from '../../src/features/face-retouch/effects/nose';
import {mapPoint,regionDistance,type Prepared} from '../../src/features/face-retouch/engine/field';
import type {Face,Landmark} from '../../src/features/face-retouch/state/model';

const fixture=process.env.RETOUCH_FIXTURE??'test-images/four-women-20260915/01-original.png';
const output=process.env.RETOUCH_OUTPUT??'private/nose-controls-20261110/browser';
type AuditWindow=Window&{nosePlan:Prepared;noseLandmarks:Landmark[][]};
async function ready(page:Page){await expect(page.getByRole('button',{name:'PNG 저장',exact:true})).toBeEnabled({timeout:100_000});await expect(page.locator('main [role="alert"]')).toHaveCount(0);}
async function snapshot(page:Page){return Buffer.from(await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.toDataURL('image/png').split(',')[1]),'base64');}
async function value(page:Page,id:string,amount:number){await page.locator(`[data-control="${id}"]`).click();await page.locator('#retouch-strength').fill(String(amount));await ready(page);}

test('real-photo nose controls protect lips and neighbors, move nostril edges, reset and save the preview',async({page})=>{
 test.skip(!existsSync(fixture),'Local private fixture required.');await mkdir(output,{recursive:true});
 const original=await readFile(fixture),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const send=Worker.prototype.postMessage,seen=new WeakSet<Worker>();
  Worker.prototype.postMessage=function(message:{plan?:Prepared},options?:StructuredSerializeOptions|Transferable[]){
   if(!seen.has(this)){seen.add(this);this.addEventListener('message',({data})=>{if(data.landmarks)(window as unknown as AuditWindow).noseLandmarks=data.landmarks;});}
   if(message?.plan)(window as unknown as AuditWindow).nosePlan=message.plan;
   const forward=send.bind(this);return Array.isArray(options)?forward(message,options):forward(message,options);
  };
 });
 await page.goto('/retouch');await page.getByLabel('사진 열기',{exact:true}).setInputFiles(fixture);await ready(page);
 const base=await snapshot(page),raw=await sharp(base).ensureAlpha().raw().toBuffer(),meta=await sharp(base).metadata(),w=meta.width!,h=meta.height!;
 const landmarks=await page.evaluate(()=>(window as unknown as AuditWindow).noseLandmarks);
 const face:Face={id:'face-1',landmarks:landmarks.sort((a,b)=>a[1].x-b[1].x)[0]},f=frame(face,w,h);
 const mouthAndEyes=[lipOuterLoop,...eyeContours].map(loop=>loop.map(i=>f.points[i])),holes=nostrilContours.map(loop=>loop.map(i=>f.points[i]));
 await writeFile(`${output}/neutral.png`,base);await page.getByRole('navigation',{name:'보정 부위'}).getByRole('button',{name:'코',exact:true}).click();
 for(const id of ['noseSize','noseAlar','noseBridge','noseDorsum','noseTip']){
  for(const amount of [-100,100]){
   await value(page,id,amount);const png=await snapshot(page),pixels=await sharp(png).ensureAlpha().raw().toBuffer();expect(pixels.equals(raw),`${id} changes actual pixels`).toBeFalsy();
   const plan=await page.evaluate(()=>(window as unknown as AuditWindow).nosePlan),neighbors=Object.entries(plan.areas).filter(([id])=>id!==face.id).map(([,r])=>r),polygons=mouthAndEyes;
   let checked=0,changed=0;const locations:{x:number;y:number;polygons:number[]}[]=[];
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p={x:x+.5,y:y+.5};if(!polygons.some(poly=>insidePolygon(p,poly))&&!neighbors.some(r=>regionDistance(p,r)<.9))continue;
    checked++;const i=(y*w+x)*4;if(!pixels.subarray(i,i+4).equals(raw.subarray(i,i+4))){changed++;if(locations.length<5)locations.push({x,y,polygons:polygons.flatMap((poly,i)=>insidePolygon(p,poly)?[i]:[])});}
   }
   await writeFile(`${output}/${id}-${amount}.png`,png);expect(checked).toBeGreaterThan(100);expect(changed,`${id} protected pixels remain original: ${JSON.stringify(locations)}`).toBe(0);
  }
  await value(page,id,0);expect((await sharp(await snapshot(page)).ensureAlpha().raw().toBuffer()).equals(raw)).toBeTruthy();
 }
 for(const id of ['noseSize','noseLength','noseBridge','noseDorsum','noseTip'])await value(page,id,65);
 const moved=await snapshot(page),movedRaw=await sharp(moved).ensureAlpha().raw().toBuffer(),basePlan=await page.evaluate(()=>(window as unknown as AuditWindow).nosePlan);
 for(const amount of [-100,100]){
  await value(page,'noseAlar',amount);const png=await snapshot(page),pixels=await sharp(png).ensureAlpha().raw().toBuffer();let checked=0,changed=0;
  // Compare pixels of the moved nostrils with the same whole-nose edits alone.
  for(let y=Math.floor(f.points[4].y-20);y<Math.ceil(f.points[2].y+20);y++)for(let x=Math.floor(f.points[98].x-25);x<Math.ceil(f.points[327].x+25);x++){
   const p=mapPoint({x:x+.5,y:y+.5},basePlan);if(!holes.some(poly=>insidePolygon(p,poly)))continue;
   checked++;const i=(y*w+x)*4;if(!pixels.subarray(i,i+4).equals(movedRaw.subarray(i,i+4)))changed++;
  }
  expect(checked).toBeGreaterThan(10);expect(changed,'nostril edges follow the alar adjustment after other nose edits').toBeGreaterThan(0);
  await writeFile(`${output}/combined-${amount}.png`,png);
 }
 const final=await snapshot(page),downloading=page.waitForEvent('download');await page.getByRole('button',{name:'PNG 저장',exact:true}).click();await(await downloading).saveAs(`${output}/saved.png`);
 const saved=await sharp(`${output}/saved.png`).metadata(),source=await sharp(original).metadata();
 expect([saved.width,saved.height]).toEqual(source.orientation&&source.orientation>=5?[source.height,source.width]:[source.width,source.height]);
 if(saved.width===w&&saved.height===h)expect((await sharp(`${output}/saved.png`).ensureAlpha().raw().toBuffer()).equals(await sharp(final).ensureAlpha().raw().toBuffer())).toBeTruthy();
 expect((await readFile(fixture)).equals(original)).toBeTruthy();expect(errors).toEqual([]);
});
