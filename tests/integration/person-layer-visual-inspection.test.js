import assert from "node:assert/strict";
import test from "node:test";

import { inspectPersonLayers, VisualInspectionError } from "../../src/features/person-layer/personLayerVisualInspection.js";

test("visual inspection makes one detection plus one ROI matting call per face without returning the original", async () => {
  const calls = { detect: 0, mask: 0 };
  const events = [];
  const result = await inspectPersonLayers({
    image: { width: 100, height: 80 },
    sourceMedia: { data: "original-private-base64", dataType: "jpg" },
    meituClient: {
      detectFaces: async () => {
        calls.detect += 1;
        return { faces: [
          { face_rectangle: { left: 0.1, top: 0.2, width: 0.2, height: 0.25 } },
          { face_rectangle: { left: 0.45, top: 0.2, width: 0.2, height: 0.25 } },
        ] };
      },
      createMattingMask: async () => { calls.mask += 1; return { base64: "vendor-mask-should-not-leak", dataType: "jpg" }; },
    },
    imageRuntime: fakeImageRuntime(),
    featherRadius: 1,
    mattingIntervalMs: 0,
    onStatus: (event) => events.push(event),
  });
  assert.deepEqual(calls, { detect: 1, mask: 2 });
  assert.equal(result.meituCalls, 3);
  assert.equal(result.people.length, 2);
  assert.equal(result.people[0].crop.data, "safe-crop");
  assert.equal(result.people[0].originalMask.data, "safe-mask");
  assert.equal(result.people[0].finalMask.data, "safe-mask");
  assert.doesNotMatch(JSON.stringify(result), /original-private|vendor-mask/);
  assert.ok(events.some((event) => event.stage === "segmenting" && event.currentFace === 1));
  assert.ok(events.some((event) => event.stage === "final-mask-ready" && event.currentFace === 2));
});

test("visual inspection assigns overlapping sibling masks to the closest face before feathering", async () => {
  let encoded = [];
  await inspectPersonLayers({
    image: { width: 100, height: 100 }, sourceMedia: { data: "private", dataType: "jpg" }, featherRadius: 1, mattingIntervalMs: 0,
    meituClient: { detectFaces: async () => ({ faces: [
      { face_rectangle: { left: 0, top: 0, width: 0.5, height: 1 } },
      { face_rectangle: { left: 0.5, top: 0, width: 0.5, height: 1 } },
    ] }), createMattingMask: async () => ({ base64: "vendor", dataType: "jpg" }) },
    imageRuntime: {
      cropToRoi: async () => ({ data: "safe-crop", dataType: "jpg" }),
      decodeMask: async () => ({ width: 8, height: 8, alpha: new Uint8Array(64).fill(255) }),
      encodeMask: async (value) => { encoded.push([...value.alpha]); return { base64: "safe", dataType: "png" }; },
    },
  });
  // Both raw masks are encoded first, then each ownership-resolved final mask.
  assert.equal(encoded[2][4 * 8 + 6], 0);
  assert.equal(encoded[2][4 * 8 + 1], 255);
  assert.equal(encoded[3][4 * 8 + 1], 0);
  assert.equal(encoded[3][4 * 8 + 6], 255);
});

test("visual inspection reports the failed face, stage, and safe vendor error code", async () => {
  const statuses = [];
  await assert.rejects(
    () => inspectPersonLayers({
      image: { width: 100, height: 80 }, sourceMedia: { data: "private", dataType: "jpg" },
      meituClient: {
        detectFaces: async () => ({ faces: [
          { face_rectangle: { left: 0.1, top: 0.2, width: 0.2, height: 0.25 } },
          { face_rectangle: { left: 0.45, top: 0.2, width: 0.2, height: 0.25 } },
        ] }),
        createMattingMask: async () => { throw Object.assign(new Error("vendor detail must not escape"), { code: "VENDOR_FAILURE", status: 429, vendorCode: 30017, diagnosticKind: "vendor-response" }); },
      },
      imageRuntime: fakeImageRuntime(), mattingIntervalMs: 0, mattingMaxAttempts: 1, onStatus: (status) => statuses.push(status),
    }),
    (error) => error instanceof VisualInspectionError && error.code === "VENDOR_FAILURE" && error.stage === "segmentation" && error.faceNumber === 1 && error.totalFaces === 2 && error.meituCalls === 2 && error.httpStatus === 429 && error.vendorCode === 30017 && error.diagnosticKind === "vendor-response",
  );
  const failure = statuses.at(-1);
  assert.deepEqual(failure.error, { code: "VENDOR_FAILURE", stage: "segmentation", faceNumber: 1, totalFaces: 2, meituCalls: 2, httpStatus: 429, vendorCode: 30017, diagnosticKind: "vendor-response" });
  assert.doesNotMatch(JSON.stringify(failure), /vendor detail/);
});

test("spaces matting calls and retries only the rate-limited face", async () => {
  let clock = 0;
  const waits = [];
  const mattingInputs = [];
  let firstAttempt = true;
  const result = await inspectPersonLayers({
    image: { width: 100, height: 80 }, sourceMedia: { data: "private", dataType: "jpg" },
    meituClient: {
      detectFaces: async () => ({ faces: [
        { face_rectangle: { left: 0.1, top: 0.2, width: 0.2, height: 0.25 } },
        { face_rectangle: { left: 0.45, top: 0.2, width: 0.2, height: 0.25 } },
      ] }),
      createMattingMask: async (crop) => {
        mattingInputs.push({ data: crop.data, at: clock });
        if (firstAttempt) { firstAttempt = false; throw Object.assign(new Error("qps"), { status: 429, vendorCode: 90024 }); }
        return { base64: "vendor", dataType: "jpg" };
      },
    },
    imageRuntime: {
      cropToRoi: async ({ roi }) => ({ data: `crop-${roi.x}`, dataType: "jpg" }),
      decodeMask: async () => ({ width: 2, height: 2, alpha: new Uint8Array(4).fill(255) }),
      encodeMask: async () => ({ base64: "safe", dataType: "png" }),
    },
    featherRadius: 1,
    mattingIntervalMs: 100,
    mattingMaxAttempts: 3,
    now: () => clock,
    wait: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
  });
  assert.equal(result.meituCalls, 4); // detection + failed face 1 + retried face 1 + face 2
  assert.deepEqual(mattingInputs.map(({ data }) => data), ["crop-0", "crop-0", "crop-32"]);
  assert.deepEqual(mattingInputs.map(({ at }) => at), [100, 200, 300]);
  assert.deepEqual(waits, [100, 100, 100]);
});

function fakeImageRuntime() {
  return {
    cropToRoi: async () => ({ data: "safe-crop", dataType: "jpg" }),
    decodeMask: async () => ({ width: 2, height: 2, alpha: Uint8Array.from([255, 255, 255, 255]) }),
    encodeMask: async () => ({ base64: "safe-mask", dataType: "png" }),
  };
}
