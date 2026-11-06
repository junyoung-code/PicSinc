import type { ReactNode } from "react";
import Link from "next/link";
import theme from "@/features/home/theme.module.css";
import styles from "./room.module.css";

export default function RetouchShell({ title, onBack, backDisabled = false, children, footer, action, progress = 0, showProgress = false }: {
  title: string; onBack?: () => void; backDisabled?: boolean; children: ReactNode; footer?: ReactNode; action?: ReactNode; progress?: number; showProgress?: boolean;
}) {
  return <main className={`${theme.theme} ${styles.shell}`}>
    <header className={styles.header}>
      {onBack || backDisabled ? <button aria-label="이전 화면" disabled={backDisabled} onClick={onBack}><img src="/images/retouch-ui/back.svg" alt="" /></button> : <Link href="/retouch" aria-label="보정 시작으로"><img src="/images/retouch-ui/back.svg" alt="" /></Link>}
      <strong>{title}</strong>{action && <div className={styles.headerAction}>{action}</div>}
    </header>
    {showProgress && <progress className={styles.progress} aria-label="진행 단계" max={100} value={progress} />}
    <div className={styles.content}>{children}</div>
    {footer && <footer className={styles.footer}>{footer}</footer>}
  </main>;
}
