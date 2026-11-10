export function encodedSize(bytes:Uint8Array,type:string):{width:number;height:number}{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(type==="image/png" && bytes.length>=24 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && [73,72,68,82].every((v,i)=>bytes[i+12]===v)) return {width:view.getUint32(16),height:view.getUint32(20)};
 if(type==="image/jpeg" && bytes[0]===255&&bytes[1]===216){
  let i=2;
  while(i+3<bytes.length){
   if(bytes[i++]!==255)break;while(bytes[i]===255)i++;if(i>=bytes.length)break;const marker=bytes[i++];
   if(marker===217||marker===218)break;
   if(marker===1||(marker>=208&&marker<=215))continue;
   if(i+2>bytes.length)break;const size=view.getUint16(i);if(size<2||i+size>bytes.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=8) return {width:view.getUint16(i+5),height:view.getUint16(i+3)};
   i+=size;
  }
 }
 throw new Error("JPEG 또는 PNG 사진의 크기를 읽지 못했어요. 파일을 확인해주세요.");
}
export const MAX_PIXELS=30_000_000;
export function validateDimensions(width:number,height:number):void {
 if(width<1||height<1)throw new Error("사진 크기가 올바르지 않아요.");
 if(width*height>MAX_PIXELS||Math.max(width,height)>8192)throw new Error("사진 보정은 3,000만 픽셀·한 변 8,192px까지 지원해요. 자동 축소하지 않으므로 더 작은 사진을 직접 선택해주세요.");
}
