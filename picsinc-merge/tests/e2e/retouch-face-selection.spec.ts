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
  await expect(page.getByRole('heading', { name: '내 보정 결과를 확인해주세요' })).toBeVisible();
  expect(server.saved()).toBeUndefined();
  await page.getByRole('button', { name: '내 보정 저장', exact: true }).click();
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
  await expect(page.getByRole('heading', { name: '내 보정 결과를 확인해주세요' })).toBeVisible();
  expect(server.saved()).toBeUndefined();
  await page.getByRole('button', { name: '내 보정 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 보정이 끝났어요', exact: true })).toBeVisible();
  const record = server.saved()!;
  expect(record.faces).toHaveLength(4);
  const recovered = record.faces[3];
  expect(recovered.landmarks[1].x).toBeCloseTo(detected[3].landmarks[1].x, 6);
  expect(recovered.landmarks[1].y).toBeCloseTo(detected[3].landmarks[1].y, 6);
  expect(record.edit.settings[recovered.id].faceWidth).toBe(30);
});

for (const failure of [
  {stage:'model-init',reason:'network',body:'createFromOptions:async()=>{throw new TypeError("Failed to fetch https://private.example/photo?token=secret");}'},
  {stage:'roi-detect',reason:'memory',body:'createFromOptions:async()=>({detect:()=>{throw new WebAssembly.RuntimeError("memory access out of bounds");},close(){}})'},
]) test(`detection logging: ${failure.stage} records metadata without changing failure or recovery`, async ({page}) => {
  await backend(page,detected,4,true);
  const logs: any[]=[];let fail=true;
  await page.route('**/api/retouch/diagnostics',route=>{logs.push(route.request().postDataJSON());return route.continue();});
  await page.route('**/retouch/vendor/vision_bundle.js',route=>fail?route.fulfill({contentType:'application/javascript',body:`self.MediaPipe={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{${failure.body}}};`}):route.fallback());
  const delivery=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/retouch/diagnostics');
  await page.goto(`/retouch/rooms/${roomId}`);
  await page.getByRole('button',{name:'내 영역 보정 이어가기',exact:true}).click();
  expect((await delivery).status()).toBe(204);
  await expect(page.getByRole('alert').filter({hasText:'얼굴 기준점을 찾지 못했어요'})).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByRole('button',{name:/^얼굴 \d+ 보정$/})).toHaveCount(0);
  await expect(page.getByRole('img',{name:'업로드한 원본',exact:true})).toBeVisible();
  await expect.poll(()=>logs.length).toBe(1);
  expect(logs[0].diagnostic).toMatchObject({stage:failure.stage,reason:failure.reason,width,height,regionCount:4});
  expect(JSON.stringify(logs)).not.toMatch(/private\.example|secret|landmarks|mask|token|message|stack/);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('moira:face-detection-failures')??'[]'))).toEqual(logs);
  fail=false;await open(page);await overview(page,4);
  await expect(saveButton(page)).toBeEnabled();expect(logs).toHaveLength(1);
});


