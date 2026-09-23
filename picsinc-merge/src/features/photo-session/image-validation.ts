import sharp from "sharp";
import { fail } from "./errors";

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;

export interface VerifiedImage { bytes: Buffer; width: number; height: number; contentType: "image/png" | "image/jpeg"; extension: "png" | "jpg"; }
export interface DecodedMask { width: number; height: number; selected: Uint8Array; }

export async function verifyPhoto(file: File, expected?: { width?: number; height?: number }): Promise<VerifiedImage> {
  assertFileSize(file.size);
  if (file.type && !["image/jpeg", "image/png"].includes(file.type)) fail(400, "JPEG 또는 PNG 사진만 올릴 수 있습니다.");
  const verified = await verifyPhotoBytes(Buffer.from(await file.arrayBuffer()), expected);
  if (file.type && verified.contentType !== file.type) fail(400, "사진 형식이 파일 정보와 다릅니다.");
  return verified;
}
export async function verifyPhotoBytes(bytes: Buffer, expected?: { width?: number; height?: number }): Promise<VerifiedImage> {
  assertFileSize(bytes.length);
  const source = sharp(bytes, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
  const metadata = await source.metadata().catch(() => fail(400, "읽을 수 없는 사진 파일입니다."));
  if (!metadata.width || !metadata.height || (metadata.format !== "png" && metadata.format !== "jpeg")) fail(400, "JPEG 또는 PNG 사진만 올릴 수 있습니다.");
  const { info } = await source.clone().raw().toBuffer({ resolveWithObject: true }).catch(() => fail(400, "사진 전체를 읽을 수 없습니다."));
  if ((expected?.width !== undefined && info.width !== expected.width) || (expected?.height !== undefined && info.height !== expected.height)) fail(400, "원본과 같은 가로·세로의 사진이 필요합니다.");
  return { bytes, width: info.width, height: info.height, contentType: metadata.format === "png" ? "image/png" : "image/jpeg", extension: metadata.format === "png" ? "png" : "jpg" };
}
export async function verifyMask(file: File, expected: { width: number; height: number }): Promise<VerifiedImage> {
  assertFileSize(file.size);
  if (file.type && file.type !== "image/png") fail(400, "선택 영역은 PNG여야 합니다.");
  const bytes = Buffer.from(await file.arrayBuffer()); const decoded = await decodeMask(bytes);
  if (decoded.width !== expected.width || decoded.height !== expected.height) fail(400, "선택 영역은 원본과 같은 가로·세로여야 합니다.");
  return { bytes, width: decoded.width, height: decoded.height, contentType: "image/png", extension: "png" };
}
export async function decodeMask(bytes: Buffer): Promise<DecodedMask> {
  assertFileSize(bytes.length);
  const source = sharp(bytes, { failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS }).rotate(); const metadata = await source.metadata().catch(() => fail(400, "읽을 수 없는 선택 영역입니다."));
  if (!metadata.width || !metadata.height || metadata.format !== "png") fail(400, "선택 영역은 PNG여야 합니다.");
  const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true }).catch(() => fail(400, "선택 영역 전체를 읽을 수 없습니다."));
  const selected = new Uint8Array(info.width * info.height);
  for (let offset = 0, pixel = 0; offset < data.length; offset += info.channels, pixel++) { const red = data[offset], green = data[offset + 1], blue = data[offset + 2], alpha = data[offset + 3]; if (alpha !== 255 || red !== green || red !== blue) fail(400, "선택 영역은 불투명한 흑백 PNG여야 합니다."); selected[pixel] = red === 0 ? 0 : 1; }
  return { width: info.width, height: info.height, selected };
}

function assertFileSize(size: number) { if (!size || size > MAX_PHOTO_BYTES) fail(400, "파일은 20MB 이하의 JPEG·PNG여야 합니다."); }
