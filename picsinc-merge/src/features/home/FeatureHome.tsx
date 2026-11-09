"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import SplashScreen from "@/components/splash-screen";
import theme from "./theme.module.css";
import styles from "./home.module.css";

// Remember within this tab's JS lifetime so returning from a feature skips the intro.
let splashCompleted = false;
const photo = "/images/figma-current/character-photo.png";
const homeAsset = "/images/figma-current/home/";

function WindowBar({ title, mint = false }: { title: string; mint?: boolean }) {
  return <div className={`${styles.windowBar} ${mint ? styles.mint : ""}`}><span>{title}</span><img src={`${homeAsset}window-controls.svg`} alt="" width="53" height="16" /></div>;
}
function Arrow() { return <img src={`${homeAsset}arrow.svg`} alt="" width="22" height="22" />; }

export default function FeatureHome() {
  const [showSplash, setShowSplash] = useState(() => !splashCompleted);
  const completeSplash = useCallback(() => { splashCompleted = true; setShowSplash(false); }, []);
  if (showSplash) return <SplashScreen onComplete={completeSplash} />;

  return <main className={`${theme.theme} ${styles.page}`}>
    <header className={styles.header}>
      <img className={styles.logo} src="/images/figma-current/moira-logo.svg" alt="MOIRA" width="95" height="23" />
      <span>각자의 보정을 한 장으로</span>
    </header>
    <div className={styles.content}>
      <div className={styles.heading}><span className={styles.badge}>모두가 만족하는 한 장</span><h1>다같이 모여라, MOIRA!</h1></div>
      <nav className={styles.cards} aria-label="사진 기능 선택">
        <Link href="/retouch/rooms/new" className={styles.card} aria-labelledby="retouch-title" aria-describedby="retouch-description">
          <div className={styles.friends} aria-hidden="true">
            <WindowBar title="our_photo.png" />
            <div className={styles.friendsArt}>
              <div className={styles.floatingPhoto}><img src={photo} alt="" width="104" height="155" /></div>
              <img className={styles.lilac} src="/images/figma-current/home/lilac.png" alt="" width="72" height="72" />
              <img className={styles.pink} src="/images/figma-current/home/pink.png" alt="" width="70" height="70" />
              <img className={styles.sparkleLeft} src={`${homeAsset}sparkle-left.svg`} alt="" width="14" height="14" />
              <img className={styles.sparkleRight} src={`${homeAsset}sparkle-right.svg`} alt="" width="10" height="10" />
            </div>
          </div>
          <div className={styles.cardCopy}>
            <div><h2 id="retouch-title">함께 보정</h2><p id="retouch-description">실시간으로 모여서<br />같이 찍은 사진을 보정해요.</p></div>
            <span className={styles.arrow} aria-hidden="true"><Arrow /></span>
          </div>
        </Link>
        <Link href="/sessions/new" className={styles.card} aria-labelledby="merge-title" aria-describedby="merge-description">
          <div className={styles.result} aria-hidden="true">
            <WindowBar title="our_result.png" mint />
            <div className={styles.resultArt}>
              <div className={`${styles.sourcePhoto} ${styles.sourcePink}`}><img src={photo} alt="" width="104" height="155" /></div>
              <div className={`${styles.sourcePhoto} ${styles.sourceBlue}`}><img src={photo} alt="" width="104" height="155" /></div>
              <span className={styles.mergeArrow}><Arrow /></span>
              <div className={styles.finishedPhoto}><img src={photo} alt="" width="104" height="155" /></div>
              <span className={styles.sourceLabel}>각자 보정한 사진</span><span className={styles.resultLabel}>하나로 합친 사진</span>
            </div>
          </div>
          <div className={styles.cardCopy}>
            <div><h2 id="merge-title">사진 합치기</h2><p id="merge-description">평소 사용하던 앱으로 보정해서<br />하나로 합쳐요.</p></div>
            <span className={`${styles.arrow} ${styles.mint}`} aria-hidden="true"><Arrow /></span>
          </div>
        </Link>
      </nav>
    </div>
  </main>;
}
