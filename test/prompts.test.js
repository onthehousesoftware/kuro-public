import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCK, SAFE_TEXT, DETAIL, cleanText, checkInputs, fluxPrompt, fluxSteps, geminiText } from "../public/prompts.js";

test("blocked words are rejected with the friendly message", () => {
  const r = checkInputs({ pose: "holding a knife" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "blocked");
  assert.equal(r.message, "Kuro can't draw that one. Try a different pose.");
  assert.ok(BLOCK.test("naked"));
});

test("defaults when nothing is sent", () => {
  const r = checkInputs({});
  assert.equal(r.ok, true);
  assert.equal(r.pose, "an interesting, dynamic everyday pose");
  assert.equal(r.angle, "three-quarter");
  assert.equal(r.detailKey, "clean");
  assert.equal(r.detail, DETAIL.clean);
});

test("unknown or prototype detail keys fall back to clean", () => {
  assert.equal(checkInputs({ detail: "__proto__" }).detailKey, "clean");
  assert.equal(checkInputs({ detail: "toString" }).detail, DETAIL.clean);
  assert.equal(checkInputs({ detail: "gesture" }).detailKey, "gesture");
});

test("cleanText strips control characters and caps length", () => {
  assert.equal(cleanText(" a\nb\u0000c ", 10), "a b c");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText(undefined, 5), "");
});

test("FLUX prompt is locked down and has no style lead-in", () => {
  const p = fluxPrompt(checkInputs({ pose: "jumping", angle: "side" }));
  assert.match(p, /^Light, loose graphite pencil sketch in a sketchbook\. /);
  assert.match(p, /fully clothed/);
  assert.match(p, /jumping/);
  assert.match(p, /a young artist/);
  assert.doesNotMatch(p, /style:/);
});

test("steps: 4 for gesture, 8 otherwise", () => {
  assert.equal(fluxSteps("gesture"), 4);
  assert.equal(fluxSteps("clean"), 8);
  assert.equal(fluxSteps("full"), 8);
});

test("Gemini text is neutral and includes the safety text", () => {
  const t = geminiText(checkInputs({ pose: "waving" }), 2);
  assert.ok(t.includes(SAFE_TEXT));
  assert.ok(t.includes("the artist's own drawings"));
  assert.doesNotMatch(t, /\bher\b/i);
  assert.doesNotMatch(t, /style notes/i);
  assert.doesNotMatch(geminiText(checkInputs({}), 0), /attached images/);
});
