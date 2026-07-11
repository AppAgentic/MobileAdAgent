/* Worker loop that executes a creative job graph against a tenant store.

   The runner only talks to the store's server-only job hooks
   (serverReadJob / serverSaveJob / serverFinalizeJob) and to generation
   adapters, so the same loop can move to a hosted worker later — swap the
   store for Firestore and the adapters for live ones.

   Safe by construction: default adapters are local mocks, no provider calls,
   providerMutations stays 0 end to end. */

import {
  TERMINAL_JOB_STATUSES,
  TERMINAL_TASK_STATUSES,
  applyHookPlanToJob,
  applyScriptPlanToJob,
  buildDraftRecord,
  buildTaskQaReport,
  recordHookPlanSummary,
  recordScriptPlanSummary,
  resolveVideoRenderSpecWithInputDurations,
} from './creative-job-model.mjs';
import { randomUUID } from 'node:crypto';
import { resolveGenerationAdapters } from './generation-adapters.mjs';
import { isoNow, stableHash } from './tenant-model.mjs';

export async function runCreativeJob({
  store,
  orgId,
  workspaceId,
  appId,
  jobId,
  adapters = resolveGenerationAdapters(),
  now = () => Date.now(),
  workerId = `worker-${randomUUID()}`,
  // Two worst-case semantic rounds are writer + two waves of isolated
  // readers + critic. A 45-minute lease stays above the bounded provider
  // timeout envelope while still allowing crash recovery.
  leaseMs = 45 * 60 * 1000,
} = {}) {
  const ref = { orgId, workspaceId, appId, jobId };
  let job = await store.serverReadJob(ref);
  if (!job) throw new Error('Job not found.');
  if (TERMINAL_JOB_STATUSES.includes(job.status)) return job;

  let guard = job.tasks.length * (maxAttempts(job) + 1) + 1;
  while (guard > 0) {
    guard -= 1;
    const claimTimeMs = now();
    const tasksById = new Map(job.tasks.map((task) => [task.taskId, task]));
    const task = nextRunnableTask(job, tasksById, claimTimeMs);
    if (!task) break;
    const claimedAt = new Date(claimTimeMs).toISOString();
    const leaseExpiresAt = new Date(claimTimeMs + leaseMs).toISOString();
    const claimedJob = typeof store.serverClaimTask === 'function'
      ? await store.serverClaimTask({ ...ref, taskId: task.taskId, workerId, claimedAt, leaseExpiresAt })
      : claimTaskLocally({ job, taskId: task.taskId, workerId, claimedAt, leaseExpiresAt, claimTimeMs });
    if (!claimedJob) {
      job = await store.serverReadJob(ref);
      if (!job || TERMINAL_JOB_STATUSES.includes(job.status)) return job;
      if (job.tasks.some((candidate) => candidate.status === 'running' && !leaseExpired(candidate, claimTimeMs))) return job;
      continue;
    }

    job = claimedJob;
    const claimedTasksById = new Map(job.tasks.map((candidate) => [candidate.taskId, candidate]));
    const claimedTask = claimedTasksById.get(task.taskId);
    await executeTask({ job, task: claimedTask, tasksById: claimedTasksById, adapters, now });
    job.updatedAt = isoNow(now);
    if (typeof store.serverCommitTask === 'function') {
      job = await store.serverCommitTask({ job, taskId: claimedTask.taskId, workerId });
    } else {
      claimedTask.lease = null;
      job = await store.serverSaveJob(job);
    }
  }

  const observedAtMs = now();
  if (job.tasks.some((task) => task.status === 'running' && !leaseExpired(task, observedAtMs))) {
    // Another worker owns the job lease. Leave it running instead of
    // converting in-flight work into skipped tasks.
    return job;
  }

  markTasksBlockedByFailedDependencies(job, now);
  if (job.tasks.some((task) => !TERMINAL_TASK_STATUSES.includes(task.status))) return job;

  const tasksById = new Map(job.tasks.map((task) => [task.taskId, task]));
  finalizeJobRecord(job, tasksById, now);
  await store.serverFinalizeJob({ job });
  return job;
}

