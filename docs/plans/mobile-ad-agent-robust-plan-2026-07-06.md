# Mobile Ad Agent Robust Plan - 2026-07-06

## 1. One-Page Executive Plan

Mobile Ad Agent is an app-specific creative factory for mobile app teams. It is not a generic AI ad generator, an avatar playground, or an ad buying/campaign optimization platform.

The product promise is:

> Paste an App Store, Play Store, or app website URL. Mobile Ad Agent understands the app, pulls real app source material, generates paid-ad-ready image ads and UGC ads, then learns from review decisions so the next pack gets better.

The ideal first customer is a funded consumer subscription or high-LTV mobile app already spending, or preparing to spend, meaningful paid UA. The best starting ICP is teams spending about $10k-$100k/month on paid acquisition with a creative volume problem: founders, Heads of Growth, UA Managers, Performance Marketing Leads, and small app studios.

The first-run product must stay simple:

1. Paste app URL.
2. Automatically pull app icon, summary, key features, and screenshots/source assets.
3. Show one clean Review App Info screen: app summary, key feature list, screenshot grid with remove/add.
4. User clicks Next / Generate.
5. Generate image ads and UGC ads.
6. Review, approve, export, and record learning events.

The commercial model is paid from the first generated asset:

- Same-Day Launch Pack: about $249 one-time, used as the paid acquisition / CAC-liquidating front-end offer.
- Launch: $99/month, 600 credits.
- Scale: $249/month, 2,000 credits. This is the main continuity target.
- Studio: $599/month, 6,000 credits.
- Image ad: 4 credits.
- UGC ad: 60 credits.
- Subscriber-only top-ups: $29/150, $99/500, $199/1,100.

The moat is not raw generation. The moat is app-specific understanding, real screenshot/source handling, safe claim discipline, QA, export handoff, and learning memory over time.

## 2. Pages And Flows

### Public Pages

- Home / Same-Day Launch Pack: product promise, URL-first CTA, examples, quality guarantee, pricing entry.
- Pricing: Launch, Scale, Studio, credit packs, annual option, plan-fit guidance.
- Examples / Gallery: before app URL -> after creative pack, with real or clearly labeled sample apps.
- Teardowns / Templates / Comparisons: organic content pages for app marketers.
- App Readiness Preview: non-generated app-info extraction preview. It may show pulled icon, summary, key features, screenshot readiness, and gaps. It must not generate free ads.
- Checkout: Same-Day Launch Pack, subscription, annual, or top-up.

### App Pages

- Apps: list of app profiles, status, last pack, next recommended action.
- App Profile / Review App Info: summary, key features, screenshots, icon, source status, simple edit/remove/add actions.
- Generate Pack: minimal confirmation of Image Ads and/or UGC Ads, credits required, and main Generate action.
- Review Drafts: image/UGC outputs, approve, reject, request tweak, regenerate, add note.
- QA & Export: quality status, issue holds, download ZIP, share link, handoff/export.
- Packs: past packs, filters, statuses, exports.
- Integrations / API / MCP: agent and export setup, not first-run clutter.
- Billing: plan, credits, top-ups, invoices, usage.

### Paid Traffic Flow

1. Paid ad promises Same-Day Launch Pack, not generic AI credits.
2. Landing page shows "turn your App Store / Play Store URL into launch creatives today."
3. User pastes URL.
4. Product shows app-info preview and source readiness.
5. Checkout happens before generation.
6. Review App Info.
7. Generate first pack.
8. Review/export.
9. Upsell to Scale monthly/annual after first useful pack.

### Organic Flow

1. User lands on teardown, template, comparison, or example page.
2. CTA asks for app URL to preview app readiness.
3. Product shows non-generated app summary, likely angles, screenshot readiness, and gaps.
4. CTA routes to Same-Day Launch Pack or Launch/Scale plan.
5. Generation remains paid.

### Existing Subscriber Flow

1. User opens Apps.
2. Selects an app profile or adds a URL.
3. Reviews simple app info.
4. Generates a pack with credits.
5. Reviews/exports.
6. Review decisions become learning events for the next pack.

## 3. Customer Segments And Routing

### Self-Serve Now

