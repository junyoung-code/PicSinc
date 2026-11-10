import {test,expect,type Page} from '@playwright/test';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {frame} from '../../src/features/face-retouch/effects/geometry';
import {irisCircle} from '../../src/features/face-retouch/effects/eyes';
import {mapPoint,type Prepared} from '../../src/features/face-retouch/engine/field';
import type {Face,Landmark,Point} from '../../src/features/face-retouch/state/model';

const fixture=process.env.RETOUCH_FIXTURE??'test-images/four-women-20260915/01-original.png';
const output=process.env.RETOUCH_OUTPUT??'private/eye-controls-20261110/browser';
type AuditWindow=Window&{eyePlan:Prepared;eyeLandmarks:Landmark[][]};
async function ready(page:Page){
 await expect(page.getByRole('button',{name:'PNG 저장',exact:true})).toBeEnabled({timeout:100_000});
 await expect(page.locator('main [role="alert"]')).toHaveCount(0);
}
async function snapshot(page:Page){return Buffer.from(await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.toDataURL('image/png').split(',')[1]),'base64');}
async function value(page:Page,id:string,amount:number){await page.locator(`[data-control="${id}"]`).click();await page.locator('#retouch-strength').fill(String(amount));await ready(page);}
function destination(p:Point,plan:Prepared){let t={...p};for(let i=0;i<30;i++){const q=mapPoint(t,plan);t={x:t.x+p.x-q.x,y:t.y+p.y-q.y};}return t;}

test('real-photo eyes preserve irises, brighten monotonically, reset and save the current preview',async({page})=>{
 test.skip(!existsSync(fixture),'Local private fixture required.');await mkdir(output,{recursive:true});
 const original=await readFile(fixture),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const send=Worker.prototype.postMessage,seen=new WeakSet<Worker>();
  Worker.prototype.postMessage=function(message:{plan?:Prepared},options?:StructuredSerializeOptions|Transferable[]){
   if(!seen.has(this)){seen.add(this);this.addEventListener('message',({data})=>{if(data.landmarks)(window as unknown as AuditWindow).eyeLandmarks=data.landmarks;});}
   if(message?.plan)(window as unknown as AuditWindow).eyePlan=message.plan;
   const forward=send.bind(this);return Array.isArray(options)?forward(message,options):forward(message,options);
  };
 });
 await page.goto('/retouch');await page.getByLabel('사진 열기',{exact:true}).setInputFiles(fixture);await ready(page);
 const base=await snapshot(page),raw=await sharp(base).ensureAlpha().raw().toBuffer(),meta=await sharp(base).metadata(),w=meta.width!,h=meta.height!;
 const landmarks=await page.evaluate(()=>(window as unknown as AuditWindow).eyeLandmarks);
 const face:Face={id:'face-1',landmarks:landmarks.sort((a,b)=>a[1].x-b[1].x)[0]},f=frame(face,w,h),irises=[0,1].map(side=>irisCircle(f.points,side));
 await writeFile(`${output}/neutral.png`,base);await page.getByRole('navigation',{name:'보정 부위'}).getByRole('button',{name:'눈',exact:true}).click();
 const checkIris=(pixels:Buffer,reference:Buffer,plan?:Prepared)=>{
  let checked=0,changed=0;
  for(const iris of irises){
   const center=plan?destination(iris.center,plan):iris.center,r=iris.radius*2;
   for(let y=Math.max(0,Math.floor(center.y-r));y<Math.min(h,Math.ceil(center.y+r));y++)for(let x=Math.max(0,Math.floor(center.x-r));x<Math.min(w,Math.ceil(center.x+r));x++){
    const p=plan?mapPoint({x:x+.5,y:y+.5},plan):{x:x+.5,y:y+.5};
    if(Math.hypot(p.x-iris.center.x,p.y-iris.center.y)>iris.radius*.98)continue;
    checked++;const i=(y*w+x)*4;if(!pixels.subarray(i,i+4).equals(reference.subarray(i,i+4)))changed++;
   }
  }
  expect(checked).toBeGreaterThan(10);expect(changed,'full iris pixel protection').toBe(0);
 };
 for(const id of ['eyeHeight','eyeInner','eyeLower']){
  for(const amount of [-100,100]){
   await value(page,id,amount);const png=await snapshot(page),pixels=await sharp(png).ensureAlpha().raw().toBuffer();
   expect(pixels.equals(raw)).toBeFalsy();if(id!=='eyeHeight')checkIris(pixels,raw);
   await writeFile(`${output}/${id}-${amount}.png`,png);
  }
  await value(page,id,0);expect((await sharp(await snapshot(page)).ensureAlpha().raw().toBuffer()).equals(raw)).toBeTruthy();
 }
 let previous=raw;
 for(const amount of [25,50,100]){
  await value(page,'eyeRedness',amount);const png=await snapshot(page),pixels=await sharp(png).ensureAlpha().raw().toBuffer();
  let darker=0,brighter=0;for(let i=0;i<pixels.length;i++)if(i%4!==3){if(pixels[i]<previous[i])darker++;if(pixels[i]>previous[i])brighter++;}
  expect(darker,'no channel may darken as redness strength increases').toBe(0);expect(brighter).toBeGreaterThan(0);checkIris(pixels,raw);
  await writeFile(`${output}/eyeRedness-${amount}.png`,png);previous=pixels;
 }
 await value(page,'eyeRedness',0);expect((await sharp(await snapshot(page)).ensureAlpha().raw().toBuffer()).equals(raw)).toBeTruthy();
 for(const id of ['eyeSize','eyeHeight','eyeSpacing','eyeAngle'])await value(page,id,65);
 const moved=await snapshot(page),movedRaw=await sharp(moved).ensureAlpha().raw().toBuffer(),plan=await page.evaluate(()=>(window as unknown as AuditWindow).eyePlan);
 await value(page,'eyeInner',100);await value(page,'eyeLower',100);
 const combined=await snapshot(page);checkIris(await sharp(combined).ensureAlpha().raw().toBuffer(),movedRaw,plan);
 await value(page,'eyeRedness',100);const final=await snapshot(page);await writeFile(`${output}/combined.png`,final);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'PNG 저장',exact:true}).click();await(await downloading).saveAs(`${output}/saved.png`);
 const saved=await sharp(`${output}/saved.png`).metadata(),source=await sharp(original).metadata();
 expect([saved.width,saved.height]).toEqual(source.orientation&&source.orientation>=5?[source.height,source.width]:[source.width,source.height]);
 if(saved.width===w&&saved.height===h)expect((await sharp(`${output}/saved.png`).ensureAlpha().raw().toBuffer()).equals(await sharp(final).ensureAlpha().raw().toBuffer())).toBeTruthy();
 expect((await readFile(fixture)).equals(original)).toBeTruthy();expect(errors).toEqual([]);
});
