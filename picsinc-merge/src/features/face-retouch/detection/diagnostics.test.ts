import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDetectionError, detectionLogKey, parseFailureLog, recordDetectionFailure, type DetectionDiagnostic } from './diagnostics';
import { detectFaces } from './client';
import { POST } from '../../../app/api/retouch/diagnostics/route';

const diagnostic: DetectionDiagnostic = {stage:'model-init',reason:'network',errorName:'TypeError',width:4000,height:6000,regionCount:4,regionIndex:-1,cropWidth:0,cropHeight:0,elapsedMs:1200};
const log = () => ({schemaVersion:1,recordedAt:Date.now(),browser:'chrome-ios',browserMajor:130,platform:'ios',diagnostic});
function global(t: TestContext, key: string, value: unknown) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{configurable:true,value});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else Reflect.deleteProperty(globalThis,key);});
}
function sinks(t: TestContext) {
  let stored='[]';const requests:RequestInit[]=[],consoleLogs:unknown[][]=[];
  global(t,'navigator',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130.0.1 Mobile Safari/604.1',maxTouchPoints:5});
  global(t,'localStorage',{getItem:(key:string)=>{assert.equal(key,detectionLogKey);return stored;},setItem:(_key:string,value:string)=>{stored=value;}});
  t.mock.method(console,'error',(...args:unknown[])=>{consoleLogs.push(args);});
  t.mock.method(globalThis,'fetch',async(url:unknown,options:RequestInit)=>{assert.equal(url,'/api/retouch/diagnostics');requests.push(options);throw new Error('offline');});
  return {requests,consoleLogs,saved:()=>JSON.parse(stored)};
}

test('logs preserve only ten safe entries when offline and identify Chrome on iOS', t => {
  const s=sinks(t);
  for(let i=0;i<12;i++)recordDetectionFailure({...diagnostic,elapsedMs:i});
  assert.equal(s.saved().length,10);assert.equal(s.saved()[0].diagnostic.elapsedMs,2);
  assert.equal(s.requests.length,12);assert.equal(s.consoleLogs.length,12);
  const sent=JSON.parse(s.requests[0].body as string);
  assert.equal(sent.browser,'chrome-ios');assert.equal(sent.platform,'ios');assert.equal(sent.browserMajor,130);
  assert.equal(s.requests[0].credentials,'omit');assert.equal(s.requests[0].referrerPolicy,'no-referrer');
});

test('storage and delivery failures never replace the detection error', t => {
  const s=sinks(t);
  global(t,'localStorage',{getItem:()=>{throw new Error('storage blocked');}});
  assert.doesNotThrow(()=>recordDetectionFailure(diagnostic));
  assert.equal(s.requests.length,1);
});

test('validation excludes raw messages, identity, URLs, photos and landmarks', () => {
  const entry=log();
  const raw={...entry,inviteToken:'secret',userAgent:'raw UA',image:'private bytes',diagnostic:{...diagnostic,message:'https://private/image?token=secret',stack:'stack',landmarks:[{x:1,y:2}],mask:'bytes'}};
  assert.deepEqual(parseFailureLog(raw),entry);
  assert.doesNotMatch(JSON.stringify(parseFailureLog(raw)),/secret|private|landmarks|stack|mask|image|userAgent/);
  assert.equal(parseFailureLog({...log(),diagnostic:{...diagnostic,width:90000}}),null);
  assert.equal(parseFailureLog({...log(),diagnostic:{...diagnostic,stage:'arbitrary personal text'}}),null);
  assert.deepEqual(classifyDetectionError(new WebAssembly.RuntimeError('memory access out of bounds')),{reason:'memory',errorName:'RuntimeError'});
});

test('server logs only validated metadata and rejects cross-origin, malformed and oversized bodies', async t => {
  const written:unknown[][]=[];t.mock.method(console,'error',(...args:unknown[])=>{written.push(args);});
  const request=(body:string,origin='https://moira.io.kr',type='application/json')=>new Request('https://moira.io.kr/api/retouch/diagnostics',{method:'POST',headers:{origin,'content-type':type},body});
  const response=await POST(request(JSON.stringify({...log(),token:'private-token'})));
  assert.equal(response.status,204);assert.equal(written.length,1);
  assert.equal(written[0][0],'[retouch-detection-failed]');assert.doesNotMatch(written[0][1] as string,/private-token/);
  for(const [body,origin,type,status] of [
    [JSON.stringify(log()),'https://other.example','application/json',403],
    [JSON.stringify(log()),'https://moira.io.kr','text/plain',415],
    ['{','https://moira.io.kr','application/json',400],
    ['x'.repeat(2049),'https://moira.io.kr','application/json',413],
    ['{}','https://moira.io.kr','application/json',400],
  ] as const)assert.equal((await POST(request(body,origin,type))).status,status);
  assert.equal(written.length,1);
});

test('server accepts the actual HTTP origin when Next reconstructs an internal hostname', async t => {
  t.mock.method(console,'error',()=>{});
  const request=new Request('http://localhost:3148/api/retouch/diagnostics',{method:'POST',headers:{host:'127.0.0.1:3148',origin:'http://127.0.0.1:3148','content-type':'application/json'},body:JSON.stringify(log())});
  assert.equal((await POST(request)).status,204);
});

class FakeWorker {
  static latest:FakeWorker;
  onmessage?: (event:{data:unknown})=>void;
  onerror?: (event:unknown)=>void;
  constructor(){FakeWorker.latest=this;}
  postMessage(){}
  terminate(){}
}
const bitmap=()=>({width:4000,height:6000}) as ImageBitmap;
test('worker failures are logged once while user-facing errors stay unchanged', async t => {
  const s=sinks(t);global(t,'Worker',FakeWorker);
  const job=detectFaces(bitmap());
  FakeWorker.latest.onmessage!({data:{error:'original user message',diagnostic}});
  await assert.rejects(job.result,{message:'original user message'});
  assert.equal(s.requests.length,1);assert.deepEqual(s.saved()[0].diagnostic,diagnostic);
});

test('worker runtime errors and timeouts are recorded; cancellation and success stay silent', async t => {
  const s=sinks(t);global(t,'Worker',FakeWorker);t.mock.timers.enable({apis:['setTimeout']});
  const failed=detectFaces(bitmap());FakeWorker.latest.onerror!({error:new Error('WebGL context lost')});
  await assert.rejects(failed.result,/분석기를 실행/);assert.equal(s.saved()[0].diagnostic.reason,'webgl');
  const timed=detectFaces(bitmap()),rejection=assert.rejects(timed.result,/시간이 초과/);
  t.mock.timers.tick(90000);await rejection;assert.equal(s.saved()[1].diagnostic.stage,'worker-timeout');
  const cancelled=detectFaces(bitmap());cancelled.cancel();await assert.rejects(cancelled.result,/선택이 변경/);
  const success=detectFaces(bitmap());FakeWorker.latest.onmessage!({data:{landmarks:[]}});assert.deepEqual(await success.result,[]);
  assert.equal(s.requests.length,2);
});