- Small funded app teams, solo founders with real ad budgets, or lean growth teams.
- One to three apps.
- Want speed and creative volume without a sales process.
- Route to $249 Same-Day Launch Pack, $99 Launch, or $249 Scale.

### Light Sales-Assisted Now

- Teams spending about $10k-$100k/month on paid UA.
- Have creative fatigue, weekly testing cadence, multiple channels, or compliance concerns.
- Buyer is Head of Growth, UA Manager, Performance Marketing Lead, or founder.
- Route to Scale annual, Studio, priority QA, or a $249-$499 launch pack with optional onboarding.

### Later / Not Now

- Pre-PMF, pre-launch, no ad budget, pure-organic-only apps.
- Indie buyers who only want cheap one-off AI images.
- Generic ecommerce brands that do not need app proof.
- Tiny agencies with many low-budget clients.
- Enterprise procurement-heavy accounts that require long security/legal cycles before the core product is proven.

## 4. Offer And Pricing Architecture

### Paid Attraction Offer

Same-Day Launch Pack, around $249 one-time.

Practical deliverables:

- App profile built from store/site URL.
- App-safe claims and angle map.
- 24 image ads.
- 4 UGC ads.
- One revision round.
- 30-day creative testing roadmap.
- Export-ready files and handoff checklist.

Guarantee:

- Delivery or usable-output guarantee only.
- If valid source material is provided and the pack misses the promised delivery window or is off-brief/non-compliant, rerun or credit the affected assets.
- No installs, ROAS, CAC, revenue, or ad-network performance guarantee.

### Recurring Plans

Launch, $99/month, 600 credits:

- About 150 image ads or 10 UGC ads.
- Best for one app, one active campaign, lighter testing.
- Includes app profile, QA, exports, and learning history.

Scale, $249/month, 2,000 credits:

- About 500 image ads or 33 UGC ads.
- Main continuity plan.
- Best for serious weekly creative testing across one to three apps or channels.
- Should be the default post-pack upsell.

Studio, $599/month, 6,000 credits:

- About 1,500 image ads or 100 UGC ads.
- Best for portfolios, agencies, or in-house growth teams.
- Should include stronger team, priority, and multi-app packaging.

### Credit Packs

Subscriber-only overage:

- $29 for 150 credits.
- $99 for 500 credits.
- $199 for 1,100 credits.

Rules:

- Active subscription required to generate.
- Monthly plan credits spend first and reset monthly.
- Top-up credits do not reset, but are not a standalone entry path.
- Repeated top-ups should trigger an upgrade prompt.

### Expansion Offers

- Annual prepay with bonus credits or priority QA rather than heavy discounting.
- Priority QA & Review add-on.
- Multi-app workspaces and extra seats.
- Agency/API plan later, starting around $1,499/month.
- Done-with-you App Launch Lab later, around $3k one-time.

## 5. Product Requirements

### MVP

- URL intake for App Store, Play Store, and app website context.
- Pull icon, app name, app summary, key features, and real store screenshots when available.
- Reject icons, tiny images, generic website images, and placeholders as screenshot proof.
- Simple Review App Info screen: summary, key feature list, screenshot grid with remove/add/upload, one Next/Generate action.
- Billing/checkout before generated assets.
- Credit ledger with image ads at 4 credits and UGC ads at 60 credits.
- First pack generation for image ads and UGC ads.
- Review Drafts with approve/reject/tweak/regenerate.
- QA hold/pass states.
- Export ZIP/share link.
- Learning events from review decisions.
- Basic app profile memory for approved claims, banned claims, screenshots, and style notes.

### Robust Production Version

- Firebase Auth, organizations, roles, teams, seats, API keys.
- Durable async workers for intake, extraction, generation, render, QA, export, and retries.
- R2/GCS-style asset lake for all source, generated, QA, and export artifacts.
- Firestore-style canonical state with audit events.
- Cost ceilings, credit preauthorization, idempotent jobs, retries, dead-letter holds.
- Full source provenance for every output.
- QA reports with dimensions, duration, text/claim checks, safe area, proof fidelity, and platform fit.
- Agent/API/MCP surface for workspace, app bootstrap, generate pack, job status, QA report, download, and handoff.
- Integrations for ad inboxes/export destinations, without mutating paid spend by default.
- Observability for latency, failure rate, COGS, credit margin, and review outcomes.

## 6. Data Model And System Architecture

