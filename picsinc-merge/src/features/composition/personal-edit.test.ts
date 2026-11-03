import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { CompositionError, intersectAuthorizedMask, isolatePersonalEdit } from "./compose";

async function mask(values: number[], width = values.length) {
  return sharp(Buffer.from(values), { raw: { width, height: values.length / width, channels: 1 } }).png().toBuffer();
}

async function photo(values: number[], width = values.length / 4) {
  return sharp(Buffer.from(values), { raw: { width, height: values.length / 4 / width, channels: 4 } }).png().toBuffer();
}

async function pixels(bytes: Buffer) {
  return sharp(bytes).ensureAlpha().raw().toBuffer();
}

const originalPixels = [11, 22, 33, 255, 44, 55, 66, 127, 77, 88, 99, 255, 123, 145, 167, 255];
const editedPixels = [200, 10, 30, 255, 40, 210, 60, 255, 70, 80, 220, 100, 230, 140, 160, 255];

test("personal save preserves every channel outside the mask, selects exact edit pixels inside, and leaves inputs immutable", async () => {
  const input = { original: await photo(originalPixels, 2), edited: await photo(editedPixels, 2), mask: await mask([0, 1, 127, 0], 2) };
  const snapshots = Object.values(input).map((bytes) => Buffer.from(bytes));
  const output = await isolatePersonalEdit(input);
  assert.deepEqual(await pixels(output), Buffer.from([
    ...originalPixels.slice(0, 4), ...editedPixels.slice(4, 12), ...originalPixels.slice(12),
  ]));
  const metadata = await sharp(output).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height, metadata.isPalette], ["png", 2, 2, false]);
  Object.values(input).forEach((bytes, index) => assert.deepEqual(bytes, snapshots[index]));
});

test("an all-zero personal mask returns original pixels including alpha", async () => {
  const output = await isolatePersonalEdit({ original: await photo(originalPixels), edited: await photo(editedPixels), mask: await mask([0, 0, 0, 0]) });
  assert.deepEqual(await pixels(output), Buffer.from(originalPixels));
});

test("personal save rejects either image or mask dimensions that differ from the original", async () => {
  const original = await photo(originalPixels, 2);
  const edited = await photo(editedPixels, 2);
  await assert.rejects(isolatePersonalEdit({ original, edited: await photo(editedPixels), mask: await mask([255, 255, 255, 255], 2) }), CompositionError);
  await assert.rejects(isolatePersonalEdit({ original, edited, mask: await mask([255, 255, 255, 255]) }), CompositionError);
});

test("authorized union clips forged selection pixels and does not add authorized but unselected pixels", async () => {
  const selection = await mask([255, 0, 255, 255, 255, 0]);
  const authorizedMasks = [await mask([1, 255, 0, 0, 0, 0]), await mask([0, 0, 255, 255, 0, 0])];
  const snapshots = [selection, ...authorizedMasks].map((bytes) => Buffer.from(bytes));
  const bounded = await intersectAuthorizedMask({ mask: selection, authorizedMasks });
  assert.deepEqual(await sharp(bounded).greyscale().raw().toBuffer(), Buffer.from([255, 0, 255, 255, 0, 0]));
  [selection, ...authorizedMasks].forEach((bytes, index) => assert.deepEqual(bytes, snapshots[index]));
});

test("no authorized regions denies every selected pixel", async () => {
  const bounded = await intersectAuthorizedMask({ mask: await mask([255, 255]), authorizedMasks: [] });
  assert.deepEqual(await sharp(bounded).greyscale().raw().toBuffer(), Buffer.from([0, 0]));
});

test("authorized intersection rejects mismatched region size", async () => {
  await assert.rejects(intersectAuthorizedMask({ mask: await mask([255, 255]), authorizedMasks: [await mask([255])] }), CompositionError);
});

test("mask validation rejects color, transparency, and non-PNG inputs", async () => {
  const valid = await mask([255]);
  for (const invalid of [await photo([255, 0, 0, 255]), await photo([255, 255, 255, 128]), await sharp(valid).jpeg().toBuffer()]) {
    await assert.rejects(intersectAuthorizedMask({ mask: invalid, authorizedMasks: [valid] }), CompositionError);
    await assert.rejects(intersectAuthorizedMask({ mask: valid, authorizedMasks: [invalid] }), CompositionError);
  }
});
