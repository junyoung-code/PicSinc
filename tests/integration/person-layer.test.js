import assert from "node:assert/strict";
import test from "node:test";
import {
  PersonLayerAnalysisError,
  createPersonLayers,
  featherMaskInside,
} from "../../src/features/person-layer/personLayerAnalysis.js";
import {
  MeituDetectionError,
  createMeituDetectionClient,
  createMeituDetectionClientFromEnv,
} from "../../src/integrations/meitu/detection/meituDetectionClient.js";
import {
  detectPersonLayers,
  ensurePersonLayerMask,
} from "../../src/features/person-layer/personLayerPipeline.js";
import {
  collisionBoxesToBlocked,
  createPrepareAndStoreMask,
} from "../../src/features/person-layer/personLayerMaskPreparation.js";
import { createPillowImageRuntime } from "../../src/features/person-layer/pillowImageRuntime.js";

const image = { width: 1_000, height: 800 };
const faces = [
  { face_rectangle: { left: 0.1, top: 0.2, width: 0.15, height: 0.2 } },
  { face_rectangle: { left: 0.6, top: 0.15, width: 0.16, height: 0.22 } },
];

test("creates pending layers from normalized face boxes without masks", () => {
  const layers = createPersonLayers({
    faces,
    image,
    createId: (() => { let count = 0; return () => `person-${++count}`; })(),
  });
  assert.deepEqual(layers[0].faceBox, { x: 100, y: 160, width: 150, height: 160 });
  assert.equal(layers[1].maskKey, null);
  assert.equal(layers[0].personId, "person-1");
  assert.ok(layers.every((layer) => layer.roi.x >= 0 && layer.roi.y >= 0));
});

test("rejects photos without faces but allows sixteen detected faces", () => {
  assert.throws(
    () => createPersonLayers({ faces: [], image }),
    (error) => error instanceof PersonLayerAnalysisError && error.code === "NO_FACE",
  );
  assert.equal(createPersonLayers({ faces: Array.from({ length: 16 }, () => faces[0]), image }).length, 16);
});

test("feathers inward and never expands into neighboring pixels", () => {
  const alpha = Uint8Array.from([0, 0, 0, 0, 255, 255, 0, 255, 255]);
  const feathered = featherMaskInside(alpha, 3, 3, 2);
  assert.equal(feathered[0], 0);
  assert.equal(feathered[4], 0);
  assert.equal(feathered[8], 0);
});

test("uses server environment names and maps vendor no-face errors", async () => {
  const client = createMeituDetectionClientFromEnv(
    { MEITU_APP_KEY: "key", MEITU_SECRET_ID: "secret" },
    { fetchImpl: async () => new Response(JSON.stringify({ ErrorCode: 20003, ErrorMsg: "DETECT_NOT_FACE" }), { status: 400 }) },
  );
  await assert.rejects(
    () => client.detectFaces({ data: "abc" }),
    (error) => error instanceof MeituDetectionError && error.code === "NO_FACE",
  );
});

test("maps Meitu image parsing errors to stable invalid-media errors", async () => {
  const client = createMeituDetectionClient({
    appKey: "key",
    secretId: "secret",
    fetchImpl: async () => new Response(JSON.stringify({ ErrorCode: 10010, ErrorMsg: "LENTP_ERROR" }), { status: 400 }),
  });
  await assert.rejects(
    () => client.detectFaces({ data: "not-an-image" }),
    (error) => error instanceof MeituDetectionError && error.code === "INVALID_MEDIA",
  );
});

test("sends the documented JSON request without exposing auth headers", async () => {
  let captured;
  const client = createMeituDetectionClient({
    appKey: "key",
    secretId: "secret",
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ media_info_list: [{ media_extra: { faces: faces.slice(0, 1) } }] }), { status: 200 });
    },
  });
  await client.detectFaces({ data: "base64-data", dataType: "jpg" });
  assert.match(captured.url, /api_key=key/);
  assert.match(captured.url, /api_secret=secret/);
  assert.equal(captured.options.headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(captured.options.body).parameter.return_landmark, 3);
});

test("detects all faces at upload without calling matting", async () => {
  let mattingCalls = 0;
  const layers = await detectPersonLayers({
    image,
    sourceMedia: { data: "original" },
    meituClient: {
      detectFaces: async () => ({ faces: Array.from({ length: 16 }, () => faces[0]) }),
      createMattingMask: async () => { mattingCalls += 1; },
    },
    createId: (() => { let count = 0; return () => `person-${++count}`; })(),
  });
  assert.equal(layers.length, 16);
  assert.equal(mattingCalls, 0);
  assert.ok(layers.every((layer) => layer.maskKey === null));
});

