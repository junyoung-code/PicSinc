"use client";
import type { ComponentProps } from "react";
import MobileShell from "@/components/mobile-shell";
import styles from "./merge.module.css";

export default function MergeShell(props: ComponentProps<typeof MobileShell>) {
  return <div className={styles.merge}><MobileShell {...props} /></div>;
}

export function MergeWelcome({ inviter }: { inviter?: string }) {
  return <div className={styles.welcome}>
    <p className={styles.tag}>{inviter ? `${inviter} 님의 초대` : "보정방 생성하기"}</p>
    <h1>{inviter ? <>{inviter}님의 보정방으로<br />입장하기</> : <>각자 마음에 들게,<br />한 장에 모이게.</>}</h1>
    <p>평소 쓰는 앱에서 보정하고,<br />MOIRA에서 한 장으로 합쳐요.</p>
    <div className={styles.collage} aria-hidden="true"><img src="/images/home/four-cut.png" alt="" /><strong>각자 보정<br />같이 완성!</strong></div>
  </div>;
}

export function MergeSteps() {
  return <ol className={styles.steps}><li>01 사진 업로드</li><li>02 각자 보정</li><li>03 한 장에 합치기</li></ol>;
}

export function MergeIntro({ onStart }: { onStart: () => void }) {
  return <MergeShell title="사진 합치기" helpTopic="start" onBack={() => location.assign("/")} footer={<button className="primary-button" onClick={onStart}>시작하기</button>}>
    <MergeWelcome /><MergeSteps /><p className="description">대표자 한 명이 원본을 올리고 친구를 초대해요.<br />친구들이 각자 보정한 사진을 제출할 수 있어요.</p>
  </MergeShell>;
}
