"use client";

import { useState } from "react";
import styles from "./merge.module.css";

export default function MergeResultPreview({ src, onError }: { src: string; onError: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (failed) return <div className={styles.errorCard} role="alert">
    <strong>완성된 사진을 불러오지 못했어요</strong>
    <p>연결을 확인한 뒤 다시 불러와 주세요.</p>
    <button className="secondary-button" onClick={() => { setAttempt(value => value + 1); setFailed(false); }}>사진 다시 불러오기</button>
  </div>;

  return <img className="photo-preview" src={attempt ? `${src}?retry=${attempt}` : src} alt="함께 보정한 최종 사진" onError={() => { setFailed(true); onError(); }} />;
}
