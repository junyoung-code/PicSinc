"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import SplashScreen from "@/components/splash-screen";
import theme from "./theme.module.css";
import styles from "./home.module.css";

// The intro plays every time home opens, including returning from a feature.
// (Remembering it per tab made it skip after 함께 보정 but play after 사진 합치기,
// because one returns with a client-side Link and the other with a full page load.)
const photo = "/images/figma-current/character-photo.png";
const homeAsset = "/images/figma-current/home/";

function Arrow() { return <img src={`${homeAsset}arrow.svg`} alt="" width="22" height="22" />; }

export default function FeatureHome() {
  const [showSplash, setShowSplash] = useState(true);
  const completeSplash = useCallback(() => setShowSplash(false), []);
  if (showSplash) return <SplashScreen onComplete={completeSplash} />;

  // Figma 656:16586 (00-01 · MOIRA / 기능 선택, 11/11 update).
  // The my-page icon on the right waits for login (separate branch).
  return <main className={`${theme.theme} ${styles.page}`}>
    <header className={styles.header}>
      <img className={styles.logo} src="/images/figma-current/moira-logo.svg" alt="MOIRA" width="95" height="23" />
    </header>
    <div className={styles.content}>
      <h1 className={styles.title}>다같이 모여라, MOIRA!</h1>
      <nav className={styles.cards} aria-label="사진 기능 선택">
        <Link href="/retouch/rooms/new" className={styles.card} aria-labelledby="retouch-title" aria-describedby="retouch-description">
          <div className={styles.preview} aria-hidden="true">
            <div className={styles.floatingPhoto}><img src={photo} alt="" width="104" height="155" /></div>
            <img className={styles.lilac} src="/images/figma-current/home/lilac.png" alt="" width="72" height="72" />
            <img className={styles.pink} src="/images/figma-current/home/pink.png" alt="" width="70" height="70" />
          </div>
          <div className={styles.cardCopy}>
            <div><h2 id="retouch-title">함께 보정</h2><p id="retouch-description">실시간으로 모여서<br />같이 찍은 사진을 보정해요.</p></div>
            <span className={styles.arrow} aria-hidden="true"><Arrow /></span>
          </div>
        </Link>
        <Link href="/sessions/new" className={styles.card} aria-labelledby="merge-title" aria-describedby="merge-description">
          <div className={styles.preview} aria-hidden="true">
            <div className={`${styles.sourcePhoto} ${styles.sourcePink}`}><img src={photo} alt="" width="104" height="155" /></div>
            <div className={`${styles.sourcePhoto} ${styles.sourceBlue}`}><img src={photo} alt="" width="104" height="155" /></div>
            <span className={styles.mergeArrow}><Arrow /></span>
            <div className={styles.finishedPhoto}><img src={photo} alt="" width="104" height="155" /></div>
            <span className={styles.sourceLabel}>각자 보정한 사진</span><span className={styles.resultLabel}>하나로 합친 사진</span>
          </div>
          <div className={styles.cardCopy}>
            <div><h2 id="merge-title">사진 합치기</h2><p id="merge-description">평소 사용하던 앱으로 보정해서<br />하나로 합쳐요.</p></div>
            <span className={styles.arrow} aria-hidden="true"><Arrow /></span>
          </div>
        </Link>
      </nav>
    </div>
  </main>;
}
