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
  await expect(page.getByRole('link', { name: '다른 사진으로 새로 하기' })).toHaveAttribute('href', '/sessions/new');
  await expect(page.getByText('민선 · 예솔의 보정이 모두 반영됐어요.')).toBeVisible();
  await expect(page.getByRole('link', { name: '사진 저장하기' })).toHaveAttribute('href', `${base}/assets/final`);
  // Chromium's download navigation bypasses Playwright routing and reaches the real
  // auth-protected API. Check the API target above; use the identical static PNG
  // only for the browser's download transport, without creating a real room.
  await page.getByRole('link', { name: '사진 저장하기' }).evaluate(link => link.setAttribute('href', '/images/home/four-cut.png'));
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '사진 저장하기' }).click();
  const saved = await download;
  expect(await readFile((await saved.path())!)).toEqual(photo);
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
