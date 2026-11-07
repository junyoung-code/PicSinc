import styles from "./FlowProgress.module.css";

export function FlowProgress({ progress = 0, step, complete = progress >= 100, className = "" }: {
  progress?: number;
  step?: 1 | 2 | 3 | 4;
  complete?: boolean;
  className?: string;
}) {
  const current = step ?? Math.min(4, Math.max(1, Math.ceil(progress / 25)));
  return <div className={`${styles.progress} ${className}`} role="progressbar" aria-label="진행 단계" aria-valuemin={0} aria-valuemax={4} aria-valuenow={complete ? 4 : current} aria-valuetext={complete ? "완료" : `4단계 중 ${current}단계`}>
    {[1, 2, 3, 4].map(value => <span key={value} className={complete || value < current ? styles.done : value === current ? styles.current : styles.upcoming} />)}
  </div>;
}
