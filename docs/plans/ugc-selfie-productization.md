# UGC Selfie Production Product Plan

Date: 2026-07-02
Updated: 2026-07-03 for production-first build direction.

## Reference Output

The first strong reference is the GymLevels V6 fresh-script sample:

- creator hook
- real Muscle Rankings proof cutaway with continuous voiceover
- creator reaction
- casual spoken/caption reveal: "It's called GymLevels"

The important lesson is not that Gemini Omni can make a full ad. The important lesson is
that the ad worked because it had a beat grammar, a real proof slot, and a locked script
timeline before generation.

Mobile Ad Agent should productize that grammar as a repeatable workflow:

`App Memory -> Recipe -> Script -> Provider Blocks -> Render Manifest -> QA -> Review -> Learning`

## Production-First Direction

Joe's latest direction is to stop thinking of this as an MVP experiment and build toward the
full production product now. The first shipped lane can still be narrow, but it should sit
inside the real product architecture instead of a throwaway prototype.

Production from the start means:

- organizations, workspaces, apps, users, roles, and API keys
- durable App Memory with Proof, Claims, Style, and Learnings
- Recipe Library as a first-class concept, even if only one or two recipes are active at
  launch
- versioned prompt/skill/rubric files stamped on every generated artifact
- typed job/task graph for import, proof extraction, scripting, provider generation,
  rendering, QA, packaging, review, learning, and export
- Cloudflare R2 as the canonical creative asset lake
- cost ledger and credit accounting on every job
- manifest-backed outputs with proof IDs, claim IDs, provider route, dimensions, duration,
  captions, and QA verdicts
- Review console that can approve, reject, tweak, regenerate one failed block, and write
  Learning Events
- API and MCP surface that use the same objects as the web UI
- export/handoff rails for downloads, share links, source inventory, and later paid-ad
  inboxes

The implementation principle changes from "delay all abstractions" to "build the final
objects, but activate the smallest useful number of routes." That keeps the product
ambitious without making the first production run chaotic.

## Productized Core Loop

1. User adds an app URL.
2. The system builds App Memory from store metadata, screenshots, uploaded proof, and
   verified claims.
3. Store/listing screenshots are classified as raw-enough, rawifiable, or unusable. If a
   listing screenshot is rawifiable, rawification happens before UI extraction.
4. UI extraction turns rawified candidates, uploaded raw screenshots, captured app
   screenshots, and recordings into screen-level UI objects with OCR, semantic type, crop
   bounds, trust level, and candidate claims.
5. The user confirms which claims and proof objects are real, or approves a rawified proof
   candidate after preservation QA.
6. The system recommends a Recipe, such as `ugc_selfie_proof_reveal`.
7. The Script Agent writes beat-locked dialogue against the selected recipe and proof.
8. Provider generation creates only the creator-performance blocks.
9. Deterministic assembly inserts real proof, captions, trims, and audio timing.
10. QA verifies transcript, claims, proof, dimensions, silence, visual quality, and cost.
11. Review decisions write structured Learnings back into App Memory.

The AI can plan and perform. It cannot invent proof, skip claim checks, or spend provider
budget outside the job layer.

## Core Objects

### `AppMemory`

Durable source of truth per app:

- store metadata
- product category
- audience/tension
- extracted UI objects
- proof assets
- verified/forbidden claims
- style profile
- app/category/global learnings

### `Claim`

```ts
type Claim = {
  id: string;
  text: string;
  status: 'verified' | 'unverified' | 'forbidden';
  evidenceRefs: string[];
  riskTags: string[];
};
```

Scripts may only voice verified claims.

### `ProofAsset`

```ts
type ProofAsset = {
  id: string;
  type:
    | 'ranking'
    | 'surprising_stat'
    | 'progress_delta'
    | 'generated_output'
    | 'speed_demo'
    | 'streak'
    | 'dashboard'
    | 'checklist'
    | 'scan_result';
  source: 'store_metadata' | 'user_upload' | 'captured_app' | 'internal_fixture';
  trustLevel: 'raw_proof' | 'store_art' | 'rawified' | 'unusable';
  semanticTags: string[];
  claimRefs: string[];
  assetKey: string;
  hash: string;
  cropSpecs?: Record<string, unknown>;
};
```

