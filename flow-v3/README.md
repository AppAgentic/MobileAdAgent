# Mobile Ad Agent Flow V3

Flow V3 is now app-home-first. The main product is the app memory workspace, not a one-shot generation wizard.

## Core Loop

```text
Add app once -> build proof memory -> create packs -> review/teach system -> next pack gets faster and better
```

## Product Shape

- App Home is the default returning surface.
- Launchpad is only the empty/add-app state.
- Proof Memory stores allowed claims, held claims, proof assets, and gaps.
- Create Pack is progressive disclosure: goal, Image Ads / UGC Videos, quantity.
- Creative Pack review is a job detail inside the app workspace.
- Review feedback creates learning events that improve future packs.

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

- All interactions are local DOM state.
- No network calls are made.
- No ad-network launch controls exist.
- Export actions only update local session state.
- Provider mutations remain zero.
