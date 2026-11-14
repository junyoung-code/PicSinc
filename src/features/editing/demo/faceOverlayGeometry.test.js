import assert from "node:assert/strict";
import test from "node:test";

import { faceHitArea, faceOverlayState, mapFaceBoxToCanvas, overlayZIndex } from "./faceOverlayGeometry.js";

test("face overlay maps every fixture faceBox into the decoded canvas coordinate system", () => {
  for (const count of [1, 3, 10, 16]) {
    const boxes = Array.from({ length: count }, (_, index) => ({ x: index * 10, y: index * 5, width: 20, height: 30 }));
    assert.deepEqual(boxes.map((box) => mapFaceBoxToCanvas(box, { width: 1200, height: 800 }, { width: 3000, height: 2000 })), boxes.map((box) => ({ x: box.x * 2.5, y: box.y * 2.5, width: 50, height: 75 })));
  }
});

test("face overlay keeps a 44 CSS pixel centered hit area while brackets retain the faceBox", () => {
  assert.deepEqual(faceHitArea({ x: 100, y: 100, width: 10, height: 12 }, { width: 1200, height: 800 }, { width: 600, height: 400 }), { x: 61, y: 62, width: 88, height: 88 });
  assert.deepEqual(faceHitArea({ x: 100, y: 100, width: 120, height: 80 }, { width: 1200, height: 800 }, { width: 1200, height: 800 }), { x: 100, y: 100, width: 120, height: 80 });
});

test("face overlay state and stacking make active faces deterministic above overlaps", () => {
  const person = { claimState: "mine" };
  assert.equal(faceOverlayState({ person, revision: { status: "accepted" } }), "accepted");
  assert.equal(faceOverlayState({ person, selected: true }), "selected");
  assert.equal(faceOverlayState({ person, selected: true, active: true }), "active");
  assert.equal(faceOverlayState({ person: { claimState: "claimed" } }), "claimed");
  assert.ok(overlayZIndex("active", 0) > overlayZIndex("selected", 16));
  assert.ok(overlayZIndex("available", 16) > overlayZIndex("claimed", 16));
});
