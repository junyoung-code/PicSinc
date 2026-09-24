"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { helpContent, type HelpTopic } from "@/features/mobile-flow/help-content";

export default function MobileShell({ title, progress = 0, onBack, children, footer, helpTopic }: {
  title: string; progress?: number; onBack?: () => void; children: ReactNode; footer?: ReactNode; helpTopic?: HelpTopic;
}) {
  const [help, setHelp] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setHelp(false); }, [helpTopic]);
  useEffect(() => {
    if (!help || !helpTopic) { dialog.current?.close(); setClosing(false); setDragY(0); setDragging(false); dragStart.current = null; return; }
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; dialog.current?.close(); helpButton.current?.focus(); };
  }, [help, helpTopic]);
  const content = helpTopic ? helpContent[helpTopic] : null;
  return <main className="phone-shell">
    <header className="top-bar">
      {onBack ? <button className="icon-button back" aria-label="이전 화면" onClick={onBack}>‹</button> : <span className="top-spacer" />}
      <span>{title}</span>
      {content ? <button ref={helpButton} className="icon-button" aria-label="도움말" aria-haspopup="dialog" aria-expanded={help} onClick={() => setHelp(true)}>?</button> : <span className="top-spacer" />}
    </header>
    <div className="progress-track" role="progressbar" aria-label="진행 단계" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div style={{ width: `${progress}%` }} /></div>
    {content && <dialog ref={dialog} className={`help-sheet${closing ? " is-closing" : ""}${dragging ? " is-dragging" : ""}`} style={{ "--sheet-y": `${dragY}px`, transform: `translateY(${dragY}px)` } as CSSProperties} aria-labelledby="help-title" onCancel={event => { event.preventDefault(); setClosing(true); }} onClose={() => setHelp(false)} onAnimationEnd={event => { if (event.animationName === "help-sheet-out") setHelp(false); }}>
      <button type="button" className="sheet-handle" aria-label="도움말 닫기" onClick={() => { if (!dragged.current) setClosing(true); }} onKeyDown={() => { dragged.current = false; }}
        onPointerDown={event => { if (closing) return; dragStart.current = event.clientY; dragged.current = false; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (dragStart.current === null) return; const distance = Math.max(0, event.clientY - dragStart.current); if (distance > 4) dragged.current = true; setDragY(distance); }}
        onPointerUp={event => { if (dragStart.current === null) return; const distance = Math.max(0, event.clientY - dragStart.current); dragStart.current = null; setDragging(false); if (distance >= 70) setClosing(true); else setDragY(0); event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { dragStart.current = null; setDragging(false); setDragY(0); }}><span aria-hidden="true" /></button>
      <h2 id="help-title">{content.title}</h2>
      <div className="help-copy">{content.lines.map(line => <p key={line}>{line}</p>)}</div>
      <button className="primary-button" onClick={() => setClosing(true)}>확인</button>
    </dialog>}
    <div className="screen-content">{children}</div>
    {footer && <footer className="screen-footer">{footer}</footer>}
  </main>;
}

export function Notice({ children }: { children: ReactNode }) { return <p className="notice">{children}</p>; }
export function StatusMessage({ message }: { message: string }) { return message ? <p className="status-message" role="status" aria-live="polite">{message}</p> : null; }

export function PhotoPicker({ file, preview, label, onChange, busy = false }: { file: File | null; preview: string; label: string; onChange: (file: File | null) => void; busy?: boolean }) {
  return <div className="photo-picker-wrap"><label className={`photo-picker ${preview ? "has-preview" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) onChange(event.dataTransfer.files[0] ?? null); }}>
    {preview ? <img src={preview} alt="업로드할 사진 미리보기" /> : <span className="upload-plus" aria-hidden="true">+</span>}
    <strong>{file?.name ?? label}</strong><span>사진을 누르거나 파일을 끌어다 놓으세요<br />JPG, PNG · 최대 20MB</span>
    <input type="file" accept="image/jpeg,image/png" aria-label={label} disabled={busy} onChange={event => { onChange(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = ""; }} />
  </label>{file && <button type="button" className="cancel-photo" aria-label="사진 선택 취소" disabled={busy} onClick={() => onChange(null)}><svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="white" stroke="currentColor" strokeWidth="1.5" /><path d="m12 12 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>}</div>;
}
