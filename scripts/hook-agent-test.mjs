/* Direct Hook Agent contract tests.

   Unlike the graph fixtures, these tests execute the real writer -> eight
   isolated blind readers -> evidence critic loop and the durable artifact
   adapter. No network or media provider is used. */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalAssetStore } from '../lib/asset-store.mjs';
import { createPersistedHookAgentAdapter } from '../lib/hook-agent-adapter.mjs';
import {
  HOOK_CANDIDATE_COUNT,
  HOOK_MAX_OUTPUTS_PER_PLAN,
  buildHookPlanningRequest,
  runHookAgent,
  sealHookPlan,
  validateHookPlanForRequest,
} from '../lib/hook-agent.mjs';

const source = {
  appId: 'app-zorbly',
  appName: 'Zorbly: Label Scanner',
  appCategory: 'Utilities',
  appSummary: 'Scan a product label and get the useful details in one readable result.',
  claims: [
    { id: 'claim-scan', text: 'Scan product labels and review the extracted details.' },
    { id: 'claim-result', text: 'See label details in one readable result.' },
  ],
  screens: [
    { id: 'screen-camera', label: 'Label camera', detail: 'Camera aimed at a product label.' },
    { id: 'screen-result', label: 'Readable result', detail: 'Extracted label details in a clear list.' },
  ],
  angles: [{ id: 'angle-friction', label: 'Stop searching tiny labels manually.' }],
  audienceNotes: ['People who struggle to read small product labels.'],
  learningNotes: ['Prefer specific real-world friction over generic convenience claims.'],
  styleNotes: ['Socially native, plain language, no hype.'],
};

const baseCandidates = [
  ['target_contrast', 'You scan the label, then still search for the answer.', 'scanned it. still searching?'],
  ['confession', 'I photographed every label and still missed the useful detail.', 'the useful line was still hiding'],
  ['question', 'Why does reading one tiny label take three different searches?', 'why is one label this much work?'],
  ['challenge', 'One product label should not require three separate searches.', 'one label. three searches.'],
  ['pov', "The label looks clear, but the answer still isn't.", 'clear label, unclear answer'],
  ['discovery', 'The camera catches the label, but not what matters.', 'the photo was never the hard part'],
  ['target_contrast', 'You read every line and still cannot find the warning.', 'where is the line that matters?'],
  ['confession', 'I stopped zooming labels once the result became readable.', 'I was done pinching to zoom'],
];

function writerCandidates({ directBrand = false, onlyOne = false, vagueFirst = false, writtenDurationFirst = false } = {}) {
  const candidates = baseCandidates.map(([patternId, spokenHook, caption], index) => ({
    candidateId: `writer-${index + 1}`,
    patternId,
    spokenHook: index === 0 && directBrand
      ? 'Zorbly scans labels before I waste time searching manually.'
      : index === 0 && writtenDurationFirst
        ? 'I scanned product labels for three years and still missed details.'
      : index === 0 && vagueFirst
        ? 'Your language streak is alive, but you still freeze.'
        : spokenHook,
    caption: index === 0 && directBrand
      ? 'Zorbly found it'
      : index === 0 && vagueFirst
        ? 'the streak is not the point'
        : caption,
    targetBehavior: index === 0 && vagueFirst ? 'keeping an unexplained streak' : 'scanning and reading a product label',
    tension: index === 0 && vagueFirst ? 'freezing for an unclear reason' : 'still searching for the useful detail',
    evidenceRefs: ['claim-scan'],
  }));
  return onlyOne ? candidates.slice(0, 1) : candidates;
}

function candidateIdFromCallKey(callKey) {
  return String(callKey).match(/cold-reader:(r\d+-\d+)$/)?.[1] || '';
}

function passingColdRead(candidateId, { vague = false } = {}) {
  return {
    candidateId,
    inferredTopic: vague ? 'unclear habit or learning app' : 'scanning product labels to find useful information',
    topicConfidence: vague ? 0.35 : 0.97,
    behaviorOrSituation: vague ? '' : 'scanning or reading a product label',
    tensionOrConsequence: vague ? 'freezing, but the situation is unclear' : 'still searching or missing the important detail',
    curiosityGap: vague ? 'what the unexplained streak means' : 'why scanning did not reveal the answer',
    unexplainedTerms: vague ? ['language streak'] : [],
  };
}

