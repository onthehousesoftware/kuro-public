// Kuro (public) — app. The library lives in this device's IndexedDB.
// Figures come from the family's own Gemini key (straight to Google) or their own
// Cloudflare account (through /api/figure, which stores nothing).
import { geminiFigure, geminiCheck } from "./gemini.js";
import { chooseProvider, limitMessage, buildExport, parseImport, exportName } from "./core.js";

const $ = (id) => document.getElementById(id);
const POSES = ["Surprise me","Standing","Walking","Running","Sitting","Reaching","Twisting","Dancing","Jumping","Crouching","Lying down"];
const TIMES = [[30,"30 sec"],[60,"1 min"],[120,"2 min"],[300,"5 min"],[600,"10 min"]];
const state = { pose: "Surprise me", secs: 60, left: 60, run: null, items: [], filter: "all", lastBlob: null, viewing: null, pending: [], pendingBlob: null, urls: new Map() };

/* ---------- tiny IndexedDB store ---------- */
const idb = new Promise((res, rej) => {
  const r = indexedDB.open("kuro-public", 1);
  r.onupgradeneeded = () => { r.result.createObjectStore("items", { keyPath: "id" }); r.result.createObjectStore("kv"); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function tx(store, mode, fn) {
  const db = await idb;
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
  });
}
const allItems = () => tx("items", "readonly", (s) => s.getAll());
const putItem = (it) => tx("items", "readwrite", (s) => s.put(it));
const delItem = (id) => tx("items", "readwrite", (s) => s.delete(id));
// All drawings in one transaction: if any write fails, none of them stay.
const putItems = (list) => tx("items", "readwrite", (s) => { for (const it of list) s.put(it); });
const getKV = (k) => tx("kv", "readonly", (s) => s.get(k));
const setKV = (k, v) => tx("kv", "readwrite", (s) => s.put(v, k));
const keepStorage = () => { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); };

async function loadLib() {
  try {
    state.items = (await allItems()).sort((a, b) => b.createdAt - a.createdAt);
    keepStorage();
  } catch {
    $("storeNote").hidden = false;
    $("storeNote").textContent = "This browser won't let Kuro save drawings (private browsing?). Open Kuro normally to keep a library.";
  }
  renderLib();
}
function urlOf(it) {
  if (!state.urls.has(it.id)) state.urls.set(it.id, URL.createObjectURL(it.blob));
  return state.urls.get(it.id);
}

/* ---------- the Worker's Cloudflare pass-through ---------- */
const OFFLINE = "Kuro needs the internet to make figures. Your library still works offline.";
// Errors are {message, code}; branch on code, not on the HTTP status.
async function api(path, body, creds = cf) {
  if (!navigator.onLine) throw { message: OFFLINE };
  let r;
  try {
    r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cf-account": creds.account || "", "x-cf-token": creds.token || "" },
      body: JSON.stringify(body || {}),
    });
  } catch { throw { message: "Couldn't reach Kuro. Try again.", code: "cf" }; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    if (data.error === "limit") throw { message: limitMessage(data.resetAt), code: "limit" };
    throw { message: data.message || "Something went wrong. Try again.", code: data.error };
  }
  return data;
}

/* ---------- helpers ---------- */
function chipRow(el, list, cur, onPick) {
  el.replaceChildren(...list.map(([v, l]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = l;
    b.setAttribute("aria-pressed", String(v === cur));
    b.onclick = () => { onPick(v); chipRow(el, list, v, onPick); };
    return b;
  }));
}
const say = (id, t) => { $(id).textContent = t; };
function loadImg(blob) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); }); }
async function scaled(blob, max, clean, q = 0.9) {
  const img = await loadImg(blob); const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  if (clean) {
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data, hist = new Uint32Array(256);
    for (let i = 0; i < p.length; i += 4) { const v = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) | 0; p[i] = v; hist[v]++; }
    const n = p.length / 4; let acc = 0, lo = 0, hi = 255;
    // hi = paper tone (most pixels are paper), lo = darkest ink; paper always maps to white
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc < n * 0.005) lo = v; if (acc < n * 0.5) hi = v; }
    hi = Math.max(hi - 8, 30); lo = Math.min(lo, hi - 60, 90); if (lo < 0) lo = 0;
    for (let i = 0; i < p.length; i += 4) { let t = (p[i] - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t; const v = Math.round(t ** 1.6 * 255); p[i] = p[i + 1] = p[i + 2] = v; }
    x.putImageData(d, 0, 0);
  }
  return new Promise((r) => c.toBlob(r, "image/jpeg", q));
}
const toB64 = (blob) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1]); f.readAsDataURL(blob); });
const fromB64 = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

