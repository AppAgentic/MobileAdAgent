# Mobile Ad Agent Margin Analysis - 2026-07-06

## Executive Read

The $99/month starting price can work, but only if Mobile Ad Agent keeps high-cost video generation out of the default 15-credit UGC path.

The current image economics are workable. At 2 credits per image ad, the product earns about $0.20 to $0.33 per image depending on plan tier. If the primary route is Gemini Flash Image / similar cheap image generation plus deterministic QA, image gross margin can stay around 75-85% at normal utilization.

The current proof-backed UGC economics are not workable if one UGC video consumes only 15 credits and uses paid AI video generation. At 15 credits, revenue per UGC video is only about $1.50 to $2.48. The earlier Mobile Ad Agent/Gemini Omni thread matters here: the intended standard UGC route is not generic premium Seedance/Sora. It is the tested Gemini Omni-style flow: constrained short creator/performance blocks plus deterministic app-proof cutaways, captions, CTA, and QA. That makes standard UGC cheaper, but not free enough for 15 credits once retries and paid acquisition are included.

Recommendation: keep 15 credits only for simple/template UGC previews. Price the Gemini Omni proof-backed route around 40-60 credits per video, defaulting to 60 credits until pass-rate data proves we can safely lower it. Premium/high-cost provider routes should stay at 200+ credits or a cash add-on.

Paid acquisition makes this stricter. A $99/month product can afford roughly $150-$250 CAC for a 2-3 month payback if gross margin stays near 80%. That is plausible for high-intent search and retargeting, but weak for broad paid social or B2B-style paid acquisition unless the funnel sells annual or pushes buyers into Growth.

## Current Pricing And Credit Assumptions

Current prototype ladder:

| Plan | Price | Credits | Revenue per credit |
|---|---:|---:|---:|
| Starter | $99/mo | 600 | $0.165 |
| Growth | $249/mo | 2,000 | $0.1245 |
| Pro | $599/mo | 6,000 | $0.0998 |

Current output weights:

| Output | Credits | Revenue at Starter | Revenue at Growth | Revenue at Pro |
|---|---:|---:|---:|---:|
| Image ad | 2 | $0.33 | $0.25 | $0.20 |
| UGC video | 15 | $2.48 | $1.87 | $1.50 |

## Current Provider Price Inputs

Verified public pricing used as anchors:

- Google Gemini 2.5 Flash Image lists output at $0.039 per image for up to 1024x1024 on standard pricing: https://ai.google.dev/gemini-api/docs/pricing
- Google Veo pricing shown on Gemini API pricing has an effective 720p video output price around $0.10 per second: https://ai.google.dev/gemini-api/docs/pricing
- OpenAI GPT Image 2 pricing guide lists medium portrait generation around $0.041 and high portrait around $0.165, before text/image input tokens: https://developers.openai.com/api/docs/guides/image-generation#calculating-costs
- OpenAI Sora docs confirm Sora 2 / Sora 2 Pro API routes, async video generation, 16-20s generations, and 1080p only on Pro; current changelog/pricing should be checked before locking a route: https://developers.openai.com/api/docs/guides/video-generation
- Fal's Seedance 2.0 marketplace pricing is a useful premium-route proxy, with 720p standard around $0.3034/sec and 720p fast around $0.2419/sec; this is not official ByteDance direct pricing: https://fal.ai/models/bytedance/seedance-2.0/text-to-video
- Cloud Run request-based billing only charges CPU/memory while starting, shutting down, or processing requests; lightweight orchestration should be small relative to media generation: https://cloud.google.com/run/pricing
- Cloudflare R2 standard storage is $0.015 per GB-month with free egress and low request pricing, so storage should be negligible unless users store lots of rendered media: https://developers.cloudflare.com/r2/pricing/

Modeling assumptions:

| Route | Base COGS assumption | High-risk COGS assumption | Notes |
|---|---:|---:|---|
| App import/profile review | $0.05-$0.30 per app | $0.50+ | Gemini text/vision, store fetch, screenshot classification, app profile write. Should be plan value, not per-generation cost. |
| Image ad | $0.05-$0.10 each | $0.20+ | Gemini image output plus prompt/QA/storage/retry. Higher routes should be premium. |
| Simple UGC/template preview | $0.30-$0.70 each | $1.00 | Deterministic proof cutaways, captions, light rendering, maybe no generated AI video. |
| Proof-backed AI UGC | $1.50-$3.00 each | $4.00+ | Generated creator/performance clip plus proof cutaways, QA, retries, finishing. |
| Premium/high-cost UGC | $6-$25+ each | $40+ | Multi-clip, high-res, Sora/Veo/Seedance premium route, higher retry and QA burden. |

## Gemini Omni-Specific Correction

Joe flagged that standard UGC should be modeled around the Gemini Omni flow we tested earlier, not around generic premium video generation.

The prior thread/skill notes say:

