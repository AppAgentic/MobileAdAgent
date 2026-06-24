# Mobile Ad Agent SaaS Interface Concepts

Prepared: 2026-06-24

## Research Signals

- Arcads emphasizes fast UGC creation around AI actors and ad generation. Useful pattern: actor/template library and quick script-to-video flow. Source: https://www.arcads.ai/
- Product Hunt's Arcads summary frames the flow as script, actor selection, then generated UGC video. Useful pattern: keep creation steps short and visible. Source: https://www.producthunt.com/products/arcads
- Creatify emphasizes URL-to-video: paste a product link, use product images, scripts, AI avatars, then export. Useful pattern: start with app/store URL intake and convert that into a guided ad plan. Source: https://creatify.ai/features/url-to-video
- Creatify's product page also stresses launching/optimizing across social specs. Useful pattern: keep platform settings and format readiness visible but not dominant. Source: https://creatify.ai/
- Pencil emphasizes governed review, brand safety, and performance-team workflow. Useful pattern: QA/export should feel like a normal SaaS approval surface, not a debug stage list. Source: https://trypencil.com/the-platform
- AdCreative.ai positions ad generation as broad asset creation with performance orientation. Useful pattern: make variants and expected output obvious. Source: https://www.adcreative.ai/

## GPT-image-2 Concept Board

File:

`docs/design-explorations/gpt-image-2-mobile-ad-agent-saas/mobile-ad-agent-saas-directions-contact-sheet.png`

Additional iterations:

- `mobile-ad-agent-iteration-02-format-studio.png`
- `mobile-ad-agent-iteration-03-proof-workflow.png`
- `mobile-ad-agent-iteration-04-production-suite.png`
- `mobile-ad-agent-iteration-05-multi-app-launchpad.png`
- `mobile-ad-agent-iteration-06-guided-launchpad.png`
- `mobile-ad-agent-iteration-07-app-portfolio-launchpad.png`
- `mobile-ad-agent-iteration-08-recommended-launchpad.png`
- `mobile-ad-agent-iteration-09-refined-launchpad-no-preview.png`
- `mobile-ad-agent-iteration-10-proof-review.png`
- `mobile-ad-agent-iteration-11-draft-pack-setup.png`
- `mobile-ad-agent-iteration-12-review-drafts.png`
- `mobile-ad-agent-iteration-13-qa-export.png`

Generated directions:

1. Campaign cockpit: project rail, app URL intake, proof sources, central ad preview, right QA/export.
2. Creator casting: actor library, script beats, ad preview, proof drawer.
3. Proof-to-pack: proof library as primary visual anchor, raw screens mapped to claim cards and storyboard.
4. Review queue: team review table, pack status, compliance, cost, approve/export panel.

## Recommendation

Use `mobile-ad-agent-iteration-08-recommended-launchpad.png` as the current implementation target.

It combines:

- iteration 07's multi-app portfolio;
- iteration 06's one-expanded-step progressive disclosure;
- iteration 05's pack preview and output clarity;
- iteration 04's Launchpad product shell.

Selected Launchpad findings from Joe's chosen artifact:

- The first screen works because it starts with one job: import or choose an app.
- The launchpad has three clear sections: import app, choose outputs, next best action.
- Output choices are plain and comparable: Image Ads, UGC Videos, Stories, Thumbnails.
- Proof reassurance appears early, before asking the user to trust generated ads.
- A sample pack preview shows the payoff without forcing the user into the editor.
- The bottom sequence explains the journey: URL/App -> Proof -> Outputs -> QA -> Export.
- The page does not expose pipeline internals, provider details, JSON, or technical stage names.
- Multiple apps should appear as a calm app switcher/portfolio, not as a dense analytics dashboard.

Implementation principles:

1. The user should never wonder what to click next.
2. Only one step should be expanded at a time.
3. Completed steps collapse into short, reassuring summaries.
4. Future steps stay visible enough to explain the journey, but not editable yet.
5. Image Ads should be selected by default and treated as a primary output.
6. Multiple apps belong at the top as selectable app cards/statuses, with only the selected app expanded.
7. The right inspector should always answer: recommended next move, what the pack includes, proof readiness, estimated cost.
8. Advanced creative controls belong later in Creative Suite, not on the Launchpad.

Use the iteration 04 shell as the broader product shape:

1. Launchpad: app URL import, proof found, choose outputs.
2. Creative Suite: one workspace for image ads, UGC videos, stories, and thumbnails.
3. Storyboard + Static: each claim creates both a video scene and one or more static image ads.
4. Approval Room: review, QA, cost, comments, platform readiness, export.

Borrow the iteration 03 Proof Canvas as the signature interaction inside the Creative Suite.

Image ads should be first-class deliverables, not secondary thumbnails. Every pack can include:

- 1:1 image ads for Meta/Instagram feed;
- 4:5 image ads for feed;
- 9:16 story image ads;
- thumbnails/first-frame assets for video;
- UGC video ads.

Use direction 1 from the first board as a fallback for the simplest MVP: app URL, proof sources, ad preview, QA/export in one screen.

The first screen should answer:

- What app am I making ads for?
- Which raw proof supports the claims?
- What will the ad look like?
- Is it safe/ready to export?

Recommended information architecture:

1. Left rail: projects, templates, actors, proof library, brand kit, team/settings.
2. Launchpad: app URL import, detected claims/proof, output toggles for image/video/story/thumbnail.
3. Creative Suite: proof tray, multi-format canvas, static image layouts, video preview, headlines, CTA, brand kit.
4. Storyboard + Static: claim rows showing proof match, video scene, static image variants, and output formats.
5. Approval Room: QA score, proof match, text readability, brand safety, cost estimate, platform readiness, export pack.
6. Secondary tabs: creator casting, variants, performance/review queue.

## Updated Direction After Launchpad Feedback

Joe prefers iteration 05 as the base, with these corrections:

- Remove sample pack preview from Launchpad because it implies generation/cost too early.
- Do not ask users to choose Stories or Thumbnails as top-level outputs.
- Top-level output choices should be only Image Ads and UGC Videos.
- Story crops and thumbnails may exist as derived assets, but they should not be a Launchpad decision.
- Keep each section purposeful; no analytics, broad dashboards, or ornamental preview areas.
- Show the downstream states so the whole product path is visible.

Recommended product path:

1. Launchpad: choose app, confirm proof readiness, choose Image Ads and/or UGC Videos.
2. Proof Review: approve/edit/ignore detected claims, attach raw proof, mark store art as not-proof.
3. Draft Pack Setup: confirm image ad layouts and UGC video settings before spending credits.
4. Review Drafts: approve/request changes/regenerate individual creatives.
5. QA & Export: pass meaningful checks, then download/share/send pack to an ad inbox.

Implementation notes:

- Image Ads are selected by default.
- UGC Videos are optional and can be added in the same pack.
- Credits are not spent until the user clicks Generate drafts.
- Export should be explicit: Download ZIP, Send to ad inbox, Copy share link.
- Do not imply live provider publishing during export unless the user chooses a live destination.
- The main navigation can stay lean: Launchpad, Apps, Ad Packs, Proof Library, Creative Studio, Review/Approval, Brand Kit, Settings.

## What Not To Copy

- Do not copy generated text literally.
- Do not copy arbitrary fake app names or numbers.
- Do not make the first screen a table-only review queue.
- Do not make actor casting the entire first impression; it should support the proof-backed ad workflow.
- Do not expose JSON/stage names/debug details in the main UI.