function nextRunnableTask(job, tasksById, observedAtMs) {
  return job.tasks.find((task) => (
    (task.status === 'queued' || (task.status === 'running' && leaseExpired(task, observedAtMs)))
    && Number(task.attempts || 0) < Number(task.maxAttempts || 1)
    && (task.dependsOn || []).every((dep) => tasksById.get(dep)?.status === 'succeeded')
    && !(task.dependsOn || []).some((dep) => ['failed', 'skipped'].includes(tasksById.get(dep)?.status))
  )) || null;
}

async function executeTask({ job, task, tasksById, adapters, now }) {
  const attemptStartedAtMs = now();
  const createdAtMs = Date.parse(task.createdAt || '');
  task.timing = {
    ...(task.timing || {}),
    firstStartedAt: task.timing?.firstStartedAt || new Date(attemptStartedAtMs).toISOString(),
    lastAttemptStartedAt: new Date(attemptStartedAtMs).toISOString(),
    queueWaitMs: Number.isFinite(createdAtMs)
      ? Math.max(0, attemptStartedAtMs - createdAtMs)
      : null,
  };
  assertTaskCreditCeiling(job, task);
  try {
    const result = await executeTaskByKind({ job, task, tasksById, adapters, now });
    if (result?.asset) {
      upsertById(job.assets, result.asset, 'assetId');
      task.assetId = result.asset.assetId;
    }
    if (Number(result?.costUnits) > 0) {
      job.costPlan.spentCredits += Number(result.costUnits);
    }
    recordTaskUsage(task, result, { reuse: result?.reusedArtifact === true });
    recomputeJobUsage(job);
    if (result?.taskFailure) {
      const failure = new Error(result.taskFailure);
      failure.nonRetryable = true;
      throw failure;
    }
    task.status = 'succeeded';
    task.error = null;
  } catch (error) {
    recordTaskUsage(task, {
      providerCalls: error.providerCalls,
      planningProviderCalls: error.planningProviderCalls,
    });
    recomputeJobUsage(job);
    if (!error.nonRetryable && task.attempts < task.maxAttempts) {
      task.status = 'queued';
      task.error = `Retrying after: ${error.message}`;
    } else {
      task.status = 'failed';
      task.error = error.message;
    }
  }
  const attemptFinishedAtMs = now();
  const attemptDurationMs = Math.max(0, attemptFinishedAtMs - attemptStartedAtMs);
  task.timing = {
    ...task.timing,
    lastAttemptFinishedAt: new Date(attemptFinishedAtMs).toISOString(),
    lastAttemptDurationMs: attemptDurationMs,
    totalExecutionMs: Number(task.timing?.totalExecutionMs || 0) + attemptDurationMs,
  };
  task.updatedAt = isoNow(now);
}

function claimTaskLocally({ job, taskId, workerId, claimedAt, leaseExpiresAt, claimTimeMs }) {
  const tasksById = new Map(job.tasks.map((task) => [task.taskId, task]));
  const task = tasksById.get(taskId);
  const anotherActiveLease = job.tasks.some((candidate) => (
    candidate.taskId !== taskId
    && candidate.status === 'running'
    && !leaseExpired(candidate, claimTimeMs)
  ));
  if (!task || anotherActiveLease || Number(task.attempts || 0) >= Number(task.maxAttempts || 1)) return null;
  if (!(task.status === 'queued' || (task.status === 'running' && leaseExpired(task, claimTimeMs)))) return null;
  if (!(task.dependsOn || []).every((dependency) => tasksById.get(dependency)?.status === 'succeeded')) return null;
  task.status = 'running';
  task.attempts = Number(task.attempts || 0) + 1;
  task.lease = { workerId, claimedAt, expiresAt: leaseExpiresAt };
  task.updatedAt = claimedAt;
  job.status = 'running';
  job.updatedAt = claimedAt;
  return job;
}

function leaseExpired(task, observedAtMs) {
  const expiresAt = Date.parse(task?.lease?.expiresAt || '');
  return !Number.isFinite(expiresAt) || expiresAt <= observedAtMs;
}

