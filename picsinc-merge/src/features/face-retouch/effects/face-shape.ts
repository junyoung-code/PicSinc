import {distance,smooth} from './geometry';
import type {Point} from '../state/model';

export type ContourSample={point:Point;delta:Point;length:number};
export type SoftContour={samples:ContourSample[];radius:number};
export type LowerFace={nose:number;chin:number;mouthTop:number;mouthBottom:number;mouthCenter:number;amount:number};

export function contourLengths(points:Point[]):number[]{
 return points.map((p,i)=>(distance(p,points[(i+points.length-1)%points.length])+distance(p,points[(i+1)%points.length]))/2);
}

// A compact cubic kernel blends several neighboring contour displacements.
// Its first two derivatives vanish at the support boundary. Arc-length weights
// keep densely spaced chin landmarks from dominating the surrounding jaw.
export function contourShift(p:Point,contour:SoftContour):Point{
 let total=0,x=0,y=0;const radius2=contour.radius**2;
 for(const sample of contour.samples){
  const dx=p.x-sample.point.x,dy=p.y-sample.point.y,t=1-(dx*dx+dy*dy)/radius2;
  if(t<=0)continue;
  const weight=t*t*t*sample.length;total+=weight;x+=sample.delta.x*weight;y+=sample.delta.y*weight;
 }
 if(!total)return{x:0,y:0};
 const fade=smooth(total/(contour.radius*.6))/total;
 return{x:x*fade,y:y*fade};
}

// Move sharp corners toward the arc-length-weighted neighborhood, preserving
// the person's own outline instead of imposing one template jaw on every face.
export function roundedContour(points:Point[],radius:number):Point[]{
 const lengths=contourLengths(points),arcs=[0];
 for(let i=1;i<=points.length;i++)arcs.push(arcs[i-1]+distance(points[i-1],points[i%points.length]));
 return points.map((_,i)=>{
  let total=0,x=0,y=0;
  points.forEach((p,j)=>{
   const arc=Math.abs(arcs[i]-arcs[j]),d=Math.min(arc,arcs[points.length]-arc)/radius;
   if(d>=1)return;
   const weight=(1-d*d)**3*lengths[j];total+=weight;x+=p.x*weight;y+=p.y*weight;
  });
  return total?{x:x/total,y:y/total}:points[i];
 });
}

// Inverse vertical map. The nose is fixed; mouth and chin destinations use the
// same proportional shortening. The entire mouth band translates rigidly, with
// smooth transitions above/below it so the lip shape and opening stay intact.
export function lowerFaceSource(y:number,shape:LowerFace,scale:number):number{
 const amount=shape.amount*scale,mouthShift=(shape.mouthCenter-shape.nose)*amount;
 const chinShift=(shape.chin-shape.nose)*amount;
 const top=shape.mouthTop-mouthShift,bottom=shape.mouthBottom-mouthShift,chin=shape.chin-chinShift;
 if(y<=shape.nose)return y;
 if(y<top)return y+mouthShift*smooth((y-shape.nose)/Math.max(1,top-shape.nose));
 if(y<=bottom)return y+mouthShift;
 return y+mouthShift+(chinShift-mouthShift)*smooth((y-bottom)/Math.max(1,chin-bottom));
}
