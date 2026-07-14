# UGC V6 Generation Correction Plan

Date: 2026-07-08

## Why This Exists

The live generation canary proved that the job rail can create an image source, a UGC
source clip, a render task, manifests, and QA reports. It did not prove that the creative
quality matches the prior Gemini Omni / Nano Banana / HyperFrames work.

The prior accepted reference was the GymLevels V6 fresh-script sample. The lesson from
that thread was not "generate a UGC ad." It was a specific organic selfie recipe:

```text
creator hook
-> real app proof cutaway while creator audio keeps running
-> creator reaction / soft landing
-> casual app-name reveal
```

That recipe is documented in:

- `docs/plans/ugc-selfie-productization.md`
- `docs/research/ugc-selfie-realism-prompt-recipes-2026-07-02.md`
- `docs/research/ugc-script-emotion-first-frame-framework-2026-07-02.md`

## What V6 Requires

- The ad is planned as a Recipe, not as loose generation tasks.
- Script timeline is locked before provider generation.
- Audio is the spine; proof cuts happen inside the sentence, not after speech stops.
- The proof visual uses real app pixels and is timed to the spoken proof line.
- Creator clips are short performance blocks, not the whole ad.
- First frames should look like paused iPhone front-camera video, not polished AI portraits.
- Captions are native white social text, no black boxes.
- Organic selfie UGC has no end CTA card or black CTA pill.
- The final app reveal is casual, e.g. "It's called GymLevels."
- Provider names and backend route details remain internal.

## Current Canary Mismatch

The current implementation is production-shaped but creatively wrong for this recipe.

In `lib/live-generation.mjs`:

- `creatorSegmentPrompt()` uses a generic "bright everyday room" influencer prompt.
- It does not use the realism recipe: no parked-car/bedroom/walking/desk scenario, no
  imperfect iPhone first-frame anchor, no anti-polish negatives, no emotion plan.
- It asks video generation directly for a generic clip rather than starting from an
  approved Nano Banana-style first frame.

In `lib/creative-job-model.mjs`:

- UGC is modeled as `creator_narrated` or `hook_proof_sequence`, not
  `ugc_selfie_proof_reveal`.
- The cheap route makes one hook clip, then proof and CTA blocks. That is structurally
  closer to an assembled ad than the accepted V6 organic selfie grammar.
- `buildRenderSpec()` adds generic copy like `Real app screens, not mockups`.
- It adds a final `Download <App>` CTA layer, which V6 specifically removed.
- Proof timing is derived from the end of the segment list, rather than from a locked
  proof line inside the script. For a multi-segment route, that can put proof after the
  creator blocks instead of under continuous VO.

In `lib/render-backend.mjs`:

- The compositor still has a `cta-pill` layer for UGC video.
- Proof is a centered proof panel with generic timing, not a phrase-bound L-cut from the
  script manifest.
- The renderer can support continuous audio, but the manifest does not yet make that the
  creative contract.

For image ads:

- The current prompt generates a no-text background canvas and then overlays proof locally.
- That is safe for product truth, but it is not the more model-directed Nano Banana image
  direction Joe wanted. The image route needs its own recipe and QA so the generated ad
  feels native while still preserving proof truth.

## Correct First Implementation Slice

1. Add a real recipe id: `ugc_selfie_proof_reveal`.
2. Add a minimal `Recipe`, `Script`, `EmotionPlan`, and `RenderManifest` contract in code,
   even if backed by local JSON first.
3. Build the script from proof type:
   - hook: brand forbidden
   - proof line: claim/proof required
   - reaction: personal/emotional payoff
   - reveal: brand allowed, casual app-name only
4. Generate or select a first-frame prompt from the realism recipes:
   - parked car, bedroom, walking, desk/mic, hallway, etc.
   - no portrait mode, no bokeh, no studio, no generated UI/text
5. Generate creator performance blocks from the locked script and approved first frame.
6. Change the render manifest so proof overlays the creator's proof-line audio window.
7. Remove end-card/CTA-pill layers from this recipe.
8. Render final captions as native white social text.
9. QA the final artifact against:
   - transcript vs locked script
   - proof appears during the intended spoken line
   - proof pixels are real/reviewed
   - no CTA card/pill for this recipe
   - no generic proof caption
   - no generated app UI
   - no polished portrait first-frame tells

## Canary Definition

The next live canary should not be "one image ad + one UGC hook." It should be:

```text
input: reviewed GymLevels/Vetted-style App Memory with one verified proof object
route: ugc_selfie_proof_reveal
output: one complete V6-style UGC video
evidence: manifest, script, proof IDs, transcript report, contact sheet, final MP4
```

The pass condition is not only "valid MP4." The pass condition is: it feels like the V6
reference grammar and the manifest proves why.

## 2026-07-09 Universal Planning Correction

Duolingo, GymLevels, Fitbod, and any other named app are regression fixtures only. The
production path no longer maps categories to hooks, script beats, creator personas,
settings, or first-frame copy.

The production planning gate is now:

```text
reviewed app evidence
  -> persisted Hook Agent (8 writers -> 8 isolated reads -> evidence critic)
  -> persisted Script Agent (remaining beats + creator framing)
  -> strict line-by-line evidence verifier
  -> independent creative critic
  -> shared first frame / creator clips / proof compositor
```

Every selected script is bound to the exact Hook Plan fingerprint, reviewed-source
fingerprint, claim ID, proof IDs, per-beat evidence references, verifier rows, creator
plan, critic verdict, and immutable plan fingerprint. A held Hook Plan or Script Plan
must produce zero UGC frame, video, or render calls. Unknown and deliberately nonsense
category labels use the exact same path; deterministic code owns only timing, layout,
budgets, fingerprints, proof placement, brand-reveal policy, and media gates.
