import type { CSSProperties } from 'react';
import styles from './LoadingCharacters.module.css';

// Reuse the approved artwork as a sprite sheet, excluding its static shadows.
// x: slot left edge. y: crop top. The green one is drawn 13px higher (mid-jump) in
// the artwork, so crop it higher to put its feet on the same line as the others.
const characters = [{ x: 46, y: 88 }, { x: 108, y: 88 }, { x: 170, y: 88 }, { x: 232, y: 88 }, { x: 294, y: 75 }];

export default function LoadingCharacters({ className = '' }: { className?: string }) {
  return <div className={`${styles.scene} ${className}`} aria-hidden="true" data-loading-characters="">
    {characters.map(({ x, y }, index) => <span key={x} className={styles.slot} style={{
      left: `${x / 402 * 100}%`,
      '--delay': `${0.25 + index * 0.65}s`,
      '--tilt': `${index % 2 ? 2 : -2}deg`,
    } as CSSProperties}>
      <span className={styles.shadow} />
      <span className={styles.character} style={{ backgroundPosition: `${x / (402 - 60) * 100}% ${y / (231 - 66) * 100}%` }} />
    </span>)}
  </div>;
}
