/* Creative job graph + local runner tests.
   Exercises the production-shaped rail end to end with mock adapters:
   claim app -> pack (credits) -> job graph -> runner -> assets/QA/drafts. */

import {
  assertUgcHookPreflight,
  buildCreativeJobGraph,
  buildJobManifest,
  evaluateUgcHook,
  generationJobIdForPack,
  jobProgress,
  preflightUgcGenerationForApp,
  resolveVideoRenderSpecWithInputDurations,
  UGC_HOOK_POLICY,
} from '../lib/creative-job-model.mjs';
import { resolveGenerationAdapters } from '../lib/generation-adapters.mjs';
import { buildLocalMockHookPlan, sealHookPlan } from '../lib/hook-agent.mjs';
import { runCreativeJob } from '../lib/local-job-runner.mjs';
import { createTenantStore } from '../lib/local-tenant-store.mjs';
import { createPlannedPack } from './pack-plan-test-fixture.mjs';
import { creditBalanceFromLedger } from '../lib/tenant-model.mjs';

const PROVIDER_TERMS = ['hyperframes', 'heygen', 'kling', 'seedance', 'gemini', 'remotion', 'sora', 'veo', 'nano banana'];
const failures = [];
let currentTime = Date.UTC(2026, 6, 8, 9, 0, 0);

function now() {
  currentTime += 250;
  return currentTime;
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function checkNoProviderLeak(payload, label) {
  const text = JSON.stringify(payload).toLowerCase();
  for (const term of PROVIDER_TERMS) {
    if (text.includes(term)) failures.push(`provider/backend name "${term}" leaked into ${label}`);
  }
}

const fixtureExtraction = {
  schemaVersion: 'local-app-extraction.v1',
  jobId: 'extract-fixture01',
  source: 'anonymous_preview',
  url: 'https://apps.apple.com/us/app/example/id123456789',
  createdAt: new Date(currentTime).toISOString(),
  providerMutations: 0,
  platform: 'app_store',
  app: {
    name: 'Example: Routine Tracker',
    category: 'Health & Fitness',
    subtitle: 'Track routines without losing your place',
    iconUrl: 'https://cdn.example-store.test/icon.png',
    storeUrl: 'https://apps.apple.com/us/app/example/id123456789',
    summary: 'Example: Routine Tracker helps people keep daily routines on track.',
    description: 'Track routines, reminders, and history in one place.',
  },
  uiObjects: [
    {
      id: 'ui-store-screen-1',
      title: 'Routine history screen',
      description: 'First-party app screen showing routines, reminders, and history.',
      sourceType: 'raw_app_proof',
      sourceUrl: 'https://cdn.example-store.test/1290x2796bb.png',
      rawifyEligible: true,
      usability: { status: 'recommended', label: 'Looks usable', reason: 'High-resolution vertical app screenshot.' },
    },
    {
      id: 'ui-store-screen-2',
      title: 'Daily routine dashboard',
      description: 'First-party dashboard with daily routine progress.',
      sourceType: 'raw_app_proof',
      sourceUrl: 'https://cdn.example-store.test/1290x2796bb-2.png',
      usability: { status: 'recommended', label: 'Looks usable', reason: 'High-resolution vertical app screenshot.' },
    },
  ],
  claimCandidates: [
    { id: 'claim-1', text: "Here's why Example: Routine Tracker is the premier routine tracker for busy people.", source: 'App Store description', selected: true, confidence: 'medium' },
    { id: 'claim-2', text: 'Review tracked history in one place.', source: 'App Store description', selected: true, confidence: 'low' },
  ],
  reviewSummary: { screenCount: 2, claimCount: 2, rawifyCandidateCount: 1, holds: [] },
  styleNotes: ['Plain language', 'Show real app screens'],
};

const rankMechanicExtraction = {
  ...fixtureExtraction,
  jobId: 'extract-rank-fixture01',
  url: 'https://apps.apple.com/us/app/rankfit/id987654321',
  app: {
    ...fixtureExtraction.app,
    name: 'RankFit: Workout Levels',
    subtitle: 'Turn workouts into levels, XP, and quests',
    storeUrl: 'https://apps.apple.com/us/app/rankfit/id987654321',
    summary: 'RankFit turns workouts into quests with XP, levels, and muscle ranks.',
    description: 'See muscle ranks, earn XP, and focus the weak spots in your training.',
  },
  uiObjects: [
    {
      id: 'rank-ui-screen-1',
      title: 'Muscle rank dashboard',
      description: 'First-party app screen showing muscle ranks, XP, weak spots, and workout quests.',
      sourceType: 'raw_app_proof',
      sourceUrl: 'https://cdn.example-store.test/rankfit-screen-1.png',
      usability: { status: 'recommended', label: 'Looks usable', reason: 'Raw app proof screen with ranking mechanics.' },
    },
    {
      id: 'rank-ui-screen-2',
      title: 'Quest progress screen',
      description: 'First-party app screen showing XP gained, class progress, and next workout quest.',
      sourceType: 'raw_app_proof',
      sourceUrl: 'https://cdn.example-store.test/rankfit-screen-2.png',
      usability: { status: 'recommended', label: 'Looks usable', reason: 'Raw app proof screen with progression mechanics.' },
    },
  ],
  claimCandidates: [
    {
      id: 'rank-claim-1',
      text: "Turn your workouts into a game you can't put down with XP, quests, and muscle ranks.",
      source: 'App Store description',
      selected: true,
      confidence: 'high',
    },
  ],
  reviewSummary: { screenCount: 2, claimCount: 1, rawifyCandidateCount: 0, holds: [] },
  styleNotes: ['Plain language', 'Show raw app screens', 'Rank, XP, quest, and weak-spot mechanics'],
};

const languageLearningExtraction = {
  ...fixtureExtraction,
  jobId: 'extract-language-fixture01',
  url: 'https://apps.apple.com/us/app/duolingo-language-lessons/id570060128',
  app: {
    ...fixtureExtraction.app,
    name: 'Duolingo: Language Lessons',
    category: 'Education',
    subtitle: 'Learn Spanish, French, and more',
    storeUrl: 'https://apps.apple.com/us/app/duolingo-language-lessons/id570060128',
    summary: 'Practice a language with short reading, speaking, listening, and translation lessons.',
    description: 'Build vocabulary and practice answering, translating, listening, and speaking in quick lessons.',
  },
  uiObjects: [
    {
      id: 'language-ui-screen-1',
      title: 'Translation lesson',
      description: 'First-party app screen asking the learner to translate a sentence.',
      sourceType: 'raw_app_proof',
      sourceUrl: 'https://cdn.example-store.test/duolingo-translate.png',
      usability: { status: 'recommended', label: 'Looks usable', reason: 'Raw language-lesson screen.' },
    },
    {
      id: 'language-ui-screen-2',
      title: 'Listening exercise',
      description: 'First-party app screen with a listening and answer exercise.',
      sourceType: 'raw_app_proof',
      sourceUrl: 'https://cdn.example-store.test/duolingo-listening.png',
      usability: { status: 'recommended', label: 'Looks usable', reason: 'Raw listening-exercise screen.' },
    },
  ],
  claimCandidates: [
    {
      id: 'language-claim-1',
      text: 'Practice speaking, reading, listening, and writing with quick language lessons.',
      source: 'App Store description',
      selected: true,
      confidence: 'high',
    },
  ],
  reviewSummary: { screenCount: 2, claimCount: 1, rawifyCandidateCount: 0, holds: [] },
  styleNotes: ['Plain language', 'Show raw lesson screens', 'Avoid product jargon in the hook'],
};

const utilityResultExtraction = {
  ...fixtureExtraction,
  jobId: 'extract-utility-result-fixture01',
  url: 'https://apps.apple.com/us/app/labellens/id246813579',
  app: {
    ...fixtureExtraction.app,
    name: 'LabelLens: Quick Scanner',
    category: 'Utilities',
    subtitle: 'Scan labels and get a clear result',
    storeUrl: 'https://apps.apple.com/us/app/labellens/id246813579',
    summary: 'Scan a label and get a clear answer without searching manually.',
    description: 'Use the scanner to identify label details and review the result on screen.',
  },
  uiObjects: [
    {
      id: 'utility-ui-screen-1',
      title: 'Scanner result',
      description: 'First-party app screen showing a scanned label answer.',
      sourceType: 'raw_app_proof',
      sourceUrl: 'https://cdn.example-store.test/labellens-result.png',
      usability: { status: 'recommended', label: 'Looks usable', reason: 'Raw scanner result screen.' },
    },
  ],
  claimCandidates: [
    {
      id: 'utility-claim-1',
      text: 'Scan a label and get a clear result.',
      source: 'App Store description',
      selected: true,
      confidence: 'high',
    },
  ],
  reviewSummary: { screenCount: 1, claimCount: 1, rawifyCandidateCount: 0, holds: [] },
  styleNotes: ['Plain language', 'Show raw scanner proof'],
};

const storeArtOnlyExtraction = {
  ...rankMechanicExtraction,
  jobId: 'extract-store-art-only-fixture01',
  url: 'https://apps.apple.com/us/app/storeproof/id555555555',
  app: {
    ...rankMechanicExtraction.app,
    name: 'StoreProof: Workout Levels',
    storeUrl: 'https://apps.apple.com/us/app/storeproof/id555555555',
  },
  uiObjects: rankMechanicExtraction.uiObjects.map((object, index) => ({
    ...object,
    id: `store-art-only-screen-${index + 1}`,
    title: `Store marketing screenshot ${index + 1}`,
    description: 'App Store marketing card, not raw in-app proof.',
    sourceType: 'store_art',
    rawifyEligible: true,
  })),
  reviewSummary: { screenCount: 2, claimCount: 1, rawifyCandidateCount: 2, holds: [] },
};

const store = createTenantStore({ now });
const boot = store.bootstrapUser({ email: 'owner@example.test' });
const claim = store.claimPreview({
  uid: boot.uid,
  email: boot.email,
  previewSessionId: 'session-job-test',
  canonicalAppId: 'app-store-123456789',
  extraction: fixtureExtraction,
  productId: 'launch_pack',
});
const appId = claim.app.appId;
const ctx = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId };

