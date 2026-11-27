# Kuro (public)

Free figure-drawing practice for families, from On the House Software. An installable app (PWA) on Cloudflare Workers. No accounts, no analytics, no ads.

- **Practice** – makes a figure from a pose plus view, with a 30 s – 10 min pose timer.
- **Library** – photograph or scan your drawings, name them, and star favorites. Everything stays on the device in IndexedDB.
- **Settings** – a parent connects either their own free Cloudflare account (Workers AI, FLUX-1 schnell) or their own Gemini API key (figures that look like your starred drawings). Keys are stored only on the device.

## How it works
- `public/` holds the app: HTML, CSS, JS, the manifest, the service worker and icons.
- `src/worker.js` serves the app and passes figure requests through to the family's own Cloudflare account. It has no AI binding of its own and never stores or logs keys.
- Figure prompts always ask for a fully clothed, age-appropriate person. A word blocklist rejects unsafe pose text.

## Tests
`npm test`

## Deploy rule (important)
This is **not** the private Kuro, which is a separate app on a separate Cloudflare account. Never edit or deploy it from here.

Before every deploy:
1. `npx wrangler whoami` must show the OTHS email, not the personal one.
2. `npm test` must pass.
3. `npx wrangler deploy`

`wrangler.jsonc` pins `account_id` to the OTHS account, so a deploy while signed in to the wrong account fails instead of landing there.
