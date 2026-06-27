# Mobile Ad Agent — Variant Lab V2

A clean-sheet V2 design exploration for the Mobile Ad Agent control plane. Three
complete, selectable screens — each leads with one clear idea rather than a
generic dashboard. Static, no dependencies, no build step.

## How to open

Just open the file — there is no server or install step:

```
variant-lab-v2/index.html
```

Or serve it locally if you prefer:

```bash
cd variant-lab-v2
python3 -m http.server 8000
# then visit http://localhost:8000
```

Switch variants with the **A / B / C** control in the top bar, or press the
`A`, `B`, or `C` keys.

## The three variants

**A — Launchpad OS** · _best first-run UX_
A quiet workspace rail (multiple apps) beside one dominant, URL-first launch
surface. Paste an App Store, Play Store, or website link — the source type
auto-detects as you type. A sequence strip shows the full pipeline
(Launchpad → Proof Review → Draft Pack → Review Drafts → QA & Export). The two
output types — **Image Ads** and **UGC Videos** — are shown as "what this
workspace makes," but drafts stay locked until proof is reviewed (no sample
pack preview up front).

**B — Proof Room** · _best proof / progressive-disclosure UX_
The calm review state after an import. Real-looking source snapshots on the
left; extracted claims on the right, each traced to a snapshot with a
confidence score. Claims are split into **Allowed in creative** (toggle to
include/exclude) and **Held — needs a source** (with a "Why held?" disclosure).
Nothing advances until you **Approve proof**.

**C — Creative Desk** · _best post-generation UX_
The premium workspace after drafts exist. Filter the review queue by **Image
Ads** / **UGC Videos**, select any creative to open its QA detail (proof links,
QA checks, status), and use the **Export vault** — download, share link, or send
to an export inbox. Held / in-QA items can't be exported. A compact URL field in
the header keeps intake reachable for starting another pack.

## Design notes

- Dark, modern SaaS mood (Grok / Linear-level black UI) with a single signature
  iris accent — not a technical admin dashboard. No brand, logo, or layout is
  copied.
- All creative and proof thumbnails are built in pure HTML/CSS (gradients, type,
  mini UI) — no images, no fake blank phone rectangles.
- Strong hierarchy, fewer panels, more whitespace, tactile hover/selected
  states, subtle motion, and responsive down to mobile.
- **URL-first everywhere**, **multiple apps** in every variant, both **Image
  Ads** and **UGC Videos**, and a persistent **Provider mutations 0** badge —
  this is a creative factory with export/share only, never an ad-network launch.

## Boundaries honored

Static and self-contained. No network calls, no external fonts, no secrets, and
no provider mutations — the only "actions" are local UI state and an export
counter. Nothing in this folder edits or depends on the rest of the repo.
