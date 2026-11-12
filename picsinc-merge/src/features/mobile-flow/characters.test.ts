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

test("every character image is see-through around the body (N-30)", async () => {
  const sharp = (await import("sharp")).default;
  for (const name of new Set([...roomCharacters, ...mergeCharacters])) {
    const { data, info } = await sharp(`public/images/figma-current/home/${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) assert.equal(alpha(x, y), 0, `${name} corner ${x},${y}`);
    assert.equal(alpha(Math.floor(info.width / 2), Math.floor(info.height * 0.6)), 255, `${name} body`);
    // The broken crops had a white box that was only see-through at the very edge.
    let whiteBox = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 250 && data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) whiteBox++;
    assert.equal(whiteBox, 0, `${name} has opaque white pixels`);
  }
});

test("five people all differ, and a missing host falls back to join order", () => {
  const ids = ["h", "a", "b", "c", "d"];
  assert.equal(new Set(ids.map(id => characterFor(roomCharacters, ids, "h", id))).size, 5);
  assert.equal(characterFor(roomCharacters, ["x", "y"], undefined, "y"), "/images/figma-current/home/mint.png");
});
