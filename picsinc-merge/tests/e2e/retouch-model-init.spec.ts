import { devices, expect, test } from '@playwright/test';

const iPhone = devices['iPhone 13'];
// These user agents include Safari but omit the Version token MediaPipe expects.
for (const [browser, product] of [['iOS Chrome', 'CriOS/157.0.0.0 '], ['iOS browser without a version token', '']]) {
  test.describe(browser, () => {
    test.use({
      userAgent: iPhone.userAgent.replace(/Version\/[\d.]+ /, product),
      viewport: iPhone.viewport,
      hasTouch: true,
      isMobile: true,
    });

    test('the real MediaPipe Worker analyzes three selected regions', async ({ page }) => {
      await page.goto('/retouch');
      const result = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 4920;
        canvas.height = 1652;
        canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height);
        const bitmap = await createImageBitmap(canvas);
        const worker = new Worker('/retouch/detect.worker.js');
        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('MediaPipe Worker did not respond')), 30_000);
            worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
            worker.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
            const regions = [500, 1500, 3000].map(x => ({ x, y: 500, width: 400, height: 400 }));
            worker.postMessage({ bitmap, regions }, [bitmap]);
          });
        } finally {
          worker.terminate();
        }
      });
      expect(result).toEqual({ landmarks: [] });
    });
  });
}