/* ---------- routing ---------- */
function route() {
  const v = (location.hash || "#practice").slice(1);
  const name = ["practice", "library", "settings", "help"].includes(v) ? v : "practice";
  for (const s of document.querySelectorAll(".view")) s.classList.toggle("on", s.id === "v-" + name);
  for (const a of document.querySelectorAll("nav a")) { if (a.dataset.v === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
}
addEventListener("hashchange", route);

/* ---------- library ---------- */
async function addItem(blob, meta) {
  const it = { id: "d-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), createdAt: Date.now(), blob, ...meta };
  await putItem(it); state.items.unshift(it); renderLib();
}
function card(it, small) {
  const b = document.createElement("button"); b.type = "button"; b.className = "card";
  const im = document.createElement("div"); im.className = "im";
  const img = document.createElement("img"); img.loading = "lazy"; img.src = urlOf(it); img.alt = it.title || "Drawing";
  im.append(img); b.append(im);
  if (!small) {
    const tg = document.createElement("span"); tg.className = "tag" + (it.kind === "kuro" ? " k" : ""); tg.textContent = it.kind === "kuro" ? "Kuro figure" : "Mine"; b.append(tg);
    const t = document.createElement("span"); t.className = "t"; t.textContent = it.title || "Untitled"; b.append(t);
  }
  if (it.starred) { const s = document.createElement("span"); s.className = "star"; s.textContent = "★"; s.setAttribute("aria-label", "style example"); b.append(s); }
  b.onclick = () => openItem(it);
  return b;
}
function renderLib() {
  const list = state.items.filter((it) => state.filter === "all" || it.kind === state.filter);
  if (!list.length) {
    const d = document.createElement("div"); d.className = "blank";
    d.textContent = state.items.length ? "Nothing here yet in this filter." : "No drawings yet. Take a photo of one of your figure drawings to start your library.";
    $("grid").replaceChildren(d);
  } else $("grid").replaceChildren(...list.map((it) => card(it)));
}
chipRow($("filterChips"), [["all", "All"], ["mine", "My drawings"], ["kuro", "Kuro figures"]], "all", (v) => { state.filter = v; renderLib(); });

/* ---------- library backup file ---------- */
const plural = (n, one) => n + " " + one + (n === 1 ? "" : "s");
$("exportBtn").onclick = async () => {
  if (!state.items.length) { say("libMsg", "Nothing to back up yet. Add a drawing first."); return; }
  $("exportBtn").disabled = true; say("libMsg", "Making the backup file…");
  try {
    const items = [];
    for (const it of state.items) items.push({ ...it, type: it.blob.type || "image/jpeg", b64: await toB64(it.blob) });
    const kv = {};
    for (const k of ["geminiModel", "geminiKey", "cfAccount", "cfToken"]) kv[k] = await getKV(k).catch(() => undefined);
    const file = new Blob([JSON.stringify(buildExport(items, kv))], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = exportName();
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    say("libMsg", "Backup saved with " + plural(items.length, "drawing") + ". Keep the file somewhere safe.");
  } catch { say("libMsg", "Couldn't make the backup file. Try again."); }
  $("exportBtn").disabled = false;
};
$("importIn").onchange = async () => {
  const f = $("importIn").files[0]; $("importIn").value = "";
  if (!f) return;
  say("libMsg", "Reading the backup file…");
  let parsed;
  try { parsed = parseImport(JSON.parse(await f.text()), new Set(state.items.map((it) => it.id))); }
  catch (e) { say("libMsg", e && e.code === "bad_file" ? e.message : "That file isn't a Kuro library backup."); return; }
  try {
    const list = parsed.items.map(({ b64, type, ...rest }) => ({ ...rest, blob: fromB64(b64, type) }));
    if (list.length) await putItems(list);
    if (["best", "lite"].includes(parsed.settings.geminiModel) && !gem.key) {
      gem.model = parsed.settings.geminiModel; $("gemModel").value = gem.model;
      await setKV("geminiModel", gem.model).catch(() => {});
    }
    state.items = (await allItems()).sort((a, b) => b.createdAt - a.createdAt);
    renderLib(); keepStorage();
    say("libMsg", "Added " + plural(list.length, "drawing") + ", skipped " + parsed.skipped + " already here.");
  } catch { say("libMsg", "Couldn't add the drawings. Nothing was changed. Try again."); }
};

/* ---------- photo / scan intake ---------- */
async function startAdd(files) { state.pending = [...files]; if (state.pending.length) await showPending(); }
async function showPending() {
  const f = state.pending[0];
  $("addTitle").value = (f.name || "").replace(/\.[^.]+$/, "").replace(/^(IMG|PXL|image|Screenshot)[-_ ]?\d.*$/i, "");
  $("addStar").checked = false; say("addMsg", "");
  await refreshPrev(); if (!$("addDlg").open) $("addDlg").showModal();
}
async function refreshPrev() {
  try { state.pendingBlob = await scaled(state.pending[0], 1800, $("cleanTg").checked); $("addPrev").src = URL.createObjectURL(state.pendingBlob); }
  catch { say("addMsg", "That picture couldn't be opened. Try a different one."); }
}
$("cleanTg").onchange = refreshPrev;
$("camIn").onchange = (e) => { startAdd(e.target.files); e.target.value = ""; };
$("fileIn").onchange = (e) => { startAdd(e.target.files); e.target.value = ""; };
$("addForm").onsubmit = async (e) => {
  if (!e.submitter || e.submitter.value !== "save") { state.pending = []; return; }
  e.preventDefault(); if (!state.pendingBlob) return;
  $("addSave").disabled = true; say("addMsg", "Saving…");
  try {
    await addItem(state.pendingBlob, { kind: "mine", title: $("addTitle").value.trim() || "Untitled drawing", starred: $("addStar").checked });
    state.pending.shift();
    if (state.pending.length) await showPending(); else $("addDlg").close();
  } catch { say("addMsg", "Couldn't save that one. The tablet may be out of space."); }
  $("addSave").disabled = false;
};

/* ---------- viewing an item ---------- */
function openItem(it) {
  state.viewing = it; $("viewImg").src = urlOf(it); $("viewImg").alt = it.title || "Drawing";
  $("viewTitle").value = it.title || ""; $("viewStar").checked = !!it.starred; say("viewMsg", "");
  $("viewStarRow").hidden = it.kind !== "mine"; $("practiceThis").hidden = it.kind !== "kuro";
  $("dlLink").href = urlOf(it); $("dlLink").download = (it.title || "kuro-drawing").replace(/[^\w\- ]+/g, "") + ".jpg";
  $("delBtn").textContent = "Delete"; delete $("delBtn").dataset.arm;
  $("viewDlg").showModal();
}
$("viewForm").onsubmit = async () => {
  const it = state.viewing; if (!it) return;
  const title = $("viewTitle").value.trim(), starred = $("viewStar").checked;
  if (title !== (it.title || "") || starred !== !!it.starred) { it.title = title; it.starred = starred; await putItem(it).catch(() => {}); renderLib(); }
};
$("delBtn").onclick = async () => {
  const b = $("delBtn");
  if (!b.dataset.arm) { b.dataset.arm = "1"; b.textContent = "Tap again to delete for good"; return; }
  const it = state.viewing;
  try { await delItem(it.id); state.items = state.items.filter((x) => x !== it); URL.revokeObjectURL(state.urls.get(it.id)); state.urls.delete(it.id); renderLib(); $("viewDlg").close(); }
  catch { say("viewMsg", "Couldn't delete that. Try again."); }
};
$("practiceThis").onclick = () => { const it = state.viewing; $("viewDlg").close(); showFigure(it.blob, false); location.hash = "#practice"; };

/* ---------- figures ---------- */
let figUrl = null;
function showFigure(blob, isNew) {
  if (figUrl) URL.revokeObjectURL(figUrl); figUrl = URL.createObjectURL(blob);
  const img = $("figImg"); img.src = figUrl; img.hidden = false; img.alt = "Practice figure";
  $("placeholder").style.display = "none"; $("emptyMsg").hidden = true;
  state.lastBlob = isNew ? blob : null; $("saveFigBtn").disabled = !isNew; resetTimer();
}
const CREDITS_OUT = "The Gemini credits are used up. Add more in Google AI Studio, or connect a Cloudflare account in Settings.";
const provider = () => chooseProvider({ hasGemini: !!gem.key, hasCf: hasCf(), creditOut: credit.out });

async function fromGemini(body) {
  if (!navigator.onLine) throw { message: OFFLINE };
  const refs = [];
  const starred = state.items.filter((it) => it.starred && it.kind === "mine").slice(0, gem.model === "lite" ? 1 : 3);
  for (const it of starred) refs.push(await toB64(await scaled(it.blob, 1024, false, 0.85)));
  const out = await geminiFigure(gem.key, { ...body, model: gem.model }, refs);
  await spend(out.cost);
  return out;
}

$("makeBtn").onclick = async () => {
  const typed = $("poseTxt").value.trim();
  const pose = typed || (state.pose === "Surprise me" ? "" : state.pose.toLowerCase());
  const body = { pose, angle: $("angle").value, detail: $("detail").value };
  const via = provider();
  if (via === "none") { paintEngine(); return; }
  if (via === "gemini" && credit.out) { say("pMsg", CREDITS_OUT); return; }
  $("busy").classList.add("on"); $("makeBtn").disabled = true; say("pMsg", "");
  try {
    let out, note = "Here's your figure. Start the timer when you're ready to draw.";
    if (via === "gemini") {
      try {
        out = await fromGemini(body);
      } catch (e) {
        if (e.code !== "gemini_credits") throw e;
        // Out of prepaid credit: remember it, then fall back to their Cloudflare account if there is one.
        credit.out = true; credit.spent = Math.max(credit.spent, credit.start); await saveCredit();
        if (!hasCf()) throw { message: CREDITS_OUT };
        $("busyTxt").textContent = "Switching to your Cloudflare account…";
        out = await api("/api/figure", body);
        note = "The Gemini credits are used up, so Kuro switched to your Cloudflare account. The figures keep coming!";
      }
    } else {
      out = await api("/api/figure", body);
      if (gem.key && credit.out) note = "Using your Cloudflare account until more Gemini credits are added.";
    }
    showFigure(fromB64(out.image, out.mime || "image/jpeg"), true);
    say("pMsg", note);
  } catch (e) { if (e && e.message) say("pMsg", e.message); }
  paintEngine();
  $("busy").classList.remove("on"); $("makeBtn").disabled = false;
};
$("saveFigBtn").onclick = async () => {
  if (!state.lastBlob) return; $("saveFigBtn").disabled = true;
  const pose = $("poseTxt").value.trim() || state.pose;
  try { await addItem(state.lastBlob, { kind: "kuro", title: pose + " · " + $("angle").value, starred: false }); state.lastBlob = null; say("pMsg", "Saved to your library."); }
  catch { $("saveFigBtn").disabled = false; say("pMsg", "Couldn't save that figure."); }
};

/* ---------- which service draws, shown in Settings and on Practice ---------- */
function paintEngine() {
  const via = provider();
  $("engineNote").textContent =
    via === "none" ? "Nothing is connected yet. Connect a free Cloudflare account or add a Gemini key below."
    : via === "cloudflare" && gem.key ? "The Gemini credits are used up, so figures come from your Cloudflare account for now."
    : via === "cloudflare" ? "Figures are drawn by your own Cloudflare account. Add a Gemini key if you'd like figures that look more like your drawings."
    : credit.out ? "The Gemini credits are used up. Add more in AI Studio, or connect a Cloudflare account."
    : "Figures are drawn by Gemini with your key, looking at your starred drawings.";
  $("busyTxt").textContent = via === "gemini" ? "Gemini is drawing…" : "Sketching a figure…";
  $("setupCard").hidden = via !== "none";
  $("makeBtn").hidden = via === "none";
  paintCredit();
}

/* ---------- settings: the family's own Cloudflare account ---------- */
const cf = { account: "", token: "" };
const hasCf = () => !!(cf.account && cf.token);
async function loadCf() {
  try { cf.account = (await getKV("cfAccount")) || ""; cf.token = (await getKV("cfToken")) || ""; } catch {}
  $("cfAccount").value = cf.account; $("cfToken").value = cf.token;
}
const cfFields = () => ({ account: $("cfAccount").value.trim(), token: $("cfToken").value.trim() });
async function cfTry(btn, okMsg, after) {
  const creds = cfFields();
  if (!creds.account || !creds.token) { say("cfMsg", "Paste both the account ID and the token first."); return; }
  btn.disabled = true; say("cfMsg", "Checking with Cloudflare…");
  try { await api("/api/cf-check", {}, creds); if (after) await after(creds); say("cfMsg", okMsg); }
  catch (e) { if (e && e.message) say("cfMsg", e.message); }
  btn.disabled = false;
}
$("cfTest").onclick = () => cfTry($("cfTest"), "Connected. Tap Save to use this account.");
$("cfSave").onclick = () => cfTry($("cfSave"), "Saved. New figures can use your Cloudflare account.", async (creds) => {
  Object.assign(cf, creds);
  await setKV("cfAccount", cf.account); await setKV("cfToken", cf.token);
  keepStorage(); paintEngine();
});
$("cfRemove").onclick = async () => {
  cf.account = ""; cf.token = ""; $("cfAccount").value = ""; $("cfToken").value = "";
  await setKV("cfAccount", "").catch(() => {}); await setKV("cfToken", "").catch(() => {});
  say("cfMsg", "Cloudflare account removed from this device."); paintEngine();
};
$("showCf").onclick = () => { const i = $("cfToken"); const show = i.type === "password"; i.type = show ? "text" : "password"; $("showCf").textContent = show ? "Hide" : "Show"; };

/* ---------- settings: the family's own Gemini key ---------- */
const gem = { key: "", model: "best" };
async function loadGem() {
  try { gem.key = (await getKV("geminiKey")) || ""; gem.model = (await getKV("geminiModel")) || "best"; } catch {}
  $("gemKey").value = gem.key; $("gemModel").value = gem.model;
}

/* ---------- estimated Gemini credit (Google doesn't let apps read the real balance) ---------- */
const credit = { start: 0, spent: 0, figures: 0, since: 0, out: false };
const money = (n) => "$" + Math.max(0, n).toFixed(2);
async function loadCredit() {
  try { Object.assign(credit, (await getKV("credit")) || {}); } catch {}
  if (credit.start) $("creditStart").value = credit.start.toFixed(2);
}
const saveCredit = () => setKV("credit", { ...credit }).catch(() => {});
async function spend(cost) {
  credit.figures++; credit.spent += Number(cost) || 0; await saveCredit();
}
function paintCredit() {
  const show = !!gem.key;
  $("creditLine").hidden = !show; $("creditBox").hidden = !show;
  if (!show) return;
  const left = credit.start - credit.spent;
  let line;
  if (credit.out) line = hasCf() ? "Gemini credits: used up. Using your Cloudflare account." : "Gemini credits: used up.";
  else if (!credit.start) line = "Gemini credits: set your balance in Settings.";
  else line = "Gemini credits: about " + money(left) + " left" + (left <= 1 ? " (running low!)" : "");
  $("creditLine").textContent = line;
  $("creditLine").classList.toggle("low", credit.out || (credit.start > 0 && left <= 1));
  const since = credit.since ? new Date(credit.since).toLocaleDateString() : "";
  $("creditInfo").textContent = credit.start
    ? `About ${money(left)} left of ${money(credit.start)}. ${credit.figures} Gemini figure${credit.figures === 1 ? "" : "s"} since ${since}, about ${money(credit.spent)} used.`
    : "No balance set yet. Type how much credit is on the key and tap Set balance.";
}
$("setCredit").onclick = async () => {
  const v = Number(String($("creditStart").value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(v) || v <= 0 || v > 1000) { say("cMsg", "Type an amount like 10 or 10.00."); return; }
  Object.assign(credit, { start: v, spent: 0, figures: 0, since: Date.now(), out: false });
  await saveCredit(); $("creditStart").value = v.toFixed(2);
  say("cMsg", "Balance set to " + money(v) + ". Kuro will use Gemini again."); paintEngine();
};
$("showKey").onclick = () => { const i = $("gemKey"); const show = i.type === "password"; i.type = show ? "text" : "password"; $("showKey").textContent = show ? "Hide" : "Show"; };
$("saveKey").onclick = async () => {
  const k = $("gemKey").value.trim();
  if (!k) { say("kMsg", "Paste a key first."); return; }
  if (!navigator.onLine) { say("kMsg", "Connect to the internet to check the key."); return; }
  $("saveKey").disabled = true; say("kMsg", "Checking the key with Google…");
  try {
    await geminiCheck(k);
    gem.key = k; gem.model = $("gemModel").value;
    await setKV("geminiKey", k); await setKV("geminiModel", gem.model);
    keepStorage();
    say("kMsg", "Key saved. New figures will use Gemini."); paintEngine();
  } catch (e) { if (e && e.message) say("kMsg", e.message); }
  $("saveKey").disabled = false;
};
$("gemModel").onchange = async () => { gem.model = $("gemModel").value; if (gem.key) { await setKV("geminiModel", gem.model).catch(() => {}); say("kMsg", "Model saved."); } };
$("removeKey").onclick = async () => {
  gem.key = ""; $("gemKey").value = ""; await setKV("geminiKey", "").catch(() => {});
  say("kMsg", hasCf() ? "Key removed. Figures come from your Cloudflare account." : "Key removed."); paintEngine();
};
$("removeAll").onclick = async () => {
  gem.key = ""; cf.account = ""; cf.token = "";
  Object.assign(credit, { start: 0, spent: 0, figures: 0, since: 0, out: false });
  for (const id of ["gemKey", "cfAccount", "cfToken", "creditStart"]) $(id).value = "";
  await Promise.all(["geminiKey", "cfAccount", "cfToken"].map((k) => setKV(k, "").catch(() => {})));
  await saveCredit();
  say("raMsg", "All keys and tokens are gone from this device."); say("kMsg", ""); say("cfMsg", "");
  paintEngine();
};

/* ---------- pose timer ---------- */
const fmt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
function paint() { const c = $("clock"); c.hidden = false; c.textContent = fmt(state.left); c.classList.toggle("done", state.left === 0); }
function resetTimer() { clearInterval(state.run); state.run = null; state.left = state.secs; $("goBtn").textContent = "Start"; paint(); }
function chime() { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.2, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 1.2); o.start(); o.stop(a.currentTime + 1.2); } catch {} }
$("goBtn").onclick = () => {
  if (state.run) { clearInterval(state.run); state.run = null; $("goBtn").textContent = "Resume"; return; }
  if (state.left === 0) state.left = state.secs;
  $("goBtn").textContent = "Pause"; paint();
  state.run = setInterval(() => { state.left--; paint(); if (state.left <= 0) { clearInterval(state.run); state.run = null; $("goBtn").textContent = "Again"; chime(); } }, 1000);
};
$("resetBtn").onclick = resetTimer;
chipRow($("timeChips"), TIMES, state.secs, (v) => { state.secs = v; resetTimer(); });
chipRow($("poseChips"), POSES.map((p) => [p, p]), state.pose, (v) => { state.pose = v; $("poseTxt").value = ""; });

/* ---------- start ---------- */
route(); paint(); $("clock").hidden = true; loadLib();
Promise.all([loadCredit(), loadGem(), loadCf()]).then(paintEngine);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
