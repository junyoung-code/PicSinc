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
async function backend(page:Page,initialRoom:CollaborationView,png:Buffer,width:number,height:number,mask?:Buffer,participantId='owner') {
 let state=initialRoom,failSave=0,saved:any=null,failSelection=false,failDownload=false;
 const actions:string[]=[];
 let releaseSave:(()=>void)|undefined; let saveGate:Promise<void>|undefined;
 let claims:Array<{regionId:string;participantId:string;nickname:string}>=[];
 const snapshot=()=>({session:{id:'session',inviteToken:roomId,ownerParticipantId:'owner',originalAssetId:'original',version:5,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()},currentParticipantId:participantId,participants:[{id:'owner',sessionId:'session',nickname:'민선',submitted:state.completedIds.includes('owner')},{id:'friend',sessionId:'session',nickname:'예솔',submitted:true}],assets:[{id:'original',kind:'original',width,height,contentType:'image/png'}],originalSelections:[],selections:[],result:null});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const json=(data:unknown,status=200)=>route.fulfill({status,json:data});
  if(path===base)return json(snapshot());
  if(path===`${base}/collaboration`){
   if(request.method()==='GET')return json(state);
   const body=request.postDataJSON(); actions.push(body.action);
   if(body.action==='start')state={...state,phase:'personal',rosterIds:['owner','friend'],completedIds:[]};
   if(body.action==='compose')state={...state,phase:'composing'};
   if(body.action==='acquire'){state={...state,editorId:participantId,editToken:'global-token',leaseUntil:new Date(Date.now()+90000).toISOString()};}
   if(body.action==='heartbeat')state={...state,leaseUntil:new Date(Date.now()+90000).toISOString()};
   if(body.action==='personal-begin')state={...state,personalToken:'personal-token',personalMaskAssetId:'mask'};
   if(body.action==='save'||body.action==='personal-save'){
    if(saveGate)await saveGate;
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
  if(path.startsWith(`${base}/assets/`) && failDownload && request.resourceType()==='fetch'){failDownload=false;return route.fulfill({status:503,body:''});}
  if(path.startsWith(`${base}/assets/`))return route.fulfill({contentType:'image/png',body:path.endsWith('/mask')&&mask?mask:png});
  if(path===`${base}/uploads/edited`||path===`${base}/uploads/mask`)return json({uploadId:'upload',signedUrl:'http://127.0.0.1:3112/api/test-storage',token:'test',path:'test'});
  if(path==='/api/test-storage')return route.fulfill({status:200,body:''});
  if(path==='/api/uploads/upload/complete')return json({asset:{id:'uploaded'}});
  return json({error:`Unhandled ${path}`},404);
 });
 return {state:()=>state,actions,update:(patch:Partial<CollaborationView>)=>{state={...state,...patch};},failNextDownload:()=>{failDownload=true;},holdSave:()=>{saveGate=new Promise<void>(resolve=>{releaseSave=resolve;});},releaseSave:()=>{releaseSave?.();saveGate=undefined;},failNextSave:()=>{failSave=2;},saved:()=>saved,claim:()=>{claims=[{regionId:'region-1',participantId:'owner',nickname:'민선'}];},failNextSelection:()=>{failSelection=true;}};
}

