# Mobile Ad Agent Architecture Plan

## Purpose

Mobile Ad Agent gives app teams and their agents the ad-creative factory patterns that we use internally: proof-driven UGC videos, image ads, app screenshot extraction, creative QA, and paid-ad source packaging.

The product is intentionally focused on paid creative production. Performance analysis, budget scaling, and ad-network mutation can happen in other systems or downstream agent workflows.

## Product Positioning

Mobile Ad Agent is an agent-native creative factory:

- Humans can use a web UI to create apps, upload assets, review jobs, and download/export packs.
- Coding agents can use API/MCP to create workspaces, upload proof packs, run creative jobs, inspect QA reports, and retrieve outputs.
- Output is paid-ad-ready creative source inventory: MP4 videos, PNG/JPG image ads, thumbnails, manifests, QA reports, and platform notes.

## Non-Goals

- Do not directly manage live ad-network spend.
- Do not become a campaign optimizer in v1.
- Do not invent app UI, fake screenshots, fake product values, or unsupported claims.
- Do not make the web app perform heavy render/ffmpeg/OCR/model work.

## Architecture Overview

### Control Plane

- Next.js on Firebase App Hosting.
- Firebase Auth for users, teams, roles, and API-key ownership.
- Firestore for canonical structured state.

Core collections:

- `organizations`
- `workspaces`
- `apps`
- `appIntakes`
- `assets`
- `proofObjects`
- `creativeJobs`
- `creativeBriefs`
- `renderTasks`
- `qaReports`
- `creativePacks`
- `handoffs`
- `costLedger`
- `auditEvents`

### Asset Lake

Cloudflare R2 stores all binary artifacts:

- raw screenshots
- app icons
- store screenshots
- screen recordings
- extracted proof objects
- generated frames
- HTML composition zips
- rendered videos
- image ads
- thumbnails
- QA contact sheets
- manifests and export bundles

Firestore stores stable object keys and metadata. Do not store signed URLs as canonical state.

Suggested object key shape:

```text
orgs/{orgId}/apps/{appId}/jobs/{jobId}/raw/{assetId}.{ext}
orgs/{orgId}/apps/{appId}/jobs/{jobId}/proof/{proofObjectId}.png
orgs/{orgId}/apps/{appId}/jobs/{jobId}/renders/{taskId}/composition.zip
orgs/{orgId}/apps/{appId}/jobs/{jobId}/renders/{taskId}/output.mp4
orgs/{orgId}/apps/{appId}/jobs/{jobId}/qa/{qaReportId}/contact-sheet.jpg
orgs/{orgId}/apps/{appId}/packs/{packId}/export.zip
```

### Agent Surface

Expose a hosted API and remote MCP surface.

Initial MCP tools:

- `create_workspace`
- `create_app`
- `bootstrap_app_from_store_url`
- `upload_screenshot_pack`
- `upload_asset`
- `extract_proof_objects`
- `generate_creative_pack`
- `get_job_status`
- `get_qa_report`
- `iterate_creative`
- `download_creative_pack`
- `create_handoff`

Initial REST endpoints should mirror these workflows and publish an OpenAPI spec.

Agent access should support:

- API keys scoped to organization/workspace/app
- rate limits
- cost caps
- audit logs
- revocation
- webhooks/callback URLs for job completion

## Workflow

1. `intake.created`
   - app URL, screenshots, icon, audience, platform, creative guidance, and constraints.

2. `proof.ingested`
   - classify raw screenshots vs App Store stylized screenshots vs recordings.
   - store metadata, dimensions, OCR text, source, and trust level.

3. `proof.objects.extracted`
   - crop or isolate proof objects such as ranking cards, score boxes, charts, calculators, progress states, and result panels.
   - preserve real pixels where truth matters.
   - generated/rawified assets must carry provenance.

4. `creative.briefed`
   - generate target angles, scripts, visual proof needs, format plan, image/video mix, and acceptance criteria.

5. `render.planned`
   - choose render backend and write an exact render spec.
   - include duration, dimensions, fps, codec target, input proof IDs, captions, CTA, app icon, thumbnail frame, and output keys.

6. `render.executed`
   - produce MP4/image outputs.
   - write manifest with backend, cost, runtime, dimensions, duration, file size, and artifact keys.

7. `qa.completed`
   - OCR checks, visual checks, proof fidelity, app claim checks, codec/platform validation, legibility, safe areas, duration, and file size.
   - pass, hold, or retry with structured reasons.

8. `packaged`
   - create downloadable creative pack and optional downstream handoff.

## Render Backend Abstraction

Render backends must share a common contract:

```ts
type RenderBackend = {
  id: string;
  maxConcurrentJobs: number;
  estimateCost(input: RenderTaskInput): Promise<CostEstimate>;
  submit(input: RenderTaskInput): Promise<RenderSubmission>;
  getStatus(taskId: string): Promise<RenderStatus>;
  cancel(taskId: string): Promise<void>;
};
```

