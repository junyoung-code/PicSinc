'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './room.module.css';

type Props = { src: string; alt: string; className?: string; onEnlarge?: () => void };

export default function RoomPhotoPreview(props: Props) {
  return <Photo key={props.src} {...props}/>;
}

function Photo({ src, alt, className, onEnlarge }: Props) {
  const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false), [retry, setRetry] = useState(0);
  const image = useRef<HTMLImageElement>(null);
  const imageSrc = retry ? `${src}${src.includes('?') ? '&' : '?'}reload=${retry}` : src;
  useEffect(() => {
    if (image.current?.complete) { setLoaded(image.current.naturalWidth > 0); setFailed(!image.current.naturalWidth); }
  }, [imageSrc]);
  if (failed) return <div className={`${styles.errorCard} ${styles.photoError}`} role="alert">
    <strong>사진을 불러오지 못했어요</strong><p>저장된 사진은 그대로예요. 연결을 확인하고 다시 불러와 주세요.</p>
    <button type="button" onClick={() => { setFailed(false); setLoaded(false); setRetry(Date.now()); }}>사진 다시 불러오기</button>
  </div>;
  const photo = <img ref={image} key={imageSrc} className={className} src={imageSrc} alt={alt} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/>;
  return onEnlarge ? <button className={styles.imageButton} aria-label="완성 사진 크게 보기" disabled={!loaded} onClick={onEnlarge}>{photo}</button> : photo;
}
