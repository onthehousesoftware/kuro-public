// Kuro (public): small pure helpers the app uses. No DOM, so they run under node --test.

// Which service draws the next figure. Gemini comes first when it has a key and its
// credit isn't used up. If Gemini credit is out and no Cloudflare account is connected,
// stay on "gemini" so the app can say the credits are used up instead of "set up first".
export function chooseProvider({ hasGemini, hasCf, creditOut } = {}) {
  if (hasGemini && !creditOut) return "gemini";
  if (hasCf) return "cloudflare";
  if (hasGemini) return "gemini";
  return "none";
}

// The allowance resets at 00:00 UTC; show that moment in the device's own time, e.g. "6:00 PM".
export function resetLabel(resetAtIso, locale) {
  const d = new Date(resetAtIso);
  if (!resetAtIso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export function limitMessage(resetAtIso) {
  const at = resetLabel(resetAtIso);
  return "Your Cloudflare account has used today's free drawings. " + (at ? `They come back at ${at}.` : "They come back tomorrow.");
}

/* ---------- library backup (export / import) ---------- */
// Keys and tokens never go into a backup file, and never come in from one.
export const SECRET_KEYS = ["geminiKey", "cfAccount", "cfToken"];

const withoutSecrets = (obj) => {
  const out = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) if (!SECRET_KEYS.includes(k)) out[k] = v;
  }
  return out;
};

export function buildExport(items, kv, now = Date.now()) {
  return {
    app: "kuro-public",
    version: 1,
    exportedAt: new Date(now).toISOString(),
    items: items.map(({ id, createdAt, kind, title, starred, type, b64 }) => ({ id, createdAt, kind, title, starred, type, b64 })),
    settings: withoutSecrets(kv),
  };
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function badFile() {
  const e = new Error("That file isn't a Kuro library backup.");
  e.code = "bad_file";
  return e;
}

// Checks every drawing before returning any, so the app can write all of them or none.
export function parseImport(obj, existingIds) {
  if (!obj || typeof obj !== "object" || obj.app !== "kuro-public" || obj.version !== 1 || !Array.isArray(obj.items)) throw badFile();
  const seen = new Set(existingIds);
  const items = [];
  let skipped = 0;
  for (const it of obj.items) {
    if (!it || typeof it !== "object" || typeof it.id !== "string" || !it.id || typeof it.b64 !== "string" || !B64_RE.test(it.b64) || !["mine", "kuro"].includes(it.kind)) throw badFile();
    if (seen.has(it.id)) { skipped++; continue; }
    seen.add(it.id);
    items.push({
      id: it.id,
      createdAt: Number.isFinite(it.createdAt) ? it.createdAt : Date.now(),
      kind: it.kind,
      title: typeof it.title === "string" ? it.title : "",
      starred: it.starred === true,
      type: typeof it.type === "string" && /^image\/[a-z0-9.+-]+$/i.test(it.type) ? it.type : "image/jpeg",
      b64: it.b64,
    });
  }
  return { items, skipped, settings: withoutSecrets(obj.settings) };
}

// "kuro-library-2026-11-26.json", by the device's own date.
export function exportName(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `kuro-library-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}
