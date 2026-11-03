import type { Face, Point } from "../state/model";
export const eyeLoops = [[33,160,158,133,153,144], [362,385,387,263,373,380]];
export const browLoops = [[70,63,105,66,107,55,65,52,53,46], [336,296,334,293,300,276,283,282,295,285]];
export const lipLoop = [61,40,37,0,267,270,291,321,314,17,84,91];
export const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
export function mean(points: Point[]): Point {
  return { x: points.reduce((s,p) => s+p.x,0)/points.length, y: points.reduce((s,p) => s+p.y,0)/points.length };
}
export const distance = (a: Point,b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
export const smooth = (t: number) => { const v=Math.max(0,Math.min(1,t)); return v*v*(3-2*v); };
export function frame(face: Face, width: number, height: number) {
  const points = face.landmarks.map(p => ({x:p.x*width,y:p.y*height}));
  const left = mean(eyeLoops[0].map(i=>points[i])), right = mean(eyeLoops[1].map(i=>points[i]));
  const angle = Math.atan2(right.y-left.y, right.x-left.x), c=Math.cos(angle), s=Math.sin(angle);
  const center=mean([points[234],points[454]]);
  const local=(p:Point):Point=>({x:(p.x-center.x)*c+(p.y-center.y)*s,y:-(p.x-center.x)*s+(p.y-center.y)*c});
  const world=(p:Point):Point=>({x:center.x+p.x*c-p.y*s,y:center.y+p.x*s+p.y*c});
  const lm=points.map(local);
  return { points, lm, angle, local, world, width: distance(points[234],points[454]), height: distance(points[10],points[152]), center };
}
export function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export function bounds(points: Point[]) {
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}
