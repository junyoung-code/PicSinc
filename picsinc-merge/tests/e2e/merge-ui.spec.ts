import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';

// HTTP fixtures exercise the UI without creating rooms or uploading private media.
for (const width of [402, 390, 320]) test(`merge flow and PNG saving at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 874 });
  const output = 'private/merge-ui-20261107';
  await mkdir(output, { recursive: true });
  const photo = await readFile('public/images/home/four-cut.png');
  const { width: pw, height: ph } = await sharp(photo).metadata();
  let joined = true, owner = true, submitted = false, result = false, selected = false;
  let uploadKind = 'original';
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = '/api/sessions/merge-ui';
  const snapshot = () => ({ session: { id: 'room', inviteToken: 'merge-ui', originalAssetId: 'original', ownerParticipantId: 'owner', version: 1, expiresAt: new Date(Date.now()+86400000).toISOString() }, currentParticipantId: owner ? 'owner' : 'friend', participants: [{ id: 'owner', nickname: '민선', submitted }, { id: 'friend', nickname: '예솔', submitted }], assets: [{ id: 'original', kind: 'original', width: pw, height: ph }, ...(selected ? [{ id: 'edited', kind: 'edited', participantId: owner ? 'owner' : 'friend', width: pw, height: ph, uploadOrder: 1 }] : [])], originalSelections: selected ? [{ participantId: owner ? 'owner' : 'friend', maskAssetId: 'mask', selectedRegionIds: [] }] : [], selections: [], result: result ? { version: 1, resultAssetId: 'final', previewAssetId: 'final', unassignedOverlapPixels: 0 } : null });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') writes.push(path);
    if (path === base) return route.fulfill({ status: joined ? 200 : 403, json: joined ? snapshot() : { error: '참여가 필요해요' } });
    if (path.endsWith('/invitation')) return route.fulfill({ json: { ownerNickname: '민선' } });
    if (path.endsWith('/participants')) { joined = true; return route.fulfill({ json: {} }); }
    if (path.endsWith('/original-detection')) return route.fulfill({ json: { status: 'ready' } });
    if (path.endsWith('/region-claims')) return route.fulfill({ json: { claims: [] } });
    if (path.endsWith('/regions')) return route.fulfill({ json: { job: { id: 'detect', status: 'ready', resultUrl: '/api/detected' } } });
    if (path === '/api/detected') return route.fulfill({ json: { width: pw, height: ph, previewPngBase64: '', regions: [] } });
    if (path === '/api/uploads' || path.includes('/uploads/edited') || path.includes('/uploads/mask')) { uploadKind = path.endsWith('edited') ? 'edited' : path.endsWith('mask') ? 'mask' : 'original'; return route.fulfill({ json: { uploadId: 'fixture', signedUrl: '/api/mock-storage', token: 'fixture', path: 'fixture' } }); }
    if (path === '/api/uploads/fixture/complete') { if (uploadKind === 'original') return route.fulfill({ json: { shareUrl: '/sessions/merge-ui', recoveryUrl: '/sessions/merge-ui', session: { inviteToken: 'merge-ui' } } }); selected = true; return route.fulfill({ json: { asset: { id: uploadKind } } }); }
    if (path.endsWith('/original-selection')) { selected = true; return route.fulfill({ json: { version: 1 } }); }
    if (path.endsWith('/selection')) { submitted = true; return route.fulfill({ json: { version: 1 } }); }
    if (path.endsWith('/compose')) { result = true; return route.fulfill({ json: { result: snapshot().result } }); }
    if (path.includes('/assets/')) return route.fulfill({ contentType: 'image/png', headers: path.endsWith('/final') ? { 'content-disposition': 'attachment; filename="moira-final.png"' } : {}, body: photo });
    return route.fulfill({ json: {} });
  });
  async function capture(name: string) {
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator('img').evaluateAll(imgs => imgs.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
  }
  await page.goto('/sessions/new');
  await expect(page.getByRole('heading', { name: '친구들과 각자 보정하고 한 장으로 합쳐보세요' })).toBeVisible();
  await capture('intro');
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await page.getByLabel('대표자 이름').fill('민선');
  await capture('start');
  await page.getByRole('button', { name: '원본 사진 올리기', exact: true }).click();
  await capture('upload-empty');
  await page.getByLabel('원본 사진 선택', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByRole('button', { name: '이 사진으로 보정방 만들기' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '이 사진으로 보정방 만들기' }).click();
  await expect(page.getByRole('heading', { name: '보정방이 만들어졌어요' })).toBeVisible();
  await capture('invite');
  await page.getByRole('button', { name: '도움말', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await page.getByRole('button', { name: '영역 편집하기' }).click();
  await expect(page.getByRole('dialog', { name: '내 영역 선택' })).toBeVisible();
  await page.getByRole('button', { name: '브러시', exact: true }).click();
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down(); await page.mouse.move(box.x+box.width/2+15,box.y+box.height/2+20,{ steps: 4 }); await page.mouse.up();
  await capture('detail');
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.getByRole('button', { name: '이대로 진행하기' }).click();
  await expect(page.getByRole('heading', { name: '보정이 끝난 사진을 올려주세요' })).toBeVisible();
  await page.getByLabel('보정한 사진 선택', { exact: true }).setInputFiles({ name: 'edited.png', mimeType: 'image/png', buffer: photo });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '계속', exact: true }).click();
  await expect(page.getByRole('button', { name: '사진 합치기' })).toBeEnabled();
  await capture('status');
  await page.getByRole('button', { name: '사진 합치기' }).click();
  await expect(page.getByRole('link', { name: '사진 저장하기' })).toBeVisible();
  await capture('result');
  // Figma 586:12772: no badge or green summary, "처음부터 다시 만들기" + "사진 저장하기".
  await expect(page.getByRole('link', { name: '처음부터 다시 만들기' })).toHaveAttribute('href', '/sessions/new');
  await expect(page.getByText('우리의 보정, 완료!')).toHaveCount(0);
  await expect(page.getByText('의 보정이 모두 반영됐어요', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '사진 저장하기' })).toHaveAttribute('href', `${base}/assets/final`);
  // Chromium's download navigation bypasses Playwright routing and reaches the real
  // auth-protected API. Check the API target above; use the identical static PNG
  // only for the browser's download transport, without creating a real room.
  await page.getByRole('link', { name: '사진 저장하기' }).evaluate(link => link.setAttribute('href', '/images/home/four-cut.png'));
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '사진 저장하기' }).click();
  const saved = await download;
  expect(await readFile((await saved.path())!)).toEqual(photo);
  await expect(page.getByRole('status').filter({ hasText: '✓ 사진을 저장했어요' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '✓ 사진을 저장했어요' })).toHaveCount(0, { timeout: 5000 });
  joined = false; owner = false; submitted = false; result = false; selected = false;
  await page.goto('/sessions/merge-ui');
  await page.getByLabel('내 이름').fill('예솔');
  await capture('participant-join');
  await page.getByRole('button', { name: '참여하기', exact: true }).click();
  await expect(page.getByRole('button', { name: '이미 보정했어요' })).toBeVisible();
  await expect(page.getByRole('link', { name: '원본 사진 저장하기' })).toHaveCount(0);
  submitted = true;
  await page.goto('/sessions/merge-ui?step=status');
  await expect(page.getByRole('button', { name: '사진 합치기' })).toHaveCount(0);
  await capture('participant-wait');
  expect(writes).toContain(`${base}/original-selection`);
  expect(writes).toContain(`${base}/selection`);
  expect(errors).toEqual([]);
});

// Exception fixtures validate recoverable UI states, without creating real jobs or changing photos.
test('merge delay, failure and retry preserve submitted work', async ({ page }, testInfo) => {
  const photo = await readFile('public/images/figma-current/character-photo.png');
  const base = '/api/sessions/merge-errors';
  let failJob = false, completed = false, compositions = 0;
  const snapshot = () => ({
    session: { id: 'room', inviteToken: 'merge-errors', originalAssetId: 'original', ownerParticipantId: 'owner', version: 1, expiresAt: new Date(Date.now() + 86400000).toISOString() },
    currentParticipantId: 'owner', participants: [{ id: 'owner', nickname: '민선', submitted: true }],
    assets: [{ id: 'original', kind: 'original', width: 104, height: 155 }], originalSelections: [], selections: [],
    result: completed ? { version: 1, resultAssetId: 'final', previewAssetId: 'final', unassignedOverlapPixels: 0 } : null,
  });
  await page.clock.install();
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === base) return route.fulfill({ json: snapshot() });
    if (path.endsWith('/compose')) {
      compositions += 1;
      if (compositions > 1) { completed = true; return route.fulfill({ json: { result: snapshot().result } }); }
      return route.fulfill({ json: { job: { id: 'merge-job', status: 'queued' } } });
    }
    if (path.endsWith('/jobs/merge-job')) return route.fulfill({ json: { job: { id: 'merge-job', status: failJob ? 'failed' : 'running', error: failJob ? '사진을 합치지 못했어요. 다시 시도해 주세요.' : undefined } } });
    if (path.endsWith('/assets/final')) return route.fulfill({ contentType: 'image/png', body: photo });
    return route.fulfill({ json: {} });
  });
  await page.goto('/sessions/merge-errors?step=status');
  await page.getByRole('button', { name: '사진 합치기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '각자의 보정을 한 장에 담고 있어요' })).toBeVisible();
  const characters = page.locator('[data-loading-characters]');
  await expect(characters).toBeVisible();
  await expect(characters).toHaveAttribute('aria-hidden', 'true');
  const description = page.locator('.merging-screen .description');
  await expect(description).toHaveText('처리 순서를 기다리고 있어요. 잠시 후 다시 확인해도 됩니다.');
  // Seek real CSS animations to the first jump apex; other characters still rest.
  for (const width of [402, 390, 320]) {
    await page.setViewportSize({ width, height: 874 });
    // The queued notice breaks between its two sentences, never inside one.
    expect(await description.evaluate(element => (element as HTMLElement).innerText)).toBe('처리 순서를 기다리고 있어요.\n잠시 후 다시 확인해도 됩니다.');
    expect(await description.evaluate(element => Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)))).toBe(2);
    const positions = await characters.evaluate(element => {
      for (const animation of element.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 590; }
      return [...element.querySelectorAll('span > span:last-child')].map(character => {
        const rect = character.getBoundingClientRect();
        return { top: rect.top, left: rect.left, right: rect.right, height: rect.height };
      });
    });
    expect(positions).toHaveLength(5);
    expect(positions[0].top).toBeLessThan(positions[1].top - 10);
    for (const position of positions) { expect(position.left).toBeGreaterThanOrEqual(0); expect(position.right).toBeLessThanOrEqual(width); expect(position.height).toBeGreaterThan(35); }
    await page.screenshot({ path: testInfo.outputPath(`loading-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await characters.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('heading', { name: '평소보다 오래 걸리고 있어요' })).toBeVisible();
  await expect(characters).toBeVisible();
  await expect(page.getByText('잠시만 기다려 주세요.', { exact: false })).toBeVisible();
  await expect(page.getByText(/(?:최대 3분|5분 정도)/)).toHaveCount(0);
  failJob = true;
  await page.clock.runFor(4000);
  await expect(page.getByText('사진을 합치지 못했어요. 다시 시도해 주세요.')).toBeVisible();
  expect(await page.locator('.status-message').evaluate(element => (element as HTMLElement).innerText)).toBe('사진을 합치지 못했어요.\n다시 시도해 주세요.');
  await expect(page.getByText('제출 완료', { exact: true })).toBeVisible();
  await expect(characters).toHaveCount(0);
  await page.getByRole('button', { name: '사진 합치기', exact: true }).click();
  await expect(page.getByRole('link', { name: '사진 저장하기' })).toBeVisible();
  expect(compositions).toBe(2);
  // Figma 586:12772 result: no badge or green summary; saving shows the 859:25318 notice above the buttons.
  await expect(page.getByText('우리의 보정, 완료!')).toHaveCount(0);
  await expect(page.getByText('의 보정이 모두 반영됐어요', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '처음부터 다시 만들기' })).toHaveAttribute('href', '/sessions/new');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '사진 저장하기' }).click();
  expect(await readFile((await (await download).path())!)).toEqual(photo);
  const notice = page.getByRole('status').filter({ hasText: '✓ 사진을 저장했어요' });
  await expect(notice).toBeVisible();
  for (const width of [402, 320]) {
    await page.setViewportSize({ width, height: 874 });
    const [toast, first] = await Promise.all([notice.boundingBox(), page.getByRole('link', { name: '처음부터 다시 만들기' }).boundingBox()]);
    expect(toast!.x).toBeGreaterThanOrEqual(0); expect(toast!.x + toast!.width).toBeLessThanOrEqual(width);
    expect(toast!.y + toast!.height).toBeLessThanOrEqual(first!.y);
    await page.screenshot({ path: testInfo.outputPath(`result-saved-${width}.png`) });
  }
  await page.clock.runFor(3000);
  await expect(notice).toHaveCount(0);
});