test("creates and then reuses one selected person's stored mask", async () => {
  const cropped = [];
  const matted = [];
  const stored = [];
  const [layer] = await detectPersonLayers({
    image,
    sourceMedia: { data: "original" },
    meituClient: {
      detectFaces: async () => ({ faces: faces.slice(0, 1) }),
      createMattingMask: async (roiMedia) => {
        matted.push(roiMedia);
        return { base64: "mask", dataType: "jpg" };
      },
    },
    createId: (() => { let count = 0; return () => `person-${++count}`; })(),
  });
  const dependencies = {
    image,
    sourceMedia: { data: "original" },
    meituClient: {
      createMattingMask: async (roiMedia) => {
        matted.push(roiMedia);
        return { base64: "mask", dataType: "jpg" };
      },
    },
    cropToRoi: async ({ roi }) => {
      cropped.push(roi);
      return { data: `crop-${cropped.length}`, dataType: "jpg" };
    },
    prepareAndStoreMask: async ({ personId }) => {
      stored.push(personId);
      return `stored-${stored.length}`;
    },
  };
  const readyLayer = await ensurePersonLayerMask({ layer, ...dependencies });
  const reusedLayer = await ensurePersonLayerMask({ layer: readyLayer, ...dependencies });
  assert.equal(cropped.length, 1);
  assert.equal(matted.length, 1);
  assert.deepEqual(stored, ["person-1"]);
  assert.equal(reusedLayer.maskKey, "stored-1");
});

test("prepares a decoded mask with inward feathering and clips another person's face", async () => {
  let saved;
  const prepareAndStoreMask = createPrepareAndStoreMask({
    imageRuntime: {
      decodeMask: async () => ({ width: 5, height: 5, alpha: new Uint8Array(25).fill(255) }),
      encodeMask: async (media) => ({ ...media, base64: "prepared", dataType: "png" }),
    },
    storeMask: async (entry) => { saved = entry; return entry.key; },
    featherRadius: 1,
    createKey: () => "mask-1",
  });
  const maskKey = await prepareAndStoreMask({
    personId: "person-1",
    roi: { x: 0, y: 0, width: 100, height: 100 },
    base64: "vendor-mask",
    dataType: "jpg",
    collisionBoxes: [{ x: 60, y: 20, width: 40, height: 60 }],
  });
  assert.equal(maskKey, "person-layers/person-1/masks/mask-1.png");
  assert.equal(saved.media.alpha[2 * 5 + 3], 0);
  assert.equal(saved.media.alpha[2 * 5 + 4], 0);
  assert.equal(saved.media.alpha[2 * 5 + 1], 255);
  assert.equal(saved.media.dataType, "png");
});

test("maps collision boxes from original coordinates into ROI-local mask pixels", () => {
  const blocked = collisionBoxesToBlocked({
    roi: { x: 100, y: 100, width: 200, height: 100 },
    width: 4,
    height: 2,
    collisionBoxes: [{ x: 200, y: 100, width: 50, height: 50 }],
  });
  assert.deepEqual([...blocked], [0, 0, 1, 0, 0, 0, 0, 0]);
});

test("Pillow runtime crops server-held source media and round-trips a PNG mask", async () => {
  const runtime = createPillowImageRuntime();
  const source = await runtime.encodeMask({
    alpha: Uint8Array.from([0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 255]),
    width: 4,
    height: 3,
  });
  const crop = await runtime.cropToRoi({
    sourceMedia: { data: source.base64, dataType: source.dataType },
    image: { width: 4, height: 3 },
    roi: { x: 1, y: 1, width: 2, height: 2 },
  });
  assert.deepEqual(crop.image, { width: 2, height: 2 });
  const decoded = await runtime.decodeMask(source);
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 3);
  assert.deepEqual([...decoded.alpha], [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 255]);
});

test("one, three, and ten-person face fixtures remain pending through upload", async () => {
  for (const count of [1, 3, 10]) {
    const fixtureFaces = Array.from({ length: count }, (_, index) => ({
      face_rectangle: {
        left: (index % 5) * 0.19,
        top: Math.floor(index / 5) * 0.42,
        width: 0.16,
        height: 0.2,
      },
    }));
    const layers = await detectPersonLayers({
      image,
      sourceMedia: { data: `fixture-${count}` },
      meituClient: { detectFaces: async () => ({ faces: fixtureFaces }) },
    });
    assert.equal(layers.length, count);
    assert.ok(layers.every((layer) => layer.maskKey === null));
  }
});

test("a failed first-mask attempt does not change the original layer or accepted revision", async () => {
  const layer = Object.freeze({
    personId: "person-1",
    faceBox: { x: 100, y: 100, width: 100, height: 100 },
    roi: { x: 0, y: 0, width: 300, height: 300 },
    maskKey: null,
  });
  const acceptedRevision = Object.freeze({ revisionId: "accepted-1", status: "accepted", patchKey: "patch-1" });
  await assert.rejects(
    () => ensurePersonLayerMask({
      layer,
      image,
      sourceMedia: { data: "original" },
      meituClient: { createMattingMask: async () => { throw new Error("timeout"); } },
      cropToRoi: async () => ({ data: "roi", dataType: "jpg" }),
      prepareAndStoreMask: async () => "should-not-run",
    }),
    /timeout/,
  );
  assert.equal(layer.maskKey, null);
  assert.equal(acceptedRevision.status, "accepted");
  assert.equal(acceptedRevision.patchKey, "patch-1");
});
