import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { PhotoSessionService } from "./service";
import { RegionClaimConflict, SessionError } from "./errors";
import { decodeMask, MAX_PHOTO_BYTES, verifyPhoto, verifyPhotoBytes } from "./image-validation";
import type { CredentialRecord, NewAsset, PhotoSessionStore, PrivateFileStore, RegionClaim, SessionRecord, SessionSnapshot } from "./types";
import type { CompositeResult, OriginalSelection, OverlapAssignment, Participant, PhotoAsset, Selection } from "@/core/contracts";
import type { DetectedRegions } from "@/features/region-editor/detected-regions";

class MemoryFiles implements PrivateFileStore {
  entries = new Map<string, Buffer>();
  async put(key: string, body: Buffer) { this.entries.set(key, body); }
  async get(key: string) { return new Blob([new Uint8Array(this.entries.get(key)!)]); }
  async remove(keys: string[]) { keys.forEach(key => this.entries.delete(key)); }
}
class MemoryDatabase implements PhotoSessionStore {
  sessions = new Map<string, SessionRecord>(); participants: Participant[] = []; credentials: CredentialRecord[] = []; assets: PhotoAsset[] = [];
  selections: (Selection & {sessionId: string})[] = []; originals: (OriginalSelection & {sessionId: string})[] = []; overlaps: OverlapAssignment[] = [];
  detections = new Map<string, DetectedRegions>(); results = new Map<string, CompositeResult>();
  claims: (RegionClaim & { sessionId: string })[] = [];
  async listRegionClaims(sessionId: string) { return this.claims.filter(c => c.sessionId === sessionId).map(({ sessionId: _, ...claim }) => claim); }
  async setRegionClaim(input: Parameters<PhotoSessionStore["setRegionClaim"]>[0]) {
    if (!this.detections.get(input.sessionId)?.regions.some(region => region.id === input.regionId)) throw new SessionError(400, "원본에서 검출된 ID를 선택해 주세요.");
    const claim = this.claims.find(c => c.sessionId === input.sessionId && c.regionId === input.regionId);
    if (claim && claim.participantId !== input.participantId) return { claims: await this.listRegionClaims(input.sessionId), conflict: (await this.listRegionClaims(input.sessionId)).find(c => c.regionId === input.regionId)! };
    if (input.selected && !claim) this.claims.push({ sessionId: input.sessionId, regionId: input.regionId, participantId: input.participantId, nickname: this.participants.find(p => p.id === input.participantId)!.nickname });
    if (!input.selected) this.claims = this.claims.filter(c => !(c.sessionId === input.sessionId && c.regionId === input.regionId));
    return { claims: await this.listRegionClaims(input.sessionId) };
  }
  async createSession(input: Parameters<PhotoSessionStore["createSession"]>[0]) { this.sessions.set(input.session.id, input.session); this.participants.push(input.participant); this.credentials.push(input.credentials); this.assets.push({ ...input.original, uploadOrder: null }); }
  async findSessionByInvite(token: string) { return [...this.sessions.values()].find(s => s.inviteToken === token) ?? null; }
  async findCredentials(sessionId: string, participantId: string) { return this.credentials.find(c => c.sessionId === sessionId && c.participantId === participantId) ?? null; }
  async findCredentialsByRecovery(sessionId: string, hash: string) { return this.credentials.find(c => c.sessionId === sessionId && c.recoveryTokenHash === hash) ?? null; }
  async replaceSessionToken(sessionId: string, participantId: string, hash: string) { (await this.findCredentials(sessionId, participantId))!.sessionTokenHash = hash; }
  async createParticipant(input: Parameters<PhotoSessionStore["createParticipant"]>[0]) { this.participants.push(input.participant); this.credentials.push(input.credentials); this.sessions.get(input.participant.sessionId)!.version++; }
  async snapshot(sessionId: string): Promise<SessionSnapshot | null> { const session = this.sessions.get(sessionId); return session ? structuredClone({ session, participants: this.participants.filter(p => p.sessionId === sessionId), assets: this.assets.filter(a => a.sessionId === sessionId), selections: this.selections.filter(s => s.sessionId === sessionId), originalSelections: this.originals.filter(s => s.sessionId === sessionId), overlapAssignments: this.overlaps, result: this.results.get(sessionId) }) : null; }
  async publishComposition(result: CompositeResult, assets: NewAsset[], participantId: string) { const s=this.sessions.get(result.sessionId); if (!s || s.version !== result.version || s.ownerParticipantId !== participantId || !this.participants.some(p => p.sessionId===s.id && p.submitted)) return false; this.assets.push(...assets.map(asset => ({ ...asset, uploadOrder: null }))); this.results.set(s.id,result); return true; }
  async createAsset(input: NewAsset) { const asset = { ...input, uploadOrder: input.kind === "edited" ? Math.max(0, ...this.assets.filter(a => a.sessionId === input.sessionId).map(a => a.uploadOrder ?? 0)) + 1 : null }; this.assets.push(asset); if (asset.kind === "edited") { this.participants.find(p => p.id === asset.participantId)!.submitted=false; this.sessions.get(asset.sessionId)!.version++; } return asset; }
  async findAsset(sessionId: string, assetId: string) { return this.assets.find(a => a.sessionId===sessionId && a.id===assetId) ?? null; }
  async replaceOriginalSelection(input: Parameters<PhotoSessionStore["replaceOriginalSelection"]>[0]) { const s=this.sessions.get(input.sessionId)!; if(s.version!==input.expectedVersion) return null; this.originals=this.originals.filter(o=>o.participantId!==input.participantId); this.originals.push(input); this.participants.find(p=>p.id===input.participantId)!.submitted=false; return ++s.version; }
  async replaceSelection(input: Parameters<PhotoSessionStore["replaceSelection"]>[0]) { const s=this.sessions.get(input.sessionId)!; if(s.version!==input.expectedVersion) return null; this.selections=this.selections.filter(o=>o.participantId!==input.participantId || o.editedAssetId!==input.editedAssetId); this.selections.push(input); this.participants.find(p=>p.id===input.participantId)!.submitted=input.submitted; return ++s.version; }
  async replaceOverlapAssignments(input: Parameters<PhotoSessionStore["replaceOverlapAssignments"]>[0]) { const s=this.sessions.get(input.sessionId)!; if(s.version!==input.expectedVersion || s.ownerParticipantId!==input.participantId) return null; this.overlaps=input.assignments; return ++s.version; }
  async findOriginalDetection(sessionId: string) { return this.detections.get(sessionId) ?? null; }
  async cacheOriginalDetection(sessionId: string, detection: DetectedRegions) { if(!this.detections.has(sessionId)) this.detections.set(sessionId,detection); return this.detections.get(sessionId)!; }
  async findExpired(now: string) { return (await Promise.all([...this.sessions.values()].filter(s=>s.expiresAt<=now).map(s=>this.snapshot(s.id)))).filter(Boolean) as SessionSnapshot[]; }
  async deleteSession(sessionId: string) { this.sessions.delete(sessionId); this.assets=this.assets.filter(a=>a.sessionId!==sessionId); }
}
const png = { contentType: "image/png", extension: "png" } as const;
const now=()=>new Date("2026-09-18T00:00:00Z");
const errorStatus=(status:number)=>(error:unknown)=>error instanceof SessionError && error.status===status;
const pixels=(value:number)=>sharp(Buffer.alloc(100,value),{raw:{width:10,height:10,channels:1}}).png().toBuffer();
async function setup() {
  const db=new MemoryDatabase(), files=new MemoryFiles(); const service=new PhotoSessionService(db,files,now);
  const created=await service.create({nickname:"A",original:{bytes:await pixels(50),width:10,height:10,...png}});
  const auth={inviteToken:created.session.inviteToken,participantId:created.participant.id,sessionToken:created.sessionToken};
  const upload=async(kind:"edited"|"mask",value=255,credential=auth)=>service.upload({...credential,kind,bytes:await pixels(value),width:10,height:10,...png});
  const version=()=>db.sessions.get(created.session.id)!.version;
  const prepare=async(credential=auth)=>{ const mask=await upload("mask",255,credential); await service.saveOriginalSelection({...credential,maskAssetId:mask.id,selectedRegionIds:[],expectedVersion:version()}); const edit=await upload("edited",150,credential); return {edit,mask}; };
  const submit=async(credential=auth)=>{const {edit,mask}=await prepare(credential); await service.saveSelection({...credential,editedAssetId:edit.id,maskAssetId:mask.id,expectedVersion:version()}); return {edit,mask};};
  return {db,files,service,created,auth,upload,version,prepare,submit};
}

