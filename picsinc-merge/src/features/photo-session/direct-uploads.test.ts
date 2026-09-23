import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { DirectUploadService, originalUploadSecrets, readBoundedUpload, validateUploadMetadata, type DirectUploadFiles, type DirectUploadRepository, type UploadAuth, type UploadIntent } from "./direct-uploads-service";
import { SessionError } from "./errors";
import { MAX_PHOTO_BYTES } from "./image-validation";
import type { CredentialRecord, SessionRecord } from "./types";
import type { PhotoAsset } from "@/core/contracts";
import { tokenHash } from "./tokens";

const secret = "test-upload-secret-with-at-least-32-characters";
const now = new Date("2026-09-23T00:00:00Z");
const png = (width = 3, height = 2, color = "white") => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
const status = (expected: number) => (error: unknown) => error instanceof SessionError && error.status === expected;

function fixture() {
  const intents = new Map<string, UploadIntent>(); const files = new Map<string, Buffer>();
  const assets = new Map<string, PhotoAsset>(); const sessions = new Map<string, SessionRecord>(); const credentials = new Map<string, CredentialRecord>();
  let registrations = 0, reads = 0, loseReply = false;
  const repository: DirectUploadRepository = {
    async insert(intent) { intents.set(intent.id, { ...intent }); },
    async find(id) { return intents.get(id) ? { ...intents.get(id)! } : null; },
    async claim(id, ownerHash, leaseToken) {
      const intent = intents.get(id)!;
      assert.equal(ownerHash, intent.owner_hash);
      if (intent.status === "verifying") throw new SessionError(409, "Upload busy");
      if (intent.status !== "ready") { intent.status = "verifying"; intent.lease_token = leaseToken; }
      return { ...intent };
    },
    async release(id, leaseToken) { const intent = intents.get(id)!; if (intent.status === "verifying" && intent.lease_token === leaseToken) intent.status = "uploading"; },
    async finalize(intent, _ownerHash, leaseToken, image) {
      const current = intents.get(intent.id)!;
      assert.equal(current.lease_token, leaseToken);
      if (current.status === "ready") return;
      const session = sessions.get(intent.invite_token);
      if (intent.kind === "original") {
        sessions.set(intent.invite_token, { id: intent.session_id, inviteToken: intent.invite_token, ownerParticipantId: intent.participant_id, originalAssetId: intent.asset_id, version: 1, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString() });
        credentials.set(intent.participant_id, { participantId: intent.participant_id, sessionId: intent.session_id, sessionTokenHash: intent.session_token_hash!, recoveryTokenHash: intent.recovery_token_hash! });
      } else if (intent.kind === "edited") session!.version++;
      assets.set(intent.asset_id, { id: intent.asset_id, sessionId: intent.session_id, participantId: intent.kind === "original" ? null : intent.participant_id, kind: intent.kind, storageKey: intent.final_key, contentType: image.contentType, width: image.width, height: image.height, uploadOrder: intent.kind === "edited" ? 1 : null });
      registrations++; current.status = "ready";
      if (loseReply) { loseReply = false; throw new Error("DB committed but HTTP response lost"); }
    },
  };
  const storage: DirectUploadFiles = {
    async signUpload(path) { return { path, token: "limited-upload-token", signedUrl: "https://storage.invalid/limited-upload" }; },
    async read(path) { reads++; const bytes = files.get(path); assert.ok(bytes); return bytes; },
    async putImmutable(path, bytes) { if (files.has(path)) assert.deepEqual(files.get(path), bytes); else files.set(path, bytes); },
  };
  const authorize = async (inviteToken: string, participantId: string, sessionToken: string) => {
    const session = sessions.get(inviteToken); const credential = credentials.get(participantId);
    if (!session || credential?.sessionId !== session.id || credential.sessionTokenHash !== tokenHash(sessionToken)) throw new SessionError(403, "Unauthorized");
    if (new Date(session.expiresAt) <= now) throw new SessionError(410, "Expired");
    return session;
  };
  const service = new DirectUploadService(repository, storage, { authorize }, {
    async findAsset(sessionId, id) { const asset = assets.get(id); return asset?.sessionId === sessionId ? asset : null; },
    async findSessionByInvite(token) { return sessions.get(token) ?? null; },
    async findCredentials(sessionId, id) { const credential = credentials.get(id); return credential?.sessionId === sessionId ? credential : null; },
  }, secret, () => now);
  async function original(bytes: Buffer) {
    const prepared = await service.prepareOriginalUpload("대표", { contentType: "image/png", size: bytes.length }, "bootstrap-owner");
    files.set(prepared.path, bytes);
    const result = await service.completeUpload(prepared.uploadId, "bootstrap-owner");
    assert.equal(result.kind, "original"); if (result.kind !== "original") throw new Error("Unreachable");
    const auth: UploadAuth = { inviteToken: result.session.inviteToken, participantId: result.participant.id, sessionToken: result.sessionToken };
    return { prepared, result, auth };
  }
  return { service, original, intents, files, assets, sessions, credentials, get registrations() { return registrations; }, get reads() { return reads; }, loseNextReply() { loseReply = true; } };
}

