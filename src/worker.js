// Kuro (public) — Cloudflare Worker: serves the app and a thin pass-through
// to the family's own Cloudflare Workers AI account. Gemini is called straight
// from the browser, so it has no route here. Nothing is stored or logged.
import { json } from "./http.js";
import { cfFigure, cfCheck } from "./cloudflare.js";

// Light per-IP flood guard on the pass-through (Cloudflare's rate-limiting
// binding, counted per location). If the binding is missing or errors, the
// request goes through normally.
async function overLimit(req, env) {
  if (!env.RL) return false;
  try {
    const key = req.headers.get("cf-connecting-ip") || "anon";
    const { success } = await env.RL.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

const credsFrom = (req) => ({
  account: req.headers.get("x-cf-account"),
  token: req.headers.get("x-cf-token"),
});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      if (req.method !== "POST") return json({ error: "method" }, 405);
      if (await overLimit(req, env)) {
        return json({ error: "busy", message: "Lots of figures at once. Wait a minute and try again." }, 429);
      }
      if (url.pathname === "/api/figure") {
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        return cfFigure(body, credsFrom(req));
      }
      if (url.pathname === "/api/cf-check") return cfCheck(credsFrom(req));
      return json({ error: "not found" }, 404);
    }
    return env.ASSETS.fetch(req);
  },
};
