import { runHeavyTask } from "@/core/heavy-task";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SessionError } from "@/features/photo-session/errors";
import type { DetectedRegions } from "./detected-regions";

const execute = promisify(execFile);
export class GpuWorkerUnavailableError extends Error {}

/** Local runtime only. Input bytes never leave the application machine. */
export async function detectRegions(bytes: Buffer, size: { width: number; height: number }, requestId?: string): Promise<DetectedRegions> {
  return runHeavyTask(() => detectRegionsUnderLock(bytes, size, requestId));
}

/** Caller must already hold the shared heavy-task gate. */
export async function detectRegionsUnderLock(bytes: Buffer, size: { width: number; height: number }, requestId?: string): Promise<DetectedRegions> {
  const directory = await mkdtemp(path.join(tmpdir(), "picsinc-regions-"));
  try {
    const input = path.join(directory, "photo");
    const output = path.join(directory, "regions.json");
    const runtime = path.resolve(/* turbopackIgnore: true */ process.env.YOLO_RUNTIME_DIR || path.join(process.cwd(), "../experiments/yolo-outline"));
    await writeFile(input, bytes, { mode: 0o600 });
    const python = process.env.YOLO_PYTHON || path.join(runtime, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    await execute(python, [path.join(runtime, "export_regions.py"), input, output], { timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    const result: DetectedRegions = JSON.parse(await readFile(output, "utf8"));
    if (result.width !== size.width || result.height !== size.height || !Array.isArray(result.regions)) throw new Error("Invalid detection dimensions");
    return result;
  } catch (error) {
    const exitCode = (error as { code?: unknown }).code;
    if (process.env.YOLO_DEVICE === "cuda:0" && (exitCode === 75 || exitCode === 78)) {
      console.error("photo region CUDA unavailable", JSON.stringify({ requestId, exitCode }));
      throw new GpuWorkerUnavailableError("CUDA worker unavailable");
    }
    console.error("photo region YOLO failed", JSON.stringify({
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }));
    throw new SessionError(503, "사람 영역을 찾지 못했습니다. 잠시 후 다시 시도하거나 타원·브러시로 선택해 주세요.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
