/* Generation/render adapter interfaces for the creative job runner.

   Adapters are addressed by neutral capability ids so provider/model names
   never reach job payloads. Local/mock adapters are the default everywhere;
   live adapters only activate behind explicit env flags AND an injected
   worker runtime (secret resolver + asset store), and never run during
   tests:

   - MAA_LIVE_ADAPTERS_ENABLED=1   master switch (off by default)
   - MAA_IMAGE_ADAPTER=live        image ad source path (first canary)
   - MAA_UGC_FRAME_ADAPTER=live    UGC shared first-frame source path
   - MAA_UGC_ADAPTER=live          UGC creator-block source path
   - MAA_RENDER_ADAPTER=local|hosted  finishing/composition backend

   Contract:
   - imageAd.generateImageAd({ task, source })    -> { asset, costUnits, providerCalls }
   - ugcFirstFrame.generateFirstFrame({ task, source }) -> { asset, costUnits, providerCalls }
   - ugcSegment.generateSegment({ task, source, inputAssets }) -> { asset, costUnits, providerCalls }
   - render.renderComposition({ task, inputAssets }) -> { asset, costUnits }
   Every returned asset is a stored-asset record (storage key, media shape),
   never raw media bytes or signed URLs.

   The runtime options object is how a hosted worker supplies credentials
   and storage without any adapter reading .env files or logging secrets:
     { secretResolver({ purpose }) -> apiKey, assetStore, workDir, ledger } */

import { stableHash } from './tenant-model.mjs';
import { buildLocalMockHookPlan } from './hook-agent.mjs';
import { createPersistedHookAgentAdapter } from './hook-agent-adapter.mjs';
import { buildLocalMockScriptPlan } from './script-agent.mjs';
import { createPersistedScriptAgentAdapter } from './script-agent-adapter.mjs';
import { createLiveGenerationAdapters } from './live-generation.mjs';
import { createHostedFinishingBackend, createLocalFinishingBackend } from './render-backend.mjs';

export function resolveGenerationAdapters(env = process.env, runtime = {}) {
  return {
    hookAgent: createHookAgentAdapter({ env, runtime }),
    scriptAgent: createScriptAgentAdapter({ env, runtime }),
    imageAd: createImageAdAdapter({ env, runtime }),
    ugcFirstFrame: createUgcFirstFrameAdapter({ env, runtime }),
    ugcSegment: createUgcSegmentAdapter({ env, runtime }),
    render: createRenderAdapter({ env, runtime }),
  };
}

export function createScriptAgentAdapter({ env = process.env, runtime = {}, mode } = {}) {
  const resolved = mode || env.MAA_SCRIPT_ADAPTER || (env.MAA_UGC_ADAPTER === 'live' ? 'live' : 'mock');
  if (resolved === 'live') {
    if (typeof runtime.scriptGenerateJson === 'function') {
      requireLiveAssetRuntime({ env, runtime, capability: 'script_intelligence' });
      return createPersistedScriptAgentAdapter({
        assetStore: runtime.assetStore,
        generateJson: runtime.scriptGenerateJson,
        recordBlocker: (blocker) => runtime.ledger?.recordBlocker?.(blocker),
        live: true,
        id: 'script-intelligence-injected',
      });
    }
    requireLiveRuntime({ env, runtime, capability: 'script_intelligence' });
    return liveAdapters({ env, runtime }).scriptAgent;
  }
  return {
    id: 'script-intelligence-local-mock',
    capability: 'script_intelligence',
    live: false,
    async planScripts({ task, source, hookPlan }) {
      const scriptPlan = buildLocalMockScriptPlan({ source, hookPlan, request: task.spec.scriptRequest });
      return {
        scriptPlan,
        asset: {
          ...mockAssetRecord({ task, kind: 'ugc_script_plan', contentType: task.output.contentType, bytes: Buffer.byteLength(JSON.stringify(scriptPlan)) }),
          planId: scriptPlan.planId,
          planFingerprint: scriptPlan.planFingerprint,
          requestFingerprint: scriptPlan.requestFingerprint,
          sourceFingerprint: scriptPlan.sourceFingerprint,
          hookPlanFingerprint: scriptPlan.hookPlanFingerprint,
        },
        costUnits: 0,
        providerCalls: 0,
        providerMutations: 0,
      };
    },
  };
}

