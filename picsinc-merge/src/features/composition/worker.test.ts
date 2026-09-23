import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import type { WorkerAssignment } from "@/core/processing";
import { boundedBody, safeUrl, WorkerError } from "./worker-io";
import { createWorkerClient, processAssignment, runChildTask, WorkerApiError } from "./worker-runtime";

function job(base = "http://127.0.0.1"): WorkerAssignment {
  return {
    id: "job", leaseToken: "lease", kind: "compose",
    input: { sessionId: "session", version: 1, originalAssetId: "original", selections: [], overlapAssignments: [] },
    files: { original: `${base}/original` },
    outputs: Object.fromEntries(["preview", "result"].map((name) => [name, { path: name, token: "scoped", signedUrl: `${base}/${name}?token=scoped` }])),
  };
}

async function server(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const instance = createServer((request, response) => { Promise.resolve(handler(request, response)).catch(() => { response.statusCode = 500; response.end(); }); });
  await new Promise<void>((resolve, reject) => { instance.once("error", reject); instance.listen(0, "127.0.0.1", resolve); });
  const address = instance.address();
  assert(address && typeof address !== "string");
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve) => instance.close(() => resolve())) };
}

test("worker rejects insecure remote URLs and bounds streamed responses without content length", async () => {
  assert.throws(() => safeUrl("http://example.com/input"), WorkerError);
  assert.throws(() => safeUrl("https://secret@example.com/input"), WorkerError);
  assert.equal(safeUrl("http://127.0.0.1:3000/input").hostname, "127.0.0.1");
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); controller.close(); } });
  await assert.rejects(boundedBody(new Response(stream), 9), WorkerError);
});

test("isolated worker composes using signed input/output URLs and reports only metadata", async () => {
  const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const uploads = new Map<string, Buffer>();
  const endpoint = await server(async (request, response) => {
    assert.equal(request.headers.authorization, undefined);
    if (request.url === "/original") { response.end(input); return; }
    assert.equal(request.method, "PUT");
    assert.equal(request.headers["x-upsert"], "false");
    assert.equal(request.headers["content-type"], "image/png");
    const bytes = []; for await (const chunk of request) bytes.push(chunk);
    uploads.set(request.url!, Buffer.concat(bytes)); response.end("{}");
  });
  try {
    const result = await runChildTask(job(endpoint.base), new AbortController().signal);
    assert.deepEqual(result, { width: 3, height: 2, previewWidth: 3, previewHeight: 2, unassignedOverlapPixels: 0 });
    assert.equal(uploads.size, 2);
    assert.equal((await sharp(uploads.get("/result?token=scoped")!).metadata()).width, 3);
    assert(!JSON.stringify(result).includes("base64"));
  } finally { await endpoint.close(); }
});

test("worker sends bearer token only to API and retries uncertain completion without reporting failure", async () => {
  const routes: string[] = [];
  let attempts = 0;
  const endpoint = await server(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer test-token");
    routes.push(request.url!);
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.leaseToken, "lease");
    if (request.url?.endsWith("complete") && attempts++ === 0) { request.socket.destroy(); return; }
    response.end("{}");
  });
  try {
    await processAssignment(job(), createWorkerClient({ baseUrl: endpoint.base, token: "test-token" }), new AbortController().signal,
      { runTask: async () => ({ width: 3, height: 2 }), retryMs: 1 });
    assert.deepEqual(routes, ["/api/worker/heartbeat", "/api/worker/complete", "/api/worker/complete"]);
  } finally { await endpoint.close(); }
});

