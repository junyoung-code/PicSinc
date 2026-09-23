import sharp from "sharp";
import type { CompositionInput } from "@/core/contracts";

const PREVIEW_MAX_DIMENSION = 1200;

export type ReadCompositionAsset = (assetId: string) => Promise<Buffer>;

export interface CompositionBuffers {
  png: Buffer;
  previewPng: Buffer;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
  unassignedOverlapPixels: number;
}

interface DecodedPhoto {
  pixels: Buffer;
  width: number;
  height: number;
}

interface DecodedMask {
  selected: Uint8Array;
  width: number;
  height: number;
}

interface PixelSource {
  assetId: string;
  photo: DecodedPhoto;
}

/** A request error that an API route can safely turn into a 400 response. */
export class CompositionError extends Error {}

/**
 * Produces a fresh sRGB PNG from the stored original, edits, and masks.
 * The caller owns authorization and resolves only session-scoped asset IDs.
 */
export async function composePhoto(input: CompositionInput, readAsset: ReadCompositionAsset): Promise<CompositionBuffers> {
  assertInput(input);

  const original = await decodePhoto(await read(readAsset, input.originalAssetId), "원본 사진");
  const selections = await Promise.all(input.selections.map(async (selection) => ({
    ...selection,
    photo: await decodePhoto(await read(readAsset, selection.editedAssetId), "보정본"),
    mask: await decodeMask(await read(readAsset, selection.maskAssetId), "개인 선택 영역"),
  })));

  for (const selection of selections) assertSize(selection.photo, original, "보정본");
  for (const selection of selections) assertMaskSize(selection.mask, original, "개인 선택 영역");

  const photoByEdit = new Map<string, DecodedPhoto>(selections.map((selection) => [selection.editedAssetId, selection.photo]));
  const assignments = await Promise.all(input.overlapAssignments.map(async (assignment) => {
    let photo = photoByEdit.get(assignment.editedAssetId);
    if (!photo) {
      photo = await decodePhoto(await read(readAsset, assignment.editedAssetId), "공동 지정 보정본");
      assertSize(photo, original, "공동 지정 보정본");
      photoByEdit.set(assignment.editedAssetId, photo);
    }
    const mask = await decodeMask(await read(readAsset, assignment.maskAssetId), "공동 지정 영역");
    assertMaskSize(mask, original, "공동 지정 영역");
    return { ...assignment, mask, photo };
  }));
  assertAssignmentsDoNotOverlap(assignments, original.width * original.height);

  const sourceByEdit = new Map([...photoByEdit].map(([assetId, photo]) => [assetId, { assetId, photo }]));
  const pixels = original.width * original.height;
  const sourceByPixel = new Array<PixelSource | undefined>(pixels);
  let unassignedOverlapPixels = 0;

  for (let pixel = 0; pixel < pixels; pixel++) {
    const owners = selections.filter((selection) => selection.mask.selected[pixel]);
    if (owners.length === 0) continue;
    if (owners.length === 1) {
      sourceByPixel[pixel] = sourceByEdit.get(owners[0].editedAssetId);
      continue;
    }

    // A valid shared assignment wins only inside the current, real overlap.
    const assigned = assignments.find((assignment) => assignment.mask.selected[pixel]);
    if (assigned) {
      sourceByPixel[pixel] = sourceByEdit.get(assigned.editedAssetId);
      continue;
    }

    unassignedOverlapPixels++;
    const fallback = owners.sort((left, right) => left.participantId.localeCompare(right.participantId) || left.editedAssetId.localeCompare(right.editedAssetId))[0];
    sourceByPixel[pixel] = sourceByEdit.get(fallback.editedAssetId);
  }

  const output = Buffer.from(original.pixels);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const source = sourceByPixel[pixel];
    if (!source) continue;
    const neighbours = differentNeighbourSources(sourceByPixel, pixel, original.width, original.height);
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel++) {
      const own = source.photo.pixels[offset + channel];
      // Only in-bounds, unselected neighbours contribute original pixels. The image
      // edge is not a seam, so a complete selection keeps its edit to the edge.
      const adjacent = neighbours.map((neighbour) => neighbour ? neighbour.photo.pixels[offset + channel] : original.pixels[offset + channel]);
      output[offset + channel] = adjacent.length === 0 ? own : Math.round((own + adjacent.reduce((sum, value) => sum + value, 0)) / (adjacent.length + 1));
    }
  }

  const png = await sharp(output, { raw: { width: original.width, height: original.height, channels: 4 } })
    .png({ palette: false })
    .toBuffer();
  const { data: previewPng, info: preview } = await sharp(output, { raw: { width: original.width, height: original.height, channels: 4 } })
    .resize({ width: PREVIEW_MAX_DIMENSION, height: PREVIEW_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .png({ palette: false })
    .toBuffer({ resolveWithObject: true });

  return { png, previewPng, width: original.width, height: original.height, previewWidth: preview.width, previewHeight: preview.height, unassignedOverlapPixels };
}

function assertInput(input: CompositionInput) {
  const editedIds = new Set<string>();
  for (const selection of input.selections) {
    if (!selection.participantId || !selection.editedAssetId || !selection.maskAssetId) throw new CompositionError("개인 선택 정보가 올바르지 않습니다.");
    if (editedIds.has(selection.editedAssetId)) throw new CompositionError("같은 보정본을 두 개인 선택에 사용할 수 없습니다.");
    editedIds.add(selection.editedAssetId);
  }
  for (const assignment of input.overlapAssignments) {
    if (!assignment.editedAssetId || !assignment.maskAssetId) throw new CompositionError("공동 지정 정보가 올바르지 않습니다.");
  }
}

async function read(readAsset: ReadCompositionAsset, id: string) {
  try {
    return await readAsset(id);
  } catch {
    throw new CompositionError(`파일을 읽을 수 없습니다: ${id}`);
  }
}

async function decodePhoto(bytes: Buffer, label: string): Promise<DecodedPhoto> {
  try {
    const { data, info } = await sharp(bytes, { failOn: "error" }).rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) throw new Error("missing dimensions");
    return { pixels: data, width: info.width, height: info.height };
  } catch {
    throw new CompositionError(`${label}을 읽을 수 없습니다.`);
  }
}