test("only stale selection versions expose the automatic retry error code", async () => {
  const { service, auth, prepare, version } = await setup();
  const { edit, mask } = await prepare();
  const isVersionConflict = (error: unknown) => error instanceof SessionError && error.status === 409 && error.code === "SESSION_VERSION_CONFLICT";
  await assert.rejects(service.saveOriginalSelection({ ...auth, maskAssetId: mask.id, selectedRegionIds: [], expectedVersion: version() - 1 }), isVersionConflict);
  await assert.rejects(service.saveSelection({ ...auth, editedAssetId: edit.id, maskAssetId: mask.id, expectedVersion: version() - 1 }), isVersionConflict);
  const claimError = new RegionClaimConflict({ regionId: "person-1", participantId: "other", nickname: "other" });
  assert.equal(claimError.code, undefined);
});

test("shared original detection is cached once across participants; private edit remains owned",async()=>{
  const {service,auth,created,upload}=await setup(); const b=await service.join(auth.inviteToken,"A"); const other={...auth,participantId:b.participant.id,sessionToken:b.sessionToken};
  const detected:DetectedRegions={width:10,height:10,previewPngBase64:"",regions:[{id:"person_001",box:{x:0,y:0,width:10,height:10},maskPngBase64:""}]}; let calls=0;
  const detect=async()=>{calls++;return detected;};
  assert.deepEqual(await service.detectAsset({...auth,assetId:created.session.originalAssetId},detect),detected);
  await service.detectAsset({...other,assetId:created.session.originalAssetId},detect); assert.equal(calls,1);
  const edit=await upload("edited"); await assert.rejects(service.detectAsset({...other,assetId:edit.id},detect),errorStatus(403));
});

