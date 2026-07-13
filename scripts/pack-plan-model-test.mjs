import assert from 'node:assert/strict';
import {
  CREATIVE_PACK_PLAN_SCHEMA_VERSION,
  LEARNING_EVENT_SCHEMA_VERSION,
  PACK_PLAN_RESEARCH_SCHEMA_VERSION,
  REVIEW_DECISION_SCHEMA_VERSION,
  buildCreativePackPlan,
  buildLearnedPackPlanStrategy,
  buildPackPlanResearchSnapshot,
  buildReviewDecisionLearningPair,
  buildSelectedProductTruth,
  customerSafeCreativePackPlan,
  validateCreativePackPlan,
  validatePackPlanResearchSnapshot,
} from '../lib/pack-plan-model.mjs';

const capturedAt = '2026-07-10T10:00:00.000Z';
const createdAt = '2026-07-10T10:01:00.000Z';

const app = {
  id: 'example-app',
  appId: 'example-app',
  name: 'Example App',
  source: 'App Store',
  tagline: 'Example App helps people plan routines and review their progress.',
  extraction: { app: { storeUrl: 'https://apps.apple.com/us/app/example/id123456789' } },
  claims: [
    { id: 'claim-plan', text: 'Plan a daily routine.', source: 'App Store description', selected: true, supported: true },
    { id: 'claim-progress', text: 'Review progress in one place.', source: 'App Store description', selected: true, supported: true },
    { id: 'claim-ignored', text: 'Ignored feature.', selected: false, supported: true },
  ],
  screens: [
    {
      id: 'screen-plan',
      label: 'Routine planner',
      detail: 'A reviewed screen showing the routine planner.',
      sourceType: 'raw_app_proof',
      sourceUrl: 'https://cdn.example.test/plan.png',
      storageKey: 'orgs/org-a/workspaces/ws-default/apps/example-app/source/screen-plan',
      selected: true,
      usability: 'recommended',
    },
    {
      id: 'screen-progress',
      label: 'Progress overview',
      detail: 'Google Play screenshot candidate. Rawify before UI extraction with Gemini Omni. Stage: pre_rawification.',
      sourceType: 'store_art',
      sourceUrl: 'https://cdn.example.test/progress.png',
      storageKey: 'orgs/org-a/workspaces/ws-default/apps/example-app/source/screen-progress',
      selected: true,
      usability: 'recommended',
    },
  ],
};

const truth = buildSelectedProductTruth(app);
assert.ok(Object.isFrozen(truth));
assert.equal(truth.filter((item) => item.kind === 'claim').length, 2);
assert.equal(truth.filter((item) => item.kind === 'screen').length, 2);
assert.ok(truth.filter((item) => item.kind === 'screen').every((item) => item.canSupportProductClaim === false));

// Low-evidence fallback must be explicit and must never invent market counts,
// sources, reviews, or community discussions.
const emptyResearch = buildPackPlanResearchSnapshot({
  productTruth: truth,
  marketSignals: [],
  learningSignals: [],
  capturedAt,
});
assert.equal(emptyResearch.schemaVersion, PACK_PLAN_RESEARCH_SCHEMA_VERSION);
assert.equal(emptyResearch.coverage.level, 'none');
assert.equal(emptyResearch.coverage.marketSignalCount, 0);
assert.equal(emptyResearch.coverage.observedItemCount, 0);
assert.equal(emptyResearch.coverage.sourceCount, 0);
assert.deepEqual(emptyResearch.coverage.sources, []);
assert.deepEqual(emptyResearch.marketSignals, []);
assert.ok(Object.isFrozen(emptyResearch));
validatePackPlanResearchSnapshot(emptyResearch);

