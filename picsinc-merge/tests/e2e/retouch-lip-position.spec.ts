import {test,expect,type Page} from '@playwright/test';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {bounds,frame} from '../../src/features/face-retouch/effects/geometry';
import {lipInnerLoop,lipOuterLoop} from '../../src/features/face-retouch/effects/lips';
import {mapPoint,regionDistance,type Prepared,type Field} from '../../src/features/face-retouch/engine/field';
import type {Face,Landmark,Point} from '../../src/features/face-retouch/state/model';

const fixture=process.env.RETOUCH_FIXTURE??'test-images/four-women-20260915/01-original.png';
const output=process.env.RETOUCH_OUTPUT??'private/lip-position-20261110/browser';
type AuditWindow=Window&{lipPlan:Prepared;lipLandmarks:Landmark[][];lipField:Omit<Field,'data'>&{data:number[]}};
async function ready(page:Page){
 await expect(page.getByRole('button',{name:'PNG 저장',exact:true})).toBeEnabled({timeout:100_000});
 await expect(page.locator('main [role="alert"]')).toHaveCount(0);
}
async function snapshot(page:Page){return Buffer.from(await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.toDataURL('image/png').split(',')[1]),'base64');}
function destination(p:Point,plan:Prepared){let t={...p};for(let i=0;i<40;i++){const q=mapPoint(t,plan);t={x:t.x+p.x-q.x,y:t.y+p.y-q.y};}return t;}

test('real-photo lip position keeps nose pixels and mouth shape, resets and saves the preview',async({page})=>{
 test.skip(!existsSync(fixture),'Local private fixture required.');await mkdir(output,{recursive:true});
 const original=await readFile(fixture),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const send=Worker.prototype.postMessage,seen=new WeakSet<Worker>();
  Worker.prototype.postMessage=function(message:{plan?:Prepared},options?:StructuredSerializeOptions|Transferable[]){
   const audit=window as unknown as AuditWindow;
   if(!seen.has(this)){seen.add(this);this.addEventListener('message',({data})=>{
    if(data.landmarks)audit.lipLandmarks=data.landmarks;
    if(data.result)audit.lipField={...data.result,data:Array.from(data.result.data)};
   });}
   if(message?.plan)audit.lipPlan=message.plan;
   const forward=send.bind(this);return Array.isArray(options)?forward(message,options):forward(message,options);
  };
 });
 await page.goto('/retouch');await page.getByLabel('사진 열기',{exact:true}).setInputFiles(fixture);await ready(page);
 const base=await snapshot(page),raw=await sharp(base).ensureAlpha().raw().toBuffer(),meta=await sharp(base).metadata(),w=meta.width!,h=meta.height!;
 const landmarks=await page.evaluate(()=>(window as unknown as AuditWindow).lipLandmarks);
 const face:Face={id:'face-1',landmarks:landmarks.sort((a,b)=>a[1].x-b[1].x)[0]},f=frame(face,w,h);
 const nose=bounds([168,193,417,1,4,44,274,2,64,97,98,99,240,294,326,327,328,460].map(i=>f.lm[i]));
 await writeFile(`${output}/neutral.png`,base);await page.getByRole('navigation',{name:'보정 부위'}).getByRole('button',{name:'입술',exact:true}).click();
 await page.locator('[data-control="lipPosition"]').click();
 for(const amount of [-100,-50,50,100]){
  await page.locator('#retouch-strength').fill(String(amount));await ready(page);
  const png=await snapshot(page),pixels=await sharp(png).ensureAlpha().raw().toBuffer();expect(pixels.equals(raw)).toBeFalsy();
  const {plan,field}=await page.evaluate(()=>{const a=window as unknown as AuditWindow;return{plan:a.lipPlan,field:a.lipField};});
  const neighbors=Object.entries(plan.areas).filter(([id])=>id!==face.id).map(([,r])=>r);let checked=0,changed=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const p={x:x+.5,y:y+.5},q=f.local(p),inNose=q.x>=nose.x&&q.x<=nose.x+nose.width&&q.y>=nose.y&&q.y<=nose.y+nose.height;
   if(!inNose&&!neighbors.some(r=>regionDistance(p,r)<.9))continue;
   checked++;const i=(y*w+x)*4;if(!pixels.subarray(i,i+4).equals(raw.subarray(i,i+4)))changed++;
  }
  expect(checked).toBeGreaterThan(100);expect(changed,'nose and neighboring faces must retain original pixels').toBe(0);
  const center=f.points[13],moved=destination(center,plan),delta={x:moved.x-center.x,y:moved.y-center.y};
  expect(Math.hypot(delta.x,delta.y)).toBeGreaterThan(.1);
  for(const id of [...lipOuterLoop,...lipInnerLoop]){
   const p=f.points[id],t={x:p.x+delta.x,y:p.y+delta.y},gx=t.x/w*(field.columns-1),gy=t.y/h*(field.rows-1),ix=Math.floor(gx),iy=Math.floor(gy),tx=gx-ix,ty=gy-iy;
   const shift=[0,1].map(c=>{const at=(x:number,y:number)=>field.data[(y*field.columns+x)*4+c];return ((at(ix,iy)*(1-tx)+at(ix+1,iy)*tx)*(1-ty)+(at(ix,iy+1)*(1-tx)+at(ix+1,iy+1)*tx)*ty)*(c===0?w:h);});
   expect(Math.hypot(delta.x+shift[0],delta.y+shift[1]),`lip ${id} must stay rigid after interpolation`).toBeLessThan(1e-5);
  }
  await writeFile(`${output}/lipPosition-${amount}.png`,png);
 }
 const final=await snapshot(page),downloading=page.waitForEvent('download');await page.getByRole('button',{name:'PNG 저장',exact:true}).click();await(await downloading).saveAs(`${output}/saved.png`);
 const saved=await sharp(`${output}/saved.png`).metadata(),source=await sharp(original).metadata();
 expect([saved.width,saved.height]).toEqual(source.orientation&&source.orientation>=5?[source.height,source.width]:[source.width,source.height]);
 if(saved.width===w&&saved.height===h)expect((await sharp(`${output}/saved.png`).ensureAlpha().raw().toBuffer()).equals(await sharp(final).ensureAlpha().raw().toBuffer())).toBeTruthy();
 await page.locator('#retouch-strength').fill('0');await ready(page);expect((await sharp(await snapshot(page)).ensureAlpha().raw().toBuffer()).equals(raw)).toBeTruthy();
 expect((await readFile(fixture)).equals(original)).toBeTruthy();expect(errors).toEqual([]);
});
