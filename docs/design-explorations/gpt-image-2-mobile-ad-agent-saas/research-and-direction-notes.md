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

Generated directions:

1. Campaign cockpit: project rail, app URL intake, proof sources, central ad preview, right QA/export.
2. Creator casting: actor library, script beats, ad preview, proof drawer.
3. Proof-to-pack: proof library as primary visual anchor, raw screens mapped to claim cards and storyboard.
4. Review queue: team review table, pack status, compliance, cost, approve/export panel.

## Recommendation

Use direction 1 as the first-run SaaS shell, then borrow direction 3 as the differentiating core workflow.

The first screen should answer:

- What app am I making ads for?
- Which raw proof supports the claims?
- What will the ad look like?
- Is it safe/ready to export?

Recommended information architecture:

1. Left rail: projects, templates, actors, proof library, brand kit, team/settings.
2. Main workspace: step-by-step app URL, proof upload/import, creator plan, format settings.
3. Center/right preview: vertical ad preview with scene navigation.
4. Right inspector: QA score, proof match, text readability, brand safety, estimated cost, export pack.
5. Secondary tabs: creator casting, storyboard, variants, performance/review queue.

## What Not To Copy

- Do not copy generated text literally.
- Do not copy arbitrary fake app names or numbers.
- Do not make the first screen a table-only review queue.
- Do not make actor casting the entire first impression; it should support the proof-backed ad workflow.
- Do not expose JSON/stage names/debug details in the main UI.