const fallbackPlan = buildCreativePackPlan({
  orgId: 'org-a',
  workspaceId: 'ws-default',
  appId: app.appId,
  createdBy: 'user-owner',
  createdAt,
  researchSnapshot: emptyResearch,
  outputMix: { image: 5, ugc: 3 },
});
assert.equal(fallbackPlan.schemaVersion, CREATIVE_PACK_PLAN_SCHEMA_VERSION);
assert.equal(fallbackPlan.evidenceMode, 'exploratory');
assert.equal(fallbackPlan.hypothesis.statement, '“Review progress in one place” should be the stronger opening.');
assert.equal(fallbackPlan.hypothesis.intendedLearning, 'Which product message should lead the next pack.');
assert.equal(fallbackPlan.experiment.primary.angle, 'Review progress in one place');
assert.equal(fallbackPlan.experiment.primary.rationale, 'Use the Progress overview to make this benefit concrete.');
assert.equal(fallbackPlan.experiment.challenger.angle, 'Plan a daily routine');
assert.equal(fallbackPlan.experiment.challenger.rationale, 'Use the Routine planner to test a different reviewed benefit.');
assert.equal(fallbackPlan.researchSnapshot.coverage.marketSignalCount, 0);
assert.equal(fallbackPlan.researchSnapshot.coverage.sourceCount, 0);
assert.equal(fallbackPlan.experiment.variable, 'angle');
assert.notEqual(fallbackPlan.experiment.primary.angle, fallbackPlan.experiment.challenger.angle);
assert.ok(Object.isFrozen(fallbackPlan));
assert.equal(validateCreativePackPlan({ plan: fallbackPlan, currentApp: app }), fallbackPlan);

// Deterministic assignments preserve the requested image/UGC mix, balance the
// two experiment lanes, and pair adjacent lane variants to the same truth.
const imageAssignments = fallbackPlan.assignments.filter((item) => item.format === 'image_ad');
const ugcAssignments = fallbackPlan.assignments.filter((item) => item.format === 'ugc_ad');
assert.equal(imageAssignments.length, 5);
assert.equal(ugcAssignments.length, 3);
const primaryCount = fallbackPlan.assignments.filter((item) => item.lane === 'primary').length;
const challengerCount = fallbackPlan.assignments.filter((item) => item.lane === 'challenger').length;
assert.ok(Math.abs(primaryCount - challengerCount) <= 1);
assert.deepEqual(imageAssignments[0].claimEvidenceRefs, imageAssignments[1].claimEvidenceRefs);
assert.deepEqual(imageAssignments[0].proofEvidenceRefs, imageAssignments[1].proofEvidenceRefs);
assert.deepEqual(ugcAssignments[0].claimEvidenceRefs, ugcAssignments[1].claimEvidenceRefs);
assert.deepEqual(ugcAssignments[0].proofEvidenceRefs, ugcAssignments[1].proofEvidenceRefs);

// The launch-pack UI must be able to state the exact 28 -> 14/14 allocation
// from persisted assignments, including an identical 12-image + 2-UGC mix.
const launchPackPlan = buildCreativePackPlan({
  orgId: 'org-a',
  workspaceId: 'ws-default',
  appId: app.appId,
  createdBy: 'user-owner',
  createdAt: '2026-07-10T10:01:30.000Z',
  researchSnapshot: emptyResearch,
  outputMix: { image: 24, ugc: 4 },
});
const launchPrimary = launchPackPlan.assignments.filter((item) => item.lane === 'primary');
const launchChallenger = launchPackPlan.assignments.filter((item) => item.lane === 'challenger');
assert.equal(launchPackPlan.assignments.length, 28);
assert.equal(launchPrimary.length, 14);
assert.equal(launchChallenger.length, 14);
assert.equal(launchPrimary.filter((item) => item.format === 'image_ad').length, 12);
assert.equal(launchPrimary.filter((item) => item.format === 'ugc_ad').length, 2);
assert.equal(launchChallenger.filter((item) => item.format === 'image_ad').length, 12);
assert.equal(launchChallenger.filter((item) => item.format === 'ugc_ad').length, 2);

// Identical canonical input produces stable source and plan fingerprints.
const emptyResearchAgain = buildPackPlanResearchSnapshot({
  productTruth: [...truth].reverse(),
  marketSignals: [],
  learningSignals: [],
  capturedAt,
});
const fallbackPlanAgain = buildCreativePackPlan({
  orgId: 'org-a',
  workspaceId: 'ws-default',
  appId: app.appId,
  createdBy: 'user-owner',
  createdAt,
  researchSnapshot: emptyResearchAgain,
  outputMix: { image: 5, ugc: 3 },
});
assert.equal(emptyResearchAgain.snapshotFingerprint, emptyResearch.snapshotFingerprint);
assert.equal(fallbackPlanAgain.planFingerprint, fallbackPlan.planFingerprint);
assert.equal(fallbackPlanAgain.planId, fallbackPlan.planId);

