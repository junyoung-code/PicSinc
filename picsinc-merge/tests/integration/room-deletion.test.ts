import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { cleanupClaimsFixture, createClaimsFixture, FIXTURE_PROJECT, fixtureAdmin, fixtureBase } from "./region-claims-fixture";

test("owner deletion blocks participants, concurrent writes and old links after cleanup", {
  skip: process.env.PICSINC_DELETE_TEST !== "1", timeout: 120_000,
}, async () => {
  const admin = fixtureAdmin(), fixture = await createClaimsFixture(admin);
  const { sessionId, inviteToken, participants } = fixture;
  const route = `${fixtureBase()}/api/sessions/${inviteToken}`;
  const api = (path: string, index?: number, method = "GET", body?: unknown) => fetch(route + path, {
    method, headers: { ...(index === undefined ? {} : { Cookie: `picsinc_session_${inviteToken}=${participants[index].id}.${participants[index].sessionToken}` }), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: "manual",
  });
  async function deleted(response: Response) {
    assert.equal(response.status, 410);
    assert.equal((await response.json()).code, "SESSION_DELETED");
  }
  try {
    assert.equal((await api("/lifecycle")).status, 200);
    assert.equal((await api("", undefined, "DELETE")).status, 403);
    assert.equal((await api("", 1, "DELETE")).status, 403);
    const forbiddenRpc = await admin.rpc("delete_photo_session", { p_session_id: sessionId, p_participant_id: participants[1].id });
    assert.equal(forbiddenRpc.error?.message, "Forbidden");
    const snapshot = await (await api("", 0)).json();
    // Whichever transaction wins, no write may succeed after deletion is committed.
    const [removal, concurrentSave] = await Promise.all([
      api("", 0, "DELETE"),
      admin.rpc("replace_original_selection", { p_session_id: sessionId, p_participant_id: participants[1].id, p_mask_asset_id: participants[1].maskAssetId, p_selected_region_ids: [], p_expected_version: snapshot.session.version }),
    ]);
    assert.equal(removal.status, 200);
    assert(concurrentSave.error === null || concurrentSave.error.message === "Session expired");
    const room = await admin.from("photo_sessions").select("expires_at,version").eq("id", sessionId).single();
    assert.equal(room.error, null); assert.equal(new Date(room.data!.expires_at).getTime(), 0);
    const version = room.data!.version;
    const lateSave = await admin.rpc("replace_original_selection", { p_session_id: sessionId, p_participant_id: participants[1].id, p_mask_asset_id: participants[1].maskAssetId, p_selected_region_ids: [], p_expected_version: version });
    assert.equal(lateSave.data, null);
    const lateClaim = await admin.rpc("set_region_claim", { p_session_id: sessionId, p_participant_id: participants[1].id, p_region_id: "person_001", p_selected: true });
    assert.equal(lateClaim.error?.message, "Session expired");
    const lateAsset = await admin.rpc("register_photo_asset", { p_asset: { id: crypto.randomUUID(), sessionId, participantId: participants[1].id, kind: "mask", storageKey: `${sessionId}/late-mask.png`, width: 400, height: 480, contentType: "image/png" } });
    assert.equal(lateAsset.error?.message, "Session expired");
    for (const path of ["", "/lifecycle", "/invitation", "/region-claims", "/original-detection", `/assets/${fixture.originalAssetId}`]) await deleted(await api(path, 1));
    await deleted(await api("", 0, "DELETE"));
    await deleted(await api("/recover", undefined, "POST", { token: participants[1].recoveryToken }));
    const joinForm = new FormData(); joinForm.set("nickname", "삭제 후 참여");
    await deleted(await fetch(route + "/participants", { method: "POST", body: joinForm }));
    const publicKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
    assert(publicKey, "Public key required for role denial test");
    const anon = createClient(FIXTURE_PROJECT, publicKey);
    assert((await anon.rpc("delete_photo_session", { p_session_id: sessionId, p_participant_id: participants[0].id })).error);
    const read = await anon.from("photo_session_deletions").select("*");
    assert(read.error || read.data?.length === 0);
    await cleanupClaimsFixture(admin, fixture);
    await deleted(await api("/lifecycle"));
    await deleted(await api("/invitation"));
    await deleted(await api("/recover", undefined, "POST", { token: participants[1].recoveryToken }));
  } finally {
    await cleanupClaimsFixture(admin, fixture);
    assert.equal((await admin.from("photo_session_deletions").delete().eq("session_id", sessionId)).error, null);
  }
});