/* Pack: 1 image + 1 UGC, the first canary mix. */
const pack = createPlannedPack(store, {
  ...ctx,
  imageCount: 1,
  videoCount: 1,
  idempotencyKey: 'job-test-pack',
  appPlan: {
    screens: claim.app.screens.map((screen) => ({ id: screen.id, selected: screen.selected, ignored: Boolean(screen.ignored) })),
    claims: claim.app.claims.map((item) => ({ id: item.id, text: item.text, selected: item.selected, ignored: Boolean(item.ignored), supported: item.supported })),
  },
});
const packId = pack.pack.packId;
const balanceAfterPack = pack.creditBalance;
check(pack.pack.sourceReadiness?.creativePreflight?.status === 'ready_for_hook_agent', 'paid pack creation must validate reviewed inputs for the async Hook Agent before recording the credit debit');
check(pack.pack.sourceReadiness?.creativePreflight?.generationProviderCalls === 0, 'pack hook preflight must use zero generation-provider calls');

/* Job creation: graph shape + idempotency + authorization. */
let missingPackBlocked = false;
try {
  store.createGenerationJob({ ...ctx, packId: 'pack-forged' });
} catch {
  missingPackBlocked = true;
}
check(missingPackBlocked, 'job creation must block forged pack IDs');

let outsiderBlocked = false;
try {
  store.createGenerationJob({ ...ctx, uid: 'user-outsider', packId });
} catch {
  outsiderBlocked = true;
}
check(outsiderBlocked, 'job creation must block non-members');

const created = store.createGenerationJob({ ...ctx, packId });
check(created.idempotent === false, 'first job creation should be fresh');
check(created.job.jobId === generationJobIdForPack(packId), 'job id must be deterministic per pack');
check(created.job.status === 'queued', 'new job must be queued');
checkNoProviderLeak(created.job, 'created job payload');

const retryJob = store.createGenerationJob({ ...ctx, packId });
check(retryJob.idempotent === true, 'job creation retry must be idempotent');
check(retryJob.job.jobId === created.job.jobId, 'job retry must return the same job');