// Approvals select the next creative direction. A newer tweak may refine the
// execution, but it must not promote the tweaked draft's angle over an angle
// the user explicitly approved.
const learnedResearch = buildPackPlanResearchSnapshot({
  productTruth: truth,
  learningSignals: [
    {
      eventId: 'learning-approved-proof',
      type: 'liked_angle',
      polarity: 'positive',
      angle: 'Show the app in action',
      instruction: 'Create more work that explores the “Show the app in action” angle.',
      createdAt: '2026-07-10T10:02:00.000Z',
    },
    {
      eventId: 'learning-tweak-benefit',
      type: 'tweak_instruction',
      polarity: 'directive',
      angle: 'Lead with the main benefit',
      instruction: 'Make the creator sound more conversational and show the app earlier.',
      createdAt: '2026-07-10T10:03:00.000Z',
    },
  ],
  capturedAt: '2026-07-10T10:04:00.000Z',
});
const learnedStrategy = buildLearnedPackPlanStrategy({
  reviewedApp: app,
  researchSnapshot: learnedResearch,
});
assert.equal(learnedStrategy.primary.angle, 'Show the app in action');
assert.equal(learnedStrategy.challenger.angle, 'Lead with the main benefit');
assert.equal(learnedStrategy.hypothesis.statement, '“Show the app in action” should lead the next pack.');
assert.equal(learnedStrategy.hypothesis.tension, 'Make the creator sound more conversational and show the app earlier.');
assert.equal(learnedStrategy.primary.rationale, 'You approved this direction before.');
const learnedPlan = buildCreativePackPlan({
  orgId: 'org-a',
  workspaceId: 'ws-default',
  appId: app.appId,
  createdBy: 'user-owner',
  createdAt: '2026-07-10T10:05:00.000Z',
  researchSnapshot: learnedResearch,
  outputMix: { image: 2, ugc: 2 },
  strategy: learnedStrategy,
});
assert.equal(learnedPlan.experiment.primary.angle, 'Show the app in action');
assert.equal(learnedPlan.experiment.challenger.angle, 'Lead with the main benefit');

// Real supplied market signals are source-backed, bounded, and permanently
// marked ineligible for product-claim support.
const marketSignals = [
  {
    id: 'signal-overwhelm',
    kind: 'store_review',
    theme: 'People want a calmer planning flow',
    paraphrase: 'Several public reviews describe existing planning tools as overwhelming.',
    observedItemCount: 6,
    source: {
      platform: 'App Store',
      url: 'https://apps.apple.com/us/app/example/id123456789?see-all=reviews',
      observedAt: '2026-07-09T00:00:00.000Z',
      capturedAt,
    },
  },
  {
    id: 'signal-visibility',
    kind: 'community_discussion',
    theme: 'Visible progress helps routines feel concrete',
    paraphrase: 'A public discussion repeatedly values seeing progress without opening several screens.',
    observedItemCount: 4,
    source: {
      platform: 'Public forum',
      url: 'https://community.example.test/routines/progress',
      observedAt: '2026-07-08T00:00:00.000Z',
      capturedAt,
    },
  },
  {
    id: 'signal-setup',
    kind: 'competitor_review',
    theme: 'Setup effort is a common objection',
    paraphrase: 'Public competitor reviews mention abandoning tools that take too long to configure.',
    observedItemCount: 3,
    source: {
      platform: 'Google Play',
      url: 'https://play.google.com/store/apps/details?id=com.example.competitor',
      observedAt: '2026-07-07T00:00:00.000Z',
      capturedAt,
    },
  },
];
const researched = buildPackPlanResearchSnapshot({ productTruth: truth, marketSignals, capturedAt });
assert.equal(researched.coverage.level, 'strong');
assert.equal(researched.coverage.marketSignalCount, 3);
assert.equal(researched.coverage.observedItemCount, 13);
assert.equal(researched.coverage.sourceCount, 3);
assert.ok(researched.marketSignals.every((signal) => signal.canSupportProductClaim === false));

