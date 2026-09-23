"use client";

import { useState, type ReactNode } from "react";

export default function MobileShell({ title, progress = 0, onBack, children, footer }: {
  title: string; progress?: number; onBack?: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const [help, setHelp] = useState(false);
  return <main className="phone-shell">
    <header className="top-bar">
      {onBack ? <button className="icon-button back" aria-label="이전 화면" onClick={onBack}>‹</button> : <span className="top-spacer" />}
      <span>{title}</span>
      <button className="icon-button" aria-label="도움말" aria-expanded={help} onClick={() => setHelp(!help)}>?</button>
    </header>
    <div className="progress-track" role="progressbar" aria-label="진행 단계" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div style={{ width: `${progress}%` }} /></div>
    {help && <aside className="help-panel"><strong>함께 만드는 한 장의 사진</strong><p>원본을 평소 쓰는 앱에서 보정한 뒤 전체 사진과 내 얼굴 영역을 제출해 주세요. 한 명 이상 제출하면 대표자가 현재 결과를 합칠 수 있어요.</p><p>사진은 방을 만든 뒤 24시간 동안 보관됩니다. 개인 복구 링크는 본인만 보관해 주세요.</p><button className="text-button" onClick={() => setHelp(false)}>닫기</button></aside>}
    <div className="screen-content">{children}</div>
    {footer && <footer className="screen-footer">{footer}</footer>}
  </main>;
}

export function Notice({ children }: { children: ReactNode }) { return <p className="notice">{children}</p>; }
export function StatusMessage({ message }: { message: string }) { return message ? <p className="status-message" role="status" aria-live="polite">{message}</p> : null; }

export function PhotoPicker({ file, preview, label, onChange, busy = false }: { file: File | null; preview: string; label: string; onChange: (file: File | null) => void; busy?: boolean }) {
  return <label className={`photo-picker ${preview ? "has-preview" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) onChange(event.dataTransfer.files[0] ?? null); }}>
    {preview ? <img src={preview} alt="업로드할 사진 미리보기" /> : <span className="upload-plus" aria-hidden="true">+</span>}
    <strong>{file?.name ?? label}</strong><span>사진을 누르거나 파일을 끌어다 놓으세요<br />JPG, PNG · 최대 20MB</span>
    <input type="file" accept="image/jpeg,image/png" aria-label={label} disabled={busy} onChange={event => { onChange(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = ""; }} />
  </label>;
}