function markTasksBlockedByFailedDependencies(job, now) {
  const tasksById = new Map(job.tasks.map((task) => [task.taskId, task]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of job.tasks) {
      if (TERMINAL_TASK_STATUSES.includes(task.status)) continue;
      const failedDependency = (task.dependsOn || []).some((dependency) => ['failed', 'skipped'].includes(tasksById.get(dependency)?.status));
      const exhaustedLease = task.status === 'running' && Number(task.attempts || 0) >= Number(task.maxAttempts || 1);
      if (!failedDependency && !exhaustedLease) continue;
      task.status = failedDependency ? 'skipped' : 'failed';
      task.error = failedDependency ? 'Skipped because an upstream task failed.' : 'Task lease expired after its final allowed attempt.';
      task.lease = null;
      task.updatedAt = isoNow(now);
      changed = true;
    }
  }
}

async function executeTaskByKind({ job, task, tasksById, adapters, now }) {
  if (task.kind === 'planning' && task.outputType === 'ugc_hook_plan') {
    const result = await adapters.hookAgent.planHooks({ task, source: job.source });
    assertPersistedHookPlanResult(task, result);
    if (result.hookPlan?.status === 'selected') {
      applyHookPlanToJob({ job, planningTask: task, hookPlan: result.hookPlan });
    } else {
      recordHookPlanSummary({ job, planningTask: task, hookPlan: result.hookPlan });
    }
    return result;
  }
  if (task.kind === 'planning' && task.outputType === 'ugc_script_plan') {
    const hookPlanningTask = job.tasks.find((candidate) => candidate.taskId === task.spec?.hookPlanTaskId);
    const hookPlan = await readCommittedHookPlan({ job, planningTask: hookPlanningTask, hookAgent: adapters.hookAgent });
    const result = await adapters.scriptAgent.planScripts({ task, source: job.source, hookPlan });
    assertPersistedScriptPlanResult(task, result);
    if (result.scriptPlan?.status === 'selected') {
      applyScriptPlanToJob({ job, planningTask: task, scriptPlan: result.scriptPlan });
    } else {
      recordScriptPlanSummary({ job, planningTask: task, scriptPlan: result.scriptPlan });
    }
    return result;
  }
  if (task.kind === 'generation' && ['image_ad_source', 'image_ad'].includes(task.outputType)) {
    return adapters.imageAd.generateImageAd({ task, source: job.source });
  }
  if (task.kind === 'generation' && task.outputType === 'ugc_first_frame') {
    await assertSelectedHookPlanForMedia(job, task, adapters.hookAgent);
    await assertSelectedScriptPlanForMedia(job, task, adapters.scriptAgent, adapters.hookAgent);
    assertNoMockHookPlanForLiveMedia(job, adapters.ugcFirstFrame);
    return adapters.ugcFirstFrame.generateFirstFrame({ task, source: job.source });
  }
  if (task.kind === 'generation' && task.outputType === 'ugc_segment') {
    await assertSelectedHookPlanForMedia(job, task, adapters.hookAgent);
    await assertSelectedScriptPlanForMedia(job, task, adapters.scriptAgent, adapters.hookAgent);
    assertNoMockHookPlanForLiveMedia(job, adapters.ugcSegment);
    const inputAssets = (task.dependsOn || [])
      .map((dep) => job.assets.find((asset) => asset.taskId === dep))
      .filter(Boolean);
    return adapters.ugcSegment.generateSegment({ task, source: job.source, inputAssets });
  }
  if (task.kind === 'proof_prep') {
    // Metadata-only artifact: crop/timing windows over reviewed screenshots.
    return {
      asset: {
        assetId: `${task.taskId}-asset`,
        taskId: task.taskId,
        jobId: job.jobId,
        packId: job.packId,
        orgId: job.orgId,
        workspaceId: job.workspaceId,
        appId: job.appId,
        kind: 'proof_prep_artifact',
        storageKey: task.output.storageKey,
        contentType: task.output.contentType,
        proofs: task.spec.proofs,
        mode: 'local_mock',
        providerMutations: 0,
      },
      costUnits: 0,
      providerMutations: 0,
    };
  }
  if (task.kind === 'render') {
    if (task.outputType === 'ugc_ad') {
      await assertSelectedHookPlanForMedia(job, task, adapters.hookAgent);
      await assertSelectedScriptPlanForMedia(job, task, adapters.scriptAgent, adapters.hookAgent);
    }
    const inputAssets = (task.dependsOn || [])
      .map((dep) => job.assets.find((asset) => asset.taskId === dep))
      .filter(Boolean);
    task.renderSpec.inputAssetIds = inputAssets.map((asset) => asset.assetId);
    task.renderSpec = resolveVideoRenderSpecWithInputDurations({ renderSpec: task.renderSpec, inputAssets });
    return adapters.render.renderComposition({ task, inputAssets });
  }
  if (task.kind === 'qa') {
    const targetTask = tasksById.get(task.spec.targetTaskId);
    if (!targetTask) throw new Error('QA target task is missing.');
    const asset = job.assets.find((candidate) => candidate.taskId === targetTask.taskId) || null;
    const report = buildTaskQaReport({ job, task, targetTask, asset, createdAt: isoNow(now) });
    job.qaReports.push(report);
    return { costUnits: 0, providerMutations: 0 };
  }
  throw new Error(`Unknown task kind: ${task.kind}`);
}

