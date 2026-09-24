import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { WorkerAssignment, WorkerCompletion } from "../../src/core/processing";
import { createWorkerClient, processAssignment, runChildTask, WorkerApiError } from "../../src/features/composition/worker-runtime";

// Explicit opt-in. Uses only synthetic media and removes only IDs allocated here.
// Run with no other worker: the API intentionally claims the shared queue.
test("remote upload, automatic detection, local processing, ownership, lease recovery and expiry", {
  skip: process.env.PICSINC_REMOTE_HTTP_TEST !== "1", timeout: 300_000,
}, async () => {
  assert.equal(process.env.SUPABASE_URL, "https://zogtpmolcmpiipwbysck.supabase.co");
  assert(process.env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY is required for fixture cleanup");
  assert(process.env.WORKER_TOKEN && process.env.WORKER_TOKEN.length >= 32, "WORKER_TOKEN must match the server");
  const base = process.env.PICSINC_TEST_BASE_URL || process.env.TEST_BASE_URL || "http://127.0.0.1:3137";
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "picsinc-merge";
  const post = createWorkerClient({ baseUrl: base, token: process.env.WORKER_TOKEN });
  const fixtureIds = new Set<string>();
  const uploadIds = new Set<string>();
  const runtime = await mkdtemp(path.join(tmpdir(), "picsinc-remote-fixture-"));
  const oldRuntime = process.env.YOLO_RUNTIME_DIR;
  const oldPython = process.env.YOLO_PYTHON;
  const width = 1400, height = 1200;
  const originalRaw = randomBytes(width * height * 3);
  const original = await sharp(originalRaw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  assert(original.length > 4.5 * 1024 * 1024, "fixture exercises an upload above Vercel's body limit");
  const boxes = [{ x: 100, y: 100, width: 200, height: 200 }, { x: 600, y: 100, width: 200, height: 200 }];
  const masks = await Promise.all(boxes.map(async (box) => {
    const raw = Buffer.alloc(width * height);
    for (let y = box.y; y < box.y + box.height; y++) raw.fill(255, y * width + box.x, y * width + box.x + box.width);
    return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
  }));
  const detection = { width, height, previewPngBase64: original.toString("base64"), regions: boxes.map((box, i) => ({ id: `person_00${i + 1}`, box, maskPngBase64: masks[i].toString("base64") })) };
  await writeFile(path.join(runtime, "result.json"), JSON.stringify(detection), { mode: 0o600 });
  await writeFile(path.join(runtime, "export_regions.py"), "const fs=require('node:fs'); const path=require('node:path'); fs.copyFileSync(path.join(__dirname,'result.json'),process.argv[3]);");
  process.env.YOLO_RUNTIME_DIR = runtime;
  process.env.YOLO_PYTHON = process.execPath; // Controlled detector, actual subprocess and transfer path.

  const json = (body: unknown, cookie = "", method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  async function expect(response: Response, status: number) {
    assert.equal(response.status, status, (await response.clone().text()).slice(0, 500));
    return response.json();
  }
  function cookie(response: Response) {
    const value = response.headers.get("set-cookie"); assert(value);
    assert.match(value, /httponly/i); return value.split(";")[0];
  }
  async function noForeignPending() {
    const pending = await admin.from("processing_jobs").select("id,session_id").in("status", ["queued", "running"]);
    assert.equal(pending.error, null);
    assert((pending.data ?? []).every((row) => fixtureIds.has(row.session_id)), "Stop other workers and leave user jobs untouched: non-fixture pending work exists");
  }
  async function prepare(url: string, bytes: Buffer, credential: string, extra: object = {}) {
    const response = await fetch(url, json({ ...extra, contentType: "image/png", size: bytes.length }, credential));
    const prepared = await expect(response, 201); uploadIds.add(prepared.uploadId);
    const intent = await admin.from("photo_upload_intents").select("session_id").eq("id", prepared.uploadId).single();
    assert.equal(intent.error, null); fixtureIds.add(intent.data!.session_id);
    const transferred = await fetch(prepared.signedUrl, { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "false" }, body: new Uint8Array(bytes) });
    assert.equal(transferred.ok, true, "direct signed upload must succeed"); await transferred.body?.cancel();
    return { response, prepared };
  }
  async function claimKnown(id: string): Promise<WorkerAssignment> {
    await noForeignPending();
    const prioritized = await admin.from("processing_jobs").update({ created_at: "2000-01-01T00:00:00Z", available_at: "2000-01-01T00:00:00Z" }).eq("id", id).in("session_id", [...fixtureIds]);
    assert.equal(prioritized.error, null);
    const { job } = await post<{ job: WorkerAssignment | null }>("claim", {});
    assert(job); assert.equal(job.id, id, "Never execute a job outside this fixture"); return job;
  }
  async function runKnown(id: string) {
    const assignment = await claimKnown(id);
    let completed: WorkerCompletion | undefined;
    await processAssignment(assignment, async <T>(action: string, body: unknown, signal?: AbortSignal) => {
      if (action === "complete") completed = body as WorkerCompletion;
      return post<T>(action, body, signal);
    }, new AbortController().signal);
    const stored = await admin.from("processing_jobs").select("status,error_code,result").eq("id", id).in("session_id", [...fixtureIds]).single();
    assert.equal(stored.error, null); assert.equal(stored.data?.status, "ready", stored.data?.error_code ?? "worker did not complete");
    assert(completed); await post("complete", completed); // Lost-response retry remains idempotent.
    return stored.data!.result;
  }

  try {
    await noForeignPending();
    assert.equal((await fetch(`${base}/api/worker/claim`, { method: "POST" })).status, 401);
    const originalUpload = await prepare(`${base}/api/uploads`, original, "", { nickname: "Remote fixture A" });
    const bootstrap = cookie(originalUpload.response);
    const completionUrl = `${base}/api/uploads/${originalUpload.prepared.uploadId}/complete`;
    assert.equal((await fetch(completionUrl, json({}))).status, 403, "bootstrap cookie is required");
    const createdResponse = await fetch(completionUrl, json({}, bootstrap));
    const created = await expect(createdResponse, 201);
    const credentials = [cookie(createdResponse)];
    const sessionId = created.session.id; assert(fixtureIds.has(sessionId));
    const invite = created.session.inviteToken;
    const route = `${base}/api/sessions/${invite}`;
    const replay = await expect(await fetch(completionUrl, json({}, bootstrap)), 201);
    assert.equal(replay.session.id, sessionId); assert.equal(replay.participant.id, created.participant.id);
    const scheduled = await admin.from("processing_jobs").select("id,status").eq("session_id", sessionId).eq("kind", "detect");
    assert.equal(scheduled.error, null); assert.equal(scheduled.data?.length, 1); assert.equal(scheduled.data![0].status, "queued", "upload auto-enqueues without a browser analysis request");
    const detectionId = scheduled.data![0].id;
    const originalState = await expect(await fetch(`${route}/original-detection`, { headers: { Cookie: credentials[0] } }), 200);
    assert.equal(originalState.status, "queued"); assert.equal(originalState.id, detectionId);

    const join = new FormData(); join.set("nickname", "Remote fixture B");
    const joinedResponse = await fetch(`${route}/participants`, { method: "POST", body: join });
    await expect(joinedResponse, 201); credentials.push(cookie(joinedResponse));
    const snapshot = async (credential = credentials[0]) => expect(await fetch(route, { headers: { Cookie: credential } }), 200);
    assert.equal((await fetch(route)).status, 403);
    const upload = async (kind: string, bytes: Buffer, credential: string) => {
      const { prepared } = await prepare(`${route}/uploads/${kind}`, bytes, credential);
      const url = `${base}/api/uploads/${prepared.uploadId}/complete`;
      const other = credential === credentials[0] ? credentials[1] : credentials[0];
      assert.equal((await fetch(url, json({ inviteToken: invite }, other))).status, 403);
      const body = await expect(await fetch(url, json({ inviteToken: invite }, credential)), 201);
      const again = await expect(await fetch(url, json({ inviteToken: invite }, credential)), 201);
      assert.equal(again.asset.id, body.asset.id); assert.equal("storageKey" in body.asset, false); return body.asset;
    };

    // Force only this fixture lease to expire; old completion/heartbeat must be rejected.
    const stale = await claimKnown(detectionId);
    const leaseExpired = await admin.from("processing_jobs").update({ lease_until: new Date(Date.now() - 1000).toISOString() }).eq("id", detectionId).eq("session_id", sessionId);
    assert.equal(leaseExpired.error, null);
    await assert.rejects(post("heartbeat", { id: stale.id, leaseToken: stale.leaseToken }), (e) => e instanceof WorkerApiError && e.status === 409);
    await runKnown(detectionId);
    await assert.rejects(post("complete", { id: stale.id, leaseToken: stale.leaseToken, result: { width, height, regions: [] } }), (e) => e instanceof WorkerApiError && e.status === 409);
    for (const credential of credentials) {
      const ready = await expect(await fetch(`${route}/assets/${created.session.originalAssetId}/regions`, { method: "POST", headers: { Cookie: credential } }), 200);
      assert.equal(ready.job.id, detectionId); assert.equal(ready.job.status, "ready");
      const result = await expect(await fetch(ready.job.resultUrl), 200);
      assert.deepEqual(result.regions.map((r: { id: string }) => r.id), ["person_001", "person_002"]);
    }
    const attempts = await admin.from("processing_jobs").select("attempts").eq("id", detectionId).single();
    assert.equal(attempts.data?.attempts, 2, "cache reuse must not claim a new analysis");

    const editedAssets: { id: string }[] = [];
    const maskAssets: { id: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const credential = credentials[i];
      const mask = await upload("mask", masks[i], credential); maskAssets.push(mask);
      const version = (await snapshot()).session.version;
      await expect(await fetch(`${route}/region-claims`, json({ regionId: `person_00${i + 1}`, selected: true }, credential, "PUT")), 200);
      const selectionBody = { maskAssetId: mask.id, selectedRegionIds: [`person_00${i + 1}`], expectedVersion: version };
      await expect(await fetch(`${route}/original-selection`, json(selectionBody, credential, "PUT")), 200);
      assert.equal((await fetch(`${route}/original-selection`, json(selectionBody, credential, "PUT"))).status, 409);
      const edit = await upload("edited", await sharp({ create: { width, height, channels: 3, background: i === 0 ? "#dd3333" : "#33bb55" } }).png().toBuffer(), credential);
      editedAssets.push(edit);
      await expect(await fetch(`${route}/selection`, json({ editedAssetId: edit.id, maskAssetId: mask.id, expectedVersion: (await snapshot()).session.version }, credential, "PUT")), 200);
    }
    assert.equal((await fetch(`${route}/assets/${editedAssets[0].id}/regions`, { method: "POST", headers: { Cookie: credentials[1] } })).status, 403);
    const version = (await snapshot()).session.version;
    assert.equal((await fetch(`${route}/compose`, json({ expectedVersion: version }, credentials[1]))).status, 403);
    const accepted = await expect(await fetch(`${route}/compose`, json({ expectedVersion: version }, credentials[0])), 202);
    const acceptedAgain = await expect(await fetch(`${route}/compose`, json({ expectedVersion: version }, credentials[0])), 202);
    assert.equal(acceptedAgain.job.id, accepted.job.id);
    await runKnown(accepted.job.id);
    const composed = await expect(await fetch(`${route}/compose`, json({ expectedVersion: version }, credentials[0])), 200);
    const resultId = composed.result.resultAssetId;
    for (const credential of credentials) {
      const response = await fetch(`${route}/assets/${resultId}`, { headers: { Cookie: credential }, redirect: "manual" });
      assert.equal(response.status, 302);
      const resultResponse = await fetch(response.headers.get("location")!); assert.equal(resultResponse.status, 200);
      const bytes = Buffer.from(await resultResponse.arrayBuffer());
      const metadata = await sharp(bytes).metadata(); assert.deepEqual([metadata.width, metadata.height, metadata.format], [width, height, "png"]);
      const pixels = await sharp(bytes).removeAlpha().raw().toBuffer();
      assert.deepEqual(pixels.subarray(0, 3), originalRaw.subarray(0, 3), "unselected pixels preserve original");
      for (const [x, expected] of [[200, [221, 51, 51]], [700, [51, 187, 85]]] as const) {
        const offset = (200 * width + x) * 3; assert.deepEqual([...pixels.subarray(offset, offset + 3)], [...expected]);
      }
    }

    // Finish an old-version computation after a real edit. It must not replace the prior result.
    await expect(await fetch(`${route}/selection`, json({ editedAssetId: editedAssets[0].id, maskAssetId: maskAssets[0].id, expectedVersion: (await snapshot()).session.version }, credentials[0], "PUT")), 200);
    const superseded = await expect(await fetch(`${route}/compose`, json({ expectedVersion: (await snapshot()).session.version }, credentials[0])), 202);
    const staleComposition = await claimKnown(superseded.job.id);
    const computed = await runChildTask(staleComposition, new AbortController().signal);
    await expect(await fetch(`${route}/selection`, json({ editedAssetId: editedAssets[1].id, maskAssetId: maskAssets[1].id, expectedVersion: (await snapshot()).session.version }, credentials[1], "PUT")), 200);
    await assert.rejects(post("complete", { id: staleComposition.id, leaseToken: staleComposition.leaseToken, result: computed }), (e) => e instanceof WorkerApiError && e.status === 409);
    assert.equal((await snapshot()).result.resultAssetId, resultId);
    const state = await expect(await fetch(`${route}/jobs/${superseded.job.id}`, { headers: { Cookie: credentials[0] } }), 200);
    assert.equal(state.job.status, "failed"); assert.equal(state.job.code, "version_changed");

    const recoveryToken = new URLSearchParams(new URL(created.recoveryUrl, base).hash.slice(1)).get("token");
    assert(recoveryToken);
    const recoveredResponse = await fetch(`${route}/recover`, json({ token: recoveryToken }));
    const recovered = await expect(recoveredResponse, 200);
    assert.equal(recovered.participantId, created.participant.id);
    const recoveredCookie = cookie(recoveredResponse);
    assert.notEqual(recoveredCookie, credentials[0], "recovery rotates the participation credential");
    assert.equal((await fetch(route, { headers: { Cookie: credentials[0] } })).status, 403);
    assert.equal((await fetch(`${route}/assets/${resultId}`, { headers: { Cookie: credentials[0] }, redirect: "manual" })).status, 403);
    assert.equal((await fetch(completionUrl, json({}, bootstrap))).status, 403, "old upload replay cannot restore the rotated credential");
    const recoveredSnapshot = await snapshot(recoveredCookie);
    assert.equal(recoveredSnapshot.currentParticipantId, created.participant.id);
    assert.equal(recoveredSnapshot.session.ownerParticipantId, created.participant.id);
    const recoveredDownload = await fetch(`${route}/assets/${resultId}`, { headers: { Cookie: recoveredCookie }, redirect: "manual" });
    assert.equal(recoveredDownload.status, 302);
    const recoveredPhoto = await fetch(recoveredDownload.headers.get("location")!);
    assert.equal(recoveredPhoto.status, 200);
    const recoveredMetadata = await sharp(Buffer.from(await recoveredPhoto.arrayBuffer())).metadata();
    assert.deepEqual([recoveredMetadata.width, recoveredMetadata.height, recoveredMetadata.format], [width, height, "png"]);
    credentials[0] = recoveredCookie;

    const expired = await admin.from("photo_sessions").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", sessionId); assert.equal(expired.error, null);
    assert.equal((await fetch(route, { headers: { Cookie: credentials[0] } })).status, 410);
    assert.equal((await fetch(`${route}/assets/${resultId}`, { headers: { Cookie: credentials[1] }, redirect: "manual" })).status, 410);
  } finally {
    if (oldRuntime === undefined) delete process.env.YOLO_RUNTIME_DIR; else process.env.YOLO_RUNTIME_DIR = oldRuntime;
    if (oldPython === undefined) delete process.env.YOLO_PYTHON; else process.env.YOLO_PYTHON = oldPython;
    await rm(runtime, { recursive: true, force: true });
    // Exact fixture IDs only. Include outputs not published and abandoned upload intents.
    const keys = new Set<string>();
    if (uploadIds.size) {
      const intents = await admin.from("photo_upload_intents").select("temporary_key,final_key,session_id").in("id", [...uploadIds]); assert.equal(intents.error, null);
      for (const row of intents.data ?? []) { keys.add(row.temporary_key); keys.add(row.final_key); fixtureIds.add(row.session_id); }
    }
    for (const id of fixtureIds) {
      const assets = await admin.from("photo_assets").select("storage_key").eq("session_id", id); assert.equal(assets.error, null);
      for (const row of assets.data ?? []) keys.add(row.storage_key);
      const grants = await admin.from("processing_output_grants").select("path").eq("session_id", id); assert.equal(grants.error, null);
      for (const row of grants.data ?? []) keys.add(row.path);
    }
    if (keys.size) { const deleted = await admin.storage.from(bucket).remove([...keys]); assert.equal(deleted.error, null); }
    if (uploadIds.size) { const deleted = await admin.from("photo_upload_intents").delete().in("id", [...uploadIds]); assert.equal(deleted.error, null); }
    for (const id of fixtureIds) {
      const grants = await admin.from("processing_output_grants").delete().eq("session_id", id); assert.equal(grants.error, null);
      const session = await admin.from("photo_sessions").delete().eq("id", id); assert.equal(session.error, null);
    }
  }
});