const tasks = created.job.tasks;
const hookPlanningTasks = tasks.filter((task) => task.kind === 'planning' && task.outputType === 'ugc_hook_plan');
const scriptPlanningTasks = tasks.filter((task) => task.kind === 'planning' && task.outputType === 'ugc_script_plan');
const imageSourceTasks = tasks.filter((task) => task.outputType === 'image_ad_source');
const imageRenderTasks = tasks.filter((task) => task.kind === 'render' && task.outputType === 'image_ad');
const firstFrameTasks = tasks.filter((task) => task.outputType === 'ugc_first_frame');
const segmentTasks = tasks.filter((task) => task.outputType === 'ugc_segment');
const proofTasks = tasks.filter((task) => task.kind === 'proof_prep');
const ugcRenderTasks = tasks.filter((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
const qaTasks = tasks.filter((task) => task.kind === 'qa');
check(imageSourceTasks.length === 1, '1 image ad request must create exactly one image source-layer generation task');
check(hookPlanningTasks.length === 1, 'every UGC pack must create one shared Hook Agent planning task');
check(scriptPlanningTasks.length === 1, 'every UGC pack must create one shared evidence-bound Script Agent planning task');
check(scriptPlanningTasks[0]?.dependsOn?.includes(hookPlanningTasks[0]?.taskId), 'Script Agent must wait for the selected Hook Plan');
check(scriptPlanningTasks[0]?.spec?.status === 'pending_selected_hook_plan', 'Script Agent request must remain unconfigured before Hook Agent selection');
check(hookPlanningTasks[0]?.spec?.intelligenceMode === 'writer_then_isolated_blind_reader_then_evidence_critic', 'Hook Agent task must declare writer/isolated-blind-reader/evidence-critic intelligence');
check(hookPlanningTasks[0]?.spec?.hookRequest?.candidatePoolSize === 8, 'Hook Agent request must enforce one eight-candidate pool');
check(hookPlanningTasks[0]?.spec?.hookRequest?.maxQualityRounds === 2, 'Hook Agent request must cap semantic repair at two rounds');
check(hookPlanningTasks[0]?.spec?.hookRequest?.maxIntelligenceCalls === 20, 'Hook Agent request must carry a hard 20-call ceiling');
check(Boolean(hookPlanningTasks[0]?.spec?.hookRequest?.sourceFingerprint), 'Hook Agent request must fingerprint the exact reviewed source');
check(Boolean(hookPlanningTasks[0]?.spec?.hookRequest?.requestFingerprint), 'Hook Agent request must carry an immutable request fingerprint');
check(imageRenderTasks.length === 1, 'image ads must get their own finishing/composition task');
check(imageRenderTasks[0].dependsOn.length === 1 && imageRenderTasks[0].dependsOn[0] === imageSourceTasks[0].taskId, 'image finishing must depend on the source layer');
check(imageRenderTasks[0].renderSpec?.format === 'image', 'image finishing must carry an image-format render spec');
check(
  (imageRenderTasks[0].renderSpec.timeline || []).some((layer) => layer.type === 'proof_media'),
  'image finishing timeline must include a real screenshot proof layer'
);
const imageHeadline = (imageRenderTasks[0].renderSpec.timeline || []).find((layer) => layer.role === 'headline')?.text || '';
const imageCta = (imageRenderTasks[0].renderSpec.timeline || []).find((layer) => layer.type === 'cta')?.text || '';
check(imageHeadline === 'Keep daily routines on track', `image headline must be ad-safe copy, got "${imageHeadline}"`);
check(!/here'?s why|premier|\\.\\.\\./i.test(imageHeadline), 'image headline must not expose raw extracted marketing filler or truncation');
check(imageCta === 'Get Example', `image CTA should use the short app name, got "${imageCta}"`);
check(firstFrameTasks.length === 1, 'default V6 UGC must create one shared creator first-frame image');
check(segmentTasks.length === 4, 'default V6 UGC must use separate hook, tension/bridge, proof, and reaction creator clips');
check(['hook', 'tension_bridge', 'proof_voice', 'reaction'].every((role) => segmentTasks.some((task) => task.spec.segmentRole === role)), 'default V6 segments must cover hook, tension_bridge, proof_voice, and reaction roles');
check(segmentTasks.every((task) => task.dependsOn.includes(firstFrameTasks[0]?.taskId)), 'every V6 creator clip must depend on the shared first-frame image');
check(firstFrameTasks.every((task) => task.dependsOn.includes(scriptPlanningTasks[0]?.taskId)), 'UGC frame generation must wait for Script Agent selection');
check(segmentTasks.every((task) => task.dependsOn.includes(scriptPlanningTasks[0]?.taskId)), 'every UGC creator clip must wait for Script Agent selection');
check(segmentTasks.every((task) => task.spec.sharedFirstFrameTaskId === firstFrameTasks[0]?.taskId), 'every V6 creator clip must reference the shared first-frame task in its spec');
check(proofTasks.length === 1, '1 UGC ad must include a proof/cutaway prep task');
check(ugcRenderTasks.length === 1, '1 UGC ad must include one finishing/composition render task');
check(qaTasks.length === 2, 'each customer-visible output must get a QA task');
check(
  ugcRenderTasks[0].dependsOn.length === 5
  && segmentTasks.every((task) => ugcRenderTasks[0].dependsOn.includes(task.taskId))
  && ugcRenderTasks[0].dependsOn.includes(proofTasks[0].taskId),
  'render task must depend on the four creator clips plus proof prep'
);

const renderTasks = ugcRenderTasks;
const renderSpec = renderTasks[0].renderSpec;
check(renderSpec.format === 'video', 'UGC render spec must carry the video format');
check(renderSpec.ugcRoute === 'ugc_selfie_proof_reveal', 'default UGC route must be the V6 organic selfie route');
check(renderSpec.recipe?.id === 'ugc_selfie_proof_reveal', 'V6 render spec must stamp the recipe');
check(renderSpec.recipe?.creatorContinuity?.description, 'V6 recipe must lock a stable creator identity');
check(renderSpec.recipe?.creatorContinuity?.sourcePolicy === 'multi_clip_shared_first_frame', 'V6 recipe must use separate clips with one shared first-frame source');
check(renderSpec.renderManifest?.creatorSourcePolicy === 'multi_clip_shared_first_frame', 'V6 render manifest must carry the shared-first-frame source policy');
check(renderSpec.renderManifest?.sharedFirstFrame?.taskId === firstFrameTasks[0]?.taskId, 'V6 render manifest must identify the shared first-frame task');
check(renderSpec.renderManifest?.visualContinuity?.mode === 'shared_first_frame_across_blocks', 'V6 render manifest must carry visible continuity instructions');
check(renderSpec.script?.beats?.length === 7, 'V6 render spec must carry the locked seven-beat UGC script arc');
check(renderSpec.script?.hookPolicy?.format === UGC_HOOK_POLICY.format, 'V6 script must carry the sharp-hook quality contract');
check(renderSpec.script?.flowPolicy === 'multi_clip_shared_first_frame', 'V6 script must be planned as multi-clip with one shared visual anchor');
check(renderSpec.emotionPlan?.firstFrame?.prompt === 'Pending evidence-bound Script Agent first-frame direction.', 'pre-run V6 first-frame direction must stay pending rather than using a category template');
check(renderSpec.script?.scriptPlan === undefined, 'pre-run V6 script must not pretend a Script Agent plan exists');
check(renderSpec.renderManifest?.noCtaCard === true, 'V6 render manifest must forbid CTA cards');
const ugcHookCaption = (renderSpec.timeline || []).find((layer) => layer.type === 'caption' && layer.role === 'hook')?.text || '';
const ugcRevealCaptionLayer = (renderSpec.timeline || []).find((layer) => layer.type === 'caption' && layer.role === 'reveal');
const ugcRevealCaption = ugcRevealCaptionLayer?.text || '';
const ugcCtaLayers = (renderSpec.timeline || []).filter((layer) => layer.type === 'cta');
const genericProofCaptions = (renderSpec.timeline || []).filter((layer) => layer.type === 'caption' && /real app screens|not mockups/i.test(layer.text || ''));
const v6ProofLayers = (renderSpec.timeline || []).filter((layer) => layer.type === 'proof_media');
const v6ProofVoiceLayer = (renderSpec.timeline || []).find((layer) => layer.type === 'creator_video' && layer.role === 'proof_voice');
const v6HookBeat = (renderSpec.script?.beats || []).find((beat) => beat.beatId === 'hook');
const v6ReactionBeat = (renderSpec.script?.beats || []).find((beat) => beat.beatId === 'reaction');
check(ugcHookCaption === '', 'UGC hook caption must remain pending until the async Hook Agent runs');
check(v6HookBeat?.dialogue === '', 'UGC spoken hook must remain pending instead of using category hard-coded copy');
check(renderSpec.script?.hookPlan?.status === 'pending_intelligence', 'pre-run render contract must explicitly mark hook intelligence pending');
check(ugcRevealCaption === "It's called Example", `V6 reveal caption must be casual app reveal, got "${ugcRevealCaption}"`);
check(ugcCtaLayers.length === 0, 'V6 organic selfie route must not add a CTA card/pill layer');
check(genericProofCaptions.length === 0, 'V6 route must not add generic proof captions');
check(v6ProofLayers.every((layer) => layer.start < v6ProofVoiceLayer.start + v6ProofVoiceLayer.duration && layer.start + layer.duration > v6ProofVoiceLayer.start), 'V6 proof layers must overlap the proof-voice creator beat');
check(v6ReactionBeat?.dialogue?.split(/\s+/).length <= 18, `V6 reaction line must stay short enough for the final slot, got "${v6ReactionBeat?.dialogue}"`);
check(v6ReactionBeat?.maxSpokenSeconds <= 4.3, 'V6 reaction beat must carry a short planned spoken budget');
check(v6ReactionBeat?.mustCompleteBySeconds <= 27.25, 'V6 reaction beat must finish the app-name reveal before the planned tail');
check(ugcRevealCaptionLayer?.start >= 23 && ugcRevealCaptionLayer?.start <= 25.1, 'V6 reveal caption must begin inside the final reaction slot');
check(ugcRevealCaptionLayer?.start + ugcRevealCaptionLayer?.duration <= 27.35, 'V6 reveal caption must leave visible tail room before render end');
for (const field of ['compositionKey', 'variablesKey', 'inputAssetIds', 'durationSeconds', 'fps', 'dimensions', 'outputKey']) {
  check(renderSpec[field] !== undefined, `render spec must carry portable contract field "${field}"`);
}
check(renderSpec.compositionKey.startsWith(`orgs/${boot.orgId}/`), 'render spec keys must be tenant-scoped');
check(tasks.every((task) => !task.output || task.output.storageKey.startsWith(`orgs/${boot.orgId}/workspaces/${boot.workspaceId}/apps/${appId}/jobs/`)), 'all task outputs must use tenant-scoped job storage keys');

const maximumBoundedGraph = buildCreativeJobGraph({
  jobId: 'job-maximum-bounded-size',
  orgId: boot.orgId,
  workspaceId: boot.workspaceId,
  appId,
  packId: 'pack-maximum-bounded-size',
  createdBy: boot.uid,
  imageCount: 40,
  videoCount: 6,
  app: claim.app,
  costCredits: (40 * 4) + (6 * 60),
  createdAt: new Date(currentTime).toISOString(),
});
check(Buffer.byteLength(JSON.stringify(maximumBoundedGraph)) < 600_000, 'maximum accepted pre-execution graph must retain Firestore document headroom');
let maximumStoredJob = maximumBoundedGraph;
const maximumGraphStore = {
  async serverReadJob() { return maximumStoredJob; },
  async serverSaveJob(job) { maximumStoredJob = job; return job; },
  async serverFinalizeJob({ job }) { maximumStoredJob = job; return job; },
};
const maximumFinishedGraph = await runCreativeJob({
  store: maximumGraphStore,
  orgId: boot.orgId,
  workspaceId: boot.workspaceId,
  appId,
  jobId: maximumBoundedGraph.jobId,
  adapters: resolveGenerationAdapters({}),
  now,
});
check(maximumFinishedGraph.status === 'completed', 'maximum accepted 40-image/6-UGC graph must complete structurally');
check(Buffer.byteLength(JSON.stringify(maximumFinishedGraph)) < 800_000, 'maximum completed mock graph must remain below Firestore document size with operating headroom');
check(maximumFinishedGraph.generationProviderCalls === 0 && maximumFinishedGraph.providerMutations === 0, 'maximum structural graph test must make zero provider calls or mutations');

const sourceHeavyExtraction = {
  ...fixtureExtraction,
  jobId: 'extract-source-heavy-size-fixture',
  app: {
    ...fixtureExtraction.app,
    name: 'SourceHeavy: Evidence Library',
    summary: `Review a large evidence library safely. ${'Detailed reviewed context. '.repeat(40)}`,
  },
  uiObjects: Array.from({ length: 20 }, (_, index) => ({
    id: `heavy-screen-${index + 1}`,
    title: `Reviewed evidence screen ${index + 1}`,
    description: `First-party reviewed screen ${index + 1}. ${'Detailed interface evidence. '.repeat(25)}`,
    sourceType: 'raw_app_proof',
    sourceUrl: `https://cdn.example-store.test/heavy-${index + 1}.png`,
    usability: { status: 'recommended', label: 'Looks usable', reason: 'Reviewed first-party app proof.' },
  })),
  claimCandidates: Array.from({ length: 20 }, (_, index) => ({
    id: `heavy-claim-${index + 1}`,
    text: `Reviewed supported capability ${index + 1}: ${'specific source-backed detail '.repeat(20)}`,
    source: 'Reviewed app info',
    selected: true,
    confidence: 'high',
  })),
  styleNotes: Array.from({ length: 24 }, (_, index) => `Reviewed style instruction ${index + 1}: ${'specific visual guidance '.repeat(18)}`),
  reviewSummary: { screenCount: 20, claimCount: 20, rawifyCandidateCount: 0, holds: [] },
};
const sourceHeavyStore = createTenantStore({ now });
const sourceHeavyBoot = sourceHeavyStore.bootstrapUser({ email: 'source-heavy@example.test' });
const sourceHeavyClaim = sourceHeavyStore.claimPreview({
  uid: sourceHeavyBoot.uid,
  email: sourceHeavyBoot.email,
  previewSessionId: 'session-source-heavy-size',
  canonicalAppId: 'app-store-source-heavy',
  extraction: sourceHeavyExtraction,
  productId: 'launch_pack',
});
let sourceHeavyBlockedBeforeDebit = false;
try {
  createPlannedPack(sourceHeavyStore, {
    uid: sourceHeavyBoot.uid,
    orgId: sourceHeavyBoot.orgId,
    workspaceId: sourceHeavyBoot.workspaceId,
    appId: sourceHeavyClaim.app.appId,
    imageCount: 40,
    videoCount: 6,
    idempotencyKey: 'source-heavy-pack',
  });
} catch (error) {
  sourceHeavyBlockedBeforeDebit = /too large for safe persistence/i.test(error.message);
}
check(sourceHeavyBlockedBeforeDebit, 'source-heavy max packs must fail the persistence budget before the credit-balance/debit path');

/* Adapters default to local mocks; live mode must refuse without env flags. */
const adapters = resolveGenerationAdapters({});
check(adapters.hookAgent.live === false && adapters.scriptAgent.live === false && adapters.imageAd.live === false && adapters.ugcFirstFrame.live === false && adapters.ugcSegment.live === false && adapters.render.live === false, 'default adapters must be local mocks');
let liveBlocked = false;
try {
  resolveGenerationAdapters({ MAA_IMAGE_ADAPTER: 'live' });
} catch {
  liveBlocked = true;
}
check(liveBlocked, 'live adapters must refuse to construct without MAA_LIVE_ADAPTERS_ENABLED=1');

/* Runner: executes the whole graph with mocks. */
const finished = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId, jobId: created.job.jobId, adapters, now });
check(finished.status === 'completed', `job should complete cleanly, got ${finished.status}`);
check(finished.tasks.every((task) => task.status === 'succeeded'), 'all tasks should succeed with mock adapters');
check(finished.assets.length === 11, 'assets: hook plan + script plan + image source + image ad + shared first frame + four creator clips + proof artifact + rendered ad');
check((finished.creativeIntelligenceCalls || 0) === 0, 'mock runs must record zero live creative-intelligence calls');
check((finished.generationProviderCalls || 0) === 0, 'mock runs must record zero generation provider calls');
check(finished.assets.every((asset) => asset.storageKey.startsWith(`orgs/${boot.orgId}/`)), 'stored assets must be tenant-scoped');
check(finished.assets.every((asset) => asset.mode === 'local_mock'), 'mock assets must be flagged local_mock');
const hookPlanAsset = finished.assets.find((asset) => asset.kind === 'ugc_hook_plan');
const finishedHookPlanningTask = finished.tasks.find((task) => task.outputType === 'ugc_hook_plan');
check(Boolean(hookPlanAsset?.planFingerprint), 'planning must persist an immutable Hook Plan artifact before media');
check(hookPlanAsset?.planFingerprint === finishedHookPlanningTask?.hookPlan?.planFingerprint, 'persisted Hook Plan artifact and job summary fingerprints must match');
check(hookPlanAsset?.requestFingerprint === finishedHookPlanningTask?.spec?.hookRequest?.requestFingerprint, 'persisted Hook Plan must be bound to the task request fingerprint');
const scriptPlanAsset = finished.assets.find((asset) => asset.kind === 'ugc_script_plan');
const finishedScriptPlanningTask = finished.tasks.find((task) => task.outputType === 'ugc_script_plan');
check(Boolean(scriptPlanAsset?.planFingerprint), 'planning must persist an immutable Script Plan artifact before media');
check(scriptPlanAsset?.planFingerprint === finishedScriptPlanningTask?.scriptPlan?.planFingerprint, 'persisted Script Plan artifact and job summary fingerprints must match');
check(scriptPlanAsset?.hookPlanFingerprint === finishedHookPlanningTask?.hookPlan?.planFingerprint, 'Script Plan must be bound to the selected Hook Plan');
check(
  finishedScriptPlanningTask?.spec?.scriptRequest?.unitBindings?.[0]?.claimIds?.length === 1,
  'one UGC unit must stay bound to the exact supporting claim assigned by the approved Pack Plan',
);

const renderAsset = finished.assets.find((asset) => asset.kind === 'ugc_ad');
check(Boolean(renderAsset), 'render task must store a composed UGC ad asset');
check(renderAsset?.durationSeconds === 28 && renderAsset?.fps === 30, 'rendered asset must match the resolved multi-clip source duration/fps');
check(renderTasks[0].renderSpec.inputAssetIds.length === 0, 'graph template must not pre-fill runtime asset ids');
const finishedRender = finished.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
const finishedHookBeat = finishedRender.renderSpec.script.beats.find((beat) => beat.beatId === 'hook');
const finishedHookCaption = finishedRender.renderSpec.timeline.find((layer) => layer.type === 'caption' && layer.role === 'hook');
check(finishedHookBeat?.dialogue?.startsWith('Offline fixture hook'), 'runner must hydrate the creator hook from the planning artifact before media tasks run');
check(finishedHookCaption?.text?.startsWith('offline fixture hook'), 'runner must hydrate the matching hook caption from the planning artifact');
check(finishedHookCaption?.start === 0, 'hook caption must be visible from the first rendered frame');
check(finishedRender.renderSpec.script.hookPlan?.status === 'selected', 'runner must stamp selected Hook Agent metadata into the render script');
check(finishedRender.renderSpec.script.scriptPlan?.status === 'selected', 'runner must stamp selected evidence-bound Script Agent metadata into the render script');
check(finishedRender.renderSpec.emotionPlan?.source === 'script_agent', 'creator framing must come from the Script Agent rather than a category map');
check(finishedRender.renderSpec.inputAssetIds.length === 5, 'runner must fill render inputAssetIds from the four creator clips and proof prep');
check(finishedRender.renderSpec.renderManifest.durationMode === 'source_clip_sum', 'runner must resolve UGC render duration from actual source clips');
check(finishedRender.renderSpec.durationSeconds === 28, 'runner must use the actual multi-clip source duration before finishing');
const finishedReactionLayer = finishedRender.renderSpec.timeline.find((layer) => layer.type === 'creator_video' && layer.role === 'reaction');
const finishedRevealCaption = finishedRender.renderSpec.timeline.find((layer) => layer.type === 'caption' && layer.role === 'reveal');
const finishedReactionBeat = finishedRender.renderSpec.script.beats.find((beat) => beat.beatId === 'reaction');
const finishedPayloadBeat = finishedRender.renderSpec.script.beats.find((beat) => beat.beatId === 'payload');
const finishedProofBeat = finishedRender.renderSpec.script.beats.find((beat) => beat.beatId === 'proof_voice');
const finishedReinforcementBeat = finishedRender.renderSpec.script.beats.find((beat) => beat.beatId === 'reinforcement');
check(finishedReactionLayer.start === 20 && finishedReactionLayer.duration === 8, 'resolved reaction layer must use the generated final creator clip');
check(finishedPayloadBeat.startSeconds === 12 && finishedPayloadBeat.endSeconds === 16, 'dynamic duration resolution must preserve payload timing inside the proof creator clip');
check(finishedProofBeat.startSeconds === 16 && finishedProofBeat.endSeconds === 20, 'dynamic duration resolution must preserve proof_voice timing inside the proof creator clip');
check(finishedReinforcementBeat.startSeconds === 20 && finishedReinforcementBeat.endSeconds === 23, 'dynamic duration resolution must preserve reinforcement timing inside the reaction creator clip');
check(finishedReactionBeat.startSeconds === 23, 'dynamic duration resolution must preserve reaction timing inside the final creator clip');
check(finishedReactionBeat.endSeconds === 28 && finishedReactionBeat.mustCompleteBySeconds <= 27.25, 'resolved reaction script must leave tail room inside the actual final clip');
check(finishedRevealCaption.start + finishedRevealCaption.duration <= 27.35, 'resolved reveal caption must leave tail room before the dynamic render end');

const crossSegmentProofSpec = resolveVideoRenderSpecWithInputDurations({
  renderSpec: {
    format: 'video',
    ugcRoute: 'ugc_selfie_proof_reveal',
    durationSeconds: 28,
    timeline: [
      { id: 'hook', type: 'creator_video', role: 'hook', sourceTaskId: 'hook-task', start: 0, duration: 4 },
      { id: 'tension', type: 'creator_video', role: 'tension_bridge', sourceTaskId: 'tension-task', start: 4, duration: 8 },
      { id: 'proof', type: 'creator_video', role: 'proof_voice', sourceTaskId: 'proof-task', start: 12, duration: 8 },
      { id: 'reaction', type: 'creator_video', role: 'reaction', sourceTaskId: 'reaction-task', start: 20, duration: 8 },
      { id: 'proof-voice-screen', type: 'proof_media', proofId: 'screen-1', proofBeatId: 'proof_voice', start: 16, duration: 4 },
      { id: 'reinforcement-screen-a', type: 'proof_media', proofId: 'screen-2', proofBeatId: 'reinforcement', start: 20, duration: 1.5 },
      { id: 'reinforcement-screen-b', type: 'proof_media', proofId: 'screen-3', proofBeatId: 'reinforcement', start: 21.5, duration: 1.5 },
    ],
    script: {
      beats: [
        { beatId: 'proof_voice', startSeconds: 16, endSeconds: 20 },
        { beatId: 'reinforcement', startSeconds: 20, endSeconds: 23 },
      ],
    },
    renderManifest: { proofWindow: { startAt: 16, endBy: 23 } },
  },
  inputAssets: [
    { taskId: 'hook-task', durationSeconds: 4.01 },
    { taskId: 'tension-task', durationSeconds: 8 },
    { taskId: 'proof-task', durationSeconds: 10.01 },
    { taskId: 'reaction-task', durationSeconds: 8 },
  ],
});
const retimedReinforcementProofs = crossSegmentProofSpec.timeline.filter((layer) => layer.proofBeatId === 'reinforcement');
check(
  retimedReinforcementProofs.map((layer) => [layer.start, layer.duration]).join('|') === '22.02,1.5|23.52,1.5',
  'proof layers must follow the creator segment that owns their spoken beat instead of collapsing at the preceding clip boundary',
);
check(
  crossSegmentProofSpec.timeline.findIndex((layer) => layer.id === 'reaction')
    < crossSegmentProofSpec.timeline.findIndex((layer) => layer.id === 'reinforcement-screen-a'),
  'a proof layer starting with its creator segment must stack after that video so the proof remains visible',
);
check(
  crossSegmentProofSpec.renderManifest.proofWindow.startAt === 17.02 && crossSegmentProofSpec.renderManifest.proofWindow.endBy === 25.02,
  'dynamic duration resolution must update the proof-window manifest to the retimed visual interval',
);
const finishedProofLayers = finishedRender.renderSpec.timeline.filter((layer) => layer.type === 'proof_media');
check(finishedProofLayers.length === 1, 'finishing must bind the exact proof screen assigned by the approved Pack Plan to a visible script beat');
check(finishedRender.renderSpec.renderManifest.omittedUnreferencedProofIds.length === 0, 'selected Script Agent plan must not silently omit assigned proof screens');
check(finishedProofLayers.every((layer) => {
  const beat = finishedRender.renderSpec.script.beats.find((candidate) => candidate.beatId === layer.proofBeatId);
  return beat && beat.evidenceRefs.includes(layer.proofId) && layer.proofLine === beat.dialogue
    && layer.start < beat.endSeconds && layer.start + layer.duration > beat.startSeconds;
}), 'every proof layer must show only while its exact evidence-citing spoken beat runs');
const finishedImageRender = finished.tasks.find((task) => task.kind === 'render' && task.outputType === 'image_ad');
check(finishedImageRender.renderSpec.inputAssetIds.length === 1, 'image finishing must record its source-layer input asset');

/* QA reports: shape, verdicts, provider hygiene. */
check(finished.qaReports.length === 2, 'one QA report per customer-visible output');
for (const report of finished.qaReports) {
  check(report.verdict === 'pass', `QA report ${report.reportId} should pass with mock media`);
  check(report.providerMutations === 0, 'QA reports must record providerMutations 0');
  check(report.media.stubbed === true, 'QA must flag stubbed media placeholders');
  check(report.proofIds.length > 0, 'QA must record proof IDs');
  check(report.checks.some((item) => item.id === 'claim_support'), 'QA must check claim support');
  check(Number.isInteger(report.attempts) && report.attempts >= 1, 'QA must record retry/attempt counts');
  if (report.outputType === 'image_ad') {
    for (const checkId of ['image_headline_complete', 'image_cta_complete']) {
      check(report.checks.some((item) => item.id === checkId && item.status === 'pass'), `image QA must pass ${checkId}`);
    }
  }
  if (report.outputType === 'ugc_ad') {
    for (const checkId of ['recipe_contract', 'script_locked', 'proof_under_voiceover', 'creator_identity_locked', 'shared_first_frame_source', 'visible_continuity_contract', 'dialogue_flow_punchy', 'creator_speech_fit', 'hook_policy_locked', 'creative_hook_specificity', 'hook_caption_sharpness', 'hook_caption_first_frame', 'hook_selection_integrity', 'hook_evidence_refs', 'script_plan_integrity', 'organic_caption_style', 'no_generic_proof_caption', 'organic_no_cta_card', 'brand_reveal_policy', 'reveal_tail_room', 'claim_to_proof_line', 'proof_line_alignment', 'proof_inventory_coverage', 'final_action_strength', 'proof_source_strength']) {
      check(report.checks.some((item) => item.id === checkId && item.status === 'pass'), `V6 QA must pass ${checkId}`);
    }
  }
}

/* Drafts land on the pack/app for Review Drafts. */
check(finished.drafts.length === 2, 'job must produce one draft per requested ad');
check(finished.drafts.every((draft) => draft.status === 'ready_for_review'), 'passing drafts must be ready for review');
const finalApp = store.readAppForUser(ctx);
check(finalApp.ads.filter((ad) => ad.jobId === finished.jobId).length === 2, 'drafts must land in the app Review Drafts list');
check(finalApp.runs.find((run) => run.id === packId)?.status === 'ready', 'the pack run must flip to ready after generation');
const finalJob = store.readJobForUser({ ...ctx, jobId: finished.jobId });
check(finalJob.progress.percent === 100, 'finished job must report 100% progress');
checkNoProviderLeak(finalJob, 'finished job payload');
checkNoProviderLeak(finalApp, 'app payload after generation');
const finishedManifest = buildJobManifest(finished);
checkNoProviderLeak(finishedManifest, 'job manifest');
const manifestUgcRender = finishedManifest.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
check(manifestUgcRender?.renderSpec?.hookQuality?.status === 'pass', 'job manifest must preserve the pre-generation hook-quality verdict');
check(manifestUgcRender?.renderSpec?.hookPolicy?.format === UGC_HOOK_POLICY.format, 'job manifest must preserve the sharp-hook contract');

/* Creative quality regression: even when a fixture contains specific mechanics,
   the deterministic script rail should not inject app-specific game language.
   Specific named mechanics need to come from an extracted mechanic inventory,
   not hardcoded copy branches. */
const rankClaim = store.claimPreview({
  uid: boot.uid,
  email: boot.email,
  previewSessionId: 'session-rank-mechanic-test',
  canonicalAppId: 'app-store-987654321',
  extraction: rankMechanicExtraction,
  productId: 'launch_pack',
});
const rankCtx = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: rankClaim.app.appId };
const rankPack = createPlannedPack(store, {
  ...rankCtx,
  imageCount: 1,
  videoCount: 1,
  idempotencyKey: 'job-test-rank-mechanic-pack',
});
const rankCreated = store.createGenerationJob({ ...rankCtx, packId: rankPack.pack.packId });
const rankImageRender = rankCreated.job.tasks.find((task) => task.kind === 'render' && task.outputType === 'image_ad');
const rankImageHeadline = (rankImageRender.renderSpec.timeline || []).find((layer) => layer.role === 'headline')?.text || '';
check(rankImageHeadline === 'Turn your workouts into a game', `rank mechanic image headline should avoid dangling truncation, got "${rankImageHeadline}"`);
check(!/can'?t$|\\byou$/i.test(rankImageHeadline), 'rank mechanic image headline must not end on a dangling phrase');

const rankUgcRender = rankCreated.job.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
const rankBeats = rankUgcRender.renderSpec.script.beats;
const rankHook = rankBeats.find((beat) => beat.beatId === 'hook')?.dialogue || '';
const rankProof = rankBeats.find((beat) => beat.beatId === 'proof_voice')?.dialogue || '';
const rankReaction = rankBeats.find((beat) => beat.beatId === 'reaction')?.dialogue || '';
check(rankHook === '', 'rank-app hook must remain pending instead of being selected by a category branch');
check(!/e-rank|xp|quest|ranked each|weak spot/i.test(rankProof), `UGC proof line must not inject hardcoded game mechanics, got "${rankProof}"`);
check(!/e-rank|xp|quest|weak spot/i.test(rankReaction), `UGC final line must not inject hardcoded game mechanics, got "${rankReaction}"`);
const rankFinished = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: rankClaim.app.appId, jobId: rankCreated.job.jobId, adapters, now });
check(rankFinished.status === 'completed', `generalized UGC job should pass QA with raw proof, got ${rankFinished.status}`);
const rankFinishedRender = rankFinished.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
const rankFinishedHook = rankFinishedRender?.renderSpec?.script?.beats?.find((beat) => beat.beatId === 'hook')?.dialogue || '';
check(!/e-rank|xp|quest|ranked each|weak spot/i.test(rankFinishedHook), `Hook Agent selection must not inject unsupported mechanics, got "${rankFinishedHook}"`);
const rankUgcReport = rankFinished.qaReports.find((report) => report.outputType === 'ugc_ad');
for (const checkId of ['shared_first_frame_source', 'visible_continuity_contract', 'dialogue_flow_punchy', 'hook_policy_locked', 'specific_term_support', 'creative_hook_specificity', 'hook_caption_sharpness', 'hook_selection_integrity', 'hook_evidence_refs', 'proof_line_alignment', 'final_action_strength', 'proof_source_strength']) {
  check(rankUgcReport?.checks.some((item) => item.id === checkId && item.status === 'pass'), `generalized UGC QA must pass ${checkId}`);
}