test("region detection logs each stage and the failing stage without credentials",async()=>{
  const {service,db,auth,created}=await setup();
  const info: string[]=[]; const errors: string[]=[];
  let detectorRequestId: string | undefined; let cacheRequestId: string | undefined;
  const originalInfo=console.info; const originalError=console.error;
  console.info=(...args: unknown[])=>{ info.push(args.map(String).join(" ")); };
  console.error=(...args: unknown[])=>{ errors.push(args.map(String).join(" ")); };
  try {
    db.cacheOriginalDetection=async(_sessionId, _detection, requestId?: string)=>{ cacheRequestId=requestId; throw new Error("cache unavailable"); };
    await assert.rejects(service.detectAsset({...auth,assetId:created.session.originalAssetId},async(_bytes, _size, requestId)=>{
      detectorRequestId=requestId;
      return {width:10,height:10,previewPngBase64:"",regions:[]};
    }),/cache unavailable/);
  } finally {
    console.info=originalInfo; console.error=originalError;
  }
  const entries=[...info,...errors].filter(line=>line.startsWith("photo region detection ")).map(line=>JSON.parse(line.slice("photo region detection ".length)));
  assert.equal(new Set(entries.map(entry=>entry.requestId)).size,1);
  assert.equal(detectorRequestId,entries[0].requestId);
  assert.equal(cacheRequestId,entries[0].requestId);
  for(const name of ["authorize","asset-lookup","cache-lookup","photo-download","yolo-detection","reauthorize"]){
    assert.ok(entries.some(entry=>entry.step===name && entry.status==="start"),`${name} start`);
    assert.ok(entries.some(entry=>entry.step===name && entry.status==="success"),`${name} success`);
  }
  assert.ok(entries.some(entry=>entry.step==="cache-save" && entry.status==="start"));
  assert.ok(entries.some(entry=>entry.step==="cache-save" && entry.status==="failure" && entry.errorMessage==="cache unavailable"));
  const output=[...info,...errors].join("\n");
  assert.ok(!output.includes(auth.inviteToken));
  assert.ok(!output.includes(auth.sessionToken));
});

