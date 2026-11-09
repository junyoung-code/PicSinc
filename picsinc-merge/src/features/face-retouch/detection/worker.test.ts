import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { DetectionRegion } from './client';

const source = readFileSync(new URL('../../../../public/retouch/detect.worker.js', import.meta.url), 'utf8');
const face = (x = .5, y = .5) => Array.from({ length: 478 }, () => ({ x, y, z: .1 }));
const roi = (x = 700, y = 1100, width = 300, height = 400): DetectionRegion => ({ x, y, width, height, mask: new Uint8Array(width * height).fill(1) });
async function run(replies: Array<unknown[] | Error>, retryRegions: DetectionRegion[] = []) {
  const crops: number[][] = [], closed: string[] = [];
  let calls = 0, output: any;
  const self: any = { postMessage: (value: unknown) => { output = value; }, MediaPipe: {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: { createFromOptions: async () => ({
      detect: () => { const result = replies[calls++]; if (result instanceof Error) throw result; return { faceLandmarks: result }; },
      close: () => closed.push('detector'),
    }) },
  } };
  runInNewContext(source, { self, importScripts: () => {}, createImageBitmap: async (_: unknown, ...box: number[]) => {
    crops.push(box); const id = `crop-${crops.length}`; return { close: () => closed.push(id) };
  } });
  await self.onmessage({ data: { bitmap: { width: 1375, height: 2049, close: () => closed.push('source') }, retryRegions } });
  return { calls, crops, closed, output };
}

test('partial whole-image detection retries only the missing selected ROI and maps coordinates', async () => {
  const existing = face(200 / 1375, 250 / 2049);
  const result = await run([[existing], [face()]], [roi(50, 50), roi()]);
  assert.equal(result.calls, 2);
  assert.deepEqual(result.crops, [[640, 1040, 420, 520]]);
  assert.equal(result.output.landmarks[0], existing);
  const point = result.output.landmarks[1][0];
  assert.equal(point.x, 850 / 1375); assert.equal(point.y, 1300 / 2049);
  assert.equal(point.z, .1 * 420 / 1375);
  assert.deepEqual(result.closed, ['crop-1', 'source', 'detector']);
});

test('zero-face detection retries selected ROIs only and clamps padding at image edges', async () => {
  const result = await run([[], [face()], []], [roi(0, 0, 300, 400), roi(1200, 1800, 175, 249)]);
  assert.equal(result.calls, 3);
  assert.deepEqual(result.crops, [[0, 0, 360, 460], [1162, 1762, 213, 287]]);
  assert.equal(result.output.landmarks.length, 1);
});

test('all selected ROIs already have faces, or standalone has none: no crop', async () => {
  for (const result of [await run([[face(850 / 1375, 1300 / 2049)]], [roi()]), await run([[]])]) {
    assert.equal(result.calls, 1); assert.equal(result.crops.length, 0);
    assert.deepEqual(result.closed, ['source', 'detector']);
  }
});

test('ROI holes do not count as detected and faces in padding or outside the mask are excluded', async () => {
  const region = roi();
  region.mask[200 * region.width + 150] = 0;
  const existing = face(850 / 1375, 1300 / 2049);
  const result = await run([[existing], [face(.01, .01), face(), face(.6, .6)]], [region]);
  assert.equal(result.calls, 2);
  assert.equal(result.output.landmarks.length, 2);
  assert.equal(result.output.landmarks[0], existing);
  assert.equal(result.output.landmarks[1][1].x, (640 + .6 * 420) / 1375);
});

test('overlapping selected ROIs reuse added detections and duplicate crop faces are removed', async () => {
  const result = await run([[], [face(), face(.5001, .5001)]], [roi(), roi(800, 1200, 200, 250)]);
  assert.equal(result.calls, 2); assert.equal(result.output.landmarks.length, 1);
});

test('crop failure closes its bitmap and returns an error instead of partial detections', async () => {
  const result = await run([[face(.1, .1)], new Error('detect failed')], [roi()]);
  assert.equal(result.calls, 2); assert.match(result.output.error, /얼굴 기준점/);
  assert.equal(result.output.landmarks, undefined);
  assert.deepEqual(result.closed, ['crop-1', 'source', 'detector']);
});

test('whole-image detection cap skips retries', async () => {
  const result = await run([Array.from({ length: 20 }, () => face(.1, .1))], [roi()]);
  assert.equal(result.calls, 1); assert.equal(result.output.landmarks.length, 20);
});

test('added faces reaching the cap preserve the editor fail-closed signal', async () => {
  const result = await run([Array.from({ length: 19 }, () => face(.1, .1)), [face(), face(.6, .6)]], [roi(), roi(0, 1500)]);
  assert.equal(result.calls, 2); assert.equal(result.output.landmarks.length, 20);
  assert.deepEqual(result.closed, ['crop-1', 'source', 'detector']);
});
