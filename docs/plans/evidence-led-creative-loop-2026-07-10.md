# MobileAdAgent evidence-led creative loop

Date: 2026-07-10

## Product outcome

MobileAdAgent should feel methodical, not like a creative vending machine. Before credits are used, the customer sees one plain creative idea, two openings, what the pack should teach us, and exactly what will be generated. Internal contracts still preserve the hypothesis, controlled comparison, and evidence lineage without exposing research jargon in the default UI. After review, explicit decisions become durable learning for the next pack.

## Customer flow

`App Info → bounded research → Creative Pack Plan → approval and debit → generation → creative review → typed learning → next Pack Plan delta`

The Pack Plan sits directly after App Info and before generation in the existing Terminal Bloom workspace. It is not a separate strategy product or an extra onboarding wizard.

## Evidence contract

Three evidence types stay visibly and technically separate:

1. **Verified product truth** — reviewed app summary, supported features, and selected real screens. Only the summary/features may support product claims; screens provide visual proof.
2. **Public market signals** — cited public app-review pages, community discussions, official context, and competitor-review context. These can direct an angle but can never prove what the product does.
3. **Previous creative learning** — typed approve, reject, and concrete tweak decisions from this app. These may shape the next experiment but remain traceable to the source decision.

Coverage is reported as grounded, directional, or exploratory from the evidence actually captured. Empty research has zero sources and zero signals; the UI never invents counts or certainty.

## Experiment contract

Each internal plan proposes one falsifiable hypothesis with one primary and one challenger lane. The customer sees these as **Our idea**, **Idea A**, and **Idea B**. The only changed variable is the creative angle. Audience, output mix, reviewed claims, and proof pool remain controlled.

An approval chooses creative direction. A tweak note refines execution and must never promote the tweaked draft's angle over a separately approved angle.

Every requested image or UGC output receives a persisted assignment containing:

- primary or challenger lane;
- exact verified claim reference;
- exact proof-screen reference;
- cited market-signal references where available.

The accepted Pack Plan snapshot travels into the paid pack and creative job graph. Hook, Script, image, UGC, QA, and export work therefore share the same approved source contract.

## Implemented in this pass

- Immutable, fingerprinted research snapshots and Creative Pack Plans.
- Bounded grounded public-web research with citation filtering and an honest no-configuration/no-evidence fallback. When public evidence is empty, the fallback still derives two distinct product-specific angles from reviewed claims and pairs each with the closest real app screen; it never substitutes generic creative formats for ideas.
- Full-width native Pack Plan UX, evidence disclosure, primary/challenger comparison, exact output controls, and explicit credit approval.
- Server-owned plan approval and idempotent debit; packs cannot bypass the plan or change their output mix after approval.
- Plan assignments carried into image and UGC job construction.
- Server-persisted review decisions and typed learning events.
- Returning plans visibly show what the prior review changed.
- Firestore member-read/server-write rules for research, plans, decisions, and learning.
- Desktop and mobile browser QA plus model, adapter, lifecycle, tenant, job, manifest, rules, render, hosting, and route smoke tests.

## Next milestones

### 1. Deeper owned-review coverage

Add authenticated App Store Connect and Google Play review adapters when an owner connects those stores. Merge those bounded results with cited public web context while preserving source type and locale. Until then, coverage remains explicitly public-web-only and may be exploratory.

### 2. UGC learning depth

Keep the existing Hook Agent and evidence-bound Script Agent, but add review fields for hook, creator delivery, proof moment, and pacing. Convert those into typed learning scopes so the next plan can change one dimension deliberately instead of treating every rejection as an angle rejection.

### 3. Image generation provider revamp

Move the image-generation implementation to the planned pure Nano Banana route later, reusing the provider-neutral Pack Plan assignment contract. The customer-facing plan, credit gate, evidence rules, and job schema should not depend on a provider name.

### 4. Performance learning

When ad-network data is connected, add a separate performance-signal type with source, campaign context, spend threshold, attribution window, and confidence. Never blend subjective approvals with performance outcomes or imply causality from thin data.

### 5. Experiment history

Add an app-level timeline showing hypothesis, plan delta, creative decisions, and eventual performance signal for each pack. The default workspace should still foreground the current decision rather than becoming an analytics dashboard.

## Non-negotiable safety rails

- No credit debit before explicit plan approval.
- One debit and one pack per accepted plan.
- Editing app truth invalidates an unaccepted plan.
- An accepted plan is view-only and cannot be replayed.
- Market signals never authorize product claims.
- No fake sources, counts, quotes, or completed research steps.
- No provider/model names in customer-facing payloads or copy.
- Low evidence produces an honest exploratory experiment, not fake confidence.
