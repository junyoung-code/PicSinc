import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture';
import { bounds, frame, insidePolygon } from './geometry';
import { lipInnerLoop, lipOuterLoop } from './lips';
import { initialState, setControl, type Point } from '../state/model';
import { buildField, prepare, type Field } from '../engine/field';
import { jacobianFloor } from '../engine/limits';

const size = 1000;
const noseIds = [168, 193, 417, 1, 4, 44, 274, 2, 64, 97, 98, 99, 240, 294, 326, 327, 328, 460];

function sample(field: Field, p: Point): Point {
  const x = p.x / size * (field.columns - 1), y = p.y / size * (field.rows - 1);
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const shift = [0, 1].map(channel => {
    const at = (a: number, b: number) => field.data[(b * field.columns + a) * 4 + channel];
    return size * ((at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) +
      (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty);
  });
  return { x: p.x + shift[0], y: p.y + shift[1] };
}

function destination(field: Field, source: Point): Point {
  let p = source;
  for (let n = 0; n < 35; n++) {
    const q = sample(field, p);
    p = { x: p.x + source.x - q.x, y: p.y + source.y - q.y };
  }
  return p;
}

for (const tilt of [-.3, 0, .3]) {
  test(`lip fullness at tilt ${tilt} moves both outer edges and protects the cavity, corners and nose after interpolation`, async () => {
    const face = fixture('a', .5, 1, tilt), f = frame(face, size, size);
    const nose = bounds(noseIds.map(id => f.lm[id]));
    const inner = lipInnerLoop.map(id => f.lm[id]);
    const cavity = bounds(inner);
    for (const value of [-100, 100]) {
      const field = await buildField(prepare([face], setControl(initialState([face]), face.id, 'lipFullness', value), size, size));
      assert.ok(field);
      assert.ok(jacobianFloor(field.data, field.columns, field.rows) >= .25);
      for (const [id, direction] of [[0, -1], [17, 1]]) {
        const moved = f.local(destination(field, f.points[id]));
        assert.ok((moved.y - f.lm[id].y) * direction * Math.sign(value) > 1, `outer edge ${id} must move at ${value}`);
        assert.ok(Math.abs(moved.x - f.lm[id].x) < .001, 'movement follows the face axis');
      }
      for (const id of [61, 291, 152, ...lipInnerLoop, ...noseIds]) {
        assert.deepEqual(sample(field, f.points[id]), f.points[id], `landmark ${id} is fixed`);
      }
      for (const [area, contains] of [[nose, () => true], [cavity, (p: Point) => insidePolygon(p, inner)]] as const) {
        for (let y = area.y; y <= area.y + area.height; y += 1) for (let x = area.x; x <= area.x + area.width; x += 1) {
          if (!contains({x, y})) continue;
          const p = f.world({ x, y });
          assert.deepEqual(sample(field, p), p);
        }
      }
    }
  });
}

test('a short philtrum stops upward expansion without stopping lower lip expansion', async () => {
  const face = fixture();
  face.landmarks[2] = { ...face.landmarks[2], y: .547 };
  const f = frame(face, size, size);
  const field = await buildField(prepare([face], setControl(initialState([face]), face.id, 'lipFullness', 100), size, size));
  assert.ok(field);
  assert.deepEqual(sample(field, f.points[2]), f.points[2]);
  assert.deepEqual(sample(field, f.points[0]), f.points[0]);
  assert.ok(destination(field, f.points[17]).y - f.points[17].y > 1);
});

test('adding fullness to lip and nose edits does not add any movement at the nose', async () => {
  const face = fixture(), f = frame(face, size, size);
  let state = initialState([face]);
  for (const id of ['lipPosition', 'lipSize', 'noseLength'] as const) state = setControl(state, face.id, id, 70);
  const before = await buildField(prepare([face], state, size, size));
  const after = await buildField(prepare([face], setControl(state, face.id, 'lipFullness', 100), size, size));
  assert.ok(before && after);
  for (const id of noseIds) assert.deepEqual(sample(after, f.points[id]), sample(before, f.points[id]));
});

for (const control of ['lipSize', 'lipWidth'] as const) {
  test(`${control} keeps its outline scale and leaves the nose and jaw fixed`, async () => {
    for (const scale of [1, .35]) for (const angle of [0, .3]) for (const value of [-100, 100]) {
      const face = fixture('a', .5, scale, angle), f = frame(face, size, size);
      const state = setControl(initialState([face]), face.id, control, value);
      const field = await buildField(prepare([face], state, size, size));
      assert.ok(field);
      assert.ok(jacobianFloor(field.data, field.columns, field.rows) >= .25);
      const lip = bounds(lipOuterLoop.map(id => f.lm[id]));
      const cx = lip.x + lip.width / 2, cy = lip.y + lip.height / 2;
      const sx = 1 + (control === 'lipSize' ? .044 : .05) * Math.sign(value);
      const sy = control === 'lipSize' ? sx : 1;
      for (const id of [17, 61, 291]) {
        const moved = f.local(destination(field, f.points[id]));
        assert.ok(Math.abs(moved.x - (cx + (f.lm[id].x - cx) * sx)) < lip.width * .005);
        assert.ok(Math.abs(moved.y - (cy + (f.lm[id].y - cy) * sy)) < lip.width * .005);
      }
      for (const side of [-1, 1]) {
        const corner = f.lm[side < 0 ? 61 : 291];
        const displacement = (distance: number) => {
          const p = f.world({ x: corner.x + side * distance * f.width, y: corner.y });
          const moved = f.local(sample(field, p));
          return (moved.x - (corner.x + side * distance * f.width)) * -side * Math.sign(value);
        };
        const near = displacement(.065), farther = displacement(.085);
        assert.ok(near > farther && farther > .01, 'skin follows the corner, with less movement farther out');
        assert.ok(Math.abs(displacement(.15)) < 1e-8, 'outside the influence boundary stays fixed');
      }
      const jaw = [172,136,150,149,176,148,152,377,400,378,379,365,397];
      for (const id of [...jaw, ...noseIds]) {
        assert.deepEqual(sample(field, f.points[id]), f.points[id]);
      }
      for (let i = 1; i < jaw.length; i++) {
        const a = f.points[jaw[i - 1]], b = f.points[jaw[i]];
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        assert.deepEqual(sample(field, middle), middle);
      }
    }
  });
}