- The tested local precedent was an isolated `google-genai 2.10.0` Interactions API path that produced 10s vertical `gemini-omni-flash-preview` image-to-video clips with integrated audio from a first frame in roughly 40-44s.
- That was a technical precedent, not a guarantee of current API availability, pricing, quality, or pass rate.
- The correct Mobile Ad Agent shape is not "one full ad generated by Omni." Omni creates constrained creator/performance blocks or B-roll. Real app proof, exact claims, captions, CTA/end card, and final assembly stay deterministic.

Economics implication:

| Gemini Omni route | Raw generation assumption | All-in working COGS | Credit recommendation |
|---|---:|---:|---:|
| 10s single-turn creator block | ~$1.00 raw at $0.10/sec | ~$1.50-$2.50 | 30-40 credits if QA pass rate is high |
| 15s / two-turn standard UGC | ~$3.00 raw for two 15s attempts | ~$4-$6 | 40-60 credits |
| Multi-clip / heavy retry UGC | $4.50+ raw before finishing | ~$6-$10+ | 60-90 credits |

Read: Gemini Omni does materially improve standard UGC COGS versus Seedance 2.0/Sora premium routes. It supports a 40-60 credit standard UGC route. It does not support a 15-credit proof-backed generated UGC route if we want paid acquisition and healthy margin.

## Margin At Full Credit Utilization

This shows why route controls matter.

### If Credits Are Used Only On Images

Assume image COGS of $0.055 each.

| Plan | Max image ads | COGS | Gross margin |
|---|---:|---:|---:|
| Starter | 300 | $16.50 | 83% |
| Growth | 1,000 | $55.00 | 78% |
| Pro | 3,000 | $165.00 | 72% |

Read: image economics are okay, especially if average utilization is below 100%. Pro becomes less attractive at full usage, so credits should expire monthly or Pro credits should not be too generous.

### If Credits Are Used On Simple UGC Only

Assume simple/template UGC COGS of $0.50 each.

| Plan | Max 15-credit videos | COGS | Gross margin |
|---|---:|---:|---:|
| Starter | 40 | $20 | 80% |
| Growth | 133 | $67 | 73% |
| Pro | 400 | $200 | 67% |

Read: 15 credits is acceptable only if the UGC route is mostly deterministic and cheap.

### If Credits Are Used On Proof-Backed AI UGC

Assume proof-backed AI UGC COGS of $1.80 each.

| Plan | Max 15-credit videos | COGS | Gross margin |
|---|---:|---:|---:|
| Starter | 40 | $72 | 27% |
| Growth | 133 | $239 | 4% |
| Pro | 400 | $720 | negative |

Read: 15 credits for proof-backed AI UGC is not viable. It lets heavy users turn Pro into an unprofitable video-generation plan.

## What Credit Weights Need To Be

For a $1.80 proof-backed UGC COGS:

| Target margin | Starter credits needed | Growth credits needed | Pro credits needed |
|---|---:|---:|---:|
| 70% gross margin | 37 | 49 | 61 |
| 80% gross margin | 55 | 73 | 91 |

Practical recommendation:

- Image ad: keep 2 credits if routed through cheap image generation and QA.
- Simple UGC/template preview: 15 credits is okay.
- Proof-backed AI UGC: 45-75 credits.
- Premium/high-cost UGC: 200+ credits or sold as a separate cash add-on.

## Paid Acquisition Sensitivity

Assume 3% payment processing and gross margin after generation COGS.

At 80% gross margin:

| Plan | Monthly contribution after processing | 3-month CAC payback | 6-month CAC payback |
|---|---:|---:|---:|
| Starter $99 | ~$76 | ~$228 | ~$456 |
| Growth $249 | ~$192 | ~$576 | ~$1,152 |
| Pro $599 | ~$461 | ~$1,383 | ~$2,766 |

At 65% gross margin:

| Plan | Monthly contribution after processing | 3-month CAC payback | 6-month CAC payback |
|---|---:|---:|---:|
| Starter $99 | ~$61 | ~$183 | ~$366 |
| Growth $249 | ~$154 | ~$462 | ~$924 |
| Pro $599 | ~$371 | ~$1,113 | ~$2,226 |

Paid search CPC sensitivity for Starter:

| Click-to-paid conversion | Max CPC for 3-month payback at ~$228 CAC |
|---:|---:|
| 1% | $2.28 |
| 2% | $4.56 |
| 5% | $11.40 |
| 10% | $22.80 |

Read: Starter can support high-intent search only if click-to-paid conversion is unusually good or CPC is modest. For broader paid acquisition, the funnel should push annual Starter or Growth.

## Recommendations

1. Keep $99/month as the floor, but do not make it a heavy video plan.

Starter should be a serious self-serve entry plan for image ads, app profiles, exports, and light UGC previews. It should not include unrestricted proof-backed AI UGC at 15 credits.

2. Split UGC into named cost routes.

Use:

- Image Ads: 2 credits each.
- UGC Preview: 15 credits each, cheap deterministic assembly.
- Proof-backed AI UGC: 60 credits each as the default planning number.
- Premium UGC: 200+ credits each or $49-$99/video cash add-on.

