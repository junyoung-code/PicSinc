// Run against a production build, with private local media:
// RETOUCH_BASE_URL=http://127.0.0.1:3114 node --import tsx scripts/retouch-benchmark.mjs
import {chromium,webkit,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {cpus,platform,release} from 'node:os';
import sharp from 'sharp';
import {controls} from '../src/features/face-retouch/state/model.ts';

const fixture=process.env.RETOUCH_FIXTURE??'test-images/four-women-20260915/01-original.png';
const browserName=process.env.RETOUCH_BROWSER==='webkit'?'webkit':'chromium';
const output=process.env.RETOUCH_BENCHMARK_OUTPUT??`private/retouch-e2e/benchmark-${browserName}.json`;
const count=Number(process.env.RETOUCH_SAMPLES??30),warmup=5;
if(!Number.isInteger(count)||count<20||count>100)throw Error('RETOUCH_SAMPLES must be an integer from 20 to 100');
const browser=await (browserName==='webkit'?webkit:chromium).launch(browserName==='chromium'?{channel:'chrome'}:{});
try {
 const viewport={width:402,height:874},page=await browser.newPage({viewport});
 await page.addInitScript(()=>{
  const m=window.retouchMeasure={active:null,records:[],lastPlan:null,touch:false};
  const NativeWorker=window.Worker,draw=WebGL2RenderingContext.prototype.drawArrays;
  // Register BEFORE the app installs onmessage: promise microtasks can render
  // between listeners, so a listener added at postMessage observes too late.
  window.Worker=class extends NativeWorker {
   constructor(...args){super(...args);this.addEventListener('message',e=>{
    const sample=m.active;
    if(sample?.worker===this&&sample.workerId===e.data.id){if(e.data.error)sample.error=e.data.error;else if(e.data.result)sample.computed=true;}
   });}
   postMessage(data,...args){
    if(data.plan){m.lastPlan=data.plan;if(m.active){m.active.workerId=data.id;m.active.worker=this;}}
    return super.postMessage(data,...args);
   }
  };
  WebGL2RenderingContext.prototype.drawArrays=function(...args){
   const result=draw.apply(this,args),sample=m.active;
   if(sample?.computed){m.records.push({kind:sample.kind,ms:performance.now()-sample.start});m.active=null;}
   return result;
  };
  document.addEventListener('pointermove',e=>{if(m.touch&&e.buttons)m.active={kind:'touch',start:performance.now()};},true);
 });
 await page.goto(new URL('/retouch',process.env.RETOUCH_BASE_URL??'http://127.0.0.1:3114').href);
 await page.getByLabel('사진 열기',{exact:true}).setInputFiles(fixture);
 const save=page.getByRole('button',{name:'PNG 저장',exact:true});
 async function ready(){await expect(save).toBeEnabled({timeout:100000});await expect(page.getByRole('status').filter({hasText:/미리보기 갱신 중|얼굴 기준점/})).toHaveCount(0,{timeout:100000});}
 await ready();
 const faces=await page.getByRole('button',{name:/^얼굴 \d+$/}).count();
 if(!faces)throw Error('The fixture needs at least one editable face');
 async function waitSample(previous){
  try{await page.waitForFunction(n=>window.retouchMeasure.records.length>n||window.retouchMeasure.active?.error,previous,{timeout:30000});}
  catch(error){console.error(await page.evaluate(()=>({kind:window.retouchMeasure.active?.kind,computed:window.retouchMeasure.active?.computed,workerId:window.retouchMeasure.active?.workerId,records:window.retouchMeasure.records.length,slider:document.querySelector('#retouch-strength')?.value})));throw error;}
  const error=await page.evaluate(()=>window.retouchMeasure.active?.error);if(error)throw Error(error);
  await ready();
 }
 async function sliders(kind){
  for(let i=0;i<count+warmup;i++){
   const previous=await page.evaluate(({kind,value})=>{
    const m=window.retouchMeasure,input=document.querySelector('#retouch-strength');
    m.active={kind,start:performance.now()};
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
    input.dispatchEvent(new Event('input',{bubbles:true}));return m.records.length;
   },{kind,value:i%2===0?35:65});
   await waitSample(previous);
  }
 }
 await sliders('single');
 console.log('single completed');
 for(const [id,,group] of controls){
  await page.getByRole('navigation',{name:'보정 부위'}).getByRole('button',{name:group,exact:true}).click();
  await page.locator(`[data-control="${id}"]`).click();await page.locator('#retouch-strength').fill('50');await ready();
 }
 await page.getByRole('navigation',{name:'보정 부위'}).getByRole('button',{name:'얼굴형',exact:true}).click();
 await page.locator('[data-control="faceWidth"]').click();await sliders('combination');
 console.log('combination completed');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'선택 얼굴 전체 초기화',exact:true}).click();await ready();
 await page.getByRole('button',{name:'터치 보정',exact:true}).click();await page.locator('#brush-size').fill('8');
 const canvas=page.locator('canvas[aria-label="보정 미리보기"]');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
 const point=await page.evaluate(()=>{const p=window.retouchMeasure.lastPlan,r=Object.values(p.areas)[0];return{x:r.center.x/p.width,y:r.center.y/p.height};});
 const x=box.x+box.width*point.x,y=box.y+box.height*point.y;
 await page.mouse.move(x,y);await page.mouse.down();await page.evaluate(()=>window.retouchMeasure.touch=true);
 for(let i=0;i<count+warmup;i++){
  const previous=await page.evaluate(()=>window.retouchMeasure.records.length);
  // Integer CSS moves avoid WebKit rounding consecutive subpixel positions
  // to the same point; the larger brush keeps the path below 600 segments.
  await page.mouse.move(x+(i%2?1:-1),y+Math.floor(i/8));await waitSample(previous);
 }
 await page.evaluate(()=>window.retouchMeasure.touch=false);await page.mouse.up();await ready();
 const png=[];
 for(let i=0;i<6;i++){
  const started=performance.now(),download=page.waitForEvent('download');await save.click();const result=await download;
  const path=await result.path();if(!path||await result.failure())throw Error('PNG download failed');
  if(i>0)png.push(performance.now()-started);
 }
 const {records,strokeCount}=await page.evaluate(()=>({records:window.retouchMeasure.records,strokeCount:window.retouchMeasure.lastPlan.state.strokes.length}));
 function stats(values){const sorted=[...values].sort((a,b)=>a-b);return{samples:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1),ms:values};}
 const bytes=await readFile(fixture),meta=await sharp(bytes).metadata();
 const report={at:new Date().toISOString(),browser:browserName,browserVersion:browser.version(),os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,viewport,
  fixture:{sha256:createHash('sha256').update(bytes).digest('hex'),width:meta.width,height:meta.height,editableFaces:faces},warmup,settings:{sliderValues:[35,65],otherCombinedControls:50,touchBrush:8,touchStrength:6,strokeCount},
  method:'Sequential input event to matching Worker result + WebGL draw submission; not physical presentation or continuous-drag throughput. PNG includes Playwright click and completed download. Touch strokes accumulate.',
  single:stats(records.filter(r=>r.kind==='single').slice(warmup).map(r=>r.ms)),combination:stats(records.filter(r=>r.kind==='combination').slice(warmup).map(r=>r.ms)),touch:stats(records.filter(r=>r.kind==='touch').slice(warmup).map(r=>r.ms)),png:stats(png)};
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,single:{...report.single,ms:undefined},combination:{...report.combination,ms:undefined},touch:{...report.touch,ms:undefined},png:{...report.png,ms:undefined}},null,2));
}finally{await browser.close();}
