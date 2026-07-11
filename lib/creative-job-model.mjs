/* Production-shaped creative job graph for the Mobile Ad Agent.
   Pure builders only: no I/O, no provider SDK imports. Both the in-memory
   local adapter and the Firestore adapter persist the exact same job/task/
   QA/draft shapes from here, so the local runner and a hosted worker share
   one contract.

   Invariants:
   - Every job-owned doc carries orgId/workspaceId/appId/packId.
   - Backend/provider names never appear in these payloads. Adapters are
     addressed by neutral capability ids (image_ad, ugc_creator_block,
     finishing_compositor, qa_rules).
   - Render tasks carry a portable finishing/composition contract:
     compositionKey, variablesKey, inputAssetIds, durationSeconds, fps,
     dimensions, outputKey.
   - Customer-visible payloads carry providerMutations: 0. */

import { CREDIT_RULES, stableHash, toPlain } from './tenant-model.mjs';
import {
  HOOK_MAX_OUTPUTS_PER_PLAN,
  HOOK_PLAN_SCHEMA_VERSION,
  buildHookPlanningRequest,
  validateHookPlanForRequest,
} from './hook-agent.mjs';
import {
  SCRIPT_MAX_TOTAL_WORDS,
  SCRIPT_MAX_WORDS_PER_BEAT,
  SCRIPT_MIN_TOTAL_WORDS,
  SCRIPT_PLAN_SCHEMA_VERSION,
  buildScriptPlanningRequest,
  validateScriptPlanForRequest,
} from './script-agent.mjs';

export const JOB_SCHEMA_VERSION = 'creative-job.v1';
export const JOB_MANIFEST_SCHEMA_VERSION = 'mobile-ad-agent-job-manifest.v1';
export const UGC_RECIPE_SCHEMA_VERSION = 'ugc-recipe.v1';
export const UGC_SCRIPT_SCHEMA_VERSION = 'ugc-script.v1';
export const UGC_EMOTION_PLAN_SCHEMA_VERSION = 'ugc-emotion-plan.v1';
export const UGC_RENDER_MANIFEST_SCHEMA_VERSION = 'ugc-render-manifest.v1';
export const MAX_CREATIVE_JOB_DOCUMENT_BYTES = 900_000;

export const TASK_KINDS = Object.freeze(['planning', 'generation', 'proof_prep', 'render', 'qa']);
export const TERMINAL_JOB_STATUSES = Object.freeze(['completed', 'completed_with_holds', 'failed']);
export const TERMINAL_TASK_STATUSES = Object.freeze(['succeeded', 'failed', 'skipped']);

export const UGC_RENDER_DEFAULTS = Object.freeze({
  durationSeconds: 15,
  fps: 30,
  dimensions: Object.freeze({ width: 1080, height: 1920 }),
});

/* Hooks are a contract, not just a line of copy. Script writers may propose
   different wording later, but every candidate must make sense with no app
   context: a viewer should be able to picture the setup, feel the concrete
   failure/tension, and understand the line in one listen. */
export const UGC_HOOK_POLICY = Object.freeze({
  format: 'target_behavior_to_concrete_failure',
  minSpokenWords: 6,
  maxSpokenWords: 14,
  maxCaptionCharacters: 50,
  requireDirectTargetCallout: true,
  requireConcreteBehavior: true,
  requireConcreteFailure: true,
  requireCuriosityGap: true,
  requirePlainLanguageWithoutAppContext: true,
  allowBrandName: false,
});

const V6_REACTION_MAX_SPOKEN_SECONDS = 4.2;
const V6_REACTION_MUST_COMPLETE_BY_SECONDS = 27.2;
const V6_REACTION_TAIL_ROOM_SECONDS = 0.8;
const V6_REVEAL_CAPTION_START_SECONDS = 24.2;
const V6_REVEAL_CAPTION_END_SECONDS = 27.15;

export const IMAGE_AD_DEFAULTS = Object.freeze({
  dimensions: Object.freeze({ width: 1080, height: 1350 }),
  contentType: 'image/png',
});

/* Per-ad UGC creator blocks. Each block is its own generation task so a
   hosted worker can retry/fan out segments independently instead of one
   giant video task. */
export const UGC_SEGMENT_ROLES = Object.freeze([
  Object.freeze({ role: 'hook', startSeconds: 0, endSeconds: 4, purpose: 'Creator opens with a brand-free personal hook.' }),
  Object.freeze({ role: 'tension_bridge', startSeconds: 4, endSeconds: 12, beatIds: Object.freeze(['tension', 'bridge']), purpose: 'Creator names the specific failure mode, then pivots to the app-proof setup.' }),
  Object.freeze({ role: 'proof_voice', startSeconds: 12, endSeconds: 20, beatIds: Object.freeze(['payload', 'proof_voice']), purpose: 'Creator keeps talking while real app proof appears as an L-cut.' }),
  Object.freeze({ role: 'reaction', startSeconds: 20, endSeconds: 28, beatIds: Object.freeze(['reinforcement', 'reaction']), purpose: 'Creator lands the personal payoff with a casual app-name reveal and behavioral CTA.' }),
]);

/* UGC ad routes. Every route ends in the same finishing/composition
   contract; they differ only in how much creator source video they need.
   - ugc_selfie_proof_reveal: the V6 organic selfie grammar.
   - creator_narrated: legacy three creator blocks across the whole ad.
   - hook_proof_sequence: one creator hook, then a real-screenshot proof
     sequence with captions and CTA (cheapest truthful first route). */
export const UGC_ROUTES = Object.freeze({
  ugc_selfie_proof_reveal: Object.freeze({
    recipeId: 'ugc_selfie_proof_reveal',
    name: 'Organic selfie proof reveal',
    family: 'ugc_selfie',
    segments: UGC_SEGMENT_ROLES,
    durationSeconds: 28,
    proofWindow: Object.freeze({ startAt: 12.2, endBy: 19.6 }),
    proofAudioPolicy: 'continuous_creator_audio',
    creatorSourcePolicy: 'multi_clip_shared_first_frame',
    captionPolicy: Object.freeze({
      style: 'native_white_no_box',
      allowCtaCard: false,
      allowGenericProofCaption: false,
      revealCaption: true,
    }),
  }),
  creator_narrated: Object.freeze({
    recipeId: 'creator_narrated',
    name: 'Creator narrated',
    family: 'ugc_selfie',
    segments: UGC_SEGMENT_ROLES,
    proofWindow: Object.freeze({ startAt: 4.1, endBy: 9.6 }),
    proofAudioPolicy: 'continuous_creator_audio',
    captionPolicy: Object.freeze({
      style: 'native_white_no_box',
      allowCtaCard: true,
      allowGenericProofCaption: true,
      revealCaption: false,
    }),
  }),
  hook_proof_sequence: Object.freeze({
    recipeId: 'hook_proof_sequence',
    name: 'Hook and proof sequence',
    family: 'ugc_selfie',
    segments: Object.freeze([
      Object.freeze({ role: 'hook', startSeconds: 0, endSeconds: 6, purpose: 'Creator opens with the specific problem this app solves.' }),
    ]),
    proofWindow: Object.freeze({ startAt: 6, endBy: 12 }),
    proofAudioPolicy: 'creator_hook_then_proof_sequence',
    captionPolicy: Object.freeze({
      style: 'native_white_no_box',
      allowCtaCard: true,
      allowGenericProofCaption: true,
      revealCaption: false,
    }),
  }),
});
export const DEFAULT_UGC_ROUTE = 'ugc_selfie_proof_reveal';

export function generationJobIdForPack(packId) {
  return `job-${stableHash(`generation:${packId}`).slice(0, 12)}`;
}

export function jobStoragePrefix({ orgId, workspaceId, appId, jobId }) {
  return `orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/jobs/${jobId}`;
}

/* Runs while a pack is still being validated, before the credit debit and
   before any generation task exists. The job builder repeats the same check
   so hosted callers cannot bypass it. */
export function preflightUgcGenerationForApp({ app, packPlan = null, videoCount = 1, ugcRoute = DEFAULT_UGC_ROUTE } = {}) {
  const count = Math.max(0, Number(videoCount) || 0);
  if (!count) {
    return {
      status: 'not_required',
      ugcRoute,
      hooks: [],
      uniqueHookCount: 0,
      generationProviderCalls: 0,
      providerMutations: 0,
    };
  }
  if (count > HOOK_MAX_OUTPUTS_PER_PLAN) {
    throw new Error(`Create UGC packs with at most ${HOOK_MAX_OUTPUTS_PER_PLAN} drafts so one shared Hook Agent pool can preserve quality and diversity.`);
  }
  const route = UGC_ROUTES[ugcRoute];
  if (!route) throw new Error('Unknown UGC ad route.');
  const source = jobSourceFromApp(app, packPlan);
  const evidenceCount = Number(Boolean(source.appSummary)) + source.claims.length + source.screens.length + source.angles.length;
  if (!source.appSummary || !source.claims.length || !source.screens.length) {
    throw new Error('Hook Agent needs the reviewed app summary, at least one supported feature, and at least one real app screen before generation.');
  }
  const hookRequest = buildHookPlanningRequest({
    source,
    outputCount: count,
    outputBindings: hookOutputBindingsForSource(source, count),
    policy: UGC_HOOK_POLICY,
  });
  return {
    status: 'ready_for_hook_agent',
    ugcRoute,
    outputCount: count,
    evidenceCount,
    hookPlanSchemaVersion: HOOK_PLAN_SCHEMA_VERSION,
    hookRequestFingerprint: hookRequest.requestFingerprint,
    sourceFingerprint: hookRequest.sourceFingerprint,
    planningBudget: {
      candidatePoolSize: hookRequest.candidatePoolSize,
      maxQualityRounds: hookRequest.maxQualityRounds,
      maxIntelligenceCalls: hookRequest.maxIntelligenceCalls,
    },
    creativeIntelligence: 'writer_then_isolated_blind_reader_then_evidence_critic',
    generationProviderCalls: 0,
    providerMutations: 0,
  };
}

export function applyHookPlanToJob({ job, planningTask, hookPlan } = {}) {
  if (!job || !planningTask) throw new Error('Hook-plan hydration needs the job and planning task.');
  const hookRequest = planningTask.spec?.hookRequest;
  validateHookPlanForRequest({ plan: hookPlan, request: hookRequest, allowHeld: false });
  const selected = Array.isArray(hookPlan.selectedHooks) ? hookPlan.selectedHooks : [];
  const requested = Number(planningTask.spec?.outputCount || 0);
  if (selected.length < requested) {
    throw new Error(`Hook intelligence selected ${selected.length} hook(s) for ${requested} requested UGC output(s).`);
  }
  const fingerprints = new Set();
  const captionFingerprints = new Set();
  for (let index = 0; index < requested; index += 1) {
    const hook = selected[index];
    if (!criticApprovedHook(hook)) {
      throw new Error(`Hook ${hook?.candidateId || index + 1} did not clear the semantic critic thresholds.`);
    }
    const fingerprint = normalizeHookFingerprint(hook.spokenHook);
    const captionFingerprint = normalizeHookFingerprint(hook.caption);
    if (!fingerprint || fingerprints.has(fingerprint) || !captionFingerprint || captionFingerprints.has(captionFingerprint)) {
      throw new Error('Hook intelligence returned a missing or duplicate selected hook.');
    }
    fingerprints.add(fingerprint);
    captionFingerprints.add(captionFingerprint);
    const unitId = `${job.jobId}-ugc-${index + 1}`;
    const expectedBinding = hookRequest.outputBindings[index];
    if (hook.assignmentId !== expectedBinding?.assignmentId) {
      throw new Error(`Hook ${hook.candidateId} is not assigned to ${expectedBinding?.assignmentId || unitId}.`);
    }
    const unitBinding = hookUnitBinding(job, unitId, expectedBinding?.assignmentId);
    const evidenceStatus = hookEvidenceSupportStatus({ source: job.source, hookPlan: hook, unitBinding });
    if (evidenceStatus.status !== 'pass') throw new Error(evidenceStatus.detail);
    assertUgcHookPreflight({
      dialogue: hook.spokenHook,
      caption: hook.caption,
      appName: job.source?.appName || '',
      semanticQuality: semanticQualityForSelectedHook(hook),
    });
    hydrateUgcUnitHook({
      job,
      unitId,
      unitBinding,
      hook,
      planningTaskId: planningTask.taskId,
      hookPlan,
    });
  }
  recordHookPlanSummary({ job, planningTask, hookPlan });
  configureScriptPlanningTask({ job, hookPlan });
  return job;
}

function configureScriptPlanningTask({ job, hookPlan }) {
  const task = (job.tasks || []).find((candidate) => candidate.kind === 'planning' && candidate.outputType === 'ugc_script_plan');
  if (!task) throw new Error('UGC job is missing its Script Agent planning task.');
  const unitBindings = (hookPlan.selectedHooks || []).map((hook, index) => {
    const hookBinding = hookUnitBinding(job, `${job.jobId}-ugc-${index + 1}`, hook.assignmentId);
    const renderTask = (job.tasks || []).find((candidate) => (
      candidate.kind === 'render'
      && candidate.outputType === 'ugc_ad'
      && candidate.spec?.unitId === hookBinding?.unitId
    ));
    if (!hookBinding || !renderTask) throw new Error('Selected hook is missing its UGC unit binding.');
    return {
      assignmentId: hook.assignmentId,
      unitId: hookBinding.unitId,
      claimId: hookBinding.claimId,
      claimIds: [hookBinding.claimId].filter(Boolean),
      proofIds: hookBinding.proofIds,
      angleId: hookBinding.angleId,
      angleLabel: hookBinding.angleLabel,
      packPlanAssignmentId: hookBinding.packPlanAssignmentId,
    };
  });
  const scriptRequest = buildScriptPlanningRequest({ source: job.source, hookPlan, unitBindings });
  task.spec = {
    ...task.spec,
    status: 'ready_for_script_agent',
    scriptRequest,
    requestFingerprint: scriptRequest.requestFingerprint,
    sourceFingerprint: scriptRequest.sourceFingerprint,
    hookPlanFingerprint: scriptRequest.hookPlanFingerprint,
    planningBudget: {
      maxQualityRounds: scriptRequest.maxQualityRounds,
      maxIntelligenceCalls: scriptRequest.maxIntelligenceCalls,
      maxLifetimeIntelligenceCalls: scriptRequest.maxIntelligenceCalls * Number(task.maxAttempts || 1),
      maxInputCharacters: scriptRequest.maxInputCharacters,
    },
  };
}

export function applyScriptPlanToJob({ job, planningTask, scriptPlan } = {}) {
  if (!job || !planningTask) throw new Error('Script-plan hydration needs the job and planning task.');
  const request = planningTask.spec?.scriptRequest;
  validateScriptPlanForRequest({ plan: scriptPlan, request, allowHeld: false });
  for (const selectedScript of scriptPlan.scripts || []) {
    const binding = request.unitBindings.find((item) => item.assignmentId === selectedScript.assignmentId);
    if (!binding) throw new Error(`Script ${selectedScript.assignmentId} has no UGC unit binding.`);
    hydrateUgcUnitScript({ job, planningTask, scriptPlan, selectedScript, binding });
  }
  recordScriptPlanSummary({ job, planningTask, scriptPlan });
  return job;
}

export function recordScriptPlanSummary({ job, planningTask, scriptPlan } = {}) {
  if (!job || !planningTask || !scriptPlan) throw new Error('Script Plan summary needs the job, task, and plan.');
  validateScriptPlanForRequest({ plan: scriptPlan, request: planningTask.spec?.scriptRequest, allowHeld: true });
  planningTask.scriptPlan = {
    planId: scriptPlan.planId,
    planFingerprint: scriptPlan.planFingerprint,
    schemaVersion: scriptPlan.schemaVersion,
    promptVersion: scriptPlan.promptVersion,
    status: scriptPlan.status,
    requestFingerprint: scriptPlan.requestFingerprint,
    sourceFingerprint: scriptPlan.sourceFingerprint,
    hookPlanFingerprint: scriptPlan.hookPlanFingerprint,
    outputCount: scriptPlan.outputCount,
    rounds: scriptPlan.rounds,
    intelligenceUsage: scriptPlan.intelligenceUsage,
    planningBudget: scriptPlan.planningBudget,
    selectedAssignmentIds: (scriptPlan.scripts || []).map((script) => script.assignmentId),
    holdReasons: scriptPlan.status === 'held' ? (scriptPlan.holdReasons || []).slice(0, 20) : [],
    intelligenceMode: scriptPlan.intelligenceMode,
    artifactStorageKey: planningTask.output?.storageKey || null,
    providerMutations: 0,
  };
  job.scriptPlans = [{ taskId: planningTask.taskId, ...planningTask.scriptPlan }];
  return job;
}

