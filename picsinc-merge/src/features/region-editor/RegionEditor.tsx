"use client";

import type { DetectedRegions } from "./detected-regions";
import { editedPhotoDisplay } from "@/features/photo-session/edited-photo-display";
import type { CompositeResult } from "@/core/contracts";
import { composeRemote, detectRemote, uploadAsset } from "@/core/remote-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyExclusive, overlapMask, paintBrush, paintEllipse, screenToImage, type Point } from "./mask-geometry";

type Asset = { id: string; participantId: string | null; kind: string; width: number; height: number; uploadOrder: number | null };
type Selection = { participantId: string; editedAssetId: string; maskAssetId: string };
type Assignment = { editedAssetId: string; maskAssetId: string };
type Snapshot = { session: { version: number; originalAssetId: string }; currentParticipantId: string; participants: { id: string; nickname: string }[]; assets: Asset[]; selections: Selection[]; overlapAssignments: Assignment[]; result?: CompositeResult | null };
type Tool = "region" | "ellipse" | "brush" | "erase";
const empty = (size: number) => new Uint8Array(size);

export default function RegionEditor({ inviteToken, overlapOnly = false, onSaved, onDirtyChange }: { inviteToken: string; overlapOnly?: boolean; onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef<Point | null>(null);
  const [data, setData] = useState<Snapshot>();
  const [editedId, setEditedId] = useState("");
  const [tool, setTool] = useState<Tool>(overlapOnly ? "brush" : "region");
  const [refining, setRefining] = useState(false);
  const attemptedDetection = useRef(new Set<string>());
  const [brushSize, setBrushSize] = useState(35);
  const [mode, setMode] = useState<"personal" | "overlap">(overlapOnly ? "overlap" : "personal");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dirtyEdits, setDirtyEdits] = useState<Record<string, boolean>>({});
  const personalDirty = Object.values(dirtyEdits).some(Boolean);
  const [assignmentsDirty, setAssignmentsDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(personalDirty || assignmentsDirty); }, [personalDirty, assignmentsDirty, onDirtyChange]);
  const [showComposite, setShowComposite] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const redrawRef = useRef<() => void>(() => {});
  const [drafts, setDrafts] = useState<Record<string, Uint8Array>>({});
  const [regionPreviews, setRegionPreviews] = useState<Record<string, string>>({});
  const [detecting, setDetecting] = useState(false);
  const [detections, setDetections] = useState<Record<string, (DetectedRegions["regions"][number] & { mask: Uint8Array })[]>>({});
  const [savedSelections, setSavedSelections] = useState<Record<string, Uint8Array>>({});
  const [assignmentMasks, setAssignmentMasks] = useState<Record<string, Uint8Array>>({});
  const [assignmentEditedId, setAssignmentEditedId] = useState("");
  const [message, setMessage] = useState("영역을 불러오는 중입니다.");
  const original = data?.assets.find((asset) => asset.id === data.session.originalAssetId);
  const personal = drafts[editedId] ?? (original ? empty(original.width * original.height) : undefined);
  const photoDisplay = editedPhotoDisplay(data?.assets ?? [], data?.participants ?? []);
  const edits = photoDisplay.edits;
  const mine = edits.filter((asset) => asset.participantId === data?.currentParticipantId);
  // 공동 편집은 화면의 개인 초안이 아니라, 마지막 저장본만 기준으로 삼는다.
  const savedOverlap = useMemo(() => overlapMask(Object.values(savedSelections)), [savedSelections]);
  // 원본 비교는 화면에 보이는 사진만 바꾼다. 현재 보정본과 캔버스 초안은 그대로 둔다.
  const backgroundId = mode === "personal"
    ? (showOriginal ? original?.id ?? "" : editedId)
    : (showComposite && data?.result ? data.result.previewAssetId : assignmentEditedId || original?.id || "");

  const backgroundUrl = mode === "personal" && !showOriginal && regionPreviews[editedId]
    ? regionPreviews[editedId]
    : backgroundId ? `/api/sessions/${inviteToken}/assets/${backgroundId}` : "";

  async function decodeMaskUrl(url: string, size: { width: number; height: number }) {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, size.width, size.height);
    const rgba = context.getImageData(0, 0, size.width, size.height).data;
    const mask = new Uint8Array(size.width * size.height);
    for (let pixel = 0; pixel < mask.length; pixel++) mask[pixel] = rgba[pixel * 4] > 0 ? 1 : 0;
    return mask;
  }

  const decodeMask = (assetId: string, size: { width: number; height: number }) => decodeMaskUrl(`/api/sessions/${inviteToken}/assets/${assetId}`, size);

  async function load() {
    if (saving || loading || detecting) return;
    if ((personalDirty || assignmentsDirty) && !window.confirm("저장하지 않은 수정을 버리고 새 내용을 불러올까요?")) return;
    setLoading(true);
    setMessage("영역을 불러오는 중입니다.");
    try {
      const response = await fetch(`/api/sessions/${inviteToken}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "영역을 불러오지 못했습니다.");
      const snapshot = body as Snapshot;
      const source = snapshot.assets.find((asset) => asset.id === snapshot.session.originalAssetId);
      if (!source) throw new Error("원본 사진을 찾을 수 없습니다.");
      const pairs = await Promise.all(snapshot.selections.map(async (selection) => [selection.editedAssetId, await decodeMask(selection.maskAssetId, source)] as const));
      const assignments = await Promise.all(snapshot.overlapAssignments.map(async (assignment) => [assignment.editedAssetId, await decodeMask(assignment.maskAssetId, source)] as const));
      const saved = Object.fromEntries(pairs);
      const allEdited = editedPhotoDisplay(snapshot.assets, snapshot.participants).edits;
      const ownEdited = allEdited.filter(asset => asset.participantId === snapshot.currentParticipantId);
      setDirtyEdits({}); setAssignmentsDirty(false);
      setData(snapshot); setSavedSelections(saved);
      setDrafts(Object.fromEntries(ownEdited.map(asset => [asset.id, saved[asset.id] ?? empty(source.width * source.height)])));
      setAssignmentMasks(Object.fromEntries(assignments));
      setEditedId(current => ownEdited.some(asset => asset.id === current) ? current : snapshot.selections.find(selection => selection.participantId === snapshot.currentParticipantId)?.editedAssetId ?? ownEdited[0]?.id ?? "");
      const requestedPhoto = new URL(location.href).searchParams.get("overlapPhoto");
      setAssignmentEditedId(current => allEdited.some(asset => asset.id === current) ? current : allEdited.find(asset => asset.id === requestedPhoto)?.id ?? snapshot.overlapAssignments[0]?.editedAssetId ?? allEdited[0]?.id ?? "");
      setMessage(ownEdited.length ? "내 영역을 편집할 수 있습니다." : "내 영역은 보정본을 올린 뒤 편집할 수 있습니다. 겹친 부분은 계속 정할 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "영역을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [inviteToken]);

  function chooseAssignmentPhoto(id: string) {
    setAssignmentEditedId(id);
    const url = new URL(location.href); url.searchParams.set("overlapPhoto", id);
    history.replaceState(history.state, "", url);
  }

  // Start with segmentation once per photo. Failed requests need an explicit retry.
  useEffect(() => {
    if (!editedId || !original || loading || saving || detecting || mode !== "personal") return;
    if (attemptedDetection.current.has(editedId)) return;
    attemptedDetection.current.add(editedId);
    void findRegions();
  }, [editedId, original, loading, saving, detecting, mode]);

  // 브러시 수정과 분리해, 실제 사진을 선택한 사진이 바뀔 때만 읽는다.
  useEffect(() => {
    imageRef.current = null;
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    if (!backgroundUrl) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { if (!cancelled) { imageRef.current = image; redrawRef.current(); } };
    image.onerror = () => {
      if (!cancelled) { imageRef.current = null; setMessage("사진을 표시하지 못했습니다. 새 내용을 불러와 다시 시도해 주세요."); }
    };
    image.src = backgroundUrl;
    return () => { cancelled = true; };
  }, [backgroundUrl]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !original || !personal || !imageRef.current) return;
    canvas.width = original.width; canvas.height = original.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
    const overlay = document.createElement("canvas");
    overlay.width = canvas.width; overlay.height = canvas.height;
    const overlayContext = overlay.getContext("2d")!;
    const pixels = overlayContext.createImageData(overlay.width, overlay.height);
    const selected = mode === "personal" ? personal : assignmentMasks[assignmentEditedId] ?? empty(personal.length);
    for (let pixel = 0; pixel < selected.length; pixel++) {
      const offset = pixel * 4;
      if (selected[pixel]) {
        pixels.data[offset] = mode === "personal" ? 30 : 35;
        pixels.data[offset + 1] = mode === "personal" ? 145 : 205;
        pixels.data[offset + 2] = 255; pixels.data[offset + 3] = 115;
      }
      // 겹침을 마지막에 넣어 파란 선택이 분홍 표시를 완전히 가리지 않는다.
      if (savedOverlap[pixel]) {
        pixels.data[offset] = 255; pixels.data[offset + 1] = 55; pixels.data[offset + 2] = 115;
        pixels.data[offset + 3] = selected[pixel] ? 185 : 115;
      }
    }
    overlayContext.putImageData(pixels, 0, 0);
    context.drawImage(overlay, 0, 0);

  }
  redrawRef.current = draw;
  useEffect(() => { draw(); }, [original, personal, savedSelections, assignmentMasks, assignmentEditedId, mode, backgroundId, detections]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return screenToImage({ x: event.clientX, y: event.clientY }, bounds, original!);
  }
  function mutate(apply: (mask: Uint8Array) => void) {
    if (!personal || saving || loading || detecting || (mode === "personal" && showOriginal)) return;
    if (mode === "personal") { if (!editedId) return; setDirtyEdits(current => ({ ...current, [editedId]: true })); const next = personal.slice(); apply(next); setDrafts(current => ({ ...current, [editedId]: next })); return; }
    if (!assignmentEditedId) return;
    const ids = edits.map((asset) => asset.id);
    const masks = ids.map((id) => (assignmentMasks[id] ?? empty(personal.length)).slice());
    const target = ids.indexOf(assignmentEditedId);
    if (target < 0) return;
    apply(masks[target]); applyExclusive(masks, target, savedOverlap);
    setAssignmentsDirty(true);
    setAssignmentMasks(Object.fromEntries(ids.map((id, index) => [id, masks[index]])));
  }
  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (saving || loading || detecting || (mode === "personal" && (!editedId || showOriginal))) return;
    if (mode === "personal" && tool === "region") {
      const hit = point(event);
      const pixel = Math.floor(hit.y) * original!.width + Math.floor(hit.x);
      const region = detections[editedId]?.find(region => region.mask[pixel]);
      if (region) mutate(mask => { for (let p = 0; p < mask.length; p++) mask[p] ||= region.mask[p]; });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = point(event);
    if (tool !== "ellipse") mutate((mask) => paintBrush(mask, original!.width, original!.height, drawingRef.current!, drawingRef.current!, brushSize, tool === "erase" ? 0 : 1));
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || tool === "ellipse") return;
    const next = point(event);
    mutate((mask) => paintBrush(mask, original!.width, original!.height, drawingRef.current!, next, brushSize, tool === "erase" ? 0 : 1));
    drawingRef.current = next;
  }
  function up(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    if (tool === "ellipse") {
      const end = point(event); const start = drawingRef.current;
      mutate((mask) => paintEllipse(mask, original!.width, original!.height, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, { x: (end.x - start.x) / 2, y: (end.y - start.y) / 2 }, 1));
    }
    drawingRef.current = null;
  }

  async function uploadMask(mask: Uint8Array) {
    const canvas = document.createElement("canvas");
    canvas.width = original!.width; canvas.height = original!.height;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let pixel = 0; pixel < mask.length; pixel++) {
      const value = mask[pixel] ? 255 : 0; const offset = pixel * 4;
      pixels.data[offset] = value; pixels.data[offset + 1] = value; pixels.data[offset + 2] = value; pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG를 만들지 못했습니다.")), "image/png"));
    const body = await uploadAsset(`/api/sessions/${inviteToken}`, "mask", blob);
    return body.asset.id;
  }
  async function savePersonal() {
    if (!editedId || !personal || saving || detecting) { if (!editedId) setMessage("먼저 보정본을 올려 주세요."); return; }
    setSaving(true); setMessage("이 보정본 영역을 저장하는 중입니다.");
    try {
      const maskAssetId = await uploadMask(personal);
      const response = await fetch(`/api/sessions/${inviteToken}/selection`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editedAssetId: editedId, maskAssetId, expectedVersion: data!.session.version }) });
      const body = await response.json();
      if (response.status === 409) { setMessage("다른 변경이 먼저 저장되었습니다. 새 내용을 불러와 확인해 주세요."); return; }
      if (!response.ok) throw new Error(body.error);
      setSavedSelections((current) => ({ ...current, [editedId]: personal }));
      setData((current) => current ? { ...current, session: { ...current.session, version: body.version } } : current);
      setDirtyEdits(current => ({ ...current, [editedId]: false }));
      setMessage("이 보정본 영역을 저장했습니다. 다른 보정본의 저장 영역도 유지됩니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "내 영역 저장에 실패했습니다."); }
    finally { setSaving(false); }
  }
  async function saveAssignments() {
    if (!data || !personal || saving) return;
    setSaving(true); setMessage("겹친 부분을 저장하는 중입니다.");
    try {
      const assignments = await Promise.all(Object.entries(assignmentMasks).filter(([, mask]) => mask.some(Boolean)).map(async ([editedAssetId, mask]) => ({ editedAssetId, maskAssetId: await uploadMask(mask) })));
      const response = await fetch(`/api/sessions/${inviteToken}/overlap-assignments`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignments, expectedVersion: data.session.version }) });
      const body = await response.json();
      if (response.status === 409) { setMessage("다른 변경이 먼저 저장되었습니다. 새 내용을 불러와 확인해 주세요."); return; }
      if (!response.ok) throw new Error(body.error);
      setData((current) => current ? { ...current, session: { ...current.session, version: body.version } } : current);
      setAssignmentsDirty(false);
      setMessage("겹친 부분을 저장했습니다.");
      onSaved?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "겹친 부분 저장에 실패했습니다."); }
    finally { setSaving(false); }
  }

  async function compose() {
    if (!data || saving || loading || detecting || personalDirty || assignmentsDirty) return;
    setSaving(true); setMessage("저장된 영역으로 사진을 합치는 중입니다.");
    try {
      const body = await composeRemote(`/api/sessions/${inviteToken}`, data.session.version, status => {
        setMessage(status === "queued" ? "사진 병합을 기다리고 있습니다. 처리 컴퓨터가 연결되면 순서대로 진행합니다." : "저장된 영역으로 사진을 합치는 중입니다.");
      }) as { result: CompositeResult };
      setData((current) => current ? { ...current, result: body.result } : current);
      setMessage("사진을 합쳤습니다. 결과를 확인하고 PNG를 내려받으세요.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "합성에 실패했습니다. 다시 시도해 주세요."); }
    finally { setSaving(false); }
  }

  async function findRegions() {
    if (!editedId || saving || loading || detecting) return;
    if (detections[editedId]) { setTool("region"); setMessage("이 보정본에서 찾은 영역을 선택해 주세요."); return; }
    setDetecting(true); setMessage("사람 영역을 찾는 중입니다. 처음 분석은 시간이 걸릴 수 있습니다.");
    try {
      const result = await detectRemote(`/api/sessions/${inviteToken}`, editedId, status => {
        setMessage(status === "queued" ? "사람 영역 분석을 기다리고 있습니다. 처리 컴퓨터가 연결되면 순서대로 진행합니다." : "사람 영역을 찾는 중입니다.");
      });
      if (result.width !== original!.width || result.height !== original!.height) throw new Error("검출 영역 크기가 사진과 다릅니다.");
      const regions = await Promise.all(result.regions.map(async region => ({ ...region, mask: await decodeMaskUrl(`data:image/png;base64,${region.maskPngBase64}`, result) })));
      setDetections(current => ({ ...current, [editedId]: regions }));
      setRegionPreviews(current => ({ ...current, [editedId]: `data:image/png;base64,${result.previewPngBase64}` }));
      if (regions.length) setTool("region");
      setMessage(regions.length ? `${regions.length}개 영역을 찾았습니다. 가져올 영역을 추가한 뒤 저장해 주세요.` : "사람을 찾지 못했습니다. ‘영역 직접 다듬기’로 선택해 주세요.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "사람 영역을 찾지 못했습니다. 기존 선택은 유지됩니다."); }
    finally { setDetecting(false); }
  }

  if (!data || !original) return <section><h2>영역 편집</h2><p role="status">{message}</p><button onClick={() => void load()} disabled={loading}>다시 불러오기</button></section>;
  const selectedPixels = personal?.some(Boolean) ?? false;
  const editingLocked = saving || loading || detecting || (mode === "personal" && showOriginal);
  return <section>
    <h2>{overlapOnly ? "겹친 부분 정하기" : "영역 편집"}</h2>{!overlapOnly && <p>보정본 선택 → 자동으로 찾은 사람 선택 → 이 보정본 영역 저장 → 사진 합치기</p>}<p>파란색은 지금 고른 영역이고, 분홍색은 저장된 개인 영역끼리 겹친 부분입니다.</p>
    <fieldset disabled={saving || loading || detecting}>{!overlapOnly && <p><button aria-pressed={mode === "personal"} type="button" onClick={() => { setMode("personal"); setShowOriginal(false); setTool("region"); setRefining(false); }}>내 영역</button><button aria-pressed={mode === "overlap"} type="button" onClick={() => { setMode("overlap"); setShowOriginal(false); if (tool === "region") setTool("brush"); }}>겹친 부분 정하기</button></p>}
    {mode === "personal" ? <>
      <p>보정본을 고르면 사람 영역을 자동으로 찾습니다. 윤곽선 안을 눌러 가져올 사람을 선택하고 각각 저장하세요.</p>
      {mine.length > 0 ? <div aria-label="내 보정본 고르기" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{mine.map(asset => <button aria-pressed={editedId === asset.id} type="button" key={asset.id} onClick={() => { setEditedId(asset.id); setShowOriginal(false); setTool("region"); setRefining(false); setMessage("사진에서 가져올 사람을 선택해 주세요. 저장된 영역은 유지됩니다."); }} style={{ border: editedId === asset.id ? "3px solid #1e90ff" : "1px solid #777", background: "white", padding: 4 }}><img src={`/api/sessions/${inviteToken}/assets/${asset.id}`} alt={photoDisplay.labels[asset.id]} width={120} height={80} style={{ display: "block", width: 120, height: 80, objectFit: "cover" }} /><span>{photoDisplay.labels[asset.id]}{editedId === asset.id ? " (선택됨)" : ""}</span><br /><small>{dirtyEdits[asset.id] ? "미저장 변경" : savedSelections[asset.id]?.some(Boolean) ? "영역 저장됨" : "저장된 영역 없음"}</small></button>)}</div> : <p>고를 수 있는 보정본이 없습니다.</p>}
      <p><button type="button" onClick={() => void findRegions()} disabled={editingLocked || !editedId}>{detecting ? "사람 영역 찾는 중…" : detections[editedId] ? "찾은 사람 영역 보기" : "사람 영역 다시 찾기"}</button> <button type="button" disabled={editingLocked || !editedId} onClick={() => mutate(mask => mask.fill(0))}>선택 전체 지우기</button></p>
      {!!detections[editedId]?.length && <div aria-label="검출 영역 선택">{detections[editedId].map((region) => <button key={region.id} type="button" disabled={editingLocked} onClick={() => mutate(mask => { for (let pixel = 0; pixel < mask.length; pixel++) mask[pixel] ||= region.mask[pixel]; })}>{region.id} 추가</button>)}<p>사진의 윤곽선 안을 누르거나 ID 버튼으로 사람 영역 전체를 추가하세요. 브러시·지우기로 더 다듬을 수 있습니다.</p></div>}
      <p><button type="button" onClick={() => setShowOriginal(current => !current)} disabled={!editedId}>{showOriginal ? "보정본으로 돌아가기" : "원본 보기"}</button>{showOriginal && " 원본 비교 중에는 그리기를 잠시 멈춥니다."}</p>
    </> : <label>이 부분에 사용할 사진 <select value={assignmentEditedId} onChange={(event) => chooseAssignmentPhoto(event.target.value)}>{edits.map(asset => <option value={asset.id} key={asset.id}>{photoDisplay.labels[asset.id]}</option>)}</select></label>}
    {mode === "overlap" && data.result && <p><label><input type="checkbox" checked={showComposite} onChange={event => setShowComposite(event.target.checked)} />합성 결과 위에서 겹침 보기·수정</label></p>}
    {mode === "personal" && <p>
      <button aria-pressed={tool === "region"} type="button" onClick={() => { setTool("region"); setRefining(false); }} disabled={editingLocked || !detections[editedId]?.length}>사람 영역 선택</button>
      <button aria-expanded={refining} type="button" onClick={() => { setRefining(!refining); setTool(refining ? "region" : "brush"); }} disabled={editingLocked || !editedId}>{refining ? "직접 다듬기 닫기" : "영역 직접 다듬기"}</button>
    </p>}
    {(mode === "overlap" || refining) && <p><button aria-pressed={tool === "ellipse"} type="button" onClick={() => setTool("ellipse")} disabled={editingLocked}>타원</button><button aria-pressed={tool === "brush"} type="button" onClick={() => setTool("brush")} disabled={editingLocked}>브러시</button><button aria-pressed={tool === "erase"} type="button" onClick={() => setTool("erase")} disabled={editingLocked}>지우기</button> <label>브러시 크기 <input type="range" min="5" max="180" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} disabled={editingLocked} /></label></p>}

    <canvas ref={canvasRef} aria-label={showOriginal ? "원본 사진 비교" : "사진 위 영역 편집"} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drawingRef.current = null; }} style={{ display: "block", width: "100%", maxWidth: 760, height: "auto", touchAction: "none", border: "1px solid #777", cursor: editingLocked ? "not-allowed" : "crosshair" }} />
    <p>{mode === "personal" ? <button type="button" onClick={() => void savePersonal()} disabled={!mine.length || saving}>이 보정본 영역 저장</button> : <button type="button" onClick={() => void saveAssignments()} disabled={!edits.length || !savedOverlap.some(Boolean) || saving}>겹친 부분 저장</button>} <button type="button" onClick={() => void load()} disabled={saving || detecting}>새 내용 불러오기</button></p>
    </fieldset>
    {mode === "personal" && !selectedPixels && <p>아직 선택한 영역이 없습니다. 자동으로 찾은 사람을 누르거나 ‘영역 직접 다듬기’를 사용하세요. 빈 영역으로 저장하면 이 보정본은 합성에 반영되지 않습니다.</p>}
    <p>새 내용을 불러오면 아직 저장하지 않은 수정은 사라집니다.</p><p role="status">{message}</p>
    {!overlapOnly && <section>
      <h2>합성 결과</h2>
      <p>합성에 사용할 보정본: {Object.values(savedSelections).filter(mask => mask.some(Boolean)).length}장</p>
      <p>영역을 저장한 뒤 합치세요. 다른 참여자의 변경은 ‘새 내용 불러오기’로 확인합니다.</p>
      <button type="button" onClick={() => void compose()} disabled={saving || loading || detecting || personalDirty || assignmentsDirty}>사진 합치기</button>
      {(personalDirty || assignmentsDirty) && <p>아직 저장하지 않은 영역이 있습니다. 먼저 해당 영역을 저장해 주세요.</p>}
      {data.result && <>
        <p>{data.result.width} × {data.result.height} · 작업 버전 {data.result.version}</p>
        {(data.result.version !== data.session.version || personalDirty || assignmentsDirty) && <p>이 결과에는 이후 수정이 반영되지 않았습니다. 저장한 뒤 다시 합쳐 주세요.</p>}
        {data.result.unassignedOverlapPixels > 0 && <p>아직 사용할 사진을 정하지 않은 겹침이 있습니다. 임시 사진을 적용했으니 ‘겹친 부분 정하기’에서 확인해 주세요.</p>}
        <img src={`/api/sessions/${inviteToken}/assets/${data.result.previewAssetId}`} alt="사진 합성 미리보기" style={{ display: "block", maxWidth: "100%", maxHeight: 700 }} />
        <p><a href={`/api/sessions/${inviteToken}/assets/${data.result.resultAssetId}`} download>원본 크기 PNG 다운로드</a></p>
      </>}
    </section>}
  </section>;
}
