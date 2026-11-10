import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { fixture } from '../../src/features/face-retouch/effects/fixture';
import type { Face } from '../../src/features/face-retouch/state/model';
import type { RoomEditRecord } from '../../src/features/face-retouch/ui/RetouchEditor';
import type { CollaborationView } from '../../src/features/photo-session/collaboration-types';

// Deterministic UI regression: reuse synthetic landmarks and replace only the
// detection worker response + HTTP backend. The real field worker/WebGL stay on.
// This does not verify MediaPipe accuracy, YOLO ownership, DB or device gestures.
const roomId = 'face-selection-test';
const base = `/api/sessions/${roomId}`;
const width = 1600, height = 1600;
const detected = Array.from({ length: 16 }, (_, i) => {
  const face = fixture(`fixture-${i}`, .125 + (i % 4) * .25, .3);
  return { ...face, landmarks: face.landmarks.map(p => ({ ...p, y: p.y - .45 + .125 + Math.floor(i / 4) * .25 })) };
});

async function backend(page: Page, faces: Face[], ownedColumns = 4, roiDetection = false) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    data[i] = (x * 7) % 256; data[i + 1] = (y * 5) % 256; data[i + 2] = 100;
  }
  const png = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const maskData = Buffer.alloc(width * height);
  for (let y = 0; y < 400; y++) maskData.fill(255, y * width, y * width + ownedColumns * 400);
  const mask = await sharp(maskData, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const regions = roiDetection ? await Promise.all(Array.from({ length: 5 }, async (_, i) => {
    const x = i % 4 * 400, y = Math.floor(i / 4) * 400;
    const pixels = Buffer.alloc(width * height);
    for (let row = y; row < y + 400; row++) pixels.fill(255, row * width + x, row * width + x + 400);
    return { id: `roi-${i}`, box: { x, y, width: 400, height: 400 }, maskPngBase64: (await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer()).toString('base64') };
  })) : [];
  let state: CollaborationView = {
    enabled: true, phase: 'personal', rosterIds: ['owner', 'friend'], completedIds: ['friend'],
    personalToken: 'personal-token', personalMaskAssetId: 'mask', personalState: null,
    editorId: null, editToken: null, leaseUntil: null, latestAssetId: null, version: 0, history: [],
  };
  const actions: string[] = [];
  let saved: RoomEditRecord | undefined;
  if (!roiDetection) await page.route('**/retouch/detect.worker.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `self.onmessage=({data:{bitmap}})=>{bitmap.close();self.postMessage({landmarks:${JSON.stringify(faces.map(f => f.landmarks))}});};`,
  }));
  if (roiDetection) await page.route('**/retouch/vendor/vision_bundle.js', route => route.fulfill({
    contentType: 'application/javascript',
    // Real Worker + transfer + coordinate mapping. A whole-image scan must fail.
    body: `let call=0;const replies=${JSON.stringify(detected.slice(0, 4).map((f, i) => {
      const x = Math.max(0, i * 400 - 60), cropWidth = Math.min(width, (i + 1) * 400 + 60) - x;
      return { width: cropWidth, landmarks: f.landmarks.map(p => ({ ...p, x: (p.x * width - x) / cropWidth, y: p.y * height / 460, z: (p.z ?? 0) * width / cropWidth })) };
    }))};self.MediaPipe={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:async()=>({detect:image=>{const reply=replies[call++];if(!reply||image.width!==reply.width||image.height!==460)throw Error('Unexpected detection input');return {faceLandmarks:[reply.landmarks]};},close(){}})}};`,
  }));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path === base) return json({
      session: { id: 'session', inviteToken: roomId, ownerParticipantId: 'owner', originalAssetId: 'original', version: 5, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() },
      currentParticipantId: 'owner', participants: [
        { id: 'owner', sessionId: 'session', nickname: '민선', submitted: state.completedIds.includes('owner') },
        { id: 'friend', sessionId: 'session', nickname: '예솔', submitted: true },
      ], assets: [{ id: 'original', kind: 'original', width, height, contentType: 'image/png' }],
      originalSelections: roiDetection ? [{participantId:'owner',maskAssetId:'mask',selectedRegionIds:regions.slice(0,4).map(r=>r.id)}] : [], selections: [], result: null,
    });
    if (path === `${base}/collaboration`) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); actions.push(body.action);
        if (body.action === 'personal-save') {
          saved = body.state;
          state = { ...state, completedIds: ['owner', 'friend'], personalToken: null, version: 1 };
        }
        if (body.action === 'personal-cancel') state = { ...state, personalToken: null };
      }
      return json(state);
    }
    if (path === `${base}/region-claims`) return json({ claims: [] });
    if (path === `${base}/original-detection`) return json({ status: 'ready', resultUrl: new URL('/api/selection-detection', request.url()).href });
    if (path === '/api/selection-detection') return json({ width, height, previewPngBase64: '', regions });
    if (path === `${base}/assets/original/regions`) return json({ job: { id: 'selection-detection', status: 'ready', resultUrl: new URL('/api/selection-detection', request.url()).href } });
    if (path.startsWith(`${base}/assets/`)) return route.fulfill({ contentType: 'image/png', body: path.endsWith('/mask') ? mask : png });
    if (path === `${base}/uploads/edited`) return json({ uploadId: 'selection-upload', signedUrl: new URL('/api/selection-storage', request.url()).href, token: 'test', path: 'test' });
    if (path === '/api/selection-storage') return route.fulfill({ status: 200, body: '' });
    if (path === '/api/uploads/selection-upload/complete') return json({ asset: { id: 'edited' } });
    return route.fulfill({ status: 404, json: { error: `Unhandled ${path}` } });
  });
  return { actions, saved: () => saved };
}

