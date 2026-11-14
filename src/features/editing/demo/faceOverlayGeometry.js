import { getPhotoDimensions, scaleBoxToPhoto } from "./photoGeometry.js";

export const FACE_OVERLAY_PRIORITY = Object.freeze({
  claimed: 1,
  available: 2,
  accepted: 3,
  mine: 3,
  selected: 4,
  active: 5,
});

export function faceOverlayState({ person, selected = false, active = false, revision = null }) {
  if (active) return "active";
  if (selected) return "selected";
  if (person.claimState === "claimed") return "claimed";
  if (revision?.status === "accepted") return "accepted";
  if (person.claimState === "mine") return "mine";
  return "available";
}

export function mapFaceBoxToCanvas(faceBox, fixtureImage, canvasImage) {
  return scaleBoxToPhoto(faceBox, fixtureImage, canvasImage);
}

export function faceHitArea(faceBox, sourceImage, displaySize, minimumCssPixels = 44) {
  const source = getPhotoDimensions(sourceImage);
  const displayWidth = Number(displaySize?.width);
  const displayHeight = Number(displaySize?.height);
  if (!(displayWidth > 0) || !(displayHeight > 0)) return { ...faceBox };
  const minimumWidth = minimumCssPixels * source.width / displayWidth;
  const minimumHeight = minimumCssPixels * source.height / displayHeight;
  const width = Math.max(faceBox.width, minimumWidth);
  const height = Math.max(faceBox.height, minimumHeight);
  return {
    x: faceBox.x + faceBox.width / 2 - width / 2,
    y: faceBox.y + faceBox.height / 2 - height / 2,
    width,
    height,
  };
}

export function overlayZIndex(state, order) {
  return FACE_OVERLAY_PRIORITY[state] * 100 + order;
}
