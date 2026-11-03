import type { Point, Stroke } from "../state/model";
export type ImageRect = { left: number; top: number; width: number; height: number };
// The DOM rectangle already includes fit, pan and zoom. Never store CSS pixels.
export function imagePoint(client: Point, rect: ImageRect, width: number, height: number): Point {
  return { x: (client.x-rect.left)/rect.width*width, y: (client.y-rect.top)/rect.height*height };
}
export const TOUCH_SUPPORT = 1.65;
export function splitDrag(owner: string, from: Point, to: Point, radius: number, strength = .06): Stroke[] {
  const length=Math.hypot(to.x-from.x,to.y-from.y);
  if(length<.1) return [];
  const count=Math.max(1,Math.ceil(length/(radius*.20)));
  return Array.from({length:count},(_,i)=>({owner,radius,strength:Math.max(.01,Math.min(1,strength)),
    from:{x:from.x+(to.x-from.x)*i/count,y:from.y+(to.y-from.y)*i/count},
    to:{x:from.x+(to.x-from.x)*(i+1)/count,y:from.y+(to.y-from.y)*(i+1)/count}}));
}
