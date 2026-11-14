import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createEditAuthorization } from "../editAuthorization.js";
import { createEditingService } from "../editingService.js";
import { createInMemoryEditRevisionStore } from "../inMemoryEditRevisionStore.js";
import { createFaceClaimService } from "../../face-claim/faceClaimService.js";
import { createInMemoryFaceClaimStore } from "../../face-claim/inMemoryFaceClaimStore.js";
import { createFakeMeituBeautyAdapter } from "../../../integrations/meitu/beauty/meituBeautyAdapter.js";
import { ensurePersonLayerMask } from "../../person-layer/personLayerPipeline.js";

const DEMO_USER_ID = "local-demo-user";
const DEMO_SESSION_ID = "local-demo-session";
const demoDirectory = dirname(fileURLToPath(import.meta.url));

export function createDemoApp({ personCount = 3 } = {}) {
  let state = createDemoState({ personCount });

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") return sendFile(response, "index.html", "text/html; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/demo.js") return sendFile(response, "demo.js", "text/javascript; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/photoGeometry.js") return sendFile(response, "photoGeometry.js", "text/javascript; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/faceOverlayGeometry.js") return sendFile(response, "faceOverlayGeometry.js", "text/javascript; charset=utf-8");

      if (request.method === "GET" && url.pathname === "/api/session") {
        return sendJson(response, 200, await state.view());
      }
      if (request.method === "POST" && url.pathname === "/api/claims") {
        const body = await readJson(request);
        await state.claims.claimPeople({ sessionId: DEMO_SESSION_ID, personIds: body.personIds, userId: DEMO_USER_ID });
        return sendJson(response, 200, await state.view());
      }
      const claimMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/claim$/);
      if (request.method === "DELETE" && claimMatch) {
        const released = await state.claims.releaseClaim({
          sessionId: DEMO_SESSION_ID,
          personId: decodeURIComponent(claimMatch[1]),
          userId: DEMO_USER_ID,
        });
        return sendJson(response, 200, { ...released, session: await state.view() });
      }
      const editMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/edits$/);
      if (request.method === "POST" && editMatch) {
        const body = await readJson(request);
        const revision = await state.editing.requestPreview({
          sessionId: DEMO_SESSION_ID,
          personId: decodeURIComponent(editMatch[1]),
          userId: DEMO_USER_ID,
          controls: body.controls,
        });
        return sendJson(response, 201, { revision });
      }
      const acceptMatch = url.pathname.match(/^\/api\/edits\/([^/]+)\/accept$/);
      if (request.method === "POST" && acceptMatch) {
        const revision = await state.editing.acceptPreview({
          sessionId: DEMO_SESSION_ID,
          revisionId: decodeURIComponent(acceptMatch[1]),
          userId: DEMO_USER_ID,
        });
        return sendJson(response, 200, { revision });
      }
      const cancelMatch = url.pathname.match(/^\/api\/edits\/([^/]+)$/);
      if (request.method === "DELETE" && cancelMatch) {
        const revision = await state.editing.cancelPreview({
          sessionId: DEMO_SESSION_ID,
          revisionId: decodeURIComponent(cancelMatch[1]),
          userId: DEMO_USER_ID,
        });
        return sendJson(response, 200, { revision });
      }
      if (request.method === "POST" && url.pathname === "/api/reset") {
        state = createDemoState({ personCount });
        return sendJson(response, 200, await state.view());
      }
      return sendJson(response, 404, { error: { code: "NOT_FOUND", message: "요청한 경로를 찾을 수 없습니다." } });
    } catch (error) {
      const status = ["NOT_CLAIM_OWNER", "CLAIM_CONFLICT"].includes(error?.code) ? 403 : 400;
      return sendJson(response, status, {
        error: { code: error?.code ?? "DEMO_ERROR", message: error?.message ?? "요청을 처리하지 못했습니다." },
      });
    }
  });
}

export async function startDemoServer({ port = Number(process.env.PORT ?? 4173), host = "127.0.0.1" } = {}) {
  const server = createDemoApp();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, resolveListen);
  });
  const address = server.address();
  const localUrl = `http://${host}:${address.port}`;
  return { server, localUrl };
}

