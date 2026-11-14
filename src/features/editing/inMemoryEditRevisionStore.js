export class EditRevisionStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EditRevisionStoreError";
    this.code = code;
    this.details = details;
  }
}

/** Test/development revision persistence port. Never mutates an existing revision. */
export function createInMemoryEditRevisionStore() {
  const records = new Map();

  return {
    async createPreview({ sessionId, revision }) {
      if (records.has(revision.revisionId)) throw new EditRevisionStoreError("DUPLICATE_REVISION", "Revision already exists");
      records.set(revision.revisionId, Object.freeze({ sessionId, revision: Object.freeze({ ...revision }) }));
      return { ...revision };
    },
    async get({ revisionId }) {
      const record = records.get(revisionId);
      return record ? { sessionId: record.sessionId, revision: { ...record.revision } } : null;
    },
    async acceptPreview({ sessionId, revisionId }) {
      const record = requireRecord(records, sessionId, revisionId);
      if (record.revision.status !== "preview") {
        throw new EditRevisionStoreError("REVISION_NOT_PREVIEW", "Only a preview revision can be accepted", { revisionId });
      }
      const revision = Object.freeze({ ...record.revision, status: "accepted" });
      records.set(revisionId, Object.freeze({ sessionId, revision }));
      return { ...revision };
    },
    async cancelPreview({ sessionId, revisionId }) {
      const record = requireRecord(records, sessionId, revisionId);
      if (record.revision.status !== "preview") {
        throw new EditRevisionStoreError("REVISION_NOT_PREVIEW", "Only a preview revision can be cancelled", { revisionId });
      }
      records.delete(revisionId);
      return { ...record.revision };
    },
    async hasForPerson({ sessionId, personId }) {
      return [...records.values()].some((record) => record.sessionId === sessionId && record.revision.personId === personId);
    },
    async listByPerson({ sessionId, personId }) {
      return [...records.values()]
        .filter((record) => record.sessionId === sessionId && record.revision.personId === personId)
        .map((record) => ({ ...record.revision }));
    },
  };
}

function requireRecord(records, sessionId, revisionId) {
  const record = records.get(revisionId);
  if (!record || record.sessionId !== sessionId) {
    throw new EditRevisionStoreError("REVISION_NOT_FOUND", "Revision does not exist in this session", { revisionId });
  }
  return record;
}