test("invitation exposes only the owner nickname for an active link",async()=>{
  const {service,auth,db,files}=await setup();
  assert.deepEqual(await service.invitation(auth.inviteToken),{ownerNickname:"A"});
  await assert.rejects(service.invitation("invalid"),errorStatus(404));
  const expired=new PhotoSessionService(db,files,()=>new Date("2026-09-19T00:00:01Z"));
  await assert.rejects(expired.invitation(auth.inviteToken),errorStatus(410));
});

test("original selection requires owned nonempty original-size mask and known IDs",async()=>{
  const {service,auth,upload,version}=await setup(); const empty=await upload("mask",0),full=await upload("mask");
  await assert.rejects(service.saveOriginalSelection({...auth,maskAssetId:empty.id,selectedRegionIds:[],expectedVersion:version()}),errorStatus(400));
  await assert.rejects(service.saveOriginalSelection({...auth,maskAssetId:full.id,selectedRegionIds:["unknown"],expectedVersion:version()}),errorStatus(400));
  await service.saveOriginalSelection({...auth,maskAssetId:full.id,selectedRegionIds:[],expectedVersion:version()});
  const snapshot=await service.snapshot(auth.inviteToken,auth.participantId,auth.sessionToken); assert.equal(snapshot.originalSelections[0].maskAssetId,full.id); assert.equal(snapshot.participants[0].submitted,false);
});

test("only owner composes, one submission is enough, then all can download",async()=>{
  const {service,auth,submit,version}=await setup(); const b=await service.join(auth.inviteToken,"B"); const other={...auth,participantId:b.participant.id,sessionToken:b.sessionToken}; await submit();
  await assert.rejects(service.composeResult({...other,expectedVersion:version()}),errorStatus(403));
  await assert.rejects(service.saveOverlapAssignments({...other,assignments:[],expectedVersion:version()}),errorStatus(403));
  const result=await service.composeResult({...auth,expectedVersion:version()}); const file=await service.download(other.inviteToken,other.participantId,other.sessionToken,result.resultAssetId); assert.equal(file.asset.width,10);
  assert.deepEqual(await service.composeResult({...auth,expectedVersion:version()}),result);
});

test("partial composition ignores stale selections and includes later submissions",async()=>{
  const {service,auth,upload,version}=await setup();
  await assert.rejects(service.composeResult({...auth,expectedVersion:version()}),errorStatus(400));
  const joined=await service.join(auth.inviteToken,"B");
  const other={...auth,participantId:joined.participant.id,sessionToken:joined.sessionToken};
  const halfMask=async(top:boolean,credential:typeof auth)=>{
    const raw=Buffer.alloc(100);
    for(let y=top?0:5;y<(top?5:10);y++) raw.fill(255,y*10,y*10+10);
    return service.upload({...credential,kind:"mask",bytes:await sharp(raw,{raw:{width:10,height:10,channels:1}}).png().toBuffer(),width:10,height:10,...png});
  };
  const ownerMask=await halfMask(true,auth);
  await service.saveOriginalSelection({...auth,maskAssetId:ownerMask.id,selectedRegionIds:[],expectedVersion:version()});
  const ownerEdit=await upload("edited",150);
  await service.saveSelection({...auth,editedAssetId:ownerEdit.id,maskAssetId:ownerMask.id,expectedVersion:version()});
  const otherMask=await halfMask(false,other);
  await service.saveOriginalSelection({...other,maskAssetId:otherMask.id,selectedRegionIds:[],expectedVersion:version()});
  const otherEdit=await upload("edited",220,other);
  await service.saveSelection({...other,editedAssetId:otherEdit.id,maskAssetId:otherMask.id,expectedVersion:version()});
  await upload("edited",230,other); // Revokes B's submission but keeps the older selection in storage.
  const partial=await service.composeResult({...auth,expectedVersion:version()});
  const partialBytes=Buffer.from(await (await service.download(auth.inviteToken,auth.participantId,auth.sessionToken,partial.resultAssetId)).body.arrayBuffer());
  const partialPixels=await sharp(partialBytes).removeAlpha().raw().toBuffer();
  assert.equal(partialPixels[(2*10+2)*3],150);
  assert.equal(partialPixels[(7*10+2)*3],50);
  await service.saveSelection({...other,editedAssetId:otherEdit.id,maskAssetId:otherMask.id,expectedVersion:version()});
  const complete=await service.composeResult({...auth,expectedVersion:version()});
  const completeBytes=Buffer.from(await (await service.download(auth.inviteToken,auth.participantId,auth.sessionToken,complete.resultAssetId)).body.arrayBuffer());
  const completePixels=await sharp(completeBytes).removeAlpha().raw().toBuffer();
  assert.equal(completePixels[(7*10+2)*3],220);
  assert.notEqual(complete.version,partial.version);
});

