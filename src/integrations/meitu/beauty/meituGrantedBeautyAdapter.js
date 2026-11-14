import { MeituBeautyError, createMeituBeautyAdapter } from "./meituBeautyAdapter.js";

const DEFAULT_BASE_URL = "https://api.yunxiu.meitu.com";
const QUERY_PATH = "/openapi/query";
const SUPPORTED_MEDIA_TYPES = new Set(["jpg", "jpeg", "png"]);
const MAKEUP_STRENGTH = Object.freeze({ natural: 30, glam: 70 });
const PEOPLE_TYPE = Object.freeze([
  Object.freeze({ key: "man", gender: 1, name: "男", age: [15, 49] }),
  Object.freeze({ key: "woman", gender: 0, name: "女", age: [15, 49] }),
  Object.freeze({ key: "child", gender: 0, name: "儿童", age: [0, 14] }),
  Object.freeze({ key: "oldwoman", gender: 0, name: "老", age: [50, 100] }),
  Object.freeze({ key: "oldman", gender: 1, name: "老", age: [50, 100] }),
]);

/**
 * Maps Picsinc controls only to the separately granted Yunxiu APIs documented
 * at Meitu API docs 346 (beauty) and 348 (makeup).
 */
export function toGrantedYunxiuOperations(params) {
  if ("hairEnhancement" in params) {
    throw new MeituBeautyError(
      "UNSUPPORTED_CONTROL",
      "Hair cleanup is not part of the currently granted Beauty/Shape/Makeup contracts",
      { stage: "mapping" },
    );
  }

  const operations = [];
  const beauty = {};
  if ("skinSmoothing" in params) beauty.face_balance_alpha = forEveryPerson(params.skinSmoothing);
  if ("skinTone" in params) beauty.skin_color_hue_alpha = forEveryPerson(params.skinTone);
  if ("faceSlimming" in params) beauty.face_trans = forEveryPerson(params.faceSlimming);
  if (Object.keys(beauty).length > 0) {
    operations.push({ service: "beauty", path: "/openapi/beauty_async", allParams: beauty });
  }

  if (params.makeupStyle && params.makeupStyle !== "none") {
    const strength = MAKEUP_STRENGTH[params.makeupStyle];
    if (strength === undefined) {
      throw new MeituBeautyError("INVALID_PARAMS", "Unsupported makeup style", { stage: "mapping" });
    }
    const value = Array(5).fill(strength);
    operations.push({
      service: "makeup",
      path: "/openapi/makeup_async",
      allParams: {
        eyebrow_deepen: [...value],
        eyeshadow_deepen: [...value],
        facial_deepen: [...value],
        lipstick_deepen: [...value],
        highlight_alpha: [...value],
        shadow_light: [...value],
      },
    });
  }

  if (operations.length === 0) {
    throw new MeituBeautyError("INVALID_PARAMS", "At least one effective granted beauty value is required", { stage: "mapping" });
  }
  return operations;
}

/**
 * Live adapter for the individual Beauty and Makeup services enabled on the
 * current trial. It intentionally does not call Yunxiu PRO.
 */
export function createMeituGrantedBeautyAdapter({
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
    throw new MeituBeautyError("MISCONFIGURED", "Meitu credentials, ROI publisher, and fetch are required");
  }

  return createMeituBeautyAdapter({
    async requestPreview({ roiMedia, params, personId, maskKey }) {
      validateRoiMedia(roiMedia);
      const operations = toGrantedYunxiuOperations(params);
      let publication;
      try {
        publication = normalizePublication(await publishRoi({ roiMedia, personId, maskKey }));
        let mediaUrl = publication.url;
        for (const operation of operations) {
          const submitted = await postJson({
            fetchImpl,
            url: credentialedUrl(new URL(operation.path, baseUrl), apiKey, apiSecret),
            body: requestBody(mediaUrl, operation.allParams, roiMedia.dataType),
            timeoutMs: requestTimeoutMs,
            stage: `${operation.service}:submit`,
          });
          const msgId = submitted.data?.msg_id;
          if (typeof msgId !== "string" || msgId.length === 0) {
            throw new MeituBeautyError("INVALID_RESPONSE", "Meitu returned no msg_id", { stage: `${operation.service}:submit` });
          }
          mediaUrl = await queryResult({
            fetchImpl,
            baseUrl,
            apiKey,
            apiSecret,
            msgId,
            service: operation.service,
            requestTimeoutMs,
            jobTimeoutMs,
            pollIntervalMs,
            wait,
            now,
          });
        }
        return downloadResult({ fetchImpl, url: mediaUrl, timeoutMs: requestTimeoutMs });
      } finally {
        await publication?.release?.();
      }
    },
  });
}

export function createMeituGrantedBeautyAdapterFromEnv(env = process.env, options = {}) {
  return createMeituGrantedBeautyAdapter({
    apiKey: env.MEITU_APP_KEY,
    apiSecret: env.MEITU_SECRET_ID,
    ...options,
  });
}

