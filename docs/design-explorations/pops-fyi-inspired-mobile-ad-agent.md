# Pops.fyi-inspired design variants — Mobile Ad Agent

A reviewable design-language exploration for Mobile Ad Agent, inspired by the
discovery-shell energy of [pops.fyi](https://pops.fyi/) — **without copying its
brand, logo, colors-as-lifted, or assets**. Three distinct directions are built
as real rendered screens so Joe can pick a direction quickly.

## Preview

The variants live under the existing local-app static tree and are served by the
existing server — no new server, no dependencies.

```bash
pnpm run local:app          # starts http://127.0.0.1:3107
# then open:
#   http://127.0.0.1:3107/pops-variants/            (index served for the folder)
#   http://127.0.0.1:3107/pops-variants/index.html  (explicit, always 200)
```

The existing app at `/` is untouched. This exploration owns only
`local-app/pops-variants/**` plus this doc.

## Files

- `local-app/pops-variants/index.html` — gallery shell + all 3 rendered screens
- `local-app/pops-variants/variants.css` — the shared design language + per-variant styles
- `local-app/pops-variants/variants.js` — rail rendering, variant switch, and import/review demos

## The three variants

### 1 · Launchpad (URL-first Home)
App-store discovery feel adapted to a **URL-first, proof-driven** intake.
- Oversized rounded 900-weight headline over generous black space.
- A **white QR/CTA import card** as the hero action — paste an App Store URL, not a prompt.
- Horizontal rails: Your apps → Start a creative (Image Ads + UGC Videos first) → Fresh proof.
- Small high-contrast counters, including a persistent **"0 provider calls"**.
- One bright violet→magenta callout selling proof-locking.

### 2 · App Memory (Proof / Claims / Style / Learnings)
The fixed IA rendered as playful content rails that still enforce proof safety.
- **Proof** — screenshot-style tiles (CSS shapes) with "Verified" badges.
- **Claims** — cards with status: Verified / Needs proof / Cannot claim, each showing its source.
- **Style** — brand swatches + tone chips.
- **Learnings** — note cards with measured deltas.

### 3 · Review Console (Approve / Tweak / Reject)
Draft ads as tall "playable" tiles feeding a **pull-request-style** review.
- Draft rail with state chips (In review / Approved / Rejected); tap to load a draft.
- QA checklist gates the decision (proof fidelity, claim support, caption timing, codec).
- **Visible memory diff** showing exactly what approval writes back to App Memory.

## What each borrows from Pops — and what changes

| Borrowed from Pops | Changed for Mobile Ad Agent |
| --- | --- |
| Near-black canvas (rgb 5,6,6), white high-contrast text | Same canvas; original violet/magenta + proof-green accents (not Pops' palette) |
| Rounded, heavy, oversized headings | Native rounded font stack only — no Nunito/webfont download |
| Mobile-first horizontal rails of tall rounded tiles | Rails carry proof, outputs, drafts — not games |
| White QR/CTA card | Becomes an **app-URL import** card — URL-first, never prompt-first |
| Playful game/app thumbnails | CSS-gradient thumbnails; proof tiles clearly marked as verified evidence |
| One bright accent panel | Sells proof-locking, not a store promo |
| App-store discovery energy | Adapted to a proof-driven ad factory shell |

## Deliberately NOT Pops
- No Pops brand, logo, wordmark, or copied tiles/assets — original marks only.
- Not a generic dark AI dashboard: it stays a fun app-store shell, not a data grid.
- Proof safety wins over playfulness wherever the two conflict (blocked claims can't render).

## Product-constraint compliance
- **URL-first, proof-driven** — Launchpad hero imports a URL; nothing is prompt-first.
- **IA intact** — Home / App Memory / Review; App Memory keeps Proof / Claims / Style / Learnings.
- **First outputs** — Image Ads and UGC Videos only; no Stories/Thumbnails upfront.
- **No provider calls / no mutations** — all data is local mock; `providerMutations` stays 0.
- **Existing app intact** — `/`, `/api/*`, and `scripts/smoke-local-app.mjs` are untouched.
  `scripts/local-app-server.mjs` only gets a folder `index.html` fallback so
  `/pops-variants/` works without typing the explicit file path.

## Responsiveness
- At 390px the page has no horizontal overflow (`overflow-x: hidden` on the body);
  the tile rails scroll horizontally **on purpose** with scroll-snap.
- Layout scales up cleanly to desktop within a centered max-width shell.

## Residual notes
- The server maps `/` → `index.html`; folder requests fall back to the folder's
  `index.html`. If running an older server build without that fallback, use the
  explicit `/pops-variants/index.html` URL.
- All interactions (import, review decision) are cosmetic mocks — they never call
  a network or provider.
