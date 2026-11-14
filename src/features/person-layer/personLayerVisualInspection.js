import { detectPersonLayers } from "./personLayerPipeline.js";
import { featherMaskInside } from "./personLayerAnalysis.js";
import { assignMaskOverlapToClosestFace, countFaceBoxesInsideRoi } from "./personLayerMaskOverlap.js";

export class VisualInspectionError extends Error {
  constructor({ code, stage, faceNumber, totalFaces, meituCalls, httpStatus, vendorCode, diagnosticKind, cause }) {
    super("Visual inspection failed", { cause });
    this.name = "VisualInspectionError";
    this.code = code ?? "INSPECTION_FAILED";
    this.stage = stage;
    this.faceNumber = faceNumber;
    this.totalFaces = totalFaces;
    this.meituCalls = meituCalls;
    this.httpStatus = httpStatus;
    this.vendorCode = vendorCode;
    this.diagnosticKind = diagnosticKind;
  }
}

/**
 * Ephemeral diagnostic flow.  It returns display-safe crop and PNG mask media,
 * never a source image, credential, or Meitu transport payload.
 */
export async function inspectPersonLayers({
  image,
  sourceMedia,
  meituClient,
  imageRuntime,
  featherRadius = 3,
  mattingIntervalMs = 1_100,
  mattingMaxAttempts = 3,
  wait = delay,
  now = Date.now,
  onStatus = () => {},
}) {
  if (!Number.isInteger(mattingIntervalMs) || mattingIntervalMs < 0 || !Number.isInteger(mattingMaxAttempts) || mattingMaxAttempts < 1) {
    throw new VisualInspectionError({ code: "MISCONFIGURED", stage: "request", faceNumber: null, totalFaces: null, meituCalls: 0 });
  }
  let meituCalls = 0;
  let totalFaces = null;
  let lastVendorRequestAt = null;
  const runStage = async (stage, faceNumber, work) => {
    try { return await work(); }
    catch (error) {
      const failure = new VisualInspectionError({ code: error?.code, stage, faceNumber, totalFaces, meituCalls, httpStatus: error?.status, vendorCode: error?.vendorCode, diagnosticKind: error?.diagnosticKind, cause: error });
      onStatus({ stage: "failed", faceNumber, totalFaces, meituCalls, error: publicFailure(failure) });
      throw failure;
    }
  };
  const waitForMattingSlot = async (faceNumber) => {
    if (lastVendorRequestAt === null) return;
    const waitMs = Math.max(0, mattingIntervalMs - (now() - lastVendorRequestAt));
    if (waitMs > 0) {
      onStatus({ stage: "rate-limit-wait", reason: "spacing", waitMs, totalFaces, currentFace: faceNumber, meituCalls });
      await wait(waitMs);
    }
  };
  const createMattingMaskWithRetry = async (crop, faceNumber) => {
    for (let attempt = 1; attempt <= mattingMaxAttempts; attempt += 1) {
      await waitForMattingSlot(faceNumber);
      meituCalls += 1;
      lastVendorRequestAt = now();
      try { return await meituClient.createMattingMask(crop); }
      catch (error) {
        if (!isQpsLimit(error) || attempt === mattingMaxAttempts) throw error;
        const waitMs = mattingIntervalMs * attempt;
        onStatus({ stage: "rate-limit-wait", reason: "retry", attempt, waitMs, totalFaces, currentFace: faceNumber, meituCalls });
        await wait(waitMs);
      }
    }
  };
  onStatus({ stage: "detecting", totalFaces: null, currentFace: null, meituCalls });
  meituCalls += 1;
  lastVendorRequestAt = now();
  const layers = await runStage("face-detection", null, () => detectPersonLayers({ image, sourceMedia, meituClient }));
  totalFaces = layers.length;
  onStatus({ stage: "roi-ready", totalFaces, currentFace: null, meituCalls });

  const artifacts = [];
  for (const [index, layer] of layers.entries()) {
    const faceNumber = index + 1;
    onStatus({ stage: "roi-ready", totalFaces, currentFace: faceNumber, meituCalls });
    const crop = await runStage("roi-crop", faceNumber, () => imageRuntime.cropToRoi({ sourceMedia, roi: layer.roi, image }));
    onStatus({ stage: "segmenting", totalFaces, currentFace: faceNumber, meituCalls });
    const vendorMask = await runStage("segmentation", faceNumber, () => createMattingMaskWithRetry(crop, faceNumber));
    const decoded = await runStage("mask-decode", faceNumber, () => imageRuntime.decodeMask(vendorMask));
    // Re-encode rather than returning vendor base64 or its response envelope.
    const originalMask = await runStage("original-mask-encoding", faceNumber, () => imageRuntime.encodeMask(decoded));
    onStatus({ stage: "original-mask-ready", totalFaces, currentFace: faceNumber, meituCalls });
    artifacts.push({ layer, crop, decoded, originalMask });
  }

  const people = [];
  for (const [index, artifact] of artifacts.entries()) {
    const faceNumber = index + 1;
    const siblings = artifacts
      .filter((candidate) => candidate.layer.personId !== artifact.layer.personId)
      .map(({ layer, decoded }) => ({ layer, mask: decoded }));
    onStatus({ stage: "mask-overlap-removal", totalFaces, currentFace: faceNumber, meituCalls });
    const overlap = await runStage("mask-overlap-removal", faceNumber, () => assignMaskOverlapToClosestFace({ layer: artifact.layer, mask: artifact.decoded, siblings }));
    onStatus({ stage: "feathering", totalFaces, currentFace: faceNumber, meituCalls });
    const finalAlpha = await runStage("feathering", faceNumber, () => featherMaskInside(overlap.alpha, artifact.decoded.width, artifact.decoded.height, featherRadius));
    const finalMask = await runStage("final-mask-encoding", faceNumber, () => imageRuntime.encodeMask({ alpha: finalAlpha, width: artifact.decoded.width, height: artifact.decoded.height }));
    people.push({
      personId: artifact.layer.personId,
      faceBox: artifact.layer.faceBox,
      roi: artifact.layer.roi,
      crop: publicMedia(artifact.crop),
      originalMask: publicMedia(artifact.originalMask),
      finalMask: publicMedia(finalMask),
      status: "final-mask-ready",
      otherFaceInRoiCount: countFaceBoxesInsideRoi({ roi: artifact.layer.roi, layers: siblings.map(({ layer }) => layer) }),
      siblingMaskOverlapPixels: overlap.overlapPixelCount,
      ownershipRemovedPixels: overlap.ownershipRemovedPixelCount,
    });
    onStatus({ stage: "final-mask-ready", totalFaces, currentFace: faceNumber, meituCalls });
  }
  return { image, people, meituCalls };
}

function publicFailure(error) {
  return { code: error.code, stage: error.stage, faceNumber: error.faceNumber, totalFaces: error.totalFaces, meituCalls: error.meituCalls, httpStatus: safeNumber(error.httpStatus), vendorCode: safeNumber(error.vendorCode), diagnosticKind: safeDiagnosticKind(error.diagnosticKind) };
}

function safeNumber(value) { return Number.isInteger(value) ? value : null; }
function safeDiagnosticKind(value) { return ["timeout", "transport", "invalid-response", "vendor-response", "empty-mask"].includes(value) ? value : null; }
function isQpsLimit(error) { return error?.status === 429 || error?.vendorCode === 90024; }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function publicMedia(media) {
  return { data: media.base64 ?? media.data, dataType: media.dataType };
}
