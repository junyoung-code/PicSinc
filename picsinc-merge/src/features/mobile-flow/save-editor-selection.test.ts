import test from "node:test";
import assert from "node:assert/strict";
import { RequestError, request } from "./client";
import { saveEditorSelection } from "./save-editor-selection";
import type { FlowSnapshot } from "./flow-state";

const snapshot = (): FlowSnapshot => ({
  session: { id: "room", originalAssetId: "photo", ownerParticipantId: "A", version: 3, createdAt: "", expiresAt: "", inviteToken: "invite" },
  currentParticipantId: "B", participants: [{ id: "B", sessionId: "room", nickname: "B", submitted: false }],
  assets: [{ id: "edit", sessionId: "room", participantId: "B", kind: "edited", width: 10, height: 10, contentType: "image/png", uploadOrder: 1 }],
  originalSelections: [], selections: [],
});
const input = () => ({ base: "/room", snapshot: snapshot(), maskAssetId: "uploaded-mask", selectedRegionIds: ["person-1"], editedAssetId: "edit", saveOriginal: true, submit: true });
const conflict = () => new RequestError("version changed", 409, "SESSION_VERSION_CONFLICT");
function transport(run: (url: string, body?: any) => unknown) {
  return (async (url: string, init?: RequestInit) => run(url, init?.body ? JSON.parse(String(init.body)) : undefined)) as typeof request;
}

test("participant submission retries a room conflict once with the same uploaded mask", async () => {
  const writes: any[] = []; let reads = 0;
  await saveEditorSelection(input(), transport((url, body) => {
    if (!body) { reads++; const fresh = snapshot(); fresh.session.version = 4; fresh.participants.push({ id: "C", sessionId: "room", nickname: "C", submitted: false }); return fresh; }
    writes.push({ url, ...body });
    if (writes.length === 1) throw conflict();
    return { version: body.expectedVersion + 1 };
  }));
  assert.equal(reads, 1);
  assert.deepEqual(writes.map(w => [w.url, w.expectedVersion, w.maskAssetId]), [["/room/original-selection", 3, "uploaded-mask"], ["/room/original-selection", 4, "uploaded-mask"], ["/room/selection", 5, "uploaded-mask"]]);
});

test("conflict between participant original save and submission retries only submission", async () => {
  const writes: any[] = [];
  await saveEditorSelection(input(), transport((url, body) => {
    if (!body) { const fresh = snapshot(); fresh.session.version = 5; fresh.originalSelections = [{ participantId: "B", maskAssetId: "uploaded-mask", selectedRegionIds: ["person-1"] }]; return fresh; }
    writes.push({ url, ...body });
    if (writes.length === 2) throw conflict();
    return { version: body.expectedVersion + 1 };
  }));
  assert.deepEqual(writes.map(w => [w.url, w.expectedVersion]), [["/room/original-selection", 3], ["/room/selection", 4], ["/room/selection", 5]]);
});

test("another device's own work is never automatically overwritten", async () => {
  for (const change of [
    (fresh: FlowSnapshot) => { fresh.originalSelections = [{ participantId: "B", maskAssetId: "other-mask", selectedRegionIds: ["person-1"] }]; },
    (fresh: FlowSnapshot) => { fresh.selections = [{ participantId: "B", editedAssetId: "edit", maskAssetId: "other-mask" }]; },
    (fresh: FlowSnapshot) => { fresh.participants[0].submitted = true; },
    (fresh: FlowSnapshot) => { fresh.assets.push({ ...fresh.assets[0], id: "new-edit" }); },
  ]) {
    let writes = 0;
    await assert.rejects(saveEditorSelection(input(), transport((_url, body) => {
      if (body) { writes++; throw conflict(); }
      const fresh = snapshot(); fresh.session.version = 4; change(fresh); return fresh;
    })), (error: unknown) => error instanceof RequestError && error.code === "OWN_WORK_CHANGED");
    assert.equal(writes, 1);
  }
});

test("ownership, expiry, network and untyped conflicts are not retried", async () => {
  for (const error of [new RequestError("someone else's region", 409), new RequestError("expired", 410), new TypeError("network")]) {
    let calls = 0;
    await assert.rejects(saveEditorSelection(input(), transport(() => { calls++; throw error; })), e => e === error);
    assert.equal(calls, 1);
  }
});

test("repeated room conflicts stop after one retry for the entire submission", async () => {
  let writes = 0, reads = 0;
  await assert.rejects(saveEditorSelection(input(), transport((_url, body) => {
    if (body) { writes++; throw conflict(); }
    reads++; const fresh = snapshot(); fresh.session.version = 4; return fresh;
  })), (error: unknown) => error instanceof RequestError && error.code === "SESSION_VERSION_CONFLICT");
  assert.equal(writes, 2); assert.equal(reads, 1);
});

test("owner original save and review submission keep their existing single-write flow", async () => {
  for (const saveOriginal of [true, false]) {
    const writes: string[] = [];
    await saveEditorSelection({ ...input(), saveOriginal, submit: !saveOriginal }, transport((url, body) => { writes.push(url); return { version: body.expectedVersion + 1 }; }));
    assert.deepEqual(writes, [saveOriginal ? "/room/original-selection" : "/room/selection"]);
  }
});
