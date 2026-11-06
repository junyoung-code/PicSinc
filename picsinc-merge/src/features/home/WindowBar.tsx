import styles from "./window-bar.module.css";

/** Decorative photo-window title bar. Parent supplies theme.module.css's theme. */
export default function WindowBar({ title, tone = "sky" }: {
  title: string;
  tone?: "sky" | "mint";
}) {
  return <div className={`${styles.bar} ${styles[tone]}`} aria-hidden="true">
    <span>{title}</span><span className={styles.controls}>− □ ×</span>
  </div>;
}
