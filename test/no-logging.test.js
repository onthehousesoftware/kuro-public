import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

test("no console logging in the Worker or the shared modules it imports", () => {
  const files = readdirSync(new URL("src/", root)).filter((f) => f.endsWith(".js")).map((f) => "src/" + f);
  files.push("public/prompts.js");
  for (const f of files) {
    const text = readFileSync(new URL(f, root), "utf8");
    assert.doesNotMatch(text, /console\./, f);
  }
});
