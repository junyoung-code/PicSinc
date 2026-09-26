/** Local quality fixture runner. Input/output files stay in ignored private storage. */
import { readFile, writeFile } from "node:fs/promises";
import type { CompositionInput } from "@/core/contracts";
import { composePhoto } from "@/features/composition/compose";

const [originalPath, editedPath, maskPath, resultPath, previewPath] = process.argv.slice(2);
if (![originalPath, editedPath, maskPath, resultPath, previewPath].every(Boolean)) {
  throw new Error("Usage: quality-compose.ts <original> <edited> <mask> <result.png> <preview.png>");
}
const files: Record<string, Buffer> = {
  original: await readFile(originalPath), edited: await readFile(editedPath), mask: await readFile(maskPath),
};
const input: CompositionInput = {
  sessionId: "quality-local", version: 1, originalAssetId: "original",
  selections: [{ participantId: "quality-person", editedAssetId: "edited", maskAssetId: "mask" }],
  overlapAssignments: [],
};
const result = await composePhoto(input, async id => {
  if (!Object.hasOwn(files, id)) throw new Error("Invalid fixture");
  return files[id];
});
await writeFile(resultPath, result.png, { flag: "wx" });
await writeFile(previewPath, result.previewPng, { flag: "wx" });
console.log(`result=${result.width}x${result.height} preview=${result.previewWidth}x${result.previewHeight}`);
