import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const env = { ASSETS: { fetch: () => new Response("asset") } };
const call = (path, method = "POST", init = {}) =>
  worker.fetch(new Request("https://kuro.test" + path, { method, ...init }), env);

test("removed routes are gone", async () => {
  for (const p of ["/api/check", "/api/style", "/api/gemini-check"]) {
    assert.equal((await call(p)).status, 404, p);
  }
});

test("API routes only take POST", async () => {
  assert.equal((await call("/api/figure", "GET")).status, 405);
});

test("everything else is served from assets", async () => {
  assert.equal(await (await call("/", "GET")).text(), "asset");
});

const rlEnv = (success, seen = []) => ({
  ...env,
  RL: { limit: async (opts) => { seen.push(opts); return { success }; } },
});

test("rate limit: over the limit → 429 busy, before any upstream call", async () => {
  const res = await worker.fetch(
    new Request("https://kuro.test/api/figure", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }),
    rlEnv(false),
  );
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.error, "busy");
  assert.equal(body.message, "Lots of figures at once. Wait a minute and try again.");
});

test("rate limit: keyed by the caller's IP, applies to cf-check too", async () => {
  const seen = [];
  const res = await worker.fetch(
    new Request("https://kuro.test/api/cf-check", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }),
    rlEnv(false, seen),
  );
  assert.equal(res.status, 429);
  assert.deepEqual(seen, [{ key: "203.0.113.9" }]);
});

test("rate limit: no IP header → shared 'anon' key", async () => {
  const seen = [];
  await worker.fetch(new Request("https://kuro.test/api/figure", { method: "POST" }), rlEnv(false, seen));
  assert.deepEqual(seen, [{ key: "anon" }]);
});

test("rate limit: under the limit → normal handling (cf_setup with no creds)", async () => {
  const res = await worker.fetch(new Request("https://kuro.test/api/figure", { method: "POST" }), rlEnv(true));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "cf_setup");
});

test("rate limit: no RL binding → normal handling", async () => {
  const res = await call("/api/figure");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "cf_setup");
});

test("rate limit: never touches pages", async () => {
  const seen = [];
  const res = await worker.fetch(new Request("https://kuro.test/", { method: "GET" }), rlEnv(false, seen));
  assert.equal(await res.text(), "asset");
  assert.equal(seen.length, 0);
});

test("rate limit: a broken limiter doesn't break the app", async () => {
  const res = await worker.fetch(
    new Request("https://kuro.test/api/figure", { method: "POST" }),
    { ...env, RL: { limit: async () => { throw new Error("down"); } } },
  );
  assert.equal((await res.json()).error, "cf_setup");
});