function requestBody(mediaUrl, allParams, dataType) {
  return {
    parameter: {
      all_params: allParams,
      preview_size: 3000,
      req_mask_version: 0,
      people_type: PEOPLE_TYPE,
      output: {
        format: dataType === "png" ? "png" : "jpg",
        preview_size: 3000,
        qualityKey: 12,
        resize_height: 0,
        resize_width: 0,
        water_mark: 0,
        file_size_limit: [0, 0],
      },
    },
    media_info_list: [{
      media_data: mediaUrl,
      media_extra: {},
      media_profiles: { media_data_type: "url", media_data_describe: "src" },
    }],
  };
}

async function queryResult({
  fetchImpl,
  baseUrl,
  apiKey,
  apiSecret,
  msgId,
  service,
  requestTimeoutMs,
  jobTimeoutMs,
  pollIntervalMs,
  wait,
  now,
}) {
  const deadline = now() + jobTimeoutMs;
  for (;;) {
    if (now() >= deadline) {
      throw new MeituBeautyError("TIMEOUT", "Meitu beauty job timed out", { stage: `${service}:query`, retryable: true });
    }
    const response = await requestWithTimeout(fetchImpl, new URL(QUERY_PATH, baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret, msg_id: msgId }),
    }, requestTimeoutMs, `${service}:query`);
    const payload = await parseJson(response, `${service}:query`);
    if (response.ok && payload.code === 0) {
      const mediaUrl = payload.data?.media_data;
      if (typeof mediaUrl !== "string" || mediaUrl.length === 0) {
        throw new MeituBeautyError("INVALID_RESPONSE", "Meitu returned no result URL", { stage: `${service}:query` });
      }
      return normalizeResultUrl(mediaUrl, `${service}:query`);
    }
    if (payload.code !== 29901) throw vendorError(payload, response.status, `${service}:query`);
    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
}

async function postJson({ fetchImpl, url, body, timeoutMs, stage }) {
  const response = await requestWithTimeout(fetchImpl, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs, stage);
  const payload = await parseJson(response, stage);
  if (!response.ok || payload.code !== 0) throw vendorError(payload, response.status, stage);
  return payload;
}

function vendorError(payload, status, stage) {
  const vendorCode = payload.code;
  let code = "VENDOR_FAILURE";
  if (vendorCode === 90002) code = "UNAUTHORIZED";
  else if (vendorCode === 29902) code = "TIMEOUT";
  else if (vendorCode === 11201) code = "DOWNLOAD_FAILED";
  return new MeituBeautyError(code, payload.message || "Meitu request failed", {
    stage,
    status,
    vendorCode,
    retryable: vendorCode === 20001 || status >= 500,
  });
}

async function downloadResult({ fetchImpl, url, timeoutMs }) {
  const response = await requestWithTimeout(fetchImpl, new URL(url), { method: "GET" }, timeoutMs, "download");
  if (!response.ok) {
    throw new MeituBeautyError("DOWNLOAD_FAILED", "Meitu result download failed", {
      stage: "download", status: response.status, retryable: true,
    });
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  const dataType = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : null;
  if (!dataType) throw new MeituBeautyError("INVALID_RESPONSE", "Meitu result is not JPG or PNG", { stage: "download" });
  return { data: Buffer.from(await response.arrayBuffer()).toString("base64"), dataType };
}

async function requestWithTimeout(fetchImpl, url, init, timeoutMs, stage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new MeituBeautyError("TIMEOUT", "Meitu request timed out", { cause: error, stage, retryable: true });
    }
    if (error instanceof MeituBeautyError) throw error;
    throw new MeituBeautyError("VENDOR_FAILURE", "Meitu request failed", { cause: error, stage, retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson(response, stage) {
  try {
    return await response.json();
  } catch (cause) {
    throw new MeituBeautyError("INVALID_RESPONSE", "Meitu returned invalid JSON", { cause, stage, status: response.status });
  }
}

function credentialedUrl(url, apiKey, apiSecret) {
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("api_secret", apiSecret);
  return url;
}

function validateRoiMedia(media) {
  if (!media?.data || !SUPPORTED_MEDIA_TYPES.has(media.dataType)) {
    throw new MeituBeautyError("INVALID_MEDIA", "Meitu requires a JPG or PNG ROI", { stage: "publish" });
  }
}

function normalizePublication(value) {
  const publication = typeof value === "string" ? { url: value } : value;
  return { ...publication, url: normalizeResultUrl(publication?.url, "publish") };
}

function normalizeResultUrl(value, stage) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new MeituBeautyError("INVALID_MEDIA_URL", "Meitu media URL is invalid", { stage });
  }
  if (url.protocol !== "https:" || isIpHost(url.hostname)) {
    throw new MeituBeautyError("INVALID_MEDIA_URL", "Meitu requires a public HTTPS URL with a hostname", { stage });
  }
  return url.href;
}

function isIpHost(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function forEveryPerson(value) {
  if (!Number.isFinite(value)) {
    throw new MeituBeautyError("INVALID_PARAMS", "Beauty values must be finite numbers", { stage: "mapping" });
  }
  return Array(5).fill(Math.round(value));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
