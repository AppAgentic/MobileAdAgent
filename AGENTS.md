# Mobile Ad Agent

## Overview

Mobile Ad Agent is an AppAgentic product for generating mobile paid-ad creative from real app proof. It takes app screenshots, App Store metadata, app icons, target audience, creative guidance, and optional agent instructions, then produces paid-ad-ready UGC videos and image ads with auditable proof, QA, and downloadable/exportable source inventory.

The product is intended to be human-usable and agent-native. Claude Code, Codex, Cursor, and similar coding agents should be able to create workspaces, upload proof packs, request creative packs, inspect QA reports, iterate variants, and retrieve outputs through API/MCP.

## Product Boundaries

- Mobile Ad Agent is a creative factory, not an ad buying platform.
- Generated assets remain source inventory until QA and any required approval pass.
- The product may hand off approved assets to paid-ad inboxes or customer exports through explicit integration rails, but it must not mutate ad-network spend directly.
- Real app proof matters. Do not invent UI, fake values, unsupported claims, or fabricated app screens.

## Initial Stack Direction

- **Business**: AppAgentic
- **Control plane**: Next.js on Firebase App Hosting
- **Auth/state**: Firebase Auth + Firestore
- **Asset lake**: Cloudflare R2
- **Agent surface**: hosted API + remote MCP over Streamable HTTP
- **Render backend**: swappable render abstraction
  - V1 candidate: HeyGen HyperFrames Cloud
  - Portable self-host candidate: HyperFrames on GCP Cloud Run + Workflows
  - Benchmark/fallback: Remotion Lambda / custom Cloud Run render workers
- **Workers**: Cloud Run services/jobs or equivalent container workers for heavy generation, HyperFrames render/editing, media normalization/validation (`ffmpeg`/`ffprobe` only as utilities), OCR, and multimodal QA

## Core Workflow

1. App intake from screenshots, App Store URL, icon, product facts, audience, and creative guidance.
2. Proof ingestion and classification.
3. Proof object extraction from screenshots or recordings.
4. Creative planning for UGC video ads and image ads.
5. Script, caption, thumbnail, CTA, and image/layout generation.
6. Deterministic render using proof-backed assets.
7. OCR, visual, duration, codec, claim, and proof-fidelity QA.
8. Repair/iterate when QA holds.
9. Package outputs, manifests, and QA reports for download, MCP/API retrieval, or downstream paid-ad inbox handoff.

## Agent Stages

- Creative Director Agent
- Proof Agent
- Script Agent
- Render Planner
- Render Worker
- QA Agent
- Handoff Agent

Each stage should emit structured state and audit data. Intelligence is allowed to propose, repair, rank, and critique. Deterministic rails own storage, billing, proof existence, cost ceilings, render settings, artifact paths, approval gates, and provider handoffs.

## Commands

The repository now includes a zero-dependency local control-plane prototype plus the
renderer benchmark scripts.

```bash
# Development
pnpm run local:app

# Local workflow smoke test
pnpm run smoke:local-app

# Creative job rail tests (graph, adapters, runner, QA, drafts)
pnpm run test:hook-agent   # real writer -> isolated blind readers -> critic contract
pnpm run test:jobs
pnpm run test:render-contract   # finishing/composition backend contract
pnpm run test:manifest          # job manifest schema + readiness/hold semantics

# Generation canary (dry-run is safe everywhere; --live needs vault access)
pnpm run canary:generation        # mock adapters + live-refusal checks
pnpm run canary:generation:live   # one real image ad + one UGC hook ad

# Renderer benchmarks
pnpm run benchmark:local-renderers
pnpm run render:hyperframes-pepmod-ugc-copy
pnpm run render:hyperframes-adrenderer-copy
```

### Generation rail (production-shaped)

The browser/control plane never calls generation providers. All generation
runs through the creative job graph (`lib/creative-job-model.mjs`): idempotent
task IDs, task state, cost plan, QA reports, drafts, and a job manifest that a
hosted worker persists to Firestore/R2.

- `lib/generation-adapters.mjs` — neutral capability adapters
  (`image_ad`, `ugc_creator_block`, `finishing_compositor`). Mock by default;
  live modes require `MAA_LIVE_ADAPTERS_ENABLED=1` plus an injected worker
  runtime (`secretResolver`, `assetStore`, `workDir`) and refuse otherwise.
- `lib/hook-agent.mjs` + `lib/hook-agent-adapter.mjs` — provider-neutral,
  pre-media Hook Agent. One bounded UGC pack requests exactly eight original
  candidates, reads each spoken hook in a separate context with no app,
  caption, evidence, or peer candidates, then runs an independent evidence
  critic. The selected-or-held plan, complete pool/reasons, source/request
  fingerprints, call usage, and plan hash are persisted under one stable key.
  Retries read that object before calling intelligence again.
- `lib/live-generation.mjs` + `lib/providers/gemini-media.mjs` — live source
  generation (image ad canvases, creator clips). Providers create source
  layers only; they are forbidden from rendering app UI or factual text.
- `lib/render-backend.mjs` — the finishing/composition backend contract.
  Finishing owns real screenshot proof, captions, CTA, and packaging. Local
  backend composites images in-process and renders video through the
  HTML-composition renderer CLI; the hosted backend is a swappable scaffold.
  QA probes media with pure-Node parsers (`lib/media-probe.mjs`) — never
  ffmpeg/ffprobe.
- `lib/asset-store.mjs` — R2-shaped asset lake (tenant-scoped storage keys);
  the local adapter maps keys onto a directory.
- Image ads and UGC ads are both two-stage: source generation → finishing.
  UGC routes: `creator_narrated` (3 creator blocks) and `hook_proof_sequence`
  (1 creator hook + real-screenshot proof sequence; cheapest truthful route).
- UGC packs are capped at six drafts sharing one eight-candidate pool. Larger
  workloads scale horizontally as multiple idempotent packs instead of one
  oversized Firestore job document. Store-backed task leases prevent two
  workers from executing the same job task concurrently; expired leases use
  bounded retries.
- Counters: `providerMutations` stays 0 (no ad-network/publishing calls);
  live generation is tracked separately as `generationProviderCalls`.

The local app defaults to `http://127.0.0.1:3107` and models the first product workflow
without external providers: app intake, proof library, credit-gated mock generation,
Review Drafts decisions with learning events, QA & Export with readiness holds, Billing
(Launch/Scale/Studio + subscriber top-ups), and pack export. The marketing/pricing page
is served at `/landing/`. It must keep `providerMutations: 0`.

Copy rule (enforced by the smoke test): backend provider/model names must never appear in
customer-facing UI or `/api` payloads. Customer terms are image ads, UGC ads, app info,
app profile, screenshots, credits, packs, export. There is no free generation path:
generation always costs credits, and top-ups are subscriber-only.
The browser must never turn a server/job failure into fixed-copy local drafts;
missing persisted drafts are a failed/held run, not a successful fallback.

## Environment Variables

Do not commit secrets, API keys, tokens, cookies, service-account JSON, or signed URLs. Store credentials in the appropriate AppAgentic vault/Secret Manager path and reference them through runtime configuration.

Expected future categories:

- Firebase public web config
- Firebase Admin runtime identity
- R2 bucket/account credentials
- HyperFrames/HeyGen API key
- Model provider keys
- Webhook signing secrets
- API/MCP auth secrets

## Research Notes

See `docs/plans/mobile-ad-agent-architecture.md` for the initial architecture decisions from the launch planning thread.