function assertNoMockHookPlanForLiveMedia(job, adapter) {
  if (!adapter?.live) return;
  const plan = (job.hookPlans || [])[0];
  if (!plan || plan.status !== 'selected' || plan.intelligenceMode === 'local_mock_fixture') {
    throw new Error('Live UGC media is blocked until live Hook Agent intelligence selects the script.');
  }
}

function assertPersistedHookPlanResult(task, result) {
  const plan = result?.hookPlan;
  const asset = result?.asset;
  if (!plan || !asset) throw new Error('Hook planning must return both a plan and its immutable artifact record.');
  if (asset.storageKey !== task.output?.storageKey) throw new Error('Hook plan artifact was stored under the wrong task key.');
  if (!plan.planFingerprint || asset.planFingerprint !== plan.planFingerprint) {
    throw new Error('Hook plan artifact fingerprint does not match the selected-or-held plan.');
  }
  if (asset.requestFingerprint !== task.spec?.hookRequest?.requestFingerprint || asset.sourceFingerprint !== task.spec?.hookRequest?.sourceFingerprint) {
    throw new Error('Hook plan artifact is stale for this planning task.');
  }
}

function assertPersistedScriptPlanResult(task, result) {
  const plan = result?.scriptPlan;
  const asset = result?.asset;
  if (!plan || !asset) throw new Error('Script planning must return both a plan and its immutable artifact record.');
  if (asset.storageKey !== task.output?.storageKey) throw new Error('Script plan artifact was stored under the wrong task key.');
  if (!plan.planFingerprint || asset.planFingerprint !== plan.planFingerprint) throw new Error('Script plan artifact fingerprint does not match the selected-or-held plan.');
  if (asset.requestFingerprint !== task.spec?.scriptRequest?.requestFingerprint
    || asset.sourceFingerprint !== task.spec?.scriptRequest?.sourceFingerprint
    || asset.hookPlanFingerprint !== task.spec?.scriptRequest?.hookPlanFingerprint) {
    throw new Error('Script plan artifact is stale for this planning task.');
  }
}

