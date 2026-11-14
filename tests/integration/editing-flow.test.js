import assert from "node:assert/strict";
import test from "node:test";

import { createEditAuthorization } from "../../src/features/editing/editAuthorization.js";
import { EditingError, createEditingService } from "../../src/features/editing/editingService.js";
import { createInMemoryEditRevisionStore } from "../../src/features/editing/inMemoryEditRevisionStore.js";
import { createFaceClaimService } from "../../src/features/face-claim/faceClaimService.js";
import { createInMemoryFaceClaimStore } from "../../src/features/face-claim/inMemoryFaceClaimStore.js";
import { createFakeMeituBeautyAdapter } from "../../src/integrations/meitu/beauty/meituBeautyAdapter.js";
import { ensurePersonLayerMask } from "../../src/features/person-layer/personLayerPipeline.js";

function createFixture({ beautyFailure = false } = {}) {
  const sessionId = "session-1";
  const sourceMedia = Object.freeze({ data: "immutable-original", dataType: "jpg" });
  const session = Object.freeze({ image: { width: 400, height: 300 }, sourceMedia });
  const layers = new Map([
    ["person-1", { personId: "person-1", faceBox: { x: 50, y: 50, width: 50, height: 50 }, roi: { x: 0, y: 0, width: 160, height: 180 }, maskKey: null }],
    ["person-2", { personId: "person-2", faceBox: { x: 200, y: 60, width: 50, height: 50 }, roi: { x: 150, y: 0, width: 170, height: 180 }, maskKey: null }],
  ]);
  const claimStore = createInMemoryFaceClaimStore();
  const revisions = createInMemoryEditRevisionStore();
  const claims = createFaceClaimService({
    listPersonLayers: async () => [...layers.values()],
    claimStore,
    hasEditRevisions: revisions.hasForPerson,
  });
  const events = [];
  let id = 0;
  const service = createEditingService({
    editAuthorization: createEditAuthorization({ faceClaimService: claims }),
    getPersonLayer: async ({ personId }) => layers.get(personId) ?? null,
    listPersonLayers: async () => [...layers.values()],
    savePersonLayer: async ({ layer }) => { events.push("save-mask"); layers.set(layer.personId, layer); },
    getPhotoSession: async () => session,
    ensurePersonLayerMask,
    cropToRoi: async ({ sourceMedia: received, roi }) => {
      assert.equal(received, sourceMedia);
      events.push("crop");
      return { data: `roi-${roi.x}`, dataType: "jpg" };
    },
    meituClient: { createMattingMask: async () => ({ base64: "mask", dataType: "png" }) },
    prepareAndStoreMask: async ({ collisionBoxes }) => {
      events.push(`mask:${collisionBoxes.length}`);
      return "mask-key-1";
    },
    beautyAdapter: createFakeMeituBeautyAdapter({
      createPatch: async ({ roiMedia, params, maskKey }) => {
        events.push("beauty");
        assert.match(roiMedia.data, /^roi-/);
        assert.equal(maskKey, "mask-key-1");
        if (beautyFailure) throw new Error("timeout");
        return { data: `patch-${params.skinSmoothing ?? 0}`, dataType: "png" };
      },
    }),
    storePatch: async ({ media }) => { events.push("store-patch"); return `patch-key-${media.data}`; },
    revisionStore: revisions,
    createId: () => `revision-${++id}`,
  });
  return { claims, events, layers, revisions, service, sourceMedia };
}

test("an owned selected face gets an ROI-only preview after lazy mask persistence", async () => {
  const fixture = createFixture();
  await fixture.claims.claimPeople({ sessionId: "session-1", personIds: ["person-1"], userId: "user-a" });
  const revision = await fixture.service.requestPreview({
    sessionId: "session-1", personId: "person-1", userId: "user-a",
    controls: { skinSmoothing: 40, makeupStyle: "natural", faceSlimming: -15 },
  });

  assert.deepEqual(revision, {
    revisionId: "revision-1", personId: "person-1",
    params: { skinSmoothing: 40, makeupStyle: "natural", faceSlimming: -15 },
    patchKey: "patch-key-patch-40", status: "preview",
  });
  assert.equal(fixture.layers.get("person-1").maskKey, "mask-key-1");
  assert.deepEqual(fixture.events, ["crop", "mask:1", "save-mask", "crop", "beauty", "store-patch"]);
  assert.equal(fixture.sourceMedia.data, "immutable-original");
});

