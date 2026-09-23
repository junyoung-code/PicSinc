import assert from "node:assert/strict";
import test from "node:test";
import { editedPhotoDisplay } from "./edited-photo-display";

const participants = [{ id: "b", nickname: "민수" }, { id: "a", nickname: "진준영" }, { id: "c", nickname: "대기" }];
const assets = [
  { id: "a-photo", participantId: "b", kind: "edited", uploadOrder: 2 },
  { id: "mask", participantId: "a", kind: "mask", uploadOrder: null },
  { id: "z-photo", participantId: "a", kind: "edited", uploadOrder: 1 },
  { id: "b-photo", participantId: "a", kind: "edited", uploadOrder: 3 },
];

test("group photos by first successful upload; label extra photos within each participant", () => {
  const result = editedPhotoDisplay(assets, participants);
  assert.deepEqual(result.edits.map(a => a.id), ["z-photo", "b-photo", "a-photo"]);
  assert.deepEqual(result.participants.map(p => p.id), ["a", "b", "c"]);
  assert.deepEqual(result.labels, { "z-photo": "진준영", "b-photo": "진준영 2", "a-photo": "민수" });
  assert.equal(assets[0].id, "a-photo", "do not mutate the snapshot");
});

test("refresh, additional uploads and submission flags cannot renumber existing photos", () => {
  const before = editedPhotoDisplay(assets, participants);
  const after = editedPhotoDisplay([{ id: "0-photo", participantId: "b", kind: "edited", uploadOrder: 4 }, ...assets.toReversed()], participants.toReversed().map(p => ({ ...p, submitted: false })));
  for (const asset of before.edits) assert.equal(after.labels[asset.id], before.labels[asset.id]);
  assert.deepEqual(after.edits.map(a => a.id), ["z-photo", "b-photo", "a-photo", "0-photo"]);
  assert.equal(after.labels["0-photo"], "민수 2");
});

test("duplicate nicknames stay separate; participants without uploads sort last deterministically", () => {
  const result = editedPhotoDisplay(assets, participants.map(p => ({ ...p, nickname: "같은 이름" })));
  assert.equal(result.labels["z-photo"], "같은 이름");
  assert.equal(result.labels["a-photo"], "같은 이름");
  assert.equal(result.labels["b-photo"], "같은 이름 2");
  assert.deepEqual(editedPhotoDisplay([], participants.toReversed()).participants.map(p => p.id), ["a", "b", "c"]);
});
