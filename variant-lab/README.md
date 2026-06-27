# Mobile Ad Agent — Variant Lab

A standalone, no-build static prototype that presents **three complete, selectable
UI variants** for Mobile Ad Agent — a **URL-first** creative generation control plane.
The first action is always *paste/import a link* (App Store / Play Store / app website),
never a prompt or chat.

## Open it

No dependencies, no build step. Just open the file:

```bash
open variant-lab/index.html        # macOS
# or serve it
python3 -m http.server 8080        # then visit http://localhost:8080/variant-lab/
```

Designed to look polished at **1536×1024**, and degrades gracefully down to mobile.

## Switching variants

Use the **A / B / C** pill selector in the top bar, or press the **A**, **B**, or **C**
key on the keyboard.

## The three variants

Each variant shows the **whole product sequence at a glance** — URL import →
proof review/extraction → set up Image Ads + UGC Videos → review drafts → QA/export —
and surfaces the credit estimate plus the **provider mutations 0** guarantee.

| | Variant | Feel |
|---|---|---|
| **A** | **Stark Intake** | Grok-style black canvas, huge type, a single big URL pill as the hero, a horizontal 5-step flow, and a compact proof-readiness + output-setup pair. Minimal chrome. |
| **B** | **Proof Cockpit** | Proof-first operations layout: left step rail, a URL **scan/readiness ring** + extracted proof-object grid as the hero, output config, and a right-side proof/citation rail. |
| **C** | **Review & Export** | Premium creative workspace: drafts gallery (Image Ads + UGC Videos), a sticky draft-detail panel with QA checklist + proof citations, and a QA/export vault (download / share only). |

## Product guardrails reflected in the UI

- **URL-first**, not prompt-first. No chat box as the entry point.
- **Only two output types**: Image Ads and UGC Videos (no Stories/Thumbnails upfront).
- **Proof-backed**: every draft cites a source; unsourced claims are held at QA.
- **Provider mutations 0**: nothing is launched to any ad network. Export = download / share.
- Placeholder apps (FocusHabit, TrailPeak, FitTrack) with neutral, non-fabricated data.

## Files

- `index.html` — markup for all three variants + the shared switcher
- `styles.css` — shared dark design tokens + per-variant scoped styles
- `app.js` — variant switching, source segmented control, live credit estimate,
  step-rail selection, and Variant C draft gallery/detail rendering
