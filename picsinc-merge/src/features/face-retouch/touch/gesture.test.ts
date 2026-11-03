import { test } from "node:test";
import assert from "node:assert/strict";
import { TouchGesture } from "./gesture";
import { initialState, setControl } from "../state/model";

const base = () => initialState([{ id: "a", landmarks: [] }]);
const start = { x: 100, y: 100 };
test("a complete drag undoes as one operation without reverting later face controls", () => {
  const gesture = new TouchGesture(), original = base();
  gesture.begin(original, "a", "touch", start, 30, .4);
  let state = gesture.move(original, { x: 110, y: 100 }).state;
  state = gesture.move(state, { x: 120, y: 102 }).state;
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
  state = gesture.move(state, { x: 115, y: 105 }).state;
  state = gesture.finish(state);
  const edited = state;
  gesture.begin(state, "a", "restore", start, 50, .75);
  state = gesture.move(state, start).state;
  assert.equal(state.restores.length, 1);
  state = gesture.finish(state, true);
  assert.deepEqual(state, edited);
  assert.deepEqual(gesture.undo(state).strokes, []);
});
test("undoing a restoration preserves the strokes it had erased", () => {
  const gesture = new TouchGesture();let state = base();
  gesture.begin(state, "a", "touch", start, 30, 1);
  state = gesture.finish(gesture.move(state, { x: 112, y: 100 }).state);
  const edited = state;
  gesture.begin(state, "a", "restore", start, 40, 1);
  state = gesture.finish(gesture.move(state, start).state);
  assert.equal(state.restores[0].through, edited.strokes.length);
  assert.deepEqual(gesture.undo(state), edited);
});
test("rejected motion does not get replayed on reentry and oversized jumps are bounded", () => {
  const gesture = new TouchGesture();const state = base();
  gesture.begin(state, "a", "touch", start, 30, .75);
  assert.equal(gesture.move(state, { x: 130, y: 100 }, false).state, state);
  const result = gesture.move(state, { x: 132, y: 100 });
  assert.deepEqual(result.state.strokes[0].from, { x: 130, y: 100 });
  assert.equal(gesture.move(result.state, { x: 1e8, y: 100 }).full, true);
  assert.equal(gesture.move(result.state, { x: 1e8+1, y: 100 }).state.strokes.length, 2);
});
test("no-op taps, duplicate finish, and reset do not resurrect history", () => {
  const gesture = new TouchGesture(), state = base();
  gesture.begin(state, "a", "touch", start, 30, .75);
  assert.equal(gesture.finish(state), state);
  assert.equal(gesture.canUndo, false);
  gesture.begin(state, "a", "touch", start, 30, .75);
  const edited = gesture.finish(gesture.move(state, { x: 110, y: 100 }).state);
  gesture.finish(edited);
  gesture.reset();
  assert.equal(gesture.undo(edited), edited);
});
test("full touch and restoration buffers reject additional work atomically", () => {
  const gesture = new TouchGesture();let state = base();
  gesture.begin(state, "a", "touch", start, 30, .75);
  const stroke = gesture.move(state, { x: 101, y: 100 }).state.strokes[0];
  state = { ...state, strokes: Array(600).fill(stroke) };
  assert.deepEqual(gesture.move(state, { x: 102, y: 100 }), { state, full: true });
  gesture.begin(state, "a", "restore", start, 30, .75);
  const restore = gesture.move(state, start).state.restores[0];
  state = { ...state, restores: Array(600).fill(restore) };
  assert.deepEqual(gesture.move(state, start), { state, full: true });
});