// Public review language informs the rationale and evidence selection, but it
// must not replace the two verified product messages with raw review titles.
const automaticMarketStrategy = buildLearnedPackPlanStrategy({
  reviewedApp: app,
  researchSnapshot: researched,
});
assert.equal(automaticMarketStrategy.primary.angle, 'Review progress in one place');
assert.equal(automaticMarketStrategy.challenger.angle, 'Plan a daily routine');
assert.ok(automaticMarketStrategy.primary.evidenceRefs.some((ref) => ref.startsWith('signal-')));
assert.ok(automaticMarketStrategy.challenger.evidenceRefs.some((ref) => ref.startsWith('signal-')));
assert.notEqual(automaticMarketStrategy.primary.angle, researched.marketSignals[0].theme);

const claimIds = researched.productTruth.filter((item) => item.canSupportProductClaim).map((item) => item.id);
const proofIds = researched.productTruth.filter((item) => item.kind === 'screen').map((item) => item.id);
const signalIds = researched.marketSignals.map((item) => item.id);
const suppliedStrategy = {
  claimIds,
  proofIds,
  hypothesis: {
    statement: 'A calm, visible routine story may make the app value easier to understand.',
    audience: 'People who want structure without a complicated setup.',
    tension: 'Public language points to overwhelm and setup effort as recurring frustrations.',
    valueConnection: 'Reviewed app truth shows planning and progress together.',
    intendedLearning: 'Whether calm planning or visible progress is the stronger opening angle.',
    evidenceRefs: [claimIds[0], proofIds[0], signalIds[0], signalIds[2]],
  },
  primary: {
    angle: 'Calm planning without the clutter',
    rationale: 'Connect the planning claim to public language about overwhelm.',
    evidenceRefs: [claimIds[0], signalIds[0], signalIds[2]],
  },
  challenger: {
    angle: 'Make progress visible at a glance',
    rationale: 'Connect the progress claim to public language about visibility.',
    evidenceRefs: [claimIds[1], proofIds[1], signalIds[1]],
  },
};
const researchedPlan = buildCreativePackPlan({
  orgId: 'org-a',
  workspaceId: 'ws-default',
  appId: app.appId,
  createdBy: 'user-owner',
  createdAt,
  researchSnapshot: researched,
  outputMix: { image: 2, ugc: 2 },
  strategy: suppliedStrategy,
});
assert.equal(researchedPlan.evidenceMode, 'evidence_led');
assert.ok(researchedPlan.assignments.some((item) => item.marketSignalRefs.length > 0));
assert.ok(researchedPlan.assignments.every((item) => item.claimEvidenceRefs.every((ref) => claimIds.includes(ref))));
assert.ok(researchedPlan.assignments.every((item) => item.claimEvidenceRefs.every((ref) => !signalIds.includes(ref))));

assert.throws(
  () => buildCreativePackPlan({
    orgId: 'org-a',
    workspaceId: 'ws-default',
    appId: app.appId,
    createdBy: 'user-owner',
    createdAt,
    researchSnapshot: researched,
    outputMix: { image: 1, ugc: 1 },
    strategy: { ...suppliedStrategy, claimIds: [signalIds[0]] },
  }),
  /not eligible reviewed product truth/,
);

// A plan is invalid as soon as the currently selected product truth changes.
const staleApp = structuredClone(app);
staleApp.claims[0].text = 'A materially changed product claim.';
assert.throws(
  () => validateCreativePackPlan({ plan: researchedPlan, currentApp: staleApp }),
  /selected app truth changed/,
);