/* Hook copy is asynchronous intelligence, not a category lookup. This
   recorded writer/blind-reader/critic fixture proves exact selection data is
   hydrated into both creator generation and deterministic finishing. */
function languageHookFixturePlan(source, task) {
  const count = task.spec.outputCount;
  const evidenceRef = source.claims[0]?.id || 'app_summary';
  const pool = [
    ['lang-1', 'target_contrast', 'You practice daily, then freeze when someone actually answers.', 'why do real conversations feel harder?'],
    ['lang-2', 'confession', 'I know the words, but real conversations still make me panic.', "knowing words isn't speaking"],
    ['lang-3', 'question', 'Why does speaking feel impossible after finishing all those lessons?', "lessons done. still can't speak?"],
  ];
  const base = buildLocalMockHookPlan({ source, outputCount: count, request: task.spec.hookRequest });
  const selectedHooks = pool.slice(0, count).map(([candidateId, patternId, spokenHook, caption], index) => ({
      selectionIndex: index + 1,
      candidateId,
      writerCandidateId: candidateId,
      patternId,
      spokenHook,
      caption,
      targetBehavior: 'practising language lessons',
      tension: 'freezing in real conversation',
      evidenceRefs: [evidenceRef],
      assignmentId: base.selectedHooks[index]?.assignmentId || `ugc-${index + 1}`,
      assignmentEvidenceRefs: base.selectedHooks[index]?.assignmentEvidenceRefs || [],
      coldRead: {
        candidateId,
        inferredTopic: 'language learning and real-world conversation',
        topicConfidence: 0.98,
        behaviorOrSituation: 'practising or finishing language lessons',
        tensionOrConsequence: 'freezing or panicking when another person speaks',
        curiosityGap: 'why lesson knowledge does not transfer to conversation',
        unexplainedTerms: [],
      },
      critic: {
        verdict: 'pass',
        topicClarity: 5,
        concreteTension: 5,
        curiosity: 4,
        nativeVoice: 5,
        claimSafety: 5,
        topicMatchesEvidence: true,
        supportedEvidenceRefs: [evidenceRef],
        unsupportedSpans: [],
        duplicateClusterId: `language-cluster-${index + 1}`,
        nearDuplicateOf: null,
        reason: 'The topic and real-world language tension are unmistakable without naming the app.',
      },
      qualified: true,
      weightedScore: 54,
    }));
  return sealHookPlan({
    ...base,
    status: 'selected',
    rounds: 1,
    selectedHooks,
    candidatePool: [
      ...selectedHooks,
      ...base.candidatePool.slice(selectedHooks.length),
    ],
    rejectedCandidateCount: 8 - count,
    intelligenceMode: 'recorded_writer_blind_reader_critic_fixture',
  });
}

