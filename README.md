# Mobile Ad Agent

Agent-native mobile paid-ad creative factory for generating UGC ads and image ads.

Mobile Ad Agent is an AppAgentic product. It is scoped as a creative factory, not an ad-buying system: ingest app proof, generate creative variants, QA them, and export approved paid-ad source inventory.

The initial planning spine lives in:

- `AGENTS.md`
- `docs/plans/mobile-ad-agent-architecture.md`
- `docs/plans/heygen-hosted-product-plan.md`
- `docs/plans/local-renderer-benchmark.md`

## Local Prototype

Run the local control-plane prototype:

```bash
pnpm run local:app
```

Then open the public marketing route:

```text
http://127.0.0.1:3107
```

This first local version is intentionally provider-safe. It uses a tiny Node server and
browser UI to test the product workflow without requiring Firebase, R2, render/generation
providers, or ad-network mutations. The prototype covers URL intake, automatic
screen/claim selection, a simple Review App Info step, paid credit-gated generation
(image ads 4 credits, UGC ads 60), Review Drafts with approve/reject/tweak/regenerate,
learning events that shape the next pack, QA & Export with readiness holds and a
downloadable pack manifest, and Billing with Launch/Scale/Studio plans plus
subscriber-only top-ups.

The production-shaped local paths are:

```text
/                    public marketing homepage
/pricing             public pricing section
/launch-pack         public Same-Day Launch Pack offer
/preview             pre-auth app URL preview/import
/app                 authenticated dashboard shell
/login               sign-in entry
/signup              sign-up entry
```

The old prototype paths such as `/landing/`, `/dashboard`, and root query-string
handoffs are intentionally not supported.

For local review of the seeded demo workspace, use the explicit dev-only route:

```text
http://127.0.0.1:3107/app?dev=1&workspace=demo
```

See `docs/plans/mobile-ad-agent-local-implementation-map.md` for how the robust-plan
architecture objects map onto this prototype.

URL intake always uses the configured app-info extraction model to generate the app
summary and key-feature list after deterministic store/screenshot extraction. Keep the
runtime key in the existing vault/secret-manager path and expose it only to the server
process. Do not commit a local `.env` file with this value.

Run the local workflow smoke test:

```bash
pnpm run smoke:local-app
```

## Firebase Readiness

Firebase App Hosting is the selected web runtime. The live backend is:

```text
https://mobileadagent-web--mobileadagent.us-central1.hosted.app
```

App Hosting runs the Node prototype through `apphosting.yaml` with Firestore tenant
storage and Firebase Auth verification enabled on authenticated tenant endpoints.
Use `pnpm run build:apphosting` for the local App Hosting build sanity check before a
new hosted build/rollout.

The local server defaults to the in-memory tenant store. To exercise the Firebase-shaped
backend, run with:

```bash
MAA_TENANT_BACKEND=firestore MAA_AUTH_MODE=firebase pnpm run local:app
```

In Firestore mode, tenant endpoints require a verified Firebase Auth bearer token and
write through the Admin SDK. Anonymous app previews remain pre-auth and limited to
allowed App Store / Google Play URLs with cache, rate, cost, and kill-switch guardrails.

Useful checks:

```bash
pnpm run build:apphosting
pnpm run check:firebase-readiness
pnpm run test:tenant
pnpm run test:firestore-rules
pnpm run test:firestore-rules:emulator
pnpm run test:hook-agent
pnpm run test:jobs
pnpm run test:render-contract
pnpm run test:manifest
pnpm run canary:generation
```

`test:hook-agent` executes the real structured Hook Agent loop: exactly eight
writer candidates, eight isolated spoken-hook cold reads, an independent evidence
critic, strict source/request fingerprints, bounded usage, held-plan persistence,
and read-before-generate crash recovery. `test:jobs`, `test:render-contract`, and `test:manifest` cover the production-shaped
creative job rail (job graph, adapter contracts, finishing/composition backend, manifest
schema, transactional task leases, failed-planning media gates, provider-name leak
guard). A UGC pack is capped at six distinct drafts from one shared eight-candidate
pool; throughput scales across many queued packs. `canary:generation` is a safe dry-run;
`canary:generation:live` performs the approved one-image + one-UGC generation canary and
requires local vault access. See `AGENTS.md` → "Generation rail" for the architecture.

`check:firebase-readiness` is read-only and reports live Firebase project gaps without
printing secret values. The emulator check requires Firebase Tools plus JDK 21 or newer.
Do not commit Firebase Admin private keys or local `.env` files; use AppAgentic runtime
identity or vault-backed runtime configuration. The npm script will use a compatible
Homebrew JDK 21 when one is installed locally.

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
