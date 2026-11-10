import { bounds, frame } from "../effects/geometry";
import {eyeContours,irisCircle,scleraWeight} from '../effects/eyes';
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
    for(let side=0;side<2;side++) {
      if(face.landmarks.length<478)continue;
      const points=eyeContours[side].map(i=>f.points[i]),iris=irisCircle(f.points,side),box=bounds(points);
      const x0=Math.max(0,Math.floor(box.x)),y0=Math.max(0,Math.floor(box.y)),x1=Math.min(width,Math.ceil(box.x+box.width)),y1=Math.min(height,Math.ceil(box.y+box.height));
      if(x1<=x0||y1<=y0)continue;
      const pixels=lc.createImageData(x1-x0,y1-y0),feather=Math.max(1,Math.min(box.width,box.height)*.14);
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
        const weight=scleraWeight({x:x+.5,y:y+.5},points,iris,feather),i=((y-y0)*pixels.width+x-x0)*4;
        pixels.data[i]=Math.round(Math.max(0,amount)*2.55*weight);pixels.data[i+3]=weight>0?255:0;
      }
      lc.putImageData(pixels,x0,y0);
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