3. Add overage packs with higher per-credit pricing.

Subscription credits can be cheaper because they expire monthly. Overage should protect margin:

- $29 for 100 credits ($0.29/credit)
- $99 for 500 credits ($0.198/credit)
- custom/enterprise packs for premium UGC

4. Do not allow broad rollover.

Monthly credits should reset or have limited rollover. If credits roll forever, heavy users can arbitrage low-cost months into expensive UGC months.

5. Use annual prepay for paid acquisition.

If paid acquisition is part of the growth plan, offer annual:

- Starter annual around $990-$1,188 upfront.
- Growth annual around $2,490-$2,988 upfront.

This gives enough cash contribution to buy search/social traffic without waiting 6-12 months for payback.

6. Acquisition channel guidance.

Use paid ads first for:

- High-intent Google search: "mobile app ad creatives", "app ad generator", "app store screenshot ads", "UGC ads for apps".
- Retargeting people who already hit the pricing/demo pages.
- Creator/growth-team lookalikes only after the activation funnel is proven.

Avoid starting with broad Meta/LinkedIn unless the landing page points to annual/Growth, because $99 monthly cannot absorb high CAC with weak conversion.

7. Product metric gate before scaling paid ads.

Do not scale paid acquisition until these are measured:

- Visit -> paid conversion.
- Paid signup -> first app import.
- App import -> first generation.
- First generation -> second paid pack.
- Average credits consumed by route.
- Gross margin by route.
- 30-day retention and month-2 renewal.

## Bottom Line

The $99/month floor is sound if the product is disciplined about routing. The current image pricing is defensible. The current 15-credit UGC price is only defensible for cheap/template UGC, not proof-backed generated UGC.

For paid acquisition, the product should be designed around 80%+ blended gross margin, annual prepay, and Growth-plan expansion. Otherwise paid ads will force us to choose between weak CAC payback and overly restrictive usage limits.

## 2026-07-06 Update: Two Production Routes Only

Joe clarified that, for simplicity, Mobile Ad Agent should have only these production routes:

- UGC ads use the tested Gemini Omni flow.
- Image ads use Nano Banana 2.

Current official/public pricing anchors:

- Nano Banana 2 is Gemini 3.1 Flash Image (`gemini-3.1-flash-image`). Google lists image output pricing at $0.067 per 1K image, $0.101 per 2K image, and $0.151 per 4K image, plus $0.50 / 1M text/image input tokens.
- Gemini Omni Flash Preview (`gemini-omni-flash-preview`) is $17.50 / 1M video output tokens, billed at 5,792 tokens/second of 720p video, which Google describes as roughly $0.10/second.

### Average Variable COGS

These are planning averages for an approved/exportable ad, not just the raw provider call.

| Output | Raw provider cost | Added cost/retry assumption | Planning average COGS |
|---|---:|---:|---:|
| Nano Banana 2 image ad | ~$0.10 for 2K mobile-ad output | prompt/input, 20-30% retry/edit overhead, QA/storage/render | ~$0.13-$0.16 |
| Gemini Omni UGC ad | ~$1.00 for a 10s Omni block | 1.5-2.0 generated attempts avg, first-frame/image prep, deterministic proof cutaways/captions/CTA, QA/render/storage | ~$2.25-$3.25 |

Recommended planning numbers:

- Image ad average spend: $0.15.
- UGC ad average spend: $2.75.

### Credit Weight Implication

At the current plan ladder, per-credit value is:

| Plan | Price | Credits | Revenue/credit |
|---|---:|---:|---:|
| Starter | $99 | 600 | $0.165 |
| Growth | $249 | 2,000 | $0.1245 |
| Pro | $599 | 6,000 | $0.0998 |

If we kept the old prototype weights, margins would be too thin:

| Output | Credits | Starter revenue | Growth revenue | Pro revenue | Avg COGS | Read |
|---|---:|---:|---:|---:|---:|---|
| Image ad | 2 | $0.33 | $0.25 | $0.20 | $0.15 | OK on Starter, thin on Growth/Pro at high utilization |
| UGC ad | 15 | $2.48 | $1.87 | $1.50 | $2.75 | Negative or near-negative; not viable |

Recommended weights for the two-route product:

| Output | Credits | Starter revenue | Growth revenue | Pro revenue | Avg COGS | Margin range |
|---|---:|---:|---:|---:|---:|---:|
| Nano Banana 2 image ad | 4 | $0.66 | $0.50 | $0.40 | $0.15 | ~62%-77% |
| Gemini Omni UGC ad | 60 | $9.90 | $7.47 | $5.99 | $2.75 | ~54%-72% |

This is stricter than the earlier 2-credit image model, but it is safer if the product uses Nano Banana 2 rather than the cheapest Lite/batch route and if paid acquisition matters.

### Plan Capacity And Full-Utilization Margin

If every credit is used on images at 4 credits/image:

