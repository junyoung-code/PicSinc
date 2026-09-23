import type { Point } from "./mask-geometry";

export type ViewTransform = { scale: number; x: number; y: number };
export function viewportToImage(point: Point, view: ViewTransform): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}
export function zoomAround(view: ViewTransform, anchor: Point, scale: number): ViewTransform {
  const image = viewportToImage(anchor, view);
  return { scale, x: anchor.x - image.x * scale, y: anchor.y - image.y * scale };
}

/** Follow oriented pixel edges, including holes and disconnected components. */
export function traceContours(mask: Uint8Array, width: number, height: number): Point[][] {
  type Edge = { a: number; b: number; direction: number; used?: boolean };
  const edges: Edge[] = [];
  const outgoing = new Map<number, Edge[]>();
  const stride = width + 1;
  function add(x: number, y: number, nx: number, ny: number, direction: number) {
    const edge = { a: y * stride + x, b: ny * stride + nx, direction };
    edges.push(edge); const list = outgoing.get(edge.a) ?? []; list.push(edge); outgoing.set(edge.a, list);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) {
    if (!y || !mask[(y - 1) * width + x]) add(x, y, x + 1, y, 0);
    if (x === width - 1 || !mask[y * width + x + 1]) add(x + 1, y, x + 1, y + 1, 1);
    if (y === height - 1 || !mask[(y + 1) * width + x]) add(x + 1, y + 1, x, y + 1, 2);
    if (!x || !mask[y * width + x - 1]) add(x, y + 1, x, y, 3);
  }
  const rings: Point[][] = [];
  for (const first of edges) {
    if (first.used) continue;
    const ring: Point[] = []; let edge: Edge | undefined = first;
    while (edge && !edge.used) {
      edge.used = true; ring.push({ x: edge.a % stride, y: Math.floor(edge.a / stride) });
      if (edge.b === first.a) break;
      const direction: number = edge.direction;
      const choices: Edge[] = (outgoing.get(edge.b) ?? []).filter(candidate => !candidate.used);
      // At a diagonal corner, turn right to keep separate components separate.
      choices.sort((a, b) => [1, 0, 3, 2].indexOf((a.direction - direction + 4) % 4) - [1, 0, 3, 2].indexOf((b.direction - direction + 4) % 4));
      edge = choices[0];
    }
    if (ring.length >= 3) rings.push(ring.filter((p, index) => {
      const a = ring[(index + ring.length - 1) % ring.length], b = ring[(index + 1) % ring.length];
      return (p.x - a.x) * (b.y - p.y) !== (p.y - a.y) * (b.x - p.x);
    }));
  }
  return rings;
}

function lineDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function simplifyLine(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  let distance = 0, farthest = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const next = lineDistance(points[i], points[0], points[points.length - 1]);
    if (next > distance) { distance = next; farthest = i; }
  }
  if (distance <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplifyLine(points.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(farthest), tolerance)];
}
// Keep the exact boundary behind each simplified handle list. Weak keys follow
// the editor's lifetime without changing its public Point[][] representation.
const sourceContours = new WeakMap<Point[], Point[]>();
export function editableContours(mask: Uint8Array, width: number, height: number): Point[][] {
  return traceContours(mask, width, height).map(ring => {
    if (ring.length < 5) return ring;
    let farthest = 1;
    for (let i = 2; i < ring.length; i++) if (Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y) > Math.hypot(ring[farthest].x - ring[0].x, ring[farthest].y - ring[0].y)) farthest = i;
    const tolerance = Math.max(0.75, Math.max(width, height) / 500);
    const result = [...simplifyLine(ring.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplifyLine([...ring.slice(farthest), ring[0]], tolerance).slice(0, -1)];
    const handles = result.length >= 3 ? result : ring;
    sourceContours.set(handles, ring);
    return handles;
  });
}

/** Thin visible edit handles in screen space without changing the mask or contour. */
export function spacedHandleIndices(ring: Point[], scale: number, minimumPixels = 24): number[] {
  if (ring.length <= 3) return ring.map((_, index) => index);
  const visible = [0];
  for (let index = 1; index < ring.length; index++) {
    const previous = ring[visible[visible.length - 1]];
    if (Math.hypot(ring[index].x - previous.x, ring[index].y - previous.y) * scale >= minimumPixels) visible.push(index);
  }
  while (visible.length > 3) {
    const last = ring[visible[visible.length - 1]];
    if (Math.hypot(last.x - ring[0].x, last.y - ring[0].y) * scale >= minimumPixels) break;
    visible.pop();
  }
  if (visible.length >= 3) return visible;
  return [...new Set([0, Math.floor(ring.length / 3), Math.floor(2 * ring.length / 3)])];
}
export function pointInPolygon(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function signedArea(ring: Point[]): number {
  return ring.reduce((area, p, i) => { const q = ring[(i + 1) % ring.length]; return area + p.x * q.y - q.x * p.y; }, 0) / 2;
}
function contourPointChange(width: number, height: number, ring: Point[], index: number, target: Point) {
  const next = { x: Math.max(0, Math.min(width, target.x)), y: Math.max(0, Math.min(height, target.y)) };
  const before = sourceContours.get(ring) ?? ring;
  const start = before.indexOf(ring[(index + ring.length - 1) % ring.length]);
  const end = before.indexOf(ring[(index + 1) % ring.length]);
  const changed = [next], after: Point[] = [];
  // Replace the real old arc between the two neighboring handles, including
  // pixels outside the simplified chords. Leave every other arc untouched.
  for (let i = start; ; i = (i + 1) % before.length) { changed.push(before[i]); if (i === end) break; }
  for (let i = end; ; i = (i + 1) % before.length) { after.push(before[i]); if (i === start) break; }
  after.push(next);
  return { before, after, changed, next };
}
function applyContourChange(mask: Uint8Array, width: number, height: number, change: ReturnType<typeof contourPointChange>): Uint8Array {
  const result = mask.slice();
  const { before, after, changed } = change;
  const left = Math.max(0, Math.floor(Math.min(...changed.map(p => p.x)))), right = Math.min(width - 1, Math.ceil(Math.max(...changed.map(p => p.x))));
  const top = Math.max(0, Math.floor(Math.min(...changed.map(p => p.y)))), bottom = Math.min(height - 1, Math.ceil(Math.max(...changed.map(p => p.y))));
  const hole = signedArea(before) < 0;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const point = { x: x + 0.5, y: y + 0.5 };
    const wasInside = pointInPolygon(point, before), isInside = pointInPolygon(point, after);
    if (wasInside !== isInside) result[y * width + x] = Number(hole ? !isInside : isInside);
  }
  return result;
}
/** Change only the moved arc; preserve pixels away from it, holes and other components. */
export function moveContourPoint(mask: Uint8Array, width: number, height: number, ring: Point[], index: number, target: Point): Uint8Array {
  if (ring[index].x === target.x && ring[index].y === target.y) return mask.slice();
  return applyContourChange(mask, width, height, contourPointChange(width, height, ring, index, target));
}

export type PendingContour = { ring: Point[]; index: number; target: Point };
export function finishContourGesture(mask: Uint8Array, width: number, height: number, pending: PendingContour | null, cancelled: boolean) {
  if (!pending || cancelled) return mask;
  const { ring, index, target } = pending;
  if (ring[index].x === target.x && ring[index].y === target.y) return mask;
  const change = contourPointChange(width, height, ring, index, target);
  const result = applyContourChange(mask, width, height, change);
  ring[index] = change.next;
  sourceContours.set(ring, change.after);
  return result;
}
