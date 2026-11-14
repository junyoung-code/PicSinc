'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { FlowProgress } from '@/components/FlowProgress';
import theme from '@/features/home/theme.module.css';
import RoomDialog from './RoomDialog';
import styles from './room.module.css';

// iPhone Safari can keep the page shifted up after the keyboard closes: the header is cut off
// and dragging cannot bring it back (11/13 phone test, iPhone 14 Pro). When the keyboard goes
// away, put the scroll position back inside the page's real range.
function useKeyboardScrollReset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const settle = () => {
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (window.scrollY > max || (viewport && viewport.offsetTop > 0)) window.scrollTo(window.scrollX, Math.min(window.scrollY, max));
    };
    const later = () => window.setTimeout(settle, 120);
    document.addEventListener('focusout', later);
    viewport?.addEventListener('resize', later);
    return () => { document.removeEventListener('focusout', later); viewport?.removeEventListener('resize', later); };
  }, []);
}

export default function RetouchShell({ title, onBack, backDisabled = false, children, footer, action, progress = 0, showProgress = false, brand = false, hideBack = false, centered = false, showHelp = true }: {
  title: string; onBack?: () => void; backDisabled?: boolean; children: ReactNode; footer?: ReactNode; action?: ReactNode; progress?: number; showProgress?: boolean; brand?: boolean; hideBack?: boolean; centered?: boolean; showHelp?: boolean;
}) {
  const [help, setHelp] = useState(false);
  useKeyboardScrollReset();
  return <main className={`${theme.theme} ${styles.shell}`}>
    <header className={`${styles.header} ${brand ? styles.brandHeader : ''}`}>
      {!hideBack && (onBack || backDisabled ? <button aria-label="이전 화면" disabled={backDisabled} onClick={onBack}><img src="/images/retouch-ui/back.svg" alt="" /></button> : <Link href="/" aria-label="홈으로"><img src="/images/retouch-ui/back.svg" alt="" /></Link>)}
      {brand ? <Link className={styles.wordmark} href="/" aria-label="MOIRA 홈"><img src="/images/figma-current/moira-logo.svg" alt="MOIRA" /></Link> : <strong>{title}</strong>}
      <div className={styles.headerAction}>{action ?? (showHelp && <button className={styles.help} aria-label="도움말" onClick={() => setHelp(true)}>?</button>)}</div>
    </header>
    {showProgress ? <FlowProgress progress={progress}/> : <div className={styles.progressSpace}/>}
    <div className={`${styles.content} ${centered ? styles.centered : ''}`}>{children}</div>
    {footer && <footer className={styles.footer}>{footer}</footer>}
    {help && <RoomDialog title={title === 'MOIRA' ? '함께 보정하는 방법' : title} cancelLabel={null} onCancel={() => setHelp(false)} onConfirm={() => setHelp(false)}><p>사진을 올리고 친구들에게 링크를 보내주세요. 사진 속 내 얼굴을 선택하면 각자 원하는 모습으로 보정할 수 있어요.</p><p>모두 보정을 마치면 한 장의 완성 사진으로 저장해요.</p></RoomDialog>}
  </main>;
}
