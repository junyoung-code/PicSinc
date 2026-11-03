import type { Face } from "../state/model";

export async function loadRoomMask(url: string, width: number, height: number) {
  const image = new Image(); image.crossOrigin = "anonymous"; image.src = url; await image.decode();
  if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error("편집 영역과 사진의 크기가 다릅니다.");
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  const contains = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && pixels[(Math.floor(y) * width + Math.floor(x)) * 4] >= 128;
  const outline = document.createElement("canvas"); outline.width = width; outline.height = height;
  const drawing = outline.getContext("2d")!, edges = drawing.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (contains(x, y) && (!contains(x-1,y) || !contains(x+1,y) || !contains(x,y-1) || !contains(x,y+1))) {
    const i = (y * width + x) * 4; edges.data.set([255, 100, 145, 255], i);
  }
  drawing.putImageData(edges, 0, 0);
  return { canvas, outline: outline.toDataURL(), owns: (face: Face) => contains(face.landmarks[1].x * width, face.landmarks[1].y * height) };
}
