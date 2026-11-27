// Gemini, called straight from the browser with the family's own key.
// The key goes from this device to Google only; it never touches the Kuro server.
import { checkInputs, geminiText } from "./prompts.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";
export const GEMINI_MODELS = { best: "gemini-nano-banana-2.1", lite: "gemini-3.1-flash-lite-image" };

// Paid-tier prices in US dollars per 1M tokens (Gemini API pricing, checked Nov 2026).
// Used only to ESTIMATE spend on the device; Google's Billing page is the real number.
export const PRICES = {
  "gemini-nano-banana-2.1":      { input: 1.50, text: 7.50, image: 30, fallback: 0.045 },
  "gemini-3.1-flash-lite-image": { input: 0.25, text: 1.50, image: 30, fallback: 0.036 },
};
export const IMAGE_TOKENS_1K = 1120; // one 1K output image

// The Interactions API reports usage; field names vary a little, so read them loosely.
export function usageCost(data, model) {
  const p = PRICES[model];
  if (!p) return { cost: 0, source: "unknown" };
  const u = data?.usage || data?.usage_metadata || data?.usageMetadata;
  const num = (...keys) => { for (const k of keys) { const v = Number(u?.[k]); if (Number.isFinite(v) && v > 0) return v; } return 0; };
  const input = num("total_input_tokens", "input_tokens", "prompt_token_count", "promptTokenCount");
  const output = num("total_output_tokens", "output_tokens", "candidates_token_count", "candidatesTokenCount");
  const thought = num("total_thought_tokens", "thought_tokens", "thoughts_token_count", "thoughtsTokenCount");
  if (!u || (!input && !output)) return { cost: p.fallback, source: "estimate" };
  let image = 0;
  const byMod = u.output_tokens_by_modality || u.candidates_tokens_details || u.candidatesTokensDetails;
  if (Array.isArray(byMod)) for (const m of byMod) if (/image/i.test(m?.modality || "")) image += Number(m.tokens ?? m.token_count ?? m.tokenCount) || 0;
  if (!image && output) image = Math.min(output, IMAGE_TOKENS_1K);
  const text = Math.max(0, output - image) + thought;
  const cost = (input * p.input + text * p.text + image * p.image) / 1e6;
  return { cost: Math.round(cost * 10000) / 10000, source: "usage" };
}

export function findImage(node) {
  if (!node || typeof node !== "object") return null;
  const mime = node.mime_type || node.mimeType;
  if (typeof node.data === "string" && node.data.length > 1000 && (!mime || /^image\//.test(mime))) return { data: node.data, mime: mime || "image/jpeg" };
  for (const v of Array.isArray(node) ? node : Object.values(node)) { const hit = findImage(v); if (hit) return hit; }
  return null;
}

// Errors carry a code the app branches on, plus a plain message to show.
const fail = (code, message, detail) => Object.assign(new Error(message), { code }, detail ? { detail } : {});
const cleanKey = (key) => String(key ?? "").trim();

export async function geminiFigure(key, body, refs, fetchFn = fetch) {
  const k = cleanKey(key);
  if (!k) throw fail("gemini_key", "Paste a Gemini key in Settings first.");
  const inputs = checkInputs(body);
  if (!inputs.ok) throw fail(inputs.error, inputs.message);
  const model = GEMINI_MODELS[body?.model] || GEMINI_MODELS.best;
  const pics = (Array.isArray(refs) ? refs : []).filter((r) => typeof r === "string" && r.length < 1_500_000).slice(0, model === GEMINI_MODELS.lite ? 1 : 3);
  const input = [{ type: "text", text: geminiText(inputs, pics.length) }, ...pics.map((data) => ({ type: "image", mime_type: "image/jpeg", data }))];
  let r;
  try {
    r = await fetchFn(GEMINI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": k },
      body: JSON.stringify({ model, input, response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "1:1", image_size: "1K" } }),
    });
  } catch {
    throw fail("gemini", "Couldn't reach Gemini. Try again.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = String(data?.error?.message || "");
    // Prepaid balance hit $0. Google sends 402 or 429 with "prepayment credits are depleted".
    if (r.status === 402 || /prepay|credits? (are |is )?(depleted|exhausted)|no credits/i.test(m))
      throw fail("gemini_credits", "The Gemini credits are used up.", m.slice(0, 300));
    if (r.status === 400 && /key/i.test(m) || r.status === 401 || r.status === 403)
      throw fail("gemini_key", "Gemini didn't accept that key. Check it in Settings.");
    if (r.status === 429 || /billing|quota/i.test(m))
      throw fail("gemini_quota", "Gemini says this key is out of quota or needs billing turned on.");
    if (/safety|blocked/i.test(m)) throw fail("blocked", "Gemini wouldn't draw that one. Try a different pose.");
    throw fail("gemini", "Gemini had a problem making that figure. Try again.");
  }
  const img = findImage(data.output_image) || findImage(data);
  if (!img) throw fail("gemini", "Gemini didn't send back a picture. Try again.");
  const { cost, source } = usageCost(data, model);
  return { image: img.data, mime: img.mime, cost, costSource: source };
}

export async function geminiCheck(key, fetchFn = fetch) {
  const k = cleanKey(key);
  if (!k) throw fail("gemini_key", "Paste a key first.");
  const r = await fetchFn(MODELS_URL, { method: "GET", headers: { "x-goog-api-key": k } }).catch(() => null);
  if (!r) throw fail("gemini", "Couldn't reach Google. Try again.");
  if (!r.ok) throw fail("gemini_key", "Google didn't accept that key.");
  return true;
}
