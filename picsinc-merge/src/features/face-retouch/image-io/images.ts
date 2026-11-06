import {encodedSize,validateDimensions} from "./headers";
export async function decodePhoto(file:File):Promise<ImageBitmap> {
  if(!["image/jpeg","image/png"].includes(file.type)) throw new Error("JPEG 또는 PNG 사진을 선택해주세요.");
  if(file.size>20*1024*1024) throw new Error("20MB 이하 사진을 선택해주세요.");
  const size=encodedSize(new Uint8Array(await file.arrayBuffer()),file.type);
  validateDimensions(size.width,size.height);
  let bitmap:ImageBitmap;
  try {bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});}catch {throw new Error("사진을 읽지 못했어요. JPEG 또는 PNG 파일을 확인해주세요.");}
  if(!((bitmap.width===size.width&&bitmap.height===size.height)||(bitmap.width===size.height&&bitmap.height===size.width))) {bitmap.close();throw new Error("이 브라우저에서 원본 크기로 사진을 읽지 못했어요. 더 작은 사진이나 다른 기기를 선택해주세요.");}
  return bitmap;
}
export function png(canvas:HTMLCanvasElement):Promise<Blob> {
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("PNG를 저장하지 못했어요. 원본과 설정은 유지했어요.")),"image/png"));
}
export function download(blob:Blob,name:string) {
  const a=document.createElement("a");
  let url:string|undefined,started=false;
  try {
    url=URL.createObjectURL(blob);a.href=url;a.download=name;
    document.body.appendChild(a);a.click();started=true;
  } catch {
    throw new Error("다운로드를 시작하지 못했어요. 원본과 설정은 유지했어요. PNG 저장을 다시 눌러주세요.");
  } finally {
    a.remove();
    if(url){
      const downloadUrl=url;
      if(started)setTimeout(()=>URL.revokeObjectURL(downloadUrl),60_000);
      else URL.revokeObjectURL(downloadUrl);
    }
  }
}
