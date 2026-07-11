/* Focused live-gate regression for persisted Hook Agent plans.

   All intelligence and media adapters are deterministic local fixtures. The
   Hook Agent is deliberately marked live so the runner must re-read the
   immutable plan immediately before every UGC media call. No network or live
   provider is used. */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalAssetStore } from '../lib/asset-store.mjs';
import { resolveGenerationAdapters } from '../lib/generation-adapters.mjs';
import { createPersistedHookAgentAdapter } from '../lib/hook-agent-adapter.mjs';
import { runCreativeJob } from '../lib/local-job-runner.mjs';
import { createTenantStore } from '../lib/local-tenant-store.mjs';
import { createPlannedPack } from './pack-plan-test-fixture.mjs';

const extraction = {
  schemaVersion: 'local-app-extraction.v1',
  jobId: 'extract-hook-readback-fixture',
  source: 'test_fixture',
  url: 'https://apps.apple.com/us/app/zorbly/id123456789',
  createdAt: '2026-07-09T20:00:00.000Z',
  providerMutations: 0,
  platform: 'app_store',
  app: {
    name: 'Zorbly: Label Scanner',
    category: 'Utilities',
    subtitle: 'Read product labels clearly',
    iconUrl: 'https://cdn.example.test/zorbly-icon.png',
    storeUrl: 'https://apps.apple.com/us/app/zorbly/id123456789',
    summary: 'Scan a product label and get the useful details in one readable result.',
    description: 'Photograph a product label, extract its details, and review them in a readable list.',
  },
  uiObjects: [{
    id: 'screen-label-result',
    title: 'Readable label result',
    description: 'First-party app screen showing extracted product-label details in a readable list.',
    sourceType: 'raw_app_proof',
    sourceUrl: 'https://cdn.example.test/zorbly-result.png',
    usability: { status: 'recommended', label: 'Looks usable', reason: 'Clear first-party result screen.' },
  }],
  claimCandidates: [{
    id: 'claim-label-result',
    text: 'Scan product labels and review the extracted details in one readable result.',
    source: 'App Store description',
    selected: true,
    confidence: 'high',
  }],
  reviewSummary: { screenCount: 1, claimCount: 1, rawifyCandidateCount: 0, holds: [] },
  styleNotes: ['Plain language', 'Use the real label-result screen'],
};

const candidateCopy = [
  ['target_contrast', 'You scan the label, then still search for the answer.', 'scanned it. still searching?'],
  ['confession', 'I photographed every label and still missed the useful detail.', 'the useful line was still hiding'],
  ['question', 'Why does reading one tiny label take three different searches?', 'why is one label this much work?'],
  ['challenge', 'One product label should not require three separate searches.', 'one label. three searches.'],
  ['pov', 'The label looks clear, but the answer still is not.', 'clear label, unclear answer'],
  ['discovery', 'The camera catches the label, but not what matters.', 'the photo was never the hard part'],
  ['target_contrast', 'You read every line and still cannot find the warning.', 'where is the line that matters?'],
  ['confession', 'I stopped zooming labels once the result became readable.', 'I was done pinching to zoom'],
];

function writerCandidates() {
  return candidateCopy.map(([patternId, spokenHook, caption], index) => ({
    candidateId: `writer-${index + 1}`,
    patternId,
    spokenHook,
    caption,
    targetBehavior: 'scanning and reading a product label',
    tension: 'still searching for the useful detail',
    evidenceRefs: ['app_summary'],
  }));
}

function candidateIdFromCallKey(callKey) {
  return String(callKey).match(/cold-reader:(r\d+-\d+)$/)?.[1] || '';
}

function deterministicGenerator(counter) {
  return async ({ stage, callKey }) => {
    counter.count += 1;
    if (stage === 'hook_writer') return { candidates: writerCandidates() };
    if (stage === 'hook_cold_reader') {
      const candidateId = candidateIdFromCallKey(callKey);
      return {
        read: {
          candidateId,
          inferredTopic: 'scanning product labels to find useful information',
          topicConfidence: 0.98,
          behaviorOrSituation: 'scanning or reading a product label',
          tensionOrConsequence: 'still searching for the important detail',
          curiosityGap: 'why the scan did not make the answer obvious',
          unexplainedTerms: [],
        },
      };
    }
    if (stage === 'hook_critic') {
      return {
        reviews: Array.from({ length: 8 }, (_, index) => ({
          candidateId: `r1-${index + 1}`,
          verdict: 'pass',
          topicClarity: 5,
          concreteTension: 5,
          curiosity: 4,
          nativeVoice: 5,
          claimSafety: 5,
          topicMatchesEvidence: true,
          supportedEvidenceRefs: ['app_summary'],
          unsupportedSpans: [],
          duplicateClusterId: `label-friction-${index + 1}`,
          nearDuplicateOf: null,
          reason: 'The product-label behavior and search tension are clear and supported.',
        })),
      };
    }
    throw new Error(`Unexpected Hook Agent stage: ${stage}`);
  };
}