const languageAdapters = {
  ...adapters,
  hookAgent: {
    id: 'hook-intelligence-recorded-fixture',
    capability: 'hook_intelligence',
    live: false,
    async planHooks({ task, source }) {
      const hookPlan = languageHookFixturePlan(source, task);
      return {
        hookPlan,
        asset: {
          assetId: `${task.taskId}-asset`,
          taskId: task.taskId,
          jobId: task.jobId,
          packId: task.packId,
          orgId: task.orgId,
          workspaceId: task.workspaceId,
          appId: task.appId,
          kind: 'ugc_hook_plan',
          storageKey: task.output.storageKey,
          contentType: task.output.contentType,
          bytes: Buffer.byteLength(JSON.stringify(hookPlan)),
          checksum: `fixture-${hookPlan.planFingerprint}`,
          planId: hookPlan.planId,
          planFingerprint: hookPlan.planFingerprint,
          requestFingerprint: hookPlan.requestFingerprint,
          sourceFingerprint: hookPlan.sourceFingerprint,
          mode: 'local_mock',
          providerMutations: 0,
        },
        costUnits: 0,
        planningProviderCalls: 0,
        providerCalls: 0,
        providerMutations: 0,
      };
    },
  },
};

const languageClaim = store.claimPreview({
  uid: boot.uid,
  email: boot.email,
  previewSessionId: 'session-language-hook-test',
  canonicalAppId: 'app-store-570060128',
  extraction: languageLearningExtraction,
  productId: 'launch_pack',
});
const languageCtx = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: languageClaim.app.appId };
const languagePack = createPlannedPack(store, {
  ...languageCtx,
  imageCount: 0,
  videoCount: 1,
  idempotencyKey: 'job-test-language-hook-pack',
});
const languageCreated = store.createGenerationJob({ ...languageCtx, packId: languagePack.pack.packId });
const languageRender = languageCreated.job.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
check(languageRender?.renderSpec?.script?.beats?.find((beat) => beat.beatId === 'hook')?.dialogue === '', 'language hook must be pending before the intelligence task runs');
const languageFinished = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: languageClaim.app.appId, jobId: languageCreated.job.jobId, adapters: languageAdapters, now });
check(languageFinished.status === 'completed', `language UGC job should pass the full mock QA rail, got ${languageFinished.status}`);
const languageFinishedRender = languageFinished.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
const languageHook = languageFinishedRender?.renderSpec?.script?.beats?.find((beat) => beat.beatId === 'hook')?.dialogue || '';
const languageHookCaption = languageFinishedRender?.renderSpec?.timeline?.find((layer) => layer.type === 'caption' && layer.role === 'hook')?.text || '';
check(languageHook === 'You practice daily, then freeze when someone actually answers.', `Hook Agent must hydrate its selected language hook exactly, got "${languageHook}"`);
check(languageHookCaption === 'why do real conversations feel harder?', `Hook Agent must hydrate the paired caption exactly, got "${languageHookCaption}"`);
check(!/duolingo|language streak|learners,? watch/i.test(`${languageHook} ${languageHookCaption}`), 'language creative must be topic-clear while staying brand-free and free of the rejected abstract phrase');
const languageUgcReport = languageFinished.qaReports.find((report) => report.outputType === 'ugc_ad');
for (const checkId of ['hook_policy_locked', 'creative_hook_specificity', 'hook_caption_sharpness', 'hook_selection_integrity', 'hook_evidence_refs', 'dialogue_flow_punchy']) {
  check(languageUgcReport?.checks.some((item) => item.id === checkId && item.status === 'pass'), `language UGC QA must pass ${checkId}`);
}