async function decodeMask(bytes: Buffer, label: string): Promise<DecodedMask> {
  try {
    const source = sharp(bytes, { failOn: "error" }).rotate();
    const metadata = await source.metadata();
    if (metadata.format !== "png") throw new Error("not png");
    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const selected = new Uint8Array(info.width * info.height);
    for (let offset = 0, pixel = 0; offset < data.length; offset += info.channels, pixel++) {
      if (data[offset + 3] !== 255 || data[offset] !== data[offset + 1] || data[offset] !== data[offset + 2]) throw new Error("not opaque grayscale");
      selected[pixel] = data[offset] === 0 ? 0 : 1;
    }
    return { selected, width: info.width, height: info.height };
  } catch {
    throw new CompositionError(`${label}은 원본 크기의 불투명한 흑백 PNG여야 합니다.`);
  }
}

function assertSize(candidate: DecodedPhoto, original: DecodedPhoto, label: string) {
  if (candidate.width !== original.width || candidate.height !== original.height) throw new CompositionError(`${label}은 원본과 같은 표시 가로·세로여야 합니다.`);
}

function assertMaskSize(candidate: DecodedMask, original: DecodedPhoto, label: string) {
  if (candidate.width !== original.width || candidate.height !== original.height) throw new CompositionError(`${label}은 원본과 같은 표시 가로·세로여야 합니다.`);
}

function assertAssignmentsDoNotOverlap(assignments: { mask: DecodedMask }[], pixels: number) {
  const used = new Uint8Array(pixels);
  for (const assignment of assignments) for (let pixel = 0; pixel < pixels; pixel++) {
    if (!assignment.mask.selected[pixel]) continue;
    if (used[pixel]) throw new CompositionError("공동 지정 영역끼리는 겹칠 수 없습니다.");
    used[pixel] = 1;
  }
}

function differentNeighbourSources(sourceByPixel: (PixelSource | undefined)[], pixel: number, width: number, height: number) {
  const source = sourceByPixel[pixel]!;
  const x = pixel % width;
  const y = Math.floor(pixel / width);
  const neighbours: (PixelSource | undefined)[] = [];
  for (const neighbour of [x > 0 ? pixel - 1 : undefined, x < width - 1 ? pixel + 1 : undefined, y > 0 ? pixel - width : undefined, y < height - 1 ? pixel + width : undefined]) {
    if (neighbour === undefined) continue;
    const candidate = sourceByPixel[neighbour];
    if (!candidate || candidate.assetId !== source.assetId) neighbours.push(candidate);
  }
  return neighbours;
}
