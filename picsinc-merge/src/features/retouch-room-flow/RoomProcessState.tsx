import MobileShell from './RetouchShell';
import styles from './room.module.css';
import LoadingCharacters from '@/components/LoadingCharacters';

export default function RoomProcessState({ title, heading, description, error, errorTitle, progress = 85, onRetry, retrying = false, onBack, backLabel, waiting }: {
  title: string; heading: string; description: string; error?: string; errorTitle?: string; progress?: number;
  onRetry?: () => void; retrying?: boolean; onBack?: () => void; backLabel?: string; waiting?: string;
}) {
  return <MobileShell title={title} hideBack={!onBack} onBack={onBack} showHelp={false} showProgress progress={progress}
    action={error && onRetry ? <button disabled={retrying} onClick={onRetry}>{retrying ? '확인 중…' : '재시도'}</button> : undefined}
    footer={onBack && <button className="secondary-button" disabled={retrying} onClick={onBack}>{backLabel ?? '결과 확인으로 돌아가기'}</button>}>
    <div className={error ? styles.failureState : styles.processingState}>
      {error ? <img className={styles.failureCharacter} src="/images/figma-current/home/lilac.png" alt=""/> : <LoadingCharacters className={styles.processingCharacters} />}
      <div className={styles.heading}><h1>{heading}</h1><p className="description">{description}</p></div>
      {error && <div className={styles.errorCard} role="alert"><strong>{errorTitle ?? '처리하지 못했어요'}</strong><p>{error}</p></div>}
      {waiting && <p className={styles.processingNote} role="status">{waiting}</p>}
    </div>
  </MobileShell>;
}
