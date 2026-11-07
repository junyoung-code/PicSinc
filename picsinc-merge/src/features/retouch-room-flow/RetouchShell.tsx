'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { FlowProgress } from '@/components/FlowProgress';
import theme from '@/features/home/theme.module.css';
import RoomDialog from './RoomDialog';
import styles from './room.module.css';

export default function RetouchShell({ title, onBack, backDisabled = false, children, footer, action, progress = 0, showProgress = false, brand = false, hideBack = false, centered = false }: {
  title: string; onBack?: () => void; backDisabled?: boolean; children: ReactNode; footer?: ReactNode; action?: ReactNode; progress?: number; showProgress?: boolean; brand?: boolean; hideBack?: boolean; centered?: boolean;
}) {
  const [help, setHelp] = useState(false);
  return <main className={`${theme.theme} ${styles.shell}`}>
    <header className={`${styles.header} ${brand ? styles.brandHeader : ''}`}>
      {!hideBack && (onBack || backDisabled ? <button aria-label="이전 화면" disabled={backDisabled} onClick={onBack}><img src="/images/retouch-ui/back.svg" alt="" /></button> : <Link href="/" aria-label="홈으로"><img src="/images/retouch-ui/back.svg" alt="" /></Link>)}
      {brand ? <Link className={styles.wordmark} href="/" aria-label="MOIRA 홈"><img src="/images/figma-current/moira-logo.svg" alt="MOIRA" /></Link> : <strong>{title}</strong>}
      <div className={styles.headerAction}>{action || <button className={styles.help} aria-label="도움말" onClick={() => setHelp(true)}>?</button>}</div>
    </header>
    {showProgress ? <FlowProgress progress={progress}/> : <div className={styles.progressSpace}/>}
    <div className={`${styles.content} ${centered ? styles.centered : ''}`}>{children}</div>
    {footer && <footer className={styles.footer}>{footer}</footer>}
    {help && <RoomDialog title={title === 'MOIRA' ? '함께 보정하는 방법' : title} onCancel={() => setHelp(false)} onConfirm={() => setHelp(false)}><p>사진을 올리고 친구들에게 링크를 보내주세요. 사진 속 내 얼굴을 선택하면 각자 원하는 모습으로 보정할 수 있어요.</p><p>모두 보정을 마치면 한 장의 완성 사진으로 저장해요.</p></RoomDialog>}
  </main>;
}
