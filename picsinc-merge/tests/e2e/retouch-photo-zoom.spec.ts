import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { fixture } from '../../src/features/face-retouch/effects/fixture';

// Photos/landmarks/HTTP are fixtures; rendering is real. Chrome uses native CDP
// touch. WebKit only exposes native taps, so multi-touch uses synthetic pointers
// and cannot establish iOS native scrolling/pointer-capture correctness.
type Finger = { x: number; y: number; id: number };
type TouchType = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
async function touchInput(page: Page, x: number, y: number) {
  if (page.context().browser()!.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    return { send: async (type: TouchType, touchPoints: Finger[]) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints }); }, close: () => cdp.detach() };
  }
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)!;
    (window as any).zoomTouchTarget = target;
    (window as any).zoomFingers = new Map();
    if (!(window as any).zoomCapturePatched) {
      const capture = Element.prototype.setPointerCapture;
      Element.prototype.setPointerCapture = function (id) { if (id >= 101 && id <= 103) return; capture.call(this, id); };
      (window as any).zoomCapturePatched = true;
    }
  }, { x, y });
  return {
    send: async (type: TouchType, points: Finger[]) => page.evaluate(({ type, points }) => {
      const fingers: Map<number, Finger> = (window as any).zoomFingers, target = (window as any).zoomTouchTarget as Element;
      const dispatch = (name: string, p: Finger) => target.dispatchEvent(new PointerEvent(name, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: p.id + 100, isPrimary: p.id === 1, clientX: p.x, clientY: p.y, buttons: name === 'pointerup' ? 0 : 1 }));
      if (type === 'touchEnd' || type === 'touchCancel') {
        for (const [id, p] of fingers) if (!points.length || points.some(next => next.id === id)) { dispatch(type === 'touchCancel' ? 'pointercancel' : 'pointerup', p); fingers.delete(id); }
        return;
      }
      for (const p of points) { dispatch(fingers.has(p.id) ? 'pointermove' : 'pointerdown', p); fingers.set(p.id, p); }
    }, { type, points }), close: async () => {},
  };
}
async function pinch(page: Page, x: number, y: number, spread: number, dx = 0, dy = 0) {
  const input = await touchInput(page, x, y);
  await input.send('touchStart', [{ x: x - 25, y, id: 1 }, { x: x + 25, y, id: 2 }]);
  for (let step = 1; step <= 6; step++) {
    const distance = 25 + (spread - 25) * step / 6;
    await input.send('touchMove', [{ x: x - distance + dx * step / 6, y: y + dy * step / 6, id: 1 }, { x: x + distance + dx * step / 6, y: y + dy * step / 6, id: 2 }]);
  }
  await input.send('touchEnd', []); await input.close();
}
async function swipe(page: Page, x: number, y: number, dx: number, dy: number) {
  const input = await touchInput(page, x, y);
  await input.send('touchStart', [{ x, y, id: 1 }]);
  for (let i = 1; i <= 6; i++) await input.send('touchMove', [{ x: x + dx * i / 6, y: y + dy * i / 6, id: 1 }]);
  await input.send('touchEnd', []); await input.close();
}
async function handoff(page: Page, x: number, y: number) {
  const input = await touchInput(page, x, y);
  await input.send('touchStart', [{ x: x - 25, y, id: 1 }, { x: x + 25, y, id: 2 }]);
  await input.send('touchMove', [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }]);
  // Chrome releases the listed changed points (despite the protocol's older
  // "active points" wording); end only the second contact, retaining the first.
  await input.send('touchEnd', [{ x: x + 30, y, id: 2 }]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { finish: async () => { for (let i = 1; i <= 6; i++) await input.send('touchMove', [{ x: x - 30 + i * 5, y, id: 1 }]); await input.send('touchEnd', []); await input.close(); } };
}

test('photo pinch keeps its anchor, reveals original detail and bounds panning', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Also safe against the deployed app: this UI check never writes telemetry or room data.
  await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }));
  const photo = await sharp({ create: { width: 2400, height: 3200, channels: 3, background: '#b8a0cc' } }).png().toBuffer();
  const face = fixture('zoom', .5, 1);
  await page.route('**/retouch/detect.worker.js', route => route.fulfill({ contentType: 'application/javascript', body: `self.onmessage=({data:{bitmap}})=>{bitmap.close();self.postMessage({landmarks:${JSON.stringify([face.landmarks])}});};` }));
  await page.goto('/retouch');
  await page.getByLabel('사진 열기', { exact: true }).setInputFiles({ name: 'zoom.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByRole('button', { name: 'PNG 저장', exact: true })).toBeEnabled();
  const canvas = page.locator('canvas[aria-label="보정 미리보기"]'), stage = canvas.locator('..'), viewport = stage.locator('..');
  await viewport.scrollIntoViewIfNeeded();
  const box = (await viewport.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
  // At fit, a vertical touch over the photo must still reach the tools below it.
  const scrollRoom = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY);
  if (scrollRoom > 30) {
    const beforeScroll = await page.evaluate(() => scrollY);
    await swipe(page, x, y, 0, -80);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeScroll + Math.min(30, scrollRoom));
    await page.evaluate(top => scrollTo(0, top), beforeScroll);
  }
  await pinch(page, x, y, 100);
  await expect.poll(() => stage.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(4, 1);
  const before = (await stage.boundingBox())!, anchor = { x: (x + 15 - before.x) / before.width, y: (y - before.y) / before.height };
  await pinch(page, x + 15, y, 50, 10, 10);
  await expect.poll(() => stage.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(5);
  const after = (await stage.boundingBox())!;
  expect((x + 25 - after.x) / after.width).toBeCloseTo(anchor.x, 2);
  expect((y + 10 - after.y) / after.height).toBeCloseTo(anchor.y, 2);
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.height)).toBeGreaterThan(1600);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  const continued = await handoff(page, x, y), handoffBefore = (await stage.boundingBox())!;
  await continued.finish();
  expect((await stage.boundingBox())!.x - handoffBefore.x).toBeCloseTo(30, 0);
  await swipe(page, x, y, 100, 100);
  const bounded = (await stage.boundingBox())!;
  expect(bounded.x).toBeLessThanOrEqual(box.x + 3); expect(bounded.y).toBeLessThanOrEqual(box.y + 3);
  expect(bounded.x + bounded.width).toBeGreaterThanOrEqual(box.x + box.width - 3);
  expect(bounded.y + bounded.height).toBeGreaterThanOrEqual(box.y + box.height - 3);
  await pinch(page, x, y, 1);
  await expect(stage).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(page.locator('#retouch-strength')).toHaveValue('0');
  expect(errors).toEqual([]);
});

