import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const pub = new URL("../public/", import.meta.url);
const read = (f) => readFileSync(new URL(f, pub), "utf8");
const EMAIL = "onthehousesoftware@gmail.com";

test("service worker caches the public shell under a new name", () => {
  const sw = read("sw.js");
  assert.match(sw, /const CACHE = "kuro-public-v1";/);
  const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\]);/)[1]);
  for (const p of ["/", "/styles.css", "/app.js", "/core.js", "/prompts.js", "/gemini.js",
    "/privacy", "/terms", "/guide", "/manifest.webmanifest"]) {
    assert.ok(shell.includes(p), p);
  }
  // The asset server redirects /x.html → /x and /index.html → /; a cached redirect breaks offline pages.
  for (const p of shell) assert.doesNotMatch(p, /\.html$/, p);
  for (const p of shell) {
    const file = p === "/" ? "index.html" : /\.[a-z0-9]+$/.test(p) ? p.slice(1) : p.slice(1) + ".html";
    assert.ok(existsSync(new URL(file, pub)), "missing " + p);
  }
  assert.match(sw, /caches\.match\("\/"\)/);
});

test("privacy page makes the promised key statements and names the contact", () => {
  const t = read("privacy.html");
  assert.match(t, /We never save or log it\./);
  assert.match(t, /goes straight to Google/);
  assert.match(t, /never in a backup file/i);
  assert.ok(t.includes(EMAIL));
});

test("terms page exists with the OTHS contact", () => {
  const t = read("terms.html");
  assert.match(t, /<h1[^>]*>Terms/);
  assert.ok(t.includes(EMAIL));
  assert.ok(t.includes('href="/privacy"'));
});

test("parents' guide has every section and the real button names", () => {
  const t = read("guide.html");
  for (const id of ["cloudflare", "gemini", "install", "backup"]) assert.match(t, new RegExp(`id="${id}"`), id);
  for (const b of ["Save a backup file", "Load a backup file", "Test connection", "Remove all my keys"]) assert.ok(t.includes(b), b);
  assert.match(t, /<figure class="shot"/);
});

test("every page has the shared footer links and no scripts from elsewhere", () => {
  for (const f of ["index.html", "privacy.html", "terms.html", "guide.html"]) {
    const t = read(f);
    for (const href of ["/privacy", "/terms", "/guide", "https://onthehousesoftware.com"]) {
      assert.ok(t.includes(`href="${href}"`), `${f} → ${href}`);
    }
    assert.doesNotMatch(t, /<script[^>]+src="https?:/, f);
    assert.doesNotMatch(t, /href="\/(privacy|terms|guide)\.html/, f + " uses a redirecting .html link");
  }
});

test("manifest keeps the name and makes no one-person style claim", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Kuro");
  assert.doesNotMatch(m.description, /your own style/i);
});

test("privacy page discloses the per-IP rate limit count", () => {
  const html = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
  assert.match(html, /counted for about a minute/);
  assert.doesNotMatch(html, /used only to answer that request/);
});

const FONTS = [
  "zen-maru-gothic-latin-500-normal.woff2", "zen-maru-gothic-latin-700-normal.woff2",
  "zen-maru-gothic-latin-900-normal.woff2", "nunito-sans-latin-400-normal.woff2",
  "nunito-sans-latin-600-normal.woff2", "nunito-sans-latin-700-normal.woff2",
];

test("fonts are self-hosted: no page asks Google Fonts", () => {
  for (const f of ["index.html", "privacy.html", "terms.html", "guide.html", "styles.css", "sw.js"]) {
    assert.doesNotMatch(read(f), /fonts\.(googleapis|gstatic)\.com/, f);
  }
  assert.doesNotMatch(read("privacy.html"), /Google Fonts/);
});

test("each font file exists, has an @font-face, and is in the offline shell", () => {
  const css = read("styles.css");
  const sw = read("sw.js");
  const shell = JSON.parse(sw.match(/const SHELL = (\[[^\]]*\]);/)[1]);
  for (const f of FONTS) {
    assert.ok(existsSync(new URL("fonts/" + f, pub)), "missing " + f);
    assert.ok(css.includes(`url(/fonts/${f})`), "no @font-face for " + f);
    assert.ok(shell.includes("/fonts/" + f), "not in shell: " + f);
  }
  for (const w of ["500", "700", "900"]) assert.match(css, new RegExp(`font-family:"Zen Maru Gothic";[^}]*font-weight:${w}`));
  for (const w of ["400", "600", "700"]) assert.match(css, new RegExp(`font-family:"Nunito Sans";[^}]*font-weight:${w}`));
  assert.ok(existsSync(new URL("fonts/OFL-zen-maru-gothic.txt", pub)));
  assert.ok(existsSync(new URL("fonts/OFL-nunito-sans.txt", pub)));
});
