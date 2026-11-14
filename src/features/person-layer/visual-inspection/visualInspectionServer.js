import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMeituDetectionClientFromEnv } from "../../../integrations/meitu/detection/meituDetectionClient.js";
import { createPillowImageRuntime } from "../pillowImageRuntime.js";
import { inspectPersonLayers } from "../personLayerVisualInspection.js";

const directory = dirname(fileURLToPath(import.meta.url));
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.ceil(MAX_MEDIA_BYTES * 4 / 3) + 32_768;

export function createVisualInspectionApp({ createDetectionClient = loadDetectionClient, createImageRuntime = createPillowImageRuntime } = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") return sendFile(response, "index.html", "text/html; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/visual-inspection.css") return sendFile(response, "visual-inspection.css", "text/css; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/visual-inspection.js") return sendFile(response, "visual-inspection.js", "text/javascript; charset=utf-8");
      if (request.method === "POST" && url.pathname === "/api/inspect") return inspectRequest({ request, response, createDetectionClient, createImageRuntime });
      return sendJson(response, 404, { error: { code: "NOT_FOUND", message: "요청한 경로를 찾을 수 없습니다." } });
    } catch (error) { return sendJson(response, statusFor(error), { error: { code: error?.code ?? "INSPECTION_FAILED", message: clientMessage(error) } }); }
  });
}

export async function inspectRequest({ request, response, createDetectionClient, createImageRuntime }) {
  const input = validateInput(await readJson(request, MAX_REQUEST_BYTES));
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
  const emit = (event) => response.write(`${JSON.stringify({ type: "status", ...event })}\n`);
  try {
    const result = await inspectPersonLayers({ ...input, meituClient: await createDetectionClient(), imageRuntime: createImageRuntime(), onStatus: emit });
    response.end(`${JSON.stringify({ type: "complete", ...result })}\n`);
  } catch (error) { response.end(`${JSON.stringify({ type: "error", error: publicError(error) })}\n`); }
}

export async function startVisualInspectionServer({ port = Number(process.env.PORT ?? 4175), host = "127.0.0.1", ...options } = {}) {
  const server = createVisualInspectionApp(options);
  await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(port, host, resolveListen); });
  return { server, localUrl: `http://${host}:${server.address().port}` };
}

async function loadDetectionClient() { return createMeituDetectionClientFromEnv({ ...process.env, ...(await readLocalEnv()) }); }
async function readLocalEnv() {
  try { const text = await readFile(resolve(directory, "../../../../.env.local"), "utf8"); return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => { const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); return match && !match[1].startsWith("#") ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, "$2")]] : []; })); }
  catch (error) { if (error?.code === "ENOENT") return {}; throw error; }
}
function validateInput(body) {
  if (body?.consent !== true) throw withCode("CONSENT_REQUIRED", "Meitu 전송에 동의한 뒤 검증을 실행해 주세요.");
  const width = Number(body?.image?.width); const height = Number(body?.image?.height); const dataType = body?.sourceMedia?.dataType; const data = body?.sourceMedia?.data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !["jpg", "png"].includes(dataType) || typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw withCode("INVALID_MEDIA", "2MB 이하 JPG 또는 PNG 사진을 선택해 주세요.");
  if (Buffer.byteLength(data, "base64") > MAX_MEDIA_BYTES) throw withCode("MEDIA_TOO_LARGE", "사진은 2MB 이하의 JPG 또는 PNG여야 합니다.");
  return { image: { width, height }, sourceMedia: { data, dataType } };
}
function withCode(code, message) { return Object.assign(new Error(message), { code }); }
function statusFor(error) { return ["CONSENT_REQUIRED", "INVALID_MEDIA", "MEDIA_TOO_LARGE", "NO_FACE"].includes(error?.code) ? 400 : error?.code === "MISCONFIGURED" ? 503 : 502; }
function clientMessage(error) { return ({ NO_FACE: "얼굴을 찾지 못했습니다.", TIMEOUT: "Meitu 응답 시간이 초과되었습니다.", VENDOR_FAILURE: "Meitu 요청을 처리하지 못했습니다.", MISCONFIGURED: "서버의 Meitu 자격 증명이 설정되지 않았습니다." }[error?.code] ?? error?.message ?? "검증을 처리하지 못했습니다."); }
function publicError(error) { return { code: error?.code ?? "INSPECTION_FAILED", stage: error?.stage ?? "request", faceNumber: error?.faceNumber ?? null, totalFaces: error?.totalFaces ?? null, meituCalls: error?.meituCalls ?? null, httpStatus: safeNumber(error?.httpStatus), vendorCode: safeNumber(error?.vendorCode), diagnosticKind: safeDiagnosticKind(error?.diagnosticKind), message: clientMessage(error), advice: failureAdvice(error) }; }
function failureAdvice(error) {
  if (error?.httpStatus === 429) return "Meitu가 호출량을 제한했습니다. 잠시 기다린 뒤 다시 시도하거나 호출 쿼터를 확인하세요.";
  if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 500) return "Meitu 서버 오류입니다. 잠시 기다린 뒤 다시 시도하세요.";
  if (error?.diagnosticKind === "empty-mask") return "Meitu가 mask 데이터를 반환하지 않았습니다. 같은 얼굴 ROI로 재시도하세요.";
  if (error?.diagnosticKind === "transport") return "Meitu 서버와 통신하지 못했습니다. 네트워크와 서비스 상태를 확인한 뒤 재시도하세요.";
  return ({ TIMEOUT: "잠시 뒤 다시 시도하세요. 반복되면 ROI 크기와 Meitu 요청 제한을 확인하세요.", INVALID_MEDIA: "선택한 사진과 해당 ROI의 형식·크기 조건을 확인하세요.", MEDIA_TOO_LARGE: "2MB 이하 JPG 또는 PNG로 줄여 다시 시도하세요.", MISCONFIGURED: "서버의 .env.local Meitu 설정을 확인하세요.", VENDOR_FAILURE: "Meitu의 일시 오류 또는 계정 호출 제한일 수 있습니다. 잠시 뒤 재시도하세요.", INVALID_MASK: "Meitu mask를 해석하지 못했습니다. 같은 사진으로 재시도 후 지속되면 mask 응답 형식을 확인하세요." }[error?.code] ?? "화면의 단계와 오류 코드를 기록한 뒤 재시도하세요.");
}
function safeNumber(value) { return Number.isInteger(value) ? value : null; }
function safeDiagnosticKind(value) { return ["timeout", "transport", "invalid-response", "vendor-response", "empty-mask"].includes(value) ? value : null; }
async function sendFile(response, fileName, contentType) { const body = await readFile(resolve(directory, fileName)); response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" }); response.end(body); }
function sendJson(response, status, value) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); }
async function readJson(request, maxBytes) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw withCode("MEDIA_TOO_LARGE", "사진은 2MB 이하의 JPG 또는 PNG여야 합니다."); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw withCode("INVALID_MEDIA", "요청 형식이 올바르지 않습니다."); } }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const { localUrl } = await startVisualInspectionServer(); console.log(`얼굴 레이어 시각 검증: ${localUrl}`); }
