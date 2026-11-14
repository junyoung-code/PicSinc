import {insidePolygon,smooth} from './geometry';
import type {Point} from '../state/model';

export const nostrilContours=[[98,240,59,44,97,99],[327,460,289,274,326,328]];
export type NoseProtection = {
 lipTop: number;
 feather: number;
 fixed: Point[][];
 alar?: { side: number; inner: number; rim: number; wing: number; top: number; upperFade: number };
};
export type NoseLength = {
 root: number;
 tipTop: number;
 tipBottom: number;
 lipTop: number;
};

export function noseLengthShift(
 point: Point,
 shape: NoseLength,
 amount: number,
 guard: number,
 halfWidth: number,
 feather: number,
): number {
 const top = shape.root + guard;
 const bottom = shape.lipTop - guard;
 const bridgeRoom = shape.tipTop - top;
 const philtrumRoom = bottom - shape.tipBottom;
 if (bridgeRoom <= 0 || philtrumRoom <= 0) return 0;
 // Keep sampling padding around the tip where the transition has room for it.
 const bridgeGap = bridgeRoom - Math.min(guard, bridgeRoom / 3);
 const philtrumGap = philtrumRoom - Math.min(guard, philtrumRoom / 3);

 const shift = Math.max(-bridgeGap / 3, Math.min(philtrumGap / 3, amount));
 // Sample from the source with a constant shift across the moved tip and nostrils.
 const upper = smooth((point.y - top) / (bridgeGap + shift));
 const lower = smooth((bottom - point.y) / (philtrumGap - shift));
 const sides = 1 - smooth((Math.abs(point.x) - halfWidth) / feather);
 return -shift * upper * lower * sides;
}

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
 if (area.alar) {
  const { side, inner, rim, wing, top, upperFade } = area.alar;
  const x = side * p.x;
  const rimWeight = .25 * smooth((x - inner) / Math.max(1, rim - inner));
  const wingWeight = .75 * smooth((x - rim) / (wing - rim));
  weight *= (rimWeight + wingWeight) * smooth((p.y - top) / upperFade);
 }
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
