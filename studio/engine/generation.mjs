// Stage 5 — Generation Plan (our own pipeline; NEVER HeyGen).
// Plans the creator-generation tasks: identity transform + per-segment i2v.
// This is a PLAN only — local mode never submits to a provider, so every task is
// status:"planned" and providerMutations stays 0. Mirrors `generationTasks/{id}`.
import { stableId, round, clamp } from './util.mjs';

// Provider-neutral cost model (planning estimates only — no billing happens).
const COST_MODEL = {
  'nano-banana-image': { unit: 'image', usdPerUnit: 0.04 },
  'kling-v3-pro-i2v': { unit: 'segment', usdPerUnit: 1.8 }, // native-audio talking-head segment
  'seedance-i2v': { unit: 'second', usdPerUnit: 0.3 }, // one-shot
};

export function runGenerationPlan(profile, script, brief, creatorProfile, packRequest) {
  if (script.blocked) {
    return { stage: 'generation', blocked: true, tasks: [], estimateUsd: 0, providerMutations: 0 };
  }

  const backendId = packRequest.formats.includes('ugc_video') ? 'kling-v3-pro-i2v' : 'nano-banana-image';
  const tasks = [];

  // 1) Mandatory identity transform of the reference creator image (Nano Banana).
  const changedAttrs = Object.values(creatorProfile?.identityTransform || {}).filter(Boolean);
  const identityTask = {
    taskId: stableId('gentask', `${script.scriptId}|identity`),
    kind: 'identity_transform',
    backendId: 'nano-banana-image',
    inputSpec: {
      referenceAssetId: creatorProfile?.referenceAssetId || 'sample/creator/reference.png',
      identityTransform: creatorProfile?.identityTransform || {},
      rightsStatus: creatorProfile?.rightsStatus || 'manual_review',
    },
    units: 1,
    estimatedCostUsd: COST_MODEL['nano-banana-image'].usdPerUnit,
    status: 'planned',
    idempotencyKey: stableId('idem', `${script.scriptId}|identity`),
    providerRequestId: null,
    outputAssetId: null,
  };
  tasks.push(identityTask);

  // 2) One generation task per spoken beat (segment-based i2v) or one-shot.
  if (backendId === 'kling-v3-pro-i2v') {
    for (const beat of script.beats) {
      tasks.push({
        taskId: stableId('gentask', `${script.scriptId}|${beat.id}`),
        kind: 'creator_segment',
        backendId,
        inputSpec: {
          exactScriptLine: beat.line,
          durationSeconds: beat.durationSeconds,
          camera: 'static, no movement',
          negativePrompt: 'camera movement, zoom, pan, scene change, different person, different outfit',
          generateAudio: true,
        },
        units: 1,
        estimatedCostUsd: COST_MODEL[backendId].usdPerUnit,
        status: 'planned',
        idempotencyKey: stableId('idem', `${script.scriptId}|${beat.id}`),
        providerRequestId: null,
        outputAssetId: null,
      });
    }
  } else {
    tasks.push({
      taskId: stableId('gentask', `${script.scriptId}|oneshot`),
      kind: 'creator_oneshot',
      backendId: 'seedance-i2v',
      inputSpec: { durationSeconds: brief.targetDurationSeconds, generateAudio: true },
      units: brief.targetDurationSeconds,
      estimatedCostUsd: round(COST_MODEL['seedance-i2v'].usdPerUnit * brief.targetDurationSeconds, 2),
      status: 'planned',
      idempotencyKey: stableId('idem', `${script.scriptId}|oneshot`),
      providerRequestId: null,
      outputAssetId: null,
    });
  }

  const estimateUsd = round(
    tasks.reduce((sum, t) => sum + t.estimatedCostUsd, 0),
    2,
  );
  const overCeiling = estimateUsd > packRequest.costCeilingUsd;

  const notes = [];
  if (changedAttrs.length < 3) {
    notes.push('Identity transform changes <3 attributes — mandatory minimum is 3; flag for QA.');
  }
  if (overCeiling) {
    notes.push(`Estimate $${estimateUsd} exceeds cost ceiling $${packRequest.costCeilingUsd}; submit must be blocked.`);
  }

  return {
    stage: 'generation',
    blocked: false,
    backendId,
    tasks,
    estimateUsd,
    costCeilingUsd: packRequest.costCeilingUsd,
    overCeiling,
    identityAttributesChanged: clamp(changedAttrs.length, 0, 99),
    providerMutations: 0, // invariant: planning only, nothing submitted
    notes,
  };
}
