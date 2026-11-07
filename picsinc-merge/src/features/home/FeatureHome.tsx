"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import SplashScreen from "@/components/splash-screen";
import WindowBar from "./WindowBar";
import theme from "./theme.module.css";
import styles from "./home.module.css";

// Remember within this tab's JS lifetime so returning from a feature skips the intro.
let splashCompleted = false;

export default function FeatureHome() {
  const [showSplash, setShowSplash] = useState(() => !splashCompleted);

  const completeSplash = useCallback(() => {
    splashCompleted = true;
    setShowSplash(false);
  }, []);

  if (showSplash) return <SplashScreen onComplete={completeSplash} />;

  return <main className={`${theme.theme} ${styles.page}`}>
    <header className={styles.header}><strong>MOIRA</strong><span>각자의 보정을 한 장으로</span></header>
    <div className={styles.content}>
      <div className={styles.heading}>
        <span className={styles.badge}>친구들과, 한 장으로</span>
        <h1>우리 사진, 어떻게 만들까요?</h1>
      </div>
      <nav className={styles.cards} aria-label="사진 기능 선택">
        <Link href="/retouch" className={styles.card} aria-labelledby="retouch-title" aria-describedby="retouch-description">
          <div className={styles.friends} aria-hidden="true">
            <WindowBar title="our_photo.png" />
            <div className={styles.friendsArt}>
              <div className={styles.floatingPhoto}><img src="/images/home/four-cut.png" alt="" width="104" height="155" /></div>
              <img className={styles.lilac} src="/images/home/lilac.png" alt="" width="72" height="72" />
              <img className={styles.pink} src="/images/home/pink.png" alt="" width="70" height="70" />
              <span className={styles.photoBadge}>우리 얼굴은, 각자!</span>
            </div>
          </div>
          <div className={styles.cardCopy}>
            <div><h2 id="retouch-title">함께 보정</h2><p id="retouch-description">같은 사진에서 내 얼굴을 직접 보정해요.</p></div>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </div>
        </Link>
        <Link href="/sessions/new" className={styles.card} aria-labelledby="merge-title" aria-describedby="merge-description">
          <div className={styles.result} aria-hidden="true">
            <WindowBar title="our_result.png" tone="mint" />
            <div className={styles.resultArt}>
              <div className={styles.finishedPhoto}><img src="/images/home/four-cut.png" alt="" width="104" height="155" /></div>
              <span className={styles.resultBadge}>각자의 보정을<br />한 장으로</span>
            </div>
          </div>
          <div className={styles.cardCopy}>
            <div><h2 id="merge-title">사진 합치기</h2><p id="merge-description">각자 보정한 사진을 모아 한 장으로 합쳐요.</p></div>
            <span className={styles.arrow} aria-hidden="true">→</span>
          </div>
        </Link>
      </nav>
    </div>
  </main>;
}