function passingReviews({ malformedScore = false } = {}) {
  return Array.from({ length: HOOK_CANDIDATE_COUNT }, (_, index) => ({
    candidateId: `r1-${index + 1}`,
    verdict: 'pass',
    topicClarity: malformedScore ? 6 : 5,
    concreteTension: 5,
    curiosity: 4,
    nativeVoice: 5,
    claimSafety: 5,
    topicMatchesEvidence: true,
    supportedEvidenceRefs: ['claim-scan'],
    unsupportedSpans: [],
    duplicateClusterId: `cluster-${index + 1}`,
    nearDuplicateOf: null,
    reason: 'The product-label behavior and search tension are clear and supported.',
  }));
}

function passingReviewsForCandidateIds(candidateIds, evidenceRefForId = () => 'claim-scan') {
  return candidateIds.map((candidateId, index) => ({
    candidateId,
    verdict: 'pass',
    topicClarity: 5,
    concreteTension: 5,
    curiosity: 4,
    nativeVoice: 5,
    claimSafety: 5,
    topicMatchesEvidence: true,
    supportedEvidenceRefs: [evidenceRefForId(candidateId)],
    unsupportedSpans: [],
    duplicateClusterId: `refill-cluster-${index + 1}`,
    nearDuplicateOf: null,
    reason: 'The product-label behavior and search tension are clear and supported.',
  }));
}

function scriptedGenerator({ writerOptions = {}, malformedScore = false, capture = null } = {}) {
  return async ({ stage, prompt, callKey }) => {
    capture?.push({ stage, prompt, callKey });
    if (stage === 'hook_writer') return { candidates: writerCandidates(writerOptions) };
    if (stage === 'hook_cold_reader') {
      const candidateId = candidateIdFromCallKey(callKey);
      return { read: passingColdRead(candidateId, { vague: writerOptions.vagueFirst && candidateId.endsWith('-1') }) };
    }
    if (stage === 'hook_critic') return { reviews: passingReviews({ malformedScore }) };
    throw new Error(`Unexpected stage ${stage}`);
  };
}

/* Successful real loop: exactly 8 writer candidates, 8 isolated cold reads,
   one critic call, and two diverse winners from one shared pool. */
const captured = [];
const request = buildHookPlanningRequest({ source, outputCount: 2 });
const plan = await runHookAgent({ source, request, generateJson: scriptedGenerator({ capture: captured }) });
validateHookPlanForRequest({ plan, request, allowHeld: false });
assert.equal(plan.status, 'selected');
assert.equal(plan.candidatePool.length, HOOK_CANDIDATE_COUNT);
assert.equal(plan.generatedCandidateCount, HOOK_CANDIDATE_COUNT);
assert.equal(plan.selectedHooks.length, 2);
assert.equal(new Set(plan.selectedHooks.map((hook) => hook.spokenHook)).size, 2);
assert.equal(plan.intelligenceUsage.intelligenceCallCount, 10);
assert.deepEqual(plan.intelligenceUsage.stageCalls, { hook_writer: 1, hook_cold_reader: 8, hook_critic: 1 });
const writerContractPrompt = captured.find((call) => call.stage === 'hook_writer')?.prompt || '';
const criticContractPrompt = captured.find((call) => call.stage === 'hook_critic')?.prompt || '';
assert.match(writerContractPrompt, /personal history/i);
assert.match(writerContractPrompt, /duration, tenure, frequency, proficiency level, quality\/result claim, or named subtype/i);
assert.match(criticContractPrompt, /First-person grammar is not evidence/i);
assert.match(criticContractPrompt, /specific named subtype or example is unsupported/i);
assert.match(criticContractPrompt, /quote the unsupported span, set claimSafety below 5, and reject/i);

