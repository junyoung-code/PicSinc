import {insidePolygon,smooth} from './geometry';
import type {Point} from '../state/model';

// Ordered MediaPipe FACE_LANDMARKS_*_EYE connections.
export const eyeContours=[
 [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
 [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],
];
export type Iris={center:Point;radius:number};
export type EyeThickness={
 halfWidth:number;
 upper:{lid:number;follow:number;outer:number};
 lower:{lid:number;follow:number;outer:number};
};
export type EyeArea={outline?:Point[];padding:number;feather:number;iris?:Iris;lower?:{point:Point;normal:Point;fade:number}};
export type EyeHeightArea={
 width:number;
 halfHeight:number;
 outerSign:number;
 outerCorner:Point;
 wingLength:number;
};

export function irisCircle(points:Point[],side:number):Iris{
 const start=side===0?468:473,center=points[start];
 return{center,radius:Math.max(...[1,2,3,4].map(k=>Math.hypot(points[start+k].x-center.x,points[start+k].y-center.y)))};
}

export function eyeThicknessShift({x,y}:Point,area:EyeThickness,scale:number):number{
 const isLower=y>0;
 const {lid,follow,outer}=isLower?area.lower:area.upper;
 const localScale=isLower?1+(scale-1)*.8:scale;
 const horizontal=x/area.halfWidth;
 if(Math.abs(horizontal)>=1||y===0)return 0;
 const crossSection=Math.sqrt(1-horizontal*horizontal);
 const distance=Math.abs(y)/crossSection;
 if(distance>=outer)return 0;

 // Move the crease and under-eye skin with the lid, then ease back to the original.
 const scaledLid=lid*localScale;
 const followLimit=Math.min(scaledLid+follow,outer*.9);
 const weight=1-smooth((distance-followLimit)/(outer-followLimit));
 const offset=Math.sign(y)*Math.min(distance,scaledLid)*crossSection;
 return offset*(1/localScale-1)*weight;
}

export function eyeHeightWeight(point:Point,area:EyeHeightArea,shift:number,guard:number):number{
 const {width,halfHeight,outerSign,outerCorner,wingLength}=area;
 const across=point.x*outerSign/width;
 const horizontal=across>0
  ?1-smooth((across-.65-guard/width)/.27)
  :1-smooth((-across-.60-guard/width)/.15);
 const pastCorner=(point.x-outerCorner.x)*outerSign;
 if(!horizontal&&(across<=0||pastCorner>=wingLength))return 0;

 const top=Math.max(0,-Math.max(point.y,point.y-shift)-halfHeight);
 const upperWeight=1-smooth((top-width*.10-guard)/(width*.23));
 const below=(point.y-shift*.60*horizontal-halfHeight)/width;
 // A band of constant displacement carries small skin details without compressing them.
 const skinWeight=1-.40*smooth((below-.13)/.05);
 const lowerWeight=1-smooth((below-.34)/.20);
 const vertical=upperWeight*skinWeight*lowerWeight;
 if(across<=0||below>=.12)return horizontal*vertical;

 // Let the estimated liner tip follow the eye before fading into the surrounding skin.
 const wing=1-smooth(pastCorner/wingLength);
 const linerDistance=Math.abs(point.y-outerCorner.y-shift*wing);
 const linerBand=1-smooth((linerDistance-width*.10-guard)/(width*.10));
 const aboveSkin=1-smooth((below-.02)/.10);
 return (horizontal+(wing-horizontal)*linerBand*aboveSkin)*vertical;
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
