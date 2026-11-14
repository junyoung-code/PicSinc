import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRun } from "./festival-watch-summary";

test("summarizes one original upload and one detected job without exposing identifiers", () => {
  const startedAt = "2026-09-26T00:00:00.000Z";
  const result = summarizeRun({ startedAt, targetTeams: 5, prefix: "BTEST" }, [
    { id: "private-upload", session_id: "private-room", nickname: "BTEST-1", status: "ready", created_at: startedAt, byte_size: 1000 },
    { id: "other-upload", session_id: "other-room", nickname: "OTHER", status: "ready", created_at: startedAt, byte_size: 2000 },
  ], [{ id: "private-room", created_at: "2026-09-26T00:00:04.000Z" }], [
    { id: "private-job", session_id: "private-room", kind: "detect", status: "ready", created_at: "2026-09-26T00:00:04.000Z", updated_at: "2026-09-26T00:00:20.000Z", attempts: 1 },
  ], new Map([["private-job", { runningAt: Date.parse("2026-09-26T00:00:07.000Z") }]]), 1);
  assert.equal(result.observedTeams, 1);
  assert.equal(result.uploadedTeams, 1);
  assert.equal(result.completedJobs, 1);
  assert.equal(result.teams[0].uploadMs, 4000);
  assert.equal(result.teams[0].queueMs, 3000);
  assert.equal(result.teams[0].processingMs, 13000);
  assert.equal(result.bottleneck, "YOLO 처리·전송");
  assert.doesNotMatch(JSON.stringify(result), /private-|BTEST|OTHER/);
});

test("uses imported browser phases while keeping DB room and job timing", () => {
  const start = "2026-09-26T00:00:00.000Z";
  const result = summarizeRun({ startedAt: start, targetTeams: 1, prefix: "BTEST" }, [
    { id: "u", session_id: "r", nickname: "BTEST-1", status: "ready", created_at: start, byte_size: 100 },
  ], [{ id: "r", created_at: "2026-09-26T00:00:10.000Z" }], [], new Map(), 0, Date.parse(start), new Map([
    ["u", { uploadId: "u", prepareMs: 1000, storageMs: 7000, completeMs: 2000, totalMs: 10000, status: "ready" }],
  ]));
  assert.equal(result.p95StorageMs, 7000);
  assert.equal(result.p95VerificationMs, 2000);
  assert.equal(result.bottleneck, "Storage 전송");
});
