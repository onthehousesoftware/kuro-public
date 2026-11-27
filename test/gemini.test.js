import { test } from "node:test";
import assert from "node:assert/strict";
import { GEMINI_MODELS, PRICES, IMAGE_TOKENS_1K, usageCost, findImage, geminiFigure, geminiCheck } from "../public/gemini.js";

const KEY = "AIzaTESTKEY0123456789abcdefghijklmnopq";
const IMG = "A".repeat(1200);

function stub(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}
const gErr = (message) => ({ error: { code: 0, message } });
const ok = (extra = {}) => ({ output_image: { data: IMG, mime_type: "image/jpeg" }, ...extra });

test("constants are copied from the private app", () => {
  assert.deepEqual(GEMINI_MODELS, { best: "gemini-nano-banana-2.1", lite: "gemini-3.1-flash-lite-image" });
  assert.equal(PRICES["gemini-nano-banana-2.1"].fallback, 0.045);
  assert.equal(PRICES["gemini-3.1-flash-lite-image"].fallback, 0.036);
  assert.equal(IMAGE_TOKENS_1K, 1120);
});

test("usageCost: no usage → fallback estimate; usage → computed", () => {
  assert.deepEqual(usageCost({}, GEMINI_MODELS.best), { cost: 0.045, source: "estimate" });
  assert.deepEqual(usageCost({}, "nope"), { cost: 0, source: "unknown" });
  const u = usageCost({ usage: { input_tokens: 1000, output_tokens: 1120 } }, GEMINI_MODELS.best);
  assert.equal(u.source, "usage");
  assert.equal(u.cost, Math.round(((1000 * 1.5 + 1120 * 30) / 1e6) * 10000) / 10000);
});

test("findImage finds nested image data and ignores short strings", () => {
  assert.deepEqual(findImage({ a: [{ data: "short" }, { b: { data: IMG, mimeType: "image/png" } }] }), { data: IMG, mime: "image/png" });
  assert.equal(findImage({ data: IMG, mime_type: "text/plain" }), null);
  assert.equal(findImage(null), null);
});

test("blocked pose throws blocked and Google is never called", async () => {
  const f = stub(200, ok());
  await assert.rejects(geminiFigure(KEY, { pose: "holding a knife" }, [], f), { code: "blocked" });
  assert.equal(f.calls.length, 0);
});

test("empty key throws gemini_key and Google is never called", async () => {
  const f = stub(200, ok());
  await assert.rejects(geminiFigure("   ", {}, [], f), { code: "gemini_key" });
  await assert.rejects(geminiCheck("", f), { code: "gemini_key" });
  assert.equal(f.calls.length, 0);
});

test("error replies map to the private app's codes", async () => {
  const cases = [
    [402, gErr("Payment required"), "gemini_credits"],
    [429, gErr("Your prepayment credits are depleted."), "gemini_credits"],
    [403, gErr("Permission denied"), "gemini_key"],
    [400, gErr("API key not valid. Please pass a valid API key."), "gemini_key"],
    [429, gErr("Resource exhausted"), "gemini_quota"],
    [400, gErr("Request blocked for safety reasons"), "blocked"],
    [500, gErr("Internal"), "gemini"],
  ];
  for (const [status, body, code] of cases) {
    await assert.rejects(geminiFigure(KEY, {}, [], stub(status, body)), (e) => {
      assert.equal(e.code, code, `${status} ${body.error.message}`);
      assert.equal(typeof e.message, "string");
      assert.ok(!String(e.message).includes(KEY));
      return true;
    });
  }
});

test("network failure and no picture throw gemini", async () => {
  const boom = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(geminiFigure(KEY, {}, [], boom), { code: "gemini", message: "Couldn't reach Gemini. Try again." });
  await assert.rejects(geminiFigure(KEY, {}, [], stub(200, { output_image: { data: "tiny" } })), { code: "gemini" });
});

test("success: key in header, image and cost returned", async () => {
  const f = stub(200, ok());
  const out = await geminiFigure(" " + KEY + "\n", { pose: "jumping", detail: "full" }, [], f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(f.calls[0].init.headers["x-goog-api-key"], KEY);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.model, GEMINI_MODELS.best);
  assert.match(sent.input[0].text, /jumping/);
  assert.doesNotMatch(sent.input[0].text, /artist's own drawings/);
  assert.deepEqual(out, { image: IMG, mime: "image/jpeg", cost: 0.045, costSource: "estimate" });
});

test("refs: up to 3 for best, 1 for lite, junk dropped", async () => {
  const refs = ["r1", "r2", "r3", "r4", 42, "x".repeat(1_500_001)];
  let f = stub(200, ok());
  await geminiFigure(KEY, {}, refs, f);
  let sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.input.filter((p) => p.type === "image").length, 3);
  assert.match(sent.input[0].text, /the artist's own drawings/);
  f = stub(200, ok());
  await geminiFigure(KEY, { model: "lite" }, refs.slice(0, 3), f);
  sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.model, GEMINI_MODELS.lite);
  assert.equal(sent.input.filter((p) => p.type === "image").length, 1);
});

test("geminiCheck: true on ok, gemini_key on refusal, gemini on network", async () => {
  const f = stub(200, { models: [] });
  assert.equal(await geminiCheck(KEY, f), true);
  assert.equal(f.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1");
  assert.equal(f.calls[0].init.headers["x-goog-api-key"], KEY);
  await assert.rejects(geminiCheck(KEY, stub(400, gErr("API key not valid"))), { code: "gemini_key", message: "Google didn't accept that key." });
  await assert.rejects(geminiCheck(KEY, async () => { throw new TypeError("x"); }), { code: "gemini" });
});
