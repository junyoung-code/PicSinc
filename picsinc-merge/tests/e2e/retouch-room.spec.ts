import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { CollaborationView } from '../../src/features/photo-session/collaboration-types';
const fixture=process.env.RETOUCH_FIXTURE??'test-images/four-women-20260915/01-original.png';
const roomId='room-test';
const base=`/api/sessions/${roomId}`;
const initial=(phase:CollaborationView['phase']):CollaborationView=>({enabled:true,phase,rosterIds:['owner','friend'],completedIds:phase==='personal'?['friend']:['owner','friend'],personalToken:null,personalMaskAssetId:null,personalState:null,editorId:null,editToken:null,leaseUntil:null,latestAssetId:phase==='personal'?null:'result',version:0,history:[]});
async function pixels(page:Page){return sharp(Buffer.from(await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.toDataURL('image/png').split(',')[1]),'base64')).ensureAlpha().raw().toBuffer();}
async function backend(page:Page,initialRoom:CollaborationView,png:Buffer,width:number,height:number,mask?:Buffer) {
 let state=initialRoom,failSave=0,saved:any=null,failSelection=false;
 let claims:Array<{regionId:string;participantId:string;nickname:string}>=[];
 const snapshot=()=>({session:{id:'session',inviteToken:roomId,ownerParticipantId:'owner',originalAssetId:'original',version:5,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()},currentParticipantId:'owner',participants:[{id:'owner',sessionId:'session',nickname:'민선',submitted:state.completedIds.includes('owner')},{id:'friend',sessionId:'session',nickname:'예솔',submitted:true}],assets:[{id:'original',kind:'original',width,height,contentType:'image/png'}],originalSelections:[],selections:[],result:null});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const json=(data:unknown,status=200)=>route.fulfill({status,json:data});
  if(path===base)return json(snapshot());
  if(path===`${base}/collaboration`){
   if(request.method()==='GET')return json(state);
   const body=request.postDataJSON();
   if(body.action==='acquire'){state={...state,editorId:'owner',editToken:'global-token',leaseUntil:new Date(Date.now()+90000).toISOString()};}
   if(body.action==='heartbeat')state={...state,leaseUntil:new Date(Date.now()+90000).toISOString()};
   if(body.action==='personal-begin')state={...state,personalToken:'personal-token',personalMaskAssetId:'mask'};
   if(body.action==='save'||body.action==='personal-save'){
    if(failSave){failSave--;return json({error:'저장에 실패했어요. 다시 시도해주세요.'},503);}
    saved=body;state={...state,editorId:null,editToken:null,leaseUntil:null,personalToken:null,completedIds:['owner','friend'],latestAssetId:'saved',version:1};
   }
   if(body.action==='end-global')state={...state,phase:'review'};
   if(body.action==='finalize')state={...state,phase:'final'};
   if(body.action==='cancel')state={...state,editorId:null,editToken:null,leaseUntil:null};
   if(body.action==='personal-cancel')state={...state,personalToken:null};
   return json(state);
  }
  if(path===`${base}/region-claims`){
   if(request.method()==='PUT'){const body=request.postDataJSON();claims=body.selected?[{regionId:body.regionId,participantId:'owner',nickname:'민선'}]:[];}
   return json({claims});
  }
  if(path===`${base}/original-selection`){if(failSelection){failSelection=false;return json({error:'영역 저장 실패'},503);}return json({version:6});}
  if(path===`${base}/original-detection`)return json({status:'ready',resultUrl:`http://127.0.0.1:3112/api/detection`});
  if(path==='/api/detection')return json({width,height,previewPngBase64:'',regions:mask?[{id:'region-1',box:{x:0,y:0,width,height},maskPngBase64:mask.toString('base64')}]:[]});
  if(path.startsWith(`${base}/assets/`))return route.fulfill({contentType:'image/png',body:path.endsWith('/mask')&&mask?mask:png});
  if(path===`${base}/uploads/edited`||path===`${base}/uploads/mask`)return json({uploadId:'upload',signedUrl:'http://127.0.0.1:3112/api/test-storage',token:'test',path:'test'});
  if(path==='/api/test-storage')return route.fulfill({status:200,body:''});
  if(path==='/api/uploads/upload/complete')return json({asset:{id:'uploaded'}});
  return json({error:`Unhandled ${path}`},404);
 });
 return {state:()=>state,failNextSave:()=>{failSave=2;},saved:()=>saved,claim:()=>{claims=[{regionId:'region-1',participantId:'owner',nickname:'민선'}];},failNextSelection:()=>{failSelection=true;}};
}

