'use client';
import { useEffect, useRef } from 'react';
import styles from './room.module.css';
export default function ResultLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className={styles.lightbox} aria-label="완성 사진 크게 보기" onCancel={event => { event.preventDefault(); onClose(); }}><button onClick={onClose}>닫기</button><img src={src} alt="완성 사진 크게 보기"/></dialog>;
}
