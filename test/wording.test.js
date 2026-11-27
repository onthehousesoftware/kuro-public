import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const pub = new URL("../public/", import.meta.url);

test("public pages and scripts use neutral wording and mention no passcode", () => {
  const files = readdirSync(pub).filter((f) => /\.(html|js)$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) {
    const text = readFileSync(new URL(f, pub), "utf8");
    assert.doesNotMatch(text, /\b(her|she|granddaughter|passcode)\b/i, f);
  }
});