| Plan | Max image ads/mo | Cost at $0.15 each | Gross margin |
|---|---:|---:|---:|
| Starter | 150 | $22.50 | 77% |
| Growth | 500 | $75.00 | 70% |
| Pro | 1,500 | $225.00 | 62% |

If every credit is used on Gemini Omni UGC at 60 credits/ad:

| Plan | Max UGC ads/mo | Cost at $2.75 each | Gross margin |
|---|---:|---:|---:|
| Starter | 10 | $27.50 | 72% |
| Growth | 33 | $90.75 | 64% |
| Pro | 100 | $275.00 | 54% |

Important interpretation:

- Full-utilization Pro is the margin stress case because its per-credit price is lowest.
- Real margin improves if customers mix image ads and UGC, leave unused credits, buy overage packs, or prepay annually.
- If paid acquisition is central, Pro may need either fewer credits, higher price, or UGC fair-use limits to keep blended gross margin near 70%.

### Paid Acquisition Implication

At these route assumptions:

- Starter can afford paid CAC only if acquisition is high-intent or annualized.
- Growth is a better paid-acquisition target because contribution per customer is much higher.
- If broad paid social or LinkedIn-style acquisition has CAC above $300-$500, the funnel should push annual Starter/Growth rather than monthly Starter.

Practical CAC guardrails if blended gross margin lands around 70%:

| Plan | Monthly gross profit | 3-month CAC cap | 6-month CAC cap |
|---|---:|---:|---:|
| Starter | ~$69 | ~$200 | ~$400 |
| Growth | ~$174 | ~$520 | ~$1,040 |
| Pro | ~$419 | ~$1,250 | ~$2,500 |

### Updated Recommendation

For the simplified two-route product:

- Price image ads at 4 credits each if they are Nano Banana 2 outputs.
- Price Gemini Omni UGC ads at 60 credits each.
- Keep $99 / 600 credits as the floor, but frame Starter as roughly 150 image ads or 10 UGC ads per month.
- Add subscriber-only overage packs priced above subscription credit value, roughly $0.18-$0.25/credit or higher.
- Prefer annual prepay for paid acquisition.
- If we later prove Nano Banana 2 approved-output COGS is closer to $0.08 and Omni approved-output COGS is closer to $2.00, we can lower image ads to 3 credits and UGC to 45-50 credits. Do not do that before a benchmark.

### Credit Pack Role

Credit packs should be burst capacity, not the core business model. The subscription creates predictable ARR, app-profile memory, QA/review value, and CAC payback. Credit packs prevent users from being blocked in a launch week and monetize heavy usage at a higher margin than plan credits.

Recommended launch ladder:

| Pack | Credits | Price / credit | Approx output capacity |
| --- | ---: | ---: | --- |
| Quick top-up | 150 | $0.193 | ~37 image ads or 2 UGC ads |
| Standard top-up | 500 | $0.198 | ~125 image ads or 8 UGC ads |
| Studio burst | 1,100 | $0.181 | ~275 image ads or 18 UGC ads |

Rules:

- Only sell packs to active paid subscribers. Do not let credit packs become a standalone no-subscription entry path.
- Spend monthly plan credits first, then top-up credits.
- Top-up credits should not reset monthly, but generation should require an active paid subscription.
- Repeated top-up purchases should trigger upgrade prompts: sustained usage belongs in Growth or Pro, not in many one-off packs.
- Keep customer-facing copy generic: `image ads`, `UGC ads`, `credits`, and `top-up`. Do not expose backend provider/model names in pricing or purchase surfaces.

### Hormozi-Style Offer Improvements

Research notes:

- Acquisition.com's Money Models course organizes monetization around offer stacks, attraction offers, upsell offers, downsell offers, and continuity offers: https://www.acquisition.com/training/money/context
- Acquisition.com's Offers course centers offer creation, the value equation, bonuses, guarantees, scarcity/urgency, and naming: https://www.acquisition.com/training/offers
- The practical value-equation lens is: perceived value rises with dream outcome and likelihood, and falls with time delay and effort/sacrifice. Applied here, Mobile Ad Agent should sell a faster, safer launch result rather than raw AI generation volume.
- Current AI ad competitors commonly sell low/free entry plans or generic ad credits, e.g. AdCreative.ai listing $39/mo starter-style pricing and Creatify describing free monthly credits. Mobile Ad Agent should not compete as the cheapest generator; it should compete as the app-specific creative factory with app-profile memory, real screenshot extraction, claim discipline, and QA.

Offer changes to test:

1. Rename plans around outcomes, not usage.
   - Starter: `Launch Pack` or `First 150 Ads`
   - Growth: `Creative Testing Engine`
   - Pro: `App Studio / Agency Engine`
   Keep credits visible inside the plan, but make the plan headline about the result.

2. Make the first paid moment feel like a launch sprint.
   - Keep the $99/mo floor.
   - Frame the first month as: import one app, build its app profile, create the first paid creative pack, QA it, and export it.
   - Main promise: `Go from app URL to a reviewed ad pack today.`