Generated providers cannot write directly to the proof store.

### `UiObject`

The stage Joe called out from the earlier architecture: rawified/user-uploaded/captured
screenshots and recordings become UI objects before they become approved proof.

```ts
type UiObject = {
  id: string;
  sourceAssetId: string;
  sourceProofAssetId?: string;
  kind:
    | 'full_screen'
    | 'ranking_card'
    | 'stat_card'
    | 'chart'
    | 'dashboard'
    | 'list'
    | 'result_panel'
    | 'calculator'
    | 'progress'
    | 'paywall'
    | 'onboarding'
    | 'unknown';
  sourceTrustLevel: 'raw_proof' | 'store_art' | 'rawified' | 'unusable';
  boundingBox: { x: number; y: number; width: number; height: number };
  ocrText: string[];
  semanticTags: string[];
  claimCandidateRefs: string[];
  legibilityScore: number;
};
```

UI extraction is not rawification. UI extraction identifies what real product UI is visible.
For stylized App Store / Play Store listing art, rawification happens before UI extraction:
the source screenshot is classified as rawifiable, transformed into a raw-looking app
screenshot candidate, then UI extraction runs on that generated candidate. Crop-only
previews of listing art are not rawification and cannot unlock proof-led generation.

### `Recipe`

The missing reusable object. A Recipe is the portable creative grammar.

```ts
type Recipe = {
  id: string;
  name: string;
  family: 'ugc_selfie';
  requiredProofTypes: ProofAsset['type'][];
  emotionArcs: string[];
  beats: RecipeBeat[];
  constraints: {
    brandRevealPolicy: 'end_only' | 'payload_allowed' | 'anywhere';
    allowCtaCard: boolean;
    captionStyle: 'native_white_no_box';
    proofMustBeDeterministic: boolean;
  };
};

type RecipeBeat = {
  id: string;
  slot: 'creator' | 'proof' | 'creator_reaction' | 'reveal';
  durationMs: { min: number; target: number; max: number };
  source: 'provider_generated' | 'deterministic';
  dialogueRules: {
    brandNameAllowed: boolean;
    claimRequired: boolean;
    proofRequired: boolean;
    asrRiskCheck: boolean;
  };
};
```

V6 becomes Recipe #1:

`ugc_selfie_proof_reveal`

- hook: creator, brand forbidden
- proof: deterministic real app proof, continuous VO
- reaction: creator, personal/emotional response
- reveal: creator, brand allowed, casual app name only

### `Script`

Beat-locked dialogue. Once generation starts, the script is immutable for that attempt.

```ts
type Script = {
  id: string;
  recipeId: string;
  appMemorySnapshotId: string;
  beats: Array<{
    beatId: string;
    startMs: number;
    endMs: number;
    dialogue: string;
    claimRefs: string[];
    proofAssetRefs: string[];
  }>;
};
```

### `RenderManifest`

The deterministic assembly contract and the main review diff unit.

```ts
type RenderManifest = {
  id: string;
  scriptId: string;
  providerMutations: 0;
  output: { width: number; height: number; fps: number; durationMs: number };
  timeline: Array<{
    startMs: number;
    endMs: number;
    visualSource: 'creator_clip' | 'proof_asset' | 'caption';
    assetRef: string;
    audioSource?: string;
    trim?: { inMs: number; outMs: number };
  }>;
  captions: Array<{
    text: string;
    startMs: number;
    endMs: number;
    style: 'native_white_no_box';
  }>;
  costEstimateCents: number;
};
```

The manifest is the ad. The MP4 is one render of it.

## Repeatable Pipeline

1. `intake.created`
   - URL import creates draft App Memory.
   - Store screenshots are not treated as raw proof by default.

2. `source.classified`
   - Store screenshots are classified as raw enough, rawifiable, marketing collage, or
     unusable.
   - Raw screenshots and recordings can proceed directly to UI extraction.
   - Store-art source candidates can inform review and rawification, but cannot unlock V6
     by themselves.

