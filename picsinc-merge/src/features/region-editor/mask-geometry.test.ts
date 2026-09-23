import assert from "node:assert/strict";
import test from "node:test";
import { applyExclusive, overlapMask, paintBrush, paintEllipse, screenToImage } from "./mask-geometry";

test("화면 좌표를 원본 픽셀로 바꾼다", () => {
  assert.deepEqual(screenToImage({ x: 110, y: 70 }, { left: 10, top: 20, width: 200, height: 100 }, { width: 1000, height: 500 }), { x: 500, y: 250 });
});

test("타원과 브러시는 더하고 지운다", () => {
  const mask = new Uint8Array(25); paintEllipse(mask, 5, 5, { x: 2, y: 2 }, { x: 1, y: 1 }, 1);
  assert.equal(mask[12], 1); assert.equal(mask[0], 0);
  paintBrush(mask, 5, 5, { x: 0, y: 2 }, { x: 4, y: 2 }, 0.5, 0);
  assert.equal(mask[12], 0);
});

test("개인 영역의 겹침을 계산하고 지정은 서로 배타적이다", () => {
  const overlap = overlapMask([Uint8Array.from([1, 1, 0, 0]), Uint8Array.from([0, 1, 1, 0])]);
  assert.deepEqual([...overlap], [0, 1, 0, 0]);
  const assignments = [Uint8Array.from([0, 1, 0, 0]), Uint8Array.from([0, 1, 1, 0])];
  applyExclusive(assignments, 1, overlap);
  assert.deepEqual(assignments.map((mask) => [...mask]), [[0, 0, 0, 0], [0, 1, 0, 0]]);
});

test("공동 지정은 저장된 겹침 밖으로 넓어지지 않는다", () => {
  const assignments = [Uint8Array.from([1, 1, 0]), Uint8Array.from([0, 0, 1])];
  applyExclusive(assignments, 0, Uint8Array.from([0, 1, 0]));
  assert.deepEqual(assignments.map((mask) => [...mask]), [[0, 1, 0], [0, 0, 1]]);
});
