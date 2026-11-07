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
