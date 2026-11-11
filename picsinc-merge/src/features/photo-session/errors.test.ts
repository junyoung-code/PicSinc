import assert from "node:assert/strict";
import test from "node:test";
import { isSessionError, RegionClaimConflict, SessionError } from "./errors";

test("session errors are recognised even when thrown by another bundled copy of the class", () => {
  assert.ok(isSessionError(new SessionError(429, "busy")));
  class ForeignSessionError extends Error {
    constructor(public readonly status: number, message: string) { super(message); this.name = "SessionError"; }
  }
  const foreign = new ForeignSessionError(429, "busy");
  assert.equal(foreign instanceof SessionError, false);
  assert.ok(isSessionError(foreign));
  assert.equal(isSessionError(new Error("plain")), false);
  assert.equal(isSessionError(Object.assign(new Error("no status"), { name: "SessionError" })), false);
  const conflict = new RegionClaimConflict({ nickname: "A" } as ConstructorParameters<typeof RegionClaimConflict>[0]);
  assert.ok(isSessionError(conflict));
  assert.equal(conflict.name, "RegionClaimConflict");
});
