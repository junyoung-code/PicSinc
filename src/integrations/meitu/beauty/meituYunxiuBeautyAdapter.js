import { MeituBeautyError, createMeituBeautyAdapter } from "./meituBeautyAdapter.js";

// Contract-ready PRO transport only. The current PicSinc trial explicitly does
// not grant Yunxiu PRO or PRO Preview, so application wiring must use the
// individually granted adapter in meituGrantedBeautyAdapter.js instead.

const DEFAULT_BASE_URL = "https://openapi-yunxiu.meitu.com";
const SUBMIT_PATH = "/openapi/chain.json";
const QUERY_PATH = "/openapi/query.json";
const SUPPORTED_MEDIA_TYPES = new Set(["jpg", "jpeg", "png"]);

// These are product profiles, not image-derived defaults. A user must choose
// the makeup style before either profile is sent to Meitu.
const MAKEUP_STRENGTH = Object.freeze({ natural: 30, glam: 70 });

/** Maps Picsinc controls to the documented Yunxiu PRO 7.7.0 raw parameters. */
export function toYunxiuAllParams(params) {
  const allParams = {};
  if ("skinSmoothing" in params) allParams.face_balance_alpha = [integer(params.skinSmoothing)];
  // Yunxiu exposes temperature as an image-level field. The source image sent
  // here is only the selected person's ROI, and composition applies its mask.
  if ("skinTone" in params) allParams.temperature = integer(params.skinTone);
  if ("faceSlimming" in params) allParams.face_trans = [integer(params.faceSlimming)];
  if ("hairEnhancement" in params) allParams.broken_hair = [integer(params.hairEnhancement)];
  if (params.makeupStyle && params.makeupStyle !== "none") {
    const strength = MAKEUP_STRENGTH[params.makeupStyle];
    if (strength === undefined) throw new MeituBeautyError("INVALID_PARAMS", "Unsupported makeup style", { stage: "mapping" });
    Object.assign(allParams, {
      eyebrow_deepen: [strength],
      eyeshadow_deepen: [strength],
      facial_deepen: [strength],
      lipstick_deepen: [strength],
      highlight_alpha: [strength],
      shadow_light: [strength],
    });
  }
  if (Object.keys(allParams).length === 0) {
    throw new MeituBeautyError("INVALID_PARAMS", "At least one effective beauty value is required", { stage: "mapping" });
  }
  return allParams;
}

/**
 * Creates the live Yunxiu PRO adapter.
 *
 * Yunxiu accepts only a public, non-IP image URL; `publishRoi` is the private
 * storage boundary which must publish only the padded ROI and may return a
 * `release` callback to remove the temporary object after the job finishes.
 */
