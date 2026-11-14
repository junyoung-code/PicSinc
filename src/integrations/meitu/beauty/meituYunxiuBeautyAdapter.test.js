import assert from "node:assert/strict";
import test from "node:test";

import { MeituBeautyError } from "./meituBeautyAdapter.js";
import { createMeituYunxiuBeautyAdapter, toYunxiuAllParams } from "./meituYunxiuBeautyAdapter.js";

test("maps user-selected controls to documented Yunxiu PRO raw parameters", () => {
  assert.deepEqual(toYunxiuAllParams({
    skinSmoothing: 42.4,
    skinTone: -12,
    faceSlimming: 18,
    hairEnhancement: 33,
    makeupStyle: "natural",
  }), {
    face_balance_alpha: [42],
    temperature: -12,
    face_trans: [18],
    broken_hair: [33],
    eyebrow_deepen: [30],
    eyeshadow_deepen: [30],
    facial_deepen: [30],
    lipstick_deepen: [30],
    highlight_alpha: [30],
    shadow_light: [30],
  });
  assert.deepEqual(toYunxiuAllParams({ makeupStyle: "none", skinSmoothing: 0 }), { face_balance_alpha: [0] });
});

test("publishes only ROI media, submits raw parameters, polls, downloads, and releases", async () => {
  const calls = [];
  let released = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body && JSON.parse(init.body) });
    if (String(url).endsWith("/openapi/chain.json")) return json({ code: 0, data: { chain_id: "chain-1" } });
    if (String(url).endsWith("/openapi/query.json") && calls.filter((call) => call.url.endsWith("query.json")).length === 1) {
      return json({ code: 0, data: { status: "processing" } });
    }
    if (String(url).endsWith("/openapi/query.json")) {
      return json({ code: 0, data: { status: "success", after_url: "https://result.example/patch.png" } });
    }
    return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  const adapter = createMeituYunxiuBeautyAdapter({
    apiKey: "key",
    apiSecret: "secret",
    publishRoi: async (input) => {
      assert.deepEqual(input, { roiMedia: { data: "roi-only", dataType: "jpg" }, personId: "person-1", maskKey: "mask-1" });
      return { url: "https://private.example/roi.jpg", release: async () => { released += 1; } };
    },
    fetchImpl,
    wait: async () => {},
  });

  const media = await adapter.createPreview({
    roiMedia: { data: "roi-only", dataType: "jpg" }, personId: "person-1", maskKey: "mask-1",
    params: { skinSmoothing: 25, faceSlimming: -5 },
  });

  assert.deepEqual(media, { data: "AQID", dataType: "png" });
  assert.equal(released, 1);
  assert.deepEqual(calls[0], {
    url: "https://openapi-yunxiu.meitu.com/openapi/chain.json", method: "POST",
    body: {
      api_key: "key", api_secret: "secret", media_data: "https://private.example/roi.jpg",
      parameter: { all_params: { face_balance_alpha: [25], face_trans: [-5] } },
    },
  });
  assert.deepEqual(calls.slice(1, 3).map((call) => call.body), [{ chain_id: "chain-1" }, { chain_id: "chain-1" }]);
});

test("uses the documented backup result URL and maps a Yunxiu job timeout", async () => {
  const downloads = [];
  const backupAdapter = createMeituYunxiuBeautyAdapter({
    apiKey: "key", apiSecret: "secret", publishRoi: async () => "https://private.example/roi.jpg", wait: async () => {},
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("chain.json")) return json({ code: 0, data: { chain_id: "chain-2" } });
      if (value.endsWith("query.json")) return json({ code: 0, data: { status: "success", after_url: "https://result.example/primary.jpg", after_url_backup: "https://result.example/backup.jpg" } });
      downloads.push(value);
      if (value.includes("primary")) return new Response("bad", { status: 503 });
      return new Response(Uint8Array.from([4]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    },
  });
  assert.deepEqual(await backupAdapter.createPreview({ roiMedia: { data: "roi", dataType: "png" }, params: { hairEnhancement: 2 } }), { data: "BA==", dataType: "jpg" });
  assert.deepEqual(downloads, ["https://result.example/primary.jpg", "https://result.example/backup.jpg"]);

  const failedAdapter = createMeituYunxiuBeautyAdapter({
    apiKey: "key", apiSecret: "secret", publishRoi: async () => "https://private.example/roi.jpg", wait: async () => {},
    fetchImpl: async (url) => String(url).endsWith("chain.json")
      ? json({ code: 0, data: { chain_id: "chain-3" } })
      : json({ code: 0, data: { status: "error", error_code: 29902, error_msg: "timeout" } }),
  });
  await assert.rejects(
    () => failedAdapter.createPreview({ roiMedia: { data: "roi", dataType: "jpg" }, params: { skinSmoothing: 1 } }),
    (error) => error instanceof MeituBeautyError && error.code === "TIMEOUT" && error.vendorCode === 29902 && error.retryable,
  );
});

test("rejects non-public ROI URLs before sending credentials", async () => {
  let called = false;
  const adapter = createMeituYunxiuBeautyAdapter({
    apiKey: "key", apiSecret: "secret", publishRoi: async () => "http://127.0.0.1/roi.jpg",
    fetchImpl: async () => { called = true; throw new Error("must not run"); },
  });
  await assert.rejects(
    () => adapter.createPreview({ roiMedia: { data: "roi", dataType: "jpg" }, params: { faceSlimming: 1 } }),
    (error) => error.code === "INVALID_MEDIA_URL" && error.stage === "publish",
  );
  assert.equal(called, false);
});

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
