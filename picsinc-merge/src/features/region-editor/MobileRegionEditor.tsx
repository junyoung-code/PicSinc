"use client";

import { useEffect, useRef, useState } from "react";
import type { DetectedRegions } from "./detected-regions";
import { paintBrush, type Point } from "./mask-geometry";
import { editableContours, finishContourGesture, spacedHandleIndices, viewportToImage, zoomAround, type PendingContour, type ViewTransform } from "./contour-geometry";
import styles from "./mobile-editor.module.css";

export interface MobileRegionEditorProps {
  imageUrl: string;
  width: number;
  height: number;
  detection: DetectedRegions | null;
  initialMaskUrl?: string;
  initialSelectedIds?: string[];
  busy?: boolean;
  detecting?: boolean;
  onSave: (mask: Blob, selectedRegionIds: string[]) => Promise<void>;
  saveLabel: string;
  participantNickname?: string;
  saveActionLabel?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onRetryDetection?: () => void;
  detectionError?: string;
  onDetailOpen: (onBrowserBack: () => boolean) => void;
  regionClaims?: { regionId: string; participantId: string; nickname: string }[];
  currentParticipantId?: string;
  onRegionToggle?: (regionId: string, selected: boolean) => Promise<{ ok: true } | { ok: false; nickname: string }>;
}
type Region = { id: string; mask: Uint8Array; contours: Point[][]; box: DetectedRegions["regions"][number]["box"] };
type Tool = "select" | "points" | "brush" | "erase" | "pan";
const colors = ["#6558e8", "#e04e7c", "#008f89", "#dd7600", "#296bdb", "#a545c2"];

async function decodeMask(url: string, width: number, height: number) {
  const image = new Image(); image.crossOrigin = "anonymous"; image.src = url; await image.decode();
  if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error("선택 영역 크기가 원본과 다릅니다.");
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = Number(pixels[i * 4] > 127 && pixels[i * 4 + 3] > 0);
  // Drop the decoded RGBA canvas before the next full-resolution mask is loaded.
  canvas.width = 0; canvas.height = 0; image.src = "";
  return mask;
}
async function encodeMask(mask: Uint8Array, width: number, height: number) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d")!, pixels = context.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) { const offset = i * 4; pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = mask[i] ? 255 : 0; pixels.data[offset + 3] = 255; }
  context.putImageData(pixels, 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("영역 PNG를 만들지 못했습니다.")), "image/png"));
}

