import { test } from "node:test";
import assert from "node:assert/strict";
import { TouchGesture } from "./gesture";
import { initialState, setControl } from "../state/model";

const base = () => initialState([{ id: "a", landmarks: [] }]);
const start = { x: 100, y: 100 };
test("a complete drag undoes as one operation without reverting later face controls", () => {
  const gesture = new TouchGesture(), original = base();
  gesture.begin(original, "a", "touch", start, 30, .4);
  let state = gesture.move(original, { x: 110, y: 100 });
  state = gesture.move(state, { x: 120, y: 102 });
  assert.ok(state.strokes.length > 2);
  assert.ok(state.strokes.every(s => s.strength === .4));
  assert.equal(gesture.canUndo, false);
  state = gesture.finish(state);
  state = setControl(state, "a", "eyeSize", 60);
  const undone = gesture.undo(state);
  assert.deepEqual(undone.strokes, []);
  assert.equal(undone.settings.a.eyeSize, 60);
  assert.equal(gesture.canUndo, false);
  assert.deepEqual(original.strokes, []);
});
test("cancel restores the complete pre-gesture touch state and does not add history", () => {
  const gesture = new TouchGesture();let state = base();
  gesture.begin(state, "a", "touch", start, 30, .75);
  state = gesture.move(state, { x: 115, y: 105 });
  state = gesture.finish(state);
  const edited = state;
  gesture.begin(state, "a", "restore", start, 50, .75);
  state = gesture.move(state, start);
  assert.equal(state.restores.length, 1);
  state = gesture.finish(state, true);
  assert.deepEqual(state, edited);
  assert.deepEqual(gesture.undo(state).strokes, []);
});
test("undoing a restoration preserves the strokes it had erased", () => {
  const gesture = new TouchGesture();let state = base();
  gesture.begin(state, "a", "touch", start, 30, 1);
  state = gesture.finish(gesture.move(state, { x: 112, y: 100 }));
  const edited = state;
  gesture.begin(state, "a", "restore", start, 40, 1);
  state = gesture.finish(gesture.move(state, start));
  assert.equal(state.restores[0].through, edited.strokes.length);
  assert.deepEqual(gesture.undo(state), edited);
});
test("rejected motion does not get replayed on reentry and oversized jumps are bounded", () => {
  const gesture = new TouchGesture();const state = base();
  gesture.begin(state, "a", "touch", start, 30, .75);
  assert.equal(gesture.move(state, { x: 130, y: 100 }, false), state);
  const result = gesture.move(state, { x: 132, y: 100 });
  assert.deepEqual(result.strokes[0].from, { x: 130, y: 100 });
  assert.equal(gesture.move(result, { x: 1e8, y: 100 }), result);
  assert.equal(gesture.move(result, { x: 1e8+1, y: 100 }).strokes.length, 2);
});
test("no-op taps, duplicate finish, and reset do not resurrect history", () => {
  const gesture = new TouchGesture(), state = base();
  gesture.begin(state, "a", "touch", start, 30, .75);
  assert.equal(gesture.finish(state), state);
  assert.equal(gesture.canUndo, false);
  gesture.begin(state, "a", "touch", start, 30, .75);
  const edited = gesture.finish(gesture.move(state, { x: 110, y: 100 }));
  gesture.finish(edited);
  gesture.reset();
  assert.equal(gesture.undo(edited), edited);
});
test("touch and restoration keep recording after 600 segments each", () => {
  const gesture = new TouchGesture();let state = base();
  gesture.begin(state, "a", "touch", start, 5, .75);
  state = gesture.move(state, { x: 750, y: 100 });
  state = gesture.finish(state);
  assert.equal(state.strokes.length, 650);
  assert.deepEqual(state.strokes.at(-1)?.to, { x: 750, y: 100 });
  gesture.begin(state, "a", "restore", start, 30, .75);
  for (let offset = 0; offset <= 650; offset++) {
    state = gesture.move(state, { x: start.x + offset, y: start.y });
  }
  state = gesture.finish(state);
  assert.equal(state.restores.length, 651);
  assert.deepEqual(state.restores.at(-1)?.center, { x: 750, y: 100 });
  assert.equal(state.restores.at(-1)?.through, 650);
  assert.equal(gesture.undo(state).restores.length, 0);
});
