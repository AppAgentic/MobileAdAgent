# Local Renderer Benchmark Plan

## Goal

Test HyperFrames locally beside the existing AdAgentic Remotion UGC/render system without touching live ad automation or provider launch paths.

The benchmark should answer:

- Can HyperFrames produce the same kind of 9:16 proof-driven mobile UGC ads locally?
- Is the agent-editing loop better than Remotion for app-proof compositions?
- Do the outputs pass the same paid-ad QA checks?
- What should become the default Mobile Ad Agent render backend?

## Current Local Baseline

AdAgentic already has a local Remotion renderer:

- Remotion entry point: `/Users/missioncontrol/Documents/App-Agentic/AdAgentic/src/remotion/index.tsx`
- Main composition: `AdRenderer`
- Existing render scripts include:
  - `scripts/render-gymstreak-ad.ts`
  - `scripts/render-gymlevels-seedance-adrenderer.ts`
  - `scripts/render-caption-overlay.ts`
  - `src/tools/creative/compose-hook-demo.ts`
  - `src/tools/creative/execute-edl.ts`

Local prerequisites already observed:

- Node `v24.14.0`
- npm `11.9.0`
- pnpm `10.33.1`
- FFmpeg `8.1`

HyperFrames latest package observed on npm:

- `hyperframes@0.7.3`
- `@hyperframes/producer@0.7.3`

Do not depend on transient `npx` cold installs for routine testing. Pin package versions in the repo once the harness is created.

## Safety Boundary

This benchmark is generation-only.

- Do not queue `create_ad`.
- Do not write to live `sourced_creatives`.
- Do not mutate Meta, TikTok, Google Ads, or any provider.
- Write outputs under local benchmark artifacts first.
- Keep manifests explicit with `provider_mutations: 0`.

## Shared Input Spec

Use one neutral JSON spec that both renderers consume:

```json
{
  "jobId": "local-benchmark-001",
  "app": {
    "name": "Example App",
    "iconPath": "assets/app-icon.png",
    "brandColors": ["#111111", "#f5f5f5"]
  },
  "creative": {
    "format": "ugc_video_ad",
    "aspectRatio": "9:16",
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "durationSeconds": 15,
    "hook": "Stop tracking this in Notes",
    "cta": "Download the app",
    "proofCaption": "Real app proof",
    "voiceoverText": "Stop tracking this in Notes. This app keeps everything organized."
  },
  "proof": {
    "screenshots": ["assets/screenshots/main.png"],
    "proofObjects": ["assets/proof/ranking-card.png"]
  },
  "render": {
    "musicPath": null,
    "safeArea": "paid-social-9x16",
    "thumbnailFirstFrameDurationMs": 200
  }
}
```

## Benchmark Outputs

For each renderer, write:

```text
artifacts/local-render-benchmark/{jobId}/{renderer}/manifest.json
artifacts/local-render-benchmark/{jobId}/{renderer}/output.mp4
artifacts/local-render-benchmark/{jobId}/{renderer}/first-frame.png
artifacts/local-render-benchmark/{jobId}/{renderer}/contact-sheet.jpg
artifacts/local-render-benchmark/{jobId}/{renderer}/qa-report.json
```

Manifest fields:

- renderer ID and version
- command/backend used
- input spec path
- output path
- dimensions
- duration
- fps
- file size
- elapsed render time
- local cost estimate if relevant
- proof asset paths
- QA verdict
- `provider_mutations: 0`

## HyperFrames Local Path

Use the CLI for initial smoke tests:

```bash
npx hyperframes doctor
npx hyperframes preview
npx hyperframes inspect
npx hyperframes render --output artifacts/local-render-benchmark/local-benchmark-001/hyperframes/output.mp4
```

Use `@hyperframes/producer` for the durable harness:

```bash
npm install --save-dev hyperframes@0.7.3 @hyperframes/producer@0.7.3
```

The harness should generate an HTML composition from the shared JSON spec, then render locally.

## Remotion Local Path

Use existing AdAgentic Remotion `AdRenderer` as the baseline.

The harness should either:

1. adapt the shared JSON spec into `AdRendererProps`, or
2. call the existing `creative.compose_hook_demo` / render helper path with a mock-safe local input.

The output should land beside the HyperFrames output with the same manifest/QA structure.

## QA Comparison

Run the same checks for both renderers:

- `ffprobe` dimensions, duration, fps, codec, bitrate, and file size
- first-frame thumbnail extraction
- contact sheet generation
- OCR for hook, proof caption, CTA, and app name
- visual safe-area check
- proof screenshot/crop visibility check
- no fake app UI
- no text overflow or illegible thumbnail/captions

HyperFrames also has `inspect`; include its findings in the QA report.

## Evaluation Criteria

Score each renderer on:

- local setup friction
- render time
- file size
- output fidelity
- caption/text control
- proof object control
- ease for Codex/Claude to edit
- preview/debug loop
- QA pass rate
- portability to hosted cloud render
- expected self-host cost

## Recommendation If Benchmark Passes

If HyperFrames can match or beat Remotion on proof-driven 9:16 UGC output:

- Use HyperFrames as Mobile Ad Agent's default HTML-native composition renderer.
- Keep Remotion as fallback for existing AdAgentic formats and mature Lambda scaling.
- Keep both behind `RenderBackend`.

If HyperFrames fails on local fidelity, speed, or reliability:

- Keep Remotion as default.
- Use HyperFrames only for agent-authored prototype/composition experiments until the issues are fixed.