function liveCountingAdapters({ hookAgent, counters }) {
  const mocks = resolveGenerationAdapters({});
  return {
    ...mocks,
    hookAgent,
    ugcFirstFrame: {
      ...mocks.ugcFirstFrame,
      live: true,
      async generateFirstFrame(input) {
        counters.firstFrame += 1;
        return mocks.ugcFirstFrame.generateFirstFrame(input);
      },
    },
    ugcSegment: {
      ...mocks.ugcSegment,
      live: true,
      async generateSegment(input) {
        counters.segment += 1;
        counters.segmentRoles.push(input.task.spec?.segmentRole || null);
        return mocks.ugcSegment.generateSegment(input);
      },
    },
    render: {
      ...mocks.render,
      live: true,
      async renderComposition(input) {
        counters.render += 1;
        return mocks.render.renderComposition(input);
      },
    },
  };
}

function storeWithPostPlanningMutation(store, mutate) {
  let mutated = false;
  return {
    ...store,
    async serverCommitTask(args) {
      const job = await store.serverCommitTask(args);
      const committed = job.tasks.find((task) => task.taskId === args.taskId);
      if (!mutated && committed?.outputType === 'ugc_script_plan' && committed.status === 'succeeded') {
        mutated = true;
        const hookPlanningTask = job.tasks.find((task) => task.outputType === 'ugc_hook_plan');
        await mutate({ job, planningTask: hookPlanningTask });
      }
      return job;
    },
  };
}

