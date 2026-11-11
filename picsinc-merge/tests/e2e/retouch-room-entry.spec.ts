import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

const token = 'retouch-entry-fixture';
const roomPath = `/retouch/rooms/${token}`;
const api = `/api/sessions/${token}`;
const png = () => sharp({ create: { width: 16, height: 16, channels: 3, background: '#e4d7ee' } }).png().toBuffer();
async function lobby(page: Page) {
  await page.route(`**${api}`, route => route.fulfill({ json: {
    session: { id: 'session', inviteToken: token, ownerParticipantId: 'owner', originalAssetId: 'original', version: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() },
    currentParticipantId: 'owner', participants: [{ id: 'owner', sessionId: 'session', nickname: '민선', submitted: false }],
    assets: [{ id: 'original', kind: 'original', width: 16, height: 16, contentType: 'image/png' }], originalSelections: [], selections: [], result: null,
  } }));
  await page.route(`**${api}/collaboration`, route => route.fulfill({ json: { enabled: true, phase: 'lobby', rosterIds: [], completedIds: [], personalToken: null, personalMaskAssetId: null, personalState: null, editorId: null, editToken: null, leaseUntil: null, latestAssetId: null, version: 0, history: [] } }));
  await page.route(`**${api}/assets/original`, async route => route.fulfill({ contentType: 'image/png', body: await png() }));
}

// These tests replace HTTP responses. SQL transaction/authorization checks live
// in retouch-room-creation.test.ts; this is not a live two-participant test.
test('retouch keeps the independent editor and creates a room without a consent checkbox with one upload after a lost completion response', async ({ page }) => {
  const paths: string[] = [];
  let prepared = 0, put = 0, completed = 0;
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/')) paths.push(path); });
  await lobby(page);
  await page.route('**/api/retouch/uploads', async route => {
    prepared++;
    expect(route.request().postDataJSON()).toMatchObject({ nickname: '민선', contentType: 'image/png' });
    expect(route.request().postDataJSON()).not.toHaveProperty('consent');
    return route.fulfill({ status: 201, json: { uploadId: 'entry-upload', signedUrl: new URL('/api/fixture-storage', route.request().url()).toString(), token: 'fixture', path: 'fixture.png' } });
  });
  await page.route('**/api/fixture-storage', route => { put++; return route.fulfill({ status: 200, body: '' }); });
  await page.route('**/api/retouch/uploads/entry-upload/complete', route => {
    completed++;
    if (completed === 1) return route.abort('failed');
    return route.fulfill({ status: 201, json: { session: { inviteToken: token }, shareUrl: roomPath, recoveryUrl: `${roomPath}/recover#token=fixture-recovery` } });
  });
  await page.goto('/retouch');
  await expect(page.getByRole('button', { name: 'PNG 저장', exact: true })).toBeVisible();
  expect(paths).toEqual([]);
  await page.getByRole('link', { name: '공동 보정방 만들기', exact: true }).click();
  await expect(page).toHaveURL(/\/retouch\/rooms\/new$/);
  await page.getByLabel('내 이름').fill('민선');
  await expect(page.getByText('01 방 준비', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '원본 사진 올리기 →', exact: true }).click();
  await page.getByLabel('원본 사진 선택').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: await png() });
  const create = page.getByRole('button', { name: '이 사진으로 보정방 만들기', exact: true });
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText('사진과 보정방은 방 생성부터', { exact: false })).toHaveCount(0);
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page).toHaveURL(new RegExp(`${roomPath}$`));
  await expect(page.getByRole('heading', { name: '함께할 친구를 초대해요' })).toBeVisible();
  await expect(page.getByLabel('초대 링크', { exact: true })).toHaveValue(new RegExp(`${roomPath}$`));
  expect({ prepared, put, completed }).toEqual({ prepared: 1, put: 1, completed: 2 });
  expect(paths.some(path => path.startsWith('/api/uploads'))).toBe(false);
  expect(await page.evaluate(key => sessionStorage.getItem(key), `picsinc-recovery:${token}`)).toContain(`${roomPath}/recover#token=fixture-recovery`);
});

