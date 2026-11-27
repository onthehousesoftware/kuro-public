// Pass-through to the family's own Cloudflare Workers AI account.
// The account ID and token arrive in request headers, are checked here, are
// sent only to api.cloudflare.com, and are never stored, logged or echoed back.
import { json } from "./http.js";
import { checkInputs, fluxPrompt, fluxSteps } from "../public/prompts.js";

const API = "https://api.cloudflare.com/client/v4/accounts/";
const FLUX_PATH = "/ai/run/@cf/black-forest-labs/flux-1-schnell";
const SEARCH_PATH = "/ai/models/search?per_page=1";

// Account IDs are 32 hex characters. Pasted copies often pick up spaces,
// dashes or capitals; anything else (slashes, dots) is refused outright.
export function normalizeAccount(s) {
  if (typeof s !== "string") return null;
  const v = s.replace(/[\s-]/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(v) ? v : null;
}

// Tokens are URL-safe characters. A pasted "Bearer " prefix is dropped.
export function normalizeToken(s) {
  if (typeof s !== "string") return null;
  const v = s.trim().replace(/^bearer\s+/i, "").trim();
  return /^[A-Za-z0-9_\-]{20,200}$/.test(v) ? v : null;
}

// Workers AI free allowances reset at 00:00 UTC.
export function nextResetUtc(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return d.toISOString();
}

const SETUP_ACCOUNT = { error: "cf_setup", message: "That doesn't look like a Cloudflare account ID." };
const SETUP_TOKEN = { error: "cf_setup", message: "That doesn't look like a Cloudflare API token." };
const UNREACHABLE = { error: "cf", message: "Couldn't reach Cloudflare. Try again." };

function creds({ account, token } = {}) {
  const a = normalizeAccount(account);
  if (!a) return { fail: json(SETUP_ACCOUNT, 400) };
  const t = normalizeToken(token);
  if (!t) return { fail: json(SETUP_TOKEN, 400) };
  return { account: a, token: t };
}

// Turn a Cloudflare error reply into one of Kuro's plain error codes.
function upstreamError(status, data, now) {
  const msg = String(data?.errors?.[0]?.message ?? "");
  // A malformed token comes back as 400 "Authentication failed" (code 9106), not 401.
  if (status === 401 || status === 403 || /authenticat/i.test(msg))
    return json({ error: "cf_token", message: "Cloudflare didn't accept that token, or it doesn't have Workers AI permission for this account." }, 401);
  if (status === 429 || /neuron|daily|limit|quota|exceeded/i.test(msg))
    return json({ error: "limit", message: "Your Cloudflare account has used today's free drawings.", resetAt: nextResetUtc(now) }, 429);
  if (status === 404 || /account/i.test(msg))
    return json({ error: "cf_account", message: "Cloudflare couldn't find that account ID." }, 400);
  return json({ error: "cf", message: "Cloudflare couldn't make that figure. Try again." }, 502);
}

async function call(url, init, fetchFn) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch {
    return { fail: json(UNREACHABLE, 502) };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { res, data };
}

export async function cfFigure(body, credentials, fetchFn = fetch, now = new Date()) {
  const c = creds(credentials);
  if (c.fail) return c.fail;
  const inputs = checkInputs(body);
  if (!inputs.ok) return json({ error: inputs.error, message: inputs.message }, 400);

  const r = await call(API + c.account + FLUX_PATH, {
    method: "POST",
    headers: { authorization: "Bearer " + c.token, "content-type": "application/json" },
    body: JSON.stringify({ prompt: fluxPrompt(inputs), steps: fluxSteps(inputs.detailKey) }),
  }, fetchFn);
  if (r.fail) return r.fail;
  if (!r.res.ok || r.data?.success === false) {
    if (r.res.ok && !r.data) return json(UNREACHABLE, 502);
    return upstreamError(r.res.status, r.data, now);
  }
  const image = r.data?.result?.image;
  if (typeof image !== "string" || !image) return json(UNREACHABLE, 502);
  return json({ image, provider: "cloudflare" });
}

export async function cfCheck(credentials, fetchFn = fetch, now = new Date()) {
  const c = creds(credentials);
  if (c.fail) return c.fail;
  const r = await call(API + c.account + SEARCH_PATH, {
    method: "GET",
    headers: { authorization: "Bearer " + c.token },
  }, fetchFn);
  if (r.fail) return r.fail;
  if (!r.res.ok || !r.data || r.data.success === false) {
    if (r.res.ok && !r.data) return json(UNREACHABLE, 502);
    return upstreamError(r.res.status, r.data, now);
  }
  return json({ ok: true });
}
