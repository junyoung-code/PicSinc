import {test,expect,type Page} from '@playwright/test';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import type {Prepared} from '../../src/features/face-retouch/engine/field';
import {regionDistance} from '../../src/features/face-retouch/engine/field';

const fixture=process.env.RETOUCH_FIXTURE??'test-images/four-women-20260915/01-original.png';
const output=process.env.RETOUCH_OUTPUT??'private/face-shape-20261110/browser';
async function ready(page:Page){
 await expect(page.getByRole('button',{name:'PNG 저장',exact:true})).toBeEnabled({timeout:100_000});
 await expect(page.locator('main [role="alert"]')).toHaveCount(0);
}
async function snapshot(page:Page){
 return Buffer.from(await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.toDataURL('image/png').split(',')[1]),'base64');
}

test('face shape real-photo sliders, eye protection, neutral roundtrip and PNG output',async({page})=>{
 test.skip(!existsSync(fixture),'Local private photo required; never commit the fixture.');
 await mkdir(output,{recursive:true});const original=await readFile(fixture),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const send=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message:{plan?:unknown},options?:StructuredSerializeOptions|Transferable[]){
   if(message?.plan)(window as unknown as {shapePlan:unknown}).shapePlan=message.plan;
   const forward=send.bind(this);return Array.isArray(options)?forward(message,options):forward(message,options);
  };
 });
 await page.goto('/retouch');await page.getByLabel('사진 열기',{exact:true}).setInputFiles(fixture);await ready(page);
 const base=await snapshot(page),baseRaw=await sharp(base).ensureAlpha().raw().toBuffer(),meta=await sharp(base).metadata();
 await writeFile(`${output}/neutral.png`,base);
 for(const id of ['faceWidth','lowerFace','jawAngle']){
  await page.locator(`[data-control="${id}"]`).click();
  for(const value of [-100,-50,50,100]){
   await page.locator('#retouch-strength').fill(String(value));await ready(page);
   const png=await snapshot(page),raw=await sharp(png).ensureAlpha().raw().toBuffer();
   expect(raw.equals(baseRaw),`${id} ${value} changes real pixels`).toBeFalsy();
   await writeFile(`${output}/${id}-${value}.png`,png);
   const plan=await page.evaluate(()=>(window as unknown as {shapePlan:Prepared}).shapePlan);
   const op=plan.operations.find(o=>o.control===id)!;
   const protectedRegions=Object.entries(plan.areas).filter(([owner])=>owner!==op.owner).map(([,r])=>r);
   if(id==='faceWidth')protectedRegions.push(...op.exclusions.slice(0,2));
   let checked=0,changed=0;
   for(let y=0;y<meta.height!;y++)for(let x=0;x<meta.width!;x++){
    const p={x:(x+.5)/meta.width!*plan.width,y:(y+.5)/meta.height!*plan.height};
    if(!protectedRegions.some(r=>regionDistance(p,r)<.88))continue;
    checked++;const i=(y*meta.width!+x)*4;if(!raw.subarray(i,i+4).equals(baseRaw.subarray(i,i+4)))changed++;
   }
   expect(checked).toBeGreaterThan(0);expect(changed,'eye makeup/neighboring faces remain unchanged').toBe(0);
  }
  await page.locator('#retouch-strength').fill('0');await ready(page);
  expect((await sharp(await snapshot(page)).ensureAlpha().raw().toBuffer()).equals(baseRaw)).toBeTruthy();
 }
 for(const id of ['faceWidth','lowerFace','jawAngle']){
  await page.locator(`[data-control="${id}"]`).click();await page.locator('#retouch-strength').fill('100');await ready(page);
 }
 const combined=await snapshot(page);await writeFile(`${output}/combined.png`,combined);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'PNG 저장',exact:true}).click();
 await (await download).saveAs(`${output}/saved.png`);
 const saved=await sharp(`${output}/saved.png`).metadata(),source=await sharp(original).metadata();
 expect([saved.width,saved.height]).toEqual(source.orientation&&source.orientation>=5?[source.height,source.width]:[source.width,source.height]);
 if(saved.width===meta.width&&saved.height===meta.height)expect((await sharp(`${output}/saved.png`).ensureAlpha().raw().toBuffer()).equals(await sharp(combined).ensureAlpha().raw().toBuffer())).toBeTruthy();
 expect((await readFile(fixture)).equals(original)).toBeTruthy();expect(errors).toEqual([]);
});