const blindCalls = captured.filter((call) => call.stage === 'hook_cold_reader');
assert.equal(blindCalls.length, HOOK_CANDIDATE_COUNT);
for (let index = 0; index < blindCalls.length; index += 1) {
  const call = blindCalls[index];
  assert.ok(!call.prompt.includes(source.appName), 'blind reader must not see the app name');
  assert.ok(!call.prompt.includes(source.appSummary), 'blind reader must not see reviewed evidence');
  assert.ok(!call.prompt.includes(baseCandidates[index][2]), 'blind reader must not see the candidate caption');
  const peerHook = baseCandidates[(index + 1) % baseCandidates.length][1];
  assert.ok(!call.prompt.includes(peerHook), 'blind reader must not see peer candidates');
  assert.ok(call.prompt.includes(baseCandidates[index][1]), 'blind reader must see its one spoken hook');
}

/* A reader failure stops new scheduling but drains readers already in flight.
   The rejected error must include the final provider-call count, and no
   background reader may keep launching calls after the caller sees it. */
let failureCallCount = 0;
let failureReaderStarts = 0;
let releaseSiblingReaders;
let confirmInitialReadersStarted;
const siblingReaderGate = new Promise((resolve) => { releaseSiblingReaders = resolve; });
const initialReadersStarted = new Promise((resolve) => { confirmInitialReadersStarted = resolve; });
const readerFailureRun = runHookAgent({
  source,
  outputCount: 1,
  generateJson: async (input) => {
    failureCallCount += 1;
    if (input.stage === 'hook_writer') return { candidates: writerCandidates() };
    if (input.stage === 'hook_cold_reader') {
      failureReaderStarts += 1;
      if (failureReaderStarts === 4) confirmInitialReadersStarted();
      const candidateId = candidateIdFromCallKey(input.callKey);
      if (candidateId.endsWith('-1')) throw new Error('simulated blind-reader outage');
      await siblingReaderGate;
      return { read: passingColdRead(candidateId) };
    }
    throw new Error(`Unexpected stage ${input.stage}`);
  },
});
await initialReadersStarted;
releaseSiblingReaders();
let readerFailure;
try {
  await readerFailureRun;
  assert.fail('reader failure should reject the Hook Agent run');
} catch (error) {
  readerFailure = error;
}
assert.match(readerFailure.message, /blind-reader outage/);
assert.equal(failureCallCount, 5, 'one writer and only the four initially scheduled readers may call the provider');
assert.equal(readerFailure.hookAgentMetrics.intelligenceCallCount, failureCallCount);
assert.deepEqual(readerFailure.hookAgentMetrics.stageCalls, { hook_writer: 1, hook_cold_reader: 4, hook_critic: 0 });
const failureCallsAtRejection = failureCallCount;
await new Promise((resolve) => setImmediate(resolve));
assert.equal(failureCallCount, failureCallsAtRejection, 'no reader call may continue launching after rejection');

/* Fingerprints bind the exact reviewed source and policy. */
const changedSource = { ...source, appSummary: `${source.appSummary} Updated after review.` };
const changedRequest = buildHookPlanningRequest({ source: changedSource, outputCount: 2 });
assert.notEqual(changedRequest.sourceFingerprint, request.sourceFingerprint);
assert.notEqual(changedRequest.requestFingerprint, request.requestFingerprint);
assert.throws(() => validateHookPlanForRequest({ plan, request: changedRequest }), /does not match|fingerprint/i);
const misassignedPlan = sealHookPlan({
  ...plan,
  selectedHooks: plan.selectedHooks.map((hook, index) => (
    index === 0 ? { ...hook, assignmentId: 'wrong-output-assignment' } : hook
  )),
});
assert.throws(() => validateHookPlanForRequest({ plan: misassignedPlan, request }), /assigned claim|output bindings|aligned/i);
const copyTamperedPlan = sealHookPlan({
  ...plan,
  selectedHooks: plan.selectedHooks.map((hook, index) => (
    index === 0
      ? { ...hook, spokenHook: 'Completely substituted copy still looks superficially valid here.' }
      : hook
  )),
});
assert.throws(() => validateHookPlanForRequest({ plan: copyTamperedPlan, request }), /candidate-pool row|immutable/i);

/* Prompt-only rules are not trusted: one candidate or one direct brand leak
   holds the plan before any blind-reader/critic call. */
