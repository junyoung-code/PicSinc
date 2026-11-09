import type { CSSProperties } from 'react';
import styles from './LoadingCharacters.module.css';

// Reuse the approved artwork as a sprite sheet, excluding its static shadows.
const characters = [46, 108, 170, 232, 294];

export default function LoadingCharacters({ className = '' }: { className?: string }) {
  return <div className={`${styles.scene} ${className}`} aria-hidden="true" data-loading-characters="">
    {characters.map((x, index) => <span key={x} className={styles.slot} style={{
      left: `${x / 402 * 100}%`,
      '--delay': `${0.25 + index * 0.65}s`,
      '--tilt': `${index % 2 ? 2 : -2}deg`,
    } as CSSProperties}>
      <span className={styles.shadow} />
      <span className={styles.character} style={{ backgroundPosition: `${x / (402 - 60) * 100}% ${88 / (231 - 66) * 100}%` }} />
    </span>)}
  </div>;
}