async function readCommittedHookPlan({ job, planningTask, hookAgent }) {
  if (!planningTask) throw new Error('Script planning is missing its Hook Agent dependency.');
  if (hookAgent?.live) {
    if (typeof hookAgent.readPersistedPlan !== 'function') throw new Error('Live Script Agent needs immutable Hook Plan readback.');
    const persisted = await hookAgent.readPersistedPlan({ task: planningTask, source: job.source });
    if (persisted?.hookPlan?.status !== 'selected') throw new Error('Script planning is blocked until the Hook Plan is selected.');
    return persisted.hookPlan;
  }
  const summary = (job.hookPlans || []).find((plan) => plan.taskId === planningTask.taskId);
  if (!summary || summary.status !== 'selected') throw new Error('Script planning is blocked until the Hook Plan is selected.');
  const renderTasks = (job.tasks || [])
    .filter((task) => task.kind === 'render' && task.outputType === 'ugc_ad')
    .sort((a, b) => String(a.spec?.unitId).localeCompare(String(b.spec?.unitId)));
  return {
    status: 'selected',
    planFingerprint: summary.planFingerprint,
    selectedHooks: renderTasks.map((task) => {
      const metadata = task.renderSpec?.script?.hookPlan || {};
      const hookBeat = (task.renderSpec?.script?.beats || []).find((beat) => beat.beatId === 'hook');
      const caption = (task.renderSpec?.timeline || []).find((layer) => layer.type === 'caption' && layer.role === 'hook');
      return {
        assignmentId: metadata.unitBinding?.assignmentId,
        candidateId: metadata.candidateId,
        spokenHook: hookBeat?.dialogue,
        caption: caption?.text,
        targetBehavior: metadata.targetBehavior || null,
        tension: metadata.tension || null,
        evidenceRefs: metadata.evidenceRefs || [],
        critic: metadata.critic || {},
        coldRead: metadata.coldRead || null,
      };
    }),
  };
}

async function assertSelectedScriptPlanForMedia(job, task, scriptAgent, hookAgent) {
  const planningTaskId = task.spec?.scriptPlanTaskId
    || task.renderSpec?.script?.scriptPlan?.taskId
    || (task.dependsOn || []).find((dependency) => dependency.endsWith('-ugc-script-plan'));
  const planningTask = job.tasks.find((candidate) => candidate.taskId === planningTaskId);
  const plan = (job.scriptPlans || []).find((candidate) => candidate.taskId === planningTaskId);
  const planAsset = (job.assets || []).find((asset) => asset.taskId === planningTaskId && asset.kind === 'ugc_script_plan');
  if (!planningTaskId || !planningTask || !plan || plan.status !== 'selected' || !planAsset) {
    throw new Error('UGC media is blocked until the Script Agent plan is selected and persisted.');
  }
  const taskFingerprint = task.spec?.scriptPlanFingerprint || task.renderSpec?.script?.scriptPlan?.planFingerprint;
  if (taskFingerprint !== plan.planFingerprint
    || plan.requestFingerprint !== planningTask.spec?.scriptRequest?.requestFingerprint
    || plan.hookPlanFingerprint !== planningTask.spec?.scriptRequest?.hookPlanFingerprint
    || planAsset.storageKey !== planningTask.output?.storageKey
    || planAsset.planFingerprint !== plan.planFingerprint
    || planAsset.requestFingerprint !== plan.requestFingerprint
    || planAsset.sourceFingerprint !== plan.sourceFingerprint
    || planAsset.hookPlanFingerprint !== plan.hookPlanFingerprint) {
    throw new Error('UGC media is blocked because its Script Agent plan or artifact is stale.');
  }

  if (scriptAgent?.live) {
    if (typeof scriptAgent.readPersistedPlan !== 'function') throw new Error('Live UGC media requires immutable Script Agent artifact readback support.');
    const hookPlan = await readCommittedHookPlan({ job, planningTask: job.tasks.find((candidate) => candidate.taskId === planningTask.spec?.hookPlanTaskId), hookAgent });
    const persisted = await scriptAgent.readPersistedPlan({ task: planningTask, source: job.source, hookPlan });
    if (persisted?.scriptPlan?.status !== 'selected'
      || persisted.scriptPlan.planFingerprint !== plan.planFingerprint
      || persisted.asset?.storageKey !== planAsset.storageKey
      || persisted.asset?.checksum !== planAsset.checksum) {
      throw new Error('UGC media is blocked because immutable Script Agent plan readback did not match the committed artifact.');
    }
    assertUgcUnitMatchesPersistedScript({ job, task, scriptPlan: persisted.scriptPlan });
  }
}

