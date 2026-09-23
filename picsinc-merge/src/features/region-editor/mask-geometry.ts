export type Point = { x: number; y: number };

export function screenToImage(point: Point, bounds: { left: number; top: number; width: number; height: number }, image: { width: number; height: number }): Point {
  return {
    x: Math.max(0, Math.min(image.width - 1, (point.x - bounds.left) * image.width / bounds.width)),
    y: Math.max(0, Math.min(image.height - 1, (point.y - bounds.top) * image.height / bounds.height)),
  };
}

export function paintEllipse(mask: Uint8Array, width: number, height: number, center: Point, radius: Point, selected: 0 | 1) {
  const rx = Math.max(1, Math.abs(radius.x)); const ry = Math.max(1, Math.abs(radius.y));
  const left = Math.max(0, Math.floor(center.x - rx)); const right = Math.min(width - 1, Math.ceil(center.x + rx));
  const top = Math.max(0, Math.floor(center.y - ry)); const bottom = Math.min(height - 1, Math.ceil(center.y + ry));
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const dx = (x - center.x) / rx; const dy = (y - center.y) / ry;
    if (dx * dx + dy * dy <= 1) mask[y * width + x] = selected;
  }
}

export function paintBrush(mask: Uint8Array, width: number, height: number, from: Point, to: Point, radius: number, selected: 0 | 1) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, radius / 2)));
  for (let step = 0; step <= steps; step++) {
    const x = from.x + (to.x - from.x) * step / steps; const y = from.y + (to.y - from.y) * step / steps;
    const left = Math.max(0, Math.floor(x - radius)); const right = Math.min(width - 1, Math.ceil(x + radius));
    const top = Math.max(0, Math.floor(y - radius)); const bottom = Math.min(height - 1, Math.ceil(y + radius));
    for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) if ((px - x) ** 2 + (py - y) ** 2 <= radius ** 2) mask[py * width + px] = selected;
  }
}

export function overlapMask(masks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(masks[0]?.length ?? 0);
  for (let index = 0; index < result.length; index++) result[index] = masks.reduce((count, mask) => count + (mask[index] ? 1 : 0), 0) > 1 ? 1 : 0;
  return result;
}

export function applyExclusive(maskSet: Uint8Array[], target: number, allowed: Uint8Array) {
  const chosen = maskSet[target];
  for (let pixel = 0; pixel < chosen.length; pixel++) {
    chosen[pixel] = chosen[pixel] && allowed[pixel] ? 1 : 0;
    if (chosen[pixel]) for (let index = 0; index < maskSet.length; index++) if (index !== target) maskSet[index][pixel] = 0;
  }
}
