# Mobile Ad Agent — Local Prototype Implementation Map (2026-07-06)

This maps the architecture objects from `mobile-ad-agent-robust-plan-2026-07-06.md` (section 6)
to where they exist in the local prototype today. The prototype is deliberately local-only:
no Firebase, no R2, no generation providers, no ad-network mutations (`providerMutations: 0`).

## Surfaces

| Plan surface | Prototype location |
|---|---|
| Home / Same-Day Launch Pack + Pricing | `local-app/landing/` (served at `/`, `/pricing`, and `/launch-pack`) |
| Preview / URL import | `local-app/index.html` + `app.js` anonymous preview state (served at `/preview` and `/app/import`) |
| Apps / App Profile / Review App Info | `local-app/index.html` + `app.js` home view (`renderExtractionReview`, `renderAppInfoReview`; served under `/app`) |
| Generate Pack | Generate modal (`openGenerate`, credit costs 4/60, upsell when short) |
| Review Drafts | Ad grid (`renderAds`, `decideAd`: approve / reject / tweak note / regenerate) |
| QA & Export | Handoff modal (`renderHandoff`: readiness, holds, pack contents, manifest.json download) |
| Packs | "Packs" tab (`renderRuns`) |
| Billing | Billing view (`renderCredits`: Launch/Scale/Studio, top-ups, ledger) |

## Architecture objects → prototype state

| Object (plan §6) | Prototype representation |
|---|---|
| `organizations` / `users` / `subscriptions` | Not modeled. Single implicit workspace; `state.credits.plan` stands in for the subscription. |
| `creditBalances` / `creditTransactions` | `state.credits` (`balance`, `monthly`, `topUpCount`) + `state.credits.ledger` (`recordCreditTransaction`). |
| `costLedger` | `buildCostLedger` in `lib/local-pipeline.mjs` (all-zero local mock). |
| `apps` | `state.apps[]` (`id`, `name`, `source`, `iconUrl`, `entrySource`). |
| `appProfiles` | Per-app `tagline` (summary), `claims` (key features), `style`, `angles`, `reviewSignals`. |
| `appIntakes` | `/api/extractions/from-url` → `lib/local-extraction.mjs` (`schemaVersion: local-app-extraction.v1`, holds in `reviewSummary.holds`). |
| `assets` / `sourceScreenshots` | Per-app `screens[]` with `sourceType`, `trustLevel`, `usability` judgement (`screenJudgement`), upload path (`openScreenshotPicker`). |
| `claimCandidates` | Extraction `claimCandidates[]` → per-app `claims[]` with `supported`/`selected`. |
| `creativePacks` / `creativeJobs` | Per-app `runs[]` (cooking → ready → exported) + `runLocalCreativePipeline` job object. |
| `creativeBriefs` | `buildCreativeBrief` in `lib/local-pipeline.mjs`. |
| `generatedCreatives` | Per-app `ads[]` (`format`, `caption`, `angle`, `screenId`, `status`, `tweakNote`). |
| `qaReports` | `buildQaReport` (pipeline) + customer-safe `exportChecks` in the QA & Export modal. |
| `reviewDecisions` | Per-app `reviewDecisions[]` (`recordReviewDecision`). |
| `learningEvents` | Per-app `learningEvents[]` (`learningEventFor`): liked/rejected angles, tweak notes, angle parking after repeated rejects; shown in App info "Learning memory" and next-pack framing. |
| `exports` / `handoffs` | QA & Export modal; `downloadPackManifest` writes `mobile-ad-agent.pack-manifest.v1` JSON; `/api/jobs/manifest` returns the pipeline manifest. |
| `auditEvents` | Manifest `audit` block only; no separate event log yet. |

## Copy rules enforced in this slice

- Customer-facing terms only: image ads, UGC ads, app info, app profile, screenshots, credits, packs, export.
- No provider/model/backend names in UI or API payloads; `scripts/smoke-local-app.mjs` fails if
  provider names leak into `/api/jobs/*` payloads.
- No free generation path: generation and regeneration always cost credits (4 image / 60 UGC);
  top-ups are subscriber-only ($29/150, $99/500, $199/1,100); repeated top-ups nudge an upgrade.
- Guarantee language: delivery/usable-quality only, never installs/ROAS/CAC/revenue.
- "30-day" appears only for the testing roadmap, never for generation speed.

## Launch Annual upsell (2026-07-07)

- State (`app.js`): `LAUNCH_ANNUAL` constants ($1,188 → $990 → $741, 7-day window),
  `state.launchPackCredit` (amount/purchasedAt/expiresAt/status available|applied|expired),
  `state.billing` (interval, renewsAt, priceLockUntil), `state.annualEntitlements`
  (winnersVault, priceLock, quarterlyAudit.nextDueAt), `state.upsellTouchpoints`
  (postCheckout/draftsReady/postExport, dismissed, mock `emails`), `state.clockOffsetDays`
  (dev fake clock: `?dev=1` shows +1/+3 day buttons to demo day-5 banner and silent day-8 expiry).
- T1 post-checkout: `renderUpsellTouch` — confirmation leads with the Launch Pack, soft
  annual card below (See Launch Annual / Maybe later). No countdown, no takeover.
- Annual sheet: `#annualModal` + `renderAnnualSheet` — price math, three annual-only
  bonuses, Apply my $249 — $741 today / Not now. `applyLaunchAnnual` flips billing,
  entitlements, credit → applied.
- T2 drafts-ready: `renderAnnualBanner` — slim dismissible banner above the ad grid;
  never blocks approve/reject/tweak/export.
- T3 export: `annualExportPanelHtml` in the handoff modal — Apply $249 → $741 today /
  Continue monthly at $99/mo (monthly never gets the credit).
- Billing: `annualBillingCardHtml` — credit-available line during the window (silently
  gone after expiry; annual stays $990), entitlements when annual active; `mockEmailsHtml`
  lists prototype email touchpoints (receipt PS, drafts-ready PS, 48-hour reminder).
- Smoke (`scripts/smoke-local-app.mjs`): pins the price math/credit window, credit
  expiry/apply states, soft CTAs, no credit-toward-monthly framing, no countdowns, and
  copy guards (provider names + installs/ROAS/revenue) across all local-app surfaces.

## Intentionally mocked / deferred

- Checkout, auth, orgs/seats: mock buttons and toasts only.
- Generation renders placeholder cards; media files in exports are mocked.
- The `/api/jobs/*` pipeline still runs the PepMod sample profile, not the active app in the UI.
- Learning events adjust angle selection and framing locally; no persistence across reloads.
- URL extraction requires `GEMINI_API_KEY` at runtime (internal; never named in customer surfaces).