function assertUgcUnitMatchesPersistedScript({ job, task, scriptPlan }) {
  const unitId = task.spec?.unitId || task.renderSpec?.unitId;
  const renderTask = (job.tasks || []).find((candidate) => candidate.kind === 'render' && candidate.outputType === 'ugc_ad' && candidate.spec?.unitId === unitId);
  const metadata = renderTask?.renderSpec?.script?.scriptPlan;
  const selected = (scriptPlan.scripts || []).find((script) => script.assignmentId === metadata?.assignmentId);
  if (!unitId || !renderTask || !metadata || !selected) throw new Error('UGC media task is missing its persisted Script Agent unit binding.');
  const expectedSelectionHash = stableHash(JSON.stringify({
    planFingerprint: scriptPlan.planFingerprint,
    requestFingerprint: scriptPlan.requestFingerprint,
    sourceFingerprint: scriptPlan.sourceFingerprint,
    hookPlanFingerprint: scriptPlan.hookPlanFingerprint,
    assignmentId: selected.assignmentId,
    scriptFingerprint: selected.scriptFingerprint,
    beats: selected.beats,
    evidenceRefsByBeat: selected.evidenceRefsByBeat,
    evidenceVerification: selected.evidenceVerification,
    creatorPlan: selected.creatorPlan,
    critic: selected.critic,
  }));
  const renderedBeats = Object.fromEntries((renderTask.renderSpec?.script?.beats || []).map((beat) => [beat.beatId, beat.dialogue]));
  const expectedBeats = selected.beats;
  const taskSelectionHash = task.spec?.scriptSelectionHash || task.renderSpec?.renderManifest?.scriptSelectionHash || metadata.selectionHash;
  const segmentBeats = task.outputType === 'ugc_segment' ? (task.spec?.scriptBeats || []) : [];
  const segmentMatches = task.outputType !== 'ugc_segment'
    || segmentBeats.every((beat) => expectedBeats[beat.beatId] === beat.dialogue)
    && segmentBeats.map((beat) => beat.dialogue).filter(Boolean).join(' ') === String(task.spec?.spokenLine || '').trim();
  if (metadata.planFingerprint !== scriptPlan.planFingerprint
    || metadata.requestFingerprint !== scriptPlan.requestFingerprint
    || metadata.sourceFingerprint !== scriptPlan.sourceFingerprint
    || metadata.hookPlanFingerprint !== scriptPlan.hookPlanFingerprint
    || metadata.scriptFingerprint !== selected.scriptFingerprint
    || JSON.stringify(metadata.evidenceVerification || null) !== JSON.stringify(selected.evidenceVerification || null)
    || metadata.selectionHash !== expectedSelectionHash
    || taskSelectionHash !== expectedSelectionHash
    || renderTask.renderSpec?.renderManifest?.scriptSelectionHash !== expectedSelectionHash
    || JSON.stringify(renderedBeats) !== JSON.stringify(expectedBeats)
    || !segmentMatches) {
    throw new Error('UGC media task dialogue, creator plan, evidence assignment, or selection hash changed after Script Agent approval.');
  }
}