const faceButton = (page: Page, n: number) => page.getByRole('button', { name: `얼굴 ${n} 보정`, exact: true });
const previewStage = (page: Page) => page.locator('canvas[aria-label="보정 미리보기"]').locator('..');
const saveButton = (page: Page) => page.getByRole('button', { name: '내 얼굴 보정 완료', exact: true });
async function open(page: Page) {
  await page.goto(`/retouch/rooms/${roomId}`);
  await page.getByRole('button', { name: '내 영역 보정 이어가기', exact: true }).click();
  await expect(saveButton(page)).toBeEnabled({ timeout: 100000 });
}
async function overview(page: Page, count: number) {
  await expect(page.getByRole('button', { name: /^얼굴 \d+ 보정$/ })).toHaveCount(count);
  await expect(page.locator('#retouch-strength')).toHaveCount(0);
  await expect(previewStage(page)).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
}

test('personal overview filters 16 detections to my four faces and saves every face setting', async ({ page }) => {
  const server = await backend(page, detected);
  await open(page); await overview(page, 4);
  await expect(page.getByRole('img', { name: '내 편집 영역', exact: true })).toHaveCount(0);
  await expect(faceButton(page, 1).locator('svg')).toHaveCount(4);
  await expect(faceButton(page, 1)).toHaveText('');
  await expect(faceButton(page, 1)).toHaveCSS('border-top-width', '0px');
  await page.getByRole('button', { name: '얼굴 보정', exact: true }).click();
  await overview(page, 4); // The tab must not open an arbitrary first face.

  const box = (await faceButton(page, 1).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2, { steps: 3 }); await page.mouse.up();
  await expect(page.locator('#retouch-strength')).toHaveCount(0); // A drag is not a tap.

  await faceButton(page, 1).click();
  await expect(page.locator('#retouch-strength')).toBeVisible();
  await expect(page.getByRole('img', { name: '내 편집 영역', exact: true })).toBeVisible();
  await expect.poll(() => previewStage(page).evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(1);
  await page.locator('#retouch-strength').fill('65'); await expect(saveButton(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: '얼굴 목록으로', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '보정 도구 접기', exact: true }).click(); await overview(page, 4);
  await faceButton(page, 2).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#retouch-strength')).toHaveValue('0');
  await page.locator('#retouch-strength').fill('-40'); await expect(saveButton(page)).toBeEnabled();
  await page.getByRole('button', { name: '보정 도구 접기', exact: true }).click(); await overview(page, 4);
  await faceButton(page, 1).click(); await expect(page.locator('#retouch-strength')).toHaveValue('65');

  // The first browser back returns to the overview and preserves the editor.
  page.on('dialog', dialog => dialog.dismiss());
  await page.goBack(); await overview(page, 4);
  expect(server.actions).not.toContain('personal-cancel');
  await expect(saveButton(page)).toBeEnabled();
  expect(await page.evaluate(() => history.state?.roomEdit)).toBe(true);
  await faceButton(page, 2).click(); await expect(page.locator('#retouch-strength')).toHaveValue('-40');
  await page.getByRole('button', { name: '뒤로 가기', exact: true }).click(); await overview(page, 4);
  expect(server.actions).not.toContain('personal-cancel');
  await page.getByRole('button', { name: '터치 보정', exact: true }).click();
  await expect(page.locator('#brush-size')).toBeVisible();
  await page.getByRole('button', { name: '얼굴 보정', exact: true }).click(); await overview(page, 4);
  await faceButton(page, 1).click(); await expect(page.locator('#retouch-strength')).toHaveValue('65');
  await page.getByRole('button', { name: '터치 보정', exact: true }).click();
  await expect(page.getByRole('button', { name: '얼굴 목록으로', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '보정 도구 접기', exact: true }).click(); await overview(page, 4);

  let releaseSave!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route(`**${base}/collaboration`, async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'personal-save') await saveGate;
    return route.fallback();
  });
  await saveButton(page).click();
  await expect(page.getByRole('heading', { name: '내 보정을 저장하고 있어요' })).toBeVisible();
  await expect(page.getByRole('region', { name: '보정 저장 중' }).locator('[data-loading-characters]')).toBeVisible();
  releaseSave();
  await expect(page.getByRole('heading', { name: '내 보정이 끝났어요', exact: true })).toBeVisible();
  const record = server.saved()!;
  expect(record.faces).toHaveLength(16);
  const values = Object.entries(record.edit.settings).filter(([id]) => id !== '__touch').map(([, values]) => values.faceWidth).sort((a, b) => a - b);
  expect(values).toEqual([-40, 0, 0, 65]);
});

