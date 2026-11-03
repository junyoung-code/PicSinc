"use client";
import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Point } from "../state/model";
import styles from "./retouch.module.css";

export function TouchGuide({ point, start, radius, width, height }: {
  point: Point; start: Point | null; radius: number; width: number; height: number;
}) {
  const dx = start ? point.x-start.x : 0, dy = start ? point.y-start.y : 0;
  const length = Math.hypot(dx,dy), head = Math.min(radius*.3,length*.3);
  const ux = length ? dx/length : 0, uy = length ? dy/length : 0;
  const cross = (p: Point) => <path d={`M${p.x-radius*.65} ${p.y}h${radius*.25} M${p.x+radius*.4} ${p.y}h${radius*.25} M${p.x} ${p.y-radius*.65}v${radius*.25} M${p.x} ${p.y+radius*.4}v${radius*.25}`}/>;
  return <svg className={styles.touchGuide} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" data-testid="touch-guide">
    {start && length > radius*.15 && <g className={styles.touchOrigin}>
      <circle cx={start.x} cy={start.y} r={radius}/>{cross(start)}
    </g>}
    {start && length > radius*.15 && <path data-testid="touch-direction" d={`M${start.x} ${start.y}L${point.x} ${point.y}m${-ux*head-uy*head*.5} ${-uy*head+ux*head*.5}L${point.x} ${point.y}l${-ux*head+uy*head*.5} ${-uy*head-ux*head*.5}`}/>}
    <circle cx={point.x} cy={point.y} r={radius}/>{cross(point)}
  </svg>;
}

// Copies the displayed WebGL frame. It does not rerun detection or deformation.
// drawPreview calls refresh after every completed frame, even with a still finger.
export function TouchMagnifier({ source, refresh, point, imageWidth, imageHeight, displayScale, right }: {
  source: RefObject<HTMLCanvasElement | null>; refresh: RefObject<() => void>;
  point: Point; imageWidth: number; imageHeight: number; displayScale: number; right: boolean;
}) {
  const lens = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const draw = () => {
      const src = source.current, dest = lens.current;
      if (!src || !dest) return;
      const ctx = dest.getContext("2d");
      if (!ctx) return;
      const size = dest.width, span = dest.clientWidth / Math.max(.001, displayScale) / 2;
      const sx = (point.x-span/2)/imageWidth*src.width, sy = (point.y-span/2)/imageHeight*src.height;
      ctx.fillStyle = "#171719";ctx.fillRect(0,0,size,size);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(src,sx,sy,span/imageWidth*src.width,span/imageHeight*src.height,0,0,size,size);
    };
    refresh.current = draw; draw();
    return () => { refresh.current = () => {}; };
  }, [source, refresh, point, imageWidth, imageHeight, displayScale]);
  return <div className={styles.magnifier} style={{left:right?"auto":12,right:right?12:"auto"}} data-testid="touch-magnifier">
    <canvas ref={lens} width={280} height={280} aria-label="터치 위치 확대 보기"/>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="21"/><path d="M33 50h9m16 0h9M50 33v9m0 16v9"/></svg>
    <span>2×</span>
  </div>;
}
