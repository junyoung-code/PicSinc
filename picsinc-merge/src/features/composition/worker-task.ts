import type { CompositionInput } from "@/core/contracts";
import type { WorkerAssignment, WorkerCompletion } from "@/core/processing";
import { detectRegionsUnderLock } from "@/features/region-editor/detect-regions";
import { CompositionError, composePhoto } from "./compose";
import { downloadInput, uploadOutput, WorkerError } from "./worker-io";

/** Run in a disposable child: all image buffers are released on process exit. */
export async function executeTask(job: WorkerAssignment): Promise<WorkerCompletion["result"]> {
  let transferFailed = false;
  const readAsset = async (id: string) => {
    if (!Object.hasOwn(job.files, id)) throw new WorkerError("invalid_input");
    try { return await downloadInput(job.files[id]); }
    catch (error) { if (error instanceof WorkerError && error.code === "transient") transferFailed = true; throw error; }
  };
  try {
    if (job.kind === "detect") {
      if (!("assetId" in job.input) || !job.outputs.detection) throw new WorkerError("invalid_input");
      const { width, height, assetId } = job.input;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40_000_000) throw new WorkerError("invalid_input");
      const result = await detectRegionsUnderLock(await readAsset(assetId), { width, height });
      await uploadOutput(job.outputs.detection.signedUrl, Buffer.from(JSON.stringify(result)), "application/json");
      return { width, height, regions: result.regions.map(({ id, box }) => ({ id, box })) };
    }
    if (job.kind !== "compose" || !("originalAssetId" in job.input) || !job.outputs.preview || !job.outputs.result) throw new WorkerError("invalid_input");
    const result = await composePhoto(job.input as CompositionInput, readAsset);
    await uploadOutput(job.outputs.preview.signedUrl, result.previewPng, "image/png");
    await uploadOutput(job.outputs.result.signedUrl, result.png, "image/png");
    return {
      width: result.width, height: result.height, previewWidth: result.previewWidth,
      previewHeight: result.previewHeight, unassignedOverlapPixels: result.unassignedOverlapPixels,
    };
  } catch (error) {
    if (transferFailed) throw new WorkerError("transient");
    if (error instanceof WorkerError) throw error;
    throw new WorkerError(error instanceof CompositionError ? "invalid_input" : "processing_failed");
  }
}

if (process.send) {
  process.once("message", async (job: WorkerAssignment) => {
    try {
      const result = await executeTask(job);
      process.send?.({ result }, () => process.exit(0));
    } catch (error) {
      const errorCode = error instanceof WorkerError ? error.code : "processing_failed";
      process.send?.({ errorCode }, () => process.exit(1));
    }
  });
}
