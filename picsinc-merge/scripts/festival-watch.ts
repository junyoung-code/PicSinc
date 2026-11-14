/** Local-only, read-only observer for manual original-upload rehearsals. */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, mkdir, writeFile, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { summarizeRun, type BrowserUpload, type JobObservation, type JobRow, type OriginalIntent, type RoomRow, type RunConfig } from "./festival-watch-summary";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
assert(url && key, "SUPABASE_URL and SUPABASE_SECRET_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const port = Number(process.env.PICSINC_WATCH_PORT || 4317);
assert(Number.isSafeInteger(port) && port > 0 && port < 65536, "Invalid PICSINC_WATCH_PORT");
const origin = `http://127.0.0.1:${port}`;
const html = await readFile(new URL("./festival-watch.html", import.meta.url));

type Usage = Record<"before" | "after", Record<string, number>>;
type WorkerMetric = { downloadMs: number; processingMs: number; uploadMs: number; inputBytes: number; outputBytes: number };
type Run = RunConfig & {
  active: boolean; observed: Map<string, JobObservation>; peakQueued: number;
  intentIds: Set<string>; jobIds: Set<string>; browserUploads: Map<string, BrowserUpload>;
  logOffset: number; logRemainder: string; workerSamples: WorkerMetric[];
  history: { at: string; queued: number; running: number; completed: number; failed: number }[];
  usage: Usage; summary?: ReturnType<typeof summarizeRun>; lastError?: string;
};
let run: Run | null = null;
let sampling = false;
const usageMetrics = ["vercelInvocations", "vercelCpuSeconds", "vercelErrors", "supabaseEgressBytes", "supabaseStorageBytes"];
const workerLog = path.join(homedir(), "Library", "Logs", "PicSinc", "worker.log");
const p95 = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null;
function workerSummary(samples: WorkerMetric[]) {
  return { count: samples.length, p95DownloadMs: p95(samples.map(row => row.downloadMs)),
    p95ProcessingMs: p95(samples.map(row => row.processingMs)), p95UploadMs: p95(samples.map(row => row.uploadMs)),
    inputBytes: samples.reduce((sum, row) => sum + row.inputBytes, 0),
    outputBytes: samples.reduce((sum, row) => sum + row.outputBytes, 0) };
}

async function readWorkerMetrics(current: Run) {
  let size: number;
  try { size = (await stat(workerLog)).size; } catch { return; }
  if (size < current.logOffset) { current.logOffset = size; current.logRemainder = ""; return; }
  const length = Math.min(size - current.logOffset, 1024 * 1024);
  if (!length) return;
  const handle = await open(workerLog, "r");
  try {
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, current.logOffset);
    current.logOffset += bytesRead;
    const lines = (current.logRemainder + bytes.subarray(0, bytesRead).toString("utf8")).split("\n");
    current.logRemainder = lines.pop() || "";
    for (const line of lines) {
      const marker = "worker measurement ";
      const offset = line.indexOf(marker);
      if (offset < 0) continue;
      try {
        const value = JSON.parse(line.slice(offset + marker.length));
        if (value.kind !== "detect" || !current.jobIds.has(value.jobId)) continue;
        const fields = ["downloadMs", "processingMs", "uploadMs", "inputBytes", "outputBytes"] as const;
        if (!fields.every(field => Number.isFinite(value[field]) && value[field] >= 0)) continue;
        current.workerSamples.push(Object.fromEntries(fields.map(field => [field, value[field]])) as WorkerMetric);
      } catch { /* Ignore incomplete or unrelated log lines. */ }
    }
  } finally { await handle.close(); }
}

function checked<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error || result.data === null) throw new Error(`${label} query failed`);
  return result.data;
}

async function sample(force = false) {
  if (!run || (!run.active && !force)) return;
  while (sampling) await new Promise(resolve => setTimeout(resolve, 20));
  if (!run || (!run.active && !force)) return;
  sampling = true;
  const current = run;
  try {
    // The nickname prefix is an operator-chosen test marker; names never leave this process.
    const intents = checked((await db.from("photo_upload_intents")
      .select("id,session_id,nickname,status,created_at,byte_size")
      .eq("kind", "original").gte("created_at", current.startedAt)
      .ilike("nickname", `${current.prefix}%`).order("created_at").limit(100)) as { data: OriginalIntent[] | null; error: { message: string } | null }, "uploads");
    const roomIds = [...new Set(intents.map(intent => intent.session_id))];
    current.intentIds = new Set(intents.map(intent => intent.id));
    const rooms = roomIds.length ? checked((await db.from("photo_sessions")
      .select("id,created_at").in("id", roomIds)) as { data: RoomRow[] | null; error: { message: string } | null }, "rooms") : [];
    const jobs = roomIds.length ? checked((await db.from("processing_jobs")
      .select("id,session_id,kind,status,created_at,updated_at,attempts")
      .in("session_id", roomIds)) as { data: JobRow[] | null; error: { message: string } | null }, "jobs") : [];
    current.jobIds = new Set(jobs.filter(job => job.kind === "detect").map(job => job.id));
    const now = Date.now();
    await readWorkerMetrics(current);
    for (const job of jobs) if (job.status === "running" && !current.observed.get(job.id)?.runningAt) {
      current.observed.set(job.id, { runningAt: now });
    }
    current.peakQueued = Math.max(current.peakQueued, jobs.filter(job => job.kind === "detect" && job.status === "queued").length);
    current.summary = summarizeRun(current, intents, rooms, jobs, current.observed, current.peakQueued, now, current.browserUploads);
    current.history.push({ at: new Date(now).toISOString(), queued: current.summary.queuedJobs,
      running: current.summary.runningJobs, completed: current.summary.completedJobs, failed: current.summary.failedJobs });
    current.lastError = undefined;
  } catch (error) {
    current.lastError = error instanceof Error ? error.message : "Measurement query failed";
  } finally { sampling = false; }
}

