// Local-only evidence collection. Manifest: [{id,condition,origin,path}].
// node scripts/retouch-photo-audit.mjs private/cases.json
// Results describe behavior; naturalness and occlusion ownership need visual review.
import {chromium,webkit,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const manifest=JSON.parse(await readFile(process.argv[2],'utf8'));
const browserName=process.env.RETOUCH_BROWSER==='webkit'?'webkit':'chromium';
const output=process.env.RETOUCH_AUDIT_OUTPUT??`private/retouch-e2e/photo-audit-${browserName}`;
const browser=await (browserName==='webkit'?webkit:chromium).launch(browserName==='chromium'?{channel:'chrome'}:{});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=[];
try {
 await mkdir(output,{recursive:true});
 for(const item of manifest){
  if(!/^[a-z0-9-]+$/.test(item.id))throw Error('Use anonymous ASCII case ids');
  const page=await browser.newPage({viewport:{width:402,height:874}}),errors=[],writes=[];
  await page.addInitScript(()=>{
   const send=Worker.prototype.postMessage;
   Worker.prototype.postMessage=function(data,...args){if(data.plan)window.retouchAuditPlan={areas:data.plan.areas,width:data.plan.width,height:data.plan.height,owner:Object.keys(data.plan.state.settings)[0]};return send.call(this,data,...args);};
  });
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await page.goto(new URL('/retouch',process.env.RETOUCH_BASE_URL??'http://127.0.0.1:3114').href);
  const bytes=await readFile(item.path),source=await sharp(bytes).metadata(),started=performance.now();
  await page.getByLabel('사진 열기',{exact:true}).setInputFiles(item.path);
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='PNG 저장'&&!b.disabled)||!!document.querySelector('main [role="alert"]')?.textContent,null,{timeout:100000});
  const readyMs=performance.now()-started,save=page.getByRole('button',{name:'PNG 저장',exact:true}),editable=await save.isEnabled();
  const faces=await page.getByRole('button',{name:/^얼굴 \d+$/}).count();
  const row={id:item.id,condition:item.condition,origin:item.origin,width:source.width,height:source.height,editableFaces:faces,readyMs,editable,messages:await page.locator('main [aria-live="polite"]').allTextContents()};
  if(editable){
   const canvas=page.locator('canvas[aria-label="보정 미리보기"]');
   const image=async()=>Buffer.from(await canvas.evaluate(c=>c.toDataURL('image/png').split(',')[1]),'base64');
   const ready=async()=>{await expect(save).toBeEnabled({timeout:100000});await expect(page.getByRole('status').filter({hasText:/미리보기 갱신 중|얼굴 기준점/})).toHaveCount(0,{timeout:100000});};
   await ready();const before=await image();await writeFile(`${output}/${item.id}-before.png`,before);
   await page.locator('#retouch-strength').fill('65');await ready();
   await page.getByRole('navigation',{name:'보정 부위'}).getByRole('button',{name:'눈',exact:true}).click();
   await page.locator('[data-control="eyeSize"]').click();await page.locator('#retouch-strength').fill('40');await ready();
   const after=await image();await writeFile(`${output}/${item.id}-after.png`,after);row.changed=!before.equals(after);row.editMessages=await page.locator('main [aria-live="polite"]').allTextContents();
   const plan=await page.evaluate(()=>window.retouchAuditPlan),meta=await sharp(before).metadata();
   const base=await sharp(before).ensureAlpha().raw().toBuffer(),edited=await sharp(after).ensureAlpha().raw().toBuffer();
   let protectedPixels=0,changedProtected=0;
   for(const [id,r] of Object.entries(plan.areas))if(id!==plan.owner){
    const c=Math.cos(r.angle),s=Math.sin(r.angle);
    for(let y=0;y<meta.height;y++)for(let x=0;x<meta.width;x++){
     const dx=(x+.5)/meta.width*plan.width-r.center.x,dy=(y+.5)/meta.height*plan.height-r.center.y;
     if(Math.hypot((dx*c+dy*s)/r.rx,(-dx*s+dy*c)/r.ry)>=1)continue;
     protectedPixels++;const i=(y*meta.width+x)*4;if(!base.subarray(i,i+4).equals(edited.subarray(i,i+4)))changedProtected++;
    }
   }
   row.protectedPixels=protectedPixels;row.changedProtected=changedProtected;expect(changedProtected).toBe(0);
   const download=page.waitForEvent('download');await save.click();const file=await download;await file.saveAs(`${output}/${item.id}-saved.png`);
   const result=await sharp(`${output}/${item.id}-saved.png`).metadata();row.savedDimensions=[result.width,result.height];
   const expected=source.orientation>=5?[source.height,source.width]:[source.width,source.height];expect(row.savedDimensions).toEqual(expected);
   page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'선택 얼굴 전체 초기화',exact:true}).click();await ready();
   row.neutralRestored=before.equals(await image());expect(row.neutralRestored).toBe(true);
  }
  row.sourceUnchanged=hash(bytes)===hash(await readFile(item.path));expect(row.sourceUnchanged).toBe(true);
  expect(errors).toEqual([]);expect(writes).toEqual([]);
  await page.screenshot({path:`${output}/${item.id}-screen.png`,fullPage:true});rows.push(row);await page.close();
  await writeFile(`${output}/results.json`,JSON.stringify({at:new Date().toISOString(),browser:browserName,browserVersion:browser.version(),rows},null,2));
  console.log(JSON.stringify(row));
 }
}finally{await browser.close();}
