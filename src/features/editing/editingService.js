import { randomUUID } from "node:crypto";

import { normalizeEditParams } from "./editParams.js";

export class EditingError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = "EditingError";
    this.code = code;
  }
}

/** Coordinates authorization, lazy mask creation, ROI-only beauty work, and immutable revision history. */
export function createEditingService({
  editAuthorization,
  getPersonLayer,
  listPersonLayers,
  savePersonLayer,
  getPhotoSession,
  ensurePersonLayerMask,
  cropToRoi,
  meituClient,
  prepareAndStoreMask,
  beautyAdapter,
  storePatch,
  revisionStore,
  createId = randomUUID,
}) {
  const required = [getPersonLayer, listPersonLayers, savePersonLayer, getPhotoSession, ensurePersonLayerMask, cropToRoi, storePatch];
  if (!editAuthorization?.authorizeEdit || !editAuthorization?.authorizeAccept || !beautyAdapter?.createPreview || !revisionStore?.createPreview || required.some((value) => typeof value !== "function")) {
    throw new EditingError("MISCONFIGURED", "Editing dependencies are incomplete");
  }
  const preparing = new Map();

  async function readyLayer({ sessionId, personId }) {
    const key = `${sessionId}\u0000${personId}`;
    if (!preparing.has(key)) {
      preparing.set(key, (async () => {
        const layer = await getPersonLayer({ sessionId, personId });
        if (!layer) throw new EditingError("PERSON_NOT_FOUND", "Person layer does not exist");
        if (layer.maskKey) return layer;
        const session = await getPhotoSession({ sessionId });
        if (!session?.image || !session?.sourceMedia) throw new EditingError("SESSION_NOT_FOUND", "Original image is unavailable");
        const layers = await listPersonLayers({ sessionId });
        const collisionBoxes = layers.filter((candidate) => candidate.personId !== personId).map((candidate) => candidate.faceBox);
        const prepared = await ensurePersonLayerMask({
          layer, image: session.image, sourceMedia: session.sourceMedia, meituClient,
          cropToRoi, prepareAndStoreMask, collisionBoxes,
        });
        // Persist the completed mask before a preview/revision can be created.
        await savePersonLayer({ sessionId, layer: prepared });
        return prepared;
      })().finally(() => preparing.delete(key)));
    }
    return preparing.get(key);
  }

  return {
    async requestPreview({ sessionId, personId, userId, controls }) {
      await editAuthorization.authorizeEdit({ sessionId, personId, userId });
      const params = normalizeEditParams(controls);
      const layer = await readyLayer({ sessionId, personId });
      const session = await getPhotoSession({ sessionId });
      const roiMedia = await cropToRoi({ sourceMedia: session.sourceMedia, roi: layer.roi, image: session.image });
      let patchMedia;
      try {
        patchMedia = await beautyAdapter.createPreview({ roiMedia, params, personId, maskKey: layer.maskKey });
      } catch (error) {
        throw new EditingError("BEAUTY_FAILED", "Beauty preview could not be created", { cause: error });
      }
      if (!patchMedia?.data || !patchMedia?.dataType) throw new EditingError("INVALID_BEAUTY_RESULT", "Beauty adapter returned no patch media");
      const revisionId = createId();
      const patchKey = await storePatch({ sessionId, personId, revisionId, roi: layer.roi, maskKey: layer.maskKey, media: patchMedia });
      if (typeof patchKey !== "string" || patchKey.length === 0) throw new EditingError("STORAGE_FAILURE", "Patch storage did not return a key");
      const revision = { revisionId, personId, params, patchKey, status: "preview" };
      await revisionStore.createPreview({ sessionId, revision });
      return revision;
    },
    async acceptPreview({ sessionId, revisionId, userId }) {
      const record = await revisionStore.get({ revisionId });
      if (!record || record.sessionId !== sessionId) throw new EditingError("REVISION_NOT_FOUND", "Revision does not exist in this session");
      await editAuthorization.authorizeAccept({ sessionId, revision: record.revision, userId });
      return revisionStore.acceptPreview({ sessionId, revisionId });
    },
    async cancelPreview({ sessionId, revisionId, userId }) {
      const record = await revisionStore.get({ revisionId });
      if (!record || record.sessionId !== sessionId) throw new EditingError("REVISION_NOT_FOUND", "Revision does not exist in this session");
      await editAuthorization.authorizeAccept({ sessionId, revision: record.revision, userId });
      return revisionStore.cancelPreview({ sessionId, revisionId });
    },
  };
}
