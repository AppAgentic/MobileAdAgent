import { strict as assert } from 'node:assert';
import { createTenantStore } from '../lib/local-tenant-store.mjs';
import {
  buildPackPlanResearchSnapshot,
  buildSelectedProductTruth,
} from '../lib/pack-plan-model.mjs';
import { resolveGenerationAdapters } from '../lib/generation-adapters.mjs';
import { runCreativeJob } from '../lib/local-job-runner.mjs';

let clock = Date.UTC(2026, 6, 10, 9, 0, 0);
const now = () => (clock += 500);
const isoNow = () => new Date(now()).toISOString();

const extraction = {
  schemaVersion: 'local-app-extraction.v1',
  jobId: 'extract-pack-plan-flow',
  source: 'anonymous_preview',
  url: 'https://apps.apple.com/us/app/focus-flow/id123456789',
  createdAt: isoNow(),
  providerMutations: 0,
  platform: 'app_store',
  app: {
    name: 'Focus Flow',
    category: 'Productivity',
    subtitle: 'Plan one focused block at a time',
    storeUrl: 'https://apps.apple.com/us/app/focus-flow/id123456789',
    summary: 'Focus Flow helps people plan focused work blocks and review completed sessions.',
    description: 'Plan focused work blocks and review completed sessions.',
  },
  uiObjects: [{
    id: 'screen-focus-plan',
    title: 'Focus plan',
    description: 'A first-party screen showing one planned focus block.',
    sourceType: 'raw_app_proof',
    sourceUrl: 'https://cdn.example-store.test/focus-plan.png',
    usability: { status: 'recommended', label: 'Looks usable', reason: 'Reviewed first-party app proof.' },
  }],
  claimCandidates: [{
    id: 'claim-focus-plan',
    text: 'Plan focused work blocks.',
    source: 'App Store description',
    selected: true,
    confidence: 'high',
  }],
  reviewSummary: { screenCount: 1, claimCount: 1, rawifyCandidateCount: 0, holds: [] },
  styleNotes: ['Plain language'],
};

const store = createTenantStore({ now });
const boot = store.bootstrapUser({ email: 'pack-plan-flow@example.test' });
const claimed = store.claimPreview({
  uid: boot.uid,
  email: boot.email,
  previewSessionId: 'preview-pack-plan-flow',
  canonicalAppId: 'app-store-123456789',
  extraction,
  productId: 'launch_pack',
});
const context = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: claimed.app.appId };
const marketSignal = {
  id: 'public-signal-focus-overwhelm',
  kind: 'community_discussion',
  theme: 'Too many planning choices can feel like more work',
  paraphrase: 'A cited public discussion describes abandoning productivity tools when planning becomes too elaborate.',
  observedItemCount: 1,
  source: {
    platform: 'Public discussion',
    url: 'https://community.example.test/focus/simple-planning',
    capturedAt: isoNow(),
  },
  canSupportProductClaim: false,
};
const firstResearch = buildPackPlanResearchSnapshot({
  productTruth: buildSelectedProductTruth(claimed.app),
  marketSignals: [marketSignal],
  capturedAt: isoNow(),
});
const firstPlan = store.createPackPlanForUser({
  ...context,
  researchSnapshot: firstResearch,
  strategy: null,
  imageCount: 1,
  videoCount: 0,
  goal: 'Find the clearest opening angle.',
  channel: 'Paid social',
  idempotencyKey: 'flow-plan-1',
});

assert.equal(firstPlan.plan.creativeDebitStatus, 'not_charged');
assert.equal(firstPlan.plan.research.coverage.sourceCount, 1);
assert.equal(firstPlan.plan.research.marketSignals[0].canSupportProductClaim, false);
assert.equal(firstPlan.app.packPlanStatus, 'proposed');
const cachedPlanRequest = store.readPackPlanRequestForUser({ ...context, idempotencyKey: 'flow-plan-1' });
assert.equal(cachedPlanRequest.idempotent, true);
assert.equal(cachedPlanRequest.plan.planId, firstPlan.plan.planId);

const pack = store.createPackForUser({
  ...context,
  imageCount: 1,
  videoCount: 0,
  packPlanId: firstPlan.plan.planId,
  idempotencyKey: `pack-from-${firstPlan.plan.planId}`,
});
assert.equal(pack.pack.packPlanId, firstPlan.plan.planId);
assert.equal(pack.pack.costCredits, 4);
assert.equal(pack.creditBalance, 332);

const created = store.createGenerationJob({ ...context, packId: pack.pack.packId });
const finished = await runCreativeJob({
  store,
  ...context,
  jobId: created.job.jobId,
  adapters: resolveGenerationAdapters({}),
  now,
});
assert.equal(finished.status, 'completed');
assert.equal(finished.drafts.length, 1);

const draft = store.readAppForUser(context).ads.find((item) => item.packId === pack.pack.packId);
assert.ok(draft, 'finished draft should be attached to its paid pack');
const review = store.recordReviewDecisionForUser({
  ...context,
  packId: pack.pack.packId,
  draftId: draft.id,
  action: 'approved',
  format: draft.format,
  angle: firstPlan.plan.experiment.primary.angle,
  idempotencyKey: 'flow-review-approved',
});
assert.equal(review.learningEvent.type, 'liked_angle');
assert.equal(review.learningEvent.polarity, 'positive');

const learnedApp = store.readAppForUser(context);
const learningSignals = learnedApp.learningEvents.map((event) => ({
  eventId: event.eventId,
  type: event.type,
  polarity: event.polarity,
  angle: event.angle,
  instruction: event.instruction,
  sourceDecisionId: event.sourceDecisionId,
  createdAt: event.createdAt,
}));
const nextResearch = buildPackPlanResearchSnapshot({
  productTruth: buildSelectedProductTruth(learnedApp),
  marketSignals: [marketSignal],
  learningSignals,
  capturedAt: isoNow(),
});
const nextPlan = store.createPackPlanForUser({
  ...context,
  researchSnapshot: nextResearch,
  strategy: null,
  imageCount: 1,
  videoCount: 0,
  goal: 'Use the prior review to choose the next controlled test.',
  channel: 'Paid social',
  idempotencyKey: 'flow-plan-2',
});

assert.equal(nextPlan.planRevision, 2);
assert.equal(nextPlan.plan.research.learningSignals.length, 1);
assert.equal(nextPlan.plan.research.learningSignals[0].sourceDecisionId, review.decision.decisionId);
assert.ok(nextPlan.plan.experiment.primary.evidenceRefs.includes(review.learningEvent.eventId));
assert.equal(nextPlan.plan.providerMutations, 0);

console.log('Pack Plan lifecycle test passed');
console.log(JSON.stringify({
  firstPlanId: firstPlan.plan.planId,
  packId: pack.pack.packId,
  decisionId: review.decision.decisionId,
  nextPlanId: nextPlan.plan.planId,
  nextPlanRevision: nextPlan.planRevision,
  providerMutations: 0,
}, null, 2));
