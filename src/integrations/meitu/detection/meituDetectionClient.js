const DEFAULT_BASE_URL = "https://openapi.mtlab.meitu.com";

export class MeituDetectionError extends Error {
  constructor(code, message, { status, vendorCode, diagnosticKind, cause } = {}) {
    super(message, { cause });
    this.name = "MeituDetectionError";
    this.code = code;
    this.status = status;
    this.vendorCode = vendorCode;
    this.diagnosticKind = diagnosticKind;
  }
}

/** Creates the server-only adapter for Meitu's face and matting endpoints. */
export function createMeituDetectionClient({
  appKey,
  secretId,
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 10_000,
}) {
  if (!appKey || !secretId) {
    throw new MeituDetectionError("MISCONFIGURED", "Meitu API credentials are missing");
  }

  async function post(path, body) {
    const url = new URL(path, baseUrl);
    // Meitu documents these values as query parameters. Never log this URL.
    url.searchParams.set("api_key", appKey);
    url.searchParams.set("api_secret", secretId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new MeituDetectionError("TIMEOUT", "Meitu request timed out", { diagnosticKind: "timeout", cause: error });
      }
      throw new MeituDetectionError("VENDOR_FAILURE", "Meitu request failed", { diagnosticKind: "transport", cause: error });
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new MeituDetectionError("VENDOR_FAILURE", "Meitu returned invalid JSON", {
        status: response.status,
        diagnosticKind: "invalid-response",
        cause: error,
      });
    }

    if (!response.ok || payload.ErrorCode) {
      throw mapVendorError(payload, response.status);
    }
    return payload;
  }

  return {
    async detectFaces(image) {
      const payload = await post("/v2/facepoints", {
        parameter: { return_landmark: 3 },
        extra: {},
        media_info_list: [toMediaInfo(image)],
      });
      const faces = payload.media_info_list?.[0]?.media_extra?.faces;
      if (!Array.isArray(faces) || faces.length === 0) {
        throw new MeituDetectionError("NO_FACE", "No face detected");
      }
      return { faces, payload };
    },

    async createMattingMask(image) {
      const payload = await post("/v1/matting", {
        parameter: { nMask: true, rsp_media_type: "jpg" },
        extra: {},
        media_info_list: [toMediaInfo(image)],
      });
      const result = payload.media_info_list?.[0];
      if (!result?.media_data) {
        throw new MeituDetectionError("VENDOR_FAILURE", "Meitu returned no matting mask", { diagnosticKind: "empty-mask" });
      }
      return {
        base64: result.media_data,
        dataType: result.media_profiles?.media_data_type ?? "jpg",
        payload,
      };
    },
  };
}

export function createMeituDetectionClientFromEnv(env = process.env, options = {}) {
  return createMeituDetectionClient({
    appKey: env.MEITU_APP_KEY,
    secretId: env.MEITU_SECRET_ID,
    ...options,
  });
}

function toMediaInfo({ data, dataType = "jpg" }) {
  if (!data || !["jpg", "png", "url"].includes(dataType)) {
    throw new MeituDetectionError("INVALID_MEDIA", "Image data or type is invalid");
  }
  return {
    media_data: data,
    media_extra: {},
    media_profiles: { media_data_type: dataType },
  };
}

function mapVendorError(payload, status) {
  const vendorCode = payload?.ErrorCode;
  const message = payload?.ErrorMsg ?? "Meitu returned an error";
  const code = mapVendorCode(vendorCode);
  return new MeituDetectionError(code, message, { status, vendorCode, diagnosticKind: "vendor-response" });
}

function mapVendorCode(vendorCode) {
  if (vendorCode === 20003) return "NO_FACE";
  if (vendorCode === 20004 || vendorCode === 21003) return "TOO_MANY_FACES";
  if ([10007, 10010, 10013, 20008, 20009, 20013, 20015, 20023].includes(vendorCode)) {
    return "INVALID_MEDIA";
  }
  if (vendorCode === 10002) return "TIMEOUT";
  return "VENDOR_FAILURE";
}
