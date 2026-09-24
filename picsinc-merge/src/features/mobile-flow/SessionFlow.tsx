"use client";
import { uploadAsset, detectRemote, composeRemote } from "@/core/remote-client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import MobileShell, { Notice, PhotoPicker, StatusMessage } from "@/components/mobile-shell";
import MobileRegionEditor from "@/features/region-editor/MobileRegionEditor";
import RegionEditor from "@/features/region-editor/RegionEditor";
import type { DetectedRegions } from "@/features/region-editor/detected-regions";
import { editedPhotoDisplay } from "@/features/photo-session/edited-photo-display";
import { allowedStep, resumeStep, type FlowSnapshot, type Step } from "./flow-state";
import { jsonRequest, photoError, rememberRecovery, request, RequestError, usePreview } from "./client";
import { originalDetectionMonitor } from "./original-detection-monitor";
import type { OriginalDetectionState } from "@/features/photo-session/original-detection-state";

const labels: Record<Step, string> = { invite: "친구 초대하기", select: "내 얼굴 선택", guide: "내 사진 보정하기", upload: "보정본 올리기", review: "선택 영역 확인", status: "제출 현황", result: "최종 사진", overlap: "겹친 영역 확인" };
const progress: Record<Step, number> = { invite: 48, select: 65, guide: 32, upload: 48, review: 72, status: 81, result: 100, overlap: 90 };