const languageVariantPack = createPlannedPack(store, {
  ...languageCtx,
  imageCount: 0,
  videoCount: 3,
  idempotencyKey: 'job-test-language-hook-variants-pack',
});
check(languageVariantPack.pack.sourceReadiness?.creativePreflight?.status === 'ready_for_hook_agent', 'multi-UGC packs must validate source inputs without hard-coded creative preflight');
const languageVariantCreated = store.createGenerationJob({ ...languageCtx, packId: languageVariantPack.pack.packId });
const languageVariantFinished = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: languageClaim.app.appId, jobId: languageVariantCreated.job.jobId, adapters: languageAdapters, now });
check(languageVariantFinished.status === 'completed', `three-hook language pack should complete, got ${languageVariantFinished.status}`);
const languageVariantRenders = languageVariantFinished.tasks.filter((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
const languageVariantHooks = languageVariantRenders.map((task) => task.renderSpec.script.beats.find((beat) => beat.beatId === 'hook')?.dialogue || '');
const languageVariantCaptions = languageVariantRenders.map((task) => task.renderSpec.timeline.find((layer) => layer.type === 'caption' && layer.role === 'hook')?.text || '');
check(new Set(languageVariantHooks).size === 3, `multi-UGC graph must keep three distinct spoken hooks, got ${languageVariantHooks.join(' | ')}`);
check(new Set(languageVariantCaptions).size === 3, `multi-UGC graph must keep three distinct hook captions, got ${languageVariantCaptions.join(' | ')}`);

const utilityClaim = store.claimPreview({
  uid: boot.uid,
  email: boot.email,
  previewSessionId: 'session-utility-result-hook-test',
  canonicalAppId: 'app-store-246813579',
  extraction: utilityResultExtraction,
  productId: 'launch_pack',
});
const utilityCtx = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: utilityClaim.app.appId };
const utilityPack = createPlannedPack(store, {
  ...utilityCtx,
  imageCount: 0,
  videoCount: 1,
  idempotencyKey: 'job-test-utility-result-hook-pack',
});
check(utilityPack.pack.sourceReadiness?.creativePreflight?.status === 'ready_for_hook_agent', 'utility app must reach the same generic Hook Agent path');
const utilityCreated = store.createGenerationJob({ ...utilityCtx, packId: utilityPack.pack.packId });
const utilityRender = utilityCreated.job.tasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
const utilityHook = utilityRender?.renderSpec?.script?.beats?.find((beat) => beat.beatId === 'hook')?.dialogue || '';
check(utilityRender?.renderSpec?.emotionPlan?.appCategory === 'Utilities', `unknown apps must preserve reviewed source metadata without category routing, got ${utilityRender?.renderSpec?.emotionPlan?.appCategory}`);
check(utilityRender?.renderSpec?.emotionPlan?.proofType === 'reviewed_app_screen', 'unknown apps must not receive a hard-coded proof-type inference');
check(utilityHook === '', 'utility hook must stay pending for intelligence instead of switching to hard-coded photo or utility copy');

const unknownVerticalPreflight = preflightUgcGenerationForApp({
  videoCount: 1,
  app: {
    id: 'unknown-app',
    appId: 'unknown-app',
    name: 'MeetCute',
    tagline: 'Meet new people nearby for dates.',
    extraction: { app: { category: 'Lifestyle' } },
    screens: [{ id: 'unknown-screen', label: 'Nearby profiles', detail: 'Profile browsing screen', sourceType: 'raw_app_proof', selected: true }],
    claims: [{ id: 'unknown-claim', text: 'Meet new people nearby.', supported: true, selected: true }],
    style: ['Plain language'],
  },
});
check(unknownVerticalPreflight.status === 'ready_for_hook_agent', 'niche/unknown verticals must reach the same model-driven Hook Agent instead of a category fallback');

/* Store-art-only UGC should render, but it should not be marked ready as a
   proof-driven UGC ad until there is raw/uploaded app proof. */
const weakClaim = store.claimPreview({
  uid: boot.uid,
  email: boot.email,
  previewSessionId: 'session-store-art-hold-test',
  canonicalAppId: 'app-store-555555555',
  extraction: storeArtOnlyExtraction,
  productId: 'launch_pack',
});
const weakCtx = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: weakClaim.app.appId };
const weakPack = createPlannedPack(store, {
  ...weakCtx,
  imageCount: 0,
  videoCount: 1,
  idempotencyKey: 'job-test-store-art-hold-pack',
});
const weakCreated = store.createGenerationJob({ ...weakCtx, packId: weakPack.pack.packId });
const weakFinished = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: weakClaim.app.appId, jobId: weakCreated.job.jobId, adapters, now });
check(weakFinished.status === 'completed_with_holds', `store-art-only UGC should complete with holds, got ${weakFinished.status}`);
const weakUgcReport = weakFinished.qaReports.find((report) => report.outputType === 'ugc_ad');
check(weakUgcReport?.checks.some((item) => item.id === 'proof_source_strength' && item.status === 'hold'), 'store-art-only UGC QA must hold proof_source_strength');
check(weakFinished.drafts.every((draft) => draft.status === 'held'), 'held UGC drafts must not be ready for review');

