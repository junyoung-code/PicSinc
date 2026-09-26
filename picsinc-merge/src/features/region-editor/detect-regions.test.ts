import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectRegions, detectRegionsUnderLock, GpuWorkerUnavailableError } from "./detect-regions";
import { SessionError } from "@/features/photo-session/errors";

test("failed local detection reports a recoverable error and removes its temporary files", async () => {
  const before = new Set(await readdir(tmpdir()));
  await assert.rejects(detectRegions(Buffer.from("not an image"), { width: 10, height: 10 }), (e: unknown) => e instanceof SessionError && e.status === 503);
  const leftover = (await readdir(tmpdir())).filter(name => name.startsWith("picsinc-regions-") && !before.has(name));
  assert.deepEqual(leftover, []);
});

test("CUDA resource failure has a distinct signal for worker suspension", async () => {
  const runtime = await mkdtemp(path.join(tmpdir(), "picsinc-cuda-test-"));
  await writeFile(path.join(runtime, "export_regions.py"), "process.exit(75)");
  const previous = { runtime: process.env.YOLO_RUNTIME_DIR, python: process.env.YOLO_PYTHON, device: process.env.YOLO_DEVICE };
  try {
    process.env.YOLO_RUNTIME_DIR = runtime;
    process.env.YOLO_PYTHON = process.execPath;
    process.env.YOLO_DEVICE = "cuda:0";
    await assert.rejects(detectRegionsUnderLock(Buffer.from("test"), { width: 1, height: 1 }), GpuWorkerUnavailableError);
  } finally {
    for (const [key, value] of Object.entries({ YOLO_RUNTIME_DIR: previous.runtime, YOLO_PYTHON: previous.python, YOLO_DEVICE: previous.device })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(runtime, { recursive: true, force: true });
  }
});
