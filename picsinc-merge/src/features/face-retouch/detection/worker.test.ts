import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { DetectionRegion } from './client';

const source = readFileSync(new URL('../../../../public/retouch/detect.worker.js', import.meta.url), 'utf8');
const face = (x = .5, y = .5) => Array.from({ length: 478 }, () => ({ x, y, z: .1 }));
const roi = (x = 700, y = 1100, width = 300, height = 400): DetectionRegion => ({ x, y, width, height, mask: new Uint8Array(width * height).fill(1) });
async function run(replies: Array<unknown[] | Error>, regions?: DetectionRegion[]) {
  const crops: number[][] = [], closed: string[] = [], inputs: string[] = [];
  let calls = 0, models = 0, output: any;
  const self: any = { postMessage: (value: unknown) => { output = value; }, MediaPipe: {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    FaceLandmarker: { createFromOptions: async () => { models++; return {
      detect: (image: { id: string }) => { inputs.push(image.id); const result = replies[calls++]; if (result instanceof Error) throw result; return { faceLandmarks: result }; },
      close: () => closed.push('detector'),
    }; } },
  } };
  runInNewContext(source, { self, importScripts: () => {}, createImageBitmap: async (_: unknown, ...box: number[]) => {
    crops.push(box); const id = `crop-${crops.length}`; return { id, close: () => closed.push(id) };
  } });
  await self.onmessage({ data: { bitmap: { id: 'source', width: 1375, height: 2049, close: () => closed.push('source') }, regions } });
  return { calls, models, inputs, crops, closed, output };
}

test('personal detection scans each selected ROI once with one model, not the whole image', async () => {
  const result = await run([[face()], [face()]], [roi(50, 50), roi()]);
  assert.deepEqual(result.inputs, ['crop-1', 'crop-2']);
  assert.equal(result.models, 1);
  assert.deepEqual(result.crops, [[0, 0, 410, 510], [640, 1040, 420, 520]]);
  const point = result.output.landmarks[1][0];
  assert.equal(point.x, 850 / 1375); assert.equal(point.y, 1300 / 2049);
  assert.equal(point.z, .1 * 420 / 1375);
  assert.deepEqual(result.closed, ['crop-1', 'crop-2', 'source', 'detector']);
});

test('15 percent padding is clamped at the original image edges', async () => {
  const result = await run([[face()], []], [roi(0, 0, 300, 400), roi(1200, 1800, 175, 249)]);
  assert.deepEqual(result.inputs, ['crop-1', 'crop-2']);
  assert.deepEqual(result.crops, [[0, 0, 360, 460], [1162, 1762, 213, 287]]);
  assert.equal(result.output.landmarks.length, 1);
});

test('standalone detection still scans the whole image exactly once', async () => {
  const detected = face();
  const result = await run([[detected]]);
  assert.deepEqual(result.inputs, ['source']); assert.equal(result.crops.length, 0);
  assert.equal(result.output.landmarks[0], detected);
  assert.deepEqual(result.closed, ['source', 'detector']);
});

test('empty selected regions never fall back to scanning the whole image', async () => {
  const result = await run([], []);
  assert.equal(result.calls, 0); assert.equal(result.output.landmarks.length, 0);
  assert.ok(result.closed.includes('source'));
});

test('padding and mask-hole faces remain available for protection; UI owns face eligibility', async () => {
  const region = roi(); region.mask.fill(0);
  const result = await run([[face(.01, .01), face()]], [region]);
  assert.equal(result.output.landmarks.length, 2);
  assert.equal(result.output.landmarks[0][1].x, (640 + .01 * 420) / 1375);
});

test('overlapping ROI crops are both scanned and duplicate faces are removed', async () => {
  const result = await run([[face()], [face(88 / 276, 138 / 326), face(.8, .8)]], [roi(), roi(800, 1200, 200, 250)]);
  assert.deepEqual(result.inputs, ['crop-1', 'crop-2']);
  assert.equal(result.output.landmarks.length, 2);
});

test('crop failure closes its bitmap and returns an error instead of partial detections', async () => {
  const result = await run([[face()], new Error('detect failed')], [roi(), roi(0, 1500)]);
  assert.equal(result.calls, 2); assert.match(result.output.error, /얼굴 기준점/);
  assert.equal(result.output.landmarks, undefined);
  assert.deepEqual(result.closed, ['crop-1', 'crop-2', 'source', 'detector']);
});

test('20 unique faces stop further ROI scans and preserve the editor fail-closed signal', async () => {
  const result = await run([Array.from({ length: 20 }, (_, i) => face(.1 + i * .03, .5))], [roi(), roi(0, 1500)]);
  assert.equal(result.calls, 1); assert.equal(result.output.landmarks.length, 20);
  assert.deepEqual(result.closed, ['crop-1', 'source', 'detector']);
});