3. Stack low-COGS bonuses that remove objections.
   - App ad readiness score.
   - Store screenshot/source check.
   - 30-hook angle map.
   - Claims/screenshot safety pass.
   - Launch checklist for Meta/TikTok/ASA handoff.
   - Agent handoff prompt/API export.
   These should be named as bonuses in the pricing/checkout surface, not hidden as generic features.

4. Add a conditional quality guarantee, not a ROAS guarantee.
   - Suggested language: `If your first pack does not produce at least one usable ad candidate after valid app info/screenshots are provided, we rerun it or credit the pack back.`
   - Avoid promising ad-network performance, revenue, installs, or ROAS.

5. Use credit packs as the upsell offer.
   - Trigger when a user is already in momentum: after approving ads, before export, or when a generation run exceeds balance.
   - Position as `launch-week top-up`, not a generic token purchase.
   - Keep subscriber-only and more expensive per credit than plans.

6. Use annual/quarterly prepay as the money-model lever for acquisition.
   - Reward upfront payment with extra credits, launch-review bonuses, or priority QA instead of discounting monthly price.
   - For paid ads, the default landing path should push annual Starter or Growth because CAC payback is healthier than monthly Starter.

7. Build downsells without cheapening the product.
   - If Growth is rejected, offer Starter plus a paid top-up, not a discounted Growth plan.
   - If annual is rejected, offer quarterly.
   - If Pro is rejected, offer Growth plus an agency credit pack.

8. Add honest scarcity around high-touch bonuses only.
   - Example: `Manual launch audit included for the first 50 launch partners` or `5 app-studio onboarding slots this week.`
   - Do not create fake scarcity around self-serve generation.

9. Strengthen continuity beyond monthly credits.
   - The reason to stay subscribed should be that App Profile memory, learning events, QA history, approved claims, and creative performance notes compound over time.
   - Monthly credits are usage; app memory and learning are retention.

### Attraction Offer

The attraction offer should not be free generated ads. It should be a low-cost diagnostic that creates the "I want this pack now" moment while preserving Joe's paid-from-the-first-generation rule.

Recommended primary attraction offer:

`Free App Ad Readiness Scan`

User action:

- Paste an App Store, Play Store, or website URL.
- No card required for the scan.
- Email/workspace capture required before revealing the full report.

What the scan gives:

- App summary.
- Best ad angles found from store/app info.
- Screenshot/source quality score.
- Key features ads can safely mention.
- Claim/screenshot risk flags.
- Estimated first-pack output: `Your app is ready for a 10-ad launch pack` or `Add screenshots first`.
- Locked teaser grid: show the planned pack structure and blurred/placeholder ad slots, not generated ads.

What it must not give:

- No free generated image ads.
- No free UGC ads.
- No downloadable creative.
- No backend route/model names.
- No fake preview if real screenshots/source material are missing.

Conversion path:

1. Scan complete.
2. Show a clear "ready / not ready" verdict.
3. CTA: `Generate the reviewed launch pack`.
4. Offer $99/mo Launch Pack with the first 600 credits, quality guarantee, and bonuses.
5. If user hesitates, offer a paid activation deposit: `$29 Launch Review`, credited toward the first month if they upgrade within 7 days. This is an optional downsell/bridge, not a cheaper plan.

Why this works:

- Dream outcome: user sees how their app can become an ad pack.
- Perceived likelihood: the scan uses their actual listing/screenshots and shows specific angles/risks.
- Time delay: result appears immediately after URL import.
- Effort: one URL, no manual prompt writing.
- COGS stays low because the free step is app-info extraction and planning, not render/generation.

Optional paid acquisition hook:

`Paste your app URL. See what ads your app is ready for in 60 seconds.`

This is a stronger ad promise than `AI ad generator` because it sells the diagnosis and the first specific next step, not generic creative volume.

### Acquisition AI Advisor Pass

On 2026-07-06, ACQ AI was asked to review the Mobile Ad Agent attraction offer and overall money model with these constraints: no free generated ads, no no-card generation path, $99/mo floor, subscription + credits + subscriber-only top-up packs, and no backend model/provider names in user-facing copy.

The strongest repeated ACQ recommendation was more aggressive than a free diagnostic: use a paid, time-boxed attraction offer that liquidates CAC and then rolls into continuity.

Recommended ACQ-style attraction offer:

`Launch Sprint Pilot` / `Launch Vault Pilot`

Suggested pricing range:

- $249-$399 one-time for a lighter same-day launch pack.
- $499 one-time for a launch-vault pilot with stronger deliverables.
- $1,000-$1,500 one-time if a live onboarding / QA session is included and the target is a serious UA team.

Suggested deliverables:

- 1 app profile / creative brief built from the store URL.
- 40 image ads and 4-10 UGC ads, QA'd and export-ready.
- Creative map: hooks, angles, safe claims, and source/screenshot notes.
- Export presets / handoff checklist for paid-social launch.
- Optional live onboarding / mapping call for the higher-priced pilot.