3. `proof.rawified`
   - Eligible store/listing screenshots are transformed into raw-looking proof candidates
     before UI extraction.
   - The rawified candidate keeps provenance back to the original listing art and model
     task.
   - Crop-only source previews remain `store_art`; they are not rawified proof.

4. `ui.extracted`
   - UI extraction runs on rawified candidates, uploaded raw screenshots, captured app
     screenshots, and recordings.
   - OCR, crop bounds, semantic type, trust level, and candidate claim refs are stored.

5. `proof.confirmed`
   - User approves proof objects and claim mappings.
   - Nano Banana-style rawified candidates must pass UI/text preservation QA and user
     approval before becoming proof.
   - Weak, stylized, or missing proof creates a hold before generation.

6. `recipe.selected`
   - Creative Director Agent selects recipe based on proof type, category, audience,
     emotion arc, and cost budget.

7. `script.locked`
   - Script Agent writes beat-timed dialogue.
   - Lints check claims, brand pronunciation risk, brand placement, spoken word count,
     sensitive-category language, and proof alignment.

6. `creator.generated`
   - Provider blocks are generated per beat.
   - Retry budget is per beat, not per whole ad.

7. `manifest.rendered`
   - Renderer inserts proof, captions, trims, and final audio deterministically.
   - Cheap tweaks should edit the manifest and re-render without spending on providers.

8. `qa.completed`
   - Transcript diff against locked script.
   - Claim verification against final transcript.
   - Proof legibility and provenance check.
   - Silence/dead-zone detection.
   - Dimensions, duration, codec, safe-area, and contact sheet.

9. `review.decided`
   - Approve, reject, tweak, regenerate, or teach.
   - Decisions become structured Learnings.

## Adapting Across Apps

Use proof types, not app categories, as the portability layer.

Examples:

- Fitness app: `ranking` -> "this app humbled me"
- Sleep app: `surprising_stat` -> "this app called me out last night"
- Finance app: `spending_breakdown`/`dashboard` -> "this made my money feel less blurry"
- Photo app: `generated_output` -> "I thought this would look fake, but..."
- Education app: `progress_delta` -> "this showed me the exact thing I kept missing"

The same recipe can work across categories when the proof slot is semantically mapped.
Category changes emotion, risk ceiling, creator scenario, and language. The recipe shape
stays stable.

## Deterministic Vs Agentic

Agentic:

- recipe selection
- script language
- emotion arc
- creator scenario/persona
- critique and repair suggestions
- learning extraction

Deterministic:

- proof provenance
- claim verification
- cost caps and retry budgets
- script lints
- proof insertion/cropping
- caption rendering from script text
- timeline math
- silence trimming
- transcript diff
- final artifact manifests
- export/handoff permissions

## SaaS UX

Keep the top-level IA:

- Home
- App Memory
- Review

Home:

- active app
- readiness checklist
- next best action
- create pack flow
- pack statuses: proof needed, scripting, generating, QA hold, ready for review

App Memory:

- Proof: gallery with proof type, trust level, claim mappings, raw/stylized warnings
- Claims: verified, unverified, forbidden
- Style: brand voice, creator scenarios, sensitive language boundaries
- Learnings: scoped rule cards, deletable and confirmable

Review:

- rendered video preview
- contact sheet
- manifest diff
- QA gates
- claim/proof citations
- cheap tweak controls: swap proof, retime caption, shorten beat, regenerate one provider block

## Production Build Plan

This is no longer an MVP-only plan. Build the real production backbone first, then use the
V6 UGC selfie route as the first live creative lane inside that backbone.

### Phase 0: Production Foundation

Set up the product substrate before broadening formats:

- Firebase App Hosting / Next.js control plane
- Firebase Auth for users, organizations, roles, and API-key ownership
- Firestore collections for apps, App Memory, assets, UI objects, proof objects, recipes,
  jobs, tasks, manifests, QA reports, creative packs, learning events, handoffs, cost
  ledger, and audit events
- Cloudflare R2 bucket and bucket-scoped credentials for canonical media storage
- queue abstraction for typed tasks, with Cloud Tasks or equivalent worker leasing
- Cloud Run worker boundary for provider generation, render, media normalization, OCR, and
  QA
