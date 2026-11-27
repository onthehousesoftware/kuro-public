import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

function readJsonc(name) {
  const text = readFileSync(new URL(name, root), "utf8");
  // Strip // comments that aren't inside strings (good enough for our config).
  const stripped = text.replace(/^\s*\/\/.*$/gm, "").replace(/([^:"])\/\/.*$/gm, "$1");
  return JSON.parse(stripped);
}

test("wrangler.jsonc is the public worker, never the private `kuro` worker", () => {
  const cfg = readJsonc("wrangler.jsonc");
  assert.equal(cfg.name, "kuro-public");
  assert.notEqual(cfg.name, "kuro");
});

test("wrangler.jsonc has no AI binding and no observability", () => {
  const cfg = readJsonc("wrangler.jsonc");
  assert.equal("ai" in cfg, false);
  assert.equal(cfg.observability?.enabled, false);
});

test("only /api/* runs the worker first", () => {
  const cfg = readJsonc("wrangler.jsonc");
  assert.deepEqual(cfg.assets.run_worker_first, ["/api/*"]);
});

test("package.json is renamed and has the test script", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(pkg.name, "kuro-public");
  assert.equal(pkg.scripts.test, "node --test test/*.test.js");
});

test("wrangler.jsonc has the RL rate limit: 20 per 60 s", () => {
  const cfg = readJsonc("wrangler.jsonc");
  const rl = (cfg.ratelimits || []).find((r) => r.name === "RL");
  assert.ok(rl, "RL binding");
  assert.match(String(rl.namespace_id), /^[1-9]\d*$/);
  assert.deepEqual(rl.simple, { limit: 20, period: 60 });
});

test("wrangler.jsonc is pinned to the OTHS Cloudflare account", () => {
  const cfg = readJsonc("wrangler.jsonc");
  assert.equal(cfg.account_id, "b3625fb215364490808bad85f9d0afa8");
});