test("partial composition also ignores overlap sources owned by unsubmitted participants",async()=>{
  const {service,auth,submit,upload,version,db,files}=await setup();
  const joined=await service.join(auth.inviteToken,"B");
  const other={...auth,participantId:joined.participant.id,sessionToken:joined.sessionToken};
  await submit(); const second=await submit(other);
  await service.saveOverlapAssignments({...auth,expectedVersion:version(),assignments:[{editedAssetId:second.edit.id,maskAssetId:second.mask.id}]});
  await upload("edited",180,other);
  let selectionOwners:string[]=[]; let overlapCount=-1;
  const instrumented=new PhotoSessionService(db,files,now,async(input)=>{
    selectionOwners=input.selections.map(selection=>selection.participantId);
    overlapCount=input.overlapAssignments.length;
    const bytes=await pixels(50);
    return {png:bytes,previewPng:bytes,width:10,height:10,previewWidth:10,previewHeight:10,unassignedOverlapPixels:0};
  });
  await instrumented.composeResult({...auth,expectedVersion:version()});
  assert.deepEqual(selectionOwners,[auth.participantId]);
  assert.equal(overlapCount,0);
});

test("edit upload and original changes revoke submission; blank selection also un-submits",async()=>{
  const {service,auth,submit,upload,version,db}=await setup(); const {edit,mask}=await submit(); const participant=()=>db.participants.find(p=>p.id===auth.participantId)!;
  assert.equal(participant().submitted,true); const before=version(); await upload("edited"); assert.equal(version(),before+1); assert.equal(participant().submitted,false);
  await service.saveSelection({...auth,editedAssetId:edit.id,maskAssetId:mask.id,expectedVersion:version()});
  await service.saveOriginalSelection({...auth,maskAssetId:mask.id,selectedRegionIds:[],expectedVersion:version()}); assert.equal(participant().submitted,false);
  const empty=await upload("mask",0); await service.saveSelection({...auth,editedAssetId:edit.id,maskAssetId:empty.id,expectedVersion:version()}); assert.equal(participant().submitted,false);
});

test("submission requires original selection and never accepts somebody else's mask",async()=>{
  const {service,auth,upload,version}=await setup(); const edit=await upload("edited"),mask=await upload("mask");
  await assert.rejects(service.saveSelection({...auth,editedAssetId:edit.id,maskAssetId:mask.id,expectedVersion:version()}),errorStatus(400));
  const b=await service.join(auth.inviteToken,"A"); await assert.rejects(service.saveOriginalSelection({...auth,participantId:b.participant.id,sessionToken:b.sessionToken,maskAssetId:mask.id,selectedRegionIds:[],expectedVersion:version()}),errorStatus(403));
});

