import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../../../public/retouch/detect.worker.js', import.meta.url), 'utf8');
const face = () => Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: .1 }));
async function run(replies: Array<unknown[] | Error>, retryFourPanels = true) {
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
  await self.onmessage({ data: { bitmap: { width: 1375, height: 2049, close: () => closed.push('source') }, retryFourPanels } });
  return { calls, crops, closed, output };
}

test('personal zero-face fallback covers odd-sized image and maps landmarks to original coordinates', async () => {
  const result = await run([[], [face()], [face()], [face()], [face()]]);
  assert.equal(result.calls, 5);
  assert.deepEqual(result.crops, [[0, 0, 687, 1024], [687, 0, 688, 1024], [0, 1024, 687, 1025], [687, 1024, 688, 1025]]);
  for (let i = 0; i < 4; i++) {
    const [x, y, width, height] = result.crops[i], point = result.output.landmarks[i][0];
    assert.equal(point.x, (x + .5 * width) / 1375);
    assert.equal(point.y, (y + .5 * height) / 2049);
    assert.equal(point.z, .1 * width / 1375);
  }
  assert.equal(result.closed.length, 6);
});

test('successful whole-image detection and standalone zero-face detection do not crop', async () => {
  for (const result of [await run([[face()]]), await run([[]], false)]) {
    assert.equal(result.calls, 1); assert.equal(result.crops.length, 0);
    assert.deepEqual(result.closed, ['source', 'detector']);
  }
});

test('crop failure closes its bitmap and returns an error instead of partial detections', async () => {
  const result = await run([[], [face()], new Error('detect failed')]);
  assert.equal(result.calls, 3); assert.match(result.output.error, /얼굴 기준점/);
  assert.equal(result.output.landmarks, undefined);
  assert.deepEqual(result.closed, ['crop-1', 'crop-2', 'source', 'detector']);
});

test('a crop reaching the detection cap preserves the 20-face fail-closed signal', async () => {
  const result = await run([[], Array.from({ length: 20 }, face)]);
  assert.equal(result.calls, 2); assert.equal(result.output.landmarks.length, 20);
  assert.deepEqual(result.closed, ['crop-1', 'source', 'detector']);
});