async function runScenario({ name, mutateAfterPlanning = async () => {} }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `maa-hook-readback-${name}-`));
  let clock = Date.UTC(2026, 6, 9, 20, 0, 0);
  const now = () => { clock += 100; return clock; };
  try {
    const assetStore = createLocalAssetStore({ rootDir: tempRoot });
    const baseStore = createTenantStore({ now });
    const boot = baseStore.bootstrapUser({ email: `${name}@example.test` });
    const claim = baseStore.claimPreview({
      uid: boot.uid,
      email: boot.email,
      previewSessionId: `preview-${name}`,
      canonicalAppId: `zorbly-${name}`,
      extraction,
      productId: 'launch_pack',
    });
    const ref = {
      uid: boot.uid,
      orgId: boot.orgId,
      workspaceId: boot.workspaceId,
      appId: claim.app.appId,
    };
    const pack = createPlannedPack(baseStore, {
      ...ref,
      imageCount: 0,
      videoCount: 1,
      idempotencyKey: `pack-${name}`,
    });
    const created = baseStore.createGenerationJob({ ...ref, packId: pack.pack.packId });
    const intelligence = { count: 0 };
    const persistedAdapter = createPersistedHookAgentAdapter({
      assetStore,
      generateJson: deterministicGenerator(intelligence),
      live: true,
      id: `hook-readback-${name}`,
    });
    let readbackCount = 0;
    const hookAgent = {
      ...persistedAdapter,
      async readPersistedPlan(input) {
        readbackCount += 1;
        return persistedAdapter.readPersistedPlan(input);
      },
    };
    const media = { firstFrame: 0, segment: 0, segmentRoles: [], render: 0 };
    const store = storeWithPostPlanningMutation(baseStore, async (context) => {
      await mutateAfterPlanning({ ...context, assetStore });
    });
    const job = await runCreativeJob({
      store,
      orgId: ref.orgId,
      workspaceId: ref.workspaceId,
      appId: ref.appId,
      jobId: created.job.jobId,
      adapters: liveCountingAdapters({ hookAgent, counters: media }),
      now,
      workerId: `worker-${name}`,
    });
    return { job, intelligenceCalls: intelligence.count, readbackCount, media };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function assertBlockedBeforeMedia(result, expectedError) {
  assert.equal(result.intelligenceCalls, 10, 'readback failure must not restart Hook Agent intelligence');
  assert.deepEqual(mediaCounts(result), { firstFrame: 0, segment: 0, render: 0 });
  assert.equal(result.job.generationProviderCalls, 0);
  const firstFrame = result.job.tasks.find((task) => task.outputType === 'ugc_first_frame');
  assert.equal(firstFrame?.status, 'failed');
  assert.match(firstFrame?.error || '', expectedError);
}

function assertSegmentBlockedBeforeProvider(result) {
  assert.equal(result.intelligenceCalls, 10, 'segment copy validation must not restart Hook Agent intelligence');
  assert.deepEqual(mediaCounts(result), { firstFrame: 1, segment: 3, render: 0 });
  assert.ok(!result.media.segmentRoles.includes('hook'), 'the tampered hook segment must be rejected before its provider call');
  assert.deepEqual([...result.media.segmentRoles].sort(), ['proof_voice', 'reaction', 'tension_bridge']);
  const hookSegment = result.job.tasks.find((task) => task.outputType === 'ugc_segment' && task.spec?.segmentRole === 'hook');
  assert.equal(hookSegment?.status, 'failed');
  assert.match(hookSegment?.error || '', /changed after hook agent approval/i);
}

function mediaCounts(result) {
  return {
    firstFrame: result.media.firstFrame,
    segment: result.media.segment,
    render: result.media.render,
  };
}

const missing = await runScenario({
  name: 'missing',
  async mutateAfterPlanning({ assetStore, planningTask }) {
    await fs.rm(assetStore.resolvePath(planningTask.output.storageKey), { force: true });
  },
});
assertBlockedBeforeMedia(missing, /persisted hook agent plan object is missing/i);

const corrupt = await runScenario({
  name: 'corrupt',
  async mutateAfterPlanning({ assetStore, planningTask }) {
    await assetStore.putObject({
      storageKey: planningTask.output.storageKey,
      bytes: Buffer.from('{"not":"a valid hook plan"}'),
      contentType: planningTask.output.contentType,
    });
  },
});
assertBlockedBeforeMedia(corrupt, /failed immutable readback/i);

const copyTampered = await runScenario({
  name: 'copy-tampered',
  mutateAfterPlanning({ job }) {
    const render = job.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
    render.renderSpec.script.beats.find((beat) => beat.beatId === 'hook').dialogue = 'Tampered hook copy must never reach live media generation.';
  },
});
assertBlockedBeforeMedia(copyTampered, /changed after hook agent approval/i);

const captionTampered = await runScenario({
  name: 'caption-tampered',
  mutateAfterPlanning({ job }) {
    const render = job.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
    render.renderSpec.timeline.find((layer) => layer.type === 'caption' && layer.role === 'hook').text = 'tampered caption';
  },
});
assertBlockedBeforeMedia(captionTampered, /changed after hook agent approval/i);

const hashTampered = await runScenario({
  name: 'hash-tampered',
  mutateAfterPlanning({ job }) {
    const firstFrame = job.tasks.find((task) => task.outputType === 'ugc_first_frame');
    firstFrame.spec.hookSelectionHash = 'tampered-selection-hash';
  },
});
assertBlockedBeforeMedia(hashTampered, /changed after hook agent approval/i);

const segmentLineTampered = await runScenario({
  name: 'segment-line-tampered',
  mutateAfterPlanning({ job }) {
    const hookSegment = job.tasks.find((task) => task.outputType === 'ugc_segment' && task.spec?.segmentRole === 'hook');
    hookSegment.spec.spokenLine = 'Tampered segment line that no longer matches the approved script beat.';
  },
});
assertSegmentBlockedBeforeProvider(segmentLineTampered);

const segmentHookBeatTampered = await runScenario({
  name: 'segment-hook-beat-tampered',
  mutateAfterPlanning({ job }) {
    const hookSegment = job.tasks.find((task) => task.outputType === 'ugc_segment' && task.spec?.segmentRole === 'hook');
    const tampered = 'Tampered segment hook copy that still matches its local spoken line.';
    hookSegment.spec.scriptBeats.find((beat) => beat.beatId === 'hook').dialogue = tampered;
    if (hookSegment.spec.scriptBeat?.beatId === 'hook') hookSegment.spec.scriptBeat.dialogue = tampered;
    hookSegment.spec.spokenLine = tampered;
  },
});
assertSegmentBlockedBeforeProvider(segmentHookBeatTampered);

const valid = await runScenario({ name: 'valid' });
assert.equal(valid.intelligenceCalls, 10, 'valid persisted-plan rereads must add zero intelligence calls');
assert.deepEqual(mediaCounts(valid), { firstFrame: 1, segment: 4, render: 1 });
assert.deepEqual([...valid.media.segmentRoles].sort(), ['hook', 'proof_voice', 'reaction', 'tension_bridge']);
assert.equal(valid.readbackCount, 7, 'the Script Agent plus every UGC source/render call must perform an immutable Hook Plan reread');
assert.ok(['completed', 'completed_with_holds'].includes(valid.job.status));

console.log('Hook plan live-readback gate tests passed');
console.log(JSON.stringify({
  blockedScenarios: 7,
  validReadbacks: valid.readbackCount,
  validIntelligenceCalls: valid.intelligenceCalls,
  validMediaCalls: valid.media.firstFrame + valid.media.segment + valid.media.render,
  providerMutations: 0,
}, null, 2));
