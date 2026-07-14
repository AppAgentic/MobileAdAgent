/* Durable provider-neutral adapter for evidence-bound UGC Script plans. */

import { sha256 } from './asset-store.mjs';
import {
  assertScriptRequestMatchesSource,
  runScriptAgent,
  validateScriptPlanForRequest,
} from './script-agent.mjs';

export function createPersistedScriptAgentAdapter({
  assetStore,
  generateJson,
  recordBlocker = () => {},
  live = true,
  id = 'script-intelligence-durable',
} = {}) {
  if (!assetStore || typeof assetStore.exists !== 'function' || typeof assetStore.getObject !== 'function' || typeof assetStore.putObject !== 'function') {
    throw new Error('Durable Script Agent needs an asset store with exists/getObject/putObject.');
  }
  if (typeof generateJson !== 'function') throw new Error('Durable Script Agent needs a structured-text generator.');
  if (live && typeof assetStore.putObjectIfAbsent !== 'function') throw new Error('Live durable Script Agent needs conditional-create storage semantics.');

  return {
    id,
    capability: 'script_intelligence',
    live,
    async readPersistedPlan({ task, source, hookPlan }) {
      const request = task?.spec?.scriptRequest;
      assertScriptRequestMatchesSource({ source, hookPlan, request });
      const cached = await readCachedPlan({ assetStore, task, request });
      if (!cached) throw new Error('Persisted Script Agent plan object is missing.');
      return planResult({ task, plan: cached.plan, bytes: cached.bytes, reusedArtifact: true });
    },
    async planScripts({ task, source, hookPlan }) {
      const request = task?.spec?.scriptRequest;
      assertScriptRequestMatchesSource({ source, hookPlan, request });
      const cached = await readCachedPlan({ assetStore, task, request });
      if (cached) return planResult({ task, plan: cached.plan, bytes: cached.bytes, reusedArtifact: true });

      let plan;
      try {
        plan = await runScriptAgent({ source, hookPlan, request, generateJson });
      } catch (error) {
        const neutral = new Error('Script planning is temporarily unavailable.');
        neutral.planningProviderCalls = Number(error.scriptAgentMetrics?.intelligenceCallCount || 0);
        neutral.scriptAgentMetrics = error.scriptAgentMetrics || null;
        recordBlocker({
          taskId: task.taskId,
          capability: 'script_intelligence',
          stage: 'creative_planning',
          detail: error.message,
          planningProviderCalls: neutral.planningProviderCalls,
        });
        throw neutral;
      }

      validateScriptPlanForRequest({ plan, request, allowHeld: true });
      const bytes = Buffer.from(JSON.stringify(plan, null, 2));
      const planningProviderCalls = Number(plan.intelligenceUsage?.intelligenceCallCount || 0);
      try {
        const stored = typeof assetStore.putObjectIfAbsent === 'function'
          ? await assetStore.putObjectIfAbsent({ storageKey: task.output.storageKey, bytes, contentType: task.output.contentType })
          : { ...(await assetStore.putObject({ storageKey: task.output.storageKey, bytes, contentType: task.output.contentType })), created: true };
        if (stored.created === false) {
          const winner = await readCachedPlan({ assetStore, task, request });
          return planResult({ task, plan: winner.plan, bytes: winner.bytes, reusedArtifact: true, planningProviderCallsOverride: planningProviderCalls });
        }
        const readback = await readCachedPlan({ assetStore, task, request });
        if (sha256(readback.bytes) !== sha256(bytes) || readback.plan.planFingerprint !== plan.planFingerprint) {
          throw new Error('Script Plan conditional-create readback did not match the generated artifact.');
        }
        return planResult({ task, plan: readback.plan, bytes: readback.bytes, reusedArtifact: false });
      } catch (error) {
        const neutral = new Error(`Script planning artifact could not be persisted safely: ${error.message}`);
        neutral.planningProviderCalls = planningProviderCalls;
        throw neutral;
      }
    },
  };
}
async function readCachedPlan({ assetStore, task, request }) {
  if (!(await assetStore.exists(task.output.storageKey))) return null;
  try {
    const bytes = Buffer.from(await assetStore.getObject(task.output.storageKey));
    const plan = JSON.parse(bytes.toString('utf8'));
    validateScriptPlanForRequest({ plan, request, allowHeld: true });
    return { bytes, plan };
  } catch (error) {
    throw new Error(`Stored Script Agent plan failed immutable readback: ${error.message}`);
  }
}

function planResult({ task, plan, bytes, reusedArtifact, planningProviderCallsOverride = null }) {
  return {
    scriptPlan: plan,
    asset: {
      assetId: `${task.taskId}-asset`, taskId: task.taskId, jobId: task.jobId, packId: task.packId,
      orgId: task.orgId, workspaceId: task.workspaceId, appId: task.appId,
      kind: 'ugc_script_plan', storageKey: task.output.storageKey, contentType: task.output.contentType,
      bytes: bytes.byteLength, checksum: sha256(bytes), planId: plan.planId,
      planFingerprint: plan.planFingerprint, requestFingerprint: plan.requestFingerprint,
      sourceFingerprint: plan.sourceFingerprint, hookPlanFingerprint: plan.hookPlanFingerprint,
      mode: 'intelligence_plan', reusedArtifact, providerMutations: 0,
    },
    costUnits: 0,
    planningProviderCalls: planningProviderCallsOverride === null
      ? Number(plan.intelligenceUsage?.intelligenceCallCount || 0)
      : Number(planningProviderCallsOverride || 0),
    providerCalls: 0,
    reusedArtifact,
    taskFailure: plan.status === 'held'
      ? `Script planning held before media generation: ${(plan.holdReasons || []).slice(0, 3).join(' | ') || 'quality threshold not met'}`
      : null,
    providerMutations: 0,
  };
}
