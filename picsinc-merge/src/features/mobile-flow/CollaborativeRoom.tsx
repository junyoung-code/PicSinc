"use client";
import { useEffect, useRef, useState } from "react";
import { Notice, StatusMessage } from "@/components/mobile-shell";
import MobileShell from "@/features/retouch-room-flow/RetouchShell";
import styles from "@/features/retouch-room-flow/room.module.css";
import type { CollaborationAction, CollaborationView } from "@/features/photo-session/collaboration-types";
import type { DetectedRegions } from "@/features/region-editor/detected-regions";
import MobileRegionEditor from "@/features/region-editor/MobileRegionEditor";
import RetouchEditor, { type RoomEditRecord } from "@/features/face-retouch/ui/RetouchEditor";
import { uploadAsset } from "@/core/remote-client";
import type { FlowSnapshot } from "./flow-state";
import { jsonRequest, request, RequestError } from "./client";
import { saveEditorSelection } from "./save-editor-selection";
import { visiblePolling } from "./polling";
import ParticipantStatus from "./ParticipantStatus";

type Editor = { scope: "personal" | "global"; token: string; version: number; imageId: string; maskId?: string };
type Claim = { regionId: string; participantId: string; nickname: string };
export default function CollaborativeRoom({ inviteToken, initialSnapshot, initialRoom }: { inviteToken: string; initialSnapshot: FlowSnapshot; initialRoom: CollaborationView }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot), [room, setRoom] = useState(initialRoom);
  const [editor, setEditor] = useState<Editor | null>(null), [claims, setClaims] = useState<Claim[] | null>(null);
  const [detection, setDetection] = useState<DetectedRegions | null>(null), [detecting, setDetecting] = useState(false);
  const [error, setError] = useState(""), [detectionError, setDetectionError] = useState(""), [busy, setBusy] = useState(false), [expired, setExpired] = useState(false);
  const [shareUrl, setShareUrl] = useState(""), [now, setNow] = useState(Date.now());
  const revision = useRef(0), claimRevision = useRef(0), initialClaims = useRef<Claim[] | null>(null);
  const dirty = useRef(false), detailBack = useRef<(() => boolean) | null>(null), saving = useRef(false);
  const pendingSave = useRef<{ edit: RoomEditRecord['edit']; assetId: string } | null>(null);
  const latest = useRef({ room, editor, snapshot }); latest.current = { room, editor, snapshot };
  const base = `/api/sessions/${encodeURIComponent(inviteToken)}`;
  const me = snapshot.currentParticipantId, owner = snapshot.session.ownerParticipantId === me;
  const original = snapshot.assets.find(a => a.id === snapshot.session.originalAssetId)!;
  const selection = snapshot.originalSelections.find(s => s.participantId === me);
  const done = room.completedIds.includes(me);
  const ownIds = (initialClaims.current ?? []).filter(c => c.participantId === me).map(c => c.regionId);
  const savedIdsMatch = !!selection && selection.selectedRegionIds.length === ownIds.length && ownIds.every(id => selection.selectedRegionIds.includes(id));
  const assetUrl = (id: string) => `${base}/assets/${encodeURIComponent(id)}`;
  const report = (e: unknown) => { if (e instanceof RequestError && e.status === 410) setExpired(true); setError((e as Error).message); };
  const roster = <ParticipantStatus participants={snapshot.participants} completedIds={room.completedIds} currentId={me} rosterIds={room.rosterIds}/>;

  async function refresh() {
    const started = revision.current;
    const [s, r] = await Promise.all([request<FlowSnapshot>(base), request<CollaborationView>(`${base}/collaboration`)]);
    if (started === revision.current) { setSnapshot(s); setRoom(r); } return {snapshot:s, room:r};
  }
  async function command(body: CollaborationAction) {
    ++revision.current;
    const next = await request<CollaborationView>(`${base}/collaboration`, jsonRequest(body));
    ++revision.current; setRoom(next); return next;
  }
  async function act(body: CollaborationAction) {
    if (busy) return;
    setBusy(true); setError("");
    try { await command(body); await refresh(); } catch (e) { report(e); } finally { setBusy(false); }
  }
  useEffect(() => {
    setShareUrl(`${location.origin}/retouch/rooms/${encodeURIComponent(inviteToken)}`);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const stop = visiblePolling(3000, async () => { try { await refresh(); } catch (e) { report(e); } });
    return () => { clearInterval(clock); stop(); };
  }, [base]);
  useEffect(() => {
    if (room.phase !== "personal" || expired) return;
    let active = true;
    const stop = visiblePolling(3000, async () => {
      const started = claimRevision.current;
      try { const result = await request<{claims: Claim[]}>(`${base}/region-claims`); if (active && started === claimRevision.current) { initialClaims.current ??= result.claims; setClaims(result.claims); } } catch (e) { if (active) report(e); }
    });
    return () => { active = false; stop(); };
  }, [base, room.phase, expired]);
  useEffect(() => {
    if (room.phase !== "personal" || detection || expired) return;
    let active = true;
    const stop = visiblePolling(3000, async () => {
      try {
        const job = await request<{status: string; resultUrl?: string; error?: string}>(`${base}/original-detection`);
        if (!active) return;
        setDetecting(job.status !== "failed");
        if (job.status === "failed") { setDetecting(false); setDetectionError(job.error || "얼굴 영역을 찾지 못했어요. 다시 시도해주세요."); }
        if (job.status === "ready" && job.resultUrl) {
          const response = await fetch(job.resultUrl); if (!response.ok) throw new Error("분석 결과를 불러오지 못했어요.");
          const value = await response.json(); if (active) { setDetection(value); setDetecting(false); setDetectionError(""); }
        }
      } catch (e) { if (active) { setDetecting(false); setDetectionError((e as Error).message); } }
    });
    return () => { active = false; stop(); };
  }, [base, room.phase, detection, expired]);
  // Composition runs on the existing durable worker. Reopening the room resumes it.
  useEffect(() => {
    if (room.phase !== "composing" || !owner || !snapshot.result || snapshot.result.version !== snapshot.session.version) return;
    void command({action:"open-global",resultAssetId:snapshot.result.resultAssetId}).catch(report);
  }, [room.phase, snapshot.result?.resultAssetId, snapshot.session.version, owner]);
  useEffect(() => {
    if (editor?.scope !== "global" || expired) return;
    const beat = () => { void command({action:"heartbeat",token:editor.token}).catch(report); };
    beat(); const timer = setInterval(beat, 20_000);
    return () => clearInterval(timer);
  }, [editor?.token, expired]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (dirty.current || saving.current) { e.preventDefault(); e.returnValue = ""; } };
    const back = () => {
      if (detailBack.current) { if (detailBack.current()) detailBack.current = null; else history.pushState({roomDetail:true}, "", location.href); return; }
      if (latest.current.editor) void cancelEditor(true);
    };
    window.addEventListener("beforeunload", leave); window.addEventListener("popstate", back);
    return () => { window.removeEventListener("beforeunload", leave); window.removeEventListener("popstate", back); };
  }, [base]);

  async function toggleClaim(regionId: string, selected: boolean) {
    ++claimRevision.current;
    const response = await fetch(`${base}/region-claims`, jsonRequest({regionId,selected}, "PUT"));
    const body = await response.json();
    if (response.status === 409 && body.claim) { setClaims(previous => [...(previous ?? []).filter(c => c.regionId !== regionId), body.claim]); return {ok:false as const,nickname:body.claim.nickname}; }
    if (!response.ok) throw new RequestError(body.error, response.status, body.code);
    ++claimRevision.current; setClaims(body.claims); return {ok:true as const};
  }
  async function openPersonal(mask?: Blob, ids?: string[]) {
    setBusy(true); setError("");
    try {
      if (mask && ids) {
        const uploaded = await uploadAsset(base,"mask",mask);
        await saveEditorSelection({base,snapshot,maskAssetId:uploaded.asset.id,selectedRegionIds:ids,saveOriginal:true,submit:false});
      }
      const r = await command({action:"personal-begin"});
      if (!r.personalToken || !r.personalMaskAssetId) throw new Error("편집 영역을 열지 못했어요.");
      // The selection screen remounts after cancel: restore this visit's claims.
      initialClaims.current = claims;
      dirty.current = false; pendingSave.current = null;
      setEditor({scope:"personal",token:r.personalToken,version:r.version,imageId:original.id,maskId:r.personalMaskAssetId});
      history.pushState({roomEdit:true},"",location.href); await refresh().catch(report);
    } catch (e) { report(e); throw e; } finally { setBusy(false); }
  }
  async function openGlobal() {
    setBusy(true); setError("");
    try {
      const r = await command({action:"acquire"});
      if (!r.editToken || !r.latestAssetId) throw new Error("편집권을 얻지 못했어요.");
      dirty.current = false; pendingSave.current = null;
      setEditor({scope:"global",token:r.editToken,version:r.version,imageId:r.latestAssetId});
      history.pushState({roomEdit:true},"",location.href);
    } catch (e) { report(e); } finally { setBusy(false); }
  }
  function closeEditor() {
    dirty.current = false; pendingSave.current = null;
    latest.current = {...latest.current, editor:null}; setEditor(null);
    if (history.state?.roomEdit) history.back();
  }
  async function cancelEditor(fromBack = false) {
    const current = latest.current.editor;
    if (!current) return;
    const stay = () => { if (fromBack) history.pushState({roomEdit:true}, "", location.href); };
    if (saving.current) { stay(); return; }
    if (dirty.current && !window.confirm("변경사항을 저장하지 않고 나갈까요?")) { stay(); return; }
    try { await command({action:current.scope === "personal" ? "personal-cancel" : "cancel",token:current.token}); }
    catch (e) { if (!(e instanceof RequestError && [409,410].includes(e.status))) { report(e); stay(); return; } }
    closeEditor(); await refresh().catch(report);
  }
  async function save(blob: Blob, state: RoomEditRecord) {
    const current = latest.current.editor; if (!current) throw new Error("편집 세션이 끝났어요.");
    saving.current = true;
    try {
      let assetId = pendingSave.current?.edit === state.edit ? pendingSave.current.assetId : undefined;
      if (!assetId) { assetId = (await uploadAsset(base,"edited",blob)).asset.id; pendingSave.current = {edit:state.edit,assetId}; }
      const body: CollaborationAction = current.scope === "personal" ? {action:"personal-save",token:current.token,editedAssetId:assetId,state} : {action:"save",token:current.token,baseVersion:current.version,editedAssetId:assetId,state};
      try { await command(body); }
      catch (e) {
        // The server receipts the token + upload ID, so a lost response is safe to retry.
        if (e instanceof TypeError || e instanceof RequestError && e.status >= 500) await command(body);
        else throw e;
      }
      closeEditor(); await refresh().catch(report);
    } finally { saving.current = false; }
  }
  async function downloadFinal() {
    if (!room.latestAssetId) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(assetUrl(room.latestAssetId)); if (!response.ok) throw new Error("사진 저장에 실패했어요. 다시 눌러주세요.");
      const url = URL.createObjectURL(await response.blob()), a = document.createElement("a"); a.href=url;a.download="moira-final.png";a.click();setTimeout(()=>URL.revokeObjectURL(url),60_000);
    } catch (e) { report(e); } finally { setBusy(false); }
  }
  const remaining = Math.max(0, Date.parse(snapshot.session.expiresAt) - now);
  if (expired || !remaining) return <MobileShell title="보정방 만료"><h1>보정방이 만료됐어요</h1><p>방 생성 후 24시간이 지났어요.</p><a href="/retouch/rooms/new">새 보정방 만들기</a></MobileShell>;
  if (editor) {
    const valid = editor.scope === "personal" ? room.phase === "personal" && room.personalToken === editor.token && !done : room.phase === "global" && room.editToken === editor.token && room.editorId === me && Date.parse(room.leaseUntil ?? "") > now;
    return <RetouchEditor key={editor.token} participants={<>{roster}<StatusMessage message={error}/>{!valid && <p role="alert">편집권이 만료되었거나 단계가 바뀌었어요. 뒤로 가서 최신 상태를 확인해주세요.</p>}</>} room={{imageUrl:assetUrl(editor.imageId),maskUrl:editor.maskId?assetUrl(editor.maskId):undefined,scope:editor.scope,nickname:snapshot.participants.find(p=>p.id===me)?.nickname??"나",disabled:!valid,onSave:save,onCancel:()=>void cancelEditor(),onDirtyChange:value=>{dirty.current=value;}}}/>;
  }
  const editorName = snapshot.participants.find(p => p.id === room.editorId)?.nickname;
  const locked = !!room.editorId && Date.parse(room.leaseUntil ?? "") > now;
  let footer: React.ReactNode;
  if (room.phase === "lobby" && owner) footer = <button className="primary-button" disabled={busy} onClick={()=>void act({action:"start"})}>모두 모였어요 · 얼굴 인식 시작</button>;
  if ((room.phase === "personal" && room.rosterIds.length > 0 && room.completedIds.length === room.rosterIds.length || room.phase === "composing") && owner) footer = <button className="primary-button" disabled={busy} onClick={()=>void act({action:"compose"})}>{room.phase === "composing" ? "합성 상태 확인·재시도" : "전체 사진 단계로"}</button>;
  if (room.phase === "global") footer = <><button className="primary-button" disabled={busy || locked && room.editorId !== me} onClick={()=>void openGlobal()}>전체 사진 터치 보정</button>{owner && <button className="secondary-button" disabled={busy || locked} onClick={()=>void act({action:"end-global"})}>추가 보정 없이 결과 확인</button>}</>;
  if (room.phase === "review" && owner) footer = <button className="primary-button" disabled={busy} onClick={()=>void act({action:"finalize"})}>최종 완료</button>;
  return <MobileShell title={room.phase === "final" ? "완성 사진" : "MOIRA / 함께 보정하기"} action={room.phase === "final" ? <button disabled={busy} aria-label="사진 저장" onClick={()=>void downloadFinal()}>{busy?"저장 중…":"저장"}</button> : undefined} progress={{lobby:15,personal:40,composing:65,global:75,review:90,final:100}[room.phase]} footer={room.phase === "final" ? <a className="secondary-button" href="/retouch/rooms/new">처음부터 다시 하기</a> : footer}>
    {room.phase === "final" && <span className={styles.badge}>우리의 보정, 완료!</span>}
    <h1>{{lobby:"친구들을 기다려요",personal:done?"내 보정이 저장됐어요":"내 영역을 선택해요",composing:"모두의 보정을 합치고 있어요",global:"전체 사진을 함께 확인해요",review:"최종 결과를 확인해요",final:"모두의 마음에 드는\n우리 사진 완성."}[room.phase]}</h1>
    {room.phase === "lobby" && <><p className="description">모두 참여한 뒤 대표자가 인식을 시작하면 입장이 마감돼요.</p><button className="secondary-button" onClick={()=>void navigator.clipboard.writeText(shareUrl).then(()=>setError("초대 링크를 복사했어요.")).catch(()=>setError("링크를 길게 눌러 복사해주세요."))}>초대 링크 복사</button><input aria-label="초대 링크" value={shareUrl} readOnly className="collaboration-link"/><p>남은 시간 {Math.floor(remaining/3600000)}시간 {Math.floor(remaining/60000)%60}분</p></>}
    {room.phase !== "final" && roster}
    {room.phase === "final" && <p className="description">각자의 취향이 한 장에 모였어요.</p>}
    {room.phase === "personal" && !done && <>
      {room.personalToken && <button className="secondary-button" disabled={busy} onClick={()=>void openPersonal().catch(()=>{})}>내 영역 보정 이어가기</button>}
      {!room.personalToken && claims === null && <p role="status">선택 상태를 불러오고 있어요.</p>}
      {!room.personalToken && claims !== null && <MobileRegionEditor imageUrl={assetUrl(original.id)} width={original.width} height={original.height} detection={detection} detecting={detecting} detectionError={detectionError} busy={busy} initialMaskUrl={savedIdsMatch?assetUrl(selection!.maskAssetId):undefined} initialSelectedIds={ownIds} regionClaims={claims} currentParticipantId={me} participantNickname={snapshot.participants.find(p=>p.id===me)?.nickname} onRegionToggle={toggleClaim} onSave={openPersonal} saveLabel="이 영역 보정하기" saveActionLabel="보정 시작" onDirtyChange={v=>{dirty.current=v;}} onDetailOpen={fn=>{detailBack.current=fn;history.pushState({roomDetail:true},"",location.href);}} onRetryDetection={()=>void request(`${base}/original-detection`,{method:"POST"}).then(()=>setDetectionError("")).catch(report)}/>}
    </>}
    {room.phase === "personal" && done && <p className="description">친구들의 개인 보정이 끝나면 전체 사진을 보정할 수 있어요.</p>}
    {room.phase === "composing" && <Notice>개인 보정은 모두 저장됐어요. 합성 결과가 준비되면 전체 사진 단계로 이동해요.</Notice>}
    {room.phase === "global" && <p aria-live="polite">{locked?`${editorName??"친구"}님이 전체 사진을 보정 중이에요. 잠시 기다려주세요.`:"한 번에 한 명씩 원하는 부분을 보정할 수 있어요."}</p>}
    {room.phase === "review" && !owner && <p>대표자가 최종 완료할 때까지 기다려주세요.</p>}
    {room.latestAssetId && ["global","review","final"].includes(room.phase) && <img className={styles.result} src={assetUrl(room.latestAssetId)} alt={room.phase==="final"?"확정된 최종 사진":"저장된 보정 결과"}/>}
    {room.phase === "final" && <p className={styles.done}><img src="/images/retouch-ui/check.svg" alt="" />모두의 보정이 반영됐어요</p>}
    <StatusMessage message={error}/>
  </MobileShell>;
}
