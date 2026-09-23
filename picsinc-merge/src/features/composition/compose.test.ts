import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { CompositionInput } from "@/core/contracts";
import { CompositionError, composePhoto } from "./compose";

const original = "original";
const input = (selections: CompositionInput["selections"], overlapAssignments: CompositionInput["overlapAssignments"] = []): CompositionInput => ({ sessionId: "session", version: 3, originalAssetId: original, selections, overlapAssignments });
const selection = (participantId: string, editedAssetId: string, maskAssetId: string) => ({ participantId, editedAssetId, maskAssetId });
const assignment = (editedAssetId: string, maskAssetId: string) => ({ editedAssetId, maskAssetId });

async function solid(width: number, height: number, colour: string, orientation?: number) {
  let image = sharp({ create: { width, height, channels: 4, background: colour } });
  if (orientation) image = image.withMetadata({ orientation });
  return image.png().toBuffer();
}
async function mask(width: number, height: number, selected: number[]) {
  const data = Buffer.alloc(width * height);
  for (const pixel of selected) data[pixel] = 255;
  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer();
}
async function rgba(bytes: Buffer) {
  return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function reader(assets: Record<string, Buffer>) { return async (id: string) => { const asset = assets[id]; if (!asset) throw new Error("missing"); return asset; }; }
function pixel(data: Buffer, width: number, x: number, y: number) { return [...data.subarray((y * width + x) * 4, (y * width + x + 1) * 4)]; }

test("keeps unselected pixels, uses the edit inside, and feathers only the selected boundary", async () => {
  const assets = { [original]: await solid(5, 5, "#0a141e"), editA: await solid(5, 5, "#c86432"), maskA: await mask(5, 5, [6, 7, 8, 11, 12, 13, 16, 17, 18]) };
  const result = await composePhoto(input([selection("a", "editA", "maskA")]), reader(assets));
  const decoded = await rgba(result.png);
  assert.deepEqual(pixel(decoded.data, 5, 0, 0), [10, 20, 30, 255]);
  assert.deepEqual(pixel(decoded.data, 5, 2, 2), [200, 100, 50, 255]);
  assert.notDeepEqual(pixel(decoded.data, 5, 1, 1), [200, 100, 50, 255]);
  assert.deepEqual(pixel(decoded.data, 5, 0, 1), [10, 20, 30, 255]);
});

test("softens only a boundary between decided sources and keeps a full selection sharp to the image edge", async () => {
  const allA = Array.from({ length: 40 }, (_, index) => index).filter((index) => index % 8 < 4);
  const allB = Array.from({ length: 40 }, (_, index) => index).filter((index) => index % 8 >= 4);
  const assets = { [original]: await solid(8, 5, "#0000ff"), editA: await solid(8, 5, "#ff0000"), editB: await solid(8, 5, "#00ff00"), maskA: await mask(8, 5, allA), maskB: await mask(8, 5, allB), full: await mask(8, 5, Array.from({ length: 40 }, (_, index) => index)) };
  const split = await rgba((await composePhoto(input([selection("a", "editA", "maskA"), selection("b", "editB", "maskB")]), reader(assets))).png);
  assert.deepEqual(pixel(split.data, 8, 2, 2), [255, 0, 0, 255]);
  assert.deepEqual(pixel(split.data, 8, 3, 2), [128, 128, 0, 255]);
  assert.deepEqual(pixel(split.data, 8, 4, 2), [128, 128, 0, 255]);
  assert.deepEqual(pixel(split.data, 8, 5, 2), [0, 255, 0, 255]);
  const full = await rgba((await composePhoto(input([selection("a", "editA", "full")]), reader(assets))).png);
  assert.deepEqual(pixel(full.data, 8, 0, 0), [255, 0, 0, 255]);
});

test("uses a valid shared overlap choice and falls back to the first participant ID when unspecified", async () => {
  const assets = { [original]: await solid(5, 5, "#000000"), editA: await solid(5, 5, "#ff0000"), editB: await solid(5, 5, "#00ff00"), maskA: await mask(5, 5, [6, 7, 8, 11, 12, 13, 16, 17, 18]), maskB: await mask(5, 5, [7, 8, 9, 12, 13, 14, 17, 18, 19]), sharedB: await mask(5, 5, [0, 7, 8, 12, 13, 17, 18]) };
  const unspecified = await composePhoto(input([selection("zeta", "editA", "maskA"), selection("alpha", "editB", "maskB")]), reader(assets));
  const fallback = await rgba(unspecified.png);
  assert.deepEqual(pixel(fallback.data, 5, 3, 2), [0, 255, 0, 255]);
  assert.equal(unspecified.unassignedOverlapPixels, 6);
  const specified = await composePhoto(input([selection("zeta", "editA", "maskA"), selection("alpha", "editB", "maskB")], [assignment("editA", "sharedB")]), reader(assets));
  const selected = await rgba(specified.png);
  assert.deepEqual(pixel(selected.data, 5, 2, 2), [255, 0, 0, 255]);
  assert.deepEqual(pixel(selected.data, 5, 0, 0), [0, 0, 0, 255]);
  assert.equal(specified.unassignedOverlapPixels, 0);
});

test("allows an uploaded shared-assignment edit that is not a current personal selection", async () => {
  const assets = { [original]: await solid(5, 5, "#000000"), editA: await solid(5, 5, "#000000"), editB: await solid(5, 5, "#000000"), olderEdit: await solid(5, 5, "#0000ff"), maskA: await mask(5, 5, [6, 7, 8, 11, 12, 13, 16, 17, 18]), maskB: await mask(5, 5, [7, 8, 9, 12, 13, 14, 17, 18, 19]), shared: await mask(5, 5, [7, 8, 12, 13]) };
  const result = await rgba((await composePhoto(input([selection("a", "editA", "maskA"), selection("b", "editB", "maskB")], [assignment("olderEdit", "shared")]), reader(assets))).png);
  assert.deepEqual(pixel(result.data, 5, 2, 2), [0, 0, 85, 255]);
});

test("returns original-sized PNG and a bounded preview", async () => {
  const assets = { [original]: await solid(1301, 2, "#112233"), editA: await solid(1301, 2, "#445566"), maskA: await mask(1301, 2, [0, 1300]) };
  const result = await composePhoto(input([selection("a", "editA", "maskA")]), reader(assets));
  assert.deepEqual([result.width, result.height], [1301, 2]);
  assert.deepEqual([result.previewWidth, result.previewHeight], [1200, 2]);
  assert.equal((await sharp(result.png).metadata()).isPalette, false);
});

test("applies EXIF orientation before matching displayed coordinates", async () => {
  const source = await sharp(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255]), { raw: { width: 2, height: 3, channels: 3 } }).withMetadata({ orientation: 6 }).png().toBuffer();
  const edit = await sharp(Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180]), { raw: { width: 2, height: 3, channels: 3 } }).withMetadata({ orientation: 6 }).png().toBuffer();
  const assets = { [original]: source, editA: edit, maskA: await mask(3, 2, [0, 1, 2, 3, 4, 5]) };
  const result = await composePhoto(input([selection("a", "editA", "maskA")]), reader(assets));
  assert.deepEqual([result.width, result.height], [3, 2]);
  const decoded = await rgba(result.png);
  assert.deepEqual(pixel(decoded.data, 3, 0, 0), [130, 140, 150, 255]);
  assert.deepEqual(pixel(decoded.data, 3, 2, 1), [40, 50, 60, 255]);
});

