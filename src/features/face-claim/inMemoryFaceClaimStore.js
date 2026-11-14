export class FaceClaimStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FaceClaimStoreError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Test/development implementation of the atomic PersonClaim persistence port.
 * A durable adapter must preserve the same per-session/per-person uniqueness
 * and run releaseOwnedIfUnedited in a transaction with revision storage.
 */
export function createInMemoryFaceClaimStore({ claims = [] } = {}) {
  const records = new Map();

  for (const claim of claims) {
    const key = claimKey(claim.sessionId, claim.personId);
    if (records.has(key)) {
      throw new FaceClaimStoreError("DUPLICATE_CLAIM", "A person already has a claim in this session", {
        personId: claim.personId,
      });
    }
    records.set(key, Object.freeze({ ...claim }));
  }

  return {
    async claimMany({ sessionId, personIds, userId, claimedAt }) {
      const conflicts = personIds.filter((personId) => {
        const existing = records.get(claimKey(sessionId, personId));
        return existing && existing.userId !== userId;
      });

      if (conflicts.length > 0) {
        throw new FaceClaimStoreError("CLAIM_CONFLICT", "One or more people are already claimed", {
          personIds: conflicts,
        });
      }

      const result = [];
      for (const personId of personIds) {
        const key = claimKey(sessionId, personId);
        let claim = records.get(key);
        if (!claim) {
          claim = Object.freeze({ sessionId, personId, userId, claimedAt });
          records.set(key, claim);
        }
        result.push({ ...claim });
      }
      return result;
    },

    async get({ sessionId, personId }) {
      const claim = records.get(claimKey(sessionId, personId));
      return claim ? { ...claim } : null;
    },

    async listBySession({ sessionId }) {
      return [...records.values()]
        .filter((claim) => claim.sessionId === sessionId)
        .map((claim) => ({ ...claim }));
    },

    async releaseOwnedIfUnedited({ sessionId, personId, userId, hasEditRevisions }) {
      const key = claimKey(sessionId, personId);
      const claim = records.get(key);
      if (!claim) {
        throw new FaceClaimStoreError("NOT_CLAIMED", "The person is not claimed", { personId });
      }
      if (claim.userId !== userId) {
        throw new FaceClaimStoreError("NOT_CLAIM_OWNER", "Only the claim owner can release it", { personId });
      }
      if (await hasEditRevisions({ sessionId, personId })) {
        throw new FaceClaimStoreError("CLAIM_LOCKED", "A claim with edit history cannot be released", { personId });
      }
      records.delete(key);
      return { ...claim };
    },
  };
}

function claimKey(sessionId, personId) {
  return `${sessionId}\u0000${personId}`;
}