function hydrateUgcUnitScript({ job, planningTask, scriptPlan, selectedScript, binding }) {
  const scriptSelectionHash = stableHash(JSON.stringify({
    planFingerprint: scriptPlan.planFingerprint,
    requestFingerprint: scriptPlan.requestFingerprint,
    sourceFingerprint: scriptPlan.sourceFingerprint,
    hookPlanFingerprint: scriptPlan.hookPlanFingerprint,
    assignmentId: selectedScript.assignmentId,
    scriptFingerprint: selectedScript.scriptFingerprint,
    beats: selectedScript.beats,
    evidenceRefsByBeat: selectedScript.evidenceRefsByBeat,
    evidenceVerification: selectedScript.evidenceVerification,
    creatorPlan: selectedScript.creatorPlan,
    critic: selectedScript.critic,
  }));
  const creatorPlan = selectedScript.creatorPlan;
  const identity = {
    id: `creator-${stableHash(JSON.stringify(creatorPlan)).slice(0, 12)}`,
    description: `${creatorPlan.persona}; ${creatorPlan.wardrobe}; ${creatorPlan.setting}`,
  };
  const visualContinuity = {
    mode: 'shared_first_frame_across_blocks',
    identityId: identity.id,
    scene: creatorPlan.setting,
    stableProps: creatorPlan.continuityAnchors,
    forbiddenDrift: ['identity change', 'outfit change', 'setting change', 'camera-distance reset', 'new props between clips', 'lighting-direction reset'],
    qaInstructions: 'Every creator block must use the same stored first-frame asset and preserve the approved creator plan.',
  };
  for (const task of job.tasks || []) {
    if (task.spec?.unitId !== binding.unitId && task.renderSpec?.unitId !== binding.unitId) continue;
    if (task.outputType === 'ugc_first_frame') {
      task.spec.creatorScenario = creatorPlan.setting;
      task.spec.creatorIdentity = identity;
      task.spec.visualContinuity = visualContinuity;
      task.spec.firstFramePrompt = creatorPlan.firstFramePrompt;
      task.spec.firstFrameNegativePrompt = creatorPlan.negativePrompt;
      bindScriptPlanToTask(task, planningTask, scriptPlan, selectedScript, scriptSelectionHash);
    }
    if (task.outputType === 'ugc_segment') {
      task.spec.scriptBeats = (task.spec.scriptBeats || []).map((beat) => ({
        ...beat,
        dialogue: selectedScript.beats[beat.beatId] || beat.dialogue,
        evidenceRefs: selectedScript.evidenceRefsByBeat[beat.beatId] || beat.evidenceRefs || [],
      }));
      task.spec.scriptBeat = task.spec.scriptBeats[0] || null;
      task.spec.spokenLine = task.spec.scriptBeats.map((beat) => cleanSpokenLine(beat.dialogue)).filter(Boolean).join(' ');
      task.spec.creatorScenario = creatorPlan.setting;
      task.spec.creatorIdentity = identity;
      task.spec.visualContinuity = visualContinuity;
      task.spec.firstFramePrompt = creatorPlan.firstFramePrompt;
      task.spec.firstFrameNegativePrompt = creatorPlan.negativePrompt;
      task.spec.emotionPlan = {
        source: 'script_agent',
        emotionalArc: creatorPlan.emotionalArc,
        startingEmotion: creatorPlan.startingEmotion,
        endingEmotion: creatorPlan.endingEmotion,
        ugcFormat: creatorPlan.setting,
        creatorIdentity: identity,
        visualContinuity,
        firstFrame: { scenario: creatorPlan.setting, prompt: creatorPlan.firstFramePrompt, negativePrompt: creatorPlan.negativePrompt },
        providerMutations: 0,
      };
      bindScriptPlanToTask(task, planningTask, scriptPlan, selectedScript, scriptSelectionHash);
    }
    if (task.kind === 'render' && task.outputType === 'ugc_ad') {
      task.renderSpec.script.beats = (task.renderSpec.script.beats || []).map((beat) => ({
        ...beat,
        dialogue: selectedScript.beats[beat.beatId] || beat.dialogue,
        evidenceRefs: selectedScript.evidenceRefsByBeat[beat.beatId] || beat.evidenceRefs || [],
      }));
      task.renderSpec.script.scriptPlan = {
        schemaVersion: scriptPlan.schemaVersion,
        promptVersion: scriptPlan.promptVersion,
        status: 'selected',
        planId: scriptPlan.planId,
        planFingerprint: scriptPlan.planFingerprint,
        requestFingerprint: scriptPlan.requestFingerprint,
        sourceFingerprint: scriptPlan.sourceFingerprint,
        hookPlanFingerprint: scriptPlan.hookPlanFingerprint,
        taskId: planningTask.taskId,
        assignmentId: selectedScript.assignmentId,
        scriptFingerprint: selectedScript.scriptFingerprint,
        evidenceVerification: selectedScript.evidenceVerification,
        critic: selectedScript.critic,
        selectionHash: scriptSelectionHash,
        providerMutations: 0,
      };
      task.renderSpec.recipe.creatorContinuity = { identityId: identity.id, description: identity.description, sourcePolicy: 'multi_clip_shared_first_frame', visualContinuity };
      task.renderSpec.emotionPlan = {
        source: 'script_agent', emotionalArc: creatorPlan.emotionalArc, startingEmotion: creatorPlan.startingEmotion,
        endingEmotion: creatorPlan.endingEmotion, ugcFormat: creatorPlan.setting, creatorIdentity: identity, visualContinuity,
        firstFrame: { scenario: creatorPlan.setting, prompt: creatorPlan.firstFramePrompt, negativePrompt: creatorPlan.negativePrompt },
        providerMutations: 0,
      };
      if (task.renderSpec.ugcRoute === 'ugc_selfie_proof_reveal') {
        alignProofLayersToSelectedScript({ renderSpec: task.renderSpec, selectedScript });
      } else {
        for (const layer of task.renderSpec.timeline || []) {
          if (layer.type === 'proof_media') layer.proofLine = selectedScript.beats.proof_voice;
        }
      }
      for (const layer of task.renderSpec.timeline || []) {
        if (layer.type === 'caption' && layer.role === 'reveal') layer.text = `It's called ${shortAppName(job.source.appName)}`;
      }
      task.renderSpec.renderManifest.scriptPlanTaskId = planningTask.taskId;
      task.renderSpec.renderManifest.scriptPlanId = scriptPlan.planId;
      task.renderSpec.renderManifest.scriptPlanFingerprint = scriptPlan.planFingerprint;
      task.renderSpec.renderManifest.scriptSelectionHash = scriptSelectionHash;
      task.renderSpec.renderManifest.visualContinuity = visualContinuity;
      bindScriptPlanToTask(task, planningTask, scriptPlan, selectedScript, scriptSelectionHash);
    }
  }
}

