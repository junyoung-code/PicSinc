import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { bounds, frame } from '../../src/features/face-retouch/effects/geometry';
import { lipOuterLoop } from '../../src/features/face-retouch/effects/lips';
import type { Landmark } from '../../src/features/face-retouch/state/model';

const fixture = process.env.RETOUCH_FIXTURE ?? 'test-images/four-women-20260915/01-original.png';
const output = process.env.RETOUCH_OUTPUT ?? 'private/retouch-e2e/lip-fullness';
const noseIds = [168,193,417,6,197,5,4,44,274,1,2,49,279,48,278,64,294,97,326,98,327,99,328,240,460];
type AuditWindow = Window & { lipFullnessLandmarks: Landmark[][] };

async function savePixels(page: Page, path: string) {
  const save = page.getByRole('button', { name: 'PNG 저장', exact: true });
  await expect(save).toBeEnabled({ timeout: 100_000 });
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
  await download.saveAs(path);
  return sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

test('real-photo lip fullness changes the lip outline and keeps nose pixels identical in full-resolution PNGs', async ({ page }) => {
  test.skip(!existsSync(fixture), 'Local image fixture required');
  await mkdir(output, { recursive: true });
  const original = await readFile(fixture);
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    const seen = new WeakSet();
    Worker.prototype.postMessage = function(message, options) {
      if (!seen.has(this)) {
        seen.add(this);
        this.addEventListener('message', ({ data }) => {
          if (data.landmarks) (window as unknown as AuditWindow).lipFullnessLandmarks = data.landmarks;
        });
      }
      const send = post.bind(this);
      return Array.isArray(options) ? send(message, options) : send(message, options);
    };
  });
  await page.goto('/retouch');
  await page.getByLabel('사진 열기', { exact: true }).setInputFiles(fixture);
  await expect(page.getByText(/개의 얼굴을 찾았어요/)).toBeVisible({ timeout: 100_000 });
  const base = await savePixels(page, `${output}/moira-0.png`);
  const { width, height, channels } = base.info;
  const originalMeta = await sharp(original).metadata();
  const rotated = (originalMeta.orientation ?? 1) >= 5;
  expect([width, height]).toEqual(rotated
    ? [originalMeta.height, originalMeta.width] : [originalMeta.width, originalMeta.height]);
  const landmarks = await page.evaluate(() => (window as unknown as AuditWindow).lipFullnessLandmarks);
  const left = landmarks.slice().sort((a, b) => a[1].x - b[1].x)[0];
  const f = frame({ id: 'face-1', landmarks: left }, width, height);
  const nose = bounds(noseIds.map(id => f.lm[id]));
  const lips = bounds(lipOuterLoop.map(id => f.lm[id]));
  const roi = bounds([
    f.world({ x: Math.min(nose.x, lips.x), y: nose.y }),
    f.world({ x: Math.max(nose.x + nose.width, lips.x + lips.width), y: nose.y }),
    f.world({ x: Math.min(nose.x, lips.x), y: lips.y + lips.height + f.width * .06 }),
    f.world({ x: Math.max(nose.x + nose.width, lips.x + lips.width), y: lips.y + lips.height + f.width * .06 }),
  ]);
  await page.getByRole('navigation', { name: '보정 부위' }).getByRole('button', { name: '입술', exact: true }).click();
  await page.locator('[data-control="lipFullness"]').click();
  for (const amount of [-100, 100]) {
    await page.locator('#retouch-strength').fill(String(amount));
    const edited = await savePixels(page, `${output}/moira-${amount}.png`);
    expect(edited.info).toEqual(base.info);
    let protectedPixels = 0, changedNose = 0, changedAroundLipEdge = 0;
    const boundary = f.width * .015;
    for (let y = Math.max(0, Math.floor(roi.y)); y < Math.min(height, Math.ceil(roi.y + roi.height)); y++) {
      for (let x = Math.max(0, Math.floor(roi.x)); x < Math.min(width, Math.ceil(roi.x + roi.width)); x++) {
        const p = f.local({ x: x + .5, y: y + .5 });
        const withinNose = p.x >= nose.x && p.x <= nose.x + nose.width && p.y >= nose.y && p.y <= nose.y + nose.height;
        const withinLipEdge = p.x >= lips.x && p.x <= lips.x + lips.width &&
          (Math.abs(p.y - lips.y) <= boundary || Math.abs(p.y - lips.y - lips.height) <= boundary);
        if (!withinNose && !withinLipEdge) continue;
        const start = (y * width + x) * channels;
        const changed = !edited.data.subarray(start, start + channels).equals(base.data.subarray(start, start + channels));
        if (withinNose) { protectedPixels++; if (changed) changedNose++; }
        if (withinLipEdge && changed) changedAroundLipEdge++;
      }
    }
    console.log(JSON.stringify({ amount, width, height, protectedPixels, changedNose, changedAroundLipEdge }));
    expect(protectedPixels).toBeGreaterThan(100);
    expect(changedNose).toBe(0);
    expect(changedAroundLipEdge).toBeGreaterThan(100);
  }
  await page.locator('#retouch-strength').fill('0');
  const reset = await savePixels(page, `${output}/moira-reset.png`);
  expect(reset.data.equals(base.data)).toBeTruthy();
  expect((await readFile(fixture)).equals(original)).toBeTruthy();
});