Success metric:

- At least 20-30 net-new creatives approved/export-ready the same day for normal self-serve packs, or within the promised SLA for high-touch packages.
- Cost per usable creative materially below the customer's agency / in-house baseline.
- A documented testing backlog for the next 30-60 days.

Risk reversal:

- Do not guarantee ROAS, installs, CAC, or ad-network performance.
- Guarantee creative throughput / usable output instead: if they complete onboarding and follow the launch checklist but do not have at least 20 launchable creatives within the promised delivery window, rerun or extend access and add bonus credits.

Recurring path after pilot:

- Default roll into Growth / Creative Engine, not the cheapest plan.
- Keep a $99 Launch Plan available as a save/downsell, but do not make it the main paid-acquisition destination.
- ACQ variants suggested raising the ladder to something like $149-$299 entry, $399 main, and $799-$899 Pro once proof is strong. For now, keep Joe's $99/mo floor but consider making the paid pilot the acquisition offer so first-30-day cash is higher than $99.

Credit-pack guidance from ACQ:

- Rename packs to `Burst Packs`, `Launch Burst`, or `Surge Packs`.
- Trigger packs only after user momentum or when a run exceeds balance.
- Keep credits as the meter, but sell the output / launch outcome in copy.

ACQ warnings:

- Do not sell "credits" as the front-end product.
- Do not offer free generation, no-card trials, or free AI token bundles.
- Do not race competitors on per-credit price.
- Do not compete as a generic AI ad generator; compete as the mobile-app creative factory for launch throughput.

Best reconciled recommendation:

- Public attraction: `Paste your app URL. See the launch plan in 60 seconds.`
- Paid attraction / CAC-liquidator: `Launch Sprint Pilot`, $499-$1,000 one-time depending on high-touch support.
- Continuity: roll successful pilots into Growth / Creative Testing Engine; keep $99 Launch Pack as the self-serve floor and downsell.

### Acquisition AI Full Money Model Pass

ACQ AI was then asked specifically for the full money model from attraction offer through upsells, downsells, and continuity offers.

ACQ's one-sentence model:

> Turn a paid launch offer into a break-even-or-better first 30 days, then stack recurring Growth/Pro plans, burst packs, and annual prepay so each app can be worth 5-10x CAC within 12 months.

Recommended offer architecture:

1. Attraction offer:
   - Name: `Launch Pack: Same-Day Creative Sprint`
   - Price: $249 one-time.
   - Promise: `Turn your App Store / Play Store page into 40+ ready-to-run image and UGC ads today, without a single brief or shoot.`
   - Deliverables: app profile setup, safe claims/angle map, 24 image ads, 4 UGC ads, and one revision round.
   - Guarantee: if the customer does not have at least 20 approvable ads from the first pack within the promised delivery window, generate 20 more variants free. No install/ROAS/CAC guarantee.
   - Target: apps spending or preparing to spend at least ~$5k/mo on paid UA.
   - Not for: hobby apps, no ad budget, or buyers who only want a one-off design gig.

2. Core continuity:
   - Keep credits as the internal meter, but sell output/cadence in UI.
   - `Launch` / $99/mo / 600 credits: enough to keep one small campaign fresh. Actual max capacity: 150 image ads or 10 UGC ads.
   - `Scale` / $249/mo / 2,000 credits: primary target. Ongoing creative testing for 1-2 serious ad accounts. Actual max capacity: 500 image ads or 33 UGC ads.
   - `Studio` / $599/mo / 6,000 credits: in-house creative studio for multi-channel UA teams. Actual max capacity: 1,500 image ads or 100 UGC ads.
   - All plans include App Profile memory, QA, safe-claims library, learning history, and export handoff.

3. Upsells:
   - Subscriber-only `Burst Packs`: $29 / 150 credits, $99 / 500 credits, $199 / 1,100 credits.
   - Annual prepay: 12 months for the price of 10, or equivalent bonus credits / priority QA rather than a heavy visible discount.
   - Priority QA & Review add-on: +25% plan price for 24h SLA, priority queue, compliance double-check, and launch-ready stamp.
   - Multi-app/team: additional app workspace $49/mo on Launch/Scale, $99/mo on Studio; extra seats around $19/mo/user.
   - Agency/API: start around $1,499/mo with larger credits, API, shared templates, white-label exports, and unlimited/many workspaces.
   - Done-with-you sprint: `App Launch Lab: 4-Week Creative Sprint`, around $3,000 one-time, capped seats, includes weekly strategy calls and best-practice playbook.

4. Downsells:
   - If Launch Pack is rejected: `Image-Only Launch Pack`, $149, 30 image ads, no UGC, no calls.
   - If annual is rejected: monthly plan, but without annual bonuses.
   - If Growth/Pro is rejected: $99 Launch plan plus recommended planned Burst Pack cadence.
   - If high-touch support is rejected: standard SLA, no discount.
   - Principle: feature downsell, not price negotiation.