/* Credits: generation must not double-debit; cost stays within reservation. */
const packRetry = store.createPackForUser({ ...ctx, imageCount: 1, videoCount: 1, idempotencyKey: 'job-test-pack', packPlanId: pack.pack.packPlanId });
check(packRetry.creditBalance === balanceAfterPack, 'generation must not debit credits again');
check(finished.costPlan.reservedCredits === pack.pack.costCredits, 'job cost plan must reserve the pack credits');
check(finished.costPlan.spentCredits <= finished.costPlan.reservedCredits, 'spent credits must stay within the reservation');
check(finished.costPlan.spentCredits === finished.costPlan.plannedCredits, 'mock run must spend exactly the planned credits');

/* Re-running a finished job is a no-op. */
const rerun = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId, jobId: finished.jobId, adapters, now });
check(rerun.status === finished.status, 'rerunning a finished job must be a no-op');
check(store.readAppForUser(ctx).ads.filter((ad) => ad.jobId === finished.jobId).length === 2, 'rerun must not duplicate drafts');

/* Failing adapter: retries then fails the task and the job, credits intact. */
const failingAdapters = {
  ...adapters,
  imageAd: {
    id: 'image-ad-failing-mock',
    capability: 'image_ad',
    live: false,
    attempts: 0,
    async generateImageAd() {
      this.attempts += 1;
      throw new Error('mock generation outage');
    },
  },
};
const failPack = createPlannedPack(store, { ...ctx, imageCount: 1, videoCount: 0, idempotencyKey: 'job-test-failing' });
const failJob = store.createGenerationJob({ ...ctx, packId: failPack.pack.packId });
const failed = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId, jobId: failJob.job.jobId, adapters: failingAdapters, now });
check(failingAdapters.imageAd.attempts === 2, 'runner must retry a failing generation task up to maxAttempts');
check(failed.status === 'failed', 'exhausted retries must fail the job');
check(failed.tasks.find((task) => task.kind === 'qa')?.status === 'skipped', 'QA must be skipped when its target failed');
check(store.readAppForUser(ctx).runs.find((run) => run.id === failPack.pack.packId)?.status === 'failed', 'failed jobs must mark the run failed');
const ledgerBalance = creditBalanceFromLedger([]);
check(ledgerBalance === 0, 'sanity: ledger helper baseline');

/* Failing Hook Agent: its one bounded planning attempt is recorded, while
   every UGC frame/video/render adapter remains untouched. */
const plannerCounters = { firstFrame: 0, segment: 0, render: 0 };
const failingPlannerAdapters = {
  ...adapters,
  hookAgent: {
    id: 'hook-intelligence-failing-fixture',
    capability: 'hook_intelligence',
    live: false,
    async planHooks() {
      const error = new Error('fixture semantic planning failure');
      error.planningProviderCalls = 1;
      throw error;
    },
  },
  ugcFirstFrame: {
    ...adapters.ugcFirstFrame,
    async generateFirstFrame(input) {
      plannerCounters.firstFrame += 1;
      return adapters.ugcFirstFrame.generateFirstFrame(input);
    },
  },
  ugcSegment: {
    ...adapters.ugcSegment,
    async generateSegment(input) {
      plannerCounters.segment += 1;
      return adapters.ugcSegment.generateSegment(input);
    },
  },
  render: {
    ...adapters.render,
    async renderComposition(input) {
      if (input.task.outputType === 'ugc_ad') plannerCounters.render += 1;
      return adapters.render.renderComposition(input);
    },
  },
};
const plannerFailPack = createPlannedPack(store, { ...ctx, imageCount: 0, videoCount: 1, idempotencyKey: 'job-test-failing-hook-plan' });
const plannerFailCreated = store.createGenerationJob({ ...ctx, packId: plannerFailPack.pack.packId });
const plannerFailed = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId, jobId: plannerFailCreated.job.jobId, adapters: failingPlannerAdapters, now });
check(plannerFailed.status === 'failed', 'exhausted Hook Agent planning must fail the UGC job');
check(plannerFailed.creativeIntelligenceCalls === 2, 'both bounded failed Hook Agent attempts must remain in durable usage accounting');
check(plannerFailed.generationProviderCalls === 0, 'planning failure must keep media generation provider calls at zero');
check(plannerCounters.firstFrame === 0 && plannerCounters.segment === 0 && plannerCounters.render === 0, 'planning failure must execute zero UGC frame, segment, or render adapters');
check(plannerFailed.tasks.filter((task) => ['ugc_first_frame', 'ugc_segment', 'ugc_ad'].includes(task.outputType)).every((task) => task.status === 'skipped'), 'every media task downstream of a failed Hook Agent plan must be skipped');

/* Failing Script Agent: a selected Hook Plan is not enough to unlock media.
   Every frame/video/render adapter must remain at zero calls. */
