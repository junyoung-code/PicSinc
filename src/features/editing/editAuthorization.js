/**
 * Shared authorization gate for creating an edit and accepting a revision.
 * Route/application handlers call this before mask preparation or vendor work.
 */
export function createEditAuthorization({ faceClaimService }) {
  if (!faceClaimService?.assertClaimOwner) {
    throw new TypeError("faceClaimService.assertClaimOwner is required");
  }

  return {
    async authorizeEdit({ sessionId, personId, userId }) {
      await faceClaimService.assertClaimOwner({ sessionId, personId, userId });
      return { sessionId, personId, userId };
    },

    async authorizeAccept({ sessionId, revision, userId }) {
      if (!revision || typeof revision.personId !== "string") {
        throw new TypeError("revision.personId is required");
      }
      await faceClaimService.assertClaimOwner({
        sessionId,
        personId: revision.personId,
        userId,
      });
      return revision;
    },
  };
}