5. Continuity:
   - Core retention promise: `Don't let your creative system and learnings die.`
   - App Profile memory stores brand kit, approved claims, do/don't-show list, source/screenshot notes.
   - Learning events tag ads by hook, feature, format, approval/rejection, and results notes.
   - QA history and review patterns make future packs faster and more aligned.
   - Creative fatigue creates an ongoing cadence: Launch 10-20 new ads/month, Scale 30-60/month, Studio 80-150/month.

6. Safe risk reversal:
   - Guarantee turnaround, minimum deliverables, quality/regeneration, and claim-source safety.
   - Never guarantee installs, ROAS, CAC, revenue, or ad-network performance.

7. Conversion path:
   - Ad: `Turn your App Store page into 40+ ready-to-run ads today.`
   - Landing page: visual examples, before/after launch pack, proof of workflow.
   - CTA: `Start Launch Pack - $249.`
   - Step 1: paste URL.
   - Step 2: preview pulled app assets and choose channels/goals.
   - Step 3: checkout before generation.
   - After first pack approval: prompt upgrade to Scale/Growth monthly or annual with bonus Burst Pack.

8. Metrics:
   - Click-to-Launch-Pack purchase rate.
   - Average first-day and first-30-day cash per customer.
   - Blended CAC versus first-day / first-30-day revenue.
   - Plan mix and Growth/Pro share.
   - Credit consumption in first 30 days.
   - Expansion revenue from Burst Packs / upgrades within 60 days.
   - Day-30 and day-90 logo retention by segment.

ACQ warnings:

- Do not lead with free generation, free sample ads, no-card trials, or a playground UI.
- Do not lead with AI or credits. Lead with testing volume and speed.
- Do not price/message like a generic AI toy. Mobile Ad Agent should be the mobile app creative testing system.
- Do not sell one-off pretty designs; frame the product around ongoing creative testing for real ad spend.

Reconciled decision:

- Keep Joe's $99/mo floor, but do not make it the main paid-acquisition offer.
- Use a $249 paid Launch Pack / Same-Day Creative Sprint as the front-end CAC-liquidating attraction offer.
- Sell `Scale` / Growth at $249/mo as the default continuity target.
- Keep credits visible where needed for metering, but customer-facing pricing should emphasize creative cadence, launch throughput, and app-specific learning memory.

### Acquisition AI Speed-Corrected Pass

After Joe challenged the `ads in 30 days` framing, ACQ AI was asked again with the explicit correction that Mobile Ad Agent can generate the first pack within minutes / same day. The revised ACQ recommendation:

1. Attraction offer:
   - Use a paid `Same-Day Launch Pack`.
   - Price: $249, positioned as the first-month launch pack.
   - Promise: `Get a complete, ad-ready creative pack for your app today, plus a 30-day testing roadmap.`
   - Do not make a separate free URL audit the main attraction offer. Fold the audit into the paid pack as the first step.

2. Deliverables:
   - First app-specific image pack sized for paid channels.
   - One UGC-style concept / asset route.
   - App-safe claims and feature bank.
   - 30-day creative testing plan: what to launch, when to rotate, and how to tag results.

3. Guarantees:
   - Same-day / 24-hour delivery guarantee after valid app source material is provided.
   - If the first pack misses the promised delivery window, credit a second pack or rerun.
   - Fit guarantee: if assets are off-brief or non-compliant, fix/replace them within 48 hours or credit those assets back.
   - Still no installs, ROAS, CAC, revenue, or ad-network performance guarantees.

4. Landing-page promise:
   - Hero: `Turn your App Store URL into a complete ad campaign today.`
   - Subhead: `Drop in your App Store / Play Store / landing page URL and get tested angles, static ads, and UGC concepts you can launch today.`
   - CTA: `Get My Same-Day Launch Pack`.
   - Do not mention credits or backend AI/model routes above the fold.

5. Where 30-day language belongs:
   - `30-day creative testing plan included.`
   - `Designed for your first 30 days of testing and iteration.`
   - `Review results after 30 days and decide whether to scale, iterate, or pause.`
   - Do not use 30-day language for generation, delivery, or first-pack value.

6. Continuity:
   - `Launch` / $99/mo: maintain 1-2 active campaigns.
   - `Growth` / $249/mo: primary continuity target, weekly testing for 1-3 apps.
   - `Studio` / $599/mo: portfolio / agency / multi-app creative production.
   - External copy should talk campaigns, packs, and number of apps; credits stay as internal meter / account detail.

7. Upsells and downsells:
   - Burst Packs remain subscriber-only and sold when usage nears limit.
   - Annual prepay should add bonus credits / priority QA / strategy support rather than making the product look discounted.
   - Priority QA, multi-app workspaces, team seats, API/agency plan, and done-with-you strategy session remain good upsells.
   - Downsells: image-only starter pack, lower plan, or pause/read-only library access; avoid direct price negotiation.

Updated decision:

