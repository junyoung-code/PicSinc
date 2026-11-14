import { insidePolygon, smooth } from './geometry';
import type { Point } from '../state/model';
// Ordered contours from MediaPipe's FACE_LANDMARKS_LIPS connections.
export const lipOuterLoop = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
export const lipInnerLoop = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];

function nearestLipPoint(point: Point, outline: Point[]): Point {
  if (insidePolygon(point, outline)) return point;
  let nearest = Infinity;
  let closest = point;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const x = point.x - a.x, y = point.y - a.y;
    const dx = b.x - a.x, dy = b.y - a.y;
    const projection = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)));
    const distance = (x - dx * projection) ** 2 + (y - dy * projection) ** 2;
    if (distance < nearest) {
      nearest = distance;
      closest = { x: a.x + dx * projection, y: a.y + dy * projection };
    }
  }
  return closest;
}

// Inputs are relative to the scaling center and aligned with the face.
export function lipScaleSource(point: Point, outline: Point[], sx: number, sy: number, guard: number, feather: number): Point {
  const source = { x: point.x / sx, y: point.y / sy };
  const edge = nearestLipPoint(source, outline);
  const distance = Math.hypot(source.x - edge.x, source.y - edge.y);
  if (distance <= guard) return source;

  // Outside the interpolation collar, follow the lip edge's translation
  // instead of stretching the surrounding skin by the lip's scale.
  const edgeWeight = (distance - guard) / distance;
  const originalEdge = nearestLipPoint(point, outline);
  const originalDistance = Math.hypot(point.x - originalEdge.x, point.y - originalEdge.y);
  const weight = 1 - smooth((Math.min(distance, originalDistance) - guard) / feather);
  const followX = source.x + (edge.x - source.x) * edgeWeight;
  const followY = source.y + (edge.y - source.y) * edgeWeight;
  return {
    x: point.x + followX * (1 - sx) * weight,
    y: point.y + followY * (1 - sy) * weight,
  };
}

type LipBand = { outer: Point[]; inner: Point[]; direction: -1 | 1 };
export type LipFullness = { upper: LipBand; lower: LipBand; left: number; right: number; nose: number; feather: number };

// The existing shared slider factor is .25 at the endpoints. Narrowing
// needs a little more travel to match the reference at the negative end.
export function lipFullnessAmount(factor: number): number {
  return factor * (factor < 0 ? .88 : .60);
}

export function lipFullnessShape(landmarks: Point[], center: Point, nose: number, feather: number): LipFullness {
  const toProfile = (ids: number[], direction: -1 | 1) => ids
    .map(id => ({ x: landmarks[id].x - center.x, y: (landmarks[id].y - center.y) * direction }))
    .sort((a, b) => a.x - b.x);
  const band = (direction: -1 | 1, start: number, end: number): LipBand => ({
    direction,
    outer: toProfile(lipOuterLoop.slice(start, end).concat(start ? [61] : []), direction),
    inner: toProfile(lipInnerLoop.slice(start, end).concat(start ? [78] : []), direction),
  });
  return {
    upper: band(-1, 0, 11),
    lower: band(1, 10, 20),
    left: Math.min(landmarks[61].x, landmarks[291].x) - center.x,
    right: Math.max(landmarks[61].x, landmarks[291].x) - center.x,
    nose: nose - center.y,
    feather,
  };
}

function profileAt(profile: Point[], x: number): number {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    if (x <= b.x) return a.y + (b.y - a.y) * Math.max(0, (x - a.x) / (b.x - a.x || 1));
  }
  return profile[profile.length - 1].y;
}

function bandShift(p: Point, band: LipBand, amount: number, guard: number, feather: number, noseEdge: number): number {
  const { direction, outer, inner } = band;
  const edge = profileAt(outer, p.x);
  const insideEdge = profileAt(inner, p.x);
  // A grid vertex must clear the most outward cavity point in its interpolation footprint.
  const left = p.x - guard, right = p.x + guard;
  let fixedInside = Math.max(profileAt(inner, left), profileAt(inner, right));
  for (const point of inner) {
    if (point.x > left && point.x < right) fixedInside = Math.max(fixedInside, point.y);
  }
  fixedInside += guard;
  if (direction === 1) fixedInside = Math.max(fixedInside, noseEdge);
  const fixedOutside = direction === -1 ? Math.min(edge + feather, -noseEdge) : edge + feather;
  const insideRoom = edge - fixedInside, outsideRoom = fixedOutside - edge;
  if (insideRoom <= 0 || outsideRoom <= 0) return 0;

  // Leave room on both sides of the moved outline for a smooth inverse map.
  const shift = Math.max(-insideRoom * .30, Math.min(outsideRoom * .30, (edge - insideEdge) * amount));
  const target = edge + shift, y = p.y * direction;
  const weight = y <= target
    ? smooth((y - fixedInside) / (target - fixedInside))
    : smooth((fixedOutside - y) / (fixedOutside - target));
  return -direction * shift * weight;
}

export function lipFullnessShift(p: Point, shape: LipFullness, amount: number, guard: number, noseGuard: number): number {
  const noseEdge = shape.nose + noseGuard;
  if (p.y <= noseEdge || shape.left >= shape.right) return 0;
  const cornerDistance = Math.min(p.x - shape.left, shape.right - p.x);
  const weight = smooth((cornerDistance - guard) / ((shape.right - shape.left) * .22));
  if (!weight) return 0;
  const strength = amount * weight;
  return bandShift(p, shape.upper, strength, guard, shape.feather, noseEdge) +
    bandShift(p, shape.lower, strength, guard, shape.feather, noseEdge);
}

// Coordinates relative to the mouth center, aligned with the face.
export type LipPosition = { nose:number; rx:number; ry:number; feather:number };
export function lipPositionShift(p:Point,shape:LipPosition,amount:number,guard:number):number {
 // Keep both the nose and the translated mouth rigid through grid interpolation.
 // If the philtrum is short, reduce the whole shift instead of masking the upper lip.
 const gap=Math.max(0,-shape.ry-shape.nose-2*guard),limit=gap*.5;
 const dy=Math.max(-limit,Math.min(limit,amount));if(!dy)return 0;
 const top=-shape.ry+dy-guard,bottom=shape.ry+dy+guard,nose=shape.nose+guard;
 const upper=smooth((p.y-nose)/(top-nose));
 const lower=1-smooth((p.y-bottom)/shape.feather);
 const sides=1-smooth((Math.abs(p.x)-shape.rx-guard)/shape.feather);
 return -dy*upper*lower*sides;
}
