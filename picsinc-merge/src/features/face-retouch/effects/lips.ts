import { insidePolygon, smooth } from './geometry';
import type { Point } from '../state/model';
// Ordered contours from MediaPipe's FACE_LANDMARKS_LIPS connections.
export const lipOuterLoop = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
export const lipInnerLoop = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];
export type LipShape = { outer: Point[]; inner: Point[]; feather: number };
function boundaryDistance(p: Point, polygon: Point[]): number {
 let distance=Infinity;
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  distance=Math.min(distance,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
 }
 return distance;
}
export function lipWeight(p:Point,shape:LipShape,gridGuard:number):number {
 if(!insidePolygon(p,shape.outer)||insidePolygon(p,shape.inner))return 0;
 const distance=Math.min(boundaryDistance(p,shape.outer),boundaryDistance(p,shape.inner));
 // A nonzero vertex's complete bilinear footprint stays inside the lip tissue.
 // This also prevents the renderer from moving adjacent skin or the mouth cavity.
 return smooth((distance-gridGuard)/shape.feather);
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