export function createHookAgentAdapter({ env = process.env, runtime = {}, mode } = {}) {
  const resolved = mode || env.MAA_HOOK_ADAPTER || (env.MAA_UGC_ADAPTER === 'live' ? 'live' : 'mock');
  if (resolved === 'live') {
    if (typeof runtime.hookGenerateJson === 'function') {
      requireLiveAssetRuntime({ env, runtime, capability: 'hook_intelligence' });
      return createPersistedHookAgentAdapter({
        assetStore: runtime.assetStore,
        generateJson: runtime.hookGenerateJson,
        recordBlocker: (blocker) => runtime.ledger?.recordBlocker?.(blocker),
        live: true,
        id: 'hook-intelligence-injected',
      });
    }
    requireLiveRuntime({ env, runtime, capability: 'hook_intelligence' });
    return liveAdapters({ env, runtime }).hookAgent;
  }
  return {
    id: 'hook-intelligence-local-mock',
    capability: 'hook_intelligence',
    live: false,
    async planHooks({ task, source }) {
      const hookPlan = buildLocalMockHookPlan({ source, outputCount: task.spec.outputCount, request: task.spec.hookRequest });
      return {
        hookPlan,
        asset: {
          ...mockAssetRecord({
            task,
            kind: 'ugc_hook_plan',
            contentType: task.output.contentType,
            bytes: Buffer.byteLength(JSON.stringify(hookPlan)),
          }),
          planId: hookPlan.planId,
          planFingerprint: hookPlan.planFingerprint,
          requestFingerprint: hookPlan.requestFingerprint,
          sourceFingerprint: hookPlan.sourceFingerprint,
        },
        costUnits: 0,
        providerCalls: 0,
        providerMutations: 0,
      };
    },
  };
}

function requireLiveAssetRuntime({ env, runtime, capability }) {
  if (env.MAA_LIVE_ADAPTERS_ENABLED !== '1') {
    throw new Error(`Live ${capability} adapter requested without MAA_LIVE_ADAPTERS_ENABLED=1. Use the local/mock adapter for validation.`);
  }
  if (!runtime.assetStore) {
    throw new Error(`Live ${capability} adapter needs the worker asset-store runtime.`);
  }
}

function requireLiveRuntime({ env, runtime, capability }) {
  if (env.MAA_LIVE_ADAPTERS_ENABLED !== '1') {
    throw new Error(`Live ${capability} adapter requested without MAA_LIVE_ADAPTERS_ENABLED=1. Use the local/mock adapter for validation.`);
  }
  if (typeof runtime.secretResolver !== 'function' || !runtime.assetStore) {
    throw new Error(`Live ${capability} adapter needs the worker runtime (secret resolver + asset store). Credentials are held in memory by the hosted worker, never by tests.`);
  }
}

export function createImageAdAdapter({ env = process.env, runtime = {}, mode } = {}) {
  const resolved = mode || env.MAA_IMAGE_ADAPTER || 'mock';
  if (resolved === 'live') {
    requireLiveRuntime({ env, runtime, capability: 'image_ad' });
    return liveAdapters({ env, runtime }).imageAd;
  }
  return {
    id: 'image-ad-local-mock',
    capability: 'image_ad',
    live: false,
    async generateImageAd({ task }) {
      const { width, height } = task.spec.dimensions;
      return {
        asset: mockAssetRecord({
          task,
          kind: task.outputType,
          contentType: task.output.contentType,
          width,
          height,
          bytes: 180_000 + (parseInt(stableHash(task.taskId).slice(0, 4), 16) % 90_000),
        }),
        costUnits: task.costUnits,
        providerCalls: 0,
        providerMutations: 0,
      };
    },
  };
}

export function createUgcFirstFrameAdapter({ env = process.env, runtime = {}, mode } = {}) {
  const resolved = mode || env.MAA_UGC_FRAME_ADAPTER || env.MAA_UGC_ADAPTER || 'mock';
  if (resolved === 'live') {
    requireLiveRuntime({ env, runtime, capability: 'ugc_creator_frame' });
    return liveAdapters({ env, runtime }).ugcFirstFrame;
  }
  return {
    id: 'ugc-creator-frame-local-mock',
    capability: 'ugc_creator_frame',
    live: false,
    async generateFirstFrame({ task }) {
      const { width, height } = task.spec.dimensions;
      return {
        asset: mockAssetRecord({
          task,
          kind: 'ugc_first_frame',
          contentType: task.output.contentType,
          width,
          height,
          bytes: 240_000 + (parseInt(stableHash(task.taskId).slice(0, 4), 16) % 80_000),
        }),
        costUnits: task.costUnits,
        providerCalls: 0,
        providerMutations: 0,
      };
    },
  };
}

