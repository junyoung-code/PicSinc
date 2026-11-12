import test from "node:test";
import assert from "node:assert/strict";
import { sentenceLines } from "./sentence-lines";

test("status messages break between sentences, not inside them", () => {
  assert.equal(sentenceLines("처리 순서를 기다리고 있어요. 잠시 후 다시 확인해도 됩니다."), "처리 순서를 기다리고 있어요.\n잠시 후 다시 확인해도 됩니다.");
  assert.equal(sentenceLines("사진을 합치고 있어요."), "사진을 합치고 있어요.");
  assert.equal(sentenceLines("처리가 길어지고 있어요. 나중에 이 방을 다시 열어 결과를 확인해 주세요."), "처리가 길어지고 있어요.\n나중에 이 방을 다시 열어 결과를 확인해 주세요.");
  assert.equal(sentenceLines("버전 1.5 사진"), "버전 1.5 사진");
  assert.equal(sentenceLines(""), "");
});