test('region selection zoom stays inside the photo without claiming on pinch or double tap', async ({ page }) => {
  const width = 1000, height = 1500, base = '/api/sessions/zoom-selection';
  const photo = await sharp({ create: { width, height, channels: 3, background: '#b8a0cc' } }).png().toBuffer();
  const mask = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
  let claims = 0;
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === base) return route.fulfill({ json: { session: { id: 'zoom', inviteToken: 'zoom-selection', ownerParticipantId: 'owner', originalAssetId: 'original', version: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() }, currentParticipantId: 'owner', participants: [{ id: 'owner', nickname: '나', submitted: false }], assets: [{ id: 'original', kind: 'original', width, height }], originalSelections: [], selections: [], result: null } });
    if (path.endsWith('/collaboration')) return route.fulfill({ json: { enabled: true, phase: 'personal', rosterIds: ['owner'], completedIds: [], personalToken: null, personalMaskAssetId: null, personalState: null, editorId: null, editToken: null, leaseUntil: null, latestAssetId: null, version: 0, history: [] } });
    if (path.endsWith('/region-claims')) { if (request.method() === 'PUT') claims++; return route.fulfill({ json: { claims: claims ? [{ regionId: 'region', participantId: 'owner', nickname: '나' }] : [] } }); }
    if (path.endsWith('/original-detection')) return route.fulfill({ json: { status: 'ready', resultUrl: '/api/zoom-detection' } });
    if (path.endsWith('/regions')) return route.fulfill({ json: { job: { id: 'zoom', status: 'ready', resultUrl: '/api/zoom-detection' } } });
    if (path === '/api/zoom-detection') return route.fulfill({ json: { width, height, previewPngBase64: '', regions: [{ id: 'region', box: { x: 0, y: 0, width, height }, maskPngBase64: mask.toString('base64') }] } });
    if (path.includes('/assets/')) return route.fulfill({ contentType: 'image/png', body: photo });
    return route.fulfill({ json: {} });
  });
  await page.goto('/retouch/rooms/zoom-selection');
  const canvas = page.locator('canvas').first();
  await expect(page.getByRole('button', { name: '영역 편집하기', exact: true })).toBeVisible();
  await expect(page.getByText('사진과 영역을 준비하고 있어요.')).toHaveCount(0);
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!, x = box.x + box.width / 2, y = Math.max(100, box.y + 150);
  // draw() restores the label transform; record photo draw calls instead.
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    (window as any).photoScale = 0;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      if (this.canvas.getAttribute('aria-label')?.startsWith('사진 속') && args[0] instanceof HTMLImageElement) {
        const transform = this.getTransform(); (window as any).photoScale = transform.a; (window as any).photoX = transform.e / devicePixelRatio;
      }
      return (original as any).apply(this, args);
    };
  });
  await pinch(page, x, y, 50);
  const scale = await page.evaluate(() => (window as any).photoScale / devicePixelRatio);
  expect(scale).toBeGreaterThan(box.width / width * 1.5);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  expect(claims).toBe(0);
  const scrollBefore = await page.evaluate(() => scrollY);
  const continued = await handoff(page, x, y), offset = await page.evaluate(() => (window as any).photoX);
  await continued.finish();
  expect(await page.evaluate(() => (window as any).photoX) - offset).toBeCloseTo(30, 0);
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  if (test.info().project.use.hasTouch) { await page.touchscreen.tap(x, y); await page.touchscreen.tap(x, y); }
  else await page.mouse.dblclick(x, y, { delay: 80 });
  await expect.poll(() => page.evaluate(() => (window as any).photoScale / devicePixelRatio)).toBeCloseTo(box.width / width, 2);
  expect(claims).toBe(0);
  const room = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY);
  if (room > 30) {
    await swipe(page, x, y, 0, -80);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore + Math.min(30, room));
    await page.evaluate(top => scrollTo(0, top), scrollBefore);
    expect(claims).toBe(0);
  }
  await page.mouse.click(x, y);
  await expect.poll(() => claims).toBe(1);
  await expect(page.getByRole('button', { name: '영역 편집하기', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '영역 편집하기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '내 영역 선택' })).toBeVisible();
});
