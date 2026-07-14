/* Durable provider-neutral adapter for Hook Agent planning.

   The adapter owns read-before-generate resume semantics around a stable
   tenant-scoped plan key. A Cloud Task retry after the plan object was stored
   but before the job document was saved reuses the immutable artifact and
   makes zero new intelligence calls. */

import { sha256 } from './asset-store.mjs';
import {
  assertHookRequestMatchesSource,
  runHookAgent,
  validateHookPlanForRequest,
} from './hook-agent.mjs';

export function createPersistedHookAgentAdapter({
  assetStore,
  generateJson,
  recordBlocker = () => {},
  live = true,
  id = 'hook-intelligence-durable',
} = {}) {
  if (!assetStore || typeof assetStore.exists !== 'function' || typeof assetStore.getObject !== 'function' || typeof assetStore.putObject !== 'function') {
    throw new Error('Durable Hook Agent needs an asset store with exists/getObject/putObject.');
  }
  if (typeof generateJson !== 'function') {
    throw new Error('Durable Hook Agent needs a structured-text generator.');
  }
  if (live && typeof assetStore.putObjectIfAbsent !== 'function') {
    throw new Error('Live durable Hook Agent needs conditional-create storage semantics.');
  }

  return {
    id,
    capability: 'hook_intelligence',
    live,
    async readPersistedPlan({ task, source }) {
      const request = task?.spec?.hookRequest;
      assertHookRequestMatchesSource({ source, request });
      const cached = await readCachedPlan({ assetStore, task, request });
      if (!cached) {
        throw new Error('Persisted Hook Agent plan object is missing.');
      }
      return planResult({ task, plan: cached.plan, bytes: cached.bytes, reusedArtifact: true });
    },
    async planHooks({ task, source }) {
      const request = task?.spec?.hookRequest;
      assertHookRequestMatchesSource({ source, request });

      const cached = await readCachedPlan({ assetStore, task, request });
      if (cached) {
        return planResult({ task, plan: cached.plan, bytes: cached.bytes, reusedArtifact: true });
      }

      let plan;
      try {
        plan = await runHookAgent({
          source,
          request,
          generateJson,
        });
      } catch (error) {
        const neutral = new Error('Hook planning is temporarily unavailable.');
        neutral.planningProviderCalls = Number(error.hookAgentMetrics?.intelligenceCallCount || 0);
        neutral.hookAgentMetrics = error.hookAgentMetrics || null;
        recordBlocker({
          taskId: task.taskId,
          capability: 'hook_intelligence',
          stage: 'creative_planning',
          detail: error.message,
          planningProviderCalls: neutral.planningProviderCalls,
        });
        throw neutral;
      }

      validateHookPlanForRequest({ plan, request, allowHeld: true });
      const bytes = Buffer.from(JSON.stringify(plan, null, 2));
      const planningProviderCalls = Number(plan.intelligenceUsage?.intelligenceCallCount || 0);
      try {
        const stored = typeof assetStore.putObjectIfAbsent === 'function'
          ? await assetStore.putObjectIfAbsent({
            storageKey: task.output.storageKey,
            bytes,
            contentType: task.output.contentType,
          })
          : { ...(await assetStore.putObject({ storageKey: task.output.storageKey, bytes, contentType: task.output.contentType })), created: true };
        if (stored.created === false) {
          const winner = await readCachedPlan({ assetStore, task, request });
          return planResult({
            task,
            plan: winner.plan,
            bytes: winner.bytes,
            reusedArtifact: true,
            planningProviderCallsOverride: planningProviderCalls,
          });
        }
        const readback = await readCachedPlan({ assetStore, task, request });
        if (sha256(readback.bytes) !== sha256(bytes) || readback.plan.planFingerprint !== plan.planFingerprint) {
          throw new Error('Hook Plan conditional-create readback did not match the generated artifact.');
        }
        return planResult({ task, plan: readback.plan, bytes: readback.bytes, reusedArtifact: false });
      } catch (error) {
        const neutral = new Error(`Hook planning artifact could not be persisted safely: ${error.message}`);
        neutral.planningProviderCalls = planningProviderCalls;
        throw neutral;
      }
    },
  };
}

async function readCachedPlan({ assetStore, task, request }) {
  if (!(await assetStore.exists(task.output.storageKey))) return null;
  let bytes;
  let plan;
  try {
    bytes = await assetStore.getObject(task.output.storageKey);
    plan = JSON.parse(Buffer.from(bytes).toString('utf8'));
    validateHookPlanForRequest({ plan, request, allowHeld: true });
  } catch (error) {
    throw new Error(`Stored Hook Agent plan failed immutable readback: ${error.message}`);
  }
  return { bytes: Buffer.from(bytes), plan };
}

function planResult({ task, plan, bytes, reusedArtifact, planningProviderCallsOverride = null }) {
  return {
    hookPlan: plan,
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
      bytes: bytes.byteLength,
      checksum: sha256(bytes),
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      requestFingerprint: plan.requestFingerprint,
      sourceFingerprint: plan.sourceFingerprint,
      mode: 'intelligence_plan',
      reusedArtifact,
      providerMutations: 0,
    },
    costUnits: 0,
    planningProviderCalls: planningProviderCallsOverride === null
      ? Number(plan.intelligenceUsage?.intelligenceCallCount || 0)
      : Number(planningProviderCallsOverride || 0),
    providerCalls: 0,
    reusedArtifact,
    taskFailure: plan.status === 'held'
      ? `Hook planning held before media generation: ${(plan.holdReasons || []).slice(0, 3).join(' | ') || 'semantic quality threshold not met'}`
      : null,
    providerMutations: 0,
  };
}