// Customer projection preserves inspectable public provenance but strips
// tenant storage keys and internal actor identity.
const customerPlan = customerSafeCreativePackPlan(researchedPlan);
const customerJson = JSON.stringify(customerPlan);
const customerScreens = customerPlan.research.productTruth.filter((item) => item.kind === 'screen');
assert.equal(customerPlan.planFingerprint, researchedPlan.planFingerprint);
assert.ok(!customerJson.includes('createdBy'));
assert.ok(!customerJson.includes('storageKey'));
assert.ok(!customerJson.includes('orgs/org-a/workspaces'));
assert.ok(JSON.stringify(researchedPlan).includes('Rawify before UI extraction'));
assert.ok(JSON.stringify(researchedPlan).includes('store_art'));
assert.ok(!/rawify|pre_rawification|store_art|raw_app_proof|Gemini Omni/i.test(customerJson));
assert.deepEqual(customerScreens.map((item) => item.source.label).sort(), ['Store screenshot', 'Uploaded screenshot']);
assert.equal(customerScreens.find((item) => item.id === 'screen:screen-progress')?.text, 'Progress overview — Needs review before use');
assert.equal(customerScreens.find((item) => item.id === 'screen:screen-plan')?.text, 'Routine planner');
assert.ok(customerPlan.research.marketSignals.every((signal) => signal.canSupportProductClaim === false));

// Review actions deterministically create typed learning memory.
const decisionBase = {
  orgId: 'org-a',
  workspaceId: 'ws-default',
  appId: app.appId,
  packId: researchedPlan.planId,
  draftId: 'draft-001',
  createdBy: 'user-owner',
  format: 'ugc',
  angle: researchedPlan.experiment.primary.angle,
  createdAt: '2026-07-10T12:00:00.000Z',
};
const approved = buildReviewDecisionLearningPair({ ...decisionBase, action: 'approve', idempotencyKey: 'review-approved-001' });
assert.equal(approved.decision.schemaVersion, REVIEW_DECISION_SCHEMA_VERSION);
assert.equal(approved.learningEvent.schemaVersion, LEARNING_EVENT_SCHEMA_VERSION);
assert.equal(approved.decision.action, 'approved');
assert.equal(approved.learningEvent.type, 'liked_angle');
assert.equal(approved.learningEvent.polarity, 'positive');

const rejected = buildReviewDecisionLearningPair({ ...decisionBase, draftId: 'draft-002', action: 'reject', idempotencyKey: 'review-rejected-001' });
assert.equal(rejected.decision.action, 'rejected');
assert.equal(rejected.learningEvent.type, 'rejected_angle');
assert.equal(rejected.learningEvent.polarity, 'negative');

const tweaked = buildReviewDecisionLearningPair({
  ...decisionBase,
  draftId: 'draft-003',
  action: 'tweak',
  note: 'Use a more direct first line and show the progress screen earlier.',
  idempotencyKey: 'review-tweak-001',
});
assert.equal(tweaked.learningEvent.type, 'tweak_instruction');
assert.equal(tweaked.learningEvent.polarity, 'directive');
assert.equal(tweaked.learningEvent.instruction, 'Use a more direct first line and show the progress screen earlier.');
assert.ok(Object.isFrozen(tweaked.decision));
assert.ok(Object.isFrozen(tweaked.learningEvent));
assert.throws(
  () => buildReviewDecisionLearningPair({ ...decisionBase, action: 'tweak', note: '' }),
  /needs a concrete instruction/,
);

const learningSnapshot = buildPackPlanResearchSnapshot({
  productTruth: truth,
  marketSignals: [],
  learningSignals: [approved.learningEvent, rejected.learningEvent, tweaked.learningEvent],
  capturedAt: '2026-07-10T12:05:00.000Z',
});
assert.deepEqual(
  learningSnapshot.learningSignals.map((signal) => signal.type).sort(),
  ['liked_angle', 'rejected_angle', 'tweak_instruction'],
);

console.log('Pack Plan model tests passed');
console.log(JSON.stringify({
  schemaVersion: fallbackPlan.schemaVersion,
  fallbackEvidenceMode: fallbackPlan.evidenceMode,
  fallbackMarketSignals: fallbackPlan.researchSnapshot.coverage.marketSignalCount,
  researchedPlanId: researchedPlan.planId,
  assignments: researchedPlan.assignments.length,
  reviewLearningTypes: [approved, rejected, tweaked].map((pair) => pair.learningEvent.type),
  providerMutations: 0,
}, null, 2));