test("recovery retains ownership, rotates credential, stale saves preserve current selection",async()=>{
  const {service,auth,created,prepare,version}=await setup(); const {edit,mask}=await prepare(); const stale=version(); await service.saveSelection({...auth,editedAssetId:edit.id,maskAssetId:mask.id,expectedVersion:stale});
  await assert.rejects(service.saveSelection({...auth,editedAssetId:edit.id,maskAssetId:mask.id,expectedVersion:stale}),errorStatus(409));
  const recovery=await service.recover(auth.inviteToken,created.recoveryToken); await assert.rejects(service.authorize(auth.inviteToken,auth.participantId,auth.sessionToken),errorStatus(403));
  assert.equal((await service.authorize(auth.inviteToken,auth.participantId,recovery.sessionToken)).ownerParticipantId,auth.participantId);
});

test("late join during rendering rejects publication and cleans only unpublished outputs",async()=>{
  const {service,auth,submit,db,files,version}=await setup(); await submit(); const fileCount=files.entries.size,assetCount=db.assets.length;
  const composer=new PhotoSessionService(db,files,now,async()=>{await service.join(auth.inviteToken,"late"); const bytes=await pixels(150); return {png:bytes,previewPng:bytes,width:10,height:10,previewWidth:10,previewHeight:10,unassignedOverlapPixels:0};});
  await assert.rejects(composer.composeResult({...auth,expectedVersion:version()}),errorStatus(409)); assert.equal(files.entries.size,fileCount); assert.equal(db.assets.length,assetCount);
});

test("multiple edited selections remain independent",async()=>{
  const {service,auth,submit,upload,version}=await setup(); const first=await submit(); const second=await submit(); const replacement=await upload("mask");
  await service.saveSelection({...auth,editedAssetId:first.edit.id,maskAssetId:replacement.id,expectedVersion:version()});
  const snapshot=await service.snapshot(auth.inviteToken,auth.participantId,auth.sessionToken); assert.equal(snapshot.selections.length,2); assert.equal(snapshot.selections.find(s=>s.editedAssetId===second.edit.id)?.maskAssetId,second.mask.id);
});

test("overlap masks reject intersecting pixels",async()=>{
  const {service,auth,submit,version}=await setup(); const a=await submit(),b=await submit();
  await assert.rejects(service.saveOverlapAssignments({...auth,expectedVersion:version(),assignments:[{editedAssetId:a.edit.id,maskAssetId:a.mask.id},{editedAssetId:b.edit.id,maskAssetId:b.mask.id}]}),errorStatus(400));
});

test("expiry blocks access and removes expired room files",async()=>{
  const {created,auth,db,files}=await setup(); const later=new PhotoSessionService(db,files,()=>new Date("2026-09-19T00:00:01Z"));
  await assert.rejects(later.authorize(auth.inviteToken,auth.participantId,auth.sessionToken),errorStatus(410)); assert.equal(await later.deleteExpired(),1); assert.equal(files.entries.size,0); assert.equal(db.sessions.has(created.session.id),false);
});

test("JPEG preserves bytes with EXIF display coordinates and masks require grayscale",async()=>{
  const bytes=await sharp({create:{width:2,height:3,channels:3,background:"white"}}).jpeg().withMetadata({orientation:6}).toBuffer(); const photo=await verifyPhotoBytes(bytes); assert.deepEqual([photo.width,photo.height],[3,2]); assert.equal(photo.bytes,bytes);
  assert.equal((await decodeMask(await pixels(255))).selected.length,100);
  const red=await sharp({create:{width:2,height:2,channels:3,background:"red"}}).png().toBuffer(); await assert.rejects(decodeMask(red),errorStatus(400));
});