async function saveReport(current: Run) {
  const directory = path.join(process.cwd(), "private", "festival-watch");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `original-${current.startedAt.replace(/[:.]/g, "-")}.json`;
  const file = path.join(directory, filename);
  await writeFile(file, JSON.stringify({ summary: current.summary, worker: workerSummary(current.workerSamples),
    history: current.history, usage: current.usage }, null, 2), { mode: 0o600 });
  return file;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let data = "";
  for await (const part of req) {
    data += part;
    if (data.length > 65536) throw new Error("Request too large");
  }
  const parsed = JSON.parse(data || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request");
  return parsed;
}

const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return send(res, 403, { error: "Local host only" });
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    return res.end(html);
  }
  if (req.method === "GET" && req.url === "/api/state") return send(res, 200, run ? {
    active: run.active, summary: run.summary, worker: workerSummary(run.workerSamples),
    history: run.history, usage: run.usage, error: run.lastError,
  } : { active: false, summary: null, worker: workerSummary([]), history: [], usage: { before: {}, after: {} } });
  if (req.method !== "POST" || !["/api/start", "/api/stop", "/api/usage", "/api/import"].includes(req.url || "")) return send(res, 404, { error: "Not found" });
  if (req.headers.origin !== origin) return send(res, 403, { error: "Local origin only" });
  try {
    const input = await body(req);
    if (req.url === "/api/start") {
      if (run?.active) return send(res, 409, { error: "Stop the current run first" });
      const prefix = String(input.prefix || "");
      const targetTeams = Number(input.targetTeams);
      if (!/^[A-Za-z0-9-]{3,20}$/.test(prefix) || ![1, 5, 10].includes(targetTeams)) return send(res, 400, { error: "Use a 3–20 character test prefix and 1, 5, or 10 teams" });
      const logOffset = await stat(workerLog).then(value => value.size).catch(() => 0);
      run = { prefix, targetTeams, startedAt: new Date().toISOString(), active: true,
        observed: new Map(), intentIds: new Set(), jobIds: new Set(), browserUploads: new Map(), peakQueued: 0,
        logOffset, logRemainder: "", workerSamples: [],
        history: [], usage: { before: {}, after: {} } };
      await sample();
      return send(res, 200, { ok: true, startedAt: run.startedAt });
    }
    if (!run) return send(res, 409, { error: "Start a run first" });
    if (req.url === "/api/usage") {
      const when = String(input.when);
      const metric = String(input.metric);
      const value = Number(input.value);
      if (!["before", "after"].includes(when) || !usageMetrics.includes(metric) || !Number.isFinite(value) || value < 0 || value > 1e15)
        return send(res, 400, { error: "Invalid usage value" });
      run.usage[when as "before" | "after"][metric] = value;
      if (!run.active) await saveReport(run);
      return send(res, 200, { ok: true });
    }
    if (req.url === "/api/import") {
      if (!Array.isArray(input.events) || input.events.length > 100) return send(res, 400, { error: "Invalid measurement file" });
      let matched = 0;
      for (const item of input.events) {
        if (!item || typeof item !== "object" || !run.intentIds.has(item.uploadId)) continue;
        if (!(["ready", "failed"].includes(item.status) && [item.prepareMs, item.storageMs, item.completeMs, item.totalMs]
          .every(value => Number.isFinite(value) && value >= 0 && value <= 3_600_000))) continue;
        run.browserUploads.set(item.uploadId, item as BrowserUpload); matched++;
      }
      await sample(true);
      if (!run.active) await saveReport(run);
      return send(res, 200, { matched });
    }
    if (!run.active) return send(res, 409, { error: "Run already stopped" });
    await sample();
    run.active = false;
    const file = await saveReport(run);
    return send(res, 200, { ok: true, report: file });
  } catch (error) { return send(res, 400, { error: error instanceof Error ? error.message : "Invalid request" }); }
});

server.listen(port, "127.0.0.1", () => console.log(`Festival watch: ${origin}`));
const timer = setInterval(() => { void sample(); }, 2000);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  clearInterval(timer);
  if (run?.active) { run.active = false; void saveReport(run).finally(() => server.close()); }
  else server.close();
});