test('cut cancel restores face and touch edits; apply and review preserve other cuts', async ({ page }) => {
  const server = await backend(page, detected);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const cancel = page.getByRole('button', { name: '현재 컷 보정 취소', exact: true });
  const apply = page.getByRole('button', { name: '현재 컷 보정 적용', exact: true });
  const canvas = page.locator('canvas[aria-label="보정 미리보기"]');
  const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const stroke = async () => {
    const box = (await canvas.locator('..').locator('..').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 16, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up(); await expect(saveButton(page)).toBeEnabled();
  };
  const original = await pixels();
  await expect(cancel).toHaveCount(0);
  await faceButton(page, 1).click();
  for (const group of ['얼굴형', '눈', '입술', '코', '눈썹']) {
    await page.getByRole('navigation', { name: '보정 부위' }).getByRole('button', { name: group, exact: true }).click();
    await expect(cancel).toBeVisible(); await expect(apply).toBeVisible();
  }
  await page.getByRole('navigation', { name: '보정 부위' }).getByRole('button', { name: '얼굴형', exact: true }).click();
  await page.locator('#retouch-strength').fill('25'); await expect(apply).toBeEnabled();
  // Tapping the enlarged photo must not replace this visit's cancel baseline.
  await canvas.locator('..').locator('..').click({ position: { x: 150, y: 150 } });
  await page.getByRole('button', { name: '터치 보정', exact: true }).click();
  await stroke();
  await page.getByRole('button', { name: '복원', exact: true }).click(); await stroke();
  expect(await pixels()).not.toBe(original);
  await cancel.click(); await overview(page, 4); await expect(saveButton(page)).toBeEnabled();
  expect(await pixels()).toBe(original);

  await faceButton(page, 1).click(); await expect(page.locator('#retouch-strength')).toHaveValue('0');
  await page.locator('#retouch-strength').fill('65'); await expect(apply).toBeEnabled();
  await page.getByRole('button', { name: '터치 보정', exact: true }).click(); await stroke();
  const accepted = await pixels();
  await apply.click(); await overview(page, 4);
  await faceButton(page, 1).click(); await page.locator('#retouch-strength').fill('-25');
  await page.getByRole('button', { name: '터치 보정', exact: true }).click(); await stroke();
  await page.getByRole('button', { name: '복원', exact: true }).click(); await stroke();
  await cancel.click(); await overview(page, 4); await expect(saveButton(page)).toBeEnabled();
  expect(await pixels()).toBe(accepted);

  await faceButton(page, 2).click(); await page.locator('#retouch-strength').fill('-40'); await expect(apply).toBeEnabled();
  const panel = (await page.getByRole('region', { name: '보정 도구' }).boundingBox())!;
  const left = (await cancel.boundingBox())!, right = (await apply.boundingBox())!;
  expect(left.width).toBe(44); expect(right.height).toBe(44); expect(left.y).toBe(right.y);
  expect(left.x).toBeLessThan(right.x); expect(right.y + right.height).toBeLessThanOrEqual(panel.y + panel.height);
  await page.screenshot({ path: 'private/retouch-e2e/cut-actions.png', fullPage: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({width, height:874});
    const button = (await apply.boundingBox())!;
    expect(button.x + button.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.setViewportSize({width:402, height:874});
  await apply.click(); await overview(page, 4);
  await faceButton(page, 1).click(); await expect(page.locator('#retouch-strength')).toHaveValue('65');
  await cancel.click(); await overview(page, 4);
  await faceButton(page, 2).click(); await expect(page.locator('#retouch-strength')).toHaveValue('-40');
  await page.locator('#retouch-strength').fill('30'); await expect(saveButton(page)).toBeEnabled();
  const finalPixels = await pixels();
  await saveButton(page).click();
  await expect(page.getByRole('heading', { name: '내 보정 결과를 확인해주세요' })).toBeVisible();
  await expect(page.getByRole('region', { name: '보정 도구' })).toHaveCount(0);
  expect(server.saved()).toBeUndefined(); expect(server.actions).not.toContain('personal-save');
  expect(await pixels()).toBe(finalPixels);
  await page.screenshot({ path: 'private/retouch-e2e/personal-review.png', fullPage: true });
  await page.locator('h1').click(); await page.keyboard.down('Space');
  expect(await pixels()).toBe(finalPixels); await page.keyboard.up('Space');
  for (const width of [320, 390]) {
    await page.setViewportSize({width, height:874});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.getByRole('button', {name:'내 보정 저장', exact:true})).toBeEnabled();
  }
  await page.setViewportSize({width:402, height:874});
  await page.getByRole('button', { name: '이어서 보정하기', exact: true }).click(); await overview(page, 4);
  await faceButton(page, 2).click(); await expect(page.locator('#retouch-strength')).toHaveValue('30');
  await saveButton(page).click(); await page.goBack(); await overview(page, 4);
  expect(server.actions).not.toContain('personal-cancel');
  await saveButton(page).click();
  await page.getByRole('button', { name: '내 보정 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 보정이 끝났어요', exact: true })).toBeVisible();
  const record = server.saved()!;
  const values = Object.entries(record.edit.settings).filter(([id]) => id !== '__touch').map(([, value]) => value.faceWidth).sort((a, b) => a - b);
  expect(values).toEqual([0, 0, 30, 65]);
  expect(record.edit.strokes.length).toBeGreaterThan(0); expect(record.edit.restores).toEqual([]);
  expect(server.actions.filter(action => action === 'personal-save')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('on a 320x568 phone the face stays in view while the slider and cut buttons are used (B-020)', async ({ page }) => {
  await backend(page, detected);
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  await faceButton(page, 1).click();
  await expect(page.locator('#retouch-strength')).toBeVisible();
  // The panel is taller than this screen; scroll to its end as a person would.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const boxes = await page.evaluate(() => {
    const rect = (el: Element | null) => el ? (({ top, bottom }) => ({ top, bottom }))(el.getBoundingClientRect()) : null;
    const viewport = document.querySelector('canvas[aria-label="보정 미리보기"]')!.closest('[class*="viewport"]');
    return { slider: rect(document.querySelector('#retouch-strength')), apply: rect(document.querySelector('[aria-label="현재 컷 보정 적용"]')), photo: rect(viewport) };
  });
  await page.screenshot({ path: 'private/retouch-e2e/b020-320x568.png' });
  expect(boxes.photo!.top).toBeGreaterThanOrEqual(0);
  expect(boxes.photo!.bottom).toBeLessThanOrEqual(boxes.slider!.top);
  expect(boxes.slider!.bottom).toBeLessThanOrEqual(568);
  expect(boxes.apply!.bottom).toBeLessThanOrEqual(568);
  await page.locator('#retouch-strength').fill('30');
  await expect(page.getByRole('button', { name: '현재 컷 보정 적용', exact: true })).toBeEnabled();
});