for (const writerOptions of [{ onlyOne: true }, { directBrand: true }]) {
  const calls = [];
  const held = await runHookAgent({
    source,
    outputCount: 1,
    generateJson: scriptedGenerator({ writerOptions, capture: calls }),
  });
  assert.equal(held.status, 'held');
  assert.equal(held.selectedHooks.length, 0);
  assert.equal(calls.filter((call) => call.stage === 'hook_writer').length, 2);
  assert.equal(calls.filter((call) => call.stage === 'hook_cold_reader').length, 0);
  assert.equal(calls.filter((call) => call.stage === 'hook_critic').length, 0);
}

/* Written-number durations are deterministic claim rails, not creative
   semantics. Generic evidence cannot turn an invented tenure into a safe
   testimonial, so it is rejected before readers or the critic are called. */
const durationCalls = [];
const writtenDurationHeld = await runHookAgent({
  source,
  outputCount: 1,
  generateJson: scriptedGenerator({ writerOptions: { writtenDurationFirst: true }, capture: durationCalls }),
});
assert.equal(writtenDurationHeld.status, 'held');
assert.equal(durationCalls.filter((call) => call.stage === 'hook_writer').length, 2);
assert.equal(durationCalls.filter((call) => call.stage === 'hook_cold_reader').length, 0);
assert.equal(durationCalls.filter((call) => call.stage === 'hook_critic').length, 0);
assert.ok(writtenDurationHeld.stageHistory[0].deterministicRejections.some((rejection) => /written-number time or duration/i.test(rejection.reason)));
assert.ok(!writtenDurationHeld.candidatePool.some((candidate) => /three years/i.test(candidate.spokenHook)));

/* Named subtypes and proficiency claims remain a semantic evidence decision,
   not a vertical word list. The critic identifies the exact unsupported span
   even when the blind reader understands the broad product-label topic. */
const unsupportedSpecificityCalls = [];
const unsupportedSpecificityPlan = await runHookAgent({
  source,
  outputCount: 1,
  generateJson: async (input) => {
    unsupportedSpecificityCalls.push(input);
    if (input.stage === 'hook_writer') {
      const candidates = writerCandidates();
      candidates[0] = {
        ...candidates[0],
        spokenHook: 'I mastered cosmetic labels, then one detail still left me guessing.',
        caption: 'even expert label reading missed it',
      };
      return { candidates };
    }
    if (input.stage === 'hook_cold_reader') {
      const candidateId = candidateIdFromCallKey(input.callKey);
      return { read: passingColdRead(candidateId) };
    }
    if (input.stage === 'hook_critic') {
      return {
        reviews: passingReviews().map((review, index) => (index === 0
          ? {
            ...review,
            verdict: 'reject',
            claimSafety: 2,
            unsupportedSpans: ['mastered cosmetic labels', 'expert label reading'],
            reason: 'The evidence supports product-label scanning, not the claimed proficiency or named subtype.',
          }
          : review)),
      };
    }
    throw new Error(`Unexpected stage ${input.stage}`);
  },
});
assert.equal(unsupportedSpecificityPlan.status, 'selected');
const unsupportedSpecificityCandidate = unsupportedSpecificityPlan.candidatePool.find((candidate) => candidate.candidateId === 'r1-1');
assert.equal(unsupportedSpecificityCandidate.qualified, false);
assert.deepEqual(unsupportedSpecificityCandidate.critic.unsupportedSpans, ['mastered cosmetic labels', 'expert label reading']);
assert.ok(!unsupportedSpecificityPlan.selectedHooks.some((hook) => hook.candidateId === 'r1-1'));
assert.equal(unsupportedSpecificityCalls.filter((call) => call.stage === 'hook_cold_reader').length, 8);

/* A deterministic 7/8 response is repairable. The seven stable survivors
   keep their round-one ids; round two contributes one distinct refill, while
   duplicate surplus candidates remain in the audit history but never enter
   the semantic pool. Output selection still uses critic-supported evidence. */