test("uploads reject oversized bytes, decoded dimensions and MIME mismatch",async()=>{
  await assert.rejects(verifyPhotoBytes(Buffer.alloc(MAX_PHOTO_BYTES+1)),errorStatus(400));
  const huge=await sharp({create:{width:6400,height:6400,channels:3,background:"black"}}).png().toBuffer(); await assert.rejects(verifyPhotoBytes(huge),errorStatus(400));
  const bytes=await pixels(100); await assert.rejects(verifyPhoto(new File([new Uint8Array(bytes)],"fake.jpg",{type:"image/jpeg"})),errorStatus(400)); await assert.rejects(verifyPhotoBytes(bytes,{width:11,height:10}),errorStatus(400));
});


test("simultaneous original detections return the first persisted IDs to both callers",async()=>{
  const {service,auth,created}=await setup();
  const region=(id:string):DetectedRegions=>({width:10,height:10,previewPngBase64:"",regions:[{id,box:{x:0,y:0,width:10,height:10},maskPngBase64:""}]});
  let releaseFirst!:(result:DetectedRegions)=>void;
  let started!:()=>void; const firstStarted=new Promise<void>(resolve=>{started=resolve;});
  const first=service.detectAsset({...auth,assetId:created.session.originalAssetId},async()=>{started();return new Promise(resolve=>{releaseFirst=resolve;});});
  await firstStarted;
  const winner=await service.detectAsset({...auth,assetId:created.session.originalAssetId},async()=>region("stable"));
  releaseFirst(region("discarded")); assert.deepEqual(await first,winner);
});

test("saving a mask checks actual decoded size, not only uploaded metadata",async()=>{
  const {service,auth,version}=await setup();
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer();
  const mask=await service.upload({...auth,kind:"mask",bytes,width:10,height:10,...png});
  await assert.rejects(service.saveOriginalSelection({...auth,maskAssetId:mask.id,selectedRegionIds:[],expectedVersion:version()}),errorStatus(400));
});

test("uploaded original is analyzed without a storage read; cached results survive process state loss", async () => {
  const {service,files,auth,created} = await setup();
  const original = [...files.entries.values()][0]; let reads = 0, runs = 0;
  files.get = async () => { reads++; throw new Error("unexpected download"); };
  const result: DetectedRegions = {width:10,height:10,previewPngBase64:"",regions:[]};
  const detector = async (bytes: Buffer) => { assert.equal(bytes, original); runs++; return result; };
  await service.detectAsset({...auth,assetId:created.session.originalAssetId}, detector, original);
  assert.equal(reads,0); assert.equal(runs,1);
  assert.deepEqual((await service.originalDetectionContext(auth)).cached,result);
  await service.detectAsset({...auth,assetId:created.session.originalAssetId}, detector);
  assert.equal(reads,0); assert.equal(runs,1);
  await assert.rejects(service.originalDetectionContext({...auth,sessionToken:"invalid"}),errorStatus(403));
});

test("missing process state resumes from stored original; expired rooms fail before execution and before cache save", async () => {
  const {service,files,auth,created,db} = await setup(); let reads = 0;
  const originalGet = files.get.bind(files); files.get = async key => { reads++; return originalGet(key); };
  const result: DetectedRegions = {width:10,height:10,previewPngBase64:"",regions:[]};
  const input = {...auth,assetId:created.session.originalAssetId};
  await assert.rejects(service.detectAsset(input,async () => { db.sessions.get(created.session.id)!.expiresAt = "2020-01-01T00:00:00Z"; return result; }),errorStatus(410));
  assert.equal(reads,1); assert.equal(db.detections.size,0);
  await assert.rejects(service.detectAsset(input,async () => { assert.fail("expired image analyzed"); }),errorStatus(410));
});