test("is deterministic, does not mutate source buffers, and rejects invalid composition input", async () => {
  const originalBytes = await solid(4, 4, "#0a141e"); const edit = await solid(4, 4, "#c86432"); const editB = await solid(4, 4, "#32c864"); const firstMask = await mask(4, 4, [5, 6, 9, 10]); const secondMask = await mask(4, 4, [5]);
  const assets = { [original]: originalBytes, editA: edit, editB, maskA: firstMask, maskB: firstMask, shortMask: await mask(3, 3, [0]), sharedA: secondMask, sharedB: secondMask };
  const before = { original: Buffer.from(originalBytes), edit: Buffer.from(edit), mask: Buffer.from(firstMask) };
  const first = await composePhoto(input([selection("a", "editA", "maskA")]), reader(assets));
  const second = await composePhoto(input([selection("a", "editA", "maskA")]), reader(assets));
  assert.deepEqual(first.png, second.png);
  assert.deepEqual(originalBytes, before.original);
  assert.deepEqual(edit, before.edit);
  assert.deepEqual(firstMask, before.mask);
  await assert.rejects(() => composePhoto(input([selection("a", "editA", "maskA"), selection("b", "editB", "maskB")], [assignment("editA", "sharedA"), assignment("editB", "sharedB")]), reader(assets)), CompositionError);
  await assert.rejects(() => composePhoto(input([selection("a", "editA", "maskA")], [assignment("missing", "sharedA")]), reader(assets)), CompositionError);
  await assert.rejects(() => composePhoto(input([selection("a", "editA", "shortMask")]), reader(assets)), CompositionError);
});

test("composes four edits from one participant and resolves its overlaps deterministically", async () => {
  const assets: Record<string, Buffer> = { original: await solid(20, 5, "#000000") };
  const colours = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"];
  const choices = [];
  for (let i = 0; i < 4; i++) {
    assets[`edit${i}`] = await solid(20, 5, colours[i]);
    assets[`mask${i}`] = await mask(20, 5, Array.from({ length: 100 }, (_, p) => p).filter(p => Math.floor((p % 20) / 5) === i));
    choices.push(selection("same", `edit${i}`, `mask${i}`));
  }
  const output = await rgba((await composePhoto(input(choices), reader(assets))).png);
  for (let i = 0; i < 4; i++) assert.deepEqual(pixel(output.data, 20, i * 5 + 2, 2), pixel((await rgba(assets[`edit${i}`])).data, 20, i * 5 + 2, 2));
  const overlap = [selection("same", "edit1", "mask0"), selection("same", "edit0", "mask0")];
  const first = await composePhoto(input(overlap), reader(assets));
  const reversed = await composePhoto(input([...overlap].reverse()), reader(assets));
  assert.deepEqual(first.png, reversed.png);
  assert.deepEqual(pixel((await rgba(first.png)).data, 20, 2, 2), [255, 0, 0, 255]);
  const assigned = await composePhoto(input(overlap, [assignment("edit1", "mask0")]), reader(assets));
  assert.deepEqual(pixel((await rgba(assigned.png)).data, 20, 2, 2), [0, 255, 0, 255]);
});