export function createUgcSegmentAdapter({ env = process.env, runtime = {}, mode } = {}) {
  const resolved = mode || env.MAA_UGC_ADAPTER || 'mock';
  if (resolved === 'live') {
    requireLiveRuntime({ env, runtime, capability: 'ugc_creator_block' });
    return liveAdapters({ env, runtime }).ugcSegment;
  }
  return {
    id: 'ugc-creator-block-local-mock',
    capability: 'ugc_creator_block',
    live: false,
    async generateSegment({ task }) {
      const windowSeconds = Math.max(2, Math.round(task.spec.endSeconds - task.spec.startSeconds));
      const durationSeconds = [4, 6, 8].find((allowed) => allowed >= windowSeconds) || 8;
      return {
        asset: mockAssetRecord({
          task,
          kind: 'ugc_segment',
          contentType: task.output.contentType,
          width: task.spec.dimensions.width,
          height: task.spec.dimensions.height,
          durationSeconds,
          bytes: 900_000 * durationSeconds,
        }),
        costUnits: task.costUnits,
        providerCalls: 0,
        providerMutations: 0,
      };
    },
  };
}

export function createRenderAdapter({ env = process.env, runtime = {}, mode } = {}) {
  const resolved = mode || env.MAA_RENDER_ADAPTER || 'mock';
  if (resolved === 'local') {
    if (!runtime.assetStore || !runtime.workDir) {
      throw new Error('Local finishing backend needs the worker runtime (asset store + workDir).');
    }
    return createLocalFinishingBackend({
      assetStore: runtime.assetStore,
      workDir: runtime.workDir,
      rendererBin: runtime.rendererBin,
      renderTimeoutMs: positiveNumber(runtime.renderTimeoutMs || env.MAA_RENDER_TIMEOUT_MS, 420_000),
      softwareRender: runtime.softwareRender ?? env.MAA_RENDER_SOFTWARE === '1',
      lowMemoryMode: runtime.lowMemoryMode ?? env.MAA_RENDER_LOW_MEMORY === '1',
      renderWorkers: positiveInteger(runtime.renderWorkers || env.MAA_RENDER_WORKERS, null),
      ledger: runtime.ledger || null,
    });
  }
  if (resolved === 'hosted') {
    requireLiveRuntime({ env, runtime, capability: 'finishing_compositor' });
    return createHostedFinishingBackend({ env, secretResolver: runtime.secretResolver, ledger: runtime.ledger || null });
  }
  if (resolved === 'live') {
    // Back-compat alias: "live" render means the hosted finishing backend.
    requireLiveRuntime({ env, runtime, capability: 'finishing_compositor' });
    return createHostedFinishingBackend({ env, secretResolver: runtime.secretResolver, ledger: runtime.ledger || null });
  }
  return {
    id: 'finishing-compositor-local-mock',
    capability: 'finishing_compositor',
    live: false,
    async renderComposition({ task, inputAssets }) {
      const spec = task.renderSpec;
      if (!spec?.compositionKey || !spec?.outputKey) {
        throw new Error('Render task is missing its composition contract.');
      }
      const missing = (task.dependsOn || []).filter((dep) => !inputAssets.some((asset) => asset.taskId === dep));
      if (missing.length) {
        throw new Error(`Render inputs are incomplete: ${missing.join(', ')}`);
      }
      const isImage = spec.format === 'image';
      return {
        asset: {
          ...mockAssetRecord({
            task,
            kind: task.outputType,
            contentType: task.output.contentType,
            width: spec.dimensions.width,
            height: spec.dimensions.height,
            durationSeconds: isImage ? null : spec.durationSeconds,
            bytes: isImage ? 320_000 : 2_400_000,
          }),
          ...(isImage ? {} : { fps: spec.fps }),
          inputAssetIds: inputAssets.map((asset) => asset.assetId),
        },
        costUnits: task.costUnits,
        providerCalls: 0,
        providerMutations: 0,
      };
    },
  };
}

/* Live source-generation adapters are built once per resolve call so the
   image and UGC paths share one provider client, ledger, and secret. */
const liveAdapterCache = new WeakMap();
function liveAdapters({ env, runtime }) {
  const cacheKey = runtime;
  if (!liveAdapterCache.has(cacheKey)) {
    liveAdapterCache.set(cacheKey, createLiveGenerationAdapters({
      env,
      secretResolver: runtime.secretResolver,
      assetStore: runtime.assetStore,
      ledger: runtime.ledger,
    }));
  }
  return liveAdapterCache.get(cacheKey);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function mockAssetRecord({ task, kind, contentType, width = null, height = null, durationSeconds = null, bytes = null }) {
  return {
    assetId: `${task.taskId}-asset`,
    taskId: task.taskId,
    jobId: task.jobId,
    packId: task.packId,
    orgId: task.orgId,
    workspaceId: task.workspaceId,
    appId: task.appId,
    kind,
    storageKey: task.output.storageKey,
    contentType,
    width,
    height,
    durationSeconds,
    bytes,
    checksum: `mock-${stableHash(`${task.taskId}:${kind}`)}`,
    mode: 'local_mock',
    providerMutations: 0,
  };
}
