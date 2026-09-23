import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { detectRegions } from "./detect-regions";
import { SessionError } from "@/features/photo-session/errors";

test("failed local detection reports a recoverable error and removes its temporary files", async () => {
  const before = new Set(await readdir(tmpdir()));
  await assert.rejects(detectRegions(Buffer.from("not an image"), { width: 10, height: 10 }), (e: unknown) => e instanceof SessionError && e.status === 503);
  const leftover = (await readdir(tmpdir())).filter(name => name.startsWith("picsinc-regions-") && !before.has(name));
  assert.deepEqual(leftover, []);
});
