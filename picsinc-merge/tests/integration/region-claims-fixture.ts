import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

export const FIXTURE_PROJECT = "https://zogtpmolcmpiipwbysck.supabase.co";
export type ClaimsFixture = {
  projectUrl: string; sessionId: string; inviteToken: string; originalAssetId: string;
  participants: { id: string; nickname: string; sessionToken: string; recoveryToken: string; recoveryUrl: string; maskAssetId: string }[];
  storageKeys: string[]; createdAt: string;
};
const secret = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function fixtureAdmin() {
  assert.equal(process.env.SUPABASE_URL, FIXTURE_PROJECT, "Fixtures only use the dedicated PicSinc project");
  assert(process.env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY required");
  return createClient(FIXTURE_PROJECT, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function fixtureBase() { return process.env.PICSINC_TEST_BASE_URL || process.env.TEST_BASE_URL || "http://127.0.0.1:3137"; }
function checked(result: { error: unknown }) { assert.equal(result.error, null); }
export async function cleanupClaimsFixture(admin: SupabaseClient, fixture: ClaimsFixture) {
  assert.equal(fixture.projectUrl, FIXTURE_PROJECT);
  assert.match(fixture.sessionId, /^[0-9a-f-]{36}$/);
  assert(fixture.storageKeys.every(key => key.startsWith(`${fixture.sessionId}/`)));
  const keys = new Set(fixture.storageKeys);
  const assets = await admin.from("photo_assets").select("storage_key").eq("session_id", fixture.sessionId);
  checked(assets); for (const row of assets.data ?? []) keys.add(row.storage_key);
  const uploads = await admin.from("photo_upload_intents").select("temporary_key,final_key").eq("session_id", fixture.sessionId);
  checked(uploads); for (const row of uploads.data ?? []) { keys.add(row.temporary_key); keys.add(row.final_key); }
  const grants = await admin.from("processing_output_grants").select("path").eq("session_id", fixture.sessionId);
  checked(grants); for (const row of grants.data ?? []) keys.add(row.path);
  if (keys.size) checked(await admin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "picsinc-merge").remove([...keys]));
  checked(await admin.from("photo_upload_intents").delete().eq("session_id", fixture.sessionId));
  checked(await admin.from("processing_output_grants").delete().eq("session_id", fixture.sessionId));
  checked(await admin.from("photo_sessions").delete().eq("id", fixture.sessionId));
}

export async function createClaimsFixture(admin: SupabaseClient): Promise<ClaimsFixture> {
  const sessionId = randomUUID(), inviteToken = secret(), originalAssetId = randomUUID();
  const base = fixtureBase(), width = 400, height = 480;
  const participants = ["민선", "예슬"].map(nickname => {
    const recoveryToken = secret();
    return { id: randomUUID(), nickname, sessionToken: secret(), recoveryToken, recoveryUrl: `${base}/sessions/${inviteToken}/recover#token=${recoveryToken}`, maskAssetId: randomUUID() };
  });
  const fixture: ClaimsFixture = { projectUrl: FIXTURE_PROJECT, sessionId, inviteToken, originalAssetId, participants, storageKeys: [], createdAt: new Date().toISOString() };
  const originalKey = `${sessionId}/${originalAssetId}.png`, detectionKey = `${sessionId}/checklist-detection.json`;
  const original = await sharp(Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#edeafa"/><rect x="20" y="20" width="360" height="440" rx="16" fill="#d7d0f3"/><circle cx="120" cy="160" r="45" fill="#f0c5ac"/><path d="M55 370 L65 260 Q120 220 175 260 L185 370 Z" fill="#8065bd"/><circle cx="280" cy="160" r="45" fill="#e8b993"/><path d="M215 370 L225 260 Q280 220 335 260 L345 370 Z" fill="#64aaa2"/></svg>`)).png().toBuffer();
  const polygons = ["80,110 160,110 185,370 55,370", "240,110 320,110 345,370 215,370"];
  const masks = await Promise.all(polygons.map(points => sharp(Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><polygon points="${points}" fill="white"/></svg>`)).greyscale().png().toBuffer()));
  const regions = masks.map((mask, i) => ({ id: `person_00${i + 1}`, box: { x: i ? 215 : 55, y: 110, width: 130, height: 260 }, maskPngBase64: mask.toString("base64") }));
  const detection = { width, height, previewPngBase64: original.toString("base64"), regions };
  const summary = { width, height, regions: regions.map(({ id, box }) => ({ id, box })), storageKey: detectionKey };
  const storage = admin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "picsinc-merge");
  const put = async (key: string, bytes: Buffer, contentType: string) => { fixture.storageKeys.push(key); checked(await storage.upload(key, bytes, { contentType, upsert: false })); };
  try {
    await put(originalKey, original, "image/png");
    await put(detectionKey, Buffer.from(JSON.stringify(detection)), "application/json");
    // Start expired so the insert trigger's job cannot be claimed by a live worker.
    // Set only this job ready before activating the disposable room.
    checked(await admin.rpc("create_photo_session", {
      p_session_id: sessionId, p_invite_token: inviteToken, p_original_asset_id: originalAssetId,
      p_created_at: new Date(Date.now() - 1000).toISOString(), p_expires_at: new Date(Date.now() - 1).toISOString(),
      p_participant_id: participants[0].id, p_nickname: participants[0].nickname,
      p_session_token_hash: hash(participants[0].sessionToken), p_recovery_token_hash: hash(participants[0].recoveryToken),
      p_storage_key: originalKey, p_width: width, p_height: height, p_content_type: "image/png",
    }));
    checked(await admin.from("processing_jobs").update({ status: "ready", result: summary }).eq("session_id", sessionId).eq("kind", "detect"));
    checked(await admin.from("original_detections").insert({ session_id: sessionId, detection: summary }));
    checked(await admin.from("photo_sessions").update({ expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }).eq("id", sessionId));
    checked(await admin.rpc("join_photo_session", { p_session_id: sessionId, p_participant_id: participants[1].id, p_nickname: participants[1].nickname, p_session_token_hash: hash(participants[1].sessionToken), p_recovery_token_hash: hash(participants[1].recoveryToken) }));
    for (const [i, participant] of participants.entries()) {
      const key = `${sessionId}/${participant.maskAssetId}.png`;
      await put(key, masks[i], "image/png");
      checked(await admin.rpc("register_photo_asset", { p_asset: { id: participant.maskAssetId, sessionId, participantId: participant.id, kind: "mask", storageKey: key, width, height, contentType: "image/png" } }));
    }
    const pending = await admin.from("processing_jobs").select("id").eq("session_id", sessionId).in("status", ["queued", "running"]);
    checked(pending); assert.equal(pending.data?.length, 0, "Fixture must not leave work for a live worker");
    return fixture;
  } catch (error) { await cleanupClaimsFixture(admin, fixture); throw error; }
}