function alignProofLayersToSelectedScript({ renderSpec, selectedScript }) {
  const timeline = Array.isArray(renderSpec.timeline) ? renderSpec.timeline : [];
  const proofLayers = timeline.filter((layer) => layer.type === 'proof_media');
  const nonProofLayers = timeline.filter((layer) => layer.type !== 'proof_media');
  const beatsById = new Map((renderSpec.script?.beats || []).map((beat) => [beat.beatId, beat]));
  const availableByProofId = new Map(proofLayers.map((layer) => [layer.proofId, layer]));
  const visualBeatIds = ['payload', 'proof_voice', 'reinforcement'];
  const bindings = [];
  const boundProofIds = new Set();

  for (const beatId of visualBeatIds) {
    const beat = beatsById.get(beatId);
    if (!beat?.dialogue) continue;
    for (const proofId of selectedScript.evidenceRefsByBeat?.[beatId] || []) {
      if (boundProofIds.has(proofId) || !availableByProofId.has(proofId)) continue;
      boundProofIds.add(proofId);
      bindings.push({ beatId, beat, proofId, layer: availableByProofId.get(proofId) });
    }
  }

  const aligned = [];
  for (const beatId of visualBeatIds) {
    const group = bindings.filter((binding) => binding.beatId === beatId);
    if (!group.length) continue;
    const beat = group[0].beat;
    const start = Number(beat.startSeconds);
    const end = Number(beat.endSeconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const slot = (end - start) / group.length;
    for (const [index, binding] of group.entries()) {
      const layerStart = start + (slot * index);
      const layerEnd = index === group.length - 1 ? end : start + (slot * (index + 1));
      aligned.push({
        ...binding.layer,
        start: round2(layerStart),
        duration: round2(Math.max(0.1, layerEnd - layerStart)),
        proofLine: selectedScript.beats[beatId],
        proofBeatId: beatId,
        evidenceRefs: [binding.proofId],
      });
    }
  }

  renderSpec.timeline = [...nonProofLayers, ...aligned]
    .sort(compareTimelineLayers);
  renderSpec.script.proofBindings = aligned.map((layer) => ({
    proofId: layer.proofId,
    beatId: layer.proofBeatId,
    line: layer.proofLine,
  }));
  renderSpec.renderManifest = {
    ...(renderSpec.renderManifest || {}),
    proofWindow: aligned.length ? {
      startAt: Math.min(...aligned.map((layer) => safeNumber(layer.start))),
      endBy: Math.max(...aligned.map((layer) => safeNumber(layer.start) + positiveDuration(layer.duration))),
    } : null,
    selectedProofIds: aligned.map((layer) => layer.proofId),
    omittedUnreferencedProofIds: proofLayers.map((layer) => layer.proofId).filter((proofId) => !boundProofIds.has(proofId)),
    providerMutations: 0,
  };
}

function bindScriptPlanToTask(task, planningTask, scriptPlan, selectedScript, selectionHash) {
  task.spec = task.spec || {};
  task.spec.scriptPlanTaskId = planningTask.taskId;
  task.spec.scriptPlanFingerprint = scriptPlan.planFingerprint;
  task.spec.scriptSelectionHash = selectionHash;
  task.spec.scriptAssignmentId = selectedScript.assignmentId;
  task.spec.scriptFingerprint = selectedScript.scriptFingerprint;
}

export function recordHookPlanSummary({ job, planningTask, hookPlan } = {}) {
  if (!job || !planningTask || !hookPlan) throw new Error('Hook Plan summary needs the job, task, and plan.');
  validateHookPlanForRequest({ plan: hookPlan, request: planningTask.spec?.hookRequest, allowHeld: true });
  const selected = Array.isArray(hookPlan.selectedHooks) ? hookPlan.selectedHooks : [];
  planningTask.hookPlan = {
    planId: hookPlan.planId,
    planFingerprint: hookPlan.planFingerprint,
    schemaVersion: hookPlan.schemaVersion,
    promptVersion: hookPlan.promptVersion,
    status: hookPlan.status,
    requestFingerprint: hookPlan.requestFingerprint,
    sourceFingerprint: hookPlan.sourceFingerprint,
    policyFingerprint: hookPlan.policyFingerprint,
    outputCount: hookPlan.outputCount,
    outputBindings: hookPlan.outputBindings,
    candidatePoolSize: hookPlan.candidatePoolSize,
    rounds: hookPlan.rounds,
    generatedCandidateCount: hookPlan.generatedCandidateCount,
    acceptedCandidateCount: hookPlan.acceptedCandidateCount,
    intelligenceUsage: hookPlan.intelligenceUsage,
    planningBudget: hookPlan.planningBudget,
    selectedCandidateIds: selected.slice(0, Number(planningTask.spec?.outputCount || 0)).map((hook) => hook.candidateId),
    holdReasons: hookPlan.status === 'held' ? (hookPlan.holdReasons || []).slice(0, 20) : [],
    intelligenceMode: hookPlan.intelligenceMode,
    artifactStorageKey: planningTask.output?.storageKey || null,
    providerMutations: 0,
  };
  job.hookPlans = [{
    taskId: planningTask.taskId,
    ...planningTask.hookPlan,
  }];
  return job;
}

function hydrateUgcUnitHook({ job, unitId, unitBinding, hook, planningTaskId, hookPlan }) {
  const selectionHash = stableHash(JSON.stringify({
    planFingerprint: hookPlan.planFingerprint,
    requestFingerprint: hookPlan.requestFingerprint,
    sourceFingerprint: hookPlan.sourceFingerprint,
    unitBinding,
    candidateId: hook.candidateId,
    spokenHook: hook.spokenHook,
    caption: hook.caption,
    targetBehavior: hook.targetBehavior || null,
    tension: hook.tension || null,
    evidenceRefs: hook.evidenceRefs,
    critic: hook.critic,
    coldRead: hook.coldRead || null,
  }));
  const hookQuality = {
    status: 'pass',
    semanticCriticStatus: 'pass',
    topicClarity: Number(hook.critic.topicClarity),
    concreteTension: Number(hook.critic.concreteTension),
    curiosity: Number(hook.critic.curiosity),
    nativeVoice: Number(hook.critic.nativeVoice),
    claimSafety: Number(hook.critic.claimSafety),
    topicMatchesEvidence: hook.critic.topicMatchesEvidence === true,
    supportedEvidenceRefs: hook.critic.supportedEvidenceRefs || [],
    unsupportedSpans: hook.critic.unsupportedSpans || [],
    duplicateClusterId: hook.critic.duplicateClusterId || null,
    reason: hook.critic.reason,
    coldRead: hook.coldRead || null,
    selectionHash,
    providerMutations: 0,
  };
  for (const task of job.tasks || []) {
    if (task.spec?.unitId !== unitId && task.renderSpec?.unitId !== unitId) continue;
    if (task.outputType === 'ugc_first_frame') {
      task.spec.hookPlanTaskId = planningTaskId;
      task.spec.hookPlanFingerprint = hookPlan.planFingerprint;
      task.spec.hookSelectionHash = selectionHash;
    }
    if (task.outputType === 'ugc_segment') {
      task.spec.scriptBeats = (task.spec.scriptBeats || []).map((beat) => (
        beat.beatId === 'hook' ? { ...beat, dialogue: hook.spokenHook } : beat
      ));
      if (task.spec.scriptBeat?.beatId === 'hook') {
        task.spec.scriptBeat = { ...task.spec.scriptBeat, dialogue: hook.spokenHook };
      }
      if (task.spec.scriptBeats.some((beat) => beat.beatId === 'hook')) {
        task.spec.spokenLine = task.spec.scriptBeats.map((beat) => cleanSpokenLine(beat.dialogue)).filter(Boolean).join(' ');
      }
      task.spec.hookPlanTaskId = planningTaskId;
      task.spec.hookPlanFingerprint = hookPlan.planFingerprint;
      task.spec.hookSelectionHash = selectionHash;
    }
    if (task.kind === 'render' && task.outputType === 'ugc_ad') {
      const script = task.renderSpec.script;
      script.beats = (script.beats || []).map((beat) => (
        beat.beatId === 'hook' ? { ...beat, dialogue: hook.spokenHook } : beat
      ));
      script.hookPlan = {
        schemaVersion: hookPlan.schemaVersion,
        promptVersion: hookPlan.promptVersion,
        status: 'selected',
        planId: hookPlan.planId,
        planFingerprint: hookPlan.planFingerprint,
        requestFingerprint: hookPlan.requestFingerprint,
        sourceFingerprint: hookPlan.sourceFingerprint,
        policyFingerprint: hookPlan.policyFingerprint,
        taskId: planningTaskId,
        candidateId: hook.candidateId,
        patternId: hook.patternId,
        targetBehavior: hook.targetBehavior || null,
        tension: hook.tension || null,
        selectionIndex: hook.selectionIndex,
        evidenceRefs: hook.evidenceRefs,
        unitBinding,
        coldRead: hook.coldRead || null,
        critic: hook.critic,
        intelligenceMode: hookPlan.intelligenceMode,
        rounds: hookPlan.rounds,
        selectionHash,
        providerMutations: 0,
      };
      script.hookQuality = hookQuality;
      const caption = (task.renderSpec.timeline || []).find((layer) => layer.type === 'caption' && layer.role === 'hook');
      if (!caption) throw new Error(`UGC unit ${unitId} is missing its hook caption layer.`);
      caption.text = hook.caption;
      task.renderSpec.renderManifest.hookPlanTaskId = planningTaskId;
      task.renderSpec.renderManifest.hookPlanId = hookPlan.planId;
      task.renderSpec.renderManifest.hookPlanFingerprint = hookPlan.planFingerprint;
      task.renderSpec.renderManifest.hookCandidateId = hook.candidateId;
      task.renderSpec.renderManifest.hookSelectionHash = selectionHash;
    }
  }
}

function criticApprovedHook(hook) {
  const critic = hook?.critic || {};
  const coldRead = hook?.coldRead || {};
  return Boolean(
    hook?.spokenHook
    && hook?.caption
    && critic.verdict === 'pass'
    && Number(critic.topicClarity) >= 4
    && Number(critic.concreteTension) >= 4
    && Number(critic.curiosity) >= 3
    && Number(critic.nativeVoice) >= 4
    && Number(critic.claimSafety) === 5
    && critic.topicMatchesEvidence === true
    && Array.isArray(critic.supportedEvidenceRefs)
    && critic.supportedEvidenceRefs.length > 0
    && Array.isArray(critic.unsupportedSpans)
    && critic.unsupportedSpans.length === 0
    && critic.duplicateClusterId
    && !critic.nearDuplicateOf
    && Number(coldRead.topicConfidence) >= 0.85
    && coldRead.inferredTopic
    && coldRead.behaviorOrSituation
    && coldRead.tensionOrConsequence
    && !(coldRead.unexplainedTerms || []).length
  );
}

function semanticQualityForSelectedHook(hook = {}) {
  const critic = hook.critic || {};
  return {
    status: 'pass',
    semanticCriticStatus: critic.verdict === 'pass' ? 'pass' : 'hold',
    topicClarity: Number(critic.topicClarity),
    concreteTension: Number(critic.concreteTension),
    curiosity: Number(critic.curiosity),
    nativeVoice: Number(critic.nativeVoice),
    claimSafety: Number(critic.claimSafety),
    topicMatchesEvidence: critic.topicMatchesEvidence === true,
    supportedEvidenceRefs: critic.supportedEvidenceRefs || [],
    unsupportedSpans: critic.unsupportedSpans || [],
    duplicateClusterId: critic.duplicateClusterId || null,
    coldRead: hook.coldRead || null,
    reason: critic.reason || '',
  };
}

function hookUnitBinding(job, unitId, assignmentId = null) {
  const renderTask = (job.tasks || []).find((task) => task.kind === 'render' && task.outputType === 'ugc_ad' && task.spec?.unitId === unitId);
  if (!renderTask) throw new Error(`Hook assignment target ${unitId} is missing its UGC render task.`);
  return {
    assignmentId: assignmentId || unitId,
    unitId,
    claimId: renderTask.spec?.claimId || null,
    angleId: renderTask.spec?.angleId || null,
    angleLabel: renderTask.spec?.angleLabel || null,
    packPlanAssignmentId: renderTask.spec?.packPlanAssignmentId || null,
    proofIds: (renderTask.renderSpec?.timeline || []).filter((layer) => layer.type === 'proof_media').map((layer) => layer.proofId).filter(Boolean),
  };
}

function normalizeHookFingerprint(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function buildCreativeJobGraph({
  jobId,
  orgId,
  workspaceId,
  appId,
  packId,
  createdBy,
  imageCount,
  videoCount,
  app,
  packPlan = null,
  costCredits,
  createdAt,
  ugcRoute = DEFAULT_UGC_ROUTE,
}) {
  if (!UGC_ROUTES[ugcRoute]) {
    throw new Error('Unknown UGC ad route.');
  }
  const prefix = jobStoragePrefix({ orgId, workspaceId, appId, jobId });
  const source = jobSourceFromApp(app, packPlan);
  const scope = { jobId, orgId, workspaceId, appId, packId };
  const tasks = [];
  const hookPlanTask = videoCount > 0
    ? buildHookPlanningTask({ scope, prefix, source, outputCount: videoCount, createdAt })
    : null;
  if (hookPlanTask) tasks.push(hookPlanTask);
  const scriptPlanTask = videoCount > 0
    ? buildScriptPlanningTask({ scope, prefix, outputCount: videoCount, hookPlanTaskId: hookPlanTask.taskId, createdAt })
    : null;
  if (scriptPlanTask) tasks.push(scriptPlanTask);

  for (let index = 1; index <= imageCount; index += 1) {
    const unit = buildImageUnitTasks({ scope, prefix, source, unitIndex: index, createdAt });
    tasks.push(...unit.tasks, qaTaskFor({ scope, targetTask: unit.renderTask, createdAt }));
  }

  for (let index = 1; index <= videoCount; index += 1) {
    const unit = buildUgcUnitTasks({
      scope,
      prefix,
      source,
      unitIndex: index,
      createdAt,
      ugcRoute,
      hookPlanTaskId: hookPlanTask?.taskId || null,
      scriptPlanTaskId: scriptPlanTask?.taskId || null,
    });
    tasks.push(...unit.tasks, qaTaskFor({ scope, targetTask: unit.renderTask, createdAt }));
  }

  const job = {
    schemaVersion: JOB_SCHEMA_VERSION,
    jobId,
    packId,
    orgId,
    workspaceId,
    appId,
    createdBy,
    status: 'queued',
    request: { imageCount, videoCount, ugcRoute },
    source,
    storagePrefix: prefix,
    tasks,
    assets: [],
    qaReports: [],
    drafts: [],
    hookPlans: [],
    scriptPlans: [],
    costPlan: buildJobCostPlan({ tasks, reservedCredits: costCredits }),
    creativeIntelligenceCalls: 0,
    generationProviderCalls: 0,
    providerMutations: 0,
    createdAt,
    updatedAt: createdAt,
  };
  assertCreativeJobPersistenceBudget(job);
  return job;
}

export function creativeJobPersistenceEstimate(job) {
  const graphBytes = new TextEncoder().encode(JSON.stringify(toPlain(job))).byteLength;
  const imageCount = Number(job?.request?.imageCount || 0);
  const videoCount = Number(job?.request?.videoCount || 0);
  // Conservative allowance for assets, QA reports, drafts, task errors, and
  // usage/lease metadata added while the graph executes.
  const executionHeadroomBytes = 50_000 + (imageCount * 4_000) + (videoCount * 25_000);
  return {
    graphBytes,
    executionHeadroomBytes,
    estimatedCompletedBytes: graphBytes + executionHeadroomBytes,
    maxDocumentBytes: MAX_CREATIVE_JOB_DOCUMENT_BYTES,
  };
}

export function assertCreativeJobPersistenceBudget(job) {
  const estimate = creativeJobPersistenceEstimate(job);
  if (estimate.estimatedCompletedBytes > estimate.maxDocumentBytes) {
    throw new Error(`This creative pack is too large for safe persistence (${estimate.estimatedCompletedBytes} estimated bytes). Reduce outputs or reviewed app inputs and try again.`);
  }
  return estimate;
}

/* Image ads follow the same two-stage shape as UGC ads: a source-layer
   generation task (background canvas, no UI/text) feeding a finishing/
   composition task that owns the real screenshot proof, headline, and CTA. */
function buildImageUnitTasks({ scope, prefix, source, unitIndex, createdAt }) {
  const { jobId } = scope;
  const assignment = assignmentFor(source, 'image_ad', unitIndex - 1);
  const claim = claimForAssignment(source, assignment) || pickByIndex(source.claims, unitIndex - 1);
  const screen = screenForAssignment(source, assignment) || pickByIndex(source.screens, unitIndex - 1);
  const angleId = assignment?.lane || pickByIndex(source.angles, unitIndex - 1)?.id || null;
  // A Pack Plan angle is strategy guidance, not customer-facing ad copy. Keep
  // it on the task as `angleLabel`, but derive the rendered headline only from
  // reviewed product truth until an evidence-bound image copy planner replaces
  // it. This prevents exploratory instructions such as "Lead with..." from
  // leaking verbatim into finished ads.
  const headline = adHeadlineForClaim({ source, claim });
  const sourceTaskId = `${jobId}-image-${unitIndex}-source`;
  const sourceTask = {
    ...taskShell({ scope, taskId: sourceTaskId, kind: 'generation', adapter: 'image_ad', createdAt }),
    outputType: 'image_ad_source',
    costUnits: CREDIT_RULES.image,
    spec: {
      format: 'image_ad_source',
      headline,
      claimId: claim?.id || null,
      claimText: claim?.text || null,
      angleId,
      angleLabel: assignment?.angle || null,
      packPlanAssignmentId: assignment?.assignmentId || null,
      screenAssetId: screen?.assetId || null,
      screenStorageKey: screen?.storageKey || null,
      screenId: screen?.id || null,
      dimensions: { ...IMAGE_AD_DEFAULTS.dimensions },
      styleNotes: source.styleNotes,
    },
    output: {
      storageKey: `${prefix}/generated/${sourceTaskId}.png`,
      contentType: IMAGE_AD_DEFAULTS.contentType,
    },
  };

  const renderTaskId = `${jobId}-image-${unitIndex}-render`;
  const renderTask = {
    ...taskShell({ scope, taskId: renderTaskId, kind: 'render', adapter: 'finishing_compositor', createdAt }),
    outputType: 'image_ad',
    costUnits: 0,
    dependsOn: [sourceTaskId],
    spec: {
      format: 'image_ad',
      headline,
      claimId: claim?.id || null,
      angleId,
      angleLabel: assignment?.angle || null,
      packPlanAssignmentId: assignment?.assignmentId || null,
      screenId: screen?.id || null,
    },
    renderSpec: buildImageRenderSpec({ prefix, renderTaskId, sourceTaskId, source, claim, screen, headline }),
    output: {
      storageKey: `${prefix}/render/${renderTaskId}.png`,
      contentType: IMAGE_AD_DEFAULTS.contentType,
    },
  };
  return { tasks: [sourceTask, renderTask], renderTask };
}

export function buildImageRenderSpec({ prefix, renderTaskId, sourceTaskId, source, claim, screen, headline }) {
  const { width, height } = IMAGE_AD_DEFAULTS.dimensions;
  const timeline = [
    { id: `${renderTaskId}-layer-background`, type: 'background_layer', sourceTaskId },
    ...(screen ? [{
      id: `${renderTaskId}-layer-proof`,
      type: 'proof_media',
      proofId: screen.id,
      assetId: screen.assetId || null,
      storageKey: screen.storageKey || null,
      sourceType: screen.sourceType || null,
      trustLevel: screen.trustLevel || null,
      label: screen.label || null,
      detail: screen.detail || null,
      treatment: 'phone-panel',
    }] : []),
    { id: `${renderTaskId}-caption-headline`, type: 'caption', role: 'headline', text: headline },
    { id: `${renderTaskId}-layer-cta`, type: 'cta', text: ctaLabel('Get', source.appName) },
  ];
  return {
    backend: 'finishing_compositor',
    format: 'image',
    compositionKey: `${prefix}/render/${renderTaskId}-composition.json`,
    variablesKey: `${prefix}/render/${renderTaskId}-variables.json`,
    inputAssetIds: [],
    dimensions: { width, height },
    outputKey: `${prefix}/render/${renderTaskId}.png`,
    timeline,
    claimReferences: claim ? [{ claimId: claim.id, supportedClaim: claim.text }] : [],
    providerMutations: 0,
  };
}

function buildHookPlanningTask({ scope, prefix, source, outputCount, createdAt }) {
  const taskId = `${scope.jobId}-ugc-hook-plan`;
  const hookRequest = buildHookPlanningRequest({
    source,
    outputCount,
    outputBindings: hookOutputBindingsForSource(source, outputCount),
    policy: UGC_HOOK_POLICY,
  });
  return {
    ...taskShell({ scope, taskId, kind: 'planning', adapter: 'hook_intelligence', createdAt }),
    maxAttempts: 2,
    outputType: 'ugc_hook_plan',
    costUnits: 0,
    spec: {
      format: 'ugc_hook_plan',
      schemaVersion: HOOK_PLAN_SCHEMA_VERSION,
      outputCount,
      hookPolicy: UGC_HOOK_POLICY,
      hookRequest,
      requestFingerprint: hookRequest.requestFingerprint,
      sourceFingerprint: hookRequest.sourceFingerprint,
      policyFingerprint: hookRequest.policyFingerprint,
      planningBudget: {
        candidatePoolSize: hookRequest.candidatePoolSize,
        maxQualityRounds: hookRequest.maxQualityRounds,
        maxIntelligenceCalls: hookRequest.maxIntelligenceCalls,
        maxLifetimeIntelligenceCalls: hookRequest.maxIntelligenceCalls * 2,
        maxInputCharacters: hookRequest.maxInputCharacters,
      },
      intelligenceMode: 'writer_then_isolated_blind_reader_then_evidence_critic',
      mediaGenerationProviderCallsBeforeSelection: 0,
    },
    output: {
      storageKey: `${prefix}/plans/${taskId}.json`,
      contentType: 'application/json',
    },
  };
}

function buildScriptPlanningTask({ scope, prefix, outputCount, hookPlanTaskId, createdAt }) {
  const taskId = `${scope.jobId}-ugc-script-plan`;
  return {
    ...taskShell({ scope, taskId, kind: 'planning', adapter: 'script_intelligence', createdAt }),
    maxAttempts: 2,
    outputType: 'ugc_script_plan',
    costUnits: 0,
    dependsOn: [hookPlanTaskId],
    spec: {
      format: 'ugc_script_plan',
      schemaVersion: SCRIPT_PLAN_SCHEMA_VERSION,
      outputCount,
      hookPlanTaskId,
      status: 'pending_selected_hook_plan',
      scriptRequest: null,
      mediaGenerationProviderCallsBeforeSelection: 0,
    },
    output: {
      storageKey: `${prefix}/plans/${taskId}.json`,
      contentType: 'application/json',
    },
  };
}

function hookOutputBindingsForSource(source, outputCount) {
  const proofIds = (source.screens || []).slice(0, 3).map((screen) => screen.id).filter(Boolean);
  return Array.from({ length: outputCount }, (_, index) => {
    const assignment = assignmentFor(source, 'ugc_ad', index);
    const angleId = assignment?.lane || null;
    return {
      assignmentId: assignment?.assignmentId || `ugc-${index + 1}`,
      angleId,
      angleLabel: assignment?.angle || null,
      evidenceRefs: [
        ...(source.appSummary ? ['app_summary'] : []),
        angleId,
        claimForAssignment(source, assignment)?.id || pickByIndex(source.claims, index)?.id || null,
        screenForAssignment(source, assignment)?.id || null,
        ...proofIds,
      ].filter(Boolean),
    };
  });
}

function buildUgcUnitTasks({ scope, prefix, source, unitIndex, createdAt, ugcRoute = DEFAULT_UGC_ROUTE, hookPlanTaskId = null, scriptPlanTaskId = null }) {
  const { jobId } = scope;
  const unitId = `${jobId}-ugc-${unitIndex}`;
  const assignment = assignmentFor(source, 'ugc_ad', unitIndex - 1);
  const claim = claimForAssignment(source, assignment) || pickByIndex(source.claims, unitIndex - 1);
  // As with image headlines, Pack Plan angles remain planning context. The
  // Hook and Script Agents own customer-facing UGC copy; deterministic
  // pre-plan fallbacks stay grounded in the reviewed claim.
  const angleHeadline = adHeadlineForClaim({ source, claim });
  const route = UGC_ROUTES[ugcRoute];
  const segmentRoles = route.segments;
  const recipePlan = buildUgcRecipePlan({ unitId, route, source, claim, unitIndex });
  const usesSharedFirstFrame = route.creatorSourcePolicy === 'multi_clip_shared_first_frame';
  const firstFrameTaskId = usesSharedFirstFrame ? `${unitId}-shared-first-frame` : null;
  const generationTaskCount = segmentRoles.length + (usesSharedFirstFrame ? 1 : 0);
  const perGenerationCost = Math.floor(CREDIT_RULES.video / (generationTaskCount + 1));
  const tasks = [];

  if (usesSharedFirstFrame) {
    tasks.push({
      ...taskShell({ scope, taskId: firstFrameTaskId, kind: 'generation', adapter: 'ugc_creator_frame', createdAt }),
      outputType: 'ugc_first_frame',
      costUnits: perGenerationCost,
      dependsOn: scriptPlanTaskId ? [scriptPlanTaskId] : (hookPlanTaskId ? [hookPlanTaskId] : []),
      spec: {
        format: 'ugc_first_frame',
        angleId: assignment?.lane || null,
        angleLabel: assignment?.angle || null,
        packPlanAssignmentId: assignment?.assignmentId || null,
        unitId,
        recipeId: recipePlan.recipe.id,
        scriptId: recipePlan.script.id,
        creatorStyle: 'selfie_ugc',
        creatorScenario: recipePlan.emotionPlan.ugcFormat,
        creatorIdentity: recipePlan.creatorIdentity,
        visualContinuity: recipePlan.visualContinuity,
        firstFramePrompt: recipePlan.firstFramePrompt,
        firstFrameNegativePrompt: recipePlan.firstFrameNegativePrompt,
        dimensions: { ...UGC_RENDER_DEFAULTS.dimensions },
      },
      output: {
        storageKey: `${prefix}/generated/${unitId}-shared-first-frame.png`,
        contentType: 'image/png',
      },
    });
  }

  const segmentTasks = segmentRoles.map((segment) => {
    const scriptBeats = scriptBeatsForSegment(segment, recipePlan.script);
    const scriptBeat = scriptBeats[0] || null;
    return {
      ...taskShell({ scope, taskId: `${unitId}-segment-${segment.role.replace(/_/g, '-')}`, kind: 'generation', adapter: 'ugc_creator_block', createdAt }),
      outputType: 'ugc_segment',
      costUnits: perGenerationCost,
      dependsOn: [...(scriptPlanTaskId ? [scriptPlanTaskId] : (hookPlanTaskId ? [hookPlanTaskId] : [])), ...(firstFrameTaskId ? [firstFrameTaskId] : [])],
      spec: {
        format: 'ugc_segment',
        unitId,
        recipeId: recipePlan.recipe.id,
        scriptId: recipePlan.script.id,
        segmentRole: segment.role,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        purpose: segment.purpose,
        spokenLine: spokenLineForPlannedSegment({ segment, scriptBeats, source, claim }),
        scriptBeat,
        scriptBeats,
        claimId: claim?.id || null,
        angleId: assignment?.lane || null,
        angleLabel: assignment?.angle || null,
        packPlanAssignmentId: assignment?.assignmentId || null,
        proofAssetRefs: scriptBeats.flatMap((beat) => beat.proofAssetRefs || []),
        maxSpokenSeconds: maxSpokenSecondsForSegment({ segment, scriptBeats }),
        mustCompleteBySeconds: mustCompleteBySecondsForSegment({ segment, scriptBeats }),
        tailRoomSeconds: tailRoomSecondsForSegment({ segment, scriptBeats }),
        creatorStyle: 'selfie_ugc',
        creatorScenario: recipePlan.emotionPlan.ugcFormat,
        creatorIdentity: recipePlan.creatorIdentity,
        visualContinuity: recipePlan.visualContinuity,
        sharedFirstFrameTaskId: firstFrameTaskId,
        firstFramePrompt: recipePlan.firstFramePrompt,
        firstFrameNegativePrompt: recipePlan.firstFrameNegativePrompt,
        emotionPlan: recipePlan.emotionPlan,
        audio: 'native',
        dimensions: { ...UGC_RENDER_DEFAULTS.dimensions },
      },
      output: {
        storageKey: `${prefix}/generated/${unitId}-${segment.role}.mp4`,
        contentType: 'video/mp4',
      },
    };
  });
  tasks.push(...segmentTasks);

  const proofPrepTask = {
    ...taskShell({ scope, taskId: `${unitId}-proof-prep`, kind: 'proof_prep', adapter: 'proof_prep', createdAt }),
    outputType: 'proof_prep_artifact',
    costUnits: 0,
    spec: {
      unitId,
      recipeId: recipePlan.recipe.id,
      scriptId: recipePlan.script.id,
      proofAudioPolicy: route.proofAudioPolicy,
      proofs: buildProofPrepSpec(source.screens, recipePlan.proofWindow),
    },
    output: {
      storageKey: `${prefix}/proof/${unitId}-proof-prep.json`,
      contentType: 'application/json',
    },
  };
  tasks.push(proofPrepTask);

  const renderTaskId = `${unitId}-render`;
  const renderTask = {
    ...taskShell({ scope, taskId: renderTaskId, kind: 'render', adapter: 'finishing_compositor', createdAt }),
    outputType: 'ugc_ad',
    costUnits: CREDIT_RULES.video - (perGenerationCost * generationTaskCount),
    dependsOn: [...segmentTasks.map((task) => task.taskId), proofPrepTask.taskId],
    spec: {
      unitId,
      caption: angleHeadline,
      claimId: claim?.id || null,
      angleId: assignment?.lane || pickByIndex(source.angles, unitIndex - 1)?.id || null,
      angleLabel: assignment?.angle || null,
      packPlanAssignmentId: assignment?.assignmentId || null,
      screenId: screenForAssignment(source, assignment)?.id || pickByIndex(source.screens, unitIndex - 1)?.id || null,
    },
    renderSpec: buildRenderSpec({
      prefix,
      renderTaskId,
      unitId,
      source,
      claim,
      ugcRoute,
      recipePlan,
      sharedFirstFrameTaskId: firstFrameTaskId,
    }),
    output: {
      storageKey: `${prefix}/render/${renderTaskId}.mp4`,
      contentType: 'video/mp4',
    },
  };
  tasks.push(renderTask);
  return { tasks, renderTask };
}

function segmentCoversBeat(segment, beatId) {
  if (!segment || !beatId) return false;
  if (segment.role === beatId) return true;
  return Array.isArray(segment.beatIds) && segment.beatIds.includes(beatId);
}

function scriptBeatsForSegment(segment, script) {
  const beats = script?.beats || [];
  if (Array.isArray(segment?.beatIds) && segment.beatIds.length) {
    return segment.beatIds
      .map((beatId) => beats.find((beat) => beat.beatId === beatId))
      .filter(Boolean);
  }
  return beats.filter((beat) => beat.beatId === segment?.role);
}

function spokenLineForPlannedSegment({ segment, scriptBeats, source, claim }) {
  if (scriptBeats?.length) {
    return scriptBeats.map((beat) => cleanSpokenLine(beat.dialogue)).filter(Boolean).join(' ');
  }
  return spokenLineForSegment(segment.role, source, claim);
}

function maxSpokenSecondsForSegment({ segment, scriptBeats }) {
  if (Number.isFinite(Number(segment?.endSeconds)) && Number.isFinite(Number(segment?.startSeconds))) {
    const tailRoom = tailRoomSecondsForSegment({ segment, scriptBeats });
    return round2(Math.max(0.5, Number(segment.endSeconds) - Number(segment.startSeconds) - tailRoom));
  }
  return scriptBeats?.length ? Math.max(...scriptBeats.map((beat) => Number(beat.maxSpokenSeconds) || 0)) || null : null;
}

function mustCompleteBySecondsForSegment({ segment, scriptBeats }) {
  const explicit = (scriptBeats || [])
    .map((beat) => Number(beat.mustCompleteBySeconds))
    .filter(Number.isFinite);
  if (explicit.length) return Math.max(...explicit);
  if (Number.isFinite(Number(segment?.endSeconds))) {
    return round2(Number(segment.endSeconds) - tailRoomSecondsForSegment({ segment, scriptBeats }));
  }
  return null;
}

function tailRoomSecondsForSegment({ segment, scriptBeats }) {
  const explicit = (scriptBeats || [])
    .map((beat) => Number(beat.tailRoomSeconds))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (explicit.length) return Math.max(...explicit);
  return segment?.role === 'single_take' ? 0.65 : null;
}

/* Portable finishing/composition contract. The local runner fills
   inputAssetIds from dependency outputs at execution time; a hosted
   finishing backend consumes the same fields unchanged. */
export function buildRenderSpec({ prefix, renderTaskId, unitId, source, claim, ugcRoute = DEFAULT_UGC_ROUTE, recipePlan = null, sharedFirstFrameTaskId = null }) {
  const { fps, dimensions } = UGC_RENDER_DEFAULTS;
  const route = UGC_ROUTES[ugcRoute];
  const durationSeconds = route.durationSeconds || UGC_RENDER_DEFAULTS.durationSeconds;
  const segmentRoles = route.segments;
  const plan = recipePlan || buildUgcRecipePlan({ unitId, route, source, claim, unitIndex: 1 });
  const captions = buildUgcCaptions({ unitId, route, plan, source, claim, durationSeconds });
  const proofLayers = buildProofPrepSpec(source.screens, plan.proofWindow).map((proof) => ({
    id: `${unitId}-layer-proof-${proof.proofId}`,
    type: 'proof_media',
    start: proof.start,
    duration: proof.end - proof.start,
    proofId: proof.proofId,
    assetId: proof.assetId,
    storageKey: proof.storageKey,
      sourceType: proof.sourceType,
      extractionStage: proof.extractionStage || null,
      requiresRawificationBeforeUiExtraction: Boolean(proof.requiresRawificationBeforeUiExtraction),
      trustLevel: proof.trustLevel,
    label: proof.label,
    detail: proof.detail,
    rawifyEligible: proof.rawifyEligible,
    crop: proof.crop,
    treatment: proof.treatment,
    audioPolicy: route.proofAudioPolicy,
    proofLine: plan.script.beats.find((beat) => beat.beatId === 'proof_voice')?.dialogue || null,
  }));
  const ctaLayer = route.captionPolicy?.allowCtaCard === false
    ? null
    : {
      id: `${unitId}-layer-cta`,
      type: 'cta',
      start: Math.max(0, durationSeconds - 3),
      duration: 3,
      text: ctaLabel('Download', source.appName),
    };
  const timeline = [
    ...segmentRoles.map((segment) => ({
      id: `${unitId}-layer-${segment.role}`,
      type: 'creator_video',
      start: segment.startSeconds,
      duration: segment.endSeconds - segment.startSeconds,
      sourceTaskId: `${unitId}-segment-${segment.role.replace(/_/g, '-')}`,
      role: segment.role,
      audioPolicy: 'native_creator_audio',
    })),
    ...proofLayers,
    ...captions.map((caption) => ({
      id: caption.id,
      type: 'caption',
      start: caption.start,
      duration: caption.end - caption.start,
      text: caption.text,
      role: caption.role,
      style: caption.style,
    })),
    ...(ctaLayer ? [ctaLayer] : []),
  ].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  return {
    backend: 'finishing_compositor',
    format: 'video',
    ugcRoute,
    recipe: plan.recipe,
    script: plan.script,
    emotionPlan: plan.emotionPlan,
    captionStyle: route.captionPolicy?.style || 'native_white_no_box',
    proofAudioPolicy: route.proofAudioPolicy,
    renderManifest: {
      schemaVersion: UGC_RENDER_MANIFEST_SCHEMA_VERSION,
      recipeId: plan.recipe.id,
      scriptId: plan.script.id,
      proofWindow: plan.proofWindow,
      creatorSourcePolicy: route.creatorSourcePolicy || 'multi_clip',
      sharedFirstFrame: sharedFirstFrameTaskId ? {
        required: true,
        taskId: sharedFirstFrameTaskId,
        role: 'creator_continuity_anchor',
      } : null,
      visualContinuity: plan.visualContinuity || null,
      noCtaCard: route.captionPolicy?.allowCtaCard === false,
      providerMutations: 0,
    },
    compositionKey: `${prefix}/render/${renderTaskId}-composition.json`,
    variablesKey: `${prefix}/render/${renderTaskId}-variables.json`,
    inputAssetIds: [],
    durationSeconds,
    fps,
    dimensions: { ...dimensions },
    outputKey: `${prefix}/render/${renderTaskId}.mp4`,
    timeline,
    claimReferences: claim ? [{ claimId: claim.id, supportedClaim: claim.text }] : [],
    providerMutations: 0,
  };
}

export function resolveVideoRenderSpecWithInputDurations({ renderSpec, inputAssets = [] } = {}) {
  if (!renderSpec || renderSpec.format === 'image') return renderSpec;
  const timeline = Array.isArray(renderSpec.timeline) ? renderSpec.timeline.map((layer) => ({ ...layer })) : [];
  const creatorLayers = timeline
    .filter((layer) => layer.type === 'creator_video')
    .sort((a, b) => safeNumber(a.start) - safeNumber(b.start));
  if (!creatorLayers.length) return renderSpec;

  const assetDurationByTaskId = new Map(inputAssets
    .filter((asset) => asset?.taskId && positiveDuration(asset.durationSeconds))
    .map((asset) => [asset.taskId, positiveDuration(asset.durationSeconds)]));
  if (!assetDurationByTaskId.size) return renderSpec;

  const originalDuration = positiveDuration(renderSpec.durationSeconds) || timelineEnd(timeline);
  const roleAnchors = new Map();
  let cursor = Math.max(0, Math.min(...creatorLayers.map((layer) => safeNumber(layer.start))));

  for (const originalLayer of creatorLayers) {
    const layer = timeline.find((candidate) => candidate.id === originalLayer.id);
    const oldStart = safeNumber(originalLayer.start);
    const oldDuration = positiveDuration(originalLayer.duration) || 0.1;
    const actualDuration = assetDurationByTaskId.get(originalLayer.sourceTaskId) || oldDuration;
    const anchor = {
      role: originalLayer.role || null,
      oldStart,
      oldEnd: oldStart + oldDuration,
      oldDuration,
      newStart: round2(cursor),
      newDuration: round2(actualDuration),
      newEnd: round2(cursor + actualDuration),
    };
    layer.start = anchor.newStart;
    layer.duration = anchor.newDuration;
    if (anchor.role) roleAnchors.set(anchor.role, anchor);
    cursor = anchor.newEnd;
  }

  const beatRoleById = new Map();
  const route = UGC_ROUTES[renderSpec.ugcRoute];
  for (const segment of route?.segments || []) {
    const beatIds = segment.beatIds?.length ? segment.beatIds : [segment.role];
    for (const beatId of beatIds) beatRoleById.set(beatId, segment.role);
  }

  const resolvedDuration = round2(Math.max(cursor, 0.1));
  for (const layer of timeline) {
    if (layer.type === 'creator_video') continue;
    const anchor = anchorForLayer(layer, roleAnchors, beatRoleById);
    if (anchor) {
      retimeLayerToAnchor(layer, anchor);
    } else if (originalDuration > 0 && resolvedDuration !== originalDuration) {
      retimeLayerToDuration(layer, originalDuration, resolvedDuration);
    }
  }

  const script = renderSpec.script?.beats
    ? {
      ...renderSpec.script,
      beats: renderSpec.script.beats.map((beat) => {
        const anchor = roleAnchors.get(beatRoleById.get(beat.beatId) || beat.beatId);
        if (!anchor) return beat;
        const oldStart = safeNumber(beat.startSeconds, anchor.oldStart);
        const oldEnd = safeNumber(beat.endSeconds, anchor.oldEnd);
        const startRatio = clamp01((oldStart - anchor.oldStart) / anchor.oldDuration);
        const endRatio = Math.max(startRatio, clamp01((oldEnd - anchor.oldStart) / anchor.oldDuration));
        const newStart = round2(anchor.newStart + (startRatio * anchor.newDuration));
        const newEnd = round2(anchor.newStart + (endRatio * anchor.newDuration));
        const tailRoomSeconds = positiveDuration(beat.tailRoomSeconds) || 0;
        return {
          ...beat,
          startSeconds: newStart,
          endSeconds: newEnd,
          maxSpokenSeconds: tailRoomSeconds ? round2(Math.max(0.5, newEnd - newStart - tailRoomSeconds)) : beat.maxSpokenSeconds,
          mustCompleteBySeconds: tailRoomSeconds ? round2(newEnd - tailRoomSeconds) : beat.mustCompleteBySeconds,
        };
      }),
    }
    : renderSpec.script;
  const resolvedProofLayers = timeline.filter((layer) => layer.type === 'proof_media');
  const resolvedProofWindow = resolvedProofLayers.length
    ? {
        startAt: Math.min(...resolvedProofLayers.map((layer) => safeNumber(layer.start))),
        endBy: Math.max(...resolvedProofLayers.map((layer) => safeNumber(layer.start) + positiveDuration(layer.duration))),
      }
    : renderSpec.renderManifest?.proofWindow;

  return {
    ...renderSpec,
    script,
    durationSeconds: resolvedDuration,
    timeline: timeline.sort(compareTimelineLayers),
    renderManifest: {
      ...(renderSpec.renderManifest || {}),
      durationMode: 'source_clip_sum',
      plannedDurationSeconds: originalDuration,
      sourceDurationSeconds: resolvedDuration,
      proofWindow: resolvedProofWindow,
      providerMutations: 0,
    },
    providerMutations: 0,
  };
}

export function buildProofPrepSpec(screens, { startAt = 4, endBy = 12 } = {}) {
  const selected = (screens || []).slice(0, 3);
  const safeEnd = Math.max(Number(endBy) || 0, (Number(startAt) || 0) + 1.5);
  const safeStart = Number(startAt) || 0;
  const windowSeconds = selected.length ? Math.max(1.5, (safeEnd - safeStart) / selected.length) : 0;
  return selected.map((screen, index) => {
    const sourceType = screen.sourceType || null;
    const isRawifiedProof = String(sourceType || '').toLowerCase() === 'rawified_store_art';
    return {
      proofId: screen.id,
      assetId: screen.assetId || null,
      storageKey: screen.storageKey || null,
      label: screen.label || `Screen ${index + 1}`,
      detail: screen.detail || null,
      sourceType,
      extractionStage: screen.extractionStage || (sourceType === 'store_art' ? 'pre_rawification' : 'ui_extracted'),
      requiresRawificationBeforeUiExtraction: Boolean(screen.requiresRawificationBeforeUiExtraction || sourceType === 'store_art'),
      trustLevel: screen.trustLevel || (isRawifiedProof ? 'rawified_from_store_listing' : null),
      rawifyEligible: Boolean(screen.rawifyEligible || isRawifiedProof),
      sourceUrl: screen.sourceUrl || null,
      start: round2(safeStart + index * windowSeconds),
      end: round2(Math.min(safeEnd, safeStart + (index + 1) * windowSeconds)),
      crop: {
        x: 80 + index * 24,
        y: 160 + index * 20,
        width: 920 - index * 32,
        height: 1240 - index * 28,
      },
      treatment: isRawifiedProof
        ? 'rawified-proof-overlay'
        : index === 0 ? 'full-phone-contained' : 'floating-proof-panel',
    };
  });
}

function buildUgcRecipePlan({ unitId, route, source, claim, unitIndex }) {
  const shortName = shortAppName(source.appName);
  const category = source.appCategory || 'unknown';
  const proofType = 'reviewed_app_screen';
  const scenario = 'pending_script_agent';
  const creatorIdentity = {
    id: 'pending-script-agent',
    description: 'Creator identity and framing are selected from reviewed evidence by the Script Agent before media generation.',
  };
  const featureLine = adHeadlineForClaim({ source, claim });
  const scriptLines = { hook: '', tension: '', bridge: '', payload: '', proof: '', reinforcement: '', reaction: '' };
  const proofWindow = route.proofWindow || { startAt: 4.1, endBy: 9.6 };
  const singleTake = route.creatorSourcePolicy === 'single_take';
  const sharedFirstFrame = route.creatorSourcePolicy === 'multi_clip_shared_first_frame';
  const singleTakeDuration = route.durationSeconds || 8;
  const beatTiming = singleTake
    ? {
      hook: { startSeconds: 0, endSeconds: 2.35 },
      proof_voice: { startSeconds: 2.35, endSeconds: 6.1 },
      reaction: { startSeconds: 6.1, endSeconds: singleTakeDuration },
      reactionMustCompleteBySeconds: Math.max(0.5, singleTakeDuration - 0.65),
      reactionTailRoomSeconds: 0.65,
    }
    : {
      hook: { startSeconds: 0, endSeconds: 4 },
      tension: { startSeconds: 4, endSeconds: 8 },
      bridge: { startSeconds: 8, endSeconds: 12 },
      payload: { startSeconds: 12, endSeconds: 16 },
      proof_voice: { startSeconds: 16, endSeconds: 20 },
      reinforcement: { startSeconds: 20, endSeconds: 23 },
      reaction: { startSeconds: 23, endSeconds: 28 },
      reactionMustCompleteBySeconds: V6_REACTION_MUST_COMPLETE_BY_SECONDS,
      reactionTailRoomSeconds: V6_REACTION_TAIL_ROOM_SECONDS,
    };
  const visualContinuity = {
    mode: sharedFirstFrame ? 'shared_first_frame_across_blocks' : singleTake ? 'single_take_locked_frame' : 'locked_identity_across_blocks',
    identityId: creatorIdentity.id,
    scene: scenario,
    stableProps: [],
    forbiddenDrift: [],
    qaInstructions: 'Pending evidence-bound Script Agent creator plan.',
  };

  const recipe = {
    schemaVersion: UGC_RECIPE_SCHEMA_VERSION,
    id: route.recipeId,
    name: route.name,
    family: route.family,
    requiredProofTypes: [proofType],
    emotionArcs: ['pending_script_agent'],
    creatorContinuity: {
      identityId: creatorIdentity.id,
      description: creatorIdentity.description,
      sourcePolicy: route.creatorSourcePolicy || (singleTake ? 'single_take' : 'multi_clip_locked_identity'),
      visualContinuity,
    },
    constraints: {
      brandRevealPolicy: route.recipeId === 'ugc_selfie_proof_reveal' ? 'end_only' : 'payload_allowed',
      allowCtaCard: route.captionPolicy?.allowCtaCard !== false,
      captionStyle: route.captionPolicy?.style || 'native_white_no_box',
      proofMustBeDeterministic: true,
      proofAudioPolicy: route.proofAudioPolicy,
      creatorSourcePolicy: route.creatorSourcePolicy || 'multi_clip',
    },
    providerMutations: 0,
  };

  const script = {
    schemaVersion: UGC_SCRIPT_SCHEMA_VERSION,
    id: `${unitId}-script`,
    recipeId: recipe.id,
    appName: source.appName || '',
    appMemorySnapshotId: source.appId || source.appName,
    hookPolicy: UGC_HOOK_POLICY,
    hookPlan: {
      schemaVersion: HOOK_PLAN_SCHEMA_VERSION,
      status: 'pending_intelligence',
      patternId: null,
      selectionIndex: unitIndex,
      providerMutations: 0,
    },
    hookQuality: {
      status: 'pending_intelligence',
      providerMutations: 0,
    },
    beats: [
      {
        beatId: 'hook',
        ...beatTiming.hook,
        dialogue: scriptLines.hook,
        claimRefs: [],
        proofAssetRefs: [],
        brandNameAllowed: false,
      },
      ...(route.recipeId === 'ugc_selfie_proof_reveal' ? [
        {
          beatId: 'tension',
          ...beatTiming.tension,
          dialogue: scriptLines.tension,
          claimRefs: [],
          proofAssetRefs: [],
          brandNameAllowed: false,
        },
        {
          beatId: 'bridge',
          ...beatTiming.bridge,
          dialogue: scriptLines.bridge,
          claimRefs: [],
          proofAssetRefs: [],
          brandNameAllowed: false,
        },
        {
          beatId: 'payload',
          ...beatTiming.payload,
          dialogue: scriptLines.payload,
          claimRefs: claim?.id ? [claim.id] : [],
          proofAssetRefs: (source.screens || []).slice(0, 3).map((screen) => screen.id),
          brandNameAllowed: false,
        },
      ] : []),
      {
        beatId: 'proof_voice',
        ...beatTiming.proof_voice,
        dialogue: route.recipeId === 'ugc_selfie_proof_reveal'
          ? scriptLines.proof
          : spokenLineForSegment('proof_voice', source, claim),
        claimRefs: claim?.id ? [claim.id] : [],
        proofAssetRefs: (source.screens || []).slice(0, 3).map((screen) => screen.id),
        brandNameAllowed: route.recipeId !== 'ugc_selfie_proof_reveal',
      },
      ...(route.recipeId === 'ugc_selfie_proof_reveal' ? [
        {
          beatId: 'reinforcement',
          ...beatTiming.reinforcement,
          dialogue: scriptLines.reinforcement,
          claimRefs: [],
          proofAssetRefs: [],
          brandNameAllowed: false,
        },
      ] : []),
      {
        beatId: 'reaction',
        ...beatTiming.reaction,
        dialogue: route.recipeId === 'ugc_selfie_proof_reveal'
          ? scriptLines.reaction
          : spokenLineForSegment('reaction', source, claim),
        claimRefs: [],
        proofAssetRefs: [],
        brandNameAllowed: true,
        maxSpokenSeconds: route.recipeId === 'ugc_selfie_proof_reveal' ? V6_REACTION_MAX_SPOKEN_SECONDS : null,
        mustCompleteBySeconds: route.recipeId === 'ugc_selfie_proof_reveal' ? beatTiming.reactionMustCompleteBySeconds : null,
        tailRoomSeconds: route.recipeId === 'ugc_selfie_proof_reveal' ? beatTiming.reactionTailRoomSeconds : null,
      },
    ].filter((beat) => route.segments.some((segment) => segmentCoversBeat(segment, beat.beatId))),
    flowPolicy: singleTake ? 'one_continuous_spoken_thought' : sharedFirstFrame ? 'multi_clip_shared_first_frame' : 'beat_locked_segments',
    providerMutations: 0,
  };

  const firstFrame = {
    positive: 'Pending evidence-bound Script Agent first-frame direction.',
    negative: 'Pending evidence-bound Script Agent negative prompt.',
  };
  const emotionPlan = {
    schemaVersion: UGC_EMOTION_PLAN_SCHEMA_VERSION,
    appCategory: category,
    proofType,
    source: 'pending_script_agent',
    userJob: 'pending_script_agent',
    audienceTension: 'pending_script_agent',
    desiredShift: 'pending_script_agent',
    emotionalArc: 'pending_script_agent',
    startingEmotion: 'pending_script_agent',
    endingEmotion: 'pending_script_agent',
    ugcFormat: scenario,
    creatorIdentity,
    visualContinuity,
    peakIntensity: null,
    firstFrame: {
      scenario,
      prompt: firstFrame.positive,
      negativePrompt: firstFrame.negative,
    },
    providerMutations: 0,
  };

  return {
    recipe,
    script,
    emotionPlan,
    proofWindow,
    creatorIdentity,
    visualContinuity,
    firstFramePrompt: firstFrame.positive,
    firstFrameNegativePrompt: firstFrame.negative,
    captions: {
      hook: '',
      reveal: `It's called ${shortName}`,
      proof: route.captionPolicy?.allowGenericProofCaption ? proofCaptionFor({ featureLine }) : '',
    },
    providerMutations: 0,
  };
}

function buildUgcCaptions({ unitId, route, plan, source, claim, durationSeconds }) {
  const featureLine = adHeadlineForClaim({ source, claim });
  if (route.recipeId === 'ugc_selfie_proof_reveal') {
    const hookBeat = (plan.script.beats || []).find((beat) => beat.beatId === 'hook');
    const reactionBeat = (plan.script.beats || []).find((beat) => beat.beatId === 'reaction');
    const tailRoom = Number(reactionBeat?.tailRoomSeconds || V6_REACTION_TAIL_ROOM_SECONDS);
    const singleTake = route.creatorSourcePolicy === 'single_take';
    const plannedRevealStart = singleTake
      ? Number(reactionBeat?.startSeconds || V6_REVEAL_CAPTION_START_SECONDS) + 0.15
      : V6_REVEAL_CAPTION_START_SECONDS;
    const plannedRevealEnd = singleTake
      ? Number(reactionBeat?.mustCompleteBySeconds || V6_REVEAL_CAPTION_END_SECONDS)
      : V6_REVEAL_CAPTION_END_SECONDS;
    const revealStart = Math.max(
      Number(reactionBeat?.startSeconds || V6_REVEAL_CAPTION_START_SECONDS),
      Math.min(durationSeconds - tailRoom - 1.2, plannedRevealStart),
    );
    const revealEnd = Math.min(
      durationSeconds - tailRoom,
      plannedRevealEnd,
      revealStart + 1.45,
    );
    return [
      { id: `${unitId}-caption-hook`, start: 0, end: Math.min(Number(hookBeat?.endSeconds || 3.4), 3.4), role: 'hook', text: plan.captions.hook, style: 'native_white_no_box' },
      { id: `${unitId}-caption-reveal`, start: round2(revealStart), end: round2(Math.max(revealStart + 0.6, revealEnd)), role: 'reveal', text: plan.captions.reveal, style: 'native_white_no_box' },
    ];
  }

  const proofStart = route.proofWindow?.startAt || 6;
  return [
    { id: `${unitId}-caption-hook`, start: 0, end: 3, role: 'hook', text: plan.captions.hook, style: 'native_white_no_box' },
    ...(route.captionPolicy?.allowGenericProofCaption ? [{
      id: `${unitId}-caption-proof`,
      start: proofStart + 1,
      end: Math.min(durationSeconds, proofStart + 6),
      role: 'proof',
      text: proofCaptionFor({ featureLine }),
      style: 'native_white_no_box',
    }] : []),
    { id: `${unitId}-caption-cta`, start: 12, end: durationSeconds, role: 'cta', text: `Try ${shortAppName(source.appName)}`, style: 'native_white_no_box' },
  ];
}

function sourceSearchText(source) {
  return [
    source?.appCategory,
    source?.appName,
    source?.appSummary,
    ...(source?.claims || []).map((claim) => claim.text),
    ...(source?.screens || []).flatMap((screen) => [screen.label, screen.detail]),
  ].filter(Boolean).join(' ');
}

function proofCaptionFor({ featureLine }) {
  return fitAdCopy(featureLine || 'Real app screen', 42);
}


export function buildJobCostPlan({ tasks, reservedCredits }) {
  return {
    currency: 'credits',
    reservedCredits: Number(reservedCredits) || 0,
    plannedCredits: tasks.reduce((total, task) => total + (Number(task.costUnits) || 0), 0),
    spentCredits: 0,
    perTask: tasks
      .filter((task) => Number(task.costUnits) > 0)
      .map((task) => ({ taskId: task.taskId, kind: task.kind, costUnits: task.costUnits })),
    providerMutations: 0,
  };
}

export function buildTaskQaReport({ job, task, targetTask, asset, createdAt }) {
  const outputType = targetTask.outputType;
  const media = asset
    ? {
      stubbed: asset.mode === 'local_mock',
      width: asset.width ?? null,
      height: asset.height ?? null,
      durationSeconds: asset.durationSeconds ?? null,
      bytes: asset.bytes ?? null,
      contentType: asset.contentType || null,
    }
    : { stubbed: true, width: null, height: null, durationSeconds: null, bytes: null, contentType: null };

  const claimId = targetTask.spec?.claimId || null;
  const claim = (job.source.claims || []).find((candidate) => candidate.id === claimId) || null;
  const source = job.source || {};
  const proofIds = outputType === 'ugc_ad'
    ? (targetTask.renderSpec?.timeline || []).filter((layer) => layer.type === 'proof_media').map((layer) => layer.proofId)
    : [targetTask.spec?.screenId].filter(Boolean);

  const checks = [
    {
      id: 'provider_mutations',
      label: 'Provider mutations',
      status: 'pass',
      detail: 'Generation recorded providerMutations=0.',
    },
    {
      id: 'asset_stored',
      label: 'Asset stored',
      status: asset?.storageKey ? 'pass' : 'hold',
      detail: asset?.storageKey ? `Output stored at a tenant-scoped key.` : 'No stored output asset for this task.',
    },
    {
      id: 'media_shape',
      label: outputType === 'image_ad' ? 'Dimensions' : 'Duration and dimensions',
      status: mediaShapeStatus(outputType, media, targetTask),
      detail: outputType === 'image_ad'
        ? `${media.width || '?'}x${media.height || '?'} px, ${media.bytes || '?'} bytes${media.stubbed ? ' (stubbed media placeholders)' : ''}.`
        : `${media.durationSeconds || '?'}s at ${targetTask.renderSpec?.fps || '?'}fps, ${media.width || '?'}x${media.height || '?'}${media.stubbed ? ' (stubbed media placeholders)' : ''}.`,
    },
    {
      id: 'proof_exists',
      label: 'Real app proof',
      status: proofIds.length ? 'pass' : 'hold',
      detail: proofIds.length ? `${proofIds.length} proof reference(s) from reviewed screenshots.` : 'No app screenshot proof is attached.',
    },
    {
      id: 'claim_support',
      label: 'Claim support',
      status: !claimId || claim ? 'pass' : 'hold',
      detail: claim
        ? `Copy is tied to a reviewed app feature: "${shortCaption(claim.text)}".`
        : claimId
          ? 'Referenced feature was removed from the reviewed app info.'
          : 'No feature claim referenced; generic copy only.',
    },
    {
      id: 'retry_budget',
      label: 'Retry budget',
      status: targetTask.attempts <= targetTask.maxAttempts ? 'pass' : 'retry',
      detail: `${targetTask.attempts} attempt(s) of ${targetTask.maxAttempts} allowed.`,
    },
  ];

  if (outputType === 'image_ad') {
    checks.push(...imageCreativeChecks({ targetTask, source }));
  }

  if (outputType === 'ugc_ad') {
    checks.push(...ugcRecipeChecks({ targetTask, claim, source }));
  }

  if (asset?.mediaValidation && asset.mediaValidation !== 'parsed') {
    checks.push({
      id: 'media_validation',
      label: 'Media validation',
      status: 'hold',
      detail: `Stored media could not be fully validated in this environment (${asset.mediaValidation}).`,
    });
  }

  const held = checks.some((check) => check.status === 'hold');
  const retry = !held && checks.some((check) => check.status === 'retry');
  return {
    reportId: `${task.taskId}-report`,
    jobId: job.jobId,
    packId: job.packId,
    orgId: job.orgId,
    workspaceId: job.workspaceId,
    appId: job.appId,
    taskId: task.taskId,
    targetTaskId: targetTask.taskId,
    outputType,
    verdict: held ? 'hold' : retry ? 'retry' : 'pass',
    checks,
    media,
    proofIds,
    claimSupport: claim ? [{ claimId: claim.id, text: claim.text, supported: claim.supported !== false }] : [],
    attempts: targetTask.attempts,
    costUnits: targetTask.costUnits || 0,
    providerMutations: 0,
    createdAt,
  };
}

function imageCreativeChecks({ targetTask, source }) {
  const timeline = targetTask.renderSpec?.timeline || [];
  const headline = timeline.find((layer) => layer.type === 'caption' && layer.role === 'headline')?.text || '';
  const cta = timeline.find((layer) => layer.type === 'cta')?.text || '';
  const shortName = shortAppName(source.appName || '');
  const headlineComplete = isCompleteAdCopy(headline) && !isMarketingFiller(headline, { appName: source.appName || 'this app' });
  const ctaComplete = isCompleteAdCopy(cta) && (!shortName || cta.toLowerCase().includes(shortName.toLowerCase()));

  return [
    {
      id: 'image_headline_complete',
      label: 'Complete image headline',
      status: headlineComplete ? 'pass' : 'hold',
      detail: headlineComplete
        ? `Headline is a complete ad phrase: "${headline}".`
        : `Headline is incomplete, generic, or truncated: "${headline || 'missing'}".`,
    },
    {
      id: 'image_cta_complete',
      label: 'Complete image CTA',
      status: ctaComplete ? 'pass' : 'hold',
      detail: ctaComplete
        ? `CTA uses the customer-facing app name: "${cta}".`
        : `CTA is missing or does not use the customer-facing app name: "${cta || 'missing'}".`,
    },
  ];
}

function ugcRecipeChecks({ targetTask, claim, source = {} }) {
  const spec = targetTask.renderSpec || {};
  const timeline = spec.timeline || [];
  const recipe = spec.recipe || {};
  const constraints = recipe.constraints || {};
  const script = spec.script || {};
  const proofLayers = timeline.filter((layer) => layer.type === 'proof_media');
  const creatorLayers = timeline.filter((layer) => layer.type === 'creator_video');
  const proofVoiceLayers = creatorLayers.filter((layer) => layer.role === 'proof_voice' || layer.role === 'single_take');
  const captionLayers = timeline.filter((layer) => layer.type === 'caption');
  const hookCaptionLayer = captionLayers.find((layer) => layer.role === 'hook');
  const ctaLayers = timeline.filter((layer) => layer.type === 'cta');
  const shortName = shortAppName(script.appName || targetTask.appName || '');
  const hookBeat = (script.beats || []).find((beat) => beat.beatId === 'hook');
  const proofBeat = (script.beats || []).find((beat) => beat.beatId === 'proof_voice');
  const reactionBeat = (script.beats || []).find((beat) => beat.beatId === 'reaction');
  const hookHasClaim = Boolean(hookBeat?.claimRefs?.length);
  const hasCreatorIdentity = Boolean(recipe.creatorContinuity?.description || spec.emotionPlan?.creatorIdentity?.description);
  const renderDuration = Number(spec.durationSeconds || UGC_RENDER_DEFAULTS.durationSeconds);
  const revealCaptionLayer = captionLayers.find((layer) => layer.role === 'reveal');
  const revealCaptionEnd = revealCaptionLayer ? revealCaptionLayer.start + revealCaptionLayer.duration : null;
  const reactionEnd = Number(reactionBeat?.endSeconds || renderDuration);
  const reactionTailRoom = reactionBeat?.mustCompleteBySeconds
    ? reactionEnd - Number(reactionBeat.mustCompleteBySeconds)
    : Number(reactionBeat?.tailRoomSeconds || 0);

  const proofOverlapsVoice = proofLayers.some((proof) => proofVoiceLayers.some((voice) => rangesOverlap(
    proof.start,
    proof.start + proof.duration,
    voice.start,
    voice.start + voice.duration,
  )));
  const hasGenericProofCaption = captionLayers.some((layer) => /real app screens|not mockups/i.test(layer.text || ''));
  const noCtaRequired = constraints.allowCtaCard === false || spec.renderManifest?.noCtaCard === true;
  const requiresOrganicSelfieChecks = recipe.id === 'ugc_selfie_proof_reveal' || spec.renderManifest?.recipeId === 'ugc_selfie_proof_reveal';
  const proofSourceStrength = proofSourceStrengthStatus(proofLayers);
  const hookQuality = script.hookQuality || {};
  const hookSpecific = semanticHookQualityPassed(hookQuality);
  const hookCaptionSharp = hookSpecific
    && Boolean(String(hookCaptionLayer?.text || '').trim())
    && String(hookCaptionLayer?.text || '').length <= UGC_HOOK_POLICY.maxCaptionCharacters;
  const hookCaptionStartsOnFirstFrame = Boolean(hookCaptionLayer) && safeNumber(hookCaptionLayer.start) === 0;
  const hookSelectionIntegrity = hookSelectionIntegrityStatus({ script, hookBeat, hookCaptionLayer });
  const hookEvidenceSupport = hookEvidenceSupportStatus({ source, hookPlan: script.hookPlan, unitBinding: script.hookPlan?.unitBinding || null });
  const scriptPlan = script.scriptPlan || {};
  const scriptPlanIntegrity = Boolean(
    scriptPlan.status === 'selected'
    && scriptPlan.taskId
    && scriptPlan.planId
    && scriptPlan.planFingerprint
    && scriptPlan.requestFingerprint
    && scriptPlan.sourceFingerprint
    && scriptPlan.hookPlanFingerprint === script.hookPlan?.planFingerprint
    && scriptPlan.scriptFingerprint
    && scriptPlan.selectionHash
    && scriptPlan.critic?.verdict === 'pass'
    && Number(scriptPlan.critic?.hookContinuity) === 5
    && Number(scriptPlan.critic?.evidenceAlignment) === 5
    && Number(scriptPlan.critic?.claimSafety) === 5
    && !(scriptPlan.critic?.unsupportedSpans || []).length
    && scriptPlan.evidenceVerification?.verdict === 'pass'
  );
  const hookPolicyLocked = script.hookPolicy?.format === UGC_HOOK_POLICY.format
    && script.hookPolicy?.requirePlainLanguageWithoutAppContext === true
    && script.hookPolicy?.requireConcreteBehavior === true
    && script.hookPolicy?.requireConcreteFailure === true;
  const proofLayerBindings = proofLayerBindingStatus({ proofLayers, script });
  const proofLayerStacking = proofLayerStackingStatus({ timeline, proofLayers, creatorLayers });
  const omittedProofIds = Array.isArray(spec.renderManifest?.omittedUnreferencedProofIds)
    ? spec.renderManifest.omittedUnreferencedProofIds.filter(Boolean)
    : [];
  const proofAligned = scriptPlanIntegrity && Number(scriptPlan.critic?.proofAlignment) >= 4 && proofLayerBindings.status === 'pass';
  const finalActionStrong = scriptPlanIntegrity
    && Number(scriptPlan.critic?.arcStrength) >= 4
    && Boolean(shortName && String(reactionBeat?.dialogue || '').toLowerCase().includes(shortName.toLowerCase()));
  const sharedFirstFrame = spec.renderManifest?.sharedFirstFrame || null;
  const sharedFirstFrameSource = spec.renderManifest?.creatorSourcePolicy === 'multi_clip_shared_first_frame'
    && Boolean(sharedFirstFrame?.taskId)
    && creatorLayers.length >= 2
    && ['hook', 'proof_voice', 'reaction'].every((role) => creatorLayers.some((layer) => layer.role === role));
  const continuityContract = Boolean(
    recipe.creatorContinuity?.visualContinuity
    || spec.renderManifest?.visualContinuity
    || spec.emotionPlan?.visualContinuity,
  );
  const dialogueFlow = dialogueFlowIsPunchy(script.beats || [], scriptPlan);
  const creatorSpeechFit = creatorSpeechFitStatus({ creatorLayers, script });
  const revealHasTailRoom = Boolean(
    reactionBeat
    && reactionEnd <= renderDuration + 0.05
    && reactionTailRoom >= 0.5
    && reactionBeat.mustCompleteBySeconds <= renderDuration - 0.5
    && revealCaptionLayer?.start < reactionEnd
    && revealCaptionEnd <= renderDuration - 0.5
  );
  const specificTermSupport = specificTermSupportStatus({ source, script, captionLayers });

  const checks = [
    {
      id: 'recipe_contract',
      label: 'UGC recipe contract',
      status: recipe.id ? 'pass' : 'hold',
      detail: recipe.id ? `Recipe ${recipe.id} is stamped on the render manifest.` : 'No recipe is stamped on the render manifest.',
    },
    {
      id: 'script_locked',
      label: 'Locked script',
      status: script.id && (script.beats || []).length ? 'pass' : 'hold',
      detail: script.id ? `Script ${script.id} is locked before render.` : 'No locked script is attached to this render.',
    },
    {
      id: 'hook_policy_locked',
      label: 'Sharp-hook contract',
      status: hookPolicyLocked ? 'pass' : 'hold',
      detail: hookPolicyLocked
        ? 'The script locks the target-behavior → concrete-failure hook contract before generation.'
        : 'The script is missing the plain-language sharp-hook contract.',
    },
    {
      id: 'creative_hook_specificity',
      label: 'Sharp spoken UGC hook',
      status: hookSpecific ? 'pass' : 'hold',
      detail: hookSpecific
        ? `Writer, blind reader, and evidence critic approved the hook: "${shortCaption(hookBeat?.dialogue || '')}".`
        : `Hook is missing a passing blind-reader/evidence-critic verdict: ${hookQuality.reason || 'semantic scores are below threshold'}.`,
    },
    {
      id: 'hook_caption_sharpness',
      label: 'Sharp hook caption',
      status: hookCaptionSharp ? 'pass' : 'hold',
      detail: hookCaptionSharp
        ? `Hook caption creates a compact curiosity gap: "${shortCaption(hookCaptionLayer?.text || '')}".`
        : 'Hook caption is missing, too long, or not backed by a passing semantic hook plan.',
    },
    {
      id: 'hook_caption_first_frame',
      label: 'Hook caption first frame',
      status: hookCaptionStartsOnFirstFrame ? 'pass' : 'hold',
      detail: hookCaptionStartsOnFirstFrame
        ? 'The hook caption is visible from frame zero.'
        : `The hook caption starts at ${safeNumber(hookCaptionLayer?.start).toFixed(2)}s instead of frame zero.`,
    },
    {
      id: 'hook_selection_integrity',
      label: 'Hook selection integrity',
      status: hookSelectionIntegrity.status,
      detail: hookSelectionIntegrity.detail,
    },
    {
      id: 'hook_evidence_refs',
      label: 'Hook evidence references',
      status: hookEvidenceSupport.status,
      detail: hookEvidenceSupport.detail,
    },
    {
      id: 'script_plan_integrity',
      label: 'Evidence-bound Script Agent plan',
      status: scriptPlanIntegrity ? 'pass' : 'hold',
      detail: scriptPlanIntegrity
        ? 'Every post-hook beat and creator framing decision remains bound to the selected immutable Script Agent plan.'
        : 'The UGC script is missing a selected evidence-bound Script Agent plan or its integrity fields.',
    },
  ];

  if (!requiresOrganicSelfieChecks) return checks;

  return [
    ...checks,
    {
      id: 'proof_under_voiceover',
      label: 'Proof under creator voice',
      status: proofLayers.length && proofVoiceLayers.length && proofOverlapsVoice ? 'pass' : 'hold',
      detail: proofOverlapsVoice
        ? 'Real app proof overlaps the creator proof-voice beat so dialogue can continue underneath.'
        : 'Proof is not timed under a creator proof-voice beat.',
    },
    {
      id: 'creator_identity_locked',
      label: 'Creator continuity',
      status: hasCreatorIdentity ? 'pass' : 'hold',
      detail: hasCreatorIdentity
        ? 'A stable creator identity is locked before source generation.'
        : 'No stable creator identity is attached to the V6 recipe.',
    },
    {
      id: 'shared_first_frame_source',
      label: 'Shared first-frame source',
      status: sharedFirstFrameSource ? 'pass' : 'hold',
      detail: sharedFirstFrameSource
        ? 'Every V6 creator block is generated from the same stored first-frame image, with hook, proof, and reaction kept as separate clips.'
        : 'V6 creator blocks are missing the shared first-frame image anchor needed to control identity, setting, and prop drift.',
    },
    {
      id: 'visible_continuity_contract',
      label: 'Visible continuity contract',
      status: continuityContract ? 'pass' : 'hold',
      detail: continuityContract
        ? 'The render manifest carries locked visual continuity instructions for creator identity, setting, and stable props.'
        : 'No visible-continuity contract is attached to the creator generation plan.',
    },
    {
      id: 'dialogue_flow_punchy',
      label: 'Dialogue flow',
      status: dialogueFlow.ok ? 'pass' : 'hold',
      detail: dialogueFlow.detail,
    },
    {
      id: 'creator_speech_fit',
      label: 'Creator speech fit',
      status: creatorSpeechFit.status,
      detail: creatorSpeechFit.detail,
    },
    {
      id: 'organic_caption_style',
      label: 'Organic caption style',
      status: spec.captionStyle === 'native_white_no_box' && captionLayers.every((layer) => layer.style === 'native_white_no_box') ? 'pass' : 'hold',
      detail: spec.captionStyle === 'native_white_no_box'
        ? 'Captions use native white social text without boxed styling.'
        : 'Caption style is not the organic selfie style.',
    },
    {
      id: 'no_generic_proof_caption',
      label: 'No generic proof caption',
      status: hasGenericProofCaption ? 'hold' : 'pass',
      detail: hasGenericProofCaption ? 'Generic proof caption text is present.' : 'No generic proof caption text is present.',
    },
    {
      id: 'organic_no_cta_card',
      label: 'Organic CTA policy',
      status: noCtaRequired ? (ctaLayers.length ? 'hold' : 'pass') : 'pass',
      detail: noCtaRequired
        ? (ctaLayers.length ? 'CTA card/pill is present even though this recipe forbids it.' : 'No CTA card/pill is present for this organic recipe.')
        : 'Recipe allows a CTA layer.',
    },
    {
      id: 'brand_reveal_policy',
      label: 'Brand reveal policy',
      status: !hookHasClaim ? 'pass' : 'hold',
      detail: hookHasClaim
        ? 'Hook beat is tied to a claim; V6 hooks should stay brand-free and proof-free.'
        : `Hook beat stays separate from product proof${shortName ? ` for ${shortName}` : ''}.`,
    },
    {
      id: 'specific_term_support',
      label: 'Specific term support',
      status: specificTermSupport.status,
      detail: specificTermSupport.detail,
    },
    {
      id: 'reveal_tail_room',
      label: 'Reveal tail room',
      status: revealHasTailRoom ? 'pass' : 'hold',
      detail: revealHasTailRoom
        ? 'The final beat must finish the full app-name reveal before the render endpoint and leave natural tail room.'
        : 'The final beat or reveal caption is too close to the render endpoint.',
    },
    {
      id: 'claim_to_proof_line',
      label: 'Claim proof line',
      status: !claim || (script.beats || []).some((beat) => beat.beatId === 'proof_voice' && (beat.claimRefs || []).includes(claim.id)) ? 'pass' : 'hold',
      detail: claim
        ? 'The verified claim is mapped to the spoken proof beat.'
        : 'No claim was selected for this route.',
    },
    {
      id: 'proof_line_alignment',
      label: 'Proof line alignment',
      status: proofAligned ? 'pass' : 'hold',
      detail: proofAligned
        ? proofLayerBindings.detail
        : `${proofLayerBindings.detail} Script critic proof alignment: ${Number(scriptPlan.critic?.proofAlignment) || 0}/5.`,
    },
    {
      id: 'proof_inventory_coverage',
      label: 'Selected proof coverage',
      status: omittedProofIds.length ? 'hold' : 'pass',
      detail: omittedProofIds.length
        ? `Selected screenshots were omitted from the visible script beats: ${omittedProofIds.join(', ')}.`
        : 'Every screenshot selected for this ad is bound to a matching visible script beat.',
    },
    {
      id: 'proof_layer_stacking',
      label: 'Proof layer visibility',
      status: proofLayerStacking.status,
      detail: proofLayerStacking.detail,
    },
    {
      id: 'final_action_strength',
      label: 'Final action strength',
      status: finalActionStrong ? 'pass' : 'hold',
      detail: finalActionStrong
        ? `Final line has a clear organic action after the reveal: "${shortCaption(reactionBeat?.dialogue || '')}".`
        : `Final line needs a stronger action than a bare app reveal: "${shortCaption(reactionBeat?.dialogue || '')}".`,
    },
    {
      id: 'proof_source_strength',
      label: 'Proof source strength',
      status: proofSourceStrength.status,
      detail: proofSourceStrength.detail,
    },
  ];
}

function proofLayerBindingStatus({ proofLayers = [], script = {} } = {}) {
  if (!proofLayers.length) return { status: 'hold', detail: 'No proof layers are bound to spoken beats.' };
  const beats = new Map((script.beats || []).map((beat) => [beat.beatId, beat]));
  const problems = [];
  for (const layer of proofLayers) {
    const beat = beats.get(layer.proofBeatId);
    const refs = beat?.evidenceRefs || [];
    const lineMatches = cleanSpokenLine(layer.proofLine) === cleanSpokenLine(beat?.dialogue);
    const timingMatches = beat && rangesOverlap(
      safeNumber(layer.start),
      safeNumber(layer.start) + positiveDuration(layer.duration),
      safeNumber(beat.startSeconds),
      safeNumber(beat.endSeconds),
    );
    if (!layer.proofId || !beat || !refs.includes(layer.proofId) || !lineMatches || !timingMatches) {
      problems.push(layer.proofId || layer.id || 'unknown proof');
    }
  }
  return problems.length
    ? { status: 'hold', detail: `Proof layers are not deterministically bound to matching cited beats: ${problems.join(', ')}.` }
    : { status: 'pass', detail: `${proofLayers.length} proof layer(s) use the exact spoken beat that cites each screenshot and overlap that beat.` };
}

function creatorSpeechFitStatus({ creatorLayers = [], script = {} } = {}) {
  const problems = [];
  const rates = [];
  for (const layer of creatorLayers) {
    const start = safeNumber(layer.start);
    const end = start + positiveDuration(layer.duration);
    const beats = (script.beats || []).filter((beat) => rangesOverlap(
      start,
      end,
      safeNumber(beat.startSeconds),
      safeNumber(beat.endSeconds),
    ));
    const words = beats.reduce((total, beat) => total + String(beat.dialogue || '').trim().split(/\s+/).filter(Boolean).length, 0);
    const duration = positiveDuration(layer.duration);
    const rate = duration ? words / duration : Infinity;
    rates.push(`${layer.role || layer.id}: ${rate.toFixed(2)} words/s`);
    if (!Number.isFinite(rate) || rate > 3) problems.push(layer.role || layer.id || 'creator segment');
  }
  return problems.length
    ? { status: 'hold', detail: `Creator dialogue is too dense to finish naturally in: ${problems.join(', ')} (${rates.join('; ')}).` }
    : { status: 'pass', detail: `Every creator block stays at or below 3.00 spoken words/s (${rates.join('; ')}).` };
}

function proofLayerStackingStatus({ timeline = [], proofLayers = [], creatorLayers = [] } = {}) {
  if (!proofLayers.length) return { status: 'hold', detail: 'No proof layers are available for visibility checks.' };
  const hidden = proofLayers.filter((proof) => {
    const proofIndex = timeline.indexOf(proof);
    return creatorLayers.some((creator) => (
      rangesOverlap(
        safeNumber(proof.start),
        safeNumber(proof.start) + (positiveDuration(proof.duration) || 0),
        safeNumber(creator.start),
        safeNumber(creator.start) + (positiveDuration(creator.duration) || 0),
      )
      && timeline.indexOf(creator) > proofIndex
    ));
  });
  return hidden.length
    ? { status: 'hold', detail: `${hidden.length} proof layer(s) are ordered underneath an overlapping creator video and would be invisible.` }
    : { status: 'pass', detail: `${proofLayers.length} proof layer(s) are ordered above every overlapping creator video.` };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function semanticHookQualityPassed(quality = {}) {
  const coldRead = quality.coldRead || {};
  return Boolean(
    quality.status === 'pass'
    && quality.semanticCriticStatus === 'pass'
    && Number(quality.topicClarity) >= 4
    && Number(quality.concreteTension) >= 4
    && Number(quality.curiosity) >= 3
    && Number(quality.nativeVoice) >= 4
    && Number(quality.claimSafety) === 5
    && quality.topicMatchesEvidence === true
    && Array.isArray(quality.supportedEvidenceRefs)
    && quality.supportedEvidenceRefs.length > 0
    && Array.isArray(quality.unsupportedSpans)
    && quality.unsupportedSpans.length === 0
    && quality.duplicateClusterId
    && Number(coldRead.topicConfidence) >= 0.85
    && coldRead.inferredTopic
    && coldRead.behaviorOrSituation
    && coldRead.tensionOrConsequence
    && !(coldRead.unexplainedTerms || []).length
  );
}

function hookSelectionIntegrityStatus({ script = {}, hookBeat, hookCaptionLayer } = {}) {
  const plan = script.hookPlan || {};
  const spokenHook = String(hookBeat?.dialogue || '').trim();
  const caption = String(hookCaptionLayer?.text || '').trim();
  const spokenWords = wordCount(spokenHook);
  const expectedHash = stableHash(JSON.stringify({
    planFingerprint: plan.planFingerprint,
    requestFingerprint: plan.requestFingerprint,
    sourceFingerprint: plan.sourceFingerprint,
    unitBinding: plan.unitBinding,
    candidateId: plan.candidateId,
    spokenHook,
    caption,
    targetBehavior: plan.targetBehavior || null,
    tension: plan.tension || null,
    evidenceRefs: plan.evidenceRefs,
    critic: plan.critic,
    coldRead: plan.coldRead || null,
  }));
  const valid = Boolean(
    plan.status === 'selected'
    && plan.taskId
    && plan.planId
    && plan.planFingerprint
    && plan.requestFingerprint
    && plan.sourceFingerprint
    && plan.candidateId
    && plan.selectionHash
    && plan.selectionHash === script.hookQuality?.selectionHash
    && plan.selectionHash === expectedHash
    && spokenWords >= UGC_HOOK_POLICY.minSpokenWords
    && spokenWords <= UGC_HOOK_POLICY.maxSpokenWords
    && caption
    && caption.length <= UGC_HOOK_POLICY.maxCaptionCharacters
  );
  return {
    status: valid ? 'pass' : 'hold',
    detail: valid
      ? 'Selected hook copy, caption, semantic verdict, and audit hash are intact from planning through render.'
      : 'Hook copy/caption no longer matches the critic-approved planning artifact or deterministic format limits.',
  };
}

function hookEvidenceSupportStatus({ source = {}, hookPlan = {}, unitBinding = null } = {}) {
  const validIds = new Set([
    ...(source.appSummary ? ['app_summary'] : []),
    ...(source.claims || []).map((claim) => claim.id),
    ...(source.screens || []).map((screen) => screen.id),
    ...(source.angles || []).map((angle) => angle.id),
  ].filter(Boolean));
  const refs = Array.isArray(hookPlan.evidenceRefs) ? hookPlan.evidenceRefs : [];
  const invalid = refs.filter((ref) => !validIds.has(ref));
  const bindingIds = new Set([
    'app_summary',
    unitBinding?.claimId,
    ...(unitBinding?.proofIds || []),
  ].filter(Boolean));
  const criticRefs = Array.isArray(hookPlan.critic?.supportedEvidenceRefs) ? hookPlan.critic.supportedEvidenceRefs : [];
  const invalidCriticRefs = criticRefs.filter((ref) => !validIds.has(ref));
  const criticMatchesUnit = !unitBinding || criticRefs.some((ref) => bindingIds.has(ref));
  const pass = refs.length > 0
    && invalid.length === 0
    && criticRefs.length > 0
    && invalidCriticRefs.length === 0
    && criticMatchesUnit;
  return {
    status: pass ? 'pass' : 'hold',
    detail: pass
      ? `Hook cites reviewed evidence aligned to its assigned ad unit: ${refs.join(', ')}.`
      : `Hook evidence is missing, stale, critic-unsupported, or not aligned to its assigned claim/screens (invalid: ${[...invalid, ...invalidCriticRefs].join(', ') || 'none'}).`,
  };
}

export function evaluateUgcHook({ dialogue, caption = null, appName = '', semanticQuality = null } = {}) {
  const spoken = String(dialogue || '').replace(/\s+/g, ' ').trim();
  const dialogueIssues = [];
  const spokenWords = wordCount(spoken);

  if (!spoken) dialogueIssues.push('The spoken hook is missing.');
  if (spokenWords < UGC_HOOK_POLICY.minSpokenWords || spokenWords > UGC_HOOK_POLICY.maxSpokenWords) {
    dialogueIssues.push(`Keep the spoken hook between ${UGC_HOOK_POLICY.minSpokenWords}-${UGC_HOOK_POLICY.maxSpokenWords} words; it has ${spokenWords}.`);
  }
  if (/^(hey|what'?s up|introducing|download|try|check out)\b/i.test(spoken)) {
    dialogueIssues.push('The spoken hook starts like an ad, greeting, or CTA.');
  }
  if (explicitHookBrandCue(spoken, appName)) {
    dialogueIssues.push('Keep the brand name out of the hook.');
  }
  if (!semanticHookQualityPassed(semanticQuality || {})) {
    dialogueIssues.push('The hook is missing the passing blind-reader and evidence-critic verdict.');
  }

  const captionIssues = [];
  const rawCaption = caption === null ? null : String(caption || '').replace(/\s+/g, ' ').trim();
  if (rawCaption !== null) {
    if (!rawCaption) captionIssues.push('The hook caption is missing.');
    if (rawCaption.length > UGC_HOOK_POLICY.maxCaptionCharacters) {
      captionIssues.push(`Keep the hook caption at ${UGC_HOOK_POLICY.maxCaptionCharacters} characters or fewer.`);
    }
    if (/\bwatch this\b/i.test(rawCaption)) {
      captionIssues.push('Replace generic “watch this” targeting with a specific tension or question.');
    }
    if (explicitHookBrandCue(rawCaption, appName)) {
      captionIssues.push('Keep the brand name out of the hook caption.');
    }
  }

  return {
    status: dialogueIssues.length || captionIssues.length ? 'hold' : 'pass',
    dialogueStatus: dialogueIssues.length ? 'hold' : 'pass',
    captionStatus: captionIssues.length ? 'hold' : 'pass',
    dialogueIssues,
    captionIssues,
    spokenWordCount: spokenWords,
    captionCharacterCount: rawCaption?.length || 0,
    policy: UGC_HOOK_POLICY,
  };
}

export function assertUgcHookPreflight(input = {}) {
  const quality = evaluateUgcHook(input);
  if (quality.status === 'hold') {
    const issues = [...quality.dialogueIssues, ...quality.captionIssues].join(' ');
    throw new Error(`UGC hook failed the pre-generation quality gate: ${issues}`);
  }
  return quality;
}

function explicitHookBrandCue(text, appName) {
  const shortName = shortAppName(appName);
  if (!text || !shortName || shortName.toLowerCase() === 'this app') return false;
  const escaped = escapeRegExp(shortName);
  return new RegExp(`\\b(?:called|downloaded|download|found|using|use|open|app(?:\\s+called)?)\\s+(?:the\\s+)?${escaped}\\b`, 'i').test(String(text));
}

function proofLineIsAligned(line, { claim, source = {}, proofLayers = [] } = {}) {
  const cleaned = String(line || '').toLowerCase();
  if (!cleaned || /right on the screen instead of making me guess|look:/i.test(cleaned)) return false;
  const anchors = proofAnchors({ claim, source, proofLayers });
  const matched = anchors.filter((anchor) => cleaned.includes(anchor));
  const strongSingle = ['spending', 'breakdown', 'result', 'history', 'routine', 'lesson', 'mistake', 'workout', 'training', 'details', 'plan', 'exercise', 'log', 'recovery'];
  return matched.length >= 2 || matched.some((anchor) => strongSingle.includes(anchor));
}

function finalActionIsStrong(line, { shortName = '' } = {}) {
  const cleaned = String(line || '').toLowerCase();
  if (!cleaned) return false;
  const appMentioned = !shortName || cleaned.includes(shortName.toLowerCase());
  const action = /\b(go|find|check|try|use|open|scan|fix|train|review|download|start|save|make|keep|keeping|watch|see)\b/.test(cleaned);
  const bareReveal = /^it'?s called\s+[\w\s]+$/i.test(cleanAdText(line));
  return appMentioned && action && !bareReveal;
}

function dialogueFlowIsPunchy(beats = [], scriptPlan = {}) {
  const required = ['hook', 'tension', 'bridge', 'payload', 'proof_voice', 'reinforcement', 'reaction'];
  const present = required.map((beatId) => beats.find((beat) => beat.beatId === beatId));
  if (present.some((beat) => !beat?.dialogue)) {
    return { ok: false, detail: 'The V6 dialogue is missing the full hook, tension, bridge, payload, proof, reinforcement, and CTA arc.' };
  }
  const wordCounts = present.map((beat) => wordCount(beat.dialogue));
  const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
  const tooLongIndex = wordCounts.findIndex((count) => count > SCRIPT_MAX_WORDS_PER_BEAT);
  if (totalWords < SCRIPT_MIN_TOTAL_WORDS || totalWords > SCRIPT_MAX_TOTAL_WORDS || tooLongIndex >= 0) {
    return {
      ok: false,
      detail: `Dialogue does not fit the cold-traffic UGC arc (${wordCounts.join('/')} words by beat, ${totalWords} total; target ${SCRIPT_MIN_TOTAL_WORDS}-${SCRIPT_MAX_TOTAL_WORDS} with no beat over ${SCRIPT_MAX_WORDS_PER_BEAT}).`,
    };
  }
  const critic = scriptPlan.critic || {};
  const criticPassed = scriptPlan.status === 'selected'
    && critic.verdict === 'pass'
    && Number(critic.topicCoherence) >= 4
    && Number(critic.evidenceAlignment) === 5
    && Number(critic.proofAlignment) >= 4
    && Number(critic.nativeVoice) >= 4
    && Number(critic.arcStrength) >= 4
    && Number(critic.claimSafety) === 5
    && !(critic.unsupportedSpans || []).length;
  if (!criticPassed) {
    return {
      ok: false,
      detail: 'Dialogue has not cleared the independent evidence-bound Script Agent critic for topic coherence, proof alignment, native voice, arc strength, and claim safety.',
    };
  }
  return {
    ok: true,
    detail: `Dialogue follows a cold-traffic UGC arc (${wordCounts.join('/')} words by beat, ${totalWords} total).`,
  };
}

function wordCount(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function proofSourceStrengthStatus(proofLayers) {
  if (!proofLayers.length) {
    return { status: 'hold', detail: 'No proof layers are attached to the UGC render.' };
  }
  const strongTypes = new Set(['raw_app_proof', 'app_screenshot', 'screen_recording', 'first_party_capture', 'user_upload', 'rawified_store_art']);
  const hasStrongProof = proofLayers.some((layer) => (
    strongTypes.has(String(layer.sourceType || '').toLowerCase())
    || /raw|first.party|uploaded|screen.recording|app.screen/i.test(String(layer.trustLevel || ''))
  ));
  if (hasStrongProof) {
    return { status: 'pass', detail: 'At least one proof layer is raw, uploaded, or first-party app proof.' };
  }
  const allStoreArt = proofLayers.every((layer) => !layer.sourceType || String(layer.sourceType).toLowerCase() === 'store_art');
  return {
    status: allStoreArt ? 'hold' : 'pass',
    detail: allStoreArt
      ? 'UGC proof only uses store listing art; rawify eligible listing art before UI extraction, or use uploaded/captured raw app proof before marking it ready.'
      : 'Proof layers include non-store app proof sources.',
  };
}

function specificTermSupportStatus({ source = {}, script = {}, captionLayers = [] } = {}) {
  const text = [
    ...(script.beats || []).map((beat) => beat.dialogue),
    ...captionLayers.map((layer) => layer.text),
  ].filter(Boolean).join(' ');
  const terms = extractSpecificTerms(text);
  if (!terms.length) {
    return { status: 'pass', detail: 'Script/captions avoid unsupported named mechanics or acronyms.' };
  }
  const sourceText = normalizeTerm(`${sourceSearchText(source)} ${source.appName || ''}`);
  const appName = normalizeTerm(source.appName || '');
  const shortName = normalizeTerm(shortAppName(source.appName || ''));
  const unsupported = terms.filter((term) => {
    const normalized = normalizeTerm(term);
    return normalized
      && normalized !== appName
      && normalized !== shortName
      && !sourceText.includes(normalized);
  });
  if (!unsupported.length) {
    return { status: 'pass', detail: `Specific terms are supported by reviewed app info: ${terms.join(', ')}.` };
  }
  return {
    status: 'hold',
    detail: `Script/captions use specific term(s) not found in reviewed app info: ${unsupported.join(', ')}.`,
  };
}

function extractSpecificTerms(text) {
  const matches = String(text || '').match(/\b[A-Z][A-Za-z0-9]+-[A-Za-z0-9-]+\b|\b[A-Z0-9]{2,}\b/g) || [];
  return [...new Set(matches.map((term) => term.trim()).filter(Boolean))];
}

function normalizeTerm(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function proofAnchors({ claim, source = {}, proofLayers = [] } = {}) {
  const text = `${sourceSearchText(source)} ${claim?.text || ''} ${proofLayers.map((layer) => `${layer.label || ''} ${layer.detail || ''}`).join(' ')}`.toLowerCase();
  const anchorGroups = [
    ['rank', /\brank|ranked|ranking\b/],
    ['xp', /\bxp|experience\b/],
    ['level', /\blevel|level up\b/],
    ['quest', /\bquest|challenge\b/],
    ['muscle', /\bmuscle|legs|chest|back|arms|shoulders\b/],
    ['progress', /\bprogress|track|training|workout\b/],
    ['exercise', /\bexercise|set|sets|reps|weight\b/],
    ['log', /\blog|logged|logging|history|record\b/],
    ['recovery', /\brecovery|recovered|fresh|ready\b/],
    ['spending', /\bspend|spending|expense|budget|money\b/],
    ['breakdown', /\bbreakdown|category|categories\b/],
    ['result', /\bresult|output|generated|before|after\b/],
    ['history', /\bhistory|log|record\b/],
    ['routine', /\broutine|habit|daily|reminder|task\b/],
    ['details', /\bdetail|details|screen|screens|info|information\b/],
    ['plan', /\bplan|planner|next step|next workout\b/],
    ['lesson', /\blesson|study|learn|quiz\b/],
    ['mistake', /\bmistake|wrong|fix|correction\b/],
    ['dashboard', /\bdashboard|overview|summary\b/],
  ];
  const anchors = anchorGroups.filter(([, pattern]) => pattern.test(text)).map(([anchor]) => anchor);
  return [...new Set(anchors)];
}

export function buildDraftRecord({ job, targetTask, asset, qaReport, createdAt }) {
  const format = targetTask.outputType === 'image_ad' ? 'image_ad' : 'ugc_ad';
  return {
    draftId: `${targetTask.taskId}-draft`,
    jobId: job.jobId,
    packId: job.packId,
    orgId: job.orgId,
    workspaceId: job.workspaceId,
    appId: job.appId,
    format,
    caption: format === 'image_ad' ? targetTask.spec?.headline || '' : targetTask.spec?.caption || '',
    angleId: targetTask.spec?.angleId || null,
    angleLabel: targetTask.spec?.angleLabel || null,
    packPlanAssignmentId: targetTask.spec?.packPlanAssignmentId || null,
    screenId: targetTask.spec?.screenId || null,
    assetId: asset?.assetId || null,
    storageKey: asset?.storageKey || null,
    status: qaReport.verdict === 'pass' ? 'ready_for_review' : 'held',
    qa: { reportId: qaReport.reportId, verdict: qaReport.verdict },
    providerMutations: 0,
    createdAt,
  };
}

export function jobProgress(job) {
  const tasks = job.tasks || [];
  const total = tasks.length;
  const done = tasks.filter((task) => TERMINAL_TASK_STATUSES.includes(task.status)).length;
  const failed = tasks.filter((task) => task.status === 'failed').length;
  const running = tasks.filter((task) => task.status === 'running').length;
  return {
    totalTasks: total,
    completedTasks: done,
    failedTasks: failed,
    runningTasks: running,
    percent: total ? Math.round((done / total) * 100) : 0,
    phase: phaseLabel(job, tasks),
    providerMutations: 0,
  };
}

function phaseLabel(job, tasks) {
  if (TERMINAL_JOB_STATUSES.includes(job.status)) return 'Done';
  const active = tasks.find((task) => task.status === 'running')
    || tasks.find((task) => task.status === 'queued');
  if (!active) return 'Packaging drafts';
  if (active.kind === 'generation' && active.outputType === 'image_ad_source') return 'Rendering image ads';
  if (active.kind === 'generation' && active.outputType === 'ugc_first_frame') return 'Creating creator reference frame';
  if (active.kind === 'generation') return 'Creating UGC segments';
  if (active.kind === 'proof_prep') return 'Preparing app proof';
  if (active.kind === 'render' && active.outputType === 'image_ad') return 'Finishing image ads';
  if (active.kind === 'render') return 'Composing UGC ads';
  if (active.kind === 'qa') return 'Running quality checks';
  return 'Planning ads from your app info';
}

export function customerSafeJob(job) {
  const plain = toPlain(job);
  return {
    ...plain,
    progress: jobProgress(job),
    providerMutations: 0,
  };
}

export function buildJobManifest(job) {
  return {
    schemaVersion: JOB_MANIFEST_SCHEMA_VERSION,
    jobId: job.jobId,
    packId: job.packId,
    orgId: job.orgId,
    workspaceId: job.workspaceId,
    appId: job.appId,
    status: job.status,
    request: job.request,
    progress: jobProgress(job),
    tasks: (job.tasks || []).map((task) => ({
      taskId: task.taskId,
      kind: task.kind,
      adapter: task.adapter,
      outputType: task.outputType,
      status: task.status,
      attempts: task.attempts,
      dependsOn: task.dependsOn,
      usage: task.usage || null,
      timing: task.timing || null,
      ...(task.kind === 'planning' ? {
        planId: task.hookPlan?.planId || task.scriptPlan?.planId || null,
        planFingerprint: task.hookPlan?.planFingerprint || task.scriptPlan?.planFingerprint || null,
        requestFingerprint: task.spec?.hookRequest?.requestFingerprint || task.spec?.scriptRequest?.requestFingerprint || null,
        sourceFingerprint: task.spec?.hookRequest?.sourceFingerprint || task.spec?.scriptRequest?.sourceFingerprint || null,
      } : {}),
      outputStorageKey: task.output?.storageKey || null,
      ...(task.kind === 'render' && task.renderSpec ? { renderSpec: safeRenderSpecSummary(task.renderSpec) } : {}),
    })),
    assets: toPlain(job.assets || []),
    qaReports: toPlain(job.qaReports || []),
    drafts: toPlain(job.drafts || []),
    costPlan: toPlain(job.costPlan),
    packPlan: job.source?.packPlan ? {
      planId: job.source.packPlan.planId,
      planFingerprint: job.source.packPlan.planFingerprint,
      evidenceMode: job.source.packPlan.evidenceMode,
      hypothesis: toPlain(job.source.packPlan.hypothesis),
      experiment: toPlain(job.source.packPlan.experiment),
      assignments: toPlain(job.source.packPlan.assignments),
    } : null,
    hookPlans: toPlain(job.hookPlans || []),
    scriptPlans: toPlain(job.scriptPlans || []),
    creativeIntelligenceCalls: Number(job.creativeIntelligenceCalls) || 0,
    generationProviderCalls: Number(job.generationProviderCalls) || 0,
    providerMutations: 0,
    audit: {
      generatedAt: job.updatedAt,
      note: 'Job manifest from the tenant store. No ad-network mutations; media may be locally stubbed.',
    },
  };
}

function safeRenderSpecSummary(spec) {
  return {
    format: spec.format,
    ugcRoute: spec.ugcRoute || null,
    recipeId: spec.recipe?.id || spec.renderManifest?.recipeId || null,
    scriptId: spec.script?.id || spec.renderManifest?.scriptId || null,
    hookPolicy: spec.script?.hookPolicy || null,
    hookQuality: spec.script?.hookQuality || null,
    captionStyle: spec.captionStyle || null,
    proofAudioPolicy: spec.proofAudioPolicy || null,
    renderManifest: spec.renderManifest || null,
    visualContinuity: spec.renderManifest?.visualContinuity || spec.recipe?.creatorContinuity?.visualContinuity || null,
    timeline: (spec.timeline || []).map((layer) => ({
      id: layer.id,
      type: layer.type,
      role: layer.role || null,
      start: layer.start ?? null,
      duration: layer.duration ?? null,
      proofId: layer.proofId || null,
      sourceType: layer.sourceType || null,
      extractionStage: layer.extractionStage || null,
      requiresRawificationBeforeUiExtraction: Boolean(layer.requiresRawificationBeforeUiExtraction),
      trustLevel: layer.trustLevel || null,
      label: layer.label || null,
      text: layer.type === 'caption' || layer.type === 'cta' ? layer.text : undefined,
      treatment: layer.treatment || null,
      audioPolicy: layer.audioPolicy || null,
    })),
    claimReferences: spec.claimReferences || [],
    providerMutations: 0,
  };
}

function taskShell({ scope, taskId, kind, adapter, createdAt }) {
  return {
    taskId,
    jobId: scope.jobId,
    packId: scope.packId,
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    appId: scope.appId,
    kind,
    adapter,
    idempotencyKey: `${scope.jobId}:${taskId}`,
    status: 'queued',
    attempts: 0,
    maxAttempts: 2,
    dependsOn: [],
    error: null,
    assetId: null,
    lease: null,
    usage: {
      planningProviderCalls: 0,
      generationProviderCalls: 0,
      providerMutations: 0,
    },
    timing: null,
    providerMutations: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

function qaTaskFor({ scope, targetTask, createdAt }) {
  return {
    ...taskShell({ scope, taskId: `${targetTask.taskId}-qa`, kind: 'qa', adapter: 'qa_rules', createdAt }),
    outputType: 'qa_report',
    costUnits: 0,
    dependsOn: [targetTask.taskId],
    spec: { targetTaskId: targetTask.taskId, outputType: targetTask.outputType },
  };
}

/* Snapshot the reviewed app info into the job so workers never re-read the
   app document mid-run. Only selected, supported inputs travel with the job. */
export function jobSourceFromApp(app, packPlan = null) {
  const plannedClaimIds = new Set((packPlan?.assignments || []).flatMap((assignment) => assignment.claimEvidenceRefs || []).map(rawEvidenceId));
  const plannedScreenIds = new Set((packPlan?.assignments || []).flatMap((assignment) => assignment.proofEvidenceRefs || []).map(rawEvidenceId));
  const screens = (app?.screens || [])
    .filter((screen) => screen && screen.selected !== false && !screen.ignored && screen.usability !== 'blocked')
    .filter((screen) => !plannedScreenIds.size || plannedScreenIds.has(String(screen.id)))
    .map((screen) => ({
      id: screen.id,
      assetId: screen.assetId || null,
      storageKey: screen.storageKey || null,
      label: screen.label || '',
      detail: screen.detail || '',
      sourceType: screen.sourceType || null,
      extractionStage: screen.extractionStage || (screen.sourceType === 'store_art' ? 'pre_rawification' : 'ui_extracted'),
      requiresRawificationBeforeUiExtraction: Boolean(screen.requiresRawificationBeforeUiExtraction || screen.sourceType === 'store_art'),
      rawifyEligible: Boolean(screen.rawifyEligible),
      trustLevel: screen.trustLevel || null,
      sourceUrl: screen.sourceUrl || null,
      usability: screen.usability || null,
      usabilityLabel: screen.usabilityLabel || null,
      usabilityReason: screen.usabilityReason || null,
    }));
  const claims = (app?.claims || [])
    .filter((claim) => claim && claim.selected !== false && !claim.ignored && claim.supported !== false && String(claim.text || '').trim())
    .filter((claim) => !plannedClaimIds.size || plannedClaimIds.has(String(claim.id)))
    .map((claim) => ({ id: claim.id, text: claim.text, supported: claim.supported !== false }));
  const angles = packPlan?.experiment
    ? [
      { id: 'primary', label: packPlan.experiment.primary.angle },
      { id: 'challenger', label: packPlan.experiment.challenger.angle },
    ]
    : (app?.angles || []).map((angle) => ({ id: angle.id, label: angle.label }));
  const audienceNotes = [
    ...(Array.isArray(app?.audienceNotes) ? app.audienceNotes : []),
    ...(Array.isArray(app?.appProfile?.audienceNotes) ? app.appProfile.audienceNotes : []),
    ...(Array.isArray(app?.reviewSignals?.audience) ? app.reviewSignals.audience : []),
    packPlan?.hypothesis?.audience,
    packPlan?.hypothesis?.tension,
    packPlan?.hypothesis?.statement,
    ...((packPlan?.researchSnapshot || packPlan?.research)?.marketSignals || []).map((signal) => signal.paraphrase || signal.theme),
    ...((packPlan?.researchSnapshot || packPlan?.research)?.learningSignals || []).map((signal) => signal.instruction),
  ].map((note) => String(typeof note === 'string' ? note : note?.text || note?.label || '').trim()).filter(Boolean).slice(0, 20);
  const learningNotes = (app?.learningEvents || [])
    .map((event) => String(event?.note || event?.text || event?.reason || event?.action || event?.type || '').trim())
    .filter(Boolean)
    .slice(-20);
  return {
    appName: app?.name || 'this app',
    appId: app?.appId || app?.id || null,
    appCategory: app?.extraction?.app?.category || app?.category || '',
    appSummary: app?.tagline || app?.summary || '',
    screens,
    claims,
    angles,
    audienceNotes,
    learningNotes,
    styleNotes: [...(app?.style || [])],
    packPlan: packPlan ? {
      planId: packPlan.planId,
      planFingerprint: packPlan.planFingerprint,
      evidenceMode: packPlan.evidenceMode,
      hypothesis: packPlan.hypothesis,
      experiment: packPlan.experiment,
      assignments: (packPlan.assignments || []).map((assignment) => ({
        assignmentId: assignment.assignmentId,
        format: assignment.format,
        lane: assignment.lane,
        angle: assignment.angle,
        claimIds: (assignment.claimEvidenceRefs || []).map(rawEvidenceId),
        proofIds: (assignment.proofEvidenceRefs || []).map(rawEvidenceId),
        marketSignalRefs: assignment.marketSignalRefs || [],
      })),
    } : null,
    providerMutations: 0,
  };
}

function assignmentFor(source, format, index) {
  const assignments = (source?.packPlan?.assignments || []).filter((assignment) => assignment.format === format);
  return assignments.length ? assignments[index % assignments.length] : null;
}

function claimForAssignment(source, assignment) {
  const ids = new Set(assignment?.claimIds || []);
  return ids.size ? (source.claims || []).find((claim) => ids.has(String(claim.id))) || null : null;
}

function screenForAssignment(source, assignment) {
  const ids = new Set(assignment?.proofIds || []);
  return ids.size ? (source.screens || []).find((screen) => ids.has(String(screen.id))) || null : null;
}

function rawEvidenceId(value) {
  return String(value || '').replace(/^(claim|screen|summary):/, '');
}

function spokenLineForSegment(role, source, claim) {
  const feature = lowercaseFirst(adHeadlineForClaim({ source, claim }));
  const shortName = shortAppName(source.appName);
  if (role === 'hook') return `I kept losing track until I tried ${shortName}.`;
  if (role === 'proof_voice') return `Look: ${feature}`;
  return `That is why ${shortName} stays on my home screen.`;
}

function mediaShapeStatus(outputType, media, targetTask) {
  if (outputType === 'image_ad') {
    return media.width && media.height ? 'pass' : 'hold';
  }
  if (!media.durationSeconds) return 'hold';
  const expected = targetTask.renderSpec?.durationSeconds;
  return !expected || Math.abs(media.durationSeconds - expected) <= 1 ? 'pass' : 'hold';
}

function pickByIndex(list, index) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[index % list.length];
}

function shortCaption(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  return cleaned.length > 48 ? `${cleaned.slice(0, 45).trim()}...` : cleaned;
}

function adHeadlineForClaim({ source, claim }) {
  const candidates = [
    featurePhraseFromText(claim?.text, source),
    featurePhraseFromText(source.appSummary, source),
    fallbackFeaturePhrase(source),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const fitted = fitAdCopy(candidate, 42, fallbackFeaturePhrase(source));
    if (isCompleteAdCopy(fitted) && !isMarketingFiller(fitted, source)) return fitted;
  }
  return fitAdCopy(`See ${shortAppName(source.appName)} in action`, 42, fallbackFeaturePhrase(source));
}

function featurePhraseFromText(text, source) {
  let cleaned = cleanAdText(text);
  if (!cleaned) return '';

  const appNamePattern = appNamePrefixPattern(source.appName);
  cleaned = cleaned
    .replace(/^here'?s why\s+/i, '')
    .replace(/^why\s+/i, '')
    .replace(new RegExp(`^(?:${appNamePattern})\\s+(is|was|will be)\\s+`, 'i'), '')
    .replace(new RegExp(`^(?:${appNamePattern})\\s+(helps|lets|keeps|tracks|creates|makes)\\s+`, 'i'), '$1 ')
    .replace(/^(helps|lets)\s+(people|users|you|teams)\s+/i, '')
    .replace(/^keeps\s+(people|users|you|teams)\s+/i, 'Keep ')
    .replace(/^tracks\s+(people|users|you|teams)\s+/i, 'Track ')
    .replace(/^creates\s+(people|users|you|teams)\s+/i, 'Create ')
    .replace(/^makes\s+(people|users|you|teams)\s+/i, 'Make ')
    .replace(/\b(on the app store|in the app store|from the app store)\b/ig, '')
    .trim();

  if (!cleaned || isMarketingFiller(cleaned, source)) return '';
  const firstClause = cleanAdText(cleaned.split(/\s+[–—-]\s+|;|\|/)[0]);
  const phrase = firstClause || cleaned;
  if (!phrase || isMarketingFiller(phrase, source)) return '';
  return sentenceCase(phrase);
}

function fallbackFeaturePhrase(source) {
  return `See ${shortAppName(source.appName)} in action`;
}

function fitAdCopy(text, maxLength, fallback = '') {
  const cleaned = cleanAdText(text);
  if (cleaned.length <= maxLength) {
    if (isCompleteAdCopy(cleaned)) return cleaned;
    const repaired = removeDanglingCopyTail(cleaned);
    if (repaired.length >= 6 && isCompleteAdCopy(repaired)) return repaired;
    return cleanAdText(fallback) || repaired || fallbackFeaturePhrase({ appName: 'this app', appSummary: '' });
  }
  const words = cleaned.split(/\s+/);
  const kept = [];
  for (const word of words) {
    const next = [...kept, word].join(' ');
    if (next.length > maxLength) break;
    kept.push(word);
  }
  const fitted = removeDanglingCopyTail(kept.join(' '));
  if (fitted.length >= 12 && isCompleteAdCopy(fitted)) return fitted;
  const fallbackCopy = cleanAdText(fallback) || fallbackFeaturePhrase({ appName: 'this app', appSummary: '' });
  return fallbackCopy.length <= maxLength ? fallbackCopy : removeDanglingCopyTail(fallbackCopy.slice(0, maxLength));
}

function isCompleteAdCopy(text) {
  const cleaned = cleanAdText(text);
  if (!cleaned || cleaned.length < 6) return false;
  if (/[,:;]$/.test(cleaned) || /\.\.\.$/.test(cleaned)) return false;
  return !DANGLING_COPY_TOKENS.has(lastWord(cleaned));
}

function removeDanglingCopyTail(text) {
  const words = cleanAdText(text).split(/\s+/).filter(Boolean);
  while (words.length > 1 && DANGLING_COPY_TOKENS.has(lastWord(words.join(' ')))) {
    words.pop();
  }
  return cleanAdText(words.join(' '));
}

function lastWord(text) {
  const words = String(text || '').trim().split(/\s+/);
  return words[words.length - 1]?.toLowerCase().replace(/[^a-z0-9']/g, '') || '';
}

const DANGLING_COPY_TOKENS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  "can't",
  'cant',
  'cannot',
  'for',
  'from',
  'if',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
  'without',
  'you',
  'your',
]);

function ctaLabel(verb, appName) {
  return fitAdCopy(`${verb} ${shortAppName(appName)}`, 30);
}

function shortAppName(appName) {
  const cleaned = cleanAdText(appName || 'this app')
    .replace(/\s*[:|-]\s*.*/i, '')
    .replace(/\b(AI|App)\b$/i, '')
    .trim();
  const descriptorSuffixes = new Set(['ai', 'app', 'personal', 'trainer', 'tracker', 'planner', 'plan', 'workout', 'gym', 'fitness', 'photo', 'video', 'editor']);
  const words = cleaned.split(/\s+/).filter(Boolean);
  while (words.length > 1 && descriptorSuffixes.has(words[words.length - 1].replace(/[^a-z0-9]/gi, '').toLowerCase())) {
    words.pop();
  }
  return words.join(' ') || cleaned || 'this app';
}

function appNamePrefixPattern(appName) {
  const names = [cleanAdText(appName), shortAppName(appName)]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return names.map(escapeRegExp).join('|') || 'this\\ app';
}

function cleanAdText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[•\-\s]+/, '')
    .replace(/[.!?]+$/g, '')
    .trim();
}

function cleanSpokenLine(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMarketingFiller(text, source) {
  const cleaned = text.toLowerCase();
  const shortName = shortAppName(source.appName).toLowerCase();
  const fullName = cleanAdText(source.appName).toLowerCase();
  if (!cleaned) return true;
  if (/\b(premier|best|ultimate|leading|#1|number one|top-rated|world-class|game changer|everything you need)\b/.test(cleaned)) return true;
  if (/^this app\b|^our app\b|^the app\b/.test(cleaned)) return true;
  if (cleaned === fullName || cleaned.startsWith(`${fullName} `)) return true;
  if (cleaned === shortName || cleaned === `${shortName} on the app store`) return true;
  return cleaned.split(/\s+/).length < 3;
}

function sentenceCase(text) {
  const cleaned = cleanAdText(text);
  if (!cleaned) return cleaned;
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function anchorForLayer(layer, roleAnchors, beatRoleById = new Map()) {
  const singleTake = roleAnchors.get('single_take') || null;
  if (singleTake && (layer.type === 'proof_media' || layer.type === 'caption')) return singleTake;
  if (layer.type === 'proof_media') {
    const beatRole = beatRoleById.get(layer.proofBeatId);
    return roleAnchors.get(beatRole || 'proof_voice') || roleAnchors.get('proof_voice') || null;
  }
  if (layer.type === 'caption' && layer.role === 'hook') return roleAnchors.get('hook') || null;
  if (layer.type === 'caption' && layer.role === 'proof') return roleAnchors.get('proof_voice') || null;
  if (layer.type === 'caption' && layer.role === 'reveal') return roleAnchors.get('reaction') || null;
  return null;
}

function compareTimelineLayers(left, right) {
  const startDelta = safeNumber(left.start) - safeNumber(right.start);
  if (startDelta) return startDelta;
  const priorityDelta = timelineLayerPriority(left) - timelineLayerPriority(right);
  return priorityDelta || String(left.id).localeCompare(String(right.id));
}

function timelineLayerPriority(layer) {
  if (layer?.type === 'creator_video') return 10;
  if (layer?.type === 'proof_media') return 20;
  if (layer?.type === 'caption') return 30;
  if (layer?.type === 'cta') return 40;
  return 15;
}

function retimeLayerToAnchor(layer, anchor) {
  const oldStart = safeNumber(layer.start);
  const oldDuration = positiveDuration(layer.duration) || 0.1;
  const oldEnd = oldStart + oldDuration;
  const startRatio = clamp01((oldStart - anchor.oldStart) / anchor.oldDuration);
  const endRatio = Math.max(startRatio, clamp01((oldEnd - anchor.oldStart) / anchor.oldDuration));
  const newStart = anchor.newStart + startRatio * anchor.newDuration;
  const newEnd = anchor.newStart + endRatio * anchor.newDuration;
  layer.start = round2(newStart);
  layer.duration = round2(Math.max(0.1, newEnd - newStart));
}

function retimeLayerToDuration(layer, oldDuration, newDuration) {
  const oldStart = safeNumber(layer.start);
  const layerDuration = positiveDuration(layer.duration) || 0.1;
  const oldEnd = oldStart + layerDuration;
  if (oldEnd >= oldDuration - 0.05) {
    const newEnd = newDuration;
    layer.start = round2(Math.max(0, newEnd - layerDuration));
    layer.duration = round2(Math.max(0.1, layerDuration));
    return;
  }
  const ratio = newDuration / oldDuration;
  layer.start = round2(oldStart * ratio);
  layer.duration = round2(Math.max(0.1, layerDuration * ratio));
}

function timelineEnd(timeline) {
  return round2((timeline || []).reduce((most, layer) => Math.max(most, safeNumber(layer.start) + (positiveDuration(layer.duration) || 0)), 0));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveDuration(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function lowercaseFirst(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return cleaned;
  return `${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
}
