import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { fixture } from '../../src/features/face-retouch/effects/fixture';
import { TOUCH_SUPPORT } from '../../src/features/face-retouch/touch/coordinates';
import type { EditState } from '../../src/features/face-retouch/state/model';

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

test('brush size 2 keeps its viewport ratio after zoom and resize', async ({ page }) => {
  type BrushWindow = Window & { brushEdit?: EditState };
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: { plan?: { state: EditState } }, options?: StructuredSerializeOptions | Transferable[]) {
      if (message.plan) (window as BrushWindow).brushEdit = message.plan.state;
      const send = post.bind(this);
      return Array.isArray(options) ? send(message, options) : send(message, options);
    };
  });
  await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }));
  const size = 1600;
  const photo = await sharp({ create: { width: size, height: size, channels: 3, background: '#b8a0cc' } }).png().toBuffer();
  const face = fixture('brush');
  await page.route('**/retouch/detect.worker.js', route => route.fulfill({ contentType: 'application/javascript',
    body: `self.onmessage=({data:{bitmap}})=>{bitmap.close();self.postMessage({landmarks:${JSON.stringify([face.landmarks])}});};`,
  }));
  await page.goto('/retouch');
  await page.getByLabel('사진 열기', { exact: true }).setInputFiles({ name: 'brush.png', mimeType: 'image/png', buffer: photo });
  const save = page.getByRole('button', { name: 'PNG 저장', exact: true });
  await expect(save).toBeEnabled();
  const canvas = page.locator('canvas[aria-label="보정 미리보기"]');
  const stage = canvas.locator('..'), viewport = stage.locator('..');
  await page.getByRole('button', { name: '터치 보정', exact: true }).click();
  const slider = page.locator('#brush-size');
  await slider.fill('2');
  await viewport.scrollIntoViewIfNeeded();
  async function viewportCenter() {
    const bounds = (await viewport.boundingBox())!;
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }
  const latest = () => page.evaluate(() => (window as BrushWindow).brushEdit!);
  async function measure(mode: '클래식' | '복원') {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await viewport.scrollIntoViewIfNeeded();
    const { x, y } = await viewportCenter();
    await page.mouse.move(x, y);
    await page.mouse.down();
    const before = await latest();
    await page.mouse.move(x + 6, y, { steps: 3 });
    const guide = page.getByTestId('touch-guide');
    const outline = guide.locator(':scope > circle');
    const { diameter, outerDiameter, centerX, centerY, fill, stroke } = await outline.evaluate((el: SVGCircleElement) => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      return { diameter: rect.width, outerDiameter: rect.width + parseFloat(style.strokeWidth), centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2, fill: style.fill, stroke: style.stroke };
    });
    expect(fill).toBe('none');
    expect(stroke).toBe('rgb(255, 255, 255)');
    await expect(guide.locator(':scope > path:not([data-testid])')).toHaveCSS('stroke', 'rgb(255, 255, 255)');
    expect(Math.abs(centerX - x - 6)).toBeLessThan(1.5);
    expect(Math.abs(centerY - y)).toBeLessThan(1.5);
    await page.mouse.up();
    await expect(save).toBeEnabled();
    const edit = await latest();
    if (mode === '클래식') expect(edit.strokes.length).toBeGreaterThan(before.strokes.length);
    const record = mode === '클래식' ? edit.strokes.at(-1)! : edit.restores.at(-1)!;
    const photoScale = (await stage.boundingBox())!.width / size;
    expect(record.radius * photoScale * (mode === '클래식' ? TOUCH_SUPPORT : 1) * 2).toBeCloseTo(diameter, 2);
    const frameWidth = await viewport.evaluate(el => el.clientWidth);
    return { diameter, ratio: outerDiameter / frameWidth, radius: record.radius };
  }
  const fittedTouch = await measure('클래식');
  expect(fittedTouch.ratio).toBeCloseTo(.0355, 4);
  const fittedRestore = await measure('복원');
  const earlier = await latest();
  const { x, y } = await viewportCenter();
  await pinch(page, x, y, 37.5);
  await expect.poll(() => stage.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(1.5, 2);
  expect(await latest()).toEqual(earlier);
  const zoomedTouch = await measure('클래식');
  const zoomedRestore = await measure('복원');
  await expect(slider).toHaveValue('2');
  for (const [fitted, zoomed] of [[fittedTouch, zoomedTouch], [fittedRestore, zoomedRestore]]) {
    expect(fitted.diameter).toBeGreaterThan(0);
    expect(zoomed.diameter).toBeCloseTo(fitted.diameter, 2);
    expect(zoomed.ratio).toBeCloseTo(fitted.ratio, 4);
    expect(zoomed.radius).toBeCloseTo(fitted.radius / 1.5, 3);
  }
  const edit = await latest();
  expect(edit.strokes.slice(0, earlier.strokes.length)).toEqual(earlier.strokes);
  expect(edit.restores.slice(0, earlier.restores.length)).toEqual(earlier.restores);
  const sizeBeforeResize = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: sizeBeforeResize.height });
  await expect.poll(() => viewport.evaluate(el => el.clientWidth)).toBe(292);
  for (const [mode, fitted] of [['클래식', fittedTouch], ['복원', fittedRestore]] as const) {
    const narrow = await measure(mode);
    expect(narrow.diameter).toBeLessThan(fitted.diameter);
    expect(narrow.ratio).toBeCloseTo(fitted.ratio, 4);
  }
});