export function createMeituYunxiuBeautyAdapter({
  apiKey,
  apiSecret,
  publishRoi,
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
  requestTimeoutMs = 10_000,
  jobTimeoutMs = 90_000,
  pollIntervalMs = 1_000,
  wait = delay,
  now = Date.now,
} = {}) {
  if (!apiKey || !apiSecret || typeof publishRoi !== "function" || typeof fetchImpl !== "function") {
    throw new MeituBeautyError("MISCONFIGURED", "Yunxiu credentials, ROI publisher, and fetch are required");
  }

  return createMeituBeautyAdapter({
    async requestPreview({ roiMedia, params, personId, maskKey }) {
      validateRoiMedia(roiMedia);
      let publication;
      try {
        publication = normalizePublication(await publishRoi({ roiMedia, personId, maskKey }));
        const submitted = await postJson({
          fetchImpl,
          url: new URL(SUBMIT_PATH, baseUrl),
          body: {
            api_key: apiKey,
            api_secret: apiSecret,
            media_data: publication.url,
            parameter: { all_params: toYunxiuAllParams(params) },
          },
          timeoutMs: requestTimeoutMs,
          stage: "submit",
        });
        const chainId = submitted.data?.chain_id;
        if (typeof chainId !== "string" || chainId.length === 0) {
          throw new MeituBeautyError("INVALID_RESPONSE", "Yunxiu returned no chain_id", { stage: "submit" });
        }

        const deadline = now() + jobTimeoutMs;
        for (;;) {
          if (now() >= deadline) {
            throw new MeituBeautyError("TIMEOUT", "Yunxiu beauty job timed out", { stage: "query", retryable: true });
          }
          const queried = await postJson({
            fetchImpl,
            url: new URL(QUERY_PATH, baseUrl),
            body: { chain_id: chainId },
            timeoutMs: requestTimeoutMs,
            stage: "query",
          });
          const result = queried.data ?? {};
          if (result.status === "success") return downloadResult({ fetchImpl, result, timeoutMs: requestTimeoutMs });
          if (result.status === "error") throw jobError(result);
          if (!["waiting", "processing"].includes(result.status)) {
            throw new MeituBeautyError("INVALID_RESPONSE", "Yunxiu returned an unknown job status", { stage: "query" });
          }
          await wait(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
        }
      } finally {
        await publication?.release?.();
      }
    },
  });
}

export function createMeituYunxiuBeautyAdapterFromEnv(env = process.env, options = {}) {
  return createMeituYunxiuBeautyAdapter({
    apiKey: env.MEITU_APP_KEY,
    apiSecret: env.MEITU_SECRET_ID,
    ...options,
  });
}

async function postJson({ fetchImpl, url, body, timeoutMs, stage }) {
  const response = await requestWithTimeout(fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs, stage);
  const payload = await parseJson(response, stage);
  if (!response.ok || payload.code !== 0) {
    const vendorCode = payload.code;
    throw new MeituBeautyError(mapBusinessCode(vendorCode), payload.message ?? payload.msg ?? "Yunxiu request failed", {
      stage, status: response.status, vendorCode, retryable: vendorCode === 11002 || response.status >= 500,
    });
  }
  return payload;
}

async function downloadResult({ fetchImpl, result, timeoutMs }) {
  const candidates = [result.after_url, result.after_url_backup].filter(Boolean);
  if (candidates.length === 0) throw new MeituBeautyError("INVALID_RESPONSE", "Yunxiu returned no result URL", { stage: "download" });
  let lastError;
  for (const candidate of candidates) {
    try {
      const response = await requestWithTimeout(fetchImpl, new URL(candidate), { method: "GET" }, timeoutMs, "download");
      if (!response.ok) throw new MeituBeautyError("DOWNLOAD_FAILED", "Yunxiu result download failed", { stage: "download", status: response.status, retryable: true });
      const contentType = response.headers.get("content-type")?.split(";", 1)[0];
      const dataType = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : null;
      if (!dataType) throw new MeituBeautyError("INVALID_RESPONSE", "Yunxiu result is not JPG or PNG", { stage: "download" });
      return { data: Buffer.from(await response.arrayBuffer()).toString("base64"), dataType };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function requestWithTimeout(fetchImpl, url, init, timeoutMs, stage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new MeituBeautyError("TIMEOUT", "Yunxiu request timed out", { cause: error, stage, retryable: true });
    if (error instanceof MeituBeautyError) throw error;
    throw new MeituBeautyError("VENDOR_FAILURE", "Yunxiu request failed", { cause: error, stage, retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson(response, stage) {
  try {
    return await response.json();
  } catch (cause) {
    throw new MeituBeautyError("INVALID_RESPONSE", "Yunxiu returned invalid JSON", { cause, stage, status: response.status });
  }
}

function jobError(result) {
  const vendorCode = result.error_code;
  return new MeituBeautyError(mapJobCode(vendorCode), result.error_msg || "Yunxiu beauty job failed", {
    stage: "query", vendorCode, retryable: [20001, 29901, 29902, 90024, 10015].includes(vendorCode),
  });
}

function mapBusinessCode(code) {
  if (code === 11001 || code === 25002) return "INVALID_REQUEST";
  if (code === 25001) return "INVALID_PRESET";
  return "VENDOR_FAILURE";
}

function mapJobCode(code) {
  if (code === 29902) return "TIMEOUT";
  if (code === 90024) return "RATE_LIMITED";
  if ([10007, 21002, 21003, 20605, 20606].includes(code)) return "INVALID_MEDIA";
  if ([21101, 21205, 21206].includes(code)) return "DOWNLOAD_FAILED";
  return "VENDOR_FAILURE";
}

function validateRoiMedia(media) {
  if (!media?.data || !SUPPORTED_MEDIA_TYPES.has(media.dataType)) {
    throw new MeituBeautyError("INVALID_MEDIA", "Yunxiu requires a JPG or PNG ROI", { stage: "publish" });
  }
}

function normalizePublication(value) {
  const publication = typeof value === "string" ? { url: value } : value;
  let url;
  try {
    url = new URL(publication?.url);
  } catch {
    throw new MeituBeautyError("INVALID_MEDIA_URL", "ROI publisher returned an invalid URL", { stage: "publish" });
  }
  if (url.protocol !== "https:" || isIpHost(url.hostname)) {
    throw new MeituBeautyError("INVALID_MEDIA_URL", "Yunxiu requires a public HTTPS URL with a hostname", { stage: "publish" });
  }
  return { url: url.href, release: typeof publication.release === "function" ? publication.release : undefined };
}

function isIpHost(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function integer(value) {
  if (!Number.isFinite(value)) throw new MeituBeautyError("INVALID_PARAMS", "Beauty values must be finite numbers", { stage: "mapping" });
  return Math.round(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
