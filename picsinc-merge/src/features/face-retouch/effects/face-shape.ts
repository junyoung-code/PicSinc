import {distance,oval,smooth} from './geometry';
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

// Taper by distance along each side so the effect follows tilted or asymmetric jaws.
export function jawCornerOffsets(points:Point[],width:number):Map<number,Point>{
 const offsets=new Map<number,Point>();
 for(const [cheek,corner,side] of [[93,172,-1],[323,397,1]]){
  const start=oval.indexOf(cheek),end=oval.indexOf(152),step=Math.sign(end-start);
  const arc=new Map<number,number>([[cheek,0]]);
  let length=0;
  for(let i=start+step;i!==end+step;i+=step){
   length+=distance(points[oval[i-step]],points[oval[i]]);
   arc.set(oval[i],length);
  }
  const peak=arc.get(corner)!;
  for(const [id,position] of arc){
   const towardChin=(position-peak)/Math.max(1e-6,length-peak);
   // Carry the corner through the upper part of the jawline, then taper before the chin.
   const weight=position<=peak?smooth(position/Math.max(1e-6,peak)):smooth((.74-towardChin)/.40);
   offsets.set(id,{x:-side*width*.014*weight,y:-width*.022*weight});
  }
 }
 return offsets;
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
