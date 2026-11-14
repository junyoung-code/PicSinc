import assert from "node:assert/strict";
import test from "node:test";

import { MeituBeautyError } from "./meituBeautyAdapter.js";
import {
  createMeituGrantedBeautyAdapter,
  toGrantedYunxiuOperations,
} from "./meituGrantedBeautyAdapter.js";

test("maps controls only to the documented individually granted endpoints", () => {
  assert.deepEqual(toGrantedYunxiuOperations({
    skinSmoothing: 42.4,
    skinTone: -12,
    faceSlimming: 18,
    makeupStyle: "natural",
  }), [
    {
      service: "beauty",
      path: "/openapi/beauty_async",
      allParams: {
        face_balance_alpha: [42, 42, 42, 42, 42],
        skin_color_hue_alpha: [-12, -12, -12, -12, -12],
        face_trans: [18, 18, 18, 18, 18],
      },
    },
    {
      service: "makeup",
      path: "/openapi/makeup_async",
      allParams: {
        eyebrow_deepen: [30, 30, 30, 30, 30],
        eyeshadow_deepen: [30, 30, 30, 30, 30],
        facial_deepen: [30, 30, 30, 30, 30],
        lipstick_deepen: [30, 30, 30, 30, 30],
        highlight_alpha: [30, 30, 30, 30, 30],
        shadow_light: [30, 30, 30, 30, 30],
      },
    },
  ]);
});

test("chains granted Beauty and Makeup jobs, polls, downloads, and releases the ROI", async () => {
  const calls = [];
  let released = 0;
  let beautyQueries = 0;
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const body = init.body && JSON.parse(init.body);
    calls.push({ url: parsed, method: init.method, body });
    if (parsed.pathname === "/openapi/beauty_async") return json({ code: 0, data: { msg_id: "beauty-1" } });
    if (parsed.pathname === "/openapi/makeup_async") return json({ code: 0, data: { msg_id: "makeup-1" } });
    if (parsed.pathname === "/openapi/query" && body.msg_id === "beauty-1" && beautyQueries++ === 0) {
      return json({ code: 29901, message: "processing" });
    }
    if (parsed.pathname === "/openapi/query" && body.msg_id === "beauty-1") {
      return json({ code: 0, data: { msg_id: "beauty-1", media_data: "https://result.example/beauty.jpg" } });
    }
    if (parsed.pathname === "/openapi/query") {
      return json({ code: 0, data: { msg_id: "makeup-1", media_data: "https://result.example/makeup.jpg" } });
    }
    return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
  };
  const adapter = createMeituGrantedBeautyAdapter({
    apiKey: "key",
    apiSecret: "secret",
    publishRoi: async (input) => {
      assert.deepEqual(input, {
        roiMedia: { data: "roi-only", dataType: "jpg" },
        personId: "person-1",
        maskKey: "mask-1",
      });
      return { url: "https://private.example/roi.jpg", release: async () => { released += 1; } };
    },
    fetchImpl,
    wait: async () => {},
  });

  const media = await adapter.createPreview({
    roiMedia: { data: "roi-only", dataType: "jpg" },
    personId: "person-1",
    maskKey: "mask-1",
    params: { skinSmoothing: 25, makeupStyle: "glam" },
  });

  assert.deepEqual(media, { data: "AQID", dataType: "jpg" });
  assert.equal(released, 1);
  const submits = calls.filter((call) => call.url.pathname.endsWith("_async"));
  assert.equal(submits.length, 2);
  assert.deepEqual(submits.map((call) => call.url.pathname), ["/openapi/beauty_async", "/openapi/makeup_async"]);
  assert.deepEqual(submits.map((call) => call.url.searchParams.get("api_key")), ["key", "key"]);
  assert.deepEqual(submits.map((call) => call.url.searchParams.get("api_secret")), ["secret", "secret"]);
  assert.equal(submits[0].body.media_info_list[0].media_data, "https://private.example/roi.jpg");
  assert.equal(submits[1].body.media_info_list[0].media_data, "https://result.example/beauty.jpg");
  assert.deepEqual(calls.filter((call) => call.url.pathname === "/openapi/query").map((call) => call.body), [
    { api_key: "key", api_secret: "secret", msg_id: "beauty-1" },
    { api_key: "key", api_secret: "secret", msg_id: "beauty-1" },
    { api_key: "key", api_secret: "secret", msg_id: "makeup-1" },
  ]);
  assert.equal(calls.at(-1).url.href, "https://result.example/makeup.jpg");
});

test("rejects unsupported hair cleanup before publishing or sending credentials", async () => {
  let published = false;
  let fetched = false;
  const adapter = createMeituGrantedBeautyAdapter({
    apiKey: "key",
    apiSecret: "secret",
    publishRoi: async () => { published = true; return "https://private.example/roi.jpg"; },
    fetchImpl: async () => { fetched = true; throw new Error("must not run"); },
  });
  await assert.rejects(
    () => adapter.createPreview({ roiMedia: { data: "roi", dataType: "jpg" }, params: { hairEnhancement: 1 } }),
    (error) => error instanceof MeituBeautyError && error.code === "UNSUPPORTED_CONTROL" && error.stage === "mapping",
  );
  assert.equal(published, false);
  assert.equal(fetched, false);
});

test("maps the documented authorization error and releases a published ROI", async () => {
  let released = 0;
  const adapter = createMeituGrantedBeautyAdapter({
    apiKey: "key",
    apiSecret: "secret",
    publishRoi: async () => ({ url: "https://private.example/roi.png", release: async () => { released += 1; } }),
    fetchImpl: async () => json({ code: 90002, message: "not authorized" }),
  });
  await assert.rejects(
    () => adapter.createPreview({ roiMedia: { data: "roi", dataType: "png" }, params: { faceSlimming: 2 } }),
    (error) => error instanceof MeituBeautyError && error.code === "UNAUTHORIZED" && error.vendorCode === 90002,
  );
  assert.equal(released, 1);
});

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
