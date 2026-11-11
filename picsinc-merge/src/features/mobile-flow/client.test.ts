import test from "node:test";
import assert from "node:assert/strict";
import { NetworkError, networkErrorMessage, request } from "./client";

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
