import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { HeavyTaskGate } from "@/core/heavy-task";
import { OriginalDetectionJobs } from "./original-detection-jobs";
import { SessionError } from "./errors";

const result = { width: 10, height: 10, regions: [], previewPngBase64: "" };
const expiry = () => new Date(Date.now() + 60_000).toISOString();
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test("response scheduling returns before analysis; concurrent callers share one job and failure can retry", async () => {
  const jobs = new OriginalDetectionJobs(new HeavyTaskGate());
  const callbacks: (() => Promise<void>)[] = [];
  const block = deferred<typeof result>(); let calls = 0;
  const first = jobs.start("room", expiry(), callback => { callbacks.push(callback); }, async () => { calls++; return block.promise; });
  assert.equal(jobs.state("room").status, "queued"); assert.equal(calls, 0);
  const duplicate = jobs.start("room", expiry(), () => assert.fail("scheduled twice"), async () => result);
  assert.equal(first.done, duplicate.done);
  const completion = callbacks[0](); await setImmediate();
  assert.equal(jobs.state("room").status, "running"); assert.equal(calls, 1);
  block.resolve(result); assert.deepEqual(await first.done, { result }); await completion;
  assert.equal(jobs.state("room").status, "idle", "completed payload must not be retained in process memory");
  const failed = jobs.start("failure", expiry(), callback => { callbacks.push(callback); }, async () => { throw new SessionError(503, "try again"); });
  const failureDone = failed.done; await callbacks[1](); assert.ok((await failureDone)?.error);
  assert.equal(jobs.state("failure").status, "failed");
  jobs.start("failure", expiry(), callback => { callbacks.push(callback); }, async () => result);
  await callbacks[2](); assert.equal(jobs.state("failure").status, "idle");
});

test("one shared heavy slot, FIFO eight waiting jobs, overflow retry, and synchronous work still gets 429", async () => {
  const gate = new HeavyTaskGate(), jobs = new OriginalDetectionJobs(gate);
  const blocker = deferred<void>();
  const active = gate.run(() => blocker.promise);
  const callbacks: (() => Promise<void>)[] = [], order: number[] = [];
  for (let i = 0; i < 8; i++) jobs.start(`room-${i}`, expiry(), callback => { callbacks.push(callback); }, async () => { order.push(i); return result; });
  const overflow = jobs.start("overflow", expiry(), () => assert.fail("overflow retained a buffer"), async () => result);
  assert.equal(overflow.state.code, "busy");
  const completions = callbacks.map(callback => callback());
  await assert.rejects(gate.run(async () => {}), error => error instanceof SessionError && error.status === 429);
  blocker.resolve(); await active; await Promise.all(completions);
  assert.deepEqual(order, [0,1,2,3,4,5,6,7]);
  jobs.start("overflow", expiry(), callback => { callbacks.push(callback); }, async () => result);
  await callbacks[8]();
});

test("expired queued work never executes and a process restart has no pending job", async () => {
  const start = Date.now(); let now = start;
  const jobs = new OriginalDetectionJobs(new HeavyTaskGate(), () => now);
  let callback!: () => Promise<void>;
  const job = jobs.start("expired", new Date(start + 1000).toISOString(), work => { callback = work; }, async () => { assert.fail("expired job executed"); });
  const done = job.done; now += 1001;
  await callback(); assert.ok((await done)?.error);
  assert.equal(jobs.state("expired").status, "idle");
  assert.equal(new OriginalDetectionJobs(new HeavyTaskGate()).state("expired").status, "idle");
});

test("scheduler errors are observed without rejecting an already-created room", async () => {
  const jobs = new OriginalDetectionJobs(new HeavyTaskGate());
  const job = jobs.start("room", expiry(), () => { throw new Error("schedule unavailable"); }, async () => result);
  assert.equal(job.state.status, "failed");
});
