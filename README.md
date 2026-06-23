# Mobile Ad Agent

Agent-native mobile paid-ad creative factory for generating proof-driven UGC videos and image ads.

Mobile Ad Agent is an AppAgentic product. It is scoped as a creative factory, not an ad-buying system: ingest app proof, generate creative variants, QA them, and export approved paid-ad source inventory.

The initial planning spine lives in:

- `AGENTS.md`
- `docs/plans/mobile-ad-agent-architecture.md`
- `docs/plans/heygen-hosted-product-plan.md`
- `docs/plans/local-renderer-benchmark.md`

## Local Renderer Benchmark

Run the generation-only local benchmark:

```bash
PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --ignore-scripts
pnpm run benchmark:local-renderers
```

The harness writes reproducible fixture assets, renderer manifests, MP4s, first frames, contact sheets, QA reports, and the combined report under `artifacts/local-render-benchmark/local-benchmark-001/`. It compares a HyperFrames local render against the sibling AdAgentic Remotion `AdRenderer` baseline without touching live ad automation, `sourced_creatives`, or provider launch paths. HyperFrames lint errors now hold the run, and fixture videos are generated with dense keyframes so browser-frame rendering is not penalized by sparse source media.

To test HyperFrames as a direct replacement backend for a real prior AdRenderer UGC ad:

```bash
pnpm run render:hyperframes-adrenderer-copy
```

That script reads the last manifest-backed GymLevels Seedance AdRenderer input from the sibling AdAgentic project, adapts the same base video, text layers, overlays, jump cuts, dimensions, and timing into a HyperFrames/GSAP composition, then writes the MP4, original-vs-HyperFrames comparison sheet, lint report, and render report under `artifacts/adrenderer-hyperframes-copy/gymlevels-seedance-adrenderer-v2/`.

To test the PepMod-style UGC ad finishing path specifically:

```bash
pnpm run render:hyperframes-pepmod-ugc-copy
```

That script targets the June 22 PepMod peptide-log UGC short. It keeps the generated creator/b-roll/proof-cutaway video and audio from `final_broll.mp4`, then replaces the Remotion `AdRenderer` hook/CTA caption finishing layer with a HyperFrames/GSAP composition using the same timing, text, 1080x1920 output shape, and caption styling defaults from `scripts/render-caption-overlay.ts`. Artifacts are written under `artifacts/pepmod-ugc-hyperframes-copy/pepmod-peptide-log-app-ugc-short-20260622/`.
