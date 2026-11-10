import {insidePolygon,smooth} from './geometry';
import type {Point} from '../state/model';

// Ordered MediaPipe FACE_LANDMARKS_*_EYE connections. Other eye controls retain
// their existing six-point geometry; these contours serve only the four fixes.
export const eyeContours=[
 [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
 [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],
];
export type Iris={center:Point;radius:number};
export type EyeArea={outline?:Point[];padding:number;feather:number;iris?:Iris;lower?:{point:Point;normal:Point;fade:number}};

export function irisCircle(points:Point[],side:number):Iris{
 const start=side===0?468:473,center=points[start];
 return{center,radius:Math.max(...[1,2,3,4].map(k=>Math.hypot(points[start+k].x-center.x,points[start+k].y-center.y)))};
}

export function eyeBoundaryDistance(p:Point,outline:Point[]):number{
 let distance=Infinity;
 for(let i=0;i<outline.length;i++){
  const a=outline[i],b=outline[(i+1)%outline.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  distance=Math.min(distance,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
 }
 return distance;
}

export function eyeAreaWeight(p:Point,area:EyeArea,guard:number):number{
 if(!area.outline)return 1;
 const distance=insidePolygon(p,area.outline)?0:eyeBoundaryDistance(p,area.outline);
 return 1-smooth((distance-area.padding-guard)/Math.max(1,area.feather));
}

export function eyeProtection(p:Point,area:EyeArea,guard:number):number{
 let weight=1;
 if(area.iris){
  const {center,radius}=area.iris;
  // Protect the entire iris plus every grid vertex contributing to its pixels.
  weight=smooth((Math.hypot(p.x-center.x,p.y-center.y)-radius*1.15-guard)/Math.max(2,radius*.55));
 }
 if(area.lower){
  const {point,normal,fade}=area.lower;
  weight*=smooth(((p.x-point.x)*normal.x+(p.y-point.y)*normal.y)/fade);
 }
 return weight;
}

export function scleraWeight(p:Point,outline:Point[],iris:Iris,feather:number):number{
 if(!insidePolygon(p,outline))return 0;
 const edge=eyeBoundaryDistance(p,outline),away=Math.hypot(p.x-iris.center.x,p.y-iris.center.y)-iris.radius*1.15;
 // Inward feathering protects eyeliner and the iris even under texture filtering.
 return smooth((edge-1)/feather)*smooth((away-1)/feather);
}