test('a classic stroke retouches the visible face even when another face was selected', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }));
  const size = 1200;
  const pattern = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M0 0h16v16H0z" fill="#bc8f80"/><path d="M0 0h8v8H0zm8 8h8v8H8z" fill="#523059"/></pattern></defs><rect width="100%" height="100%" fill="url(#grid)"/></svg>`);
  const photo = await sharp(pattern).png().toBuffer();
  const faces = [fixture('first', .22, .42), fixture('second', .78, .42)];
  await page.route('**/retouch/detect.worker.js', route => route.fulfill({ contentType: 'application/javascript',
    body: `self.onmessage=({data:{bitmap}})=>{bitmap.close();self.postMessage({landmarks:${JSON.stringify(faces.map(face => face.landmarks))}});};`,
  }));
  await page.goto('/retouch');
  await page.getByLabel('사진 열기', { exact: true }).setInputFiles({ name: 'two-faces.png', mimeType: 'image/png', buffer: photo });
  const save = page.getByRole('button', { name: 'PNG 저장', exact: true });
  await expect(save).toBeEnabled();
  const strength = page.locator('#retouch-strength');
  await strength.fill('60');
  await expect(save).toBeEnabled();
  const canvas = page.locator('canvas[aria-label="보정 미리보기"]');
  const stage = canvas.locator('..'), viewport = stage.locator('..');
  await page.getByRole('button', { name: '터치 보정', exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const frame = (await viewport.boundingBox())!;
  const fit = (await stage.boundingBox())!;
  await pinch(page, fit.x + fit.width * .78, fit.y + fit.height * .45, 100);
  await expect.poll(() => stage.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(4, 1);
  await page.getByRole('button', { name: '얼굴 보정', exact: true }).click();
  await expect(strength).toHaveValue('60');
  await page.getByRole('button', { name: '터치 보정', exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const zoomed = (await stage.boundingBox())!;
  expect(zoomed.x + zoomed.width * .22).toBeLessThan(frame.x);
  const x = zoomed.x + zoomed.width * .78, y = zoomed.y + zoomed.height * .45;
  const pixels = (right: boolean) => canvas.evaluate((source: HTMLCanvasElement, right) => {
    const crop = document.createElement('canvas');
    crop.width = source.width / 2; crop.height = source.height;
    crop.getContext('2d')!.drawImage(source, right ? crop.width : 0, 0, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return crop.toDataURL();
  }, right);
  // Wait for the zoomed preview to settle before comparing edits at that scale.
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(size);
  await expect(save).toBeEnabled();
  const [leftBefore, rightBefore] = await Promise.all([pixels(false), pixels(true)]);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y, { steps: 4 });
  await page.mouse.up();
  await expect(save).toBeEnabled();
  expect((await pixels(true)) === rightBefore, 'the visible face changes after dragging').toBe(false);
  expect((await pixels(false)) === leftBefore, 'the first face retains its existing edit').toBe(true);

  await page.getByRole('button', { name: '복원', exact: true }).click();
  // Cover the whole stroke, including its falloff around the path.
  await page.locator('#brush-size').fill('16');
  await viewport.scrollIntoViewIfNeeded();
  const view = (await stage.boundingBox())!;
  const restoreX = view.x + view.width * .78, restoreY = view.y + view.height * .45;
  await page.mouse.move(restoreX - 20, restoreY);
  await page.mouse.down();
  await page.mouse.move(restoreX + 44, restoreY, { steps: 12 });
  await page.mouse.up();
  await expect(save).toBeEnabled();
  expect((await pixels(true)) === rightBefore, 'restore clears the second face’s stroke').toBe(true);
  expect((await pixels(false)) === leftBefore, 'restore preserves the first face’s edit').toBe(true);
});

test('partial restore changes touch pixels without jumping the facial preview', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 204, body: '' }));
  const size = 640;
  const grid = Buffer.alloc(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) grid[y * size + x] = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 230 : 60;
  }
  const photo = await sharp(grid, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer();
  await page.route('**/retouch/detect.worker.js', route => route.fulfill({ contentType: 'application/javascript',
    body: `self.onmessage=({data:{bitmap}})=>{bitmap.close();self.postMessage({landmarks:${JSON.stringify([fixture().landmarks])}});};`,
  }));
  await page.goto('/retouch');
  await page.getByLabel('사진 열기', { exact: true }).setInputFiles({ name: 'restore.png', mimeType: 'image/png', buffer: photo });
  const save = page.getByRole('button', { name: 'PNG 저장', exact: true }), strength = page.locator('#retouch-strength');
  await expect(save).toBeEnabled();
  await strength.fill('85');
  await page.getByRole('navigation', { name: '보정 부위' }).getByRole('button', { name: '눈', exact: true }).click();
  await page.locator('[data-control="eyeSize"]').click();
  await strength.fill('85');
  await expect(save).toBeEnabled();

  const canvas = page.locator('canvas[aria-label="보정 미리보기"]');
  const viewport = canvas.locator('../..');
  const crop = (x: number, y: number, width: number, height: number) =>
    canvas.evaluate((source: HTMLCanvasElement, {x, y, width, height}) => {
      const region = document.createElement('canvas');
      region.width = width; region.height = height;
      region.getContext('2d')!.drawImage(source, x, y, width, height, 0, 0, width, height);
      return region.toDataURL();
    }, {x, y, width, height});
  const eyePixels = () => crop(250, 211, 64, 44);
  const erasedCenter = () => crop(215, 284, 6, 6);
  const facialEye = await eyePixels(), facialCenter = await erasedCenter();
  const point = async (x: number, y: number) => {
    const box = (await canvas.boundingBox())!;
    return {x: box.x + box.width * x, y: box.y + box.height * y};
  };
  const drag = async () => {
    const a = await point(.34, .45), b = await point(.387, .456);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
    await expect(save).toBeEnabled();
  };
  await page.getByRole('button', { name: '터치 보정', exact: true }).click();
  await page.locator('#brush-size').fill('4.4');
  await viewport.scrollIntoViewIfNeeded();
  for (let i = 0; i < 4; i++) await drag();
  expect(await erasedCenter() === facialCenter).toBe(false);
  expect(await eyePixels() === facialEye).toBe(true);

  await page.getByRole('button', { name: '복원', exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const a = await point(.34, .45), b = await point(.387, .456);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await expect(save).toBeEnabled();
  expect(await eyePixels() === facialEye, 'eye pixels stay fixed while the restore button is held').toBe(true);
  expect(await erasedCenter() === facialCenter, 'the brushed pixels return to the facial preview').toBe(true);
  await page.mouse.move(b.x, b.y);
  await expect(save).toBeEnabled();
  expect(await eyePixels() === facialEye).toBe(true);
  await page.mouse.up();
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
