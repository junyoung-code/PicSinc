import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPersonLayers } from "../../person-layer/personLayerPipeline.js";
import { createMeituDetectionClientFromEnv } from "../../../integrations/meitu/detection/meituDetectionClient.js";

const demoDirectory = dirname(fileURLToPath(import.meta.url));
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 32_768;

/** A narrow local diagnostic: media is retained only while this request runs. */
export function createFaceDetectionDemoApp({ createDetectionClient = loadDetectionClient } = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") return sendFile(response, "index.html", "text/html; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/diagnostic.css") return sendFile(response, "diagnostic.css", "text/css; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/diagnostic.js") return sendFile(response, "diagnostic.js", "text/javascript; charset=utf-8");
      if (request.method === "POST" && url.pathname === "/api/detect") {
        const result = await detectFaceLayers({ body: await readJson(request, MAX_REQUEST_BYTES), createDetectionClient });
        return sendJson(response, 200, result);
      }
      return sendJson(response, 404, { error: { code: "NOT_FOUND", message: "요청한 경로를 찾을 수 없습니다." } });
    } catch (error) {
      return sendJson(response, statusFor(error), { error: { code: error?.code ?? "DETECTION_FAILED", message: clientMessage(error) } });
    }
  });
}

export async function detectFaceLayers({ body, createDetectionClient = loadDetectionClient }) {
  const input = validateDetectionInput(body);
  const people = await detectPersonLayers({ image: input.image, sourceMedia: input.sourceMedia, meituClient: await createDetectionClient() });
  return { image: input.image, people };
}

export async function startFaceDetectionDemoServer({ port = Number(process.env.PORT ?? 4174), host = "127.0.0.1", ...options } = {}) {
  const server = createFaceDetectionDemoApp(options);
  await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(port, host, resolveListen); });
  return { server, localUrl: `http://${host}:${server.address().port}` };
}

async function loadDetectionClient() {
  return createMeituDetectionClientFromEnv({ ...process.env, ...(await readLocalEnv()) });
}

async function readLocalEnv() {
  try {
    const text = await readFile(resolve(demoDirectory, "../../../../.env.local"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      return match && !match[1].startsWith("#") ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, "$2")]] : [];
    }));
  } catch (error) { if (error?.code === "ENOENT") return {}; throw error; }
}

function validateDetectionInput(body) {
  if (body?.consent !== true) throw withCode("CONSENT_REQUIRED", "Meitu 전송에 동의한 뒤 얼굴 찾기를 실행해 주세요.");
  const width = Number(body?.image?.width); const height = Number(body?.image?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw withCode("INVALID_MEDIA", "사진 크기를 확인할 수 없습니다.");
  const dataType = body?.sourceMedia?.dataType; const data = body?.sourceMedia?.data;
  if (!["jpg", "png"].includes(dataType) || typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw withCode("INVALID_MEDIA", "JPG 또는 PNG 사진만 사용할 수 있습니다.");
  if (Buffer.byteLength(data, "base64") > MAX_MEDIA_BYTES) throw withCode("MEDIA_TOO_LARGE", "사진은 2MB 이하의 JPG 또는 PNG여야 합니다.");
  return { image: { width, height }, sourceMedia: { data, dataType } };
}
function withCode(code, message) { return Object.assign(new Error(message), { code }); }
function statusFor(error) { return ["CONSENT_REQUIRED", "INVALID_MEDIA", "MEDIA_TOO_LARGE", "NO_FACE"].includes(error?.code) ? 400 : error?.code === "MISCONFIGURED" ? 503 : 502; }
function clientMessage(error) {
  return ({ NO_FACE: "얼굴을 찾지 못했습니다. 얼굴이 잘 보이는 다른 사진을 사용해 주세요.", TIMEOUT: "Meitu 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", VENDOR_FAILURE: "Meitu 얼굴 감지 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", MISCONFIGURED: "서버의 Meitu 자격 증명이 설정되지 않았습니다. .env.local을 확인해 주세요." }[error?.code] ?? error?.message ?? "얼굴 찾기를 처리하지 못했습니다.");
}
async function sendFile(response, fileName, contentType) { const body = await readFile(resolve(demoDirectory, fileName)); response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" }); response.end(body); }
function sendJson(response, status, value) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); }
async function readJson(request, maxBytes) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw withCode("MEDIA_TOO_LARGE", "사진은 2MB 이하의 JPG 또는 PNG여야 합니다."); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw withCode("INVALID_MEDIA", "요청 형식이 올바르지 않습니다."); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const { localUrl } = await startFaceDetectionDemoServer(); console.log(`얼굴 찾기 진단 화면: ${localUrl}`); }