test('whole-photo touch has no face controls, keeps prior pixels on restore, retries save and finalizes',async({page})=>{
 const width=400,height=400,data=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3;data[i]=(x*7)%256;data[i+1]=(y*5)%256;data[i+2]=100;}
 const png=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),server=await backend(page,initial('global'),png,width,height);
 await page.goto(`/sessions/${roomId}/collaboration`);
 await page.getByRole('button',{name:'전체 사진 터치 보정',exact:true}).click();
 const save=page.getByRole('button',{name:'전체 사진 편집 완료',exact:true});await expect(save).toBeEnabled();
 await expect(page.getByRole('button',{name:'얼굴 보정',exact:true})).toHaveCount(0);
 await expect(page.getByRole('navigation',{name:'보정 부위'})).toHaveCount(0);
 await expect(page.getByText('영역에 상관없이 원하는 부분을 보정해요').first()).toBeVisible();
 await page.locator('#brush-size').fill('1');
 const original=await pixels(page);const box=(await page.locator('canvas[aria-label="보정 미리보기"]').boundingBox())!,x=box.x+box.width*.2,y=box.y+box.height*.3;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+12,y,{steps:4});await page.mouse.up();await expect(save).toBeEnabled();
 expect((await pixels(page)).equals(original)).toBeFalsy();
 await page.getByRole('button',{name:'복원',exact:true}).click();await page.locator('#brush-size').fill('4.5');
 const restoreBox=(await page.locator('canvas[aria-label="보정 미리보기"]').boundingBox())!,rx=restoreBox.x+restoreBox.width*.2,ry=restoreBox.y+restoreBox.height*.3;
 await page.mouse.move(rx,ry);await page.mouse.down();await page.mouse.move(rx+12,ry,{steps:4});await page.mouse.up();await expect(save).toBeEnabled();
 // This scope starts from an already saved result. Restore returns to that baseline.
 const restored=await pixels(page);expect(restored.equals(original)).toBeTruthy();
 server.failNextSave();await save.click();await expect(page.getByRole('alert').filter({hasText:'저장에 실패'})).toBeVisible();await expect(save).toBeEnabled();
 expect(server.state().editorId).toBe('owner');await save.click();
 await expect(page.getByRole('button',{name:'추가 보정 없이 결과 확인'})).toBeEnabled();expect(server.saved().state.scope).toBe('global');
 await page.getByRole('button',{name:'추가 보정 없이 결과 확인'}).click();await page.getByRole('button',{name:'최종 완료',exact:true}).click();
 await expect(page.getByRole('button',{name:'사진 저장',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'전체 사진 터치 보정'})).toHaveCount(0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'사진 저장',exact:true}).click();expect((await download).suggestedFilename()).toBe('moira-final.png');
 await page.screenshot({path:'private/retouch-e2e/room-final.png',fullPage:true});
});

test('personal editor uses the server mask for preview and records saved controls',async({page})=>{
 test.skip(!existsSync(fixture),'Local private fixture required');
 const runtimeErrors:string[]=[];page.on('pageerror',error=>runtimeErrors.push(error.message));
 const png=await sharp(await readFile(fixture)).rotate().png().toBuffer(),meta=await sharp(png).metadata(),width=meta.width!,height=meta.height!;
 const data=Buffer.alloc(width*height);for(let y=0;y<height;y++)data.fill(255,y*width,y*width+Math.floor(width/2));
 const mask=await sharp(data,{raw:{width,height,channels:1}}).png().toBuffer(),state=initial('personal');state.personalToken='personal-token';state.personalMaskAssetId='mask';
 const server=await backend(page,state,png,width,height,mask);
 await page.goto(`/sessions/${roomId}/collaboration`);await page.getByRole('button',{name:'내 영역 보정 이어가기'}).click();
 const save=page.getByRole('button',{name:'내 얼굴 보정 완료',exact:true});await expect(save).toBeEnabled({timeout:100000});
 await expect(page.getByRole('img',{name:'내 편집 영역'})).toBeVisible();
 const before=await pixels(page);await page.locator('#retouch-strength').fill('70');await expect(save).toBeEnabled();const after=await pixels(page);
 expect(before.equals(after)).toBeFalsy();
 const outputWidth=await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.width),outputHeight=after.length/4/outputWidth;
 for(let y=0;y<outputHeight;y++){const a=(y*outputWidth+Math.ceil(outputWidth/2))*4,b=(y+1)*outputWidth*4;expect(after.subarray(a,b).equals(before.subarray(a,b))).toBeTruthy();}
 await page.screenshot({path:'private/retouch-e2e/room-personal.png',fullPage:true});await save.click();
 await expect(page.getByRole('heading',{name:'내 보정이 저장됐어요'})).toBeVisible();expect(server.saved().state.edit.settings).toBeTruthy();
 await expect(page.getByRole('button',{name:'내 영역 보정 이어가기'})).toHaveCount(0);
 expect(runtimeErrors).toEqual([]);
});


test('selected regions survive reload and a failed save keeps the unsaved warning',async({page})=>{
 const width=400,height=400,png=await sharp({create:{width,height,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 const mask=await sharp({create:{width,height,channels:3,background:'#ffffff'}}).png().toBuffer();
 const server=await backend(page,initial('personal'),png,width,height,mask);server.claim();
 await page.goto(`/sessions/${roomId}/collaboration`);const next=page.getByRole('button',{name:'이 영역 보정하기',exact:true});await expect(next).toBeEnabled();
 await page.reload();await expect(next).toBeEnabled();
 // A real selection toggle makes the draft dirty, then the selection request fails.
 const canvas=page.locator('canvas').first();await canvas.click({position:{x:100,y:100}});await expect(next).toBeDisabled();
 await canvas.click({position:{x:100,y:100}});await expect(next).toBeEnabled();server.failNextSelection();await next.click();
 await expect(page.getByText('영역 저장 실패').first()).toBeVisible();
 expect(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented;})).toBeTruthy();
 await next.click();await expect(page.getByRole('button',{name:'내 얼굴 보정 완료',exact:true})).toBeEnabled({timeout:100000});
});

test('editor back and cancel return to one room history entry',async({page})=>{
 const png=await sharp({create:{width:400,height:400,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 await backend(page,initial('global'),png,400,400);
 await page.goto('/retouch');await page.goto(`/sessions/${roomId}/collaboration`);
 const open=page.getByRole('button',{name:'전체 사진 터치 보정',exact:true});
 await open.click();await expect(page.getByRole('button',{name:'전체 사진 편집 완료',exact:true})).toBeEnabled();
 await page.goBack();await expect(open).toBeVisible();
 await open.click();await expect(page.getByRole('button',{name:'전체 사진 편집 완료',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'뒤로 가기',exact:true}).click();await expect(open).toBeVisible();
 await page.goBack();await expect(page).toHaveURL(/\/retouch$/);
});
