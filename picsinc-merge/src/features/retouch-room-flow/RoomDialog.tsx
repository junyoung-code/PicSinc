'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './room.module.css';

export default function RoomDialog({ title, children, confirmLabel = '확인', cancelLabel = '취소', onConfirm, onCancel, busy = false }: { title: string; children: ReactNode; confirmLabel?: string; cancelLabel?: string | null; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const focus = document.activeElement as HTMLElement | null; ref.current?.showModal(); const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = overflow; ref.current?.close(); focus?.focus(); }; }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="room-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}><h2 id="room-dialog-title">{title}</h2><div className={styles.dialogCopy}>{children}</div><div className={styles.actions}><button className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? '처리 중…' : confirmLabel}</button>{cancelLabel !== null && <button className="secondary-button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>}</div></dialog>;
}
