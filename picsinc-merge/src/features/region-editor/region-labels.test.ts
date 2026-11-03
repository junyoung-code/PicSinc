import assert from "node:assert/strict";
import test from "node:test";
import { regionLabelPosition, regionOwnerLabel } from "./region-labels";

test("same nickname does not turn another participant's claimed region into mine", () => {
  const claims = [{ regionId: "face-a", participantId: "other", nickname: "준영" }];
  assert.deepEqual(regionOwnerLabel("face-a", claims, ["face-a"], "me", "준영"), { own: false, text: "준영" });
  assert.deepEqual(regionOwnerLabel("face-a", claims, [], "other", "준영"), { own: true, text: "준영 (나)" });
});

test("my draft stays labeled before claim polling catches up and deselection removes it", () => {
  assert.deepEqual(regionOwnerLabel("face-a", [], ["face-a"], "me", "준영"), { own: true, text: "준영 (나)" });
  assert.equal(regionOwnerLabel("face-a", [], [], "me", "준영"), null);
});

test("labels track image zoom and stay inside the viewport near image edges", () => {
  const viewport = { width: 320, height: 400 };
  const box = { x: 100, y: 100, width: 100, height: 200 };
  const normal = regionLabelPosition(box, { scale: 1, x: 0, y: 0 }, viewport, 80)!;
  const zoomed = regionLabelPosition(box, { scale: 2, x: -200, y: -200 }, viewport, 80)!;
  assert.equal(normal.x + 40, 150);
  assert.equal(zoomed.x + 40, 100);
  assert.equal(zoomed.y, 4);
  for (const x of [-290, 110]) {
    const position = regionLabelPosition(box, { scale: 2, x, y: -200 }, viewport, 120)!;
    assert.ok(position.x >= 4 && position.x + 120 <= viewport.width - 4);
    assert.ok(position.y >= 4 && position.y + 24 <= viewport.height - 4);
  }
});

test("panning a claimed person fully off-screen does not leave a misleading edge label", () => {
  assert.equal(regionLabelPosition({ x: 0, y: 0, width: 100, height: 100 }, { scale: 2, x: -201, y: 0 }, { width: 320, height: 400 }, 80), null);
});
