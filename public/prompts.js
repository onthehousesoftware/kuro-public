// Kuro prompt rules, shared by the Worker (FLUX via the family's Cloudflare)
// and the browser (Gemini with the family's key). One copy, so both paths
// get the same blocklist and the same locked-down wording.

// Words that never go into a figure prompt. Kept short and obvious on purpose.
export const BLOCK = /\b(nude|naked|nsfw|sexy|sexual|lingerie|underwear|bra|panties|bikini|swimsuit|topless|shirtless|undress\w*|strip\w*|seductive|kiss\w*|gun|guns|knife|knives|blood\w*|gore|kill\w*|dead|corpse|weapon\w*)\b/i;

export const SAFE_TEXT = "Draw ONE person, fully clothed in modest everyday clothes, age-appropriate and friendly. No nudity, underwear or swimwear, no weapons, no violence, nothing scary.";

export const DETAIL = {
  gesture: "quick loose gesture sketch, flowing lines showing the line of action, very little detail",
  clean: "simple figure sketch with light confident outlines and very little shading",
  full: "more finished figure sketch with clothing details, hair, and light pencil shading",
};

export const cleanText = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

const BLOCKED = { ok: false, error: "blocked", message: "Kuro can't draw that one. Try a different pose." };

export function checkInputs(b) {
  const body = b && typeof b === "object" ? b : {};
  const pose = cleanText(body.pose, 160) || "an interesting, dynamic everyday pose";
  const angle = cleanText(body.angle, 30) || "three-quarter";
  if (BLOCK.test(pose) || BLOCK.test(angle)) return { ...BLOCKED };
  const detailKey = typeof body.detail === "string" && Object.hasOwn(DETAIL, body.detail) ? body.detail : "clean";
  return { ok: true, pose, angle, detail: DETAIL[detailKey], detailKey };
}

export const fluxPrompt = ({ pose, angle, detail }) =>
  "Light, loose graphite pencil sketch in a sketchbook. " +
  `A single full-body person, ${pose}, seen from a ${angle} view, fully clothed in modest everyday clothes, friendly and age-appropriate. ` +
  `${detail}. Thin grey pencil lines on plain white paper, hand-drawn by a young artist, not digital, not manga screentone, ` +
  `no background, no color, no text, no signature, no writing, no frame. Whole body visible from head to feet, centered with space around it.`;

export const fluxSteps = (detailKey) => (detailKey === "gesture" ? 4 : 8);

export const geminiText = ({ pose, angle, detail }, refCount) =>
  `Draw a NEW figure-drawing practice reference for a young art student. ${SAFE_TEXT} ` +
  `Pose: ${pose}. View: ${angle}. Make it a ${detail}. Light pencil lines on plain white sketchbook paper, no background, no color, no text, whole body visible head to feet, centered.` +
  (refCount > 0
    ? ` The attached images are the artist's own drawings: copy the artist's personal drawing style exactly (proportions, head and face shapes, hands, line quality, shading), but draw a different pose. Do not copy the attached drawings' poses or subjects.`
    : "");
