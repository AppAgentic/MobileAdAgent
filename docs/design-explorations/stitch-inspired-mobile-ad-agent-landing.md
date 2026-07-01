# Stitch-inspired Mobile Ad Agent landing page

## Preview

Static page:

```bash
python3 -m http.server 3118 --bind 0.0.0.0 --directory local-app
# http://127.0.0.1:3118/stitch-landing/index.html
```

## Source reference

Design direction inspired by the current Google Stitch surface and official Google
Stitch launch material: dark AI-native workspace, a large natural-language
composer, a canvas-like generated artifact plane, restrained blue light, rounded
controls, and minimal chrome.

This page borrows the interaction mood and composition logic only. It does not
copy Google branding, copy, logos, or exact layout.

## Translation for Mobile Ad Agent

- The Stitch-style prompt composer becomes a URL-first proof composer.
- The generated design canvas becomes a proof map: app screenshots, verified
  claims, App Memory, and creative outputs.
- The product message is not "design UI from prompts"; it is "turn a real mobile
  app into a proof-backed ad creative engine."
- The system section makes the AI-native layer explicit: humans use the SaaS
  surface, while agents use guarded MCP/API tools to create workspaces, attach
  proof, request creative packs, fetch QA reports, and retrieve manifests.
- Deterministic rails still own proof existence, cost ceilings, QA gates,
  approval state, and provider handoff boundaries.

## Files

- `local-app/stitch-landing/index.html`
- `local-app/stitch-landing/styles.css`
- `local-app/stitch-landing/landing.js`

## Validation

- `node --check local-app/stitch-landing/landing.js`
- `pnpm run smoke:local-app`
- No external network/API references in `local-app/stitch-landing`
- Desktop and mobile screenshots captured with Chrome headless
