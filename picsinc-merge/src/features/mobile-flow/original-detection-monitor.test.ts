import assert from "node:assert/strict";
import test from "node:test";
import { originalDetectionMonitor } from "./original-detection-monitor";
import type { OriginalDetectionState } from "@/features/photo-session/original-detection-state";

const result = { width: 10, height: 10, regions: [], previewPngBase64: "" };
test("idle resumes once, progress polls, ready loads once, and failure waits for explicit retry", async () => {
  let state: OriginalDetectionState = { status: "idle" }; let starts = 0, loads = 0, applications = 0;
  const monitor = originalDetectionMonitor({ read: async () => state, start: async () => { starts++; return state = { status: "queued" }; }, result: async () => { loads++; return result; }, canApply: () => true, onState: () => {}, onResult: () => { applications++; }, onError: () => {} });
  await Promise.all([monitor.check(), monitor.check()]); assert.equal(starts, 1); assert.equal(monitor.polling(), true);
  state = { status: "ready" }; await monitor.check(); await monitor.check(); assert.equal(loads, 1); assert.equal(applications, 1); assert.equal(monitor.polling(), false);
  state = { status: "failed" }; await monitor.check(); assert.equal(starts, 1); assert.equal(monitor.polling(), false);
  await monitor.check(true); assert.equal(starts, 2);
});

test("leaving the screen stops callbacks without cancelling a job or applying late results to an edited draft", async () => {
  for (const leave of [false, true]) {
    let resolve!: (value: typeof result) => void; let touched = false, applied = 0;
    const monitor = originalDetectionMonitor({ read: async () => ({ status: "ready" }), start: async () => { assert.fail(); }, result: () => new Promise(r => { resolve = r; }), canApply: () => !touched, onState: () => {}, onResult: () => { applied++; }, onError: () => {} });
    const pending = monitor.check(); await Promise.resolve();
    if (leave) monitor.dispose(); else touched = true;
    resolve(result); await pending; assert.equal(applied, 0);
  }
});

test("invitation status does not fetch masks; reconnect can recover a network failure", async () => {
  let failed = true, failures = 0;
  const monitor = originalDetectionMonitor({ read: async () => { if (failed) throw new Error("offline"); return { status: "ready" }; }, start: async () => { assert.fail(); }, result: async () => { assert.fail("invitation downloaded masks"); }, canApply: () => false, onState: () => {}, onResult: () => {}, onError: () => { failures++; } });
  await monitor.check(); assert.equal(failures, 1); assert.equal(monitor.polling(), false);
  failed = false; await monitor.check(); assert.equal(failures, 1);
});
