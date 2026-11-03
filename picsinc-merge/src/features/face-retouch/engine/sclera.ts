import { eyeLoops, frame } from "../effects/geometry";
import { faceArea } from "./field";
import { faceEffectAmount, type EditState, type Face } from "../state/model";
// A conservative contour/iris/color mask, not semantic segmentation. Dark eyes,
// closed eyes and occlusions intentionally receive little or no correction.
export function scleraMask(faces:Face[],state:EditState,width:number,height:number):HTMLCanvasElement {
  const canvas=document.createElement("canvas"); canvas.width=width;canvas.height=height;
  if(!faces.some(f=>state.settings[f.id]?.eyeRedness)){canvas.width=1;canvas.height=1;return canvas;}
  const ctx=canvas.getContext("2d")!;
  for(const face of faces) {
    const amount=faceEffectAmount(state.settings[face.id]?.eyeRedness ?? 0);
    if(amount===0) continue;
    const f=frame(face,width,height);
    const layer=document.createElement("canvas");layer.width=width;layer.height=height;
    const lc=layer.getContext("2d")!;
    lc.fillStyle=`rgb(${Math.round(Math.max(0,amount)*2.55)},0,0)`;
    for(let side=0;side<2;side++) {
      const points=eyeLoops[side].map(i=>f.points[i]);
      lc.beginPath();points.forEach((p,i)=>i?lc.lineTo(p.x,p.y):lc.moveTo(p.x,p.y));lc.closePath();lc.fill();
      const start=side===0?468:473;
      const iris=face.landmarks.length>=478?f.points[start]:null;
      if(iris) {
        const radius=Math.max(...[1,2,3,4].map(k=>Math.hypot(f.points[start+k].x-iris.x,f.points[start+k].y-iris.y)))*1.3;
        lc.globalCompositeOperation="destination-out";lc.beginPath();lc.arc(iris.x,iris.y,radius,0,Math.PI*2);lc.fill();lc.globalCompositeOperation="source-over";
      } else { lc.clearRect(0,0,width,height); }
    }
    lc.globalCompositeOperation="destination-out";
    for(const other of faces)if(other.id!==face.id){
      const area=faceArea(other,width,height);
      // Include a small antialias margin so sampling stays clear inside the
      // protected ellipse, including detections excluded from editing.
      lc.beginPath();lc.ellipse(area.center.x,area.center.y,area.rx*1.02,area.ry*1.02,area.angle,0,Math.PI*2);lc.fill();
    }
    ctx.drawImage(layer,0,0);
    layer.width=1;layer.height=1;
  }
  return canvas;
}