test('whole-photo touch has no face controls, keeps prior pixels on restore, retries save and finalizes',async({page})=>{
 const width=400,height=400,data=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*3;data[i]=(x*7)%256;data[i+1]=(y*5)%256;data[i+2]=100;}
 const png=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer(),server=await backend(page,initial('global'),png,width,height);
 await page.goto(`/sessions/${roomId}/collaboration`);
 await page.getByRole('button',{name:'터치 보정으로 전체 다듬기',exact:true}).click();
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
 await expect(page.getByRole('button',{name:'터치 보정 건너뛰기'})).toBeEnabled();expect(server.saved().state.scope).toBe('global');
 await page.getByRole('button',{name:'터치 보정 건너뛰기'}).click();await page.getByRole('button',{name:'건너뛰고 결과 확인',exact:true}).click();await page.getByRole('button',{name:'최종 완료',exact:true}).click();await page.getByRole('button',{name:'사진 최종 완료',exact:true}).click();
 await expect(page.getByRole('button',{name:'사진 저장',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'터치 보정으로 전체 다듬기'})).toHaveCount(0);
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
 await page.goto(`/retouch/rooms/${roomId}`);await page.getByRole('button',{name:'내 영역 보정 이어가기'}).click();
 const save=page.getByRole('button',{name:'내 얼굴 보정 완료',exact:true});await expect(save).toBeEnabled({timeout:100000});
 await expect(page.getByRole('img',{name:'내 편집 영역'})).toBeVisible();
 const before=await pixels(page);await page.locator('#retouch-strength').fill('70');await expect(save).toBeEnabled();const after=await pixels(page);
 expect(before.equals(after)).toBeFalsy();
 const outputWidth=await page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.width),outputHeight=after.length/4/outputWidth;
 for(let y=0;y<outputHeight;y++){const a=(y*outputWidth+Math.ceil(outputWidth/2))*4,b=(y+1)*outputWidth*4;expect(after.subarray(a,b).equals(before.subarray(a,b))).toBeTruthy();}
 await page.screenshot({path:'private/retouch-e2e/room-personal.png',fullPage:true});
 server.failNextSave();await save.click();await expect(page.getByRole('alert').filter({hasText:'저장에 실패'})).toBeVisible();
 await expect(page.getByRole('region',{name:'친구 보정 현황'}).getByText('보정 완료')).toBeVisible();await expect(save).toBeEnabled();
 expect((await pixels(page)).equals(after)).toBeTruthy();await save.click();
 await expect(page.getByRole('heading',{name:'내 보정이 끝났어요'})).toBeVisible();expect(server.saved().state.edit.settings).toBeTruthy();
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
 const open=page.getByRole('button',{name:'터치 보정으로 전체 다듬기',exact:true});
 await open.click();await expect(page.getByRole('button',{name:'전체 사진 편집 완료',exact:true})).toBeEnabled();
 await page.goBack();await expect(open).toBeVisible();
 await open.click();await expect(page.getByRole('button',{name:'전체 사진 편집 완료',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'뒤로 가기',exact:true}).click();await expect(open).toBeVisible();
 await page.goBack();await expect(page).toHaveURL(/\/retouch$/);
});


