import test from "node:test";
import assert from "node:assert/strict";
import { NetworkError, networkErrorMessage, readTimeoutMs, request, timeoutErrorMessage } from "./client";

test("offline fetch shows a Korean message but stays a TypeError for retry checks", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  try {
    await assert.rejects(request("/api/anything"), (error: unknown) => {
      assert.ok(error instanceof NetworkError);
      assert.ok(error instanceof TypeError);
      assert.equal((error as Error).message, networkErrorMessage);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test("non-network fetch failures pass through unchanged", async () => {
  const original = globalThis.fetch;
  const abort = new DOMException("aborted", "AbortError");
  globalThis.fetch = async () => { throw abort; };
  try { await assert.rejects(request("/api/anything"), (error: unknown) => error === abort); }
  finally { globalThis.fetch = original; }
});

test("a read that never answers stops after the time limit with a Korean message", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = globalThis.fetch;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  try {
    const pending = assert.rejects(request("/api/anything"), (error: unknown) => {
      assert.ok(error instanceof NetworkError);
      assert.equal((error as Error).message, timeoutErrorMessage);
      return true;
    });
    t.mock.timers.tick(readTimeoutMs);
    await pending;
  } finally { globalThis.fetch = original; }
});

test("writes have no time limit", async () => {
  const original = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => { signal = init?.signal; return new Response("{}"); };
  try { await request("/api/anything", { method: "POST" }); assert.equal(signal, undefined); }
  finally { globalThis.fetch = original; }
});