- Replace `30-Day Creative Sprint` naming with `Same-Day Launch Pack` / `Same-Day Creative Sprint`.
- Keep any 30-day wording strictly tied to testing plans, learning loops, CAC payback, usage, and campaign review.
- The strongest customer promise is speed plus specificity: URL in, app-safe launch creatives out today.

### Acquisition Strategy And CAC Support

Current 2026 paid-media benchmarks used for context:

- Cross-industry Google Search CPC is around $2.96 in Q1 2026, but B2B/software can be materially higher.
- B2B Google Ads benchmark data shows average CPC around $6.29 and cost/conversion around $606 across B2B campaigns.
- LinkedIn B2B benchmarks commonly show CPC around $5.58-$10.11, with tighter/senior targeting often $10-$15.
- Meta/Facebook CPC benchmarks are lower, around $1-$2 broadly, but colder traffic usually converts weaker for B2B SaaS.

Sources:

- https://www.digitalapplied.com/blog/google-ads-benchmarks-2026-cpc-ctr-cvr-industry
- https://intel.42agency.com/b2b-benchmarks/google-ads-benchmarks/
- https://www.theb2bhouse.com/linkedin-ad-benchmarks/
- https://intel.42agency.com/b2b-benchmarks/linkedin-ads-benchmarks/
- https://www.digitalapplied.com/blog/facebook-ads-benchmarks-2026-cpc-cpm-ctr-industry

Conservative monthly contribution after variable generation COGS and ~3% payment processing:

| Plan | Full-use margin range | Monthly contribution range | 3-month CAC cap | 6-month CAC cap |
|---|---:|---:|---:|---:|
| Starter $99 | ~72%-77% | ~$68-$73 | ~$200-$220 | ~$400-$440 |
| Growth $249 | ~64%-70% | ~$152-$167 | ~$455-$500 | ~$910-$1,000 |
| Pro $599 | ~54%-62% | ~$305-$353 | ~$915-$1,060 | ~$1,830-$2,120 |

Launch CAC targets should be lower than theoretical caps:

| Plan sold | Target CAC | Stretch CAC | Only acceptable when |
|---|---:|---:|---|
| Starter monthly | <$150 | $200-$250 | High-intent click, strong activation, month-2 retention proven |
| Starter annual | $250-$450 | $500+ | Upfront cash collected and usage limits intact |
| Growth monthly | <$350 | $500-$650 | Buyer shows real creative volume / app studio use case |
| Growth annual | $600-$1,000 | $1,200+ | Annual prepay or strong sales-assisted signal |
| Pro / agency | <$800 | $1,000-$1,500+ | Sales-assisted, team/agency volume, annual preferred |

Break-even CPC by visit-to-paid conversion rate:

| CAC cap | 1% conversion | 2% conversion | 5% conversion | 10% conversion |
|---:|---:|---:|---:|---:|
| $200 Starter cap | $2 CPC | $4 CPC | $10 CPC | $20 CPC |
| $500 Growth cap | $5 CPC | $10 CPC | $25 CPC | $50 CPC |
| $1,000 Pro cap | $10 CPC | $20 CPC | $50 CPC | $100 CPC |

Channel strategy:

1. Google Search / high-intent demand capture should be first.

Target terms such as `mobile app ad generator`, `app ad creatives`, `UGC ads for apps`, `app store screenshot ads`, `AI ad creative generator`, `mobile app marketing creatives`, and competitor/category terms. These clicks may be expensive, but they are the most likely to convert directly into Starter/Growth.

2. Retargeting should run early.

Retarget pricing-page visitors, demo viewers, app-import starters, and people who see sample outputs. This is where lower Meta/YouTube/Display CPC can work because the audience is warmed.

3. LinkedIn/ABM should not sell Starter.

LinkedIn CPC/CPL is too high for a $99 monthly customer unless conversion is exceptional. Use it for Growth/Pro, annual, agency, app-studio, and creative-lead offers. The landing page should push demos, annual plans, or team volume rather than monthly Starter.

4. Paid social cold prospecting should be creative-led, not feature-led.

Use Mobile Ad Agent outputs as the ad creative: before/after app URL -> generated ad pack, real app screenshots -> Omni UGC. The goal is to prove the product visually and push to demo/import, not explain every workflow.

5. Do not scale paid acquisition until the activation funnel is measured.

Required gates:

- visit -> paid conversion by channel,
- paid signup -> first app import,
- app import -> first generation,
- first generation -> second pack,
- usage mix between image and UGC,
- month-2 retention,
- gross margin by route.

Practical acquisition conclusion:

- If most buyers are Starter monthly, keep blended CAC under ~$150-$200.
- If the funnel reliably sells Growth/annual, blended CAC can move toward ~$350-$600.
- If sales-assisted Pro/agency appears, $1,000+ CAC is supportable, but only with annual or strong retention proof.
- A healthy first paid-media target is blended CAC <$300 with at least 30-40% of conversions on Growth or annual Starter.