async function assertSelectedHookPlanForMedia(job, task, hookAgent) {
  const planningTaskId = task.spec?.hookPlanTaskId
    || task.renderSpec?.script?.hookPlan?.taskId
    || (task.dependsOn || []).find((dependency) => dependency.endsWith('-ugc-hook-plan'));
  const planningTask = job.tasks.find((candidate) => candidate.taskId === planningTaskId);
  const plan = (job.hookPlans || []).find((candidate) => candidate.taskId === planningTaskId);
  const planAsset = (job.assets || []).find((asset) => asset.taskId === planningTaskId && asset.kind === 'ugc_hook_plan');
  if (!planningTaskId || !planningTask || !plan || plan.status !== 'selected' || !planAsset) {
    throw new Error('UGC media is blocked until the shared Hook Agent plan is selected and persisted.');
  }
  if (plan.planFingerprint !== (task.spec?.hookPlanFingerprint || task.renderSpec?.script?.hookPlan?.planFingerprint)) {
    throw new Error('UGC media task is not bound to the persisted Hook Agent plan fingerprint.');
  }
  if (plan.requestFingerprint !== planningTask.spec?.hookRequest?.requestFingerprint) {
    throw new Error('UGC media task has a stale Hook Agent request fingerprint.');
  }
  if (planAsset.storageKey !== planningTask.output?.storageKey
    || planAsset.planFingerprint !== plan.planFingerprint
    || planAsset.requestFingerprint !== plan.requestFingerprint
    || planAsset.sourceFingerprint !== plan.sourceFingerprint) {
    throw new Error('UGC media is blocked because its Hook Agent artifact record is stale.');
  }

  // A job-document summary is not sufficient for live media. Re-read and
  // validate the immutable plan object immediately before every UGC source
  // call/render so a deleted, corrupted, or replaced object cannot be
  // bypassed by a previously committed summary.
  if (hookAgent?.live) {
    if (typeof hookAgent.readPersistedPlan !== 'function') {
      throw new Error('Live UGC media requires immutable Hook Agent artifact readback support.');
    }
    const persisted = await hookAgent.readPersistedPlan({ task: planningTask, source: job.source });
    if (persisted?.hookPlan?.status !== 'selected'
      || persisted.hookPlan.planFingerprint !== plan.planFingerprint
      || persisted.asset?.storageKey !== planAsset.storageKey
      || persisted.asset?.checksum !== planAsset.checksum) {
      throw new Error('UGC media is blocked because immutable Hook Agent plan readback did not match the committed artifact.');
    }
    assertUgcUnitMatchesPersistedHook({ job, task, hookPlan: persisted.hookPlan });
  }
}

