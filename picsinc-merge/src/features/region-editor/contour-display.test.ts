import test from "node:test";
import assert from "node:assert/strict";
import { editableContours, visibleContours, smoothedDisplayContour, traceContours, findContourHandle, finishContourGesture, signedArea } from "./contour-geometry";
import { paintBrush } from "./mask-geometry";

function fixture() {
  const width = 200, height = 160, mask = new Uint8Array(width * height);
  function rect(x: number, y: number, w: number, h: number, value = 1) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) mask[row * width + col] = value;
  }
  rect(10, 10, 100, 100); // Display threshold: 50 px².
  rect(30, 30, 1, 1, 0); rect(60, 60, 10, 10, 0);
  rect(130, 10, 1, 1); rect(140, 30, 7, 7); rect(160, 60, 5, 10);
  return { width, height, mask };
}

test("display hides tiny holes/islands, retains large holes and exact threshold without changing masks or rings", () => {
  const { width, height, mask } = fixture(), before = mask.slice();
  const rings = editableContours(mask, width, height), original = structuredClone(rings);
  assert.deepEqual(visibleContours(rings).map(signedArea).sort((a, b) => a - b), [-100, 50, 10000]);
  assert.deepEqual(mask, before); assert.deepEqual(rings, original);
  assert.ok(visibleContours(rings).every(ring => rings.includes(ring)));
});

test("empty masks and tiny main outlines remain usable; minimum cutoff is 4 px²", () => {
  assert.deepEqual(visibleContours([]), []);
  const square = (size: number, x = 0) => [{ x, y: 0 }, { x: x + size, y: 0 }, { x: x + size, y: size }, { x, y: size }];
  const main = square(1);
  assert.deepEqual(visibleContours([main]), [main]);
  assert.deepEqual(visibleContours([square(10), square(2, 20), square(1, 30)]).map(signedArea), [100, 4]);
});

test("threshold uses the exact pixel boundary before handle simplification", () => {
  const width = 220, height = 150, mask = new Uint8Array(width * height);
  for (let y = 10; y < 110; y++) for (let x = 10; x < 120; x++) mask[y * width + x] = 1;
  for (let y = 0; y < 10; y++) for (let x = 0; x <= y; x++) mask[(y + 30) * width + x + 170] = 1;
  const rings = editableContours(mask, width, height);
  assert.ok(Math.abs(signedArea(rings[1])) < 55, "fixture must simplify below the 55 px² cutoff");
  assert.equal(visibleContours(rings).length, 2);
});

test("hidden handles cannot be hit at any zoom; visible handle indices retain their source ring", () => {
  const { width, height, mask } = fixture(), rings = editableContours(mask, width, height);
  const hidden = rings.find(r => r[0].x === 130)!;
  for (const scale of [1, 4, 8]) {
    const tinyHit = findContourHandle(rings, { x: 130, y: 10 }, scale);
    assert.notStrictEqual(tinyHit?.ring, hidden);
    if (scale >= 4) assert.equal(tinyHit, null); // At 1x a main-outline handle is within 22 screen pixels.
    const hit = findContourHandle(rings, { x: 160, y: 60 }, scale);
    assert.ok(hit); assert.equal(hit.ring[hit.index].x, 160);
    assert.ok(rings.includes(hit.ring));
  }
});

test("drag preview/cancel preserves visibility; committed edits refresh cached areas", () => {
  const { width, height, mask } = fixture(), rings = editableContours(mask, width, height);
  const ring = rings.find(r => signedArea(r) === 50)!, index = ring.findIndex(p => p.x === 165 && p.y === 60);
  const pending = { ring, index, target: { x: 160, y: 60 } };
  assert.ok(visibleContours(rings).includes(ring));
  assert.strictEqual(finishContourGesture(mask, width, height, pending, true), mask);
  assert.ok(visibleContours(rings).includes(ring));
  const changed = finishContourGesture(mask, width, height, pending, false);
  assert.notDeepEqual(changed, mask); assert.ok(!visibleContours(rings).includes(ring));
  assert.equal(visibleContours(editableContours(mask, width, height)).length, 3, "undo restores the original display");
  assert.equal(visibleContours(editableContours(changed, width, height)).length, 2, "redo restores the changed display");
});

test("brush still edits hidden pixels and refreshes their visibility", () => {
  const { width, height, mask } = fixture();
  paintBrush(mask, width, height, { x: 130, y: 10 }, { x: 130, y: 10 }, 5, 1);
  assert.equal(visibleContours(editableContours(mask, width, height)).length, 4);
  paintBrush(mask, width, height, { x: 130, y: 10 }, { x: 130, y: 10 }, 6, 0);
  assert.equal(mask[10 * width + 130], 0);
  assert.equal(visibleContours(editableContours(mask, width, height)).length, 3);
});

test("colored outline smoothing stays within 8 source pixels and never edits mask or handles", () => {
  const { width, height, mask } = fixture();
  for (let y = 60; y < 80; y++) for (let x = 110; x < 130; x++) mask[y * width + x] = 1;
  const saved = mask.slice();
  const handles = editableContours(mask, width, height);
  const main = handles.find(ring => signedArea(ring) > 1000)!;
  const originalHandles = structuredClone(main);
  const raw = traceContours(mask, width, height).find(ring => signedArea(ring) > 1000)!;
  const display = smoothedDisplayContour(main);
  assert.equal(display.length, raw.length, "the display follows the exact unsimplified boundary");
  assert.ok(display.some((point, index) => Math.hypot(point.x - raw[index].x, point.y - raw[index].y) > 1));
  assert.ok(display.every((point, index) => Math.hypot(point.x - raw[index].x, point.y - raw[index].y) <= 8.000001));
  assert.strictEqual(smoothedDisplayContour(main), display, "pan and zoom reuse the computed line");
  assert.deepEqual(main, originalHandles);
  assert.deepEqual(mask, saved);
  const index = 1;
  finishContourGesture(mask, width, height, { ring: main, index, target: { x: main[index].x + 5, y: main[index].y } }, false);
  assert.notStrictEqual(smoothedDisplayContour(main), display, "an edited boundary invalidates the cached line");
});
