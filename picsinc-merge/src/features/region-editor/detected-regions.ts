export interface DetectedRegions {
  width: number;
  height: number;
  previewPngBase64: string;
  regions: { id: string; box: { x: number; y: number; width: number; height: number }; maskPngBase64: string }[];
}