function assertUgcUnitMatchesPersistedHook({ job, task, hookPlan }) {
  const unitId = task.spec?.unitId || task.renderSpec?.unitId;
  const renderTask = (job.tasks || []).find((candidate) => (
    candidate.kind === 'render'
    && candidate.outputType === 'ugc_ad'
    && (candidate.spec?.unitId || candidate.renderSpec?.unitId) === unitId
  ));
  const script = renderTask?.renderSpec?.script;
  const hookMetadata = script?.hookPlan;
  const selected = (hookPlan.selectedHooks || []).find((candidate) => candidate.candidateId === hookMetadata?.candidateId);
  const hookBeat = (script?.beats || []).find((beat) => beat.beatId === 'hook');
  const hookCaption = (renderTask?.renderSpec?.timeline || []).find((layer) => layer.type === 'caption' && layer.role === 'hook');
  if (!unitId || !renderTask || !selected || !hookMetadata?.unitBinding) {
    throw new Error('UGC media task is missing its persisted Hook Agent unit binding.');
  }
  const expectedSelectionHash = stableHash(JSON.stringify({
    planFingerprint: hookPlan.planFingerprint,
    requestFingerprint: hookPlan.requestFingerprint,
    sourceFingerprint: hookPlan.sourceFingerprint,
    unitBinding: hookMetadata.unitBinding,
    candidateId: selected.candidateId,
    spokenHook: selected.spokenHook,
    caption: selected.caption,
    targetBehavior: selected.targetBehavior || null,
    tension: selected.tension || null,
    evidenceRefs: selected.evidenceRefs,
    critic: selected.critic,
    coldRead: selected.coldRead || null,
  }));
  const taskSelectionHash = task.spec?.hookSelectionHash
    || task.renderSpec?.renderManifest?.hookSelectionHash
    || hookMetadata.selectionHash;
  const segmentBeats = task.outputType === 'ugc_segment' && Array.isArray(task.spec?.scriptBeats)
    ? task.spec.scriptBeats
    : [];
  const segmentHookBeat = segmentBeats.find((beat) => beat.beatId === 'hook') || null;
  const derivedSegmentLine = segmentBeats
    .map((beat) => String(beat?.dialogue || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  const segmentCopyIsIntact = task.outputType !== 'ugc_segment'
    || (derivedSegmentLine === String(task.spec?.spokenLine || '').replace(/\s+/g, ' ').trim()
      && (!segmentHookBeat || segmentHookBeat.dialogue === selected.spokenHook));
  const unitEvidence = new Set([
    job.source?.appSummary ? 'app_summary' : null,
    hookMetadata.unitBinding.claimId,
    ...(hookMetadata.unitBinding.proofIds || []),
  ].filter(Boolean));
  const supportedEvidence = new Set(selected.critic?.supportedEvidenceRefs || []);
  if (selected.assignmentId !== hookMetadata.unitBinding.assignmentId
    || hookMetadata.unitBinding.unitId !== unitId
    || selected.spokenHook !== hookBeat?.dialogue
    || selected.caption !== hookCaption?.text
    || hookMetadata.planFingerprint !== hookPlan.planFingerprint
    || hookMetadata.requestFingerprint !== hookPlan.requestFingerprint
    || hookMetadata.sourceFingerprint !== hookPlan.sourceFingerprint
    || JSON.stringify(hookMetadata.evidenceRefs || []) !== JSON.stringify(selected.evidenceRefs || [])
    || JSON.stringify(hookMetadata.critic || null) !== JSON.stringify(selected.critic || null)
    || JSON.stringify(hookMetadata.coldRead || null) !== JSON.stringify(selected.coldRead || null)
    || ![...unitEvidence].some((ref) => supportedEvidence.has(ref))
    || !segmentCopyIsIntact
    || taskSelectionHash !== expectedSelectionHash
    || hookMetadata.selectionHash !== expectedSelectionHash
    || script.hookQuality?.selectionHash !== expectedSelectionHash
    || renderTask.renderSpec?.renderManifest?.hookSelectionHash !== expectedSelectionHash) {
    throw new Error('UGC media task copy, caption, evidence assignment, or selection hash was changed after Hook Agent approval.');
  }
}

function assertTaskCreditCeiling(job, task) {
  const nextSpend = Number(job.costPlan?.spentCredits || 0) + Number(task.costUnits || 0);
  if (nextSpend > Number(job.costPlan?.reservedCredits || 0)) {
    throw new Error('Task refused before provider execution because the reserved-credit ceiling would be exceeded.');
  }
}

function recordTaskUsage(task, result = {}, { reuse = false } = {}) {
  const currentPlanning = Number(task.usage?.planningProviderCalls || 0);
  const currentGeneration = Number(task.usage?.generationProviderCalls || 0);
  const resultPlanning = Number(result.planningProviderCalls || 0);
  const resultGeneration = Number(result.providerCalls || 0);
  task.usage = {
    planningProviderCalls: reuse ? Math.max(currentPlanning, resultPlanning) : currentPlanning + resultPlanning,
    generationProviderCalls: reuse ? Math.max(currentGeneration, resultGeneration) : currentGeneration + resultGeneration,
    providerMutations: 0,
  };
}

function recomputeJobUsage(job) {
  job.creativeIntelligenceCalls = (job.tasks || []).reduce((total, task) => total + Number(task.usage?.planningProviderCalls || 0), 0);
  job.generationProviderCalls = (job.tasks || []).reduce((total, task) => total + Number(task.usage?.generationProviderCalls || 0), 0);
}

function upsertById(records, record, idField) {
  const index = records.findIndex((candidate) => candidate?.[idField] === record?.[idField]);
  if (index >= 0) records[index] = record;
  else records.push(record);
}

function finalizeJobRecord(job, tasksById, now) {
  const createdAt = isoNow(now);
  job.drafts = job.qaReports
    .filter((report) => ['image_ad', 'ugc_ad'].includes(report.outputType))
    .map((report) => {
      const targetTask = tasksById.get(report.targetTaskId);
      const asset = job.assets.find((candidate) => candidate.taskId === report.targetTaskId) || null;
      return buildDraftRecord({ job, targetTask, asset, qaReport: report, createdAt });
    });

  const failed = job.tasks.some((task) => task.status === 'failed');
  const held = job.qaReports.some((report) => report.verdict !== 'pass');
  job.status = failed ? 'failed' : held ? 'completed_with_holds' : 'completed';
  job.updatedAt = createdAt;
  job.providerMutations = 0;
}

function maxAttempts(job) {
  return job.tasks.reduce((most, task) => Math.max(most, task.maxAttempts || 1), 1);
}