test('a single eligible face still starts in overview and ignores a pinch over its box', async ({ page, browserName }) => {
  await backend(page, detected, 1); await open(page); await overview(page, 1);
  await expect(page.getByText('보기 및 보정 설정', { exact: true })).toHaveCount(0);
  if (browserName === 'chromium') {
    const box = (await faceButton(page, 1).boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 8, y, id: 1 }, { x: x + 8, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 18, y, id: 1 }, { x: x + 18, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#retouch-strength')).toHaveCount(0);
    await cdp.detach();
  }
  await faceButton(page, 1).focus(); await page.keyboard.press('Space');
  await expect(page.locator('#retouch-strength')).toHaveValue('0');
  await page.getByRole('button', { name: '보정 도구 접기', exact: true }).click(); await overview(page, 1);
});

// Includes region selection, authorized-mask decoding, worker transfer, ROI scans,
// original-coordinate conversion, UI filtering, and saving through the real client.
test('personal detection scans selected ROIs directly and preserves original coordinates on save', async ({ page }) => {
  const server = await backend(page, detected, 4, true);
  await open(page); await overview(page, 4);
  await faceButton(page, 4).click();
  await page.locator('#retouch-strength').fill('30');
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(page.getByRole('heading', { name: '내 보정이 끝났어요', exact: true })).toBeVisible();
  const record = server.saved()!;
  expect(record.faces).toHaveLength(4);
  const recovered = record.faces[3];
  expect(recovered.landmarks[1].x).toBeCloseTo(detected[3].landmarks[1].x, 6);
  expect(recovered.landmarks[1].y).toBeCloseTo(detected[3].landmarks[1].y, 6);
  expect(record.edit.settings[recovered.id].faceWidth).toBe(30);
});
