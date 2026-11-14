import assert from "node:assert/strict";
import test from "node:test";
import { faceTargetBox } from "./face-target";

const px = (b: { x: number; y: number; width: number; height: number }, w: number, h: number) => ({ x: b.x * w, y: b.y * h, width: b.width * w, height: b.height * h });

test("a face-shaped box is kept as it is", () => {
  assert.deepEqual(faceTargetBox({ x: .2, y: .2, width: .3, height: .4 }, 1000, 1000), { x: .2, y: .2, width: .3, height: .4 });
});

test("a narrow side-face box widens to 3:4 around its centre", () => {
  const out = px(faceTargetBox({ x: .45, y: .2, width: .1, height: .4 }, 1000, 1000), 1000, 1000);
  assert.ok(Math.abs(out.width - 300) < 1e-9 && Math.abs(out.height - 400) < 1e-9);
  assert.ok(Math.abs(out.x + out.width / 2 - 500) < 1e-9);
});

test("a flat box grows to at least square, and stays inside the photo", () => {
  const out = px(faceTargetBox({ x: .9, y: .95, width: .1, height: .02 }, 1000, 1000), 1000, 1000);
  assert.ok(out.height >= out.width - 1e-9);
  assert.ok(out.x >= 0 && out.y >= 0 && out.x + out.width <= 1000 + 1e-9 && out.y + out.height <= 1000 + 1e-9);
});

test("the ratio is measured in pixels, not photo fractions", () => {
  // In a wide 2000x500 photo, 0.1 x 0.4 is 200x200 px: already square, so unchanged.
  assert.deepEqual(faceTargetBox({ x: .4, y: .3, width: .1, height: .4 }, 2000, 500), { x: .4, y: .3, width: .1, height: .4 });
});
