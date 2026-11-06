import { test, expect } from '@playwright/test';

test('default entry and invitation use external-photo merging without collaboration requests', async ({ page }) => {
  const collaborationRequests: string[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/collaboration')) collaborationRequests.push(path);
    if (path.endsWith('/invitation')) return route.fulfill({ json: { ownerNickname: '대표자' } });
    if (path === '/api/sessions/merge-entry') return route.fulfill({ status: 403, json: { error: '참여가 필요합니다.' } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await page.getByRole('link', { name: '사진 합치기', exact: true }).click();
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await expect(page.getByText('MOIRA에서 한 장으로 합쳐요.', { exact: false })).toBeVisible();
  await page.goto('/sessions/merge-entry');
  await expect(page.getByText('평소 쓰는 앱에서 보정하고,', { exact: false })).toBeVisible();
  expect(collaborationRequests).toEqual([]);
});

test('retouch opens independently without room or upload requests', async ({ page }) => {
  const apiRequests: string[] = [];
  await page.route('**/api/**', async route => {
    apiRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 503, json: { error: 'No room backend in this test' } });
  });
  await page.goto('/retouch');
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'PNG 저장', exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
});
