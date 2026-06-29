# Mobile Ad Agent Flow V3

Flow V3 is app-home-first and built around a single **App Memory** concept plus a **Review Console**. The product is the memory + review workspace, not a one-shot generation wizard.

## Core Loop

```text
Import app (confirm truth) -> build App Memory -> create packs -> review/approve -> memory diff -> next pack gets faster and better
```

## Product Shape

- **App Home** is the default returning surface. It leads with an app-readiness checklist: Import app, Confirm proof, Create first pack, Review, Export.
- **Launchpad / import** is the empty/add-app state. It is a 3-step truth import: paste URL -> extract store listing / screenshots / reviews -> confirm what is true. Only confirmed items become memory.
- **App Memory** is one top-level concept with four subtype sections (tabs): **Proof**, **Claims**, **Style**, **Learnings**. Learnings includes a "What changed in memory" diff log.
- **Create Pack** is progressive disclosure: goal, Image Ads / UGC Videos, quantity.
- **Review Console** shows each draft with *why it was made* and *proof cited*, and PR-style **Approve / Tweak / Reject** actions. Tweak and Reject use reason chips.
- Every review decision writes a visible memory diff and a learning event that improves future packs.

## Vocabulary

Earlier versions exposed Proof, Packs, and Learnings as separate top-level areas. V3 collapses them: there is one **App Memory** (with Proof / Claims / Style / Learnings sections), plus Home and Review.

## Mobile

The Review Console is the mobile priority: on small screens the review/approval panel is emphasised and stays legible, large type scales down, and the memory tabs and checklist stack cleanly.

## Visual Direction

The visual treatment uses the public xAI/Grok surface at `https://x.ai/` as mood inspiration only: stark black canvas, large type, white primary actions, thin-line chrome, and restrained spectral accents. It does not copy xAI logos, copy, claims, or exact layouts.

## Local Preview

From the project checkout:

```bash
python3 -m http.server 3116 --bind 0.0.0.0 --directory flow-v3
```

Then open:

```text
http://127.0.0.1:3116/
```

## Prototype Boundaries

- All interactions are local DOM state only.
- No network calls (no fetch/XHR), and no localStorage/sessionStorage.
- No ad-network launch or spend controls exist. Outputs are limited to Image Ads and UGC Videos.
- Import extraction is simulated locally; nothing leaves the browser.
- Export actions only update local session state.
- Provider mutations remain zero.
