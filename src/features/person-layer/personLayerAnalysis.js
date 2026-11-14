import { randomUUID } from "node:crypto";

export class PersonLayerAnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PersonLayerAnalysisError";
    this.code = code;
  }
}

/** Converts Meitu's normalized face rectangle to an original-image pixel box. */
export function normalizedRectangleToBox(rectangle, image) {
  for (const key of ["left", "top", "width", "height"]) {
    if (!Number.isFinite(rectangle?.[key])) {
      throw new PersonLayerAnalysisError("INVALID_VENDOR_RESPONSE", `Missing face rectangle ${key}`);
    }
  }
  return clampBox(
    {
      x: Math.round(rectangle.left * image.width),
      y: Math.round(rectangle.top * image.height),
      width: Math.round(rectangle.width * image.width),
      height: Math.round(rectangle.height * image.height),
    },
    image,
  );
}

export function calculateRoi(faceBox, image, padding = 0.65) {
  const horizontal = faceBox.width * padding;
  const top = faceBox.height * padding;
  const bottom = faceBox.height * (padding * 1.35);
  return clampBox(
    {
      x: Math.floor(faceBox.x - horizontal),
      y: Math.floor(faceBox.y - top),
      width: Math.ceil(faceBox.width + horizontal * 2),
      height: Math.ceil(faceBox.height + top + bottom),
    },
    image,
  );
}

/** Creates detected layers without spending a matting request. */
export function createPersonLayers({ faces, image, createId = randomUUID }) {
  if (!Array.isArray(faces) || faces.length === 0) {
    throw new PersonLayerAnalysisError("NO_FACE", "No face detected");
  }
  const faceBoxes = faces.map((face) => normalizedRectangleToBox(face.face_rectangle, image));
  return faceBoxes.map((faceBox) => ({
    personId: createId(),
    faceBox,
    roi: calculateRoi(faceBox, image),
    maskKey: null,
  }));
}

/** Softens mask edges only inward; it never adds alpha outside the supplied mask. */
export function featherMaskInside(alpha, width, height, radius, blocked = new Uint8Array(alpha.length)) {
  if (alpha.length !== width * height || blocked.length !== alpha.length || radius < 1) {
    throw new PersonLayerAnalysisError("INVALID_MASK", "Mask dimensions or feather radius are invalid");
  }
  const output = new Uint8Array(alpha.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0 || blocked[index] !== 0) continue;
      const distance = nearestTransparentDistance(alpha, blocked, width, height, x, y, radius);
      output[index] = Math.round(alpha[index] * Math.min(1, distance / radius));
    }
  }
  return output;
}

function nearestTransparentDistance(alpha, blocked, width, height, startX, startY, radius) {
  for (let distance = 1; distance <= radius; distance += 1) {
    for (let y = startY - distance; y <= startY + distance; y += 1) {
      for (let x = startX - distance; x <= startX + distance; x += 1) {
        if (Math.max(Math.abs(x - startX), Math.abs(y - startY)) !== distance) continue;
        if (x < 0 || x >= width || y < 0 || y >= height || alpha[y * width + x] === 0 || blocked[y * width + x] !== 0) {
          return distance - 1;
        }
      }
    }
  }
  return radius;
}

function clampBox(box, image) {
  const x = Math.max(0, Math.min(image.width, box.x));
  const y = Math.max(0, Math.min(image.height, box.y));
  return {
    x,
    y,
    width: Math.max(0, Math.min(image.width - x, box.width)),
    height: Math.max(0, Math.min(image.height - y, box.height)),
  };
}
