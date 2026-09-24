import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { cleanupClaimsFixture, createClaimsFixture, FIXTURE_PROJECT, fixtureAdmin, fixtureBase } from "./region-claims-fixture";

test("region claims serialize first clicks and enforce ownership through RPC and authenticated API", {
  skip: process.env.PICSINC_CLAIMS_TEST !== "1", timeout: 120_000,
}, async () => {
  const admin = fixtureAdmin();
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  assert(anonKey, "Provide an anon/publishable key to verify browser-role denial");
  const anon = createClient(FIXTURE_PROJECT, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const fixture = await createClaimsFixture(admin);
  const { sessionId, participants, inviteToken } = fixture;
  const route = `${fixtureBase()}/api/sessions/${inviteToken}`;
  const cookie = (index: number) => `picsinc_session_${inviteToken}=${participants[index].id}.${participants[index].sessionToken}`;
  async function api(path: string, index?: number, body?: unknown) {
    return fetch(`${route}${path}`, { method: body ? "PUT" : "GET", headers: { ...(index === undefined ? {} : { Cookie: cookie(index) }), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  const claim = (index: number, selected: boolean, regionId = "person_001") => admin.rpc("set_region_claim", { p_session_id: sessionId, p_participant_id: participants[index].id, p_region_id: regionId, p_selected: selected });
  async function version() {
    const result = await admin.from("photo_sessions").select("version").eq("id", sessionId).single();
    assert.equal(result.error, null); return result.data!.version as number;
  }
  const save = (index: number, ids: string[], expected: number) => admin.rpc("replace_original_selection", { p_session_id: sessionId, p_participant_id: participants[index].id, p_mask_asset_id: participants[index].maskAssetId, p_selected_region_ids: ids, p_expected_version: expected });
  try {
    assert.equal((await api("/region-claims")).status, 403);
    const initialVersion = await version();
    const outcomes = await Promise.all([claim(0, true), claim(1, true)]);
    outcomes.forEach(result => assert.equal(result.error, null));
    assert.equal(outcomes.filter(result => !result.data.conflict).length, 1);
    const winner = outcomes[0].data.conflict ? 1 : 0, loser = 1 - winner;
    const expected = { regionId: "person_001", participantId: participants[winner].id, nickname: participants[winner].nickname };
    const list = await api("/region-claims", loser);
    assert.equal(list.status, 200); assert.deepEqual((await list.json()).claims, [expected]);
    assert.equal(await version(), initialVersion, "claims don't change saved composition version");

    const repeat = await claim(winner, true);
    assert.equal(repeat.error, null); assert.deepEqual(repeat.data.claims, [expected]);
    for (const selected of [true, false]) {
      const denied = await api("/region-claims", loser, { regionId: "person_001", selected });
      assert.equal(denied.status, 409); assert.deepEqual((await denied.json()).claim, expected);
    }
    assert.equal((await api("/region-claims", winner, { regionId: "unknown", selected: true })).status, 400);

    const refused = await save(loser, ["person_001"], initialVersion);
    assert.equal(refused.error?.message, "Region claim conflict");
    assert.deepEqual(JSON.parse(refused.error!.details), expected);
    assert.equal(await version(), initialVersion, "rejected save rolls back its version increment");
    const unowned = await save(winner, ["person_002"], initialVersion);
    assert.equal(unowned.error?.message, "Region claim required");
    assert.equal(await version(), initialVersion);
    const allowed = await save(winner, ["person_001"], initialVersion);
    assert.equal(allowed.error, null); assert.equal(allowed.data, initialVersion + 1);
    const stale = await save(winner, ["person_001"], initialVersion);
    assert.equal(stale.error, null); assert.equal(stale.data, null);
    // Manual masks remain allowed even where pixels overlap other selections.
    const manual = await save(loser, [], await version());
    assert.equal(manual.error, null); assert.equal(typeof manual.data, "number");

    const release = await api("/region-claims", winner, { regionId: "person_001", selected: false });
    assert.equal(release.status, 200); assert.deepEqual((await release.json()).claims, []);
    const reacquire = await api("/region-claims", loser, { regionId: "person_001", selected: true });
    assert.equal(reacquire.status, 200); assert.equal((await reacquire.json()).claims[0].participantId, participants[loser].id);
    const saveFormerOwner = await save(winner, ["person_001"], await version());
    assert.equal(saveFormerOwner.error?.message, "Region claim conflict");

    const anonList = await anon.rpc("list_region_claims", { p_session_id: sessionId });
    const anonSet = await anon.rpc("set_region_claim", { p_session_id: sessionId, p_participant_id: participants[winner].id, p_region_id: "person_001", p_selected: true });
    assert(anonList.error, "anonymous roles cannot call list RPC"); assert(anonSet.error, "anonymous roles cannot mutate claims");
    const anonRows = await anon.from("region_claims").select("*").eq("session_id", sessionId);
    assert(anonRows.error || anonRows.data?.length === 0, "anonymous roles cannot read claims");

    const expired = await admin.from("photo_sessions").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", sessionId);
    assert.equal(expired.error, null);
    assert.equal((await api("/region-claims", loser)).status, 410);
    assert.equal((await api("/region-claims", loser, { regionId: "person_001", selected: false })).status, 410);
    const expiredRpc = await claim(loser, false);
    assert.equal(expiredRpc.error?.message, "Session expired");
  } finally {
    await cleanupClaimsFixture(admin, fixture);
    const leftover = await admin.from("region_claims").select("region_id").eq("session_id", sessionId);
    assert.equal(leftover.error, null); assert.deepEqual(leftover.data, [], "room cleanup cascades to claims");
  }
});
