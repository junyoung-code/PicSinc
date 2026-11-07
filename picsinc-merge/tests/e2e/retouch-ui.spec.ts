import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const output = 'private/retouch-e2e/ui-20261107';
// Layout coverage uses mocked room responses; it does not replace live API tests.
test('Figma retouch screens keep assets and actions inside 402, 390 and 320px', async ({ page }) => {
  await mkdir(output, { recursive: true });
  const photo = await readFile(process.env.RETOUCH_FIXTURE ?? 'test-images/four-women-20260915/01-original.png');
  const { width, height } = await sharp(photo).metadata();
  let phase = 'lobby', joined = false;
  const base = '/api/sessions/ui-style';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === base) return route.fulfill({ status: joined ? 200 : 403, json: joined ? {
      session: { id: 'ui-style', inviteToken: 'ui-style', ownerParticipantId: 'owner', originalAssetId: 'original', version: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() },
      currentParticipantId: 'owner', participants: [{ id: 'owner', nickname: '민선' }, { id: 'friend', nickname: '예솔' }],
      assets: [{ id: 'original', width, height }], originalSelections: [], selections: [], result: null,
    } : { error: '참여할 이름을 입력해주세요.' } });
    if (path === `${base}/collaboration`) return route.fulfill({ json: { enabled: true, phase, rosterIds: phase === 'lobby' ? [] : ['owner', 'friend'], completedIds: phase === 'final' ? ['owner', 'friend'] : [], latestAssetId: phase === 'final' ? 'final' : null, version: 0, history: [] } });
    if (path.startsWith(`${base}/assets/`)) return route.fulfill({ contentType: 'image/png', body: photo });
    return route.fulfill({ json: {} });
  });
  async function capture(name: string, width: number) {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
  }
  for (const width of [402, 390, 320]) {
    await page.setViewportSize({ width, height: 874 });
    await page.goto('/retouch');
    await expect(page.getByRole('link', { name: '공동 보정방 만들기' })).toBeVisible();
    await capture('entry', width);
    await page.getByRole('link', { name: '공동 보정방 만들기' }).click();
    await page.getByLabel('내 이름').fill('민선');
    await capture('new', width);
    await page.getByRole('button', { name: '원본 사진 올리기 →', exact: true }).click();
    await page.getByLabel('원본 사진 선택').setInputFiles({ name: 'my-upload.png', mimeType: 'image/png', buffer: photo });
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '이 사진으로 보정방 만들기' })).toBeEnabled();
    await capture('upload', width);
    joined = false;
    await page.goto('/retouch/rooms/ui-style');
    await page.getByLabel('내 닉네임').fill('예솔');
    await expect(page.getByRole('button', { name: '이 보정방에 참여하기' })).toBeEnabled();
    await capture('join', width);
    joined = true; phase = 'lobby';
    await page.reload();
    await expect(page.getByRole('heading', { name: '함께할 친구를 초대해요' })).toBeVisible();
    await capture('lobby', width);
    phase = 'final';
    await page.reload();
    await expect(page.getByRole('button', { name: '사진 저장' })).toBeEnabled();
    await capture('final', width);
    const icons = await page.locator('img[src$=".svg"]').evaluateAll(images => images.map(image => { const r = image.getBoundingClientRect(); return [r.width, r.height]; }));
    expect(icons.every(([w, h]) => w === 20 && h === 20)).toBe(true);
  }
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto('/retouch');
  await page.getByLabel('사진 열기', { exact: true }).setInputFiles({ name: 'my-upload.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByRole('button', { name: 'PNG 저장', exact: true })).toBeEnabled({ timeout: 100_000 });
  await page.locator('#retouch-strength').fill('25');
  await expect(page.getByRole('button', { name: 'PNG 저장', exact: true })).toBeEnabled();
  await capture('editor', 402);
  const geometry = await page.locator('img[src^="/images/figma-current/editor/"]').evaluateAll(images => images.map(image => {
    const img = image as HTMLImageElement, rect = img.getBoundingClientRect();
    return { file: img.src.split('/').pop(), width: rect.width, height: rect.height, loaded: img.naturalWidth > 0 };
  }));
  expect(geometry).toHaveLength(7); // back, compare and the five original face-shape icons.
  expect(geometry.every(icon => icon.loaded && icon.width >= 16 && icon.width <= 24 && icon.height >= 17 && icon.height <= 24)).toBe(true);
  await expect(page.getByRole('button', { name: '얼굴 보정', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '보정 도구 접기', exact: true }).click();
  await expect(page.locator('#retouch-strength')).toHaveCount(0);
  await page.getByRole('button', { name: '보정 도구 펼치기', exact: true }).click();
  await expect(page.locator('#retouch-strength')).toHaveValue('25');
  for (const group of ['눈', '입술', '코', '눈썹']) {
    await page.getByRole('navigation', { name: '보정 부위' }).getByRole('button', { name: group, exact: true }).click();
    const sourceIcons = page.getByLabel('세부 보정 항목').locator('img');
    await expect.poll(() => sourceIcons.evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await sourceIcons.count()).toBeGreaterThanOrEqual(4);
  }
  await page.getByRole('button', { name: '터치 보정', exact: true }).click();
  await expect(page.getByRole('button', { name: '클래식', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '복원', exact: true }).click();
  await expect(page.getByRole('button', { name: '복원', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '얼굴 보정', exact: true }).click();
  await page.getByRole('navigation', { name: '보정 부위' }).getByRole('button', { name: '얼굴형', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '기능 선택으로' }).click();
  await expect(page).toHaveURL(/\/retouch$/);
  expect(await page.locator('#retouch-strength').inputValue()).toBe('25');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: '기능 선택으로' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});

// Fault injection verifies retry wiring and draft preservation; it is not a live API test.
test('editor loading and save failures retry without replacing the touch draft', async ({ page }) => {
  const width = 400, height = 400;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3; pixels[i] = x % 256; pixels[i + 1] = y % 256; pixels[i + 2] = (x + y) % 256;
  }
  const photo = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const base = '/api/sessions/editor-retry';
  let editorId: string | null = null, imageFetches = 0, failedSaves = 2, uploads = 0;
  const savedStates: unknown[] = [];
  let releaseImage: (() => void) | undefined;
  const firstImageGate = new Promise<void>(resolve => { releaseImage = resolve; });
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === base) return route.fulfill({ json: {
      session: { id: 'editor-retry', inviteToken: 'editor-retry', ownerParticipantId: 'owner', originalAssetId: 'original', version: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() },
      currentParticipantId: 'owner', participants: [{ id: 'owner', nickname: '민선' }, { id: 'friend', nickname: '예솔' }],
      assets: [{ id: 'original', width, height }], originalSelections: [], selections: [], result: null,
    } });
    if (path === `${base}/collaboration`) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        if (body.action === 'acquire') editorId = 'owner';
        if (body.action === 'save') {
          savedStates.push(body.state);
          if (failedSaves-- > 0) return route.fulfill({ status: 503, json: { error: '연결 오류: 저장 재시도가 필요해요.' } });
          editorId = null;
        }
      }
      return route.fulfill({ json: { enabled: true, phase: 'global', rosterIds: ['owner', 'friend'], completedIds: ['owner', 'friend'], latestAssetId: 'result', version: 0, history: [], editorId, editToken: editorId ? 'edit-token' : null, leaseUntil: editorId ? new Date(Date.now() + 90000).toISOString() : null } });
    }
    if (path.startsWith(`${base}/assets/`)) {
      if (request.resourceType() === 'fetch') {
        imageFetches++;
        if (imageFetches === 1) { await firstImageGate; return route.fulfill({ status: 503, body: '' }); }
      }
      return route.fulfill({ contentType: 'image/png', body: photo });
    }
    if (path === `${base}/uploads/edited`) { uploads++; return route.fulfill({ json: { uploadId: 'editor-upload', signedUrl: new URL('/api/editor-storage', request.url()).href, token: 'test', path: 'test' } }); }
    if (path === '/api/editor-storage') return route.fulfill({ status: 200, body: '' });
    if (path === '/api/uploads/editor-upload/complete') return route.fulfill({ json: { asset: { id: 'edited' } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/retouch/rooms/editor-retry');
  await page.getByRole('button', { name: '터치 보정으로 전체 다듬기', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '사진을 불러오고 있어요' })).toBeVisible();
  releaseImage?.();
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  const save = page.getByRole('button', { name: '전체 사진 편집 완료', exact: true });
  await expect(save).toBeEnabled();
  await page.locator('#brush-size').fill('6');
  const canvas = page.locator('canvas[aria-label="보정 미리보기"]');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .4 + 12, box.y + box.height * .4, { steps: 4 }); await page.mouse.up();
  await expect(save).toBeEnabled();
  const draft = await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await save.click();
  const failure = page.getByRole('region', { name: '보정 저장 실패' });
  await expect(failure.getByRole('heading', { name: '전체 사진 보정을 저장하지 못했어요' })).toBeVisible();
  await expect(failure.getByRole('button', { name: '재시도', exact: true })).toBeEnabled();
  await failure.getByRole('button', { name: '편집으로 돌아가기', exact: true }).last().click();
  await expect(page.locator('#brush-size')).toHaveValue('6');
  expect(await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL())).toBe(draft);
  failedSaves = 2;
  await save.click();
  await failure.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.getByRole('button', { name: '터치 보정으로 전체 다듬기', exact: true })).toBeVisible();
  expect(savedStates.length).toBe(5);
  for (const state of savedStates) expect(state).toEqual(savedStates[0]);
  expect(uploads).toBe(1);
  expect(imageFetches).toBe(2);
});
