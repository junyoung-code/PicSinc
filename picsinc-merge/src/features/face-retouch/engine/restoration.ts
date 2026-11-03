import {smooth} from '../effects/geometry';
import type {ControlId,EditState,Point,Restore} from '../state/model';
export function restoreWeight(point:Point,r:Restore):number {
 const dx=r.center.x-r.from.x,dy=r.center.y-r.from.y,length=dx*dx+dy*dy;
 const t=length?Math.max(0,Math.min(1,((point.x-r.from.x)*dx+(point.y-r.from.y)*dy)/length)):0;
 const d=Math.hypot(point.x-r.from.x-dx*t,point.y-r.from.y-dy*t)/r.radius;
 // A real original core, surrounded by a smooth collar.
 return smooth((d-.62)/.38);
}
export function currentRestores(state:EditState,owner:string,id:ControlId):Restore[]{
 // Restoration only removes touch strokes from this edit, never facial controls.
 return [];
}
export function effectWeight(point:Point,restores:Restore[]):number {
 let weight=1;for(const r of restores){weight=Math.min(weight,restoreWeight(point,r));if(!weight)break;}return weight;
}