Required render metadata:

- backend ID and version
- composition source key
- input asset keys and proof IDs
- dimensions, fps, duration, format, codec target
- submit time, start time, finish time
- cost estimate and actual cost where available
- output object keys
- error/hold state

### HyperFrames Cloud

Use HeyGen HyperFrames Cloud for the fastest v1 path.

Known defaults from research:

- 1080p/30fps cost is approximately `$0.10` per output minute.
- A 30s 1080p/30 ad is approximately `$0.05`.
- Pay-as-you-go published concurrency is `10` concurrent video jobs.
- Use idempotency keys and queue/backoff on `429` + `Retry-After`.

Keep the generated HTML/CSS/JS composition and all assets in our own R2 state so outputs are portable.

### HyperFrames Self-Hosted GCP

Use HyperFrames on GCP Cloud Run + Workflows when scale/margins justify it.

Reasons to keep this first-class:

- AppAgentic/GCP alignment.
- Lower expected per-render cost at volume if renders are efficient.
- More control over concurrency, retries, artifact paths, and worker versions.

### Remotion

Keep Remotion as a mature benchmark/fallback.

- Remotion Lambda is the strongest official scale path.
- Remotion Cloud Run package is alpha/not actively developed, so avoid it as the core GCP path.
- Custom Remotion Docker workers on Cloud Run remain a fallback if a format is better represented in React/Remotion.

### Cloudflare Containers

Prototype only until proven.

Cloudflare Agents/R2/Workflows/Queues are useful around orchestration and assets, but heavy render should not depend on Cloudflare Containers until benchmarked with production controls for auth, queueing, rate limits, progress, and error propagation.

## Intelligence Boundaries

Use intelligence for:

- creative strategy
- script variants
- proof object suggestions
- layout critiques
- QA reasoning
- repair plans
- keyword/audience adaptation

Use deterministic rails for:

- storage keys
- proof existence
- cost caps
- rate limits
- render dimensions/codecs
- approval gates
- secrets
- provider handoff boundaries

## QA Rules

Every creative must have:

- dimensions verified
- duration verified
- file size verified
- codec/container verified
- OCR text checked for key caption/CTA/claim
- app screenshot/proof fidelity checked
- unsupported claim check
- app icon/CTA presence where required
- platform-safe-area check
- `provider_mutations: 0` for generation-only jobs

QA outputs:

- `qaReport.json`
- contact sheet
- first-frame thumbnail preview
- final artifact metadata
- pass/hold/retry verdict

## App Store URL Bootstrap

Bootstrap can fetch:

- app name
- subtitle/description
- icon
- App Store screenshots
- category/ratings metadata where available

But App Store screenshots may be stylized. The system must classify them:

- raw enough to use as proof
- stylized but rawifiable
- marketing collage/mockup that should not be treated as proof
- insufficient, requiring raw screenshots or simulator/customer upload

## Simulator And Screenshot Capture

Cloud Linux/Cloudflare workers cannot run iOS Simulator. Options:

- customer/agent local capture uploaded through API/MCP
- macOS runner pool for managed capture
- App Store screenshot bootstrap with rawification and proof limits
- Android emulator capture as a separate Linux-heavy path

## Benchmark Plan

Benchmark identical 9:16 proof-driven ads across:

- HyperFrames Cloud
- HyperFrames local CLI/producer
- HyperFrames GCP Cloud Run
- Remotion Lambda
- AdAgentic local Remotion `AdRenderer`
- custom Cloud Run Docker renderer

Inputs:

- 15s ad
- 30s ad
- 45s ad
- captions
- app screenshots
- proof objects
- app icon CTA
- audio or silent mode
- first-frame thumbnail pre-bake

Measurements:

- cold-start time
- p50/p95 render time
- cost per render
- failure rate
- retry behavior
- concurrency behavior
- visual fidelity
- OCR/QA pass rate
- file size and codec acceptance
- agent editability/success rate

See `docs/plans/local-renderer-benchmark.md` for the local side-by-side harness plan.

## Open Decisions

- Exact first app scaffold template.
- Whether hosted HyperFrames Cloud is enough for first paid beta.
- Whether to provision Firebase/R2 immediately or after the first UI/API scaffold.
- First customer-facing export format.
- First MCP authentication flow.

## Current Decision Log

- Mobile Ad Agent is AppAgentic-owned.
- Focus on paid creative factory only.
- Support both UGC video and image ads.
- Use proof objects and real app screenshots as a core moat.
- Include app icon in standard CTA packs.
- Treat App Store URL bootstrap as useful intake, not proof by default.
- Build a swappable render backend.
- Make HyperFrames a first-class render candidate and likely v1 render backend.
- Keep Remotion as a mature benchmark/fallback.
- Use Cloudflare R2 as asset lake.
- Use Firebase/App Hosting/Auth/Firestore for the product control plane.
- Use API/MCP as a first-class agent surface.