test("first region click has one owner, conflicting select or release identifies that participant", async () => {
  const { service, auth, db, created, version } = await setup();
  const joined = await service.join(auth.inviteToken, "B");
  const other = { ...auth, participantId: joined.participant.id, sessionToken: joined.sessionToken };
  db.detections.set(created.session.id, { width: 10, height: 10, previewPngBase64: "", regions: [{ id: "person_001", box: { x: 0, y: 0, width: 10, height: 10 }, maskPngBase64: "" }] });
  const before = version();
  const outcomes = await Promise.allSettled([
    service.setRegionClaim({ ...auth, regionId: "person_001", selected: true }),
    service.setRegionClaim({ ...other, regionId: "person_001", selected: true }),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const claims = await service.regionClaims(other);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0], { regionId: "person_001", participantId: auth.participantId, nickname: "A" });
  await assert.rejects(service.setRegionClaim({ ...other, regionId: "person_001", selected: false }), error => error instanceof RegionClaimConflict && error.claim.nickname === "A");
  await service.setRegionClaim({ ...auth, regionId: "person_001", selected: true });
  assert.equal((await service.regionClaims(auth)).length, 1);
  assert.equal(version(), before, "draft claims must not invalidate another participant's mask save");
  await service.setRegionClaim({ ...auth, regionId: "person_001", selected: false });
  await service.setRegionClaim({ ...other, regionId: "person_001", selected: true });
  assert.equal((await service.regionClaims(auth))[0].participantId, other.participantId);
});

test("region claims reject unknown regions, invalid credentials and expired rooms, survive recovery", async () => {
  const { service, auth, db, files, created } = await setup();
  db.detections.set(created.session.id, { width: 10, height: 10, previewPngBase64: "", regions: [{ id: "person_001", box: { x: 0, y: 0, width: 10, height: 10 }, maskPngBase64: "" }] });
  db.findOriginalDetection = async () => { throw new Error("Claim toggles must not fetch the full detection payload"); };
  await assert.rejects(service.setRegionClaim({ ...auth, regionId: "missing", selected: true }), errorStatus(400));
  await assert.rejects(service.setRegionClaim({ ...auth, regionId: "person_001", selected: "yes" as unknown as boolean }), errorStatus(400));
  await assert.rejects(service.regionClaims({ ...auth, sessionToken: "wrong" }), errorStatus(403));
  await service.setRegionClaim({ ...auth, regionId: "person_001", selected: true });
  const recovered = await service.recover(auth.inviteToken, created.recoveryToken);
  assert.equal((await service.regionClaims({ ...auth, ...recovered }))[0].participantId, auth.participantId);
  const expired = new PhotoSessionService(db, files, () => new Date("2026-09-19T00:00:01Z"));
  await assert.rejects(expired.regionClaims({ ...auth, ...recovered }), errorStatus(410));
  await assert.rejects(expired.setRegionClaim({ ...auth, ...recovered, regionId: "person_001", selected: false }), errorStatus(410));
});

test("original mask save requires selected IDs to be owned while manual mask overlap remains allowed", async () => {
  const { service, auth, db, created, upload, version } = await setup();
  const joined = await service.join(auth.inviteToken, "B");
  const other = { ...auth, participantId: joined.participant.id, sessionToken: joined.sessionToken };
  db.detections.set(created.session.id, { width: 10, height: 10, previewPngBase64: "", regions: [{ id: "person_001", box: { x: 0, y: 0, width: 10, height: 10 }, maskPngBase64: "" }] });
  const mask = await upload("mask");
  await assert.rejects(service.saveOriginalSelection({ ...auth, maskAssetId: mask.id, selectedRegionIds: ["person_001"], expectedVersion: version() }), errorStatus(409));
  await service.setRegionClaim({ ...other, regionId: "person_001", selected: true });
  await assert.rejects(service.saveOriginalSelection({ ...auth, maskAssetId: mask.id, selectedRegionIds: ["person_001"], expectedVersion: version() }), error => error instanceof RegionClaimConflict && error.claim.participantId === other.participantId);
  await service.saveOriginalSelection({ ...auth, maskAssetId: mask.id, selectedRegionIds: [], expectedVersion: version() });
  await service.setRegionClaim({ ...other, regionId: "person_001", selected: false });
  await service.setRegionClaim({ ...auth, regionId: "person_001", selected: true });
  await service.saveOriginalSelection({ ...auth, maskAssetId: mask.id, selectedRegionIds: ["person_001"], expectedVersion: version() });
  assert.deepEqual(db.originals[0].selectedRegionIds, ["person_001"]);
});