function remainingTime(expiresAt: string, now: number) {
  const minutes = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

export default function SessionFlow({ inviteToken }: { inviteToken: string }) {
  const base = `/api/sessions/${encodeURIComponent(inviteToken)}`;
  const [data, setData] = useState<FlowSnapshot>();
  const [step, setStep] = useState<Step>("select");
  const [message, setMessage] = useState("");
  const [canJoin, setCanJoin] = useState(false);
  const [expired, setExpired] = useState(false);
  const [nickname, setNickname] = useState("");
  const [inviter, setInviter] = useState("");
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [editedId, setEditedId] = useState("");
  const [pendingEditId, setPendingEditId] = useState("");
  const [detection, setDetection] = useState<DetectedRegions | null>(null);
  const [detectionState, setDetectionState] = useState<OriginalDetectionState>({ status: "queued" });
  const detectionError = detectionState.error ?? "";
  const [loadingDetection, setLoadingDetection] = useState(false);
  const detecting = loadingDetection || ["idle", "queued", "running"].includes(detectionState.status);
  const [toast, setToast] = useState("");
  const [mergeDelayed, setMergeDelayed] = useState(false);
  const [claims, setClaims] = useState<{ regionId: string; participantId: string; nickname: string }[] | null>(null);
  const claimRequest = useRef(0);
  const initialClaims = useRef<typeof claims>(null);
  const [shareUrl, setShareUrl] = useState("");
  const editingStarted = useRef(false);
  const detectionLoaded = useRef(false);
  const retryDetection = useRef<() => void>(() => {});
  const editorBack = useRef<(() => boolean) | null>(null);
  const current = useRef({ data, step, dirty }); current.current = { data, step, dirty };
  const preview = usePreview(file);

  const me = data?.participants.find(p => p.id === data.currentParticipantId);
  const owner = data?.session.ownerParticipantId === data?.currentParticipantId;
  const photoDisplay = editedPhotoDisplay(data?.assets ?? [], data?.participants ?? []);
  const ownEdits = photoDisplay.edits.filter(a => a.participantId === data?.currentParticipantId);
  const original = data?.assets.find(a => a.id === data.session.originalAssetId);
  const initialSelection = data?.originalSelections.find(s => s.participantId === data.currentParticipantId);
  const selectedEdit = ownEdits.find(a => a.id === editedId) ?? ownEdits.at(-1);
  // Pin the default by ID; the URL also restores an explicit choice after a reload.
  useEffect(() => { if (selectedEdit && !editedId) chooseEdit(selectedEdit.id); }, [selectedEdit?.id, editedId]);
  const savedSelection = data?.selections.find(s => s.participantId === data.currentParticipantId && s.editedAssetId === selectedEdit?.id);
  const submittedCount = data?.participants.filter(p => p.submitted).length ?? 0;
  const currentResult = Boolean(data?.result && data.result.version === data.session.version);
  const assetUrl = (id: string) => `${base}/assets/${encodeURIComponent(id)}`;

  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);

  function chooseEdit(id: string) {
    setEditedId(id);
    const url = new URL(location.href); url.searchParams.set("photo", id);
    history.replaceState(history.state, "", url);
  }
  function recordStep(next: Step, replace = false) {
    const url = new URL(location.href); url.searchParams.set("step", next);
    history[replace ? "replaceState" : "pushState"](null, "", url);
    setStep(next); setMessage(""); window.scrollTo({ top: 0 });
  }
  function navigate(next: Step) {
    if (busy) return;
    if (dirty && !window.confirm("저장하지 않은 영역 수정이 있어요. 저장하지 않고 이동할까요?")) return;
    setDirty(false); recordStep(data ? allowedStep(next, data) : next);
  }
  function openDetailEditor(onBack: () => boolean) {
    editorBack.current = onBack;
    history.pushState({ ...(history.state ?? {}), __picsincDetailEditor: true }, "", location.href);
  }
  async function refresh() {
    const snapshot = await request<FlowSnapshot>(base);
    setData(snapshot); return snapshot;
  }
  function report(error: unknown) {
    if (error instanceof RequestError && error.status === 410) setExpired(true);
    setMessage(error instanceof Error ? error.message : "연결을 확인하고 다시 시도해 주세요.");
  }
  useEffect(() => {
    let cancelled = false;
    setShareUrl(`${location.origin}/sessions/${inviteToken}`);
    void request<FlowSnapshot>(base).then(snapshot => {
      if (cancelled) return;
      const requestedPhoto = new URL(location.href).searchParams.get("photo");
      const owned = editedPhotoDisplay(snapshot.assets, snapshot.participants).edits.filter(asset => asset.participantId === snapshot.currentParticipantId);
      const initialPhoto = owned.find(asset => asset.id === requestedPhoto) ?? owned.at(-1);
      if (initialPhoto) chooseEdit(initialPhoto.id);
      setData(snapshot); recordStep(allowedStep(new URL(location.href).searchParams.get("step"), snapshot), true);
    }).catch(error => {
      if (cancelled) return;
      if (error instanceof RequestError && error.status === 403) {
        void request<{ ownerNickname: string }>(`${base}/invitation`).then(summary => { if (!cancelled) { setInviter(summary.ownerNickname); setCanJoin(true); } }).catch(reason => { if (!cancelled) report(reason); });
      } else report(error);
    });
    return () => { cancelled = true; };
  }, [base, inviteToken]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (current.current.dirty || merging || busy) { event.preventDefault(); event.returnValue = ""; } };
    const pop = (event: PopStateEvent) => {
      if (editorBack.current) {
        if (editorBack.current()) editorBack.current = null;
        else history.pushState({ ...(history.state ?? {}), __picsincDetailEditor: true }, "", location.href);
        return;
      }
      // A forward navigation to a closed editor must not reopen a discarded draft.
      if (event.state?.__picsincDetailEditor) {
        history.replaceState({ ...event.state, __picsincDetailEditor: false }, "", location.href);
        return;
      }
      const state = current.current; if (!state.data) return;
      if (state.dirty && !window.confirm("저장하지 않은 수정이 있어요. 이동할까요?")) {
        const url = new URL(location.href); url.searchParams.set("step", state.step);
        history.pushState(null, "", url);
        return;
      }
      setDirty(false); recordStep(allowedStep(new URL(location.href).searchParams.get("step"), state.data), true);
    };
    window.addEventListener("beforeunload", unload); window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener("popstate", pop); };
  }, [merging, busy]);

  // Only status screens poll. Never reinitialize the editor's draft from polling.
  useEffect(() => {
    if (!data || !["status", "invite"].includes(step) || merging || expired) return;
    let active = true, pending = false;
    const poll = async () => {
      if (document.visibilityState !== "visible" || pending) return;
      pending = true;
      try { const snapshot = await request<FlowSnapshot>(base); if (active) { setData(snapshot); if (step === "status" && snapshot.result?.version === snapshot.session.version) showNewResult(snapshot); } }
      catch (error) { if (active) report(error); }
      finally { pending = false; }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    const focus = () => void poll(); window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [Boolean(data), step, merging, expired, base]);

  function showNewResult(snapshot: FlowSnapshot) {
    if (!snapshot.result) return;
    setMerging(true);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { recordStep("result", true); setMerging(false); };
    image.onerror = () => { recordStep("result", true); setMerging(false); setMessage("미리보기를 불러오지 못했어요. 다시 열어 주세요."); };
    image.src = assetUrl(snapshot.result.previewAssetId);
  }

  useEffect(() => {
    if (!original || expired || !["invite", "select", "review"].includes(step)) return;
    let active = true;
    const monitor = originalDetectionMonitor({
      read: () => request<OriginalDetectionState>(`${base}/original-detection`),
      start: () => request<OriginalDetectionState>(`${base}/original-detection`, { method: "POST" }),
      result: async () => {
        setLoadingDetection(true);
        try { return await detectRemote(base, original.id); }
        finally { if (active) setLoadingDetection(false); }
      },
      canApply: () => step !== "invite" && !editingStarted.current && !detectionLoaded.current,
      onState: setDetectionState,
      onResult: result => { detectionLoaded.current = true; setDetection(result); },
      onError: error => { if (error instanceof RequestError && error.status === 410) setExpired(true); },
    });
    const check = () => { if (document.visibilityState === "visible") void monitor.check(); };
    retryDetection.current = () => { setDetectionState({ status: "queued" }); void monitor.check(true); };
    check();
    const timer = window.setInterval(() => { if (monitor.polling()) check(); }, 3000);
    window.addEventListener("focus", check); document.addEventListener("visibilitychange", check);
    return () => {
      active = false; monitor.dispose(); retryDetection.current = () => {}; setLoadingDetection(false);
      clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check);
    };
  }, [base, original?.id, step, expired]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setMergeDelayed(false);
    if (!merging) return;
    const timer = window.setTimeout(() => setMergeDelayed(true), 30_000);
    return () => clearTimeout(timer);
  }, [merging]);

  // Fetch only ownership; polling must never replace the editor's unsaved mask.
  useEffect(() => {
    if (!data || !["select", "review"].includes(step) || expired) return;
    let active = true;
    initialClaims.current = null; setClaims(null);
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      const generation = ++claimRequest.current;
      try {
        const result = await request<{ claims: NonNullable<typeof claims> }>(`${base}/region-claims`);
        if (active && generation === claimRequest.current) { initialClaims.current ??= result.claims; setClaims(result.claims); }
      } catch (error) { if (active) report(error); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    const focus = () => void poll();
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [Boolean(data), base, step, expired]);

  async function toggleClaim(regionId: string, selected: boolean): Promise<{ ok: true } | { ok: false; nickname: string }> {
    ++claimRequest.current;
    const response = await fetch(`${base}/region-claims`, jsonRequest({ regionId, selected }, "PUT"));
    const result = await response.json();
    ++claimRequest.current;
    if (response.status === 409 && result.claim) {
      setClaims(previous => [...(previous ?? []).filter(c => c.regionId !== regionId), result.claim]);
      return { ok: false, nickname: result.claim.nickname };
    }
    if (!response.ok) throw new Error(result.error || "선택 상태를 저장하지 못했어요. 다시 시도해 주세요.");
    setClaims(result.claims);
    return { ok: true };
  }

  function editorDirty(value: boolean) {
    if (value) editingStarted.current = true;
    setDirty(value);
  }

  async function join() {
    if (busy || !nickname.trim()) return;
    setBusy(true); setMessage("");
    const form = new FormData(); form.set("nickname", nickname.trim());
    try {
      const body = await request<{ recoveryUrl: string }>(`${base}/participants`, { method: "POST", body: form });
      rememberRecovery(inviteToken, body.recoveryUrl);
      const snapshot = await refresh(); setCanJoin(false); recordStep(resumeStep(snapshot), true);
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function upload() {
    if ((!file && !(owner && (selectedEdit || pendingEditId) && !me?.submitted)) || busy) return;
    setBusy(true); setMessage("");
    try {
      let editId = pendingEditId || selectedEdit?.id;
      if (file) {
        const body = await uploadAsset(base, "edited", file);
        editId = body.asset.id; setPendingEditId(editId); chooseEdit(editId); setFile(null);
      }
      const snapshot = await refresh();
      if (!owner) { recordStep("select"); return; }
      if (snapshot.participants.some(participant => participant.id === snapshot.currentParticipantId && participant.submitted) && snapshot.selections.some(selection => selection.participantId === snapshot.currentParticipantId && selection.editedAssetId === editId)) { setPendingEditId(""); recordStep("status"); return; }
      const originalSelection = snapshot.originalSelections.find(selection => selection.participantId === snapshot.currentParticipantId);
      if (!originalSelection || !editId) throw new Error("저장된 얼굴 영역이나 보정본이 없습니다. 다시 확인해 주세요.");
      await request(`${base}/selection`, jsonRequest({ maskAssetId: originalSelection.maskAssetId, editedAssetId: editId, expectedVersion: snapshot.session.version }, "PUT"));
      await refresh(); setPendingEditId(""); recordStep("status");
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) { await refresh().catch(report); setMessage("다른 변경이 먼저 저장됐어요. 업로드한 사진은 유지됩니다. 내용을 확인한 뒤 다시 제출해 주세요."); }
      else report(error);
    } finally { setBusy(false); }
  }
  async function save(mask: Blob, selectedRegionIds: string[]) {
    if (!data) throw new Error("작업을 먼저 불러와 주세요.");
    setBusy(true); setMessage("");
    try {
      const uploaded = await uploadAsset(base, "mask", mask);
      if (step === "select") {
        const original = await request<{ version: number }>(`${base}/original-selection`, jsonRequest({ maskAssetId: uploaded.asset.id, selectedRegionIds, expectedVersion: data.session.version }, "PUT"));
        if (!owner) {
          if (!selectedEdit) throw new Error("보정본을 먼저 올려 주세요.");
          await request(`${base}/selection`, jsonRequest({ maskAssetId: uploaded.asset.id, editedAssetId: selectedEdit.id, expectedVersion: original.version }, "PUT"));
        }
      }
      else {
        if (!selectedEdit) throw new Error("보정본을 먼저 올려 주세요.");
        await request(`${base}/selection`, jsonRequest({ maskAssetId: uploaded.asset.id, editedAssetId: selectedEdit.id, expectedVersion: data.session.version }, "PUT"));
      }
      setDirty(false); await refresh(); recordStep(step === "select" && owner ? "upload" : "status");
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) { await refresh(); throw new Error("다른 변경이 먼저 저장됐어요. 선택 영역은 유지됩니다. 확인한 뒤 한 번 더 저장해 주세요."); }
      report(error); throw error;
    } finally { setBusy(false); }
  }
  async function compose() {
    if (!data || busy || !owner || !submittedCount) return;
    setBusy(true); setMerging(true); setMessage("");
    try { await composeRemote(base, data.session.version, status => setMessage(status === "queued" ? "처리 순서를 기다리고 있어요. 잠시 후 다시 확인해도 됩니다." : "사진을 합치고 있어요.")); await refresh(); recordStep("result"); }
    catch (error) { report(error); if (error instanceof RequestError && error.status === 409) await refresh().catch(report); }
    finally { setBusy(false); setMerging(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(shareUrl); setToast("초대 링크를 복사했어요."); }
    catch { setMessage("링크를 선택해서 복사해 주세요."); }
  }

  if (expired) return <MobileShell title="보정방 만료"><h1>보정방이 만료됐어요</h1><p className="description">사진은 방을 만든 뒤 24시간 동안 보관됩니다. 새 보정방에서 다시 시작해 주세요.</p><a className="primary-button" href="/sessions/new">새 보정방 만들기</a></MobileShell>;
  if (!data) return <MobileShell title="PicSync" helpTopic={canJoin ? "join" : undefined} progress={10} footer={canJoin ? <button className="primary-button" disabled={busy || !nickname.trim()} onClick={() => void join()}>{busy ? "참여하는 중…" : "참여하기"}</button> : undefined}>
    {canJoin ? <><div className="intro"><p className="eyebrow">{inviter} 님의 초대</p><h1>함께 찍은 사진을<br />각자 보정해요</h1><p className="description">평소 쓰는 앱에서 내 얼굴을 보정한 뒤<br />사진을 올리면 한 장으로 합쳐드려요.</p></div><form onSubmit={event => { event.preventDefault(); void join(); }}><label className="name-field">내 이름<input required autoComplete="nickname" maxLength={40} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="친구들이 알아볼 이름" /></label></form></> : <div className="loading-screen"><div className="spinner" /><p>보정방을 불러오고 있어요.</p></div>}
    <StatusMessage message={message} />{message && !canJoin && <button className="secondary-button" onClick={() => location.reload()}>다시 불러오기</button>}
  </MobileShell>;
  if (merging) return <MobileShell title="사진 합치는 중" progress={81}><div className="loading-screen merging-screen"><img className="figma-spinner" src="/images/figma/processing-spinner.svg" alt="" /><h1>{mergeDelayed ? <>평소보다 오래<br />걸리고 있어요</> : <>각자의 보정을<br />한 장에 담고 있어요</>}</h1><p className="description">{mergeDelayed ? <>사진을 안전하게 합치고 있어요.<br />최대 3분 정도 걸릴 수 있어요.</> : message || "선택한 얼굴만 원본 사진에 자연스럽게 합치는 중이에요."}</p></div></MobileShell>;

  const roster = <ul className="participant-list">{photoDisplay.participants.map(person => <li key={person.id}><span className="avatar" aria-hidden="true" /><span className="participant-name">{person.nickname}{person.id === me?.id ? " (나)" : ""}</span><span className={`badge ${person.submitted ? "complete" : ""}`}>{person.submitted ? "제출 완료" : person.id === data.session.ownerParticipantId && step === "invite" ? "대표자" : "보정 중"}</span></li>)}</ul>;
  const shareField = <div className="share-field"><input aria-label="친구에게 보낼 초대 링크" value={shareUrl} readOnly onFocus={event => event.currentTarget.select()} /><button className="small-button" onClick={() => void copy()}>복사</button></div>;
  let content: ReactNode, footer: ReactNode;
  if (step === "invite") {
    content = <><h1>보정방이 만들어졌어요</h1><p className="description">링크를 보내면 친구들이 앱 설치 없이 참여할 수 있어요.</p>{shareField}<>{detectionState.status === "failed" && <StatusMessage message={detectionError} />}</>{detectionState.status === "failed" && <button className="text-button" onClick={() => retryDetection.current()}>분석 다시 시도</button>}<div className="room-time"><span>보정방 유지 시간</span><strong>{now ? remainingTime(data.session.expiresAt, now) : "계산 중"}</strong></div><h2>참여자</h2>{roster}</>;
    footer = <><a className="text-button restart-link" href="/sessions/new">처음부터 다시 하기</a><button className="primary-button" onClick={() => navigate(resumeStep(data))}>시작하기</button></>;
  } else if (step === "select" || step === "review") {
    const review = step === "review";
    const ownIds = (initialClaims.current ?? []).filter(c => c.participantId === data.currentParticipantId).map(c => c.regionId);
    const savedIdsMatch = (initialSelection?.selectedRegionIds ?? []).every(id => ownIds.includes(id)) && ownIds.every(id => initialSelection?.selectedRegionIds.includes(id));
    const maskId = !savedIdsMatch ? undefined : review ? savedSelection?.maskAssetId ?? initialSelection?.maskAssetId : initialSelection?.maskAssetId;
    content = <><h1>{review ? <>보정한 사진과<br />선택 영역을 확인해주세요</> : <>사진 속 내 얼굴을<br />모두 선택해주세요</>}</h1><p className="description">{review ? "윤곽이 달라졌다면 영역을 조정한 뒤 제출해 주세요." : "보정 영역을 선택해서 편집할 수 있어요."}</p>
      {review && ownEdits.length > 0 && <div className="thumbs" aria-label="내 보정본 선택">{ownEdits.map(edit => <button className="thumb" key={edit.id} aria-pressed={edit.id === selectedEdit?.id} onClick={() => { if (!dirty || window.confirm("저장하지 않은 수정을 버리고 다른 보정본을 열까요?")) { setDirty(false); chooseEdit(edit.id); } }}><img src={assetUrl(edit.id)} alt={photoDisplay.labels[edit.id]} />{photoDisplay.labels[edit.id]}</button>)}</div>}
      {claims === null && <p role="status" className="description">선택 상태를 불러오고 있어요.</p>}
      {original && claims !== null && <MobileRegionEditor key={review || !owner ? selectedEdit?.id : "original"} imageUrl={assetUrl((review || !owner) && selectedEdit ? selectedEdit.id : original.id)} width={original.width} height={original.height} detection={detection} initialMaskUrl={maskId ? assetUrl(maskId) : undefined} initialSelectedIds={ownIds} regionClaims={claims ?? []} currentParticipantId={data.currentParticipantId} onRegionToggle={toggleClaim} participantNickname={me?.nickname} saveActionLabel={owner && !review ? "다음" : "제출"} busy={busy || (detecting && !editingStarted.current)} detecting={detecting && !editingStarted.current} detectionError={detectionError} onRetryDetection={() => retryDetection.current()} onDirtyChange={editorDirty} onDetailOpen={openDetailEditor} onSave={save} saveLabel={owner && !review ? "이대로 진행하기" : "선택한 얼굴 제출하기"} />}
      {review && <button className="text-button" onClick={() => navigate("upload")}>다른 보정본 올리기</button>}{!me?.submitted && currentResult && <button className="text-button" onClick={() => navigate("result")}>현재 병합 결과 보기</button>}</>;
  } else if (step === "guide") {
    content = <><h1>평소 하던 대로<br />내 얼굴을 보정해주세요</h1><ol className="guide-list"><li><span className="step-number">1</span><div><strong>원본 사진 저장</strong><p>같은 원본을 휴대폰에 저장해요.</p></div></li><li><span className="step-number">2</span><div><strong>평소 쓰던 앱에서 보정</strong><p>Meitu, SNOW, EPIK 등을 사용해요.</p></div></li><li><span className="step-number">3</span><div><strong>보정한 사진 업로드</strong><p>다시 이 링크로 돌아와 사진 전체를 올려요.</p></div></li></ol><Notice>웹페이지를 닫아도 괜찮아요. 초대 링크로 돌아오면 이어서 진행할 수 있어요.</Notice>{currentResult && <button className="text-button" onClick={() => navigate("result")}>현재 병합 결과 보기</button>}</>;
    footer = <><button className="primary-button" onClick={() => navigate("upload")}>이미 보정했어요</button></>;
  } else if (step === "upload") {
    content = <><h1>보정이 끝난 사진을<br />올려주세요</h1><p className="description">내 얼굴만 보정한 전체 사진을 선택해주세요.</p><PhotoPicker file={file} preview={preview} label="보정한 사진 선택" busy={busy} onChange={next => { const error = next ? photoError(next) : ""; setMessage(error); setFile(error ? null : next); }} /><Notice>사진을 자르거나 회전했다면 원본과 맞지 않을 수 있어요.</Notice>{owner && !me?.submitted && (selectedEdit || pendingEditId) && !file && <p className="description">업로드한 보정본이 있어요. 다시 올리지 않고 제출을 이어갈 수 있어요.</p>}{!owner && currentResult && <button className="text-button" onClick={() => navigate("result")}>현재 병합 결과 보기</button>}</>;
    footer = <button className="primary-button" disabled={(!file && !(owner && (selectedEdit || pendingEditId) && !me?.submitted)) || busy} onClick={() => void upload()}>{busy ? "처리 중…" : owner && !file && (selectedEdit || pendingEditId) && !me?.submitted ? "업로드한 보정본 제출하기" : "계속"}</button>;
  } else if (step === "status") {
    content = <><h1>{owner ? <>{data.participants.length}명 중 {submittedCount}명이<br />보정을 마쳤어요</> : me?.submitted ? <>이제 친구들의 보정을<br />기다리고 있어요</> : <>내 얼굴을 선택해<br />제출해주세요</>}</h1><p className="description">페이지를 닫아도 진행 상황이 유지돼요.{!owner && <><br />같은 링크에서 다시 확인할 수 있어요.</>}</p>{roster}<Notice>{owner ? "제출된 보정본으로만 합쳐지며, 미제출자의 얼굴은 원본으로 유지돼요." : "대표자가 ‘사진 합치기’ 버튼을 누르면 병합이 시작돼요."}</Notice></>;
    footer = owner ? <button className="primary-button" disabled={!submittedCount || busy} onClick={() => void compose()}>{submittedCount ? "현재 결과로 병합하기" : "한 명 이상 제출하면 병합할 수 있어요"}</button> : <button className="secondary-button" onClick={() => void refresh().catch(report)}>현황 새로고침</button>;
  } else if (step === "overlap") {
    content = <><h1>겹친 부분에 사용할<br />사진을 골라주세요</h1><p className="description">표시된 겹침을 확인하고 영역별 보정본을 지정해 주세요. 저장한 뒤 다시 병합합니다.</p><div className="overlap-editor"><RegionEditor inviteToken={inviteToken} overlapOnly onDirtyChange={setDirty} onSaved={() => { setDirty(false); void refresh().then(() => recordStep("status")).catch(report); }} /></div></>;
  } else {
    content = <><div className="result-heading"><h1>우리 모두가 원하는<br />사진이 완성됐어요</h1><p className="description">다 함께 찍은 사진을 공유해보아요.</p></div>{data.result && <img className="photo-preview" src={assetUrl(data.result.previewAssetId)} alt="함께 보정한 최종 사진" />}
      {data.result && data.result.version !== data.session.version && <Notice>제출 내용이 바뀌었어요. 아래 사진은 이전 결과입니다. 대표자가 다시 병합해 주세요.</Notice>}
      {Boolean(data.result?.unassignedOverlapPixels) && <Notice>겹친 영역에 임시로 적용된 보정본이 있어요. 대표자가 확인하고 수정할 수 있어요.</Notice>}
    </>;
    footer = <>{data.result && <a className="primary-button" href={assetUrl(data.result.resultAssetId)} download>사진 저장하기</a>}<a className="text-button restart-link" href="/sessions/new">처음부터 다시 만들기</a></>;
  }
  const previous: Partial<Record<Step, Step>> = { select: owner ? "invite" : "upload", upload: owner ? "select" : "guide", review: "upload", status: owner ? "upload" : "select", result: "status", overlap: "result" };
  return <MobileShell helpTopic={step === "invite" ? "invite" : step === "select" || step === "review" ? "select" : step === "upload" ? "upload" : step === "guide" ? "guide" : step === "status" && owner ? "status" : undefined} title={step === "status" && !owner && me?.submitted ? "제출 완료" : labels[step]} progress={progress[step]} onBack={step === "invite" ? () => location.assign("/sessions/new") : previous[step] ? () => navigate(previous[step]!) : undefined} footer={footer}>
    {content}<StatusMessage message={message} />
    {toast && <div className="copy-toast" role="status">{toast}</div>}
  </MobileShell>;
}