test("detection child uploads complete JSON but sends only IDs and boxes through IPC", async () => {
  const runtime = await mkdtemp(path.join(tmpdir(), "picsinc-worker-test-"));
  const expected = { width: 3, height: 2, previewPngBase64: "private-preview", regions: [{ id: "person-1", box: { x: 0, y: 0, width: 2, height: 2 }, maskPngBase64: "private-mask" }] };
  await writeFile(path.join(runtime, "export_regions.py"), `require('node:fs').writeFileSync(process.argv[3], ${JSON.stringify(JSON.stringify(expected))});`);
  const oldRuntime = process.env.YOLO_RUNTIME_DIR;
  const oldPython = process.env.YOLO_PYTHON;
  let uploaded: unknown;
  const endpoint = await server(async (request, response) => {
    if (request.method === "GET") { response.end("input"); return; }
    assert.equal(request.method, "PUT");
    assert.equal(request.headers["content-type"], "application/json");
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    uploaded = JSON.parse(Buffer.concat(chunks).toString()); response.end("{}");
  });
  try {
    process.env.YOLO_RUNTIME_DIR = runtime; process.env.YOLO_PYTHON = process.execPath;
    const assignment: WorkerAssignment = { ...job(endpoint.base), kind: "detect", input: { assetId: "original", width: 3, height: 2 }, outputs: { detection: { signedUrl: `${endpoint.base}/detection`, path: "detection", token: "scoped" } } };
    const result = await runChildTask(assignment, new AbortController().signal);
    assert.deepEqual(uploaded, expected);
    assert.deepEqual(result, { width: 3, height: 2, regions: [{ id: "person-1", box: expected.regions[0].box }] });
    assert(!JSON.stringify(result).includes("private"));
  } finally {
    if (oldRuntime === undefined) delete process.env.YOLO_RUNTIME_DIR; else process.env.YOLO_RUNTIME_DIR = oldRuntime;
    if (oldPython === undefined) delete process.env.YOLO_PYTHON; else process.env.YOLO_PYTHON = oldPython;
    await endpoint.close(); await rm(runtime, { recursive: true, force: true });
  }
});

test("aborting the lease terminates a real child blocked while reading an input", async () => {
  const abort = new AbortController();
  const endpoint = await server((_request, _response) => { abort.abort(); });
  try { await assert.rejects(runChildTask(job(endpoint.base), abort.signal), WorkerError); }
  finally { await endpoint.close(); }
});

test("lost lease cancels running task and never publishes or fails another owner's job", async () => {
  const calls: string[] = [];
  let cancelled = false;
  await processAssignment(job(), async <T>(route: string) => {
    calls.push(route); throw new WorkerApiError(409); return {} as T;
  }, new AbortController().signal, {
    heartbeatMs: 1,
    runTask: async (_job, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { cancelled = true; reject(new Error("cancelled")); }, { once: true });
    }),
  });
  assert(cancelled);
  assert.deepEqual(calls, ["heartbeat"]);
});

test("worker reports sanitized failure codes without sensitive exception messages", async () => {
  const reports: unknown[] = [];
  await processAssignment(job(), async <T>(route: string, body: unknown) => {
    reports.push({ route, body }); return {} as T;
  }, new AbortController().signal, {
    runTask: async () => { throw new WorkerError("invalid_input", "https://private/file?token=secret"); },
  });
  assert.equal(reports.length, 1);
  assert(JSON.stringify(reports).includes("invalid_input"));
  assert(!JSON.stringify(reports).includes("secret"));
});

test("repeated uncertain completion leaves recovery to the lease rather than sending fail", async () => {
  const calls: string[] = [];
  await processAssignment(job(), async <T>(route: string) => {
    calls.push(route);
    if (route === "complete") throw new WorkerApiError(503);
    return {} as T;
  }, new AbortController().signal, { runTask: async () => ({ width: 1, height: 1 }), retryMs: 1 });
  assert.deepEqual(calls, ["heartbeat", "complete", "complete", "complete"]);
});

test("shutdown stops child work without publishing or failing a recoverable job", async () => {
  const shutdown = new AbortController();
  const calls: string[] = [];
  await processAssignment(job(), async <T>(route: string) => { calls.push(route); return {} as T; }, shutdown.signal, {
    runTask: async (_job, signal) => { shutdown.abort(); signal.throwIfAborted(); return { width: 1, height: 1 }; },
  });
  assert.deepEqual(calls, []);
});
