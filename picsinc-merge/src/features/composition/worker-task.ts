import type { CompositionInput } from "@/core/contracts";
import type { WorkerAssignment, WorkerCompletion } from "@/core/processing";
import { detectRegionsUnderLock, GpuWorkerUnavailableError } from "@/features/region-editor/detect-regions";
import { CompositionError, composePhoto } from "./compose";
import { downloadInput, uploadOutput, WorkerError } from "./worker-io";

type TaskMetrics = { downloadMs: number; processingMs: number; uploadMs: number; inputBytes: number; outputBytes: number };

async function executeMeasuredTask(job: WorkerAssignment): Promise<{ result: WorkerCompletion["result"]; metrics: TaskMetrics }> {
  const metrics: TaskMetrics = { downloadMs: 0, processingMs: 0, uploadMs: 0, inputBytes: 0, outputBytes: 0 };
  const readAsset = async (id: string) => {
    if (!Object.hasOwn(job.files, id)) throw new WorkerError("invalid_input");
    const started = performance.now();
    try { const bytes = await downloadInput(job.files[id]); metrics.inputBytes += bytes.length; return bytes; }
    finally { metrics.downloadMs += performance.now() - started; }
  };
  const writeOutput = async (url: string, bytes: Buffer, contentType: string) => {
    const started = performance.now();
    try { await uploadOutput(url, bytes, contentType); metrics.outputBytes += bytes.length; }
    finally { metrics.uploadMs += performance.now() - started; }
  };
  const result = await executeTask(job, readAsset, writeOutput, metrics);
  return { result, metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, Math.round(value)])) as TaskMetrics };
}

/** Run in a disposable child: all image buffers are released on process exit. */
export async function executeTask(job: WorkerAssignment,
  download: (id: string) => Promise<Buffer> = id => downloadInput(job.files[id]),
  upload: (url: string, bytes: Buffer, contentType: string) => Promise<void> = uploadOutput,
  metrics?: TaskMetrics): Promise<WorkerCompletion["result"]> {
  let transferFailed = false;
  const readAsset = async (id: string) => {
    if (!Object.hasOwn(job.files, id)) throw new WorkerError("invalid_input");
    try { return await download(id); }
    catch (error) { if (error instanceof WorkerError && error.code === "transient") transferFailed = true; throw error; }
  };
  try {
    if (job.kind === "detect") {
      if (!("assetId" in job.input) || !job.outputs.detection) throw new WorkerError("invalid_input");
      const { width, height, assetId } = job.input;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40_000_000) throw new WorkerError("invalid_input");
      const bytes = await readAsset(assetId);
      const started = performance.now();
      const result = await detectRegionsUnderLock(bytes, { width, height });
      if (metrics) metrics.processingMs += performance.now() - started;
      await upload(job.outputs.detection.signedUrl, Buffer.from(JSON.stringify(result)), "application/json");
      return { width, height, regions: result.regions.map(({ id, box }) => ({ id, box })) };
    }
    if (job.kind !== "compose" || !("originalAssetId" in job.input) || !job.outputs.preview || !job.outputs.result) throw new WorkerError("invalid_input");
    const downloadBefore = metrics?.downloadMs ?? 0;
    const started = performance.now();
    const result = await composePhoto(job.input as CompositionInput, readAsset);
    if (metrics) metrics.processingMs += performance.now() - started - (metrics.downloadMs - downloadBefore);
    await upload(job.outputs.preview.signedUrl, result.previewPng, "image/png");
    await upload(job.outputs.result.signedUrl, result.png, "image/png");
    return {
      width: result.width, height: result.height, previewWidth: result.previewWidth,
      previewHeight: result.previewHeight, unassignedOverlapPixels: result.unassignedOverlapPixels,
    };
  } catch (error) {
    if (transferFailed) throw new WorkerError("transient");
    if (error instanceof GpuWorkerUnavailableError) throw new WorkerError("gpu_unavailable");
    if (error instanceof WorkerError) throw error;
    throw new WorkerError(error instanceof CompositionError ? "invalid_input" : "processing_failed");
  }
}

if (process.send) {
  process.once("message", async (job: WorkerAssignment) => {
    try {
      const { result, metrics } = await executeMeasuredTask(job);
      process.send?.({ result, metrics }, () => process.exit(0));
    } catch (error) {
      const errorCode = error instanceof WorkerError ? error.code : "processing_failed";
      process.send?.({ errorCode }, () => process.exit(1));
    }
  });
}