test("an unowned selection is rejected before mask, vendor, or revision work", async () => {
  const fixture = createFixture();
  await assert.rejects(
    () => fixture.service.requestPreview({ sessionId: "session-1", personId: "person-1", userId: "user-b", controls: { skinSmoothing: 1 } }),
    (error) => error.code === "NOT_CLAIM_OWNER",
  );
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.layers.get("person-1").maskKey, null);
});

test("parallel previews and accepts keep separate immutable revisions", async () => {
  const fixture = createFixture();
  await fixture.claims.claimPeople({ sessionId: "session-1", personIds: ["person-1"], userId: "user-a" });
  const [first, second] = await Promise.all([
    fixture.service.requestPreview({ sessionId: "session-1", personId: "person-1", userId: "user-a", controls: { skinSmoothing: 10 } }),
    fixture.service.requestPreview({ sessionId: "session-1", personId: "person-1", userId: "user-a", controls: { skinSmoothing: 90 } }),
  ]);
  const accepted = await Promise.all([
    fixture.service.acceptPreview({ sessionId: "session-1", revisionId: first.revisionId, userId: "user-a" }),
    fixture.service.acceptPreview({ sessionId: "session-1", revisionId: second.revisionId, userId: "user-a" }),
  ]);
  assert.deepEqual(accepted.map((revision) => revision.status), ["accepted", "accepted"]);
  assert.deepEqual((await fixture.revisions.listByPerson({ sessionId: "session-1", personId: "person-1" })).map((revision) => revision.revisionId).sort(), ["revision-1", "revision-2"]);
  assert.equal(fixture.events.filter((event) => event === "mask:1").length, 1);
});

test("cancel removes only its preview, while a beauty timeout preserves an accepted revision and original", async () => {
  const good = createFixture();
  await good.claims.claimPeople({ sessionId: "session-1", personIds: ["person-1"], userId: "user-a" });
  const accepted = await good.service.requestPreview({ sessionId: "session-1", personId: "person-1", userId: "user-a", controls: { hairEnhancement: 20 } });
  await good.service.acceptPreview({ sessionId: "session-1", revisionId: accepted.revisionId, userId: "user-a" });
  const preview = await good.service.requestPreview({ sessionId: "session-1", personId: "person-1", userId: "user-a", controls: { hairEnhancement: 30 } });
  await good.service.cancelPreview({ sessionId: "session-1", revisionId: preview.revisionId, userId: "user-a" });
  assert.deepEqual((await good.revisions.listByPerson({ sessionId: "session-1", personId: "person-1" })).map((revision) => revision.status), ["accepted"]);

  const failed = createFixture({ beautyFailure: true });
  await failed.claims.claimPeople({ sessionId: "session-1", personIds: ["person-1"], userId: "user-a" });
  await failed.revisions.createPreview({ sessionId: "session-1", revision: { revisionId: "accepted-before", personId: "person-1", params: { skinSmoothing: 2 }, patchKey: "old-patch", status: "preview" } });
  await failed.revisions.acceptPreview({ sessionId: "session-1", revisionId: "accepted-before" });
  await assert.rejects(
    () => failed.service.requestPreview({ sessionId: "session-1", personId: "person-1", userId: "user-a", controls: { skinTone: 10 } }),
    (error) => error instanceof EditingError && error.code === "BEAUTY_FAILED",
  );
  assert.equal((await failed.revisions.get({ revisionId: "accepted-before" })).revision.patchKey, "old-patch");
  assert.equal(failed.sourceMedia.data, "immutable-original");
});
