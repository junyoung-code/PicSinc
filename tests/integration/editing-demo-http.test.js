import assert from "node:assert/strict";
import test from "node:test";

import { createDemoApp, startDemoServer } from "../../src/features/editing/demo/demoServer.js";

test("local demo serves the UI and completes claim, preview, accept, and cancel over HTTP", async (context) => {
  const { server, localUrl } = await startDemoServer({ port: 0 });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const page = await fetch(localUrl);
  assert.equal(page.status, 200);
  const pageText = await page.text();
  assert.match(pageText, /Picsinc 편집 기능 테스트/);
  assert.doesNotMatch(pageText, /같이 찍고/);

  const geometryModule = await fetch(`${localUrl}/photoGeometry.js`);
  assert.equal(geometryModule.status, 200);

  const initial = await jsonFetch(`${localUrl}/api/session`);
  assert.ok(initial.people.every((person) => person.claimState === "available"));

  const claimed = await jsonFetch(`${localUrl}/api/claims`, {
    method: "POST",
    body: { personIds: ["person-1", "person-2"] },
  });
  assert.deepEqual(claimed.people.slice(0, 2).map((person) => person.claimState), ["mine", "mine"]);

  const preview = await jsonFetch(`${localUrl}/api/people/person-1/edits`, {
    method: "POST",
    body: { controls: { skinSmoothing: 30, skinTone: 5, faceSlimming: 0, hairEnhancement: 10, makeupStyle: "natural" } },
  });
  assert.equal(preview.revision.status, "preview");
  assert.match(preview.revision.patchKey, /^demo\/patches\/person-1\//);

  const accepted = await jsonFetch(`${localUrl}/api/edits/${preview.revision.revisionId}/accept`, { method: "POST" });
  assert.equal(accepted.revision.status, "accepted");

  const secondPreview = await jsonFetch(`${localUrl}/api/people/person-2/edits`, {
    method: "POST",
    body: { controls: { skinSmoothing: 5, skinTone: 0, faceSlimming: 10, hairEnhancement: 0, makeupStyle: "none" } },
  });
  const cancelled = await jsonFetch(`${localUrl}/api/edits/${secondPreview.revision.revisionId}`, { method: "DELETE" });
  assert.equal(cancelled.revision.status, "preview");

  const finalState = await jsonFetch(`${localUrl}/api/session`);
  assert.deepEqual(finalState.revisions.map((revision) => revision.status), ["accepted"]);
});

test("a sixteen-person fixture atomically claims four and keeps each work state independent", async (context) => {
  const server = createDemoApp({ personCount: 16 });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const localUrl = `http://127.0.0.1:${port}`;

  const initial = await jsonFetch(`${localUrl}/api/session`);
  assert.equal(initial.people.length, 16);
  const claimedIds = ["person-2", "person-5", "person-9", "person-16"];
  const claimed = await jsonFetch(`${localUrl}/api/claims`, { method: "POST", body: { personIds: claimedIds } });
  assert.deepEqual(claimed.people.filter((person) => person.claimState === "mine").map((person) => person.personId), claimedIds);

  const released = await jsonFetch(`${localUrl}/api/people/person-16/claim`, { method: "DELETE" });
  assert.equal(released.releasedPersonId, "person-16");
  assert.equal(released.session.people.find((person) => person.personId === "person-16").claimState, "available");

  const firstPreview = await jsonFetch(`${localUrl}/api/people/person-2/edits`, { method: "POST", body: { controls: { skinSmoothing: 12 } } });
  const secondPreview = await jsonFetch(`${localUrl}/api/people/person-5/edits`, { method: "POST", body: { controls: { skinTone: 7 } } });
  await jsonFetch(`${localUrl}/api/edits/${firstPreview.revision.revisionId}/accept`, { method: "POST" });
  await jsonFetch(`${localUrl}/api/edits/${secondPreview.revision.revisionId}`, { method: "DELETE" });
  const current = await jsonFetch(`${localUrl}/api/session`);
  assert.deepEqual(current.revisions.map(({ personId, status, params }) => ({ personId, status, params })), [
    { personId: "person-2", status: "accepted", params: { skinSmoothing: 12 } },
  ]);

  const locked = await fetch(`${localUrl}/api/people/person-2/claim`, { method: "DELETE" });
  assert.equal(locked.status, 400);
  assert.equal((await locked.json()).error.code, "CLAIM_LOCKED");
});

async function jsonFetch(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.ok, true, `unexpected ${response.status} response from ${url}`);
  return response.json();
}
