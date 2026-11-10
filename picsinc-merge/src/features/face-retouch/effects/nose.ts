import {insidePolygon,smooth} from './geometry';
import type {Point} from '../state/model';

export const nostrilContours=[[98,240,59,44,97,99],[327,460,289,274,326,328]];
export type NoseProtection={lipTop:number;feather:number;fixed:Point[][]};
export type NoseBand={
 rows:{x:number;y:number;rx:number}[];
 split:number;blend:number;bottom:number;topFade:number;bottomFade:number;feather:number;
 part:'bridge'|'dorsum';
};

function outsideContour(p:Point,polygon:Point[]):number{
 if(insidePolygon(p,polygon))return 0;
 let distance=Infinity;
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  distance=Math.min(distance,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
 }
 return distance;
}
export function noseProtection(p:Point,area:NoseProtection,guard:number):number{
 let weight=smooth((area.lipTop-guard-p.y)/area.feather);
 for(const polygon of area.fixed)weight*=smooth((outsideContour(p,polygon)-guard)/area.feather);
 return weight;
}

// Both bands read the same point and use complementary weights. Their shifts
// add once, so equal settings do not create a fixed seam or double scaling.
export function noseBandShift(p:Point,band:NoseBand,scale:number):number{
 const rows=band.rows;
 let a=rows[0],b=rows[rows.length-1];
 for(let i=0;i<rows.length-1;i++)if(p.y<=rows[i+1].y){a=rows[i];b=rows[i+1];break;}
 const t=smooth((p.y-a.y)/Math.max(1e-6,b.y-a.y)),axis=a.x+(b.x-a.x)*t,rx=a.rx+(b.rx-a.rx)*t;
 const blend=smooth((p.y-band.split+band.blend)/(2*band.blend));
 const vertical=smooth((p.y-rows[0].y)/band.topFade)*(1-smooth((p.y-band.bottom+band.bottomFade)/band.bottomFade));
 const sides=1-smooth((Math.abs(p.x-axis)-rx)/band.feather);
 return (p.x-axis)*(1/scale-1)*vertical*sides*(band.part==='bridge'?1-blend:blend);
}