test("completion retries return one room and stable credentials, including lost transaction response", async () => {
  const f = fixture(); const bytes = await png();
  const prepared = await f.service.prepareOriginalUpload("대표", { size: bytes.length, contentType: "image/png" }, "owner");
  f.files.set(prepared.path, bytes); f.loseNextReply();
  await assert.rejects(f.service.completeUpload(prepared.uploadId, "owner"), /response lost/);
  const first = await f.service.completeUpload(prepared.uploadId, "owner");
  const second = await f.service.completeUpload(prepared.uploadId, "owner");
  assert.deepEqual(first, second); assert.equal(f.registrations, 1); assert.equal(f.reads, 1);
  assert.ok(!JSON.stringify([...f.intents.values()]).includes(first.kind === "original" ? first.sessionToken : "unexpected"));
});

test("another browser cannot claim an original upload, including a ready upload", async () => {
  const f = fixture(); const { prepared } = await f.original(await png()); const before = f.reads;
  await assert.rejects(f.service.completeUpload(prepared.uploadId, "intruder"), status(403));
  assert.equal(f.reads, before);
});

test("concurrent completion claims register one original and the losing request can replay", async () => {
  const f = fixture(); const bytes = await png();
  const upload = await f.service.prepareOriginalUpload("대표", { contentType: "image/png", size: bytes.length }, "owner"); f.files.set(upload.path, bytes);
  const results = await Promise.allSettled([f.service.completeUpload(upload.uploadId, "owner"), f.service.completeUpload(upload.uploadId, "owner")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && status(409)(rejected.reason));
  assert.equal((await f.service.completeUpload(upload.uploadId, "owner")).kind, "original");
  assert.equal(f.registrations, 1);
});

test("recovered participation cannot be revoked by replaying original upload completion", async () => {
  const f = fixture(); const { prepared, result } = await f.original(await png());
  f.credentials.get(result.participant.id)!.sessionTokenHash = tokenHash("rotated-by-recovery");
  await assert.rejects(f.service.completeUpload(prepared.uploadId, "bootstrap-owner"), status(403));
  assert.equal(f.credentials.get(result.participant.id)!.sessionTokenHash, tokenHash("rotated-by-recovery"));
});

test("edited upload requires its owner and repeated completion does not increment room version again", async () => {
  const f = fixture(); const bytes = await png(); const { auth, result } = await f.original(bytes);
  const upload = await f.service.prepareSessionUpload(auth, "edited", { size: bytes.length, contentType: "image/png" }); f.files.set(upload.path, bytes);
  await assert.rejects(f.service.completeUpload(upload.uploadId, undefined, { ...auth, participantId: "someone-else" }), status(403));
  const first = await f.service.completeUpload(upload.uploadId, undefined, auth);
  const second = await f.service.completeUpload(upload.uploadId, undefined, auth);
  assert.deepEqual(first, second); assert.equal(result.session.version, 2); assert.equal(f.registrations, 2);
  assert.ok(!("storageKey" in (first.kind === "asset" ? first.asset : {})));
});

test("file size, actual format, dimensions and mask pixels are verified before registration", async () => {
  const f = fixture(); const bytes = await png(); const { auth } = await f.original(bytes);
  const cases = [
    { kind: "edited" as const, bytes, type: "image/jpeg", size: bytes.length },
    { kind: "edited" as const, bytes, type: "image/png", size: bytes.length + 1 },
    { kind: "edited" as const, bytes: await png(4, 2), type: "image/png", size: undefined },
    { kind: "mask" as const, bytes: await png(3, 2, "red"), type: "image/png", size: undefined },
  ];
  for (const input of cases) {
    const upload = await f.service.prepareSessionUpload(auth, input.kind, { contentType: input.type, size: input.size ?? input.bytes.length });
    f.files.set(upload.path, input.bytes);
    await assert.rejects(f.service.completeUpload(upload.uploadId, undefined, auth), status(400));
  }
  assert.equal(f.registrations, 1);
});

test("expired upload cannot register even with valid ownership", async () => {
  const f = fixture(); const bytes = await png(); const upload = await f.service.prepareOriginalUpload("대표", { contentType: "image/png", size: bytes.length }, "owner");
  f.intents.get(upload.uploadId)!.expires_at = now.toISOString(); f.files.set(upload.path, bytes);
  await assert.rejects(f.service.completeUpload(upload.uploadId, "owner"), status(410)); assert.equal(f.reads, 0);
});

test("bounded stream rejects oversized chunked data without Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_PHOTO_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedUpload(new Response(stream)), status(400)); assert.ok(cancelled);
  assert.deepEqual(await readBoundedUpload(new Response(new Uint8Array([1, 2, 3]))), Buffer.from([1, 2, 3]));
});

test("metadata rejects oversized/empty files and mask MIME; HMAC purpose and intent are separated", () => {
  assert.throws(() => validateUploadMetadata({ size: MAX_PHOTO_BYTES + 1, contentType: "image/png" }, "original"), status(400));
  assert.throws(() => validateUploadMetadata({ size: 0, contentType: "image/png" }, "original"), status(400));
  assert.throws(() => validateUploadMetadata({ size: 1, contentType: "image/jpeg" }, "mask"), status(400));
  const first = originalUploadSecrets("one", secret); const other = originalUploadSecrets("two", secret);
  assert.notEqual(first.sessionToken, first.recoveryToken); assert.notEqual(first.sessionToken, other.sessionToken);
});