High-level objects:

- `organizations`: company, plan, billing owner, settings.
- `users` / `memberships`: roles, seats, permissions.
- `subscriptions`: plan, renewal, entitlement, annual/monthly.
- `creditBalances` / `creditTransactions`: monthly credits, top-ups, spend, refunds.
- `costLedger`: internal generation/render/QA cost by job and output.
- `apps`: app identity, platform URLs, icon, owner org.
- `appProfiles`: summary, key features, approved claims, banned claims, style, audiences, learning memory.
- `appIntakes`: URL imports, extraction status, source adapters, holds.
- `assets`: icons, screenshots, recordings, uploads, generated images, videos, QA assets, export bundles.
- `sourceScreenshots`: source URL, dimensions, hash, trust level, review status.
- `claimCandidates`: extracted features/claims, support source, confidence, review status.
- `creativePacks`: requested output mix, status, credit estimate, delivery SLA, export status.
- `creativeJobs`: async job state for generation/render/QA.
- `creativeBriefs`: angles, hooks, formats, accepted source inputs, acceptance criteria.
- `generatedCreatives`: output asset records, type, status, pack membership.
- `qaReports`: pass/hold/retry, reasons, checks, contact sheets.
- `reviewDecisions`: approve, reject, tweak, regenerate, banned claim, liked angle.
- `learningEvents`: compact memory updates from review and performance notes.
- `exports` / `handoffs`: ZIPs, share links, destination handoffs, provider mutation flag.
- `auditEvents`: who/what/when for state changes.

Pipeline:

```text
URL intake
  -> appIntake record
  -> source extraction worker
  -> assets + appProfile draft
  -> Review App Info
  -> checkout / credit authorization
  -> creativePack + creativeJobs
  -> generation/render workers
  -> QA
  -> Review Drafts
  -> export/handoff
  -> learningEvents update App Profile
```

Architecture rules:

- Web app is the control plane, not the heavy renderer.
- Workers are async, idempotent, and resumable.
- Binary artifacts live in object storage; database stores keys and metadata.
- Signed URLs are short-lived and never canonical state.
- Generation-only jobs record no paid-ad provider mutations.

## 7. UX Details And Copy Rules

- First-run screen has only app summary, key features, screenshot grid, remove/add controls, and Next/Generate.
- Always pull and show the app icon when available.
- Use large, readable screenshot cards; no tiny thumbnails as the only view.
- Avoid random IDs, debug strings, stage tables, method names, backend names, and pipeline diagrams in customer UI.
- Customer-facing terms: image ads, UGC ads, app info, app profile, screenshots, source assets, credits, packs, export.
- Internal-only terms: backend provider names, model names, raw tool names, route IDs, proof/debug vocabulary unless used in a private admin surface.
- Do not say the product launches campaigns or changes ad spend.
- Do not promise performance. Promise speed, output, source discipline, QA, and iteration.
- Use "today", "same-day", "in minutes", or a clear SLA for generation speed.
- Use "30-day" only for testing roadmap, learning loop, retention, CAC payback, or campaign review.
- No free generated ads, no no-card generation trial, no sample pack that implies paid generation before checkout.

## 8. Growth Plan

### First Channels

- Founder-led outbound to funded mobile app teams and app studios.
- High-intent Google Search: mobile app ad creatives, UGC ads for apps, app ad generator, app store screenshot ads.
- Retargeting for URL-preview starters, pricing visitors, and example viewers.
- Organic content: teardown pages, ad templates, app category examples, before/after creative packs, competitor comparisons.
- Partnerships with app growth consultants and small UA agencies once the product is proven.

### Organic Loop

1. Publish teardown/template/comparison.
2. CTA: paste app URL.
3. Show non-generated app readiness preview.
4. Capture email/workspace.
5. Route to Same-Day Launch Pack or plan.
6. Approved customer examples become anonymized or permissioned future examples.

### Paid Tests

- Start with high-intent search and retargeting.
- Avoid broad LinkedIn or cold paid social until conversion and retention are proven.
- Paid social creative should show the product visually: URL in, pack out today.
- Starter monthly CAC should stay under about $150-$200.
- Growth monthly can support roughly $350-$500+ CAC if activation and retention are strong.
- Annual/Growth/Studio routes can support higher CAC; use them for paid scale.

