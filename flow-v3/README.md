# Mobile Ad Agent Flow V3

Flow V3 is the first-principles UX pass based on the Claude Code critique of V2.

## Product Shape

The prototype is one guided SaaS workflow instead of a variant gallery:

1. Launchpad - paste an App Store, Play Store, or website URL.
2. Proof Review - inspect allowed and held claims before generation.
3. Draft Pack Setup - choose Image Ads, UGC Videos, quantity, and proof-backed angles.
4. Review Drafts - filter and inspect generated draft candidates.
5. QA & Export - export only drafts that passed local QA.

The shell supports multiple apps, but keeps app switching in one persistent strip so the user never has to reconcile duplicate navigation systems.

## Local Preview

From this directory:

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
- Export actions only increment a local session counter.