function createDemoState({ personCount }) {
  const session = Object.freeze({
    sessionId: DEMO_SESSION_ID,
    image: Object.freeze({ width: 1200, height: 800 }),
    sourceMedia: Object.freeze({ data: "local-demo-original", dataType: "jpg" }),
  });
  const layers = new Map(createDemoLayers(personCount).map((layer) => [layer.personId, layer]));
  const revisionStore = createInMemoryEditRevisionStore();
  const claimStore = createInMemoryFaceClaimStore();
  const claims = createFaceClaimService({
    listPersonLayers: async () => [...layers.values()],
    claimStore,
    hasEditRevisions: revisionStore.hasForPerson,
  });
  const patchKeys = new Set();
  const editing = createEditingService({
    editAuthorization: createEditAuthorization({ faceClaimService: claims }),
    getPersonLayer: async ({ personId }) => layers.get(personId) ?? null,
    listPersonLayers: async () => [...layers.values()],
    savePersonLayer: async ({ layer }) => layers.set(layer.personId, Object.freeze({ ...layer })),
    getPhotoSession: async () => session,
    ensurePersonLayerMask,
    cropToRoi: async ({ roi }) => ({ data: `demo-roi:${roi.x},${roi.y},${roi.width},${roi.height}`, dataType: "jpg" }),
    meituClient: { createMattingMask: async () => ({ base64: "demo-mask", dataType: "png" }) },
    prepareAndStoreMask: async ({ personId }) => `demo/masks/${personId}.png`,
    beautyAdapter: createFakeMeituBeautyAdapter({
      createPatch: async ({ personId, params }) => ({ data: JSON.stringify({ personId, params }), dataType: "json" }),
    }),
    storePatch: async ({ personId, revisionId }) => {
      const key = `demo/patches/${personId}/${revisionId}.json`;
      patchKeys.add(key);
      return key;
    },
    revisionStore,
  });

  return {
    claims,
    editing,
    async view() {
      const people = await claims.listPeople({ sessionId: DEMO_SESSION_ID, userId: DEMO_USER_ID });
      const revisions = (await Promise.all(people.map((person) => revisionStore.listByPerson({ sessionId: DEMO_SESSION_ID, personId: person.personId })))).flat();
      return { sessionId: DEMO_SESSION_ID, image: session.image, people, revisions, patchCount: patchKeys.size };
    },
  };
}

export function createDemoLayers(personCount = 3) {
  if (!Number.isInteger(personCount) || personCount < 1) throw new TypeError("personCount must be a positive integer");
  const reference = [
    { x: 205, y: 218, width: 132, height: 152 },
    { x: 535, y: 175, width: 140, height: 164 },
    { x: 855, y: 230, width: 130, height: 150 },
  ];
  return Array.from({ length: personCount }, (_, index) => {
    const faceBox = reference[index] ?? { x: 40 + (index % 8) * 145, y: 35 + Math.floor(index / 8) * 360, width: 96, height: 120 };
    const x = Math.max(0, faceBox.x - 70);
    const y = Math.max(0, faceBox.y - 90);
    return { personId: `person-${index + 1}`, faceBox, roi: { x, y, width: Math.min(300, 1200 - x), height: Math.min(330, 800 - y) }, maskKey: null };
  });
}

async function sendFile(response, fileName, contentType) {
  const body = await readFile(resolve(demoDirectory, fileName));
  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(body);
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw Object.assign(new Error("요청이 너무 큽니다."), { code: "PAYLOAD_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON 요청 형식이 올바르지 않습니다."), { code: "INVALID_JSON" });
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const personCount = Number(process.env.DEMO_PERSON_COUNT ?? 3);
  const server = createDemoApp({ personCount });
  const port = Number(process.env.PORT ?? 4173);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const { port: boundPort } = server.address();
  const localUrl = `http://127.0.0.1:${boundPort}`;
  console.log(`Picsinc 로컬 데모: ${localUrl}`);
}
