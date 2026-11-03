import assert from "node:assert/strict";
import test from "node:test";
import { pollingDelay, visiblePolling } from "./polling";

test("poll failures back off to a one minute ceiling and success restores the base interval", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(failures => pollingDelay(3000, failures)),
    [3000, 6000, 12000, 24000, 48000, 48000]);
  assert.equal(pollingDelay(5000, 0), 5000);
});

test("visible polling skips hidden screens and overlapping requests, then checks on return", async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let visibilityState = "visible", tick!: () => void, resume!: () => void;
  let calls = 0, finish!: () => void;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval: () => {} , addEventListener: () => {}, removeEventListener: () => {} } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get visibilityState() { return visibilityState; }, addEventListener: (_: string, callback: () => void) => { resume = callback; }, removeEventListener: () => {} } });
  try {
    const stop = visiblePolling(3000, () => { calls++; return new Promise<void>(resolve => { finish = resolve; }); });
    assert.equal(calls, 1);
    tick(); tick(); assert.equal(calls, 1);
    finish(); await Promise.resolve();
    visibilityState = "hidden"; resume(); tick(); assert.equal(calls, 1);
    visibilityState = "visible"; resume(); assert.equal(calls, 2);
    finish(); await Promise.resolve(); stop(); tick(); assert.equal(calls, 2);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});