test('personal cancel keeps the region selected during this visit', async ({page}) => {
 const png=await sharp({create:{width:400,height:400,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 const mask=await sharp({create:{width:400,height:400,channels:3,background:'#ffffff'}}).png().toBuffer();
 await backend(page,initial('personal'),png,400,400,mask);
 await page.goto(`/sessions/${roomId}/collaboration`);
 const next=page.getByRole('button',{name:'이 영역 보정하기',exact:true});
 await expect(next).toBeDisabled();
 await page.locator('canvas').first().click({position:{x:100,y:100}});
 await expect(next).toBeEnabled(); await next.click();
 await expect(page.getByRole('button',{name:'내 얼굴 보정 완료',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'뒤로 가기',exact:true}).click();
 await expect(next).toBeEnabled();
});

test('collaborative invitations and expired rooms stay in retouch', async ({page}) => {
 const png=await sharp({create:{width:40,height:40,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 await backend(page,{...initial('lobby'),rosterIds:[],completedIds:[]},png,40,40);
 await page.goto(`/sessions/${roomId}/collaboration`);
 await expect(page.getByRole('textbox',{name:'초대 링크'})).toHaveValue(new RegExp(`/retouch/rooms/${roomId}$`));
 await page.route(`**${base}`,route=>route.fulfill({status:410,json:{error:'방이 만료됐어요.'}}));
 await page.reload();
 await expect(page.getByRole('heading',{name:'보정방이 만료됐어요'})).toBeVisible();
 await expect(page.getByRole('link',{name:'새 보정방 만들기'})).toHaveAttribute('href','/retouch/rooms/new');
});


// HTTP responses below simulate server decisions. These checks cover UI behavior,
// not database locking, worker execution, or physical mobile devices.
test('lobby starts recognition and personal completion waits for everyone', async ({page}) => {
 const png=await sharp({create:{width:40,height:40,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 const server=await backend(page,{...initial('lobby'),rosterIds:[],completedIds:[],latestAssetId:null},png,40,40);
 await page.goto(`/retouch/rooms/${roomId}`);
 await expect(page.getByText('현재 참여자 · 2명')).toBeVisible();
 await page.getByRole('button',{name:'시작하기',exact:true}).click();await expect(page.getByRole('heading',{name:'이 참여자들과 함께 보정을 시작할까요?'})).toBeVisible();await page.getByRole('button',{name:'시작하기',exact:true}).click();
 await expect(page.getByRole('heading',{name:'사진 속 내 얼굴을 모두 선택해주세요'})).toBeVisible();
 expect(server.actions).toContain('start');
 server.update({completedIds:['owner']});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('heading',{name:'내 보정이 끝났어요'})).toBeVisible();
 await expect(page.getByRole('button',{name:'전체 사진 확인하기',exact:true})).toHaveCount(0);
 server.update({completedIds:['owner','friend']});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('button',{name:'전체 사진 확인하기',exact:true}).click();
 await expect(page.getByRole('heading',{name:'우리 사진을 완성하고 있어요'})).toBeVisible();
 await expect(page.getByRole('button',{name:'이 영역 보정하기'})).toHaveCount(0);
});

test('other editor blocks global entry and review blocks every new edit', async ({page}) => {
 const png=await sharp({create:{width:40,height:40,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 const server=await backend(page,{...initial('global'),editorId:'friend',leaseUntil:new Date(Date.now()+90000).toISOString()},png,40,40);
 await page.goto(`/retouch/rooms/${roomId}`);
 await expect(page.getByText('예솔님이 전체 사진을 보정 중이에요. 잠시 기다려주세요.')).toBeVisible();
 await expect(page.getByRole('button',{name:'친구의 보정을 기다려 주세요',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'터치 보정 건너뛰기'})).toBeDisabled();
 server.update({editorId:null,leaseUntil:null,latestAssetId:'friend-saved'});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'터치 보정으로 전체 다듬기',exact:true})).toBeEnabled();
 await expect(page.getByRole('img',{name:'저장된 보정 결과'})).toHaveAttribute('src',`${base}/assets/friend-saved`);
 const nextBase=page.waitForRequest(request=>new URL(request.url()).pathname===`${base}/assets/friend-saved` && request.resourceType()==='fetch');
 await page.getByRole('button',{name:'터치 보정으로 전체 다듬기',exact:true}).click();await nextBase;
 await expect(page.getByRole('button',{name:'전체 사진 편집 완료',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'뒤로 가기',exact:true}).click();
 await page.getByRole('button',{name:'터치 보정 건너뛰기'}).click();await page.getByRole('button',{name:'건너뛰고 결과 확인',exact:true}).click();
 await expect(page.getByRole('button',{name:'최종 완료',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'터치 보정으로 전체 다듬기',exact:true})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('button',{name:'최종 완료',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'이 영역 보정하기'})).toHaveCount(0);
});

test('participant waits for owner finalization and retries the same final PNG', async ({page,context}) => {
 const png=await sharp({create:{width:40,height:40,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 const server=await backend(page,initial('review'),png,40,40,undefined,'friend');
 await page.goto(`/retouch/rooms/${roomId}`);
 await expect(page.getByRole('heading',{name:'대표자의 최종 완료를 기다려요'})).toBeVisible();
 await expect(page.getByRole('button',{name:'최종 완료',exact:true})).toHaveCount(0);
 server.update({phase:'final'});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const save=page.getByRole('button',{name:'사진 저장',exact:true});await expect(save).toBeVisible();
 server.failNextDownload();await save.click();await expect(page.getByRole('status').filter({hasText:'사진 저장에 실패'})).toBeVisible();
 const getPNG=async(p:Page)=>{const download=p.waitForEvent('download');await p.getByRole('button',{name:'사진 저장',exact:true}).click();const file=await download;expect(file.suggestedFilename()).toBe('moira-final.png');return readFile((await file.path())!);};
 expect((await getPNG(page)).equals(png)).toBeTruthy();
 const owner=await context.newPage();await backend(owner,initial('final'),png,40,40);await owner.goto(`/retouch/rooms/${roomId}`);
 expect((await getPNG(owner)).equals(png)).toBeTruthy();await owner.close();
 await page.reload();await expect(save).toBeVisible();
 await expect(page.getByRole('button',{name:'터치 보정으로 전체 다듬기'})).toHaveCount(0);
});

test('saving blocks back navigation until the upload is accepted',async({page})=>{
 const png=await sharp({create:{width:400,height:400,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 const server=await backend(page,initial('global'),png,400,400);
 await page.goto(`/retouch/rooms/${roomId}`);await page.getByRole('button',{name:'터치 보정으로 전체 다듬기',exact:true}).click();
 const save=page.getByRole('button',{name:'전체 사진 편집 완료',exact:true});await expect(save).toBeEnabled();
 server.holdSave();await save.click();await expect.poll(()=>server.actions.includes('save')).toBeTruthy();
 await page.goBack();await expect(page.getByRole('button',{name:'저장 중…',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});dispatchEvent(e);return e.defaultPrevented;})).toBeTruthy();
 expect(server.actions).not.toContain('cancel');server.releaseSave();
 await expect(page.getByRole('button',{name:'터치 보정으로 전체 다듬기',exact:true})).toBeVisible();
});

test('retouch room rejects merge token without rendering upload flow',async({page})=>{
 const png=await sharp({create:{width:40,height:40,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 await backend(page,{...initial('lobby'),enabled:false},png,40,40);
 await page.goto(`/retouch/rooms/${roomId}`);
 await expect(page.getByRole('heading',{name:'공동 보정방 주소를 확인해주세요'})).toBeVisible();
 await expect(page.getByRole('link',{name:'새 보정방 만들기'})).toHaveAttribute('href','/retouch/rooms/new');
 await expect(page.locator('input[type=file]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'시작하기'})).toHaveCount(0);
});


test('new room participation checks room kind before joining',async({page})=>{
 const calls:string[]=[];
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;calls.push(path);
  if(path===base)return route.fulfill({status:403,json:{error:'참여해주세요.'}});
  if(path===`/api/retouch/rooms/${roomId}/participants`)return route.fulfill({status:404,json:{error:'공동 보정방 주소를 확인해주세요.',code:'RETOUCH_ROOM_REQUIRED'}});
  return route.fulfill({status:500,json:{error:'일반 방 참여 요청이 발생했어요.'}});
 });
 await page.goto(`/retouch/rooms/${roomId}`);
 await page.getByRole('textbox',{name:'내 닉네임'}).fill('새 친구');
 await page.getByRole('button',{name:'이 보정방에 참여하기',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('공동 보정방 주소를 확인해주세요.');
 expect(calls).toContain(`/api/retouch/rooms/${roomId}/participants`);
 expect(calls).not.toContain(`${base}/participants`);
});

test('new participants see roster-locked and expired room responses',async({page})=>{
 let expired=false;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path===base)return route.fulfill({status:403,json:{error:'참여해주세요.'}});
  if(path===`/api/retouch/rooms/${roomId}/participants`)return route.fulfill({status:expired?410:409,json:{error:expired?'방이 만료됐어요.':'인식이 시작되어 새로 참여할 수 없어요.'}});
  return route.fulfill({status:404,json:{error:'Unexpected request'}});
 });
 await page.goto(`/retouch/rooms/${roomId}`);await page.getByRole('textbox',{name:'내 닉네임'}).fill('새 친구');
 await page.getByRole('button',{name:'이 보정방에 참여하기',exact:true}).click();
 await expect(page.getByRole('heading',{name:'이 보정방은 이미 시작됐어요.'})).toBeVisible();
 expired=true;await page.reload();await page.getByRole('textbox',{name:'내 닉네임'}).fill('새 친구');await page.getByRole('button',{name:'이 보정방에 참여하기',exact:true}).click();
 await expect(page.getByRole('heading',{name:'보정방이 만료됐어요'})).toBeVisible();
 await expect(page.getByRole('link',{name:'새 보정방 만들기'})).toHaveAttribute('href','/retouch/rooms/new');
 await expect(page.getByRole('button',{name:'이 보정방에 참여하기',exact:true})).toHaveCount(0);
});

test('unsaved global back can stay or discard, and lease loss blocks saving',async({page})=>{
 const png=await sharp({create:{width:400,height:400,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 const server=await backend(page,initial('global'),png,400,400);
 await page.goto(`/retouch/rooms/${roomId}`);await page.getByRole('button',{name:'터치 보정으로 전체 다듬기',exact:true}).click();
 const save=page.getByRole('button',{name:'전체 사진 편집 완료',exact:true});await expect(save).toBeEnabled();
 const box=(await page.locator('canvas[aria-label="보정 미리보기"]').boundingBox())!;
 await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.3,{steps:4});await page.mouse.up();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'뒤로 가기',exact:true}).click();await expect(save).toBeEnabled();
 expect(server.actions).not.toContain('cancel');
 server.update({editorId:'friend',editToken:null,leaseUntil:new Date(Date.now()+90000).toISOString()});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('alert').filter({hasText:'편집권이 만료'})).toBeVisible();await expect(save).toBeDisabled();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'뒤로 가기',exact:true}).click();
 await expect(page.getByRole('button',{name:'친구의 보정을 기다려 주세요',exact:true})).toBeVisible();
 expect(server.actions).not.toContain('save');
});


test('new room participation enters lobby and preserves the returned recovery URL',async({page})=>{
 const png=await sharp({create:{width:40,height:40,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 await backend(page,{...initial('lobby'),rosterIds:[],completedIds:[]},png,40,40,undefined,'friend');
 let joined=false;
 const recoveryUrl=`/retouch/rooms/${roomId}/recover#token=fixture-recovery`;
 await page.route(`**${base}`,route=>joined?route.fallback():route.fulfill({status:403,json:{error:'참여해주세요.'}}));
 await page.route(`**/api/retouch/rooms/${roomId}/participants`,route=>{joined=true;return route.fulfill({status:201,json:{participant:{id:'friend'},recoveryUrl}});});
 await page.goto(`/retouch/rooms/${roomId}`);await page.getByRole('textbox',{name:'내 닉네임'}).fill('예솔');await page.getByRole('button',{name:'이 보정방에 참여하기',exact:true}).click();
 await expect(page.getByRole('heading',{name:'입장했어요! 친구들과 곧 시작해요.'})).toBeVisible();
 await expect(page.getByRole('button',{name:'시작하기'})).toHaveCount(0);
 expect(await page.evaluate(key=>sessionStorage.getItem(key),`picsinc-recovery:${roomId}`)).toBe(new URL(recoveryUrl,page.url()).toString());
 await page.reload();await expect(page.getByRole('heading',{name:'입장했어요! 친구들과 곧 시작해요.'})).toBeVisible();
});

test('a room already open expires and offers a new retouch room',async({page})=>{
 const png=await sharp({create:{width:40,height:40,channels:3,background:'#bcbcbc'}}).png().toBuffer();
 await backend(page,{...initial('lobby'),rosterIds:[],completedIds:[]},png,40,40);
 await page.goto(`/retouch/rooms/${roomId}`);await expect(page.getByRole('heading',{name:'함께할 친구를 초대해요'})).toBeVisible();
 await page.route(`**${base}`,route=>route.fulfill({status:410,json:{error:'방이 만료됐어요.'}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('heading',{name:'보정방이 만료됐어요'})).toBeVisible();
 await expect(page.getByRole('link',{name:'새 보정방 만들기'})).toHaveAttribute('href','/retouch/rooms/new');
 await expect(page.getByRole('button',{name:'시작하기'})).toHaveCount(0);
});