const refillRequest = buildHookPlanningRequest({
  source,
  outputCount: 2,
  outputBindings: [
    { assignmentId: 'scan-output', evidenceRefs: ['claim-scan'] },
    { assignmentId: 'result-output', evidenceRefs: ['claim-result'] },
  ],
});
const refillCalls = [];
let refillWriterRound = 0;
const refillColdIds = [];
const refillPlan = await runHookAgent({
  source,
  request: refillRequest,
  generateJson: async (input) => {
    refillCalls.push(input);
    if (input.stage === 'hook_writer') {
      refillWriterRound += 1;
      const candidates = writerCandidates().map((candidate, index) => ({
        ...candidate,
        evidenceRefs: [index % 2 === 0 ? 'claim-scan' : 'claim-result'],
      }));
      candidates[0] = {
        ...candidates[0],
        spokenHook: refillWriterRound === 1
          ? 'Try scanning this label before you search every tiny line.'
          : 'Reading one product label should not mean hunting every tiny line.',
        caption: refillWriterRound === 1
          ? 'skip the tiny-label hunt'
          : 'the label should answer the question',
      };
      return { candidates };
    }
    if (input.stage === 'hook_cold_reader') {
      const candidateId = candidateIdFromCallKey(input.callKey);
      refillColdIds.push(candidateId);
      return { read: passingColdRead(candidateId) };
    }
    if (input.stage === 'hook_critic') {
      return {
        reviews: passingReviewsForCandidateIds(
          refillColdIds,
          (candidateId) => (candidateId === 'r2-1' || Number(candidateId.split('-')[1]) % 2 === 1 ? 'claim-scan' : 'claim-result'),
        ),
      };
    }
    throw new Error(`Unexpected stage ${input.stage}`);
  },
});
validateHookPlanForRequest({ plan: refillPlan, request: refillRequest, allowHeld: false });
assert.equal(refillPlan.status, 'selected');
assert.equal(refillPlan.rounds, 2);
assert.equal(refillPlan.generatedCandidateCount, 16);
assert.equal(refillPlan.acceptedCandidateCount, 8);
assert.equal(refillPlan.candidatePool.length, HOOK_CANDIDATE_COUNT);
assert.deepEqual(
  refillPlan.candidatePool.map((candidate) => candidate.candidateId),
  ['r1-2', 'r1-3', 'r1-4', 'r1-5', 'r1-6', 'r1-7', 'r1-8', 'r2-1'],
);
assert.deepEqual(refillPlan.intelligenceUsage.stageCalls, { hook_writer: 2, hook_cold_reader: 8, hook_critic: 1 });
assert.equal(refillPlan.intelligenceUsage.intelligenceCallCount, 11);
assert.equal(refillPlan.stageHistory[0].deterministicPoolCount, 7);
assert.equal(refillPlan.stageHistory[1].deterministicAcceptedCount, 1);
assert.equal(refillPlan.stageHistory[1].deterministicRetainedCount, 1);
assert.equal(refillPlan.stageHistory[1].deterministicPoolCount, 8);
assert.equal(refillPlan.stageHistory.flatMap((stage) => stage.writerCandidates).length, 16);
assert.equal(refillPlan.stageHistory[1].writerCandidates.filter((candidate) => candidate.disposition === 'retained').length, 1);
assert.equal(refillPlan.stageHistory[1].writerCandidates.filter((candidate) => candidate.disposition === 'rejected').length, 7);
assert.ok(refillCalls.filter((call) => call.stage === 'hook_writer')[1].prompt.includes(baseCandidates[1][1]));
assert.deepEqual(refillPlan.selectedHooks.map((hook) => hook.assignmentId), ['scan-output', 'result-output']);

/* Repeating the seven survivors does not game the refill. Every duplicate is
   audited with its own stable round-two id, the incomplete pool is held, and
   no blind-reader, critic, or media path can begin. */
