"use client";
import type { ComponentProps } from "react";
import MobileShell from "@/components/mobile-shell";
import styles from "./merge.module.css";

export default function MergeShell(props: ComponentProps<typeof MobileShell>) {
  return <div className={`${styles.merge} ${props.progress === 100 ? styles.resultScreen : ""}`}><MobileShell {...props} /></div>;
}

export function MergeWelcome({ inviter }: { inviter?: string }) {
  return <div className={styles.welcome}>
    <p className={styles.tag}>{inviter ? `${inviter} 님의 초대` : "보정방 생성하기"}</p>
    <h1>{inviter ? <>{inviter}님의 보정방으로<br />입장하기</> : <>각자 마음에 들게,<br />한 장에 모이게.</>}</h1>
    <p>평소 쓰는 앱에서 보정하고,<br />MOIRA에서 한 장으로 합쳐요.</p>
    <div className={styles.collage} aria-hidden="true"><img src={inviter ? "/images/home/four-cut.png" : "/images/figma-current/character-photo.png"} alt="" /><strong>각자 보정<br />같이 완성!</strong></div>
  </div>;
}

export function MergeSteps() {
  return <ol className={styles.steps}><li>01 방 준비</li><li>02 얼굴 선택</li><li>03 보정본 제출</li><li>04 사진 완성</li></ol>;
}

export function MergeIntro({ onStart }: { onStart: () => void }) {
  return <div className={styles.merge}><main className={styles.introPage}>
    <div className={styles.introContent}>
      <a href="/" className={styles.introBack} aria-label="홈으로"><img src="/images/merge-ui/back.svg" alt="" width="20" height="20" /></a>
      <a href="/" className={styles.introLogo} aria-label="MOIRA 홈"><img src="/images/figma-current/moira-logo.svg" alt="MOIRA" width="95" height="23" /></a>
      <h1>친구들과 각자 보정하고<br />한 장으로 합쳐보세요</h1>
      <p className={styles.introDescription}>평소 쓰던 보정 앱은 그대로 사용하세요.<br />MOIRA가 각자의 보정 결과만 모아드려요.</p>
      <ol className={styles.introSteps}>
        <li><span>1</span><div><strong>원본 사진을 올리고 보정방 생성</strong><p>대표자 한 명이 보정방을 만들고 친구를 초대해요.</p></div></li>
        <li><span>2</span><div><strong>각자 내 얼굴 보정</strong><p>평소 쓰던 앱에서 원하는 만큼 보정해요.</p></div></li>
        <li><span>3</span><div><strong>한 장으로 자동 합치기</strong><p>선택한 얼굴 영역만 원본 위에 합쳐요.</p></div></li>
      </ol>
    </div>
    <footer className={styles.introFooter}><p>대표자 한 명만 시작하면 돼요</p><button className="primary-button" onClick={onStart}>시작하기</button></footer>
  </main></div>;
}
