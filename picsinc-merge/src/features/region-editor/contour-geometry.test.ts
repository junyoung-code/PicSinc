import test from "node:test";
import assert from "node:assert/strict";
import { editableContours, finishContourGesture, moveContourPoint, signedArea, spacedHandleIndices, traceContours, viewportToImage, zoomAround } from "./contour-geometry";

function fixture() {
  const width = 30, height = 25, mask = new Uint8Array(width * height);
  for (let y = 3; y < 18; y++) for (let x = 3; x < 19; x++) mask[y * width + x] = 1;
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) mask[y * width + x] = 0;
  for (let y = 20; y < 23; y++) for (let x = 24; x < 28; x++) mask[y * width + x] = 1;
  return { width, height, mask };
}
test("contour tracing retains external rings, internal hole, and disconnected component", () => {
  const { width, height, mask } = fixture(); const rings = traceContours(mask, width, height);
  assert.equal(rings.length, 3); assert.equal(rings.filter(ring => signedArea(ring) < 0).length, 1);
  assert.deepEqual(mask, fixture().mask);
});
test("diagonal pixels retain separate boundaries", () => {
  const rings = traceContours(Uint8Array.from([1, 0, 0, 1]), 2, 2);
  assert.equal(rings.length, 2); assert.deepEqual(rings.map(signedArea), [1, 1]);
});
test("moving an outer point preserves hole and disconnected component pixels", () => {
  const { width, height, mask } = fixture(); const ring = editableContours(mask, width, height).find(ring => signedArea(ring) > 100)!;
  const index = ring.findIndex(p => p.x === 19 && p.y === 3);
  const updated = moveContourPoint(mask, width, height, ring, index, { x: 23, y: 3 });
  assert.notDeepEqual(updated, mask);
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) assert.equal(updated[y * width + x], 0);
  for (let y = 20; y < 23; y++) for (let x = 24; x < 28; x++) assert.equal(updated[y * width + x], 1);
  assert.deepEqual(mask, fixture().mask);
});
test("moving a hole point expands the excluded area without rewriting the outer ring", () => {
  const { width, height, mask } = fixture(); const ring = editableContours(mask, width, height).find(ring => signedArea(ring) < 0)!;
  const index = ring.findIndex(p => p.x === 12 && p.y === 8);
  const updated = moveContourPoint(mask, width, height, ring, index, { x: 15, y: 8 });
  assert.equal(updated[8 * width + 13], 0); assert.equal(mask[8 * width + 13], 1);
  assert.equal(updated[3 * width + 3], 1); assert.equal(updated[22 * width + 27], 1);
});
test("unchanged or cancelled point drag preserves exact original mask", () => {
  const { width, height, mask } = fixture(); const ring = editableContours(mask, width, height)[0];
  assert.deepEqual(moveContourPoint(mask, width, height, ring, 0, ring[0]), mask);
  assert.strictEqual(finishContourGesture(mask, width, height, { ring, index: 0, target: { x: 0, y: 0 } }, true), mask);
});
test("zoom retains anchor's original pixel coordinates, independent of viewport offset", () => {
  const view = { scale: 0.2, x: 17, y: 50 }, anchor = { x: 83, y: 96 };
  const before = viewportToImage(anchor, view), zoomed = zoomAround(view, anchor, 1.2);
  assert.deepEqual(viewportToImage(anchor, zoomed), before);
  assert.deepEqual(viewportToImage({ x: 57, y: 70 }, view), { x: 200, y: 100 });
});
test("visible edit handles spread out and reveal more points when zoomed without changing contour data", () => {
  const ring = Array.from({ length: 21 }, (_, index) => ({ x: index * 5, y: 0 }));
  const before = structuredClone(ring);
  const fitted = spacedHandleIndices(ring, 1);
  const zoomed = spacedHandleIndices(ring, 3);
  assert.deepEqual(fitted, [0, 5, 10, 15, 20]);
  assert.ok(zoomed.length > fitted.length);
  assert.deepEqual(ring, before);
});

function curvedFixture() {
  const width = 640, height = 480, mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (((x + 0.5 - 320) / 190) ** 2 + ((y + 0.5 - 240) / 200) ** 2 <= 1) mask[y * width + x] = 1;
  }
  const ring = editableContours(mask, width, height)[0];
  const index = ring.reduce((best, p, i) => p.x > ring[best].x ? i : best, 0);
  return { width, height, mask, ring, index };
}

test("moving a simplified curve inward leaves no fragments on the old boundary", () => {
  const { width, height, mask, ring, index } = curvedFixture();
  const before = mask.slice(), originalPoints = structuredClone(ring);
  const updated = moveContourPoint(mask, width, height, ring, index, { x: ring[index].x - 85, y: ring[index].y });
  assert.equal(traceContours(updated, width, height).length, 1, "old curved edge must not become detached fragments");
  assert.deepEqual(mask, before);
  assert.deepEqual(ring, originalPoints, "calculating a mask does not commit the handles");
  for (let y = 0; y < height; y++) for (let x = 0; x < 400; x++) assert.equal(updated[y * width + x], before[y * width + x]);
});

test("committed point drags keep the same handles across repeated inward and outward moves", () => {
  const { width, height, mask, ring, index } = curvedFixture();
  const originalPoints = structuredClone(ring), old = { ...ring[index] };
  let current: Uint8Array = mask;
  for (const offset of [-85, -40, 30, -65]) {
    const target = { x: old.x + offset, y: old.y };
    current = finishContourGesture(current, width, height, { ring, index, target }, false);
    assert.equal(ring.length, originalPoints.length);
    assert.deepEqual(ring[index], target);
    assert.equal(traceContours(current, width, height).length, 1);
    ring.forEach((p, i) => { if (i !== index) assert.deepEqual(p, originalPoints[i]); });
  }
  const savedPoints = structuredClone(ring);
  assert.strictEqual(finishContourGesture(current, width, height, { ring, index, target: old }, true), current);
  assert.deepEqual(ring, savedPoints, "cancelled gestures must not move handles");
});

test("successive neighboring handles remain editable across the contour closure", () => {
  const { width, height, mask, ring } = curvedFixture();
  const count = ring.length;
  let current: Uint8Array = mask;
  for (const index of [0, count - 1, 1, 0]) {
    const target = { x: ring[index].x, y: ring[index].y + 8 };
    current = finishContourGesture(current, width, height, { ring, index, target }, false);
    assert.equal(ring.length, count);
    assert.deepEqual(ring[index], target);
    assert.equal(traceContours(current, width, height).length, 1);
  }
});