for (const owner of [true, false]) test(`merge result preview recovery and owner-only actions (${owner ? 'owner' : 'participant'})`, async ({ page }) => {
  const photo = await readFile('public/images/figma-current/character-photo.png');
  const base = '/api/sessions/merge-result-errors';
  let previewRequests = 0;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === base) return route.fulfill({ json: {
      session: { id: 'room', inviteToken: 'merge-result-errors', originalAssetId: 'original', ownerParticipantId: 'owner', version: 2, expiresAt: new Date(Date.now() + 86400000).toISOString() },
      currentParticipantId: owner ? 'owner' : 'friend', participants: [{ id: 'owner', nickname: '민선', submitted: true }, { id: 'friend', nickname: '예솔', submitted: true }],
      assets: [{ id: 'original', kind: 'original', width: 104, height: 155 }], originalSelections: [], selections: [],
      result: { version: 1, resultAssetId: 'final', previewAssetId: 'preview', unassignedOverlapPixels: 12 },
    } });
    if (url.pathname.endsWith('/assets/preview')) {
      previewRequests += 1;
      return url.searchParams.has('retry') ? route.fulfill({ contentType: 'image/png', body: photo }) : route.fulfill({ status: 503, body: '' });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/sessions/merge-result-errors?step=result');
  await expect(page.getByRole('alert')).toContainText('완성된 사진을 불러오지 못했어요');
  await expect(page.getByRole('link', { name: '사진 저장하기' })).toHaveAttribute('href', `${base}/assets/final`);
  await page.getByRole('button', { name: '사진 다시 불러오기' }).click();
  await expect.poll(() => page.getByAltText('함께 보정한 최종 사진').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(previewRequests).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('button', { name: '겹친 영역 확인하기' })).toHaveCount(owner ? 1 : 0);
  await expect(page.getByRole('button', { name: '제출 현황으로 돌아가기' })).toHaveCount(owner ? 1 : 0);
  if (owner) {
    await page.getByRole('button', { name: '제출 현황으로 돌아가기' }).click();
    await expect(page.getByRole('button', { name: '사진 합치기', exact: true })).toBeEnabled();
  }
});
