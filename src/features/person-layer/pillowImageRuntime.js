import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PersonLayerAnalysisError } from "./personLayerAnalysis.js";

const scriptPath = fileURLToPath(new URL("./pillow_image_runtime.py", import.meta.url));

/** Server image runtime backed by Pillow for server-held base64 media only. */
export function createPillowImageRuntime({ pythonCommand = "python3" } = {}) {
  return {
    async cropToRoi({ sourceMedia, roi, image }) {
      if (!sourceMedia?.data || !["jpg", "jpeg", "png"].includes(sourceMedia.dataType ?? "jpg")) {
        throw new PersonLayerAnalysisError("INVALID_MEDIA", "ROI cropping requires base64 JPG or PNG media");
      }
      validateRoi(roi, image);
      const result = await runPillow(pythonCommand, {
        operation: "crop", base64: sourceMedia.data, dataType: sourceMedia.dataType ?? "jpg", roi, image,
      });
      return { data: result.base64, dataType: result.dataType, image: result.image };
    },

    async decodeMask({ base64, dataType }) {
      const result = await runPillow(pythonCommand, { operation: "decode-mask", base64, dataType });
      return {
        width: result.width,
        height: result.height,
        alpha: Uint8Array.from(Buffer.from(result.alphaBase64, "base64")),
      };
    },

    async encodeMask({ alpha, width, height }) {
      const result = await runPillow(pythonCommand, {
        operation: "encode-mask", alphaBase64: Buffer.from(alpha).toString("base64"), width, height,
      });
      return { base64: result.base64, dataType: result.dataType };
    },
  };
}

function validateRoi(roi, image) {
  for (const value of [roi?.x, roi?.y, roi?.width, roi?.height, image?.width, image?.height]) {
    if (!Number.isInteger(value)) throw new PersonLayerAnalysisError("INVALID_MEDIA", "ROI and image dimensions must be integers");
  }
  if (roi.width < 1 || roi.height < 1 || roi.x < 0 || roi.y < 0 || roi.x + roi.width > image.width || roi.y + roi.height > image.height) {
    throw new PersonLayerAnalysisError("INVALID_MEDIA", "ROI is outside the original image");
  }
}

function runPillow(pythonCommand, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", (error) => reject(new PersonLayerAnalysisError("IMAGE_RUNTIME_FAILURE", "Image runtime failed", { cause: error })));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new PersonLayerAnalysisError("INVALID_MEDIA", "Image runtime could not process media"));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new PersonLayerAnalysisError("IMAGE_RUNTIME_FAILURE", "Image runtime returned invalid output", { cause: error }));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
