import test from "node:test";
import assert from "node:assert/strict";
import { boundPhotoView, photoPreviewScale, photoScaleLimit, zoomPhotoAt } from "./photo-viewport";

test("off-center pinch keeps the same original pixel under the fingers", () => {
  const view = { scale: .2, x: -100, y: -80 }, anchor = { x: 80, y: 120 };
  const next = zoomPhotoAt(view, anchor, .7);
  assert.ok(Math.abs((anchor.x - next.x) / next.scale - (anchor.x - view.x) / view.scale) < 1e-9);
  assert.ok(Math.abs((anchor.y - next.y) / next.scale - (anchor.y - view.y) / view.scale) < 1e-9);
});

test("panning cannot uncover an edge; smaller dimensions stay centered", () => {
  const image = { width: 200, height: 600 }, viewport = { width: 400, height: 500 };
  assert.deepEqual(boundPhotoView({ scale: 1, x: 900, y: 900 }, image, viewport), { scale: 1, x: 100, y: 0 });
  assert.deepEqual(boundPhotoView({ scale: 1, x: -900, y: -900 }, image, viewport), { scale: 1, x: 100, y: -100 });
  assert.deepEqual(boundPhotoView({ scale: 2, x: -900, y: -900 }, image, viewport), { scale: 2, x: 0, y: -700 });
});

test("large originals can exceed 5× while small images avoid excessive enlargement", () => {
  assert.equal(photoScaleLimit(.05), .8);
  assert.equal(photoScaleLimit(.2), 2);
  assert.equal(photoScaleLimit(1), 2);
  assert.equal(photoScaleLimit(3), 3);
});

test("zoom resolves original detail, fits within original resolution and preserves overview quality", () => {
  const image = { width: 4000, height: 6000 };
  assert.equal(photoPreviewScale(image, 300, 2), 1600 / 6000);
  assert.equal(photoPreviewScale(image, 1600, 2), .8);
  assert.equal(photoPreviewScale(image, 6400, 3), 1);
});
