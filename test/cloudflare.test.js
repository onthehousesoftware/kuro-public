import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAccount, normalizeToken, nextResetUtc, cfFigure, cfCheck } from "../src/cloudflare.js";
import worker from "../src/worker.js";

const ACCT = "0123456789abcdef0123456789abcdef";
const TOKEN = "abcDEF123_-xyz7890abcd";
const FLUX = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
const SEARCH = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/models/search?per_page=1`;

// Stub fetch: records every call, answers with a canned status and JSON body.
function stub(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}
const cfErr = (message) => ({ success: false, errors: [{ code: 1, message }], result: null });
const read = async (res) => ({ status: res.status, body: await res.json() });

test("normalizeAccount accepts pasted junk and rejects path tricks", () => {
  assert.equal(normalizeAccount(" 0123-4567 89AB cdef-0123 4567 89ab CDEF\n"), ACCT);
  assert.equal(normalizeAccount(ACCT.toUpperCase()), ACCT);
  assert.equal(normalizeAccount("../../zones"), null);
  assert.equal(normalizeAccount("x/../../zones"), null);
  assert.equal(normalizeAccount(ACCT + "/../zones"), null);
  assert.equal(normalizeAccount(ACCT.slice(1)), null);
  assert.equal(normalizeAccount(undefined), null);
  assert.equal(normalizeAccount(12345), null);
});

test("normalizeToken trims and strips a Bearer prefix", () => {
  assert.equal(normalizeToken("Bearer abcDEF123_-xyz7890abcd\n"), TOKEN);
  assert.equal(normalizeToken("  bearer   " + TOKEN + "  "), TOKEN);
  assert.equal(normalizeToken(TOKEN), TOKEN);
  assert.equal(normalizeToken("short"), null);
  assert.equal(normalizeToken(TOKEN + "\r\nx-evil: 1"), null);
  assert.equal(normalizeToken(null), null);
});

test("nextResetUtc is the next 00:00 UTC", () => {
  assert.equal(nextResetUtc(new Date("2026-11-26T22:00:00Z")), "2026-11-27T00:00:00.000Z");
  assert.equal(nextResetUtc(new Date("2026-11-27T00:00:00Z")), "2026-11-28T00:00:00.000Z");
  assert.equal(nextResetUtc(new Date("2026-12-31T23:59:59Z")), "2027-01-01T00:00:00.000Z");
});

test("bad account or token: 400 cf_setup and Cloudflare is never called", async () => {
  const f = stub(200, {});
  let r = await read(await cfFigure({}, { account: "../../zones", token: TOKEN }, f));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "cf_setup");
  assert.equal(r.body.message, "That doesn't look like a Cloudflare account ID.");
  r = await read(await cfFigure({}, { account: ACCT, token: "nope" }, f));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "cf_setup");
  assert.equal(r.body.message, "That doesn't look like a Cloudflare API token.");
  r = await read(await cfCheck({ account: "", token: TOKEN }, f));
  assert.equal(r.body.error, "cf_setup");
  assert.equal(f.calls.length, 0);
});

test("blocked pose: 400 blocked and Cloudflare is never called", async () => {
  const f = stub(200, {});
  const r = await read(await cfFigure({ pose: "holding a knife" }, { account: ACCT, token: TOKEN }, f));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "blocked");
  assert.equal(f.calls.length, 0);
});

test("success: exact FLUX URL, Bearer auth, image passed back", async () => {
  const f = stub(200, { success: true, errors: [], result: { image: "IMGDATA" } });
  const res = await cfFigure({ pose: "jumping", detail: "gesture" }, { account: " " + ACCT.toUpperCase(), token: "Bearer " + TOKEN }, f);
  const r = await read(res);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, FLUX);
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.headers.authorization, "Bearer " + TOKEN);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.steps, 4);
  assert.match(sent.prompt, /jumping/);
  assert.match(sent.prompt, /fully clothed/);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { image: "IMGDATA", provider: "cloudflare" });
});

test("upstream errors map to plain codes, and the token never comes back", async () => {
  const creds = { account: ACCT, token: TOKEN };
  const now = new Date("2026-11-26T22:00:00Z");
  const cases = [
    [stub(403, cfErr("Authentication error")), "cf_token"],
    [stub(401, cfErr("Unauthorized")), "cf_token"],
    [stub(429, cfErr("Too many requests")), "limit"],
    [stub(400, cfErr("You have used up your daily free allocation of 10,000 neurons")), "limit"],
    [stub(404, cfErr("Not found")), "cf_account"],
    [stub(400, cfErr("Could not route to /accounts/x, perhaps your object identifier is invalid? account")), "cf_account"],
    [stub(500, cfErr("Internal error")), "cf"],
  ];
  for (const [f, code] of cases) {
    const res = await cfFigure({}, creds, f, now);
    const text = await res.clone().text();
    const r = await read(res);
    assert.equal(r.body.error, code, `expected ${code}`);
    assert.ok(!text.includes(TOKEN), "token leaked");
    assert.ok(r.status >= 400);
  }
  const lim = await read(await cfFigure({}, creds, stub(429, cfErr("x")), now));
  assert.equal(lim.status, 429);
  assert.equal(lim.body.resetAt, "2026-11-27T00:00:00.000Z");
  assert.equal(lim.body.message, "Your Cloudflare account has used today's free drawings.");
  const tok = await read(await cfFigure({}, creds, stub(403, cfErr("x")), now));
  assert.equal(tok.body.message, "Cloudflare didn't accept that token, or it doesn't have Workers AI permission for this account.");
  const acc = await read(await cfFigure({}, creds, stub(404, cfErr("x")), now));
  assert.equal(acc.body.message, "Cloudflare couldn't find that account ID.");
});

test("network failure or an unreadable reply: 502 cf", async () => {
  const boom = async () => { throw new TypeError("fetch failed"); };
  let r = await read(await cfFigure({}, { account: ACCT, token: TOKEN }, boom));
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: "cf", message: "Couldn't reach Cloudflare. Try again." });
  const html = async () => new Response("<html>oops</html>", { status: 200 });
  r = await read(await cfFigure({}, { account: ACCT, token: TOKEN }, html));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "cf");
});

test("cfCheck: models search with the token; ok or cf_token", async () => {
  const f = stub(200, { success: true, result: [] });
  const r = await read(await cfCheck({ account: ACCT, token: TOKEN }, f));
  assert.deepEqual(r.body, { ok: true });
  assert.equal(f.calls[0].url, SEARCH);
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.headers.authorization, "Bearer " + TOKEN);
  const bad = await read(await cfCheck({ account: ACCT, token: TOKEN }, stub(403, cfErr("Authentication error"))));
  assert.equal(bad.body.error, "cf_token");
});

test("router: /api/figure and /api/cf-check need the headers", async () => {
  const env = { ASSETS: { fetch: () => new Response("asset") } };
  for (const p of ["/api/figure", "/api/cf-check"]) {
    const res = await worker.fetch(new Request("https://kuro.test" + p, { method: "POST", body: "{}" }), env);
    const r = await read(res);
    assert.equal(r.status, 400, p);
    assert.equal(r.body.error, "cf_setup", p);
  }
  // Bad JSON body with good-looking headers still fails safely before any fetch (blocked check runs on {}).
  const res = await worker.fetch(new Request("https://kuro.test/api/figure", {
    method: "POST", body: "not json", headers: { "x-cf-account": "../../zones", "x-cf-token": TOKEN },
  }), env);
  assert.equal((await read(res)).body.error, "cf_setup");
});

test("Cloudflare's 400 'Authentication failed' (malformed token) is a token problem, not a generic error", async () => {
  // Seen live 2026-11-26: a short fake token gets HTTP 400, code 9106.
  const authFail = () => stub(400, { success: false, errors: [{ code: 9106, message: "Authentication failed (status: 400)" }], result: null });
  const creds = { account: ACCT, token: TOKEN };
  assert.equal((await read(await cfCheck(creds, authFail()))).body.error, "cf_token");
  assert.equal((await read(await cfFigure({}, creds, authFail()))).body.error, "cf_token");
});