### Activation Metrics

- Visitor -> URL import.
- URL import -> app info preview complete.
- Preview -> checkout.
- Checkout -> first app review complete.
- First generation -> first approved creative.
- Time to first usable creative.
- Pack approval rate.
- UGC QA pass/retry rate.
- Average COGS per approved image ad and UGC ad.
- Credit consumption by output type.
- First pack -> second pack.
- Day-30 and day-90 retention.
- Plan mix: Launch vs Scale vs Studio.

## 9. Risks, Open Questions, And Validation Tests

### Key Risks

- Generated UGC quality/pass rate is lower than expected.
- Store screenshots are stylized, missing, or too small.
- The app summary/features extraction produces vague or inaccurate points.
- Buyers misunderstand the product as an ad buying platform.
- Heavy users consume too much low-price UGC and compress margins.
- Paid CAC is too high if the funnel sells mostly $99 monthly.
- Compliance risk for regulated app categories.
- Customers expect performance guarantees unless copy is disciplined.

### Open Questions

- How much of app-info extraction should be free/lead-capture versus account-gated?
- Should the $249 Same-Day Launch Pack be self-serve checkout first or sales-assisted first?
- What is the minimum pack size that feels valuable without overloading review?
- What upload requirements should trigger a generation hold?
- How much performance feedback should be collected manually before integrations?
- Which export destinations matter first: ZIP, share link, Drive, Meta/TikTok ad inbox, or API?

### Validation Benchmarks Before Scaling

- 20-app benchmark across categories.
- App-info summary/features accuracy target: high enough that users edit lightly, not rewrite.
- Screenshot extraction precision: no icons, badges, placeholders, or tiny images in the default grid.
- Median import-to-review time under about 60 seconds.
- Median checkout-to-first-draft time measured and reported honestly.
- At least 70%+ first-pack outputs approved or fixable with one revision.
- Approved image ad COGS near the planning average.
- Approved UGC ad COGS near the planning average.
- Refund/redo rate low enough for the Same-Day Launch Pack guarantee to hold.
- Paid test only scales after visit-to-paid, pack approval, margin, and day-30 retention are measured.

## 10. 30/60/90 Day Roadmap

### First 30 Days

- Lock IA: Apps -> App Profile / Review App Info -> Generate Pack -> Review Drafts -> QA & Export.
- Finish the simple Review App Info UX with no debug noise.
- Implement reliable icon, summary, key features, and screenshot extraction for store URLs.
- Add generation holds for missing or weak screenshots.
- Wire checkout/entitlements in test mode and credit accounting.
- Produce first image ad and UGC ad packs through the intended routes.
- Build Same-Day Launch Pack page and checkout path.
- Run 5-10 concierge/self-serve pilot packs.
- Benchmark COGS, latency, QA pass rate, and user edits.

### Days 31-60

- Move intake/generation/QA into durable async worker jobs.
- Harden asset storage, manifests, export bundles, and audit events.
- Add learning events from review decisions into App Profile memory.
- Improve pack review, revision, and export workflows.
- Add Scale upgrade prompts after first approved pack.
- Launch organic pages: teardowns, templates, examples, comparisons.
- Run small search/retargeting paid tests with strict CAC limits.
- Start light sales-assisted outreach to the ICP.

### Days 61-90

- Production hardening: auth roles, teams, rate limits, cost caps, observability, retries, dead-letter holds.
- Add API/MCP beta for agent-driven workflows.
- Add annual plans, priority QA, multi-app/team upsells.
- Build first export/integration handoffs beyond ZIP/share link.
- Expand benchmark set and category coverage.
- Scale paid only if activation, COGS, plan mix, and retention clear gates.
- Decide whether to push self-serve, sales-assisted Scale, or agency/API based on real conversion and margin data.

## Direction For Teams

Product should protect the core loop and avoid broadening into ad buying or generic creative tooling.

Design should make the first-run review feel obvious, calm, and automatic. The user should see what app was found, what source material will be used, and one clear next action.

Engineering should build durable state and manifests early, but keep the user surface simple. The production backbone should be async, auditable, and cost-capped.

Growth should sell speed, app-specific creative throughput, and source-safe iteration. Do not lead with credits, backend AI, or generic "AI ad generator" language.
