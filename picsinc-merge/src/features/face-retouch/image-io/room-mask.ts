import type { Face } from "../state/model";
import type { DetectionRegion } from "../detection/client";
import type { DetectedRegions } from "@/features/region-editor/detected-regions";

export async function loadRoomMask(url: string, width: number, height: number, regions: DetectedRegions['regions'] = []) {
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
  const detectionRegions: DetectionRegion[] = [];
  for (const region of regions) {
    const source = new Image(); source.src = `data:image/png;base64,${region.maskPngBase64}`; await source.decode();
    if (source.naturalWidth !== width || source.naturalHeight !== height) throw new Error("검출 영역과 사진의 크기가 다릅니다.");
    const x = Math.max(0, Math.floor(region.box.x)), y = Math.max(0, Math.floor(region.box.y));
    const w = Math.min(width, Math.ceil(region.box.x + region.box.width)) - x;
    const h = Math.min(height, Math.ceil(region.box.y + region.box.height)) - y;
    if (w <= 0 || h <= 0) continue;
    const crop = document.createElement("canvas"); crop.width = w; crop.height = h;
    const ctx = crop.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    // The Worker needs only the rectangle. The frozen mask stays in this editor.
    for (let i = 0; i < w * h; i++) {
      if (rgba[i * 4] >= 128 && rgba[i * 4 + 3] > 0 && contains(x + i % w, y + Math.floor(i / w))) {
        detectionRegions.push({ x, y, width: w, height: h });
        break;
      }
    }
    crop.width = crop.height = 0; source.src = "";
  }
  return { canvas, detectionRegions, outline: outline.toDataURL(), owns: (face: Face) => contains(face.landmarks[1].x * width, face.landmarks[1].y * height) };
}
