import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { composeRemote, sendUpload, uploadAsset, uploadOriginal } from "./remote-client";
import { RequestError } from "../features/mobile-flow/client";

const storageUrl = "https://storage.example/signed/photo";
const prepared = { uploadId: "one-upload", signedUrl: storageUrl, token: "signed", path: "photo" };
const result = { shareUrl: "/sessions/invite", recoveryUrl: "/recover", session: { inviteToken: "invite" } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function fastRetries(t: TestContext) {
  t.mock.method(globalThis, "setTimeout", (callback: () => void) => { queueMicrotask(callback); return 0; });
}

test("lost completion responses retain the upload ID across automatic and manual retries", async t => {
  fastRetries(t);
  const file = new File(["photo bytes"], "photo.png", { type: "image/png" });
  const calls: { url: string; init?: RequestInit }[] = [];
  let completions = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/uploads") return json(prepared);
    if (url === storageUrl) return new Response(null, { status: 200 });
    assert.equal(url, "/api/uploads/one-upload/complete");
    if (++completions <= 3) throw new TypeError("Failed to fetch");
    return json(result);
  });
  await assert.rejects(uploadOriginal("A", file), TypeError);
  assert.deepEqual(await uploadOriginal("A", file), result);
  assert.equal(calls.filter(call => call.url === "/api/uploads").length, 1);
  assert.equal(calls.filter(call => call.url === storageUrl).length, 1);
  assert.equal(completions, 4);
  for (const call of calls) {
    if (call.url === storageUrl) { assert.equal(call.init?.body, file); assert.equal(call.init?.credentials, "omit"); }
    else assert.equal(typeof call.init?.body, "string", "Vercel receives JSON metadata only");
  }
});

test("completion retries busy conflicts, rate limits, and server errors only", async t => {
  fastRetries(t);
  for (const [status, message] of [[409, "파일을 확인하고 있습니다. 잠시 후 다시 시도해 주세요."], [429, "Busy"], [503, "Unavailable"]] as const) {
    let completions = 0;
    t.mock.method(globalThis, "fetch", async (url: string) => {
      if (url === "/api/uploads") return json(prepared);
      if (url === storageUrl) return new Response(null);
      return ++completions === 1 ? json({ error: message }, status) : json(result);
    });
    assert.deepEqual(await uploadOriginal("A", new File(["x"], "x.png", { type: "image/png" })), result);
    assert.equal(completions, 2);
  }
});

test("retouch uploads retain their completion route and intent after a lost response", async t => {
  fastRetries(t);
  const file = new File(["photo bytes"], "photo.png", { type: "image/png" });
  let prepares = 0, puts = 0, completions = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === "/api/retouch/uploads") { prepares++; return json(prepared); }
    if (url === storageUrl) { puts++; return new Response(null); }
    assert.equal(url, "/api/retouch/uploads/one-upload/complete");
    if (++completions <= 3) throw new TypeError("Lost response");
    return json(result);
  });
  const upload = () => sendUpload("/api/retouch/uploads", file, { nickname: "A", consent: true }, {}, "/api/retouch/uploads");
  await assert.rejects(upload(), TypeError);
  assert.deepEqual(await upload(), result);
  assert.equal(prepares, 1); assert.equal(puts, 1); assert.equal(completions, 4);
});

test("completion destinations do not share cached upload intents", async t => {
  const file = new File(["photo bytes"], "photo.png", { type: "image/png" });
  let prepares = 0, puts = 0;
  const completions: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === "/api/uploads") return json({ ...prepared, uploadId: `upload-${++prepares}` });
    if (url === storageUrl) { puts++; return new Response(null); }
    completions.push(url); return json(result);
  });
  await sendUpload("/api/uploads", file, {}, {});
  await sendUpload("/api/uploads", file, {}, {}, "/api/retouch/uploads");
  assert.deepEqual(completions, ["/api/uploads/upload-1/complete", "/api/retouch/uploads/upload-2/complete"]);
  assert.equal(prepares, 2); assert.equal(puts, 2);
});

