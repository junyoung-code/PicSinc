import { test, expect } from "@playwright/test";

for (const width of [402, 390, 320]) {
  test(`home splash, two feature entries and layout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 874 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.goto("/");
    await expect(page.getByLabel("PicSync 시작 화면")).toBeVisible();
    await page.clock.runFor(1600);
    const choices = page.getByRole("navigation", { name: "사진 기능 선택" });
    await expect(choices.getByRole("link")).toHaveCount(2);
    await expect(page.getByLabel("PicSync 시작 화면")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "함께 보정", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "사진 합치기", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator("main img").evaluateAll(images => images.every(image => {
      const img = image as HTMLImageElement;
      return img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0;
    }))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cards = await choices.getByRole("link").evaluateAll(links => links.map(link => {
      const rect = link.getBoundingClientRect();
      return { width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    }));
    for (const card of cards) {
      expect(card.width).toBeGreaterThan(250);
      expect(card.height).toBeGreaterThan(220);
      expect(card.right).toBeLessThanOrEqual(width);
      expect(card.bottom).toBeLessThanOrEqual(874);
    }
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true });
    await page.getByRole("link", { name: "함께 보정", exact: true }).click();
    await expect(page).toHaveURL(/\/retouch$/);
    await expect(page.getByRole("link", { name: "공동 보정방 만들기", exact: true })).toBeVisible();
    await expect(page.getByLabel("PicSync 시작 화면")).toHaveCount(0);
    await page.goBack();
    await expect(choices).toBeVisible();
    await expect(page.getByLabel("PicSync 시작 화면")).toHaveCount(0);
    await page.getByRole("link", { name: "사진 합치기", exact: true }).click();
    await expect(page).toHaveURL(/\/sessions\/new$/);
    await expect(page.getByRole("button", { name: "시작하기", exact: true })).toBeVisible();
    await expect(page.getByLabel("PicSync 시작 화면")).toHaveCount(0);
    await page.getByRole("button", { name: "시작하기", exact: true }).click();
    await expect(page.getByLabel("대표자 이름")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("direct merge entry does not show a duplicate splash", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/sessions/new");
  await expect(page.getByRole("button", { name: "시작하기", exact: true })).toBeVisible();
  await expect(page.getByLabel("PicSync 시작 화면")).toHaveCount(0);
});

// HTTP substitutes isolate entry routing; these do not verify a live room or DB.
for (const path of ["/sessions/home-invite", "/retouch/rooms/home-invite", "/sessions/home-invite/collaboration"]) {
  test(`invitation opens directly: ${path}`, async ({ page }) => {
    const navigations: string[] = [];
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname); });
    await page.route("**/api/sessions/home-invite", route => route.fulfill({ status: 403, json: { error: "참여 후 이용해주세요." } }));
    await page.route("**/api/sessions/home-invite/invitation", route => route.fulfill({ json: { ownerNickname: "민선" } }));
    await page.goto(path);
    await expect(page.getByLabel("내 이름", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "참여하기", exact: true })).toBeDisabled();
    await page.getByLabel("내 이름", { exact: true }).fill("친구");
    await expect(page.getByRole("button", { name: "참여하기", exact: true })).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe(path);
    // Next's same-URL history replacement may emit another navigation event.
    expect([...new Set(navigations)]).toEqual([path]);
    await expect(page.getByLabel("PicSync 시작 화면")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "사진 기능 선택" })).toHaveCount(0);
  });
}