- provider-neutral interfaces for generation, rendering, storage, QA, and agent runtime
- API and MCP skeleton over the same object model as the UI

Exit criterion:

- a production-shaped app can create an app profile, upload/store assets to R2, write job
  state to Firestore, create signed preview/download access, and record audit/cost events
  with `providerMutations: 0`

### Phase 1: V6 UGC Selfie Lane

Build the V6-style UGC path as the first production recipe:

`App Memory -> Script -> Render Manifest -> Provider Clips -> Deterministic Assembly -> QA Notes -> Review`

Use the production App Memory, Recipe, task, manifest, R2, QA, Review, Learning, and cost
objects. Keep provider breadth narrow; do not activate every possible video provider on day
one.

Exit criterion:

- URL or hand-created App Memory can produce a V6-style ad for a real app
- output has manifest, transcript, silence report, contact sheet, QA notes, R2 object keys,
  and cost ledger
- Review can approve, reject, tweak, or regenerate one failed block with a reason

### Phase 2: Learning Loop And Skill Stamping

Make the first learning system real enough to compound:

- recipe version, prompt version, skill/rubric version, provider route, and QA version are
  stamped onto every artifact
- approve/reject/tweak decisions write scoped Learning Events
- next script and render plan reads the app's learnings doc
- the Review UI shows which learning influenced the next draft

Exit criterion:

- a rejected draft changes the next script or proof choice in a visible, useful way
- we can compare pass/fail and approval rate by recipe/skill version

### Phase 3: Second And Third Formats

Add image ads and one more proof-led video/image route using the same production objects.
This is when the Recipe Library becomes visibly useful to the user.

Exit criterion:

- the same App Memory can produce UGC video, image ads, and one additional proof-led format
- every output cites proof and claims
- Review and Learning work across formats
- credits/cost estimates differ by route

### Phase 4: Full SaaS Surface

Build the full product UI, not just a demo console:

- Home: app list and URL paste box
- App Memory: proof gallery, claims list, style doc, learnings doc
- Recipes: active creative formats with readiness and proof requirements
- Jobs: queued/running/held/ready history
- Review: finished renders, QA notes, manifest diff, approve/reject/tweak/regenerate
- Exports: download/share/API/MCP/handoff destinations
- Settings: users, API keys, credit limits, provider route preferences

Exit criterion:

- a user can import an app, confirm proof, request a UGC or image pack, review drafts, and
  teach the next run
- an agent can do the same through API/MCP without using the UI

## Full Product Expansion Modules

These are not abandoned future ideas. They are production modules, sequenced by risk and
dependency.

### Recipe Library

Add when two or three concrete formats are working.

- `ugc_selfie_proof_reveal`
- `image_proof_card`
- `hook_demo_cutaway`
- later: scroll-stop UGC, receipt/message drama, status-window/rank reveal, before-after
  output, app-store-style image sets

Recipe becomes the product-facing name for a repeatable creative grammar. It should own
beat structure, proof requirements, caption rules, provider route defaults, QA expectations,
and examples.

### Versioned Skills

Add after recipes start changing faster than code.

- store prompts, rubrics, examples, and failure cases as repo-versioned skill files
- stamp every artifact with skill and recipe versions
- compare pass rate, cost, review approval, and later ad performance by skill version
- let agents propose skill diffs, but require human/eval approval before promotion

Do not build custom skill-version infrastructure until git and artifact stamping stop being
enough.

### Worker Graph And Scale

Start with typed tasks, even if the first queue is simple. Expand the graph when one linear
job document becomes a bottleneck.

- separate task types for import, proof extraction, scripting, provider generation,
  rendering, QA, packaging, and export
- per-route concurrency pools
- dead-letter and hold states
- priority queues for paid tiers
- resumable partial reruns, such as regenerating only one failed creator beat

The trigger is volume or branching complexity, not architectural neatness.

### Multi-Provider Render And Generation Layer

Build a provider-neutral contract now. Add providers when one route fails to cover cost,
quality, latency, or capacity.

- Omni/Veo/Kling/Seedance-style provider routes for creator/video blocks
- Nano Banana-style routes for first frames, proof styling, image ads, and CTA images
- hosted HyperFrames for early finishing
- self-hosted HyperFrames or Remotion Cloud Run for margin/control
- Remotion Lambda as a mature high-scale fallback if AWS complexity becomes worth it

