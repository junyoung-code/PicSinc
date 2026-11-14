export class MeituBeautyError extends Error {
  constructor(code, message, { cause, stage, status, vendorCode, retryable = false } = {}) {
    super(message, { cause });
    this.name = "MeituBeautyError";
    this.code = code;
    this.stage = stage;
    this.status = status;
    this.vendorCode = vendorCode;
    this.retryable = retryable;
  }
}

/**
 * Server-side beauty port shared by fake and live transports. A configured
 * implementation receives only the padded ROI, never the full original image.
 * The enabled individual-service transport lives in
 * meituGrantedBeautyAdapter.js. The separate PRO transport is retained only as
 * contract-ready code because the current trial key does not grant PRO.
 */
export function createMeituBeautyAdapter({ requestPreview } = {}) {
  if (typeof requestPreview !== "function") {
    throw new MeituBeautyError(
      "MISCONFIGURED",
      "A validated server-side Meitu beauty request implementation is required",
    );
  }

  return {
    async createPreview({ roiMedia, params, personId, maskKey }) {
      if (!roiMedia?.data || !roiMedia?.dataType) {
        throw new MeituBeautyError("INVALID_MEDIA", "Beauty preview requires ROI media");
      }
      try {
        return await requestPreview({ roiMedia, params, personId, maskKey });
      } catch (error) {
        if (error instanceof MeituBeautyError) throw error;
        throw new MeituBeautyError("VENDOR_FAILURE", "Meitu beauty request failed", { cause: error });
      }
    },
  };
}

/** Deterministic development/test adapter; it performs no external processing. */
export function createFakeMeituBeautyAdapter({ createPatch } = {}) {
  if (typeof createPatch !== "function") {
    throw new MeituBeautyError("MISCONFIGURED", "createPatch is required for the fake beauty adapter");
  }
  return createMeituBeautyAdapter({ requestPreview: createPatch });
}
