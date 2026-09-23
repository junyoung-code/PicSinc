import test from "node:test";
import assert from "node:assert/strict";
import { allowedStep, resumeStep, type FlowSnapshot } from "./flow-state";
import { runHeavyTask } from "@/core/heavy-task";
const snapshot = (): FlowSnapshot => ({ session: { id: "room", originalAssetId: "original", ownerParticipantId: "A", version: 1, createdAt: "", expiresAt: "", inviteToken: "invite" }, currentParticipantId: "B", participants: [{ id: "A", sessionId: "room", nickname: "A", submitted: false }, { id: "B", sessionId: "room", nickname: "B", submitted: false }], assets: [], originalSelections: [], selections: [] });
test("participant links allow upload first but cannot skip an edit or grant owner screens", () => {
  const data = snapshot(); assert.equal(allowedStep("upload", data), "upload"); assert.equal(allowedStep("select", data), "guide"); assert.equal(allowedStep("review", data), "guide"); assert.equal(allowedStep("invite", data), "guide"); assert.equal(allowedStep("overlap", data), "guide"); assert.equal(allowedStep("result", data), "guide");
});
test("resume follows saved data; stale result does not hide pending submission", () => {
  const data = snapshot(); assert.equal(resumeStep(data), "guide");
  data.originalSelections.push({ participantId: "B", maskAssetId: "mask", selectedRegionIds: [] }); assert.equal(resumeStep(data), "guide");
  data.assets.push({ id: "edit", sessionId: "room", participantId: "B", kind: "edited", uploadOrder: 1, width: 10, height: 10, contentType: "image/png" }); assert.equal(resumeStep(data), "select");
  data.participants[1].submitted = true; assert.equal(resumeStep(data), "status");
  data.result = { sessionId: "room", version: 1, previewAssetId: "p", resultAssetId: "r", width: 10, height: 10, unassignedOverlapPixels: 0 }; assert.equal(resumeStep(data), "result");
  data.session.version = 2; assert.equal(resumeStep(data), "status");
});
test("owner resumes original selection then upload, including a failed automatic submission", () => {
  const data = snapshot(); data.currentParticipantId = "A";
  assert.equal(resumeStep(data), "select"); assert.equal(allowedStep("upload", data), "select");
  data.originalSelections.push({ participantId: "A", maskAssetId: "mask", selectedRegionIds: ["person_001"] });
  assert.equal(resumeStep(data), "upload");
  data.assets.push({ id: "edit", sessionId: "room", participantId: "A", kind: "edited", uploadOrder: 1, width: 10, height: 10, contentType: "image/png" });
  assert.equal(resumeStep(data), "upload");
  data.participants[0].submitted = true; assert.equal(resumeStep(data), "status");
  data.participants[0].submitted = false;
  data.result = { sessionId: "room", version: 1, previewAssetId: "p", resultAssetId: "r", width: 10, height: 10, unassignedOverlapPixels: 0 };
  assert.equal(resumeStep(data), "result");
});
test("heavy task rejects concurrent requests and releases capacity after failure", async () => {
  let release!: () => void;
  const first = runHeavyTask(() => new Promise<void>(resolve => { release = resolve; }));
  await assert.rejects(runHeavyTask(async () => "second"), (e: any) => e.status === 429); release(); await first;
  await assert.rejects(runHeavyTask(async () => { throw new Error("failed"); }));
  assert.equal(await runHeavyTask(async () => "recovered"), "recovered");
});
