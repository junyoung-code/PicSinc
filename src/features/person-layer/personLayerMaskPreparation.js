import { randomUUID } from "node:crypto";

import { PersonLayerAnalysisError, featherMaskInside } from "./personLayerAnalysis.js";

/**
 * Decodes Meitu's ROI-local mask, protects other detected faces, feathers only
 * inward, and saves the prepared PNG. `storeMask` is the storage boundary owned
 * by Team C and must resolve to the durable object key.
 */
export function createPrepareAndStoreMask({
  imageRuntime,
  storeMask,
  featherRadius = 3,
  createKey = randomUUID,
}) {
  if (!imageRuntime?.decodeMask || !imageRuntime?.encodeMask || typeof storeMask !== "function") {
    throw new PersonLayerAnalysisError("MISCONFIGURED", "Mask runtime or storage is unavailable");
  }

  return async function prepareAndStoreMask({ personId, roi, base64, dataType, collisionBoxes = [] }) {
    const decoded = await imageRuntime.decodeMask({ base64, dataType });
    const alpha = normalizeAlpha(decoded);
    const blocked = collisionBoxesToBlocked({
      collisionBoxes,
      roi,
      width: decoded.width,
      height: decoded.height,
    });
    const feathered = featherMaskInside(alpha, decoded.width, decoded.height, featherRadius, blocked);
    const media = await imageRuntime.encodeMask({
      alpha: feathered,
      width: decoded.width,
      height: decoded.height,
    });
    const key = `person-layers/${personId}/masks/${createKey()}.png`;
    const storedKey = await storeMask({ key, personId, roi, media });
    if (typeof storedKey !== "string" || storedKey.length === 0) {
      throw new PersonLayerAnalysisError("STORAGE_FAILURE", "Mask storage did not return a key");
    }
    return storedKey;
  };
}

/** Converts original-image collision boxes into ROI-local blocked mask pixels. */
export function collisionBoxesToBlocked({ collisionBoxes, roi, width, height }) {
  if (!Array.isArray(collisionBoxes) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new PersonLayerAnalysisError("INVALID_MASK", "Mask dimensions or collision boxes are invalid");
  }
  const blocked = new Uint8Array(width * height);
  for (const box of collisionBoxes) {
    const x0 = Math.max(0, Math.floor(((box.x - roi.x) / roi.width) * width));
    const y0 = Math.max(0, Math.floor(((box.y - roi.y) / roi.height) * height));
    const x1 = Math.min(width, Math.ceil(((box.x + box.width - roi.x) / roi.width) * width));
    const y1 = Math.min(height, Math.ceil(((box.y + box.height - roi.y) / roi.height) * height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) blocked[y * width + x] = 1;
    }
  }
  return blocked;
}

function normalizeAlpha(decoded) {
  if (!Number.isInteger(decoded?.width) || !Number.isInteger(decoded?.height) || decoded.width < 1 || decoded.height < 1) {
    throw new PersonLayerAnalysisError("INVALID_MASK", "Mask dimensions are invalid");
  }
  const alpha = decoded.alpha instanceof Uint8Array ? decoded.alpha : Uint8Array.from(decoded.alpha ?? []);
  if (alpha.length !== decoded.width * decoded.height) {
    throw new PersonLayerAnalysisError("INVALID_MASK", "Mask alpha does not match its dimensions");
  }
  return alpha;
}
