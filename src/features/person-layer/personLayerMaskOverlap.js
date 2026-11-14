import { PersonLayerAnalysisError } from "./personLayerAnalysis.js";

/**
 * Removes only pixels which both ROI-local masks claim and assigns every such
 * pixel to the closest detected face. Inputs stay ROI-local; sampling happens
 * through original-image coordinates so differing ROI sizes remain aligned.
 */
export function assignMaskOverlapToClosestFace({ layer, mask, siblings }) {
  validateMask(mask);
  const output = Uint8Array.from(mask.alpha);
  let overlapPixelCount = 0;
  let ownershipRemovedPixelCount = 0;

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const index = y * mask.width + x;
      if (mask.alpha[index] === 0) continue;
      const point = toOriginalPoint(layer.roi, mask.width, mask.height, x, y);
      const claimants = siblings.filter((sibling) => sampleAlphaAtOriginalPoint(sibling, point) > 0);
      if (claimants.length === 0) continue;
      overlapPixelCount += 1;
      const ownDistance = squaredDistanceToFaceCenter(point, layer.faceBox);
      const siblingDistance = Math.min(...claimants.map((sibling) => squaredDistanceToFaceCenter(point, sibling.layer.faceBox)));
      if (siblingDistance < ownDistance) {
        output[index] = 0;
        ownershipRemovedPixelCount += 1;
      }
    }
  }
  return { alpha: output, overlapPixelCount, ownershipRemovedPixelCount };
}

export function countFaceBoxesInsideRoi({ roi, layers }) {
  return layers.filter((layer) => boxesIntersect(roi, layer.faceBox)).length;
}

function sampleAlphaAtOriginalPoint({ layer, mask }, point) {
  const relativeX = (point.x - layer.roi.x) / layer.roi.width;
  const relativeY = (point.y - layer.roi.y) / layer.roi.height;
  if (relativeX < 0 || relativeX >= 1 || relativeY < 0 || relativeY >= 1) return 0;
  const x = Math.min(mask.width - 1, Math.floor(relativeX * mask.width));
  const y = Math.min(mask.height - 1, Math.floor(relativeY * mask.height));
  return mask.alpha[y * mask.width + x];
}

function toOriginalPoint(roi, width, height, x, y) {
  return { x: roi.x + ((x + 0.5) / width) * roi.width, y: roi.y + ((y + 0.5) / height) * roi.height };
}

function squaredDistanceToFaceCenter(point, faceBox) {
  const x = faceBox.x + faceBox.width / 2;
  const y = faceBox.y + faceBox.height / 2;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

function boxesIntersect(first, second) {
  return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function validateMask(mask) {
  if (!Number.isInteger(mask?.width) || !Number.isInteger(mask?.height) || mask.width < 1 || mask.height < 1 || mask.alpha?.length !== mask.width * mask.height) {
    throw new PersonLayerAnalysisError("INVALID_MASK", "Mask dimensions are invalid");
  }
}
