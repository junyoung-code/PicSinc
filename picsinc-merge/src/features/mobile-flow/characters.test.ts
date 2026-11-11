import test from "node:test";
import assert from "node:assert/strict";
import { characterFor, mergeCharacters, roomCharacters } from "./characters";

test("each person gets a different character, host first, in Figma order", () => {
  const ids = ["guest-a", "host", "guest-b"];
  const room = ids.map(id => characterFor(roomCharacters, ids, "host", id));
  assert.deepEqual(room, ["/images/figma-current/home/mint.png", "/images/figma-current/home/lilac.png", "/images/figma-current/home/peach.png"]);
  assert.equal(new Set(room).size, 3);
  assert.equal(characterFor(mergeCharacters, ["host", "guest"], "host", "guest"), "/images/figma-current/home/pink.png");
});

test("five people all differ, and a missing host falls back to join order", () => {
  const ids = ["h", "a", "b", "c", "d"];
  assert.equal(new Set(ids.map(id => characterFor(roomCharacters, ids, "h", id))).size, 5);
  assert.equal(characterFor(roomCharacters, ["x", "y"], undefined, "y"), "/images/figma-current/home/mint.png");
});