const scriptPlannerCounters = { firstFrame: 0, segment: 0, render: 0 };
const failingScriptPlannerAdapters = {
  ...adapters,
  scriptAgent: {
    id: 'script-intelligence-failing-fixture', capability: 'script_intelligence', live: false,
    async planScripts() {
      const error = new Error('fixture evidence-bound script planning failure');
      error.planningProviderCalls = 1;
      throw error;
    },
  },
  ugcFirstFrame: {
    ...adapters.ugcFirstFrame,
    async generateFirstFrame(input) { scriptPlannerCounters.firstFrame += 1; return adapters.ugcFirstFrame.generateFirstFrame(input); },
  },
  ugcSegment: {
    ...adapters.ugcSegment,
    async generateSegment(input) { scriptPlannerCounters.segment += 1; return adapters.ugcSegment.generateSegment(input); },
  },
  render: {
    ...adapters.render,
    async renderComposition(input) {
      if (input.task.outputType === 'ugc_ad') scriptPlannerCounters.render += 1;
      return adapters.render.renderComposition(input);
    },
  },
};
const scriptPlannerFailPack = createPlannedPack(store, { ...ctx, imageCount: 0, videoCount: 1, idempotencyKey: 'job-test-failing-script-plan' });
const scriptPlannerFailCreated = store.createGenerationJob({ ...ctx, packId: scriptPlannerFailPack.pack.packId });
const scriptPlannerFailed = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId, jobId: scriptPlannerFailCreated.job.jobId, adapters: failingScriptPlannerAdapters, now });
check(scriptPlannerFailed.status === 'failed', 'exhausted Script Agent planning must fail the UGC job');
check(scriptPlannerFailed.creativeIntelligenceCalls === 2, 'both bounded failed Script Agent attempts must remain in durable usage accounting');
check(scriptPlannerFailed.generationProviderCalls === 0, 'Script Agent failure must keep media generation provider calls at zero');
check(scriptPlannerCounters.firstFrame === 0 && scriptPlannerCounters.segment === 0 && scriptPlannerCounters.render === 0, 'Script Agent failure must execute zero UGC frame, segment, or render adapters');
check(scriptPlannerFailed.tasks.filter((task) => ['ugc_first_frame', 'ugc_segment', 'ugc_ad'].includes(task.outputType)).every((task) => task.status === 'skipped'), 'every media task downstream of a failed Script Agent plan must be skipped');

let oversizedUgcPackBlocked = false;
try {
  createPlannedPack(store, { ...ctx, imageCount: 0, videoCount: 7, idempotencyKey: 'job-test-oversized-ugc-pack' });
} catch {
  oversizedUgcPackBlocked = true;
}
check(oversizedUgcPackBlocked, 'UGC packs larger than the shared Hook Agent pool contract must be rejected before generation');

/* hook_proof_sequence remains explicit: one creator hook plus deterministic
   screenshot-proof finishing. It is not the default V6 route. */
const hookPack = createPlannedPack(store, { ...ctx, imageCount: 0, videoCount: 1, idempotencyKey: 'job-test-hook-route' });
const hookCreated = store.createGenerationJob({ ...ctx, packId: hookPack.pack.packId, ugcRoute: 'hook_proof_sequence' });
const hookTasks = hookCreated.job.tasks;
const hookSegments = hookTasks.filter((task) => task.outputType === 'ugc_segment');
const hookRender = hookTasks.find((task) => task.kind === 'render' && task.outputType === 'ugc_ad');
check(hookSegments.length === 1, 'hook_proof_sequence must generate exactly one creator segment');
check(hookSegments[0].spec.segmentRole === 'hook', 'hook_proof_sequence segment must be the hook');
check(hookRender?.dependsOn.length === 2, 'hook route render must depend on the hook segment plus proof prep');
check(hookRender?.renderSpec?.ugcRoute === 'hook_proof_sequence', 'render spec must carry the UGC route');
const hookProofLayers = (hookRender?.renderSpec?.timeline || []).filter((layer) => layer.type === 'proof_media');
check(hookProofLayers.length > 0, 'hook route must include screenshot proof layers');
check(hookProofLayers.every((layer) => layer.start >= 5), 'hook route proof sequence must start after the creator hook');
check((hookRender?.renderSpec?.timeline || []).some((layer) => layer.type === 'cta'), 'hook route may still carry a CTA layer');
checkNoProviderLeak(hookCreated.job, 'hook route job payload');
const hookFinished = await runCreativeJob({ store, orgId: boot.orgId, workspaceId: boot.workspaceId, appId, jobId: hookCreated.job.jobId, adapters, now });
check(
  hookFinished.status === 'completed',
  `hook route job should complete, got ${hookFinished.status}: ${hookFinished.qaReports.flatMap((report) => report.checks.filter((item) => item.status === 'hold').map((item) => `${item.id}=${item.detail}`)).join(' | ')}`,
);

/* Store-backed task lease: a second worker cannot execute an unexpired task,
   while an expired lease can be reclaimed on the next bounded attempt. */
let leaseClock = Date.UTC(2026, 6, 9, 12, 0, 0);
const leaseNow = () => {
  leaseClock += 250;
  return leaseClock;
};
const leaseStore = createTenantStore({ now: leaseNow });
const leaseBoot = leaseStore.bootstrapUser({ email: 'lease-owner@example.test' });
const leaseClaim = leaseStore.claimPreview({
  uid: leaseBoot.uid,
  email: leaseBoot.email,
  previewSessionId: 'session-lease-test',
  canonicalAppId: 'app-store-lease-test',
  extraction: fixtureExtraction,
  productId: 'launch_pack',
});
const leaseCtx = { uid: leaseBoot.uid, orgId: leaseBoot.orgId, workspaceId: leaseBoot.workspaceId, appId: leaseClaim.app.appId };
const leasePack = createPlannedPack(leaseStore, { ...leaseCtx, imageCount: 0, videoCount: 1, idempotencyKey: 'lease-pack' });
const leaseCreated = leaseStore.createGenerationJob({ ...leaseCtx, packId: leasePack.pack.packId });
const leasePlanTask = leaseCreated.job.tasks.find((task) => task.outputType === 'ugc_hook_plan');
const leaseClaimedAt = new Date(leaseClock).toISOString();
const leaseExpiresAt = new Date(leaseClock + 60_000).toISOString();
const leaseClaimedJob = leaseStore.serverClaimTask({
  orgId: leaseBoot.orgId,
  workspaceId: leaseBoot.workspaceId,
  appId: leaseClaim.app.appId,
  jobId: leaseCreated.job.jobId,
  taskId: leasePlanTask.taskId,
  workerId: 'worker-a',
  claimedAt: leaseClaimedAt,
  leaseExpiresAt,
});
check(leaseClaimedJob?.tasks.find((task) => task.taskId === leasePlanTask.taskId)?.status === 'running', 'worker A must transactionally claim the planning task');
const leaseCounters = { planning: 0 };
const leaseAdapters = {
  ...adapters,
  hookAgent: {
    ...adapters.hookAgent,
    async planHooks(input) {
      leaseCounters.planning += 1;
      return adapters.hookAgent.planHooks(input);
    },
  },
};
const blockedByLease = await runCreativeJob({
  store: leaseStore,
  orgId: leaseBoot.orgId,
  workspaceId: leaseBoot.workspaceId,
  appId: leaseClaim.app.appId,
  jobId: leaseCreated.job.jobId,
  adapters: leaseAdapters,
  now: leaseNow,
  workerId: 'worker-b',
});
check(blockedByLease.status === 'running', 'worker B must leave a job running while worker A owns an unexpired lease');
check(leaseCounters.planning === 0, 'worker B must make zero planning calls while another lease is active');
leaseClock = Date.parse(leaseExpiresAt) + 1;
const recoveredLeaseJob = await runCreativeJob({
  store: leaseStore,
  orgId: leaseBoot.orgId,
  workspaceId: leaseBoot.workspaceId,
  appId: leaseClaim.app.appId,
  jobId: leaseCreated.job.jobId,
  adapters: leaseAdapters,
  now: leaseNow,
  workerId: 'worker-b',
});
check(recoveredLeaseJob.status === 'completed', `worker B should recover and complete the expired leased job, got ${recoveredLeaseJob.status}`);
check(leaseCounters.planning === 1, 'expired planning work should execute exactly once after reclamation');
check(recoveredLeaseJob.tasks.find((task) => task.taskId === leasePlanTask.taskId)?.attempts === 2, 'lease recovery must preserve the original attempt and use one bounded retry');

let badRouteBlocked = false;
try {
  const badPack = createPlannedPack(store, { ...ctx, imageCount: 0, videoCount: 1, idempotencyKey: 'job-test-bad-route' });
  store.createGenerationJob({ ...ctx, packId: badPack.pack.packId, ugcRoute: 'freestyle' });
} catch {
  badRouteBlocked = true;
}
check(badRouteBlocked, 'unknown UGC routes must be rejected');

/* Live adapters must also refuse when the master switch is on but no worker
   runtime (secret resolver + asset store) is injected. */
let liveRuntimeBlocked = false;
try {
  resolveGenerationAdapters({ MAA_LIVE_ADAPTERS_ENABLED: '1', MAA_IMAGE_ADAPTER: 'live' });
} catch {
  liveRuntimeBlocked = true;
}
check(liveRuntimeBlocked, 'live adapters must refuse to construct without the worker runtime');

if (failures.length) {
  console.error('Creative job tests failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Creative job tests passed');
console.log(JSON.stringify({
  jobId: finished.jobId,
  packId,
  tasks: finished.tasks.length,
  assets: finished.assets.length,
  qaReports: finished.qaReports.length,
  drafts: finished.drafts.length,
  spentCredits: finished.costPlan.spentCredits,
  progress: jobProgress(finished).percent,
  providerMutations: 0,
}, null, 2));
