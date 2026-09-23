import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { WorkerAssignment, WorkerCompletion } from "@/core/processing";
import { boundedBody, safeUrl, WorkerError } from "./worker-io";

export interface WorkerConfig { baseUrl: string; token: string }
export class WorkerApiError extends Error {
  constructor(public status: number) { super("Worker API request failed"); }
}
type Post = <T>(route: string, body: unknown, signal?: AbortSignal) => Promise<T>;
type RunTask = (job: WorkerAssignment, signal: AbortSignal) => Promise<WorkerCompletion["result"]>;

export function createWorkerClient(config: WorkerConfig): Post {
  const base = safeUrl(config.baseUrl);
  if (!config.token || base.pathname !== "/" || base.search || base.hash) throw new Error("WORKER_BASE_URL must be an origin and WORKER_TOKEN is required");
  return async <T>(route: string, body: unknown, signal?: AbortSignal) => {
    const response = await fetch(new URL(`/api/worker/${route}`, base), {
      method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify(body), redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new WorkerApiError(response.status); }
    const bytes = await boundedBody(response, 1024 * 1024);
    return (bytes.length ? JSON.parse(bytes.toString("utf8")) : {}) as T;
  };
}

export const runChildTask: RunTask = async (job, signal) => {
  const directory = await mkdtemp(path.join(tmpdir(), "picsinc-worker-"));
  try { return await spawnTask(job, signal, directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
};

function spawnTask(job: WorkerAssignment, signal: AbortSignal, directory: string): Promise<WorkerCompletion["result"]> { return new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const child = fork(fileURLToPath(new URL("./worker-task.ts", import.meta.url)), [], {
    execArgv: ["--import", "tsx"], detached: process.platform !== "win32",
    // Existing YOLO diagnostics can contain process details. Only sanitized IPC leaves this child.
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|WORKER_TOKEN|VERCEL|SECRET|API_KEY/i.test(key))), NODE_ENV: process.env.NODE_ENV ?? "production", TMPDIR: directory, TMP: directory, TEMP: directory },
  });
  let finished = false;
  let result: WorkerCompletion["result"] | undefined;
  let failure: Error | undefined;
  const stop = () => {
    if (!child.pid) return;
    try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); } catch { /* Process already exited. */ }
  };
  const cleanup = () => { signal.removeEventListener("abort", abort); clearTimeout(timeout); };
  const abort = () => { failure = new WorkerError("transient"); stop(); };
  const timeout = setTimeout(() => { failure = new WorkerError("processing_failed"); stop(); }, 10 * 60_000);
  signal.addEventListener("abort", abort, { once: true });
  child.once("error", () => { if (!finished) { finished = true; cleanup(); stop(); reject(new WorkerError("processing_failed")); } });
  child.on("message", (message: { result?: WorkerCompletion["result"]; errorCode?: WorkerError["code"] }) => {
    if (message?.result) result = message.result;
    else failure = new WorkerError(["transient", "invalid_input", "processing_failed"].includes(message?.errorCode ?? "") ? message.errorCode! : "processing_failed");
  });
  child.once("exit", (code) => {
    if (finished) return;
    finished = true; cleanup(); stop();
    if (failure || code !== 0 || !result) reject(failure ?? new WorkerError("processing_failed"));
    else resolve(result);
  });
  child.send(job, (error) => { if (error) { failure = new WorkerError("processing_failed"); stop(); } });
}); }

/** Keep ownership alive while computing; a lost lease can never publish a result. */
export async function processAssignment(job: WorkerAssignment, post: Post, shutdown: AbortSignal,
  options: { runTask?: RunTask; heartbeatMs?: number; leaseSafetyMs?: number; retryMs?: number } = {}): Promise<void> {
  const controller = new AbortController();
  const signal = AbortSignal.any([shutdown, controller.signal]);
  const heartbeatStop = new AbortController();
  const auth = { id: job.id, leaseToken: job.leaseToken };
  let lastHeartbeat = Date.now();
  let completing = false;
  const heartbeat = (async () => {
    while (!signal.aborted && !heartbeatStop.signal.aborted) {
      try { await delay(options.heartbeatMs ?? 15_000, undefined, { signal: AbortSignal.any([signal, heartbeatStop.signal]) }); }
      catch { return; }
      try { await post("heartbeat", auth, signal); lastHeartbeat = Date.now(); }
      catch (error) {
        if ((error instanceof WorkerApiError && [400, 401, 403, 404, 409, 410].includes(error.status)) || Date.now() - lastHeartbeat >= (options.leaseSafetyMs ?? 90_000)) controller.abort();
      }
    }
  })();
  try {
    const result = await (options.runTask ?? runChildTask)(job, signal);
    heartbeatStop.abort(); await heartbeat;
    if (signal.aborted) return;
    await post("heartbeat", auth, signal);
    completing = true;
    // Completion is idempotent. A dropped response may mean it was already committed.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await post("complete", { ...auth, result } satisfies WorkerCompletion, shutdown); return; }
      catch (error) {
        if (shutdown.aborted || (error instanceof WorkerApiError && error.status < 500 && error.status !== 429)) return;
        if (attempt < 2) await delay(options.retryMs ?? 2_000, undefined, { signal: shutdown });
      }
    }
    // Let the lease expire after uncertain completion; never overwrite a committed result as failed.
  } catch (error) {
    if (signal.aborted || completing) return;
    const errorCode = error instanceof WorkerError ? error.code : "processing_failed";
    try { await post("fail", { ...auth, errorCode, error: "사진 처리에 실패했습니다. 다시 시도해 주세요." }, shutdown); } catch { /* Lease recovery handles an unreachable API. */ }
  } finally { heartbeatStop.abort(); await heartbeat; }
}

export async function runWorker(config: WorkerConfig, signal: AbortSignal): Promise<void> {
  const post = createWorkerClient(config);
  let backoff = 5_000;
  while (!signal.aborted) {
    try {
      const { job } = await post<{ job: WorkerAssignment | null }>("claim", {}, signal);
      backoff = 5_000;
      if (job) { await processAssignment(job, post, signal); continue; }
    } catch (error) {
      if (signal.aborted) break;
      if (error instanceof WorkerApiError && [401, 403].includes(error.status)) throw new Error("Worker authentication failed");
      console.error("Worker connection unavailable; retrying.");
      backoff = Math.min(backoff * 2, 30_000);
    }
    await delay(backoff, undefined, { signal }).catch(() => undefined);
  }
}
