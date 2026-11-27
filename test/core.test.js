import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseProvider, resetLabel, limitMessage } from "../public/core.js";

test("chooseProvider: Gemini first, then Cloudflare, then none", () => {
  const rows = [
    [{ hasGemini: true, hasCf: false, creditOut: false }, "gemini"],
    [{ hasGemini: false, hasCf: true, creditOut: false }, "cloudflare"],
    [{ hasGemini: true, hasCf: true, creditOut: false }, "gemini"],
    [{ hasGemini: true, hasCf: true, creditOut: true }, "cloudflare"],
    // Credit is out and nothing to fall back to: stay on Gemini so the UI says "credits used up".
    [{ hasGemini: true, hasCf: false, creditOut: true }, "gemini"],
    [{ hasGemini: false, hasCf: false, creditOut: false }, "none"],
    [{ hasGemini: false, hasCf: false, creditOut: true }, "none"],
  ];
  for (const [input, want] of rows) assert.equal(chooseProvider(input), want, JSON.stringify(input));
});

test("resetLabel shows the reset in the device's local time", () => {
  const old = process.env.TZ;
  try {
    process.env.TZ = "America/Chicago";
    assert.equal(resetLabel("2026-11-27T00:00:00.000Z", "en-US"), "6:00 PM");
    process.env.TZ = "Asia/Tokyo";
    assert.equal(resetLabel("2026-11-27T00:00:00.000Z", "en-US"), "9:00 AM");
  } finally {
    if (old === undefined) delete process.env.TZ; else process.env.TZ = old;
  }
});

test("limitMessage names their allowance and the local reset, never 'Central'", () => {
  const iso = "2026-11-27T00:00:00.000Z";
  const msg = limitMessage(iso);
  assert.ok(msg.startsWith("Your Cloudflare account has used today's free drawings."), msg);
  assert.ok(msg.includes(resetLabel(iso)), msg);
  assert.doesNotMatch(msg, /Central/);
});

test("limitMessage without a usable reset time still reads well", () => {
  for (const bad of [undefined, "", "not a date"]) {
    const msg = limitMessage(bad);
    assert.equal(msg, "Your Cloudflare account has used today's free drawings. They come back tomorrow.");
  }
});

// ---------- Task 7: export / import ----------
import { SECRET_KEYS, buildExport, parseImport, exportName } from "../public/core.js";

const B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const sample = () => [
  { id: "d-1", createdAt: 1000, kind: "mine", title: "Gesture", starred: true, type: "image/jpeg", b64: B64 },
  { id: "d-2", createdAt: 2000, kind: "kuro", title: "Running · side", starred: false, type: "image/png", b64: B64 },
];
const kv = { geminiKey: "AIza-secret", geminiModel: "lite", credit: { start: 10 }, cfAccount: "a".repeat(32), cfToken: "tok-secret-1234567890" };

test("SECRET_KEYS lists every key and token", () => {
  assert.deepEqual(SECRET_KEYS, ["geminiKey", "cfAccount", "cfToken"]);
});

test("buildExport leaves out keys and tokens, keeps the model choice", () => {
  const out = buildExport(sample(), kv, Date.UTC(2026, 10, 26));
  assert.equal(out.app, "kuro-public");
  assert.equal(out.version, 1);
  assert.equal(out.exportedAt, "2026-11-26T00:00:00.000Z");
  for (const k of SECRET_KEYS) assert.ok(!(k in out.settings), k);
  assert.equal(out.settings.geminiModel, "lite");
  assert.doesNotMatch(JSON.stringify(out), /secret/);
  assert.equal(kv.geminiKey, "AIza-secret", "the kv object passed in is not changed");
});

test("round trip returns the same items", () => {
  const file = JSON.parse(JSON.stringify(buildExport(sample(), kv)));
  const r = parseImport(file, new Set());
  assert.deepEqual(r.items, sample());
  assert.equal(r.skipped, 0);
});

test("re-importing the same backup skips and counts every drawing", () => {
  const file = buildExport(sample(), kv);
  const r = parseImport(file, new Set(["d-1", "d-2"]));
  assert.equal(r.items.length, 0);
  assert.equal(r.skipped, 2);
});

test("a drawing listed twice in one file comes in once", () => {
  const items = sample(); items.push({ ...items[0] });
  const r = parseImport({ app: "kuro-public", version: 1, items, settings: {} }, new Set());
  assert.equal(r.items.length, 2);
  assert.equal(r.skipped, 1);
});

test("another app's file, a wrong version, or junk is bad_file", () => {
  const bad = [{ app: "other" }, { app: "kuro-public", version: 2, items: [] }, { app: "kuro-public", version: 1 },
    null, "text", [], { app: "kuro-public", version: 1, items: {} }];
  for (const b of bad) assert.throws(() => parseImport(b, new Set()), (e) => e.code === "bad_file" && e.message === "That file isn't a Kuro library backup.", JSON.stringify(b));
});

test("keys inside a backup never come in", () => {
  const file = buildExport(sample(), {});
  file.settings = { geminiModel: "best", cfToken: "sneaky-token-1234567890", geminiKey: "AIza", cfAccount: "b".repeat(32) };
  const r = parseImport(file, new Set());
  for (const k of SECRET_KEYS) assert.ok(!(k in r.settings), k);
  assert.equal(r.settings.geminiModel, "best");
});

test("one broken drawing rejects the whole file, so nothing is half-written", () => {
  for (const broken of [{ id: "d-9", kind: "mine" }, { id: 9, kind: "mine", b64: B64 }, { id: "d-9", kind: "other", b64: B64 },
    { id: "d-9", kind: "mine", b64: "not base64!" }, { id: "d-9", kind: "mine", b64: "" }, null]) {
    const items = [...sample(), broken];
    assert.throws(() => parseImport({ app: "kuro-public", version: 1, items, settings: {} }, new Set()), (e) => e.code === "bad_file", JSON.stringify(broken));
  }
});

test("missing or odd fields get safe defaults", () => {
  const r = parseImport({ app: "kuro-public", version: 1, items: [{ id: "d-5", kind: "mine", b64: B64, type: "text/html", title: 5, starred: "yes" }] }, new Set());
  const it = r.items[0];
  assert.equal(it.type, "image/jpeg");
  assert.equal(it.title, "");
  assert.equal(it.starred, false);
  assert.equal(typeof it.createdAt, "number");
  assert.deepEqual(r.settings, {});
});

test("exportName uses the local date", () => {
  assert.equal(exportName(new Date(2026, 10, 6, 23, 30)), "kuro-library-2026-11-06.json");
});
