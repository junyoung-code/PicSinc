import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

// Scheduled maintenance only. Photo processing runs in the local worker.
const bucket = "picsinc-merge";
const capabilityGraceMs = 60 * 60 * 1000;

// Both tables deliberately survive room deletion. A signed upload issued before
// expiry can arrive after the first cleanup, so delete its path on every run until
// the capability and in-flight-upload grace have elapsed.
async function cleanupUploadIntents(db: SupabaseClient, now: string) {
  let cursor: string | undefined; let deleted = 0;
  const timestamp = new Date(now).getTime();
  for (;;) {
    let query = db.from("photo_upload_intents").select("id,kind,status,session_id,temporary_key,final_key,expires_at").order("id").limit(100);
    if (cursor) query = query.gt("id", cursor);
    const rows = await query;
    if (rows.error) throw rows.error;
    if (!rows.data.length) break;
    const sessionIds = [...new Set(rows.data.map(row => row.session_id))];
    const sessions = await db.from("photo_sessions").select("id,expires_at").in("id", sessionIds);
    if (sessions.error) throw sessions.error;
    const liveRooms = new Map(sessions.data.map(row => [row.id, row.expires_at]));
    const assets = await db.from("photo_assets").select("storage_key").in("storage_key", rows.data.map(row => row.final_key));
    if (assets.error) throw assets.error;
    const registeredPaths = new Set(assets.data.map(row => row.storage_key));
    for (const row of rows.data) {
      const graceElapsed = new Date(row.expires_at).getTime() + capabilityGraceMs <= timestamp;
      const roomExpires = liveRooms.get(row.session_id);
      const roomExpired = roomExpires !== undefined && new Date(roomExpires).getTime() <= timestamp;
      // A pending original has not created its room yet. Missing room alone does
      // not make that upload orphaned; preserve it until its capability expires.
      const roomDeleted = roomExpires === undefined && (row.kind !== "original" || row.status === "ready");
      if (!graceElapsed && !roomExpired && !roomDeleted) continue;
      const paths = [row.temporary_key];
      if (!registeredPaths.has(row.final_key)) paths.push(row.final_key);
      const removed = await db.storage.from(bucket).remove(paths);
      if (removed.error) throw removed.error;
      if (graceElapsed) {
        const removedIntent = await db.from("photo_upload_intents").delete().eq("id", row.id).eq("expires_at", row.expires_at);
        if (removedIntent.error) throw removedIntent.error;
        deleted++;
      }
    }
    cursor = rows.data.at(-1)!.id;
  }
  return deleted;
}

async function cleanupOutputGrants(db: SupabaseClient, now: string) {
  let cursor: string | undefined; let deleted = 0;
  const timestamp = new Date(now).getTime();
  for (;;) {
    let query = db.from("processing_output_grants").select("path,remove_after,capability_expires_at").lte("remove_after", now).order("path").limit(100);
    if (cursor) query = query.gt("path", cursor);
    const rows = await query;
    if (rows.error) throw rows.error;
    if (!rows.data.length) break;
    const assets = await db.from("photo_assets").select("storage_key").in("storage_key", rows.data.map(row => row.path));
    if (assets.error) throw assets.error;
    const registeredPaths = new Set(assets.data.map(row => row.storage_key));
    for (const row of rows.data) {
      // Expired-room cleanup owns registered files. Do not remove a file while
      // its asset is still referenced, including rooms beyond this run's batch.
      if (registeredPaths.has(row.path)) continue;
      const removed = await db.storage.from(bucket).remove([row.path]);
      if (removed.error) throw removed.error;
      if (new Date(row.capability_expires_at).getTime() + capabilityGraceMs <= timestamp) {
        const removedGrant = await db.from("processing_output_grants").delete().eq("path", row.path).eq("capability_expires_at", row.capability_expires_at);
        if (removedGrant.error) throw removedGrant.error;
        deleted++;
      }
    }
    cursor = rows.data.at(-1)!.path;
  }
  return deleted;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const token = request.headers.get("x-cleanup-token");
  if (!token || token.length > 256) return new Response(null, { status: 401 });
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const key = keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), value => value.toString(16).padStart(2, "0")).join("");
    const credential = await db.from("cleanup_credentials").select("token_hash").eq("id", true).single();
    if (credential.error || credential.data.token_hash !== hash) return new Response(null, { status: 401 });
    const now = new Date().toISOString();
    const expired = await db.from("photo_sessions").select("id").lte("expires_at", now).order("expires_at").limit(100);
    if (expired.error) throw expired.error;
    let deleted = 0;
    for (const session of expired.data) {
      // List the folder, including files left by interrupted uploads, before deleting metadata.
      while (true) {
        const files = await db.storage.from(bucket).list(session.id, { limit: 500 });
        if (files.error) throw files.error;
        if (!files.data.length) break;
        const removed = await db.storage.from(bucket).remove(files.data.map(file => `${session.id}/${file.name}`));
        if (removed.error) throw removed.error;
      }
      const removed = await db.from("photo_sessions").delete().eq("id", session.id).lte("expires_at", now);
      if (removed.error) throw removed.error;
      deleted++;
    }
    const uploadsDeleted = await cleanupUploadIntents(db, now);
    const outputGrantsDeleted = await cleanupOutputGrants(db, now);
    return Response.json({ deleted, uploadsDeleted, outputGrantsDeleted });
  } catch {
    console.error("Expired photo cleanup failed; retained metadata for retry.");
    return Response.json({ error: "Cleanup failed; retry on next run." }, { status: 500 });
  }
});