test("validation, authorization, and non-busy conflicts are not retried", async t => {
  fastRetries(t);
  for (const status of [400, 401, 403, 409]) {
    let completions = 0;
    t.mock.method(globalThis, "fetch", async (url: string) => {
      if (url === "/api/uploads") return json(prepared);
      if (url === storageUrl) return new Response(null);
      completions++; return json({ error: "Invalid upload" }, status);
    });
    await assert.rejects(uploadOriginal("A", new File(["x"], "x.png", { type: "image/png" })), error => error instanceof RequestError && error.status === status);
    assert.equal(completions, 1);
  }
});

test("lost storage PUT response can complete the existing object without overwriting", async t => {
  fastRetries(t);
  let puts = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/uploads") return json(prepared);
    if (url === storageUrl) {
      assert.equal(init?.method, "PUT");
      assert.equal(new Headers(init?.headers).has("x-upsert"), false);
      if (++puts === 1) throw new TypeError("Lost response");
      return json({ error: "Duplicate", statusCode: "409" }, 400);
    }
    return json(result);
  });
  assert.deepEqual(await uploadOriginal("A", new File(["x"], "x.png", { type: "image/png" })), result);
  assert.equal(puts, 2);
});

test("concurrent calls share an intent, while different metadata and destinations remain separate", async t => {
  const file = new File(["x"], "x.png", { type: "image/png" });
  const prepareCalls: string[] = [];
  let puts = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/complete")) return json(result);
    if (url === storageUrl) { puts++; return new Response(null); }
    prepareCalls.push(url); return json(prepared);
  });
  await Promise.all([uploadOriginal("A", file), uploadOriginal("A", file)]);
  assert.equal(prepareCalls.length, 1); assert.equal(puts, 1);
  await uploadOriginal("B", file);
  await uploadAsset("/api/sessions/invite", "edited", file);
  await uploadAsset("/api/sessions/another", "edited", file);
  assert.equal(prepareCalls.length, 4); assert.equal(puts, 4);
});

test("expired intents are replaced on an explicit retry", async t => {
  const file = new File(["x"], "x.png", { type: "image/png" });
  let prepares = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === "/api/uploads") return json({ ...prepared, uploadId: `upload-${++prepares}` });
    if (url === storageUrl) return new Response(null);
    if (url.includes("upload-1")) return json({ error: "Expired" }, 410);
    assert.equal(url, "/api/uploads/upload-2/complete"); return json(result);
  });
  await assert.rejects(uploadOriginal("A", file), error => error instanceof RequestError && error.status === 410);
  assert.deepEqual(await uploadOriginal("A", file), result);
  assert.equal(prepares, 2);
});

test("job polling retries temporary status failures without enqueuing a second composition", async t => {
  fastRetries(t);
  let enqueues = 0, polls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/compose")) { enqueues++; return json({ job: { id: "job-1", status: "queued" } }, 202); }
    if (url.endsWith("/jobs/job-1")) return ++polls === 1 ? json({ error: "Busy" }, 503) : json({ job: { id: "job-1", status: "ready" } });
    return json({ result: { version: 2, resultAssetId: "result" }, session: { version: 2 } });
  });
  const result = await composeRemote("/api/sessions/room", 2);
  assert.equal(result.result.resultAssetId, "result");
  assert.equal(enqueues, 1);
  assert.equal(polls, 2);
});

test("busy completions keep retrying while another participant's save is processed", async t => {
  fastRetries(t);
  let completions = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url === "/api/uploads") return json(prepared);
    if (url === storageUrl) return new Response(null);
    return ++completions <= 5 ? json({ error: "다른 사진을 처리하고 있어요." }, 429) : json(result);
  });
  assert.deepEqual(await uploadOriginal("A", new File(["x"], "x.png", { type: "image/png" })), result);
  assert.equal(completions, 6);
});

test("busy retries are bounded and server errors keep the short retry policy", async t => {
  fastRetries(t);
  for (const [status, attempts] of [[429, 7], [500, 3]] as const) {
    let completions = 0;
    t.mock.method(globalThis, "fetch", async (url: string) => {
      if (url === "/api/uploads") return json(prepared);
      if (url === storageUrl) return new Response(null);
      completions++; return json({ error: "Busy" }, status);
    });
    await assert.rejects(uploadOriginal("A", new File([`x${status}`], "x.png", { type: "image/png" })), error => error instanceof RequestError && error.status === status);
    assert.equal(completions, attempts);
  }
});
