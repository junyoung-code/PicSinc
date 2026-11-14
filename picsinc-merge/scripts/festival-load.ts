/** Synthetic, isolated-environment load rehearsal. Never run against the public project. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const base = process.env.PICSINC_TEST_BASE_URL;
const dbUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
assert(base && dbUrl && key, "Set PICSINC_TEST_BASE_URL and isolated Supabase server credentials");
assert(process.env.PICSINC_FESTIVAL_TEST === "1", "Set PICSINC_FESTIVAL_TEST=1 to run synthetic load");
const hostname = new URL(base).hostname;
assert((hostname.startsWith("picsinc-festival-readiness") && hostname.endsWith(".vercel.app")) || ["localhost", "127.0.0.1"].includes(hostname), "Use the isolated Vercel project or localhost");
assert(!dbUrl.includes("zogtpmolcmpiipwbysck"), "Public Supabase project is forbidden");
const admin = createClient(dbUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = admin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "picsinc-merge");
type RequestStat = { route: string; status: number; durationMs: number; responseBytes: number; requestBytes?: number };
type JobRow = { id: string; session_id: string; kind: string; status: string; created_at: string; updated_at: string; attempts: number };
const requests: RequestStat[] = [];
const rooms: string[] = [];
const sleeps = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (body: unknown, cookie = "", method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const cookie = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] || "";
async function call(route: string, init: RequestInit = {}, expected: number | number[] = 200) {
  const started = performance.now();
  const response = await fetch(new URL(route, base), { ...init, redirect: "manual", signal: AbortSignal.timeout(120_000) });
  const body = await response.text();
  requests.push({ route: route.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "/:id").replace(/\/sessions\/[^/]+/, "/sessions/:room"), status: response.status, durationMs: Math.round(performance.now() - started), responseBytes: Buffer.byteLength(body) });
  assert((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${route}: ${response.status} ${body.slice(0, 160)}`);
  return { response, body: body ? JSON.parse(body) : null };
}
async function uploaded(route: string, bytes: Buffer, credential: string, nickname?: string) {
  const prepared = await call(route, json({ contentType: "image/png", size: bytes.length, ...(nickname ? { nickname } : {}) }, credential), 201);
  const started = performance.now();
  const put = await fetch(prepared.body.signedUrl, { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "false" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(120_000) });
  requests.push({ route: "storage/PUT", status: put.status, durationMs: Math.round(performance.now() - started), responseBytes: 0, requestBytes: bytes.length });
  assert(put.ok, `signed upload failed: ${put.status}`); await put.body?.cancel();
  const inviteToken = route.match(/^\/api\/sessions\/([^/]+)/)?.[1];
  const completeRoute = `/api/uploads/${prepared.body.uploadId}/complete`;
  const completionCookie = credential || cookie(prepared.response);
  const completion = await call(completeRoute, json(inviteToken ? { inviteToken } : {}, completionCookie), 201);
  const repeated = await call(completeRoute, json(inviteToken ? { inviteToken } : {}, completionCookie), 201);
  assert.deepEqual(repeated.body.asset?.id || repeated.body.session?.id, completion.body.asset?.id || completion.body.session?.id);
  return completion;
}
async function snapshot(route: string, credential: string) { return (await call(route, { headers: { Cookie: credential } })).body; }
async function createTeam(index: number, original: Buffer) {
  const created = await uploaded("/api/uploads", original, "", `Load ${index}`);
  const ownerCookie = cookie(created.response);
  assert(ownerCookie);
  const roomId = created.body.session.id as string;
  rooms.push(roomId);
  const route = `/api/sessions/${created.body.session.inviteToken}`;
  const credentials = [ownerCookie];
  for (let member = 1; member < 3; member++) {
    const form = new FormData(); form.set("nickname", `Load ${index}-${member}`);
    const joined = await call(`${route}/participants`, { method: "POST", body: form }, 201);
    credentials.push(cookie(joined.response));
  }
  return { route, credentials, roomId };
}
function startStatusPolling(teams: Awaited<ReturnType<typeof createTeam>>[]) {
  const pending = new Set<string>();
  const timer = setInterval(() => {
    for (const team of teams) for (const [member, credential] of team.credentials.entries()) {
      const key = `${team.roomId}:${member}`;
      if (pending.has(key)) continue;
      pending.add(key);
      void call(team.route, { headers: { Cookie: credential } }).catch(() => undefined).finally(() => pending.delete(key));
    }
  }, 5000);
  return () => clearInterval(timer);
}
async function submit(team: Awaited<ReturnType<typeof createTeam>>, edited: Buffer, masks: Buffer[]) {
  for (let member = 0; member < 3; member++) {
    const credential = team.credentials[member];
    const mask = await uploaded(`${team.route}/uploads/mask`, masks[member], credential);
    const before = await snapshot(team.route, credential);
    await call(`${team.route}/original-selection`, json({ maskAssetId: mask.body.asset.id, selectedRegionIds: [], expectedVersion: before.session.version }, credential, "PUT"));
    const photo = await uploaded(`${team.route}/uploads/edited`, edited, credential);
    const current = await snapshot(team.route, credential);
    await call(`${team.route}/selection`, json({ editedAssetId: photo.body.asset.id, maskAssetId: mask.body.asset.id, expectedVersion: current.session.version }, credential, "PUT"));
  }
  const current = await snapshot(team.route, team.credentials[0]);
  const submittedAt = Date.now();
  const [first, again] = await Promise.all([0, 1].map(() => call(`${team.route}/compose`, json({ expectedVersion: current.session.version }, team.credentials[0]), [200, 202])));
  if (first.body.job?.id && again.body.job?.id) assert.equal(first.body.job.id, again.body.job.id, "duplicate compose created a second job");
  const { data: jobs, error } = await admin.from("processing_jobs").select("id").eq("session_id", team.roomId).eq("kind", "compose");
  assert.equal(error, null); assert.equal(jobs?.length, 1, "duplicate compose created a second job");
  return { ...team, jobId: jobs![0].id as string, submittedAt };
}
async function awaitJobs(roomIds: string[], signal: AbortSignal, deadlineMs = 15 * 60_000) {
  const observed = new Map<string, { createdAt: number; runningAt?: number; finishedAt?: number; status?: string }>();
  let peakQueuedJobs = 0;
  const deadline = Date.now() + deadlineMs;
  while (!signal.aborted && Date.now() < deadline) {
    const { data, error } = await admin.from("processing_jobs").select("id,session_id,kind,status,created_at,updated_at,attempts").in("session_id", roomIds);
    assert.equal(error, null);
    peakQueuedJobs = Math.max(peakQueuedJobs, (data || []).filter(job => job.status === "queued").length);
    for (const job of (data || []) as JobRow[]) {
      if (job.kind !== "compose") continue;
      const state = observed.get(job.id) || { createdAt: Date.parse(job.created_at) };
      if (job.status === "running") state.runningAt ??= Date.now();
      if (["ready", "failed"].includes(job.status)) state.finishedAt ??= Date.now();
      state.status = job.status; observed.set(job.id, state);
    }
    if (observed.size >= roomIds.length && [...observed.values()].every(value => value.finishedAt)) return { observed, peakQueuedJobs };
    await sleeps(1000);
  }
  throw new Error(signal.aborted ? "Job watcher cancelled" : "Timed out waiting for composition jobs");
}
async function storageBytes(roomIds: string[]) {
  const byKind: Record<string, number> = {};
  for (const roomId of roomIds) {
    const { data, error } = await admin.from("photo_assets").select("kind,storage_key").eq("session_id", roomId);
    assert.equal(error, null);
    for (const asset of data || []) {
      const { data: info, error: infoError } = await bucket.info(asset.storage_key);
      assert.equal(infoError, null);
      byKind[asset.kind] = (byKind[asset.kind] || 0) + Number(info?.size || 0);
    }
  }
  return byKind;
}
async function downloadResult(team: Awaited<ReturnType<typeof submit>>) {
  const current = await snapshot(team.route, team.credentials[0]);
  assert(current.result?.resultAssetId, "composition result missing");
  let bytes = 0;
  for (const credential of team.credentials) {
    const redirect = await fetch(new URL(`${team.route}/assets/${current.result.resultAssetId}`, base), { headers: { Cookie: credential }, redirect: "manual" });
    assert.equal(redirect.status, 302);
    const response = await fetch(redirect.headers.get("location")!, { signal: AbortSignal.timeout(120_000) });
    assert(response.ok);
    bytes += (await response.arrayBuffer()).byteLength;
  }
  return bytes;
}
async function cleanup() {
  for (const roomId of rooms) {
    const { data: assets } = await admin.from("photo_assets").select("storage_key").eq("session_id", roomId);
    const { data: grants } = await admin.from("processing_output_grants").select("path").eq("session_id", roomId);
    const { data: intents } = await admin.from("photo_upload_intents").select("temporary_key,final_key").eq("session_id", roomId);
    const paths = [...(assets || []).map(row => row.storage_key), ...(grants || []).map(row => row.path), ...(intents || []).flatMap(row => [row.temporary_key, row.final_key])];
    if (paths.length) await bucket.remove([...new Set(paths)]);
    await admin.from("processing_output_grants").delete().eq("session_id", roomId);
    await admin.from("photo_upload_intents").delete().eq("session_id", roomId);
    await admin.from("photo_sessions").delete().eq("id", roomId);
  }
}
function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
function routeSummary(items: RequestStat[]) {
  const groups = new Map<string, RequestStat[]>();
  for (const item of items) groups.set(item.route, [...(groups.get(item.route) || []), item]);
  return Object.fromEntries([...groups].map(([route, rows]) => [route, { count: rows.length, errors: rows.filter(row => row.status >= 400).length,
    p95Ms: percentile(rows.map(row => row.durationMs), 0.95) }]));
}
const width = 800, height = 600;
const original = await sharp({ create: { width, height, channels: 3, background: "#526688" } }).png().toBuffer();
const edited = await sharp({ create: { width, height, channels: 3, background: "#666e88" } }).png().toBuffer();
const masks = await Promise.all([0, 1, 2].map(async member => {
  const raw = Buffer.alloc(width * height);
  for (let y = 100; y < 250; y++) raw.fill(255, y * width + 50 + member * 220, y * width + 180 + member * 220);
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}));
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), scenarios: [] };
try {
  for (const count of [1, 3, 10]) {
    for (const delayed of [false, true]) {
      const before = requests.length;
      const teams = await Promise.all(Array.from({ length: count }, (_, index) => createTeam(index, original)));
      const roomIds = teams.map(team => team.roomId);
      const stopPolling = startStatusPolling(teams);
      try {
        if (delayed) await sleeps(30_000);
        const watchAbort = new AbortController();
        const watcher = awaitJobs(roomIds, watchAbort.signal);
        let submitted: Awaited<ReturnType<typeof submit>>[];
        let measurement: Awaited<ReturnType<typeof awaitJobs>>;
        try {
          submitted = await Promise.all(teams.map(team => submit(team, edited, masks)));
          measurement = await watcher;
        } catch (error) { watchAbort.abort(); await watcher.catch(() => undefined); throw error; }
      const { observed, peakQueuedJobs } = measurement;
      const elapsed = submitted.map(team => observed.get(team.jobId)!.finishedAt! - team.submittedAt);
      const queued = submitted.flatMap(team => { const state = observed.get(team.jobId); return state?.runningAt ? [state.runningAt - state.createdAt] : []; });
      const failedJobs = submitted.filter(team => observed.get(team.jobId)?.status !== "ready").length;
      const downloadedBytes = failedJobs ? 0 : (await Promise.all(submitted.map(downloadResult))).reduce((a, b) => a + b, 0);
      const scenario = { teams: count, delayed, p50MergeMs: percentile(elapsed, 0.5), p95MergeMs: percentile(elapsed, 0.95), p95QueueMs: percentile(queued, 0.95), peakQueuedJobs, maxMergeMs: Math.max(...elapsed),
        failedJobs,
        requests: requests.slice(before).length, errors: requests.slice(before).filter(item => item.status >= 400).length,
        routes: routeSummary(requests.slice(before)), storedBytes: await storageBytes(roomIds),
        uploadedBytes: requests.slice(before).reduce((sum, item) => sum + (item.requestBytes || 0), 0), downloadedBytes };
      (report.scenarios as unknown[]).push(scenario);
      console.log(JSON.stringify(scenario));
      assert.equal(scenario.failedJobs, 0);
      } finally { stopPolling(); }
    }
  }
  if (process.env.PICSINC_BOUNDARY_TEST === "1") {
    const pixels = randomBytes(2600 * 2600 * 3);
    const large = await sharp(pixels, { raw: { width: 2600, height: 2600, channels: 3 } }).png().toBuffer();
    assert(large.length > 19 * 1024 * 1024 && large.length < 20 * 1024 * 1024);
    const team = await createTeam(99, large);
    report.boundary = { bytes: large.length, roomCreated: Boolean(team.roomId) };
  }
} finally {
  report.completedAt = new Date().toISOString();
  report.requestSummary = { count: requests.length, errors: requests.filter(item => item.status >= 400).length,
    p95Ms: percentile(requests.map(item => item.durationMs), 0.95), uploadedBytes: requests.reduce((sum, item) => sum + (item.requestBytes || 0), 0) };
  if (process.env.PICSINC_REPORT_PATH) {
    await mkdir(path.dirname(process.env.PICSINC_REPORT_PATH), { recursive: true });
    await writeFile(process.env.PICSINC_REPORT_PATH, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  await cleanup();
}
