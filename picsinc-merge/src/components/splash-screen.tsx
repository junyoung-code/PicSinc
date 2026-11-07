"use client";

import { useEffect, useState } from "react";
import styles from "./splash-screen.module.css";

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [playVideo, setPlayVideo] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPlayVideo(!reducedMotion);
    // Never block entry when autoplay is denied or the video stalls.
    const timer = window.setTimeout(onComplete, reducedMotion ? 1500 : 5000);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return <main className={styles.screen} aria-label="MOIRA 시작 화면">
    <div className={styles.content}>
      <div className={styles.media}>
        <img className={styles.poster} src="/images/moira-splash-poster.webp" alt="MOIRA" width="960" height="540" />
        {playVideo && <video className={styles.video} src="/videos/moira-splash.mp4"
          poster="/images/moira-splash-poster.webp" autoPlay muted playsInline preload="auto"
          aria-hidden="true" onEnded={onComplete} onError={onComplete} />}
      </div>
      <p className={styles.tagline}>각자의 보정을 한 장으로</p>
    </div>
  </main>;
}
