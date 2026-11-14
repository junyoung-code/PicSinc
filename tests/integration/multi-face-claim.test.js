import assert from "node:assert/strict";
import test from "node:test";

import {
  FaceClaimError,
  createFaceClaimService,
} from "../../src/features/face-claim/faceClaimService.js";
import { createInMemoryFaceClaimStore } from "../../src/features/face-claim/inMemoryFaceClaimStore.js";
import { createEditAuthorization } from "../../src/features/editing/editAuthorization.js";

function createFixture({ count = 16, claims = [], editedPersonIds = [] } = {}) {
  const layersBySession = new Map([
    ["session-1", Array.from({ length: count }, (_, index) => ({
      personId: `person-${index + 1}`,
      faceBox: { x: index * 10, y: 0, width: 8, height: 8 },
      roi: { x: index * 10, y: 0, width: 10, height: 10 },
      maskKey: null,
    }))],
    ["session-2", [{
      personId: "other-session-person",
      faceBox: { x: 0, y: 0, width: 8, height: 8 },
      roi: { x: 0, y: 0, width: 10, height: 10 },
      maskKey: null,
    }]],
  ]);
  const claimStore = createInMemoryFaceClaimStore({ claims });
  const edited = new Set(editedPersonIds);
  const service = createFaceClaimService({
    listPersonLayers: async ({ sessionId }) => layersBySession.get(sessionId) ?? [],
    claimStore,
    hasEditRevisions: async ({ sessionId, personId }) => edited.has(`${sessionId}/${personId}`),
    now: () => "2026-09-01T00:00:00.000Z",
  });
  return { service, claimStore };
}

test("one user atomically claims all sixteen detected faces without a per-user limit", async () => {
  const { service } = createFixture();
  const personIds = Array.from({ length: 16 }, (_, index) => `person-${index + 1}`);
  const result = await service.claimPeople({ sessionId: "session-1", personIds, userId: "user-a" });

  assert.deepEqual(result.claimedPersonIds, personIds);
  const people = await service.listPeople({ sessionId: "session-1", userId: "user-a" });
  assert.ok(people.every((person) => person.claimState === "mine"));
  assert.ok(people.every((person) => !("userId" in person)));
});

test("a user can add claims later and replay owned claims idempotently", async () => {
  const { service, claimStore } = createFixture();
  await service.claimPeople({ sessionId: "session-1", personIds: ["person-1", "person-2"], userId: "user-a" });
  await service.claimPeople({ sessionId: "session-1", personIds: ["person-2", "person-3"], userId: "user-a" });

  const claims = await claimStore.listBySession({ sessionId: "session-1" });
  assert.deepEqual(claims.map((claim) => claim.personId).sort(), ["person-1", "person-2", "person-3"]);
});

test("one conflict rejects the complete multi-claim without partial writes", async () => {
  const { service, claimStore } = createFixture({
    claims: [{
      sessionId: "session-1",
      personId: "person-2",
      userId: "user-b",
      claimedAt: "2026-09-01T00:00:00.000Z",
    }],
  });

  await assert.rejects(
    () => service.claimPeople({
      sessionId: "session-1",
      personIds: ["person-1", "person-2", "person-3"],
      userId: "user-a",
    }),
    (error) => error instanceof FaceClaimError
      && error.code === "CLAIM_CONFLICT"
      && error.details.personIds[0] === "person-2",
  );
  const claims = await claimStore.listBySession({ sessionId: "session-1" });
  assert.deepEqual(claims.map((claim) => claim.personId), ["person-2"]);
});

test("a person has one exclusive owner across competing claim requests", async () => {
  const { service } = createFixture();
  const results = await Promise.allSettled([
    service.claimPeople({ sessionId: "session-1", personIds: ["person-1"], userId: "user-a" }),
    service.claimPeople({ sessionId: "session-1", personIds: ["person-1"], userId: "user-b" }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("invalid, cross-session, empty, and duplicate person selections are rejected", async () => {
  const { service } = createFixture();
  const cases = [
    { personIds: [], code: "INVALID_PERSON_IDS" },
    { personIds: ["person-1", "person-1"], code: "DUPLICATE_PERSON_IDS" },
    { personIds: ["missing"], code: "INVALID_PERSON" },
    { personIds: ["other-session-person"], code: "INVALID_PERSON" },
  ];

  for (const fixture of cases) {
    await assert.rejects(
      () => service.claimPeople({ sessionId: "session-1", personIds: fixture.personIds, userId: "user-a" }),
      (error) => error instanceof FaceClaimError && error.code === fixture.code,
    );
  }
});

test("claim state reveals ownership category without exposing another user id", async () => {
  const { service } = createFixture({
    claims: [
      { sessionId: "session-1", personId: "person-1", userId: "user-a", claimedAt: "time-1" },
      { sessionId: "session-1", personId: "person-2", userId: "user-b", claimedAt: "time-2" },
    ],
  });
  const people = await service.listPeople({ sessionId: "session-1", userId: "user-a" });

  assert.equal(people[0].claimState, "mine");
  assert.equal(people[1].claimState, "claimed");
  assert.equal(people[2].claimState, "available");
  assert.ok(people.every((person) => !("userId" in person)));
});

test("only the owner can release a claim and only before any revision exists", async () => {
  const claim = {
    sessionId: "session-1",
    personId: "person-1",
    userId: "user-a",
    claimedAt: "2026-09-01T00:00:00.000Z",
  };
  const owned = createFixture({ claims: [claim] });
  await assert.rejects(
    () => owned.service.releaseClaim({ sessionId: "session-1", personId: "person-1", userId: "user-b" }),
    (error) => error instanceof FaceClaimError && error.code === "NOT_CLAIM_OWNER",
  );
  assert.deepEqual(
    await owned.service.releaseClaim({ sessionId: "session-1", personId: "person-1", userId: "user-a" }),
    { releasedPersonId: "person-1" },
  );

  const locked = createFixture({ claims: [claim], editedPersonIds: ["session-1/person-1"] });
  await assert.rejects(
    () => locked.service.releaseClaim({ sessionId: "session-1", personId: "person-1", userId: "user-a" }),
    (error) => error instanceof FaceClaimError && error.code === "CLAIM_LOCKED",
  );
});

test("edit and revision acceptance authorize every owned face independently", async () => {
  const { service } = createFixture();
  await service.claimPeople({
    sessionId: "session-1",
    personIds: ["person-1", "person-2", "person-3", "person-4"],
    userId: "user-a",
  });
  const authorization = createEditAuthorization({ faceClaimService: service });

  for (const personId of ["person-1", "person-2", "person-3", "person-4"]) {
    await authorization.authorizeEdit({ sessionId: "session-1", personId, userId: "user-a" });
    const revision = { revisionId: `revision-${personId}`, personId, status: "preview" };
    assert.equal(
      await authorization.authorizeAccept({ sessionId: "session-1", revision, userId: "user-a" }),
      revision,
    );
  }

  await assert.rejects(
    () => authorization.authorizeEdit({ sessionId: "session-1", personId: "person-5", userId: "user-a" }),
    (error) => error instanceof FaceClaimError && error.code === "NOT_CLAIM_OWNER",
  );
  await assert.rejects(
    () => authorization.authorizeAccept({
      sessionId: "session-1",
      revision: { revisionId: "revision-foreign", personId: "person-1", status: "preview" },
      userId: "user-b",
    }),
    (error) => error instanceof FaceClaimError && error.code === "NOT_CLAIM_OWNER",
  );
});