let duplicateWriterRound = 0;
const duplicateRefillPlan = await runHookAgent({
  source,
  outputCount: 1,
  generateJson: async (input) => {
    if (input.stage !== 'hook_writer') throw new Error(`Unexpected stage ${input.stage}`);
    duplicateWriterRound += 1;
    const candidates = writerCandidates();
    candidates[0] = {
      ...candidates[0],
      spokenHook: 'Try scanning this label before you search every tiny line.',
      caption: 'skip the tiny-label hunt',
    };
    return { candidates };
  },
});
assert.equal(duplicateWriterRound, 2);
assert.equal(duplicateRefillPlan.status, 'held');
assert.equal(duplicateRefillPlan.selectedHooks.length, 0);
assert.equal(duplicateRefillPlan.candidatePool.length, 7);
assert.equal(duplicateRefillPlan.generatedCandidateCount, 16);
assert.equal(duplicateRefillPlan.acceptedCandidateCount, 7);
assert.deepEqual(duplicateRefillPlan.intelligenceUsage.stageCalls, { hook_writer: 2, hook_cold_reader: 0, hook_critic: 0 });
assert.equal(duplicateRefillPlan.stageHistory[1].deterministicPoolCount, 7);
assert.equal(duplicateRefillPlan.stageHistory[1].deterministicAcceptedCount, 0);
assert.equal(duplicateRefillPlan.stageHistory[1].deterministicRejections.length, 8);
assert.equal(duplicateRefillPlan.stageHistory.flatMap((stage) => stage.writerCandidates).length, 16);
assert.equal(new Set(duplicateRefillPlan.stageHistory.flatMap((stage) => stage.writerCandidates.map((candidate) => candidate.candidateId))).size, 16);
assert.ok(duplicateRefillPlan.stageHistory[1].deterministicRejections.some((rejection) => /duplicate spoken hook/i.test(rejection.reason)));
assert.ok(duplicateRefillPlan.candidatePool.every((candidate) => candidate.coldRead === null && candidate.critic === null && !candidate.qualified));

/* Malformed semantic scores are rejected, not clamped into a pass. */
const malformed = await runHookAgent({
  source,
  outputCount: 1,
  generateJson: scriptedGenerator({ malformedScore: true }),
});
assert.equal(malformed.status, 'held');
assert.equal(malformed.selectedHooks.length, 0);
assert.equal(malformed.intelligenceUsage.intelligenceCallCount, 20);

/* The old vague regression can appear in a fixture pool, but an isolated
   reader cannot infer it confidently, so it never survives selection. */
const vague = await runHookAgent({
  source,
  outputCount: 1,
  generateJson: scriptedGenerator({ writerOptions: { vagueFirst: true } }),
});
assert.equal(vague.status, 'selected');
assert.ok(!vague.selectedHooks.some((hook) => /language streak/i.test(hook.spokenHook)));
assert.equal(vague.candidatePool.find((candidate) => /language streak/i.test(candidate.spokenHook))?.qualified, false);

assert.throws(
  () => buildHookPlanningRequest({ source, outputCount: HOOK_MAX_OUTPUTS_PER_PLAN + 1 }),
  /at most/i,
);