export default function MobileRegionEditor({ imageUrl, width, height, detection, initialMaskUrl, initialSelectedIds = [], busy = false, detecting = false, onSave, saveLabel, participantNickname, onDirtyChange, onRetryDetection, detectionError, onDetailOpen, regionClaims = [], currentParticipantId, onRegionToggle }: MobileRegionEditorProps) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const maskRef = useRef<Uint8Array>(new Uint8Array(width * height));
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const regionRef = useRef<Region[]>([]);
  const contoursRef = useRef<Point[][]>([]);
  const viewRef = useRef<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; last: Point; before: Uint8Array; pending: PendingContour | null; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; midpoint: Point; view: ViewTransform } | null>(null);
  const redraw = useRef(() => {});
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange;
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [regions, setRegions] = useState<Region[]>([]);
  const [imageLoading, setImageLoading] = useState(true);
  const [maskLoading, setMaskLoading] = useState(true);
  const loading = imageLoading || maskLoading;
  const dirtyRef = useRef(false);
  const expandedRef = useRef(false);
  const detailSnapshot = useRef<{ mask: Uint8Array; ids: string[]; dirty: boolean } | null>(null);
  const detailDirty = useRef(false);
  const detailComplete = useRef(false);
  const exitPending = useRef(false);
  const discardConfirmed = useRef(false);
  const [exitDialog, setExitDialog] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const [claimConflict, setClaimConflict] = useState<{ regionId: string; nickname: string } | null>(null);
  const claimPendingRef = useRef(false);
  const [claimPending, setClaimPending] = useState(false);
  const undoMasks = useRef<Uint8Array[]>([]);
  const redoMasks = useRef<Uint8Array[]>([]);
  const savingRef = useRef(false);
  const [incomingMask, setIncomingMask] = useState(false);
  const [maskReload, setMaskReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [brushSize, setBrushSize] = useState(18);
  const [revision, setRevision] = useState(0);

  const initialIds = useRef(initialSelectedIds); initialIds.current = initialSelectedIds;
  const locked = busy || loading || saving || claimPending || exitDialog;

  function changed() {
    let nextDirty = true;
    if (expandedRef.current && detailSnapshot.current) {
      detailDirty.current = maskRef.current.some((value, index) => value !== detailSnapshot.current!.mask[index]);
      nextDirty = detailSnapshot.current.dirty || detailDirty.current;
    }
    dirtyRef.current = nextDirty; setDirty(nextDirty); dirtyCallback.current?.(nextDirty);
  }
  function refreshMask(retrace = true) {
    if (retrace) contoursRef.current = editableContours(maskRef.current, width, height);
    // Keep interactive drawing bounded; the saved binary mask always remains full resolution.
    const ratio = Math.min(1, 1000 / Math.max(width, height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext("2d")!, pixels = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (!maskRef.current[Math.min(height - 1, Math.floor(y * height / canvas.height)) * width + Math.min(width - 1, Math.floor(x * width / canvas.width))]) continue;
      const offset = (y * canvas.width + x) * 4; pixels.data[offset] = 101; pixels.data[offset + 1] = 88; pixels.data[offset + 2] = 232; pixels.data[offset + 3] = 64;
    }
    context.putImageData(pixels, 0, 0); overlayRef.current = canvas;
    setRevision(value => value + 1);
  }
  useEffect(() => {
    let cancelled = false; setImageLoading(true); setError(""); imageRef.current = null;
    const image = new Image(); image.crossOrigin = "anonymous"; image.src = imageUrl;
    void image.decode().then(() => {
      if (cancelled) return;
      imageRef.current = image; setImageLoading(false); fit();
    }).catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "사진을 불러오지 못했습니다."); setImageLoading(false); } });
    return () => { cancelled = true; };
  }, [imageUrl, width, height]);
  useEffect(() => {
    // A refreshed snapshot after HTTP 409 must never replace an unsaved local draft.
    if (dirtyRef.current || savingRef.current) { setIncomingMask(true); return; }
    let cancelled = false; setMaskLoading(true);
    void (async () => {
      const mask = initialMaskUrl ? await decodeMask(initialMaskUrl, width, height) : new Uint8Array(width * height);
      if (cancelled) return;
      if (dirtyRef.current || savingRef.current) { setIncomingMask(true); setMaskLoading(false); return; }
      maskRef.current = mask; setSelectedIds(initialIds.current); setDirty(false); dirtyCallback.current?.(false); setIncomingMask(false); refreshMask(); setMaskLoading(false);
    })().catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "영역을 불러오지 못했습니다."); setMaskLoading(false); } });
    return () => { cancelled = true; };
  }, [initialMaskUrl, width, height, maskReload]);
  useEffect(() => {
    let cancelled = false; regionRef.current = []; setRegions([]);
    if (!detection) return;
    if (detection.width !== width || detection.height !== height) { setError("검출 영역 크기가 원본과 다릅니다."); return; }
    void (async () => {
      const decoded: Region[] = [];
      // Decode sequentially so large images do not allocate every RGBA bitmap at once.
      for (const region of detection.regions) {
        if (cancelled) return;
        const mask = await decodeMask(`data:image/png;base64,${region.maskPngBase64}`, width, height);
        if (cancelled) return;
        decoded.push({ id: region.id, box: region.box, mask, contours: editableContours(mask, width, height) });
      }
      if (!cancelled) { regionRef.current = decoded; setRegions(decoded); setRevision(v => v + 1); }
    })().catch(() => { if (!cancelled) setError("검출 영역을 표시하지 못했습니다. 다시 찾거나 직접 선택해 주세요."); });
    return () => { cancelled = true; };
  }, [detection, width, height]);
  useEffect(() => {
    if (!loading && regions.length && !initialMaskUrl && !dirtyRef.current && initialIds.current.length) {
      for (const region of regions) if (initialIds.current.includes(region.id)) {
        for (let i = 0; i < maskRef.current.length; i++) if (region.mask[i]) maskRef.current[i] = 1;
      }
      refreshMask();
    }
  }, [regions, loading, initialMaskUrl]);
  useEffect(() => {
    if (!claimConflict) return;
    const timeout = window.setTimeout(() => setClaimConflict(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [claimConflict]);
  useEffect(() => {
    if (!exitDialog) return;
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLButtonElement>("[data-continue]")?.focus();
    return () => previous?.focus();
  }, [exitDialog]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (modalRef.current) setExitDialog(false); else requestDetailExit(); return; }
      if (event.key !== "Tab") return;
      const controls = [...((modalRef.current ?? rootRef.current)?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']") ?? [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown); previouslyFocused?.focus(); };
  }, [expanded]);
  function openEditor() {
    if (locked || expandedRef.current) return;
    setClaimConflict(null);
    detailSnapshot.current = { mask: maskRef.current.slice(), ids: [...selectedIds], dirty: dirtyRef.current };
    detailDirty.current = false; detailComplete.current = false; exitPending.current = false; discardConfirmed.current = false;
    undoMasks.current = []; redoMasks.current = [];
    expandedRef.current = true; setExpanded(true);
    setTool(maskRef.current.some(Boolean) ? "points" : "brush");
    onDetailOpen(leaveEditorFromHistory);
  }
  function requestDetailExit(complete = false) {
    if (exitPending.current || savingRef.current || claimPendingRef.current) return;
    detailComplete.current = complete; exitPending.current = true;
    history.back();
  }
  function leaveEditorFromHistory() {
    const snapshot = detailSnapshot.current;
    if (!snapshot) return true;
    if (!detailComplete.current && detailDirty.current && !discardConfirmed.current) {
      setExitDialog(true);
      exitPending.current = false;
      return false;
    }
    setExitDialog(false); discardConfirmed.current = false;
    closeEditor();
    if (!detailComplete.current) {
      maskRef.current = snapshot.mask;
      setSelectedIds(snapshot.ids);
      dirtyRef.current = snapshot.dirty; setDirty(snapshot.dirty); dirtyCallback.current?.(snapshot.dirty);
      refreshMask();
    }
    detailSnapshot.current = null; detailDirty.current = false; detailComplete.current = false; exitPending.current = false;
    return true;
  }
  function closeEditor() {
    // Detail changes stay in the page draft; only the normal submit button writes to the server.
    const current = gesture.current;
    if (current) { maskRef.current = current.before; refreshMask(false); }
    pointers.current.clear(); gesture.current = null; pinch.current = null;
    expandedRef.current = false; setExpanded(false); setTool("select");
  }
  function discardLocalDraft() {
    dirtyRef.current = false; setDirty(false); dirtyCallback.current?.(false);
    setError(""); setMaskReload(value => value + 1);
  }
  function fit() {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(rect.width / width, rect.height / height);
    viewRef.current = { scale, x: (rect.width - width * scale) / 2, y: (rect.height - height * scale) / 2 };
    redraw.current();
  }
  function draw() {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
    const context = canvas.getContext("2d")!; context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, rect.width, rect.height);
    const view = viewRef.current; context.translate(view.x, view.y); context.scale(view.scale, view.scale);
    if (imageRef.current) context.drawImage(imageRef.current, 0, 0, width, height);
    if (overlayRef.current) context.drawImage(overlayRef.current, 0, 0, width, height);
    const path = (ring: Point[]) => { context.beginPath(); ring.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath(); };
    if (tool === "select") for (const [i, region] of regionRef.current.entries()) {
      const conflict = claimConflict?.regionId === region.id;
      context.strokeStyle = conflict ? "#df2638" : colors[i % colors.length]; context.lineWidth = (conflict || selectedIds.includes(region.id) ? 2.5 : 1.5) / view.scale;
      if (conflict) {
        context.beginPath();
        for (const ring of region.contours) { ring.forEach((p, index) => index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath(); }
        context.fillStyle = "#df263866"; context.fill("evenodd"); context.stroke();
      } else for (const ring of region.contours) { path(ring); context.stroke(); }
    }
    if (tool === "points") for (const ring of contoursRef.current) {
      const pending = gesture.current?.pending; const display = pending?.ring === ring ? ring.map((p, i) => i === pending.index ? pending.target : p) : ring;
      context.save(); context.strokeStyle = "#6558e8"; context.lineWidth = 1 / view.scale;
      context.setLineDash([3 / view.scale, 3 / view.scale]); path(display); context.stroke(); context.restore();
      const visible = spacedHandleIndices(ring, view.scale, 8);
      if (pending?.ring === ring && !visible.includes(pending.index)) visible.push(pending.index);
      for (const index of visible) {
        const p = display[index]; context.beginPath(); context.arc(p.x, p.y, 1.5 / view.scale, 0, Math.PI * 2);
        context.fillStyle = "white"; context.fill(); context.strokeStyle = "#6558e8"; context.lineWidth = .75 / view.scale; context.stroke();
      }
    }
  }
  redraw.current = draw;
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const observer = new ResizeObserver(fit); observer.observe(canvas); fit(); return () => observer.disconnect(); }, [expanded, width, height]);
  useEffect(() => { draw(); }, [revision, tool, selectedIds, expanded, loading, claimConflict]);
  function local(event: React.PointerEvent<HTMLCanvasElement>): Point { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  async function toggle(region: Region) {
    if (locked || claimPendingRef.current) return;
    const remove = selectedIds.includes(region.id);
    const owner = regionClaims.find(claim => claim.regionId === region.id && claim.participantId !== currentParticipantId);
    if (owner && !remove) { setClaimConflict({ regionId: region.id, nickname: owner.nickname }); return; }
    claimPendingRef.current = true; setClaimPending(true); setError("");
    try {
      const result = await onRegionToggle?.(region.id, !remove);
      if (result && !result.ok) { setClaimConflict({ regionId: region.id, nickname: result.nickname }); return; }
      const ids = remove ? selectedIds.filter(id => id !== region.id) : [...selectedIds, region.id];
      for (let i = 0; i < maskRef.current.length; i++) if (region.mask[i]) maskRef.current[i] = remove ? Number(regionRef.current.some(other => ids.includes(other.id) && !!other.mask[i])) : 1;
      setSelectedIds(ids); setClaimConflict(null); changed(); refreshMask();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "선택을 반영하지 못했어요. 다시 시도해주세요."); }
    finally { claimPendingRef.current = false; setClaimPending(false); }
  }
  function remember(mask: Uint8Array) {
    // At most 32 MB of undo masks, and no more than ten completed gestures.
    const limit = Math.max(1, Math.min(10, Math.floor(32_000_000 / (width * height))));
    undoMasks.current = [...undoMasks.current, mask].slice(-limit); redoMasks.current = [];
  }
  function restoreHistory(redo = false) {
    if (locked) return;
    const from = redo ? redoMasks : undoMasks, to = redo ? undoMasks : redoMasks;
    const mask = from.current.pop(); if (!mask) return;
    to.current.push(maskRef.current); maskRef.current = mask; changed(); refreshMask();
  }
  function resetDetail() {
    if (locked || !detailSnapshot.current) return;
    remember(maskRef.current); maskRef.current = detailSnapshot.current.mask.slice(); changed(); refreshMask();
  }
  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (locked || !imageRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId); const p = local(event); pointers.current.set(event.pointerId, p);
    if (!expanded && pointers.current.size > 1) { gesture.current = null; return; }
    if (pointers.current.size === 2) {
      if (gesture.current) { maskRef.current = gesture.current.before; refreshMask(false); } gesture.current = null;
      const [a, b] = [...pointers.current.values()]; pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...viewRef.current } }; return;
    }
    if (pointers.current.size !== 1) return;
    const hit = viewportToImage(p, viewRef.current);
    let pending: PendingContour | null = null;
    if (tool === "points") {
      let distance = 22 / viewRef.current.scale;
      for (const ring of contoursRef.current) for (const index of spacedHandleIndices(ring, viewRef.current.scale, 8)) {
        const point = ring[index], d = Math.hypot(point.x - hit.x, point.y - hit.y);
        if (d < distance) { distance = d; pending = { ring, index, target: point }; }
      }
    }
    gesture.current = { start: p, last: p, before: (tool === "brush" || tool === "erase") ? maskRef.current.slice() : maskRef.current, pending, moved: false };
    if (tool === "brush" || tool === "erase") { paintBrush(maskRef.current, width, height, hit, hit, brushSize / viewRef.current.scale, tool === "erase" ? 0 : 1); refreshMask(false); }
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const p = local(event); pointers.current.set(event.pointerId, p);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()], initial = pinch.current;
      const rect = event.currentTarget.getBoundingClientRect(), fitScale = Math.min(rect.width / width, rect.height / height);
      const scale = Math.max(fitScale, Math.min(fitScale * 8, initial.view.scale * Math.hypot(a.x - b.x, a.y - b.y) / initial.distance));
      const view = zoomAround(initial.view, initial.midpoint, scale);
      view.x += (a.x + b.x) / 2 - initial.midpoint.x; view.y += (a.y + b.y) / 2 - initial.midpoint.y;
      viewRef.current = view; draw(); return;
    }
    const current = gesture.current; if (!current) return;
    current.moved ||= Math.hypot(p.x - current.start.x, p.y - current.start.y) > 4;
    const hit = viewportToImage(p, viewRef.current);
    if (current.pending) { current.pending.target = { x: Math.max(0, Math.min(width, hit.x)), y: Math.max(0, Math.min(height, hit.y)) }; draw(); }
    else if (tool === "pan" || tool === "points") { viewRef.current.x += p.x - current.last.x; viewRef.current.y += p.y - current.last.y; draw(); }
    else if (tool === "brush" || tool === "erase") { paintBrush(maskRef.current, width, height, viewportToImage(current.last, viewRef.current), hit, brushSize / viewRef.current.scale, tool === "erase" ? 0 : 1); refreshMask(false); }
    current.last = p;
  }
  function end(event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const current = gesture.current; pointers.current.delete(event.pointerId);
    if (pinch.current) { if (!pointers.current.size) pinch.current = null; return; }
    if (!current) return;
    gesture.current = null;
    if (cancelled) { maskRef.current = current.before; refreshMask(false); return; }
    if (current.pending) { maskRef.current = finishContourGesture(current.before, width, height, current.pending, !current.moved); if (current.moved) { remember(current.before); changed(); } refreshMask(false); }
    else if (tool === "brush" || tool === "erase") { remember(current.before); changed(); refreshMask(); }
    else if (tool === "select" && !current.moved) {
      const hit = viewportToImage(local(event), viewRef.current);
      if (hit.x >= 0 && hit.y >= 0 && hit.x < width && hit.y < height) { const region = regionRef.current.find(region => region.mask[Math.floor(hit.y) * width + Math.floor(hit.x)]); if (region) void toggle(region); }
    }
  }
  async function save() {
    if (locked) return;
    if (!maskRef.current.some(Boolean)) { setError("사진에서 사람을 선택하거나 브러시로 영역을 표시해 주세요."); return; }
    savingRef.current = true; changed(); setSaving(true); setError("");
    try { await onSave(await encodeMask(maskRef.current, width, height), selectedIds); dirtyRef.current = false; setDirty(false); dirtyCallback.current?.(false); setIncomingMask(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했습니다. 선택 영역은 유지됩니다."); }
    finally { savingRef.current = false; setSaving(false); }
  }
  const controls = <div className={styles.tools} aria-label="영역 편집 도구">
    {([['points', '점 이동하기'], ['brush', '브러시'], ['erase', '지우기']] as [Tool, string][]).map(([value, label]) => <button key={value} type="button" aria-pressed={tool === value} disabled={locked} onClick={() => setTool(value)}>{label}</button>)}
  </div>;
  return <section ref={rootRef} className={`${styles.editor} ${expanded ? styles.expanded : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined} aria-label="내 영역 선택">
    {expanded && <div className={styles.dialogHeader}><button type="button" aria-label="영역 편집 닫기" onClick={() => requestDetailExit()}>‹</button><strong>내 영역 편집</strong><button type="button" onClick={() => requestDetailExit(true)}>완료</button></div>}
    {!expanded && participantNickname && <div className={styles.identity}><strong>{participantNickname}으로 참여 중</strong></div>}
    {expanded && <div className={styles.editHint}><strong>원하는 영역을 수동으로 편집해보세요.</strong><p>보정할 부분만 선택 영역으로 조정할 수 있어요.</p></div>}
    <div className={styles.canvasFrame}><canvas ref={canvasRef} className={styles.canvas} style={expanded ? undefined : { aspectRatio: `${width} / ${height}` }} aria-label="사진 속 사람 영역을 눌러 선택하거나 해제할 수 있습니다." onPointerDown={down} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => { if (pointers.current.has(event.pointerId)) end(event, true); }} />
      {claimConflict && <div className={styles.claimToast} role="status"><span className={styles.claimIcon} aria-hidden="true" /><span><strong>{claimConflict.nickname}님이 선택한 영역이에요</strong><small>다른 얼굴을 선택해주세요.</small></span></div>}
      {(loading || detecting) && <div className={styles.loadingOverlay} role="status"><span className={styles.spinner} aria-hidden="true" /><strong>{detecting ? "AI가 얼굴 영역을 탐지하고 있어요!" : "사진과 영역을 준비하고 있어요."}</strong></div>}
    </div>
    <div className={styles.scrollControls}>
      {expanded && <>{controls}<div className={styles.historyTools}><button type="button" disabled={locked} onClick={resetDetail}>↻ 초기화</button><button type="button" disabled={locked || !undoMasks.current.length} onClick={() => restoreHistory()}>↶ 실행 취소</button><button type="button" disabled={locked || !redoMasks.current.length} onClick={() => restoreHistory(true)}>↷ 다시 실행</button></div></>}
      {!expanded && <button type="button" className={styles.refine} disabled={locked || (!!regions.length && !maskRef.current.some(Boolean))} onClick={openEditor}>영역 편집하기</button>}
      {expanded && (tool === "brush" || tool === "erase") && <label className={styles.brush}>브러시 크기 <input aria-label="브러시 크기" type="range" min="3" max="45" value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} /></label>}
      {(detectionError || (!detection && !busy)) && <p className={styles.hint}>{detectionError || "영역을 직접 선택하거나 사람 영역을 다시 찾아보세요."} {onRetryDetection && <button type="button" disabled={locked} onClick={onRetryDetection}>다시 찾기</button>}</p>}
      {detection && !regions.length && !loading && <p className={styles.hint}>찾은 사람이 없습니다. 브러시로 직접 선택할 수 있어요.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {incomingMask && <p className={styles.hint}>다른 기기에서 저장한 영역이 바뀌었어요. 지금 수정한 영역은 유지됩니다. <button type="button" disabled={locked} onClick={discardLocalDraft}>내 수정 버리고 저장된 영역 불러오기</button></p>}
    </div>
    {!expanded && <button type="button" className={styles.save} disabled={locked || !imageRef.current || !maskRef.current.some(Boolean)} onClick={() => void save()}>{saving ? "저장 중…" : saveLabel}</button>}
    {exitDialog && <div className={styles.modalBackdrop}><div ref={modalRef} className={styles.exitModal} role="alertdialog" aria-modal="true" aria-labelledby="editor-exit-title" aria-describedby="editor-exit-description">
      <span className={styles.exitIcon} aria-hidden="true" />
      <h2 id="editor-exit-title">변경사항을 저장하지 않고 나갈까요?</h2>
      <p id="editor-exit-description">지금 나가면 편집한 영역이 저장되지 않아요.</p>
      <div className={styles.exitButtons}><button type="button" onClick={() => { discardConfirmed.current = true; setExitDialog(false); requestDetailExit(); }}>나가기</button><button type="button" data-continue onClick={() => setExitDialog(false)}>계속 편집</button></div>
    </div></div>}
  </section>;
}