test('phone back on the photo step returns to the name step and keeps the name', async ({ page }) => {
  await page.goto('/retouch/rooms/new');
  await page.getByLabel('내 이름').fill('민선');
  await page.getByRole('button', { name: '원본 사진 올리기 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: /원본을 올려주세요/ })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/retouch\/rooms\/new$/);
  await expect(page.getByLabel('내 이름')).toHaveValue('민선');
  await page.goForward();
  await expect(page.getByRole('heading', { name: /원본을 올려주세요/ })).toBeVisible();
  await page.getByRole('button', { name: '이전 화면', exact: true }).click();
  await expect(page.getByLabel('내 이름')).toHaveValue('민선');
  await page.goBack();
  await expect(page).not.toHaveURL(/\/retouch\/rooms\/new$/);
});

test('a name typed before the page finishes starting still turns on the next button', async ({ page }) => {
  let release = () => {};
  const scripts = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/_next/static/**/*.js', async route => { await scripts; await route.continue(); });
  await page.goto('/retouch/rooms/new', { waitUntil: 'commit' });
  await page.getByLabel('내 이름').fill('민선');
  release();
  await expect(page.getByRole('button', { name: '원본 사진 올리기 →', exact: true })).toBeEnabled();
});

test('retouch creation rejects unsupported dimensions before uploading and validates replacement photos', async ({ page }) => {
  const uploads: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/retouch/uploads')) uploads.push(request.url()); });
  await page.goto('/retouch/rooms/new');
  await page.getByLabel('내 이름').fill('민선');
  await expect(page.getByText('01 방 준비', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '원본 사진 올리기 →', exact: true }).click();
  const oversized = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#ddd' } }).png().toBuffer();
  await page.getByLabel('원본 사진 선택').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: oversized });
  await expect(page.getByRole('status')).toContainText('8,192px');
  await expect(page.getByRole('button', { name: '이 사진으로 보정방 만들기', exact: true })).toBeDisabled();
  await page.getByLabel('원본 사진 선택').setInputFiles({ name: 'valid.png', mimeType: 'image/png', buffer: await png() });
  await expect(page.getByRole('button', { name: '이 사진으로 보정방 만들기', exact: true })).toBeEnabled();
  await page.getByLabel('원본 사진 선택').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: await png() });
  await expect(page.getByRole('button', { name: '이 사진으로 보정방 만들기', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '사진 선택 취소' }).click();
  await expect(page.getByRole('button', { name: '이 사진으로 보정방 만들기', exact: true })).toBeDisabled();
  expect(uploads).toEqual([]);
});

test('creation failure keeps the file and retries the same already-uploaded original', async ({ page }) => {
  let prepares = 0, puts = 0, completes = 0;
  await lobby(page);
  await page.route('**/api/retouch/uploads', route => { prepares++; return route.fulfill({ json: { uploadId: 'retry-upload', signedUrl: new URL('/api/fixture-storage', route.request().url()).toString(), token: 'fixture', path: 'fixture.png' } }); });
  await page.route('**/api/fixture-storage', route => { puts++; return route.fulfill({ status: 200, body: '' }); });
  await page.route('**/api/retouch/uploads/retry-upload/complete', route => {
    completes++;
    if (completes === 1) return route.fulfill({ status: 409, json: { error: '파일 확인이 중단되었습니다. 다시 시도해 주세요.' } });
    return route.fulfill({ json: { session: { inviteToken: token }, shareUrl: roomPath, recoveryUrl: `${roomPath}/recover#token=fixture-recovery` } });
  });
  await page.goto('/retouch/rooms/new');
  await page.getByLabel('내 이름').fill('민선');
  await expect(page.getByText('01 방 준비', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '원본 사진 올리기 →', exact: true }).click();
  await page.getByLabel('원본 사진 선택').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: await png() });
  const create = page.getByRole('button', { name: '이 사진으로 보정방 만들기', exact: true });
  await create.click();
  await expect(page.getByRole('status')).toContainText('다시 시도');
  await expect(page.getByText('fixture.png', { exact: true })).toBeVisible();
  await create.click();
  await expect(page).toHaveURL(new RegExp(`${roomPath}$`));
  expect({ prepares, puts, completes }).toEqual({ prepares: 1, puts: 1, completes: 2 });
});

test('retouch recovery reuses the existing credential API and returns to the retouch room', async ({ page }) => {
  await lobby(page);
  let calls = 0;
  await page.route(`**${api}/recover`, route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ token: 'fixture-recovery' });
    return route.fulfill({ json: { participantId: 'owner' } });
  });
  await page.goto(`${roomPath}/recover#token=fixture-recovery`);
  await expect(page).toHaveURL(new RegExp(`${roomPath}$`));
  await expect(page.getByRole('heading', { name: '함께할 친구를 초대해요' })).toBeVisible();
  expect(calls).toBe(1);
});