The product contract stays provider-neutral: final outputs must still be manifest-backed,
proof-backed, QA-checked, and cost-ledgered.

### Advanced QA

Add when human review catches repeated failures that cheap QA misses.

- OCR on final captions/proof screens
- transcript-to-script diff thresholds
- claim-to-proof verification
- face/identity consistency checks
- proof legibility scoring
- platform safe-area checks
- multimodal critic with structured hold reasons
- regression evals for recipes/skills

QA should graduate from notes to gating only after false holds and false passes are measured.

### Team And Agency Workflow

Add when multiple users review the same app/pack.

- team roles
- comments and assignments
- review queues
- approval policies
- client share links
- pack versions and change history
- brand-level libraries across apps

Do not make this the first app experience; it is a scaling feature.

### Agent-Native API And MCP

Build the skeleton early and keep it aligned with the UI objects. Expand tool coverage once
the human UI proves the object model.

- `bootstrap_app_from_store_url`
- `upload_proof_asset`
- `generate_creative_pack`
- `get_job_status`
- `get_qa_report`
- `iterate_creative`
- `download_creative_pack`
- `create_handoff`

This is how Codex, Claude Code, Cursor, and customer agents use Mobile Ad Agent. It should
wrap the same App Memory, Job, Manifest, Review, and Handoff objects the UI uses.

### Export And Handoff Rails

Add after approved packs exist.

- downloadable source inventory
- signed share links
- Drive or R2/GCS export
- AppAgentic paid-ad inbox handoff
- explicit downstream provider export
- audit event for every handoff

Keep paid-network launch separate from creative generation. Export can be automated; spend
mutation still requires a separate guarded approval path.

### Economics And Credit System

Add before charging external customers, but record the cost ledger from the first production
job.

- per-job cost ledger
- credit weights by output type
- included subscription allowance
- retry policy per tier
- premium/high-cost routes
- cost estimate before generation
- team/workspace caps

Pricing should reflect the whole factory value: proof import, claim discipline, creative
judgment, QA, review, and export, not just model token/provider cost.

### Learning System Maturity

Add after reject reasons demonstrably improve outputs.

- scoped learnings: app, category, global
- learning cards in App Memory
- delete/disable bad learnings
- aggregate recurring review reasons into skill/recipe improvements
- eval-gated promotion of global learnings
- performance feedback from exported/paid results when available

The north star is that each app gets faster and more on-brand after every review cycle.

## Guardrails

- No generated UI can become proof.
- Final transcript cannot contain unmapped claims.
- Brand names with ASR risk should be placed in reveal beats or require pronunciation-safe
  script variants.
- No CTA card for organic UGC selfie recipes unless the recipe explicitly allows it.
- Caption style is native white text with no black box for this recipe.
- Regenerate one failed beat, not the whole ad.
- Learnings are scoped to app/category/global and global learnings require explicit confirmation.
- `providerMutations` stays `0` until the user explicitly exports or hands off approved assets.

## Next Build

Start the production backbone, then wire the V6 UGC selfie route through it.

Recommended immediate sequence:

1. Confirm the AppAgentic Firebase/GCP project and Cloudflare account/bucket naming.
2. Dry-run R2 provisioning for the Mobile Ad Agent asset lake, then run live only after the
   account/bucket scope is confirmed.
3. Scaffold the Next.js/Firebase App Hosting app that replaces the zero-dependency local
   prototype as the control plane.
4. Implement Firestore schemas and TypeScript contracts for App Memory, Proof, Claim,
   Recipe, Job, Task, Render Manifest, QA Report, Creative Pack, Learning Event, Cost
   Ledger, and Handoff.
5. Implement the R2 AssetStore adapter with signed upload/download paths and canonical
   object-key conventions.
6. Implement a typed task queue and one Cloud Run worker path for the V6 route.
7. Wire Review and Learning against real manifests and R2 object keys.
8. Add image ads as the second format once the V6 route works in the production backbone.

The product should feel like a complete creative factory from the first serious build, even
if the first activated recipes are narrow.
