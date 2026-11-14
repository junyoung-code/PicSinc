import {
  createPersonLayers,
} from "./personLayerAnalysis.js";
import { randomUUID } from "node:crypto";

/**
 * Detects candidate layers at upload time. No matting request is spent here.
 */
export async function detectPersonLayers({
  image,
  sourceMedia,
  meituClient,
  createId = randomUUID,
}) {
  const detection = await meituClient.detectFaces(sourceMedia);
  return createPersonLayers({ faces: detection.faces, image, createId });
}

/**
 * Lazily creates the individual mask needed by a claimed person's first edit.
 * Callers persist the returned layer; subsequent edits reuse its maskKey.
 */
export async function ensurePersonLayerMask({
  layer,
  image,
  sourceMedia,
  meituClient,
  cropToRoi,
  prepareAndStoreMask,
  collisionBoxes = [],
}) {
  if (layer.maskKey) return layer;

  const roiMedia = await cropToRoi({ sourceMedia, roi: layer.roi, image });
  const mask = await meituClient.createMattingMask(roiMedia);
  const maskKey = await prepareAndStoreMask({
    personId: layer.personId,
    roi: layer.roi,
    base64: mask.base64,
    dataType: mask.dataType,
    collisionBoxes,
  });
  return { ...layer, maskKey };
}