/* Durable adapter: a crash after object write can retry from the immutable
   plan key with zero new writer/reader/critic calls. */
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'maa-hook-agent-'));
try {
  const assetStore = createLocalAssetStore({ rootDir: tempRoot });
  const task = {
    taskId: 'job-test-ugc-hook-plan',
    jobId: 'job-test',
    packId: 'pack-test',
    orgId: 'org-test',
    workspaceId: 'ws-test',
    appId: source.appId,
    spec: { outputCount: 2, hookRequest: request },
    output: { storageKey: 'orgs/org-test/workspaces/ws-test/apps/app-zorbly/jobs/job-test/plans/hook.json', contentType: 'application/json' },
  };
  let providerCalls = 0;
  const durable = createPersistedHookAgentAdapter({
    assetStore,
    generateJson: async (input) => {
      providerCalls += 1;
      return scriptedGenerator({})(input);
    },
  });
  const first = await durable.planHooks({ task, source });
  assert.equal(providerCalls, 10);
  assert.equal(first.reusedArtifact, false);
  assert.equal(first.asset.planFingerprint, first.hookPlan.planFingerprint);
  assert.equal(await assetStore.exists(task.output.storageKey), true);

  const resumed = createPersistedHookAgentAdapter({
    assetStore,
    generateJson: async () => {
      throw new Error('resume must not call intelligence');
    },
  });
  const second = await resumed.planHooks({ task, source });
  assert.equal(second.reusedArtifact, true);
  assert.equal(second.hookPlan.planFingerprint, first.hookPlan.planFingerprint);

  const staleTask = {
    ...task,
    spec: { outputCount: 2, hookRequest: changedRequest },
  };
  await assert.rejects(
    () => resumed.planHooks({ task: staleTask, source: changedSource }),
    /immutable readback|does not match/i,
  );

  const heldTask = {
    ...task,
    taskId: 'job-test-ugc-hook-plan-held',
    output: {
      ...task.output,
      storageKey: 'orgs/org-test/workspaces/ws-test/apps/app-zorbly/jobs/job-test/plans/hook-held.json',
    },
  };
  let heldProviderCalls = 0;
  const heldAdapter = createPersistedHookAgentAdapter({
    assetStore,
    generateJson: async (input) => {
      heldProviderCalls += 1;
      return scriptedGenerator({ writerOptions: { onlyOne: true } })(input);
    },
  });
  const heldFirst = await heldAdapter.planHooks({ task: heldTask, source });
  assert.equal(heldFirst.hookPlan.status, 'held');
  assert.ok(heldFirst.taskFailure);
  assert.equal(heldProviderCalls, 2);
  assert.equal(await assetStore.exists(heldTask.output.storageKey), true);
  const heldSecond = await heldAdapter.planHooks({ task: heldTask, source });
  assert.equal(heldSecond.reusedArtifact, true);
  assert.equal(heldProviderCalls, 2, 'held-plan retry must read the immutable artifact instead of paying for another round');

  const raceTask = {
    ...task,
    taskId: 'job-test-ugc-hook-plan-race',
    output: {
      ...task.output,
      storageKey: 'orgs/org-test/workspaces/ws-test/apps/app-zorbly/jobs/job-test/plans/hook-race.json',
    },
  };
  let raceProviderCalls = 0;
  let raceWriterArrivals = 0;
  let releaseRaceWriters;
  const raceWriterBarrier = new Promise((resolve) => { releaseRaceWriters = resolve; });
  const raceGenerator = async (input) => {
    raceProviderCalls += 1;
    if (input.stage === 'hook_writer') {
      raceWriterArrivals += 1;
      if (raceWriterArrivals === 2) releaseRaceWriters();
      await raceWriterBarrier;
    }
    return scriptedGenerator({})(input);
  };
  const raceAdapterA = createPersistedHookAgentAdapter({ assetStore, generateJson: raceGenerator, id: 'race-a' });
  const raceAdapterB = createPersistedHookAgentAdapter({ assetStore, generateJson: raceGenerator, id: 'race-b' });
  const [raceA, raceB] = await Promise.all([
    raceAdapterA.planHooks({ task: raceTask, source }),
    raceAdapterB.planHooks({ task: raceTask, source }),
  ]);
  assert.equal(raceProviderCalls, 20);
  assert.equal(raceA.hookPlan.planFingerprint, raceB.hookPlan.planFingerprint);
  assert.equal([raceA.reusedArtifact, raceB.reusedArtifact].filter(Boolean).length, 1, 'one concurrent planner must reuse the conditionally-created winner');
  const raceStored = JSON.parse((await assetStore.getObject(raceTask.output.storageKey)).toString('utf8'));
  assert.equal(raceStored.planFingerprint, raceA.hookPlan.planFingerprint);

  const failingPersistenceStore = {
    async exists() { return false; },
    async getObject() { throw new Error('missing'); },
    async putObject() { throw new Error('simulated storage outage'); },
    async putObjectIfAbsent() { throw new Error('simulated storage outage'); },
  };
  const persistenceFailureAdapter = createPersistedHookAgentAdapter({
    assetStore: failingPersistenceStore,
    generateJson: scriptedGenerator({}),
  });
  await assert.rejects(
    async () => {
      try {
        await persistenceFailureAdapter.planHooks({ task, source });
      } catch (error) {
        assert.equal(error.planningProviderCalls, 10, 'storage failure must retain all successful intelligence calls');
        throw error;
      }
    },
    /could not be persisted safely/i,
  );
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('Hook Agent tests passed');
console.log(JSON.stringify({
  candidatePoolSize: plan.candidatePool.length,
  selectedHooks: plan.selectedHooks.length,
  isolatedBlindReaderCalls: blindCalls.length,
  intelligenceCalls: plan.intelligenceUsage.intelligenceCallCount,
  maxOutputsPerPlan: HOOK_MAX_OUTPUTS_PER_PLAN,
  generationProviderCalls: 0,
  providerMutations: 0,
}, null, 2));
