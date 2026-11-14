import assert from "node:assert/strict";
import test from "node:test";

import { getPhotoDimensions, scaleBoxToPhoto } from "./photoGeometry.js";

test("photo geometry retains decoded image pixels and maps demo fixtures proportionally", () => {
  assert.deepEqual(getPhotoDimensions({ naturalWidth: 3024, naturalHeight: 4032 }), { width: 3024, height: 4032 });
  assert.deepEqual(
    scaleBoxToPhoto({ x: 120, y: 80, width: 240, height: 160 }, { width: 1200, height: 800 }, { width: 3000, height: 4000 }),
    { x: 300, y: 400, width: 600, height: 800 },
  );
});

test("photo geometry preserves landscape, portrait, square, and high-resolution image dimensions", () => {
  const scenarios = [
    { width: 6000, height: 4000 },
    { width: 4000, height: 6000 },
    { width: 4096, height: 4096 },
    { width: 12_000, height: 8_000 },
  ];
  for (const dimensions of scenarios) assert.deepEqual(getPhotoDimensions(dimensions), dimensions);
});

test("photo geometry rejects invalid dimensions and coordinates", () => {
  assert.throws(() => getPhotoDimensions({ width: 0, height: 10 }), /1 이상의 정수/);
  assert.throws(() => scaleBoxToPhoto({ x: 0, y: 0, width: Infinity, height: 10 }, { width: 1, height: 1 }, { width: 1, height: 1 }), /유한한 숫자/);
});
