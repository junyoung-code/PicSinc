export class FaceClaimError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FaceClaimError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Owns the user-to-PersonLayer relationship. PersonLayer remains an analysis
 * record and never contains user identity.
 */
export function createFaceClaimService({
  listPersonLayers,
  claimStore,
  hasEditRevisions = async () => false,
  now = () => new Date().toISOString(),
}) {
  if (typeof listPersonLayers !== "function" || !claimStore) {
    throw new FaceClaimError("MISCONFIGURED", "Person layers and claim storage are required");
  }

  return {
    async claimPeople({ sessionId, personIds, userId }) {
      assertActor({ sessionId, userId });
      const requestedIds = validatePersonIds(personIds);
      const layers = await listPersonLayers({ sessionId });
      const layerIds = new Set((layers ?? []).map((layer) => layer.personId));
      const invalidIds = requestedIds.filter((personId) => !layerIds.has(personId));
      if (invalidIds.length > 0) {
        throw new FaceClaimError("INVALID_PERSON", "Every person must exist in the requested session", {
          personIds: invalidIds,
        });
      }

      try {
        const claims = await claimStore.claimMany({
          sessionId,
          personIds: requestedIds,
          userId,
          claimedAt: now(),
        });
        return { claimedPersonIds: claims.map((claim) => claim.personId) };
      } catch (error) {
        throw mapStoreError(error);
      }
    },

    async listPeople({ sessionId, userId }) {
      assertActor({ sessionId, userId });
      const [layers, claims] = await Promise.all([
        listPersonLayers({ sessionId }),
        claimStore.listBySession({ sessionId }),
      ]);
      const claimsByPerson = new Map(claims.map((claim) => [claim.personId, claim]));
      return (layers ?? []).map((layer) => {
        const claim = claimsByPerson.get(layer.personId);
        const claimState = !claim ? "available" : claim.userId === userId ? "mine" : "claimed";
        return { ...layer, claimState };
      });
    },

    async assertClaimOwner({ sessionId, personId, userId }) {
      assertActor({ sessionId, userId });
      assertNonEmptyString(personId, "personId");
      const claim = await claimStore.get({ sessionId, personId });
      if (!claim || claim.userId !== userId) {
        throw new FaceClaimError("NOT_CLAIM_OWNER", "Only the claim owner can mutate this person", {
          personId,
        });
      }
      return claim;
    },

    async releaseClaim({ sessionId, personId, userId }) {
      assertActor({ sessionId, userId });
      assertNonEmptyString(personId, "personId");
      try {
        const released = await claimStore.releaseOwnedIfUnedited({
          sessionId,
          personId,
          userId,
          hasEditRevisions,
        });
        return { releasedPersonId: released.personId };
      } catch (error) {
        throw mapStoreError(error);
      }
    },
  };
}

function validatePersonIds(personIds) {
  if (!Array.isArray(personIds) || personIds.length === 0) {
    throw new FaceClaimError("INVALID_PERSON_IDS", "personIds must be a non-empty array");
  }
  for (const personId of personIds) assertNonEmptyString(personId, "personId");
  const uniqueIds = new Set(personIds);
  if (uniqueIds.size !== personIds.length) {
    throw new FaceClaimError("DUPLICATE_PERSON_IDS", "personIds must not contain duplicates");
  }
  return [...personIds];
}

function assertActor({ sessionId, userId }) {
  assertNonEmptyString(sessionId, "sessionId");
  assertNonEmptyString(userId, "userId");
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new FaceClaimError("INVALID_ARGUMENT", `${name} must be a non-empty string`);
  }
}

function mapStoreError(error) {
  if (["CLAIM_CONFLICT", "NOT_CLAIMED", "NOT_CLAIM_OWNER", "CLAIM_LOCKED"].includes(error?.code)) {
    return new FaceClaimError(error.code, error.message, error.details);
  }
  return error;
}
