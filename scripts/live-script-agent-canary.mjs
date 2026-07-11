#!/usr/bin/env node
/* Planning-only universal Script Agent canary. No media/render calls. */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createLocalAssetStore } from '../lib/asset-store.mjs';
import { createPersistedScriptAgentAdapter } from '../lib/script-agent-adapter.mjs';
import { buildScriptPlanningRequest, validateScriptPlanForRequest } from '../lib/script-agent.mjs';
import { createGeminiMediaClient } from '../lib/providers/gemini-media.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
for (const arg of process.argv.slice(2)) if (arg !== '--live') throw new Error(`Unknown argument ${arg}`);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(ROOT, 'artifacts', 'live-script-agent-canary', timestamp);
const assetStore = createLocalAssetStore({ rootDir: path.join(outDir, 'assets') });
const calls = [];
let key = null;

function secret() {
  if (key === null) {
    key = execFileSync('security', ['find-generic-password', '-s', 'mobileadagent-gemini-api-key', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
  if (!key) throw new Error('Script Agent canary credential is unavailable.');
  return key;
}

const client = live ? createGeminiMediaClient({
  apiKey: secret(), timeoutMs: Number(process.env.MAA_GENERATION_TIMEOUT_MS || 180_000),
  onCall: (entry) => calls.push({ kind: entry.kind, method: entry.method, status: entry.status }),
}) : null;

const fixtures = [
  fixture({
    id: 'label-scanner', appName: 'Zorbly', category: 'Unexpected Utility',
    summary: 'Scan a product label and get the useful details in one readable result.',
    claim: 'Scan product labels and review the extracted details.',
    screen: 'Extracted label details shown in a clear list.',
    hook: 'You scan the label, then still search for the answer.',
  }),
  fixture({
    id: 'plant-sound-comparison', appName: 'MoonMoss', category: 'Bioluminescent Home Rituals',
    summary: 'Use short sound recordings to compare how a houseplant changes across daily check-ins.',
    claim: 'Compare short plant sound recordings across daily check-ins.',
    screen: 'Two dated plant sound recordings shown side by side.',
    hook: 'Your plant sounds different today, but would you actually notice?',
  }),
];

await fs.mkdir(outDir, { recursive: true });
const results = [];
for (const item of fixtures) results.push(await runFixture(item));
const report = {
  schemaVersion: 'universal-script-agent-canary.v1', mode: live ? 'live' : 'dry_run',
  status: 'passed', fixtureResults: results,
  creativeIntelligenceCalls: results.reduce((sum, result) => sum + result.intelligenceCalls, 0),
  generationProviderCalls: 0, renderCalls: 0, providerMutations: 0,
  providerCallLog: calls,
};
if (live && calls.filter((call) => call.kind === 'intelligence').length !== report.creativeIntelligenceCalls) {
  throw new Error('Live provider-call accounting does not match persisted Script Plans.');
}
if (calls.some((call) => call.kind !== 'intelligence')) throw new Error('Planning-only canary attempted a media call.');
await fs.writeFile(path.join(outDir, 'canary-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, mode: report.mode, report: path.relative(ROOT, path.join(outDir, 'canary-report.json')), fixtures: results, generationProviderCalls: 0, providerMutations: 0 }, null, 2));

async function runFixture(item) {
  const request = buildScriptPlanningRequest({ source: item.source, hookPlan: item.hookPlan, unitBindings: item.unitBindings });
  const task = {
    taskId: `job-${item.id}-ugc-script-plan`, jobId: `job-${item.id}`, packId: `pack-${item.id}`,
    orgId: 'org-script-canary', workspaceId: 'ws-script-canary', appId: item.source.appId,
    spec: { scriptRequest: request },
    output: { storageKey: `orgs/org-script-canary/workspaces/ws-script-canary/apps/${item.source.appId}/plans/script-plan.json`, contentType: 'application/json' },
  };
  const adapter = createPersistedScriptAgentAdapter({
    assetStore, live,
    generateJson: async ({ stage, prompt, schema }) => {
      if (client) return client.generateJson({ prompt, schema, model: process.env.MAA_SCRIPT_TEXT_MODEL || process.env.MAA_HOOK_TEXT_MODEL || 'gemini-3.5-flash', label: stage });
      return deterministicResponse({ stage, item });
    },
  });
  const first = await adapter.planScripts({ task, source: item.source, hookPlan: item.hookPlan });
  validateScriptPlanForRequest({ plan: first.scriptPlan, request, allowHeld: false });
  let resumeCalls = 0;
  const retry = createPersistedScriptAgentAdapter({ assetStore, live, generateJson: async () => { resumeCalls += 1; throw new Error('retry must read persisted plan'); } });
  const resumed = await retry.planScripts({ task, source: item.source, hookPlan: item.hookPlan });
  if (!resumed.reusedArtifact || resumeCalls !== 0 || resumed.scriptPlan.planFingerprint !== first.scriptPlan.planFingerprint) throw new Error(`${item.id}: persisted resume failed.`);
  const script = first.scriptPlan.scripts[0];
  return {
    fixtureId: item.id, reviewedCategory: item.source.appCategory, status: first.scriptPlan.status,
    planFingerprint: first.scriptPlan.planFingerprint, hookPlanFingerprint: first.scriptPlan.hookPlanFingerprint,
    intelligenceCalls: first.scriptPlan.intelligenceUsage.intelligenceCallCount,
    selectedScript: script.beats, creatorPlan: script.creatorPlan,
    persistedResumeCalls: resumeCalls, providerMutations: 0,
  };
}

function fixture({ id, appName, category, summary, claim, screen, hook }) {
  const assignmentId = 'ugc-1';
  const source = {
    appId: `app-${id}`, appName, appCategory: category, appSummary: summary,
    claims: [{ id: 'claim-1', text: claim }], screens: [{ id: 'screen-1', label: 'Reviewed app screen', detail: screen }],
    angles: [], audienceNotes: [], learningNotes: [], styleNotes: ['Plain language, socially native, no hype.'],
  };
  const hookPlan = {
    status: 'selected', planFingerprint: `hook-plan-${id}`,
    selectedHooks: [{
      assignmentId, candidateId: `hook-${id}`, spokenHook: hook, caption: 'what was I missing?',
      targetBehavior: hook, tension: hook, evidenceRefs: ['app_summary'],
      critic: { supportedEvidenceRefs: ['app_summary'], claimSafety: 5 },
    }],
  };
  return { id, source, hookPlan, unitBindings: [{ assignmentId, unitId: `unit-${id}`, claimId: 'claim-1', proofIds: ['screen-1'] }] };
}

function deterministicResponse({ stage, item }) {
  const binding = item.unitBindings[0];
  if (stage === 'script_writer') return { scripts: [{
    assignmentId: binding.assignmentId,
    beats: {
      hook: item.hookPlan.selectedHooks[0].spokenHook,
      tension: 'I kept running into the same problem without a clear next step.',
      bridge: 'Then I tried looking at the same information in one clearer view.',
      payload: item.source.claims[0].text,
      proof_voice: `This screen shows ${item.source.screens[0].detail.toLowerCase()}`,
      reinforcement: 'That made the next decision much easier for me.',
      reaction: `It is called ${item.source.appName}. I would try it on the annoying example first.`,
    },
    evidenceRefsByBeat: { tension: ['app_summary'], bridge: ['app_summary'], payload: ['claim-1'], proof_voice: ['screen-1'], reinforcement: ['claim-1'], reaction: ['app_summary'] },
    creatorPlan: {
      setting: 'ordinary room near the object being discussed', framing: 'handheld front-camera selfie at arm length', persona: 'plausible everyday user', wardrobe: 'plain unbranded everyday clothes', emotionalArc: 'friction to useful clarity', startingEmotion: 'mildly frustrated', endingEmotion: 'relieved but conversational',
      firstFramePrompt: 'Paused front-camera phone-video frame, ordinary flat light, imperfect crop, natural skin texture, scene mostly in focus, no factual screen content. The recording phone is the camera and remains out of frame; no second phone or visible device.',
      negativePrompt: 'visible phone, visible device, second phone, studio portrait, beauty lighting, shallow bokeh, polished commercial, text, logos, extra people',
      continuityAnchors: ['same person', 'same clothing', 'same room', 'same camera distance'],
    },
  }] };
  if (stage === 'script_evidence_verifier') return { verifications: [{
    assignmentId: binding.assignmentId, verdict: 'pass', reason: 'Every beat is directly supported or connective.',
    beatSupport: ['tension', 'bridge', 'payload', 'proof_voice', 'reinforcement', 'reaction'].map((beatId) => ({
      beatId, supported: true,
      evidenceRefs: beatId === 'proof_voice' ? ['screen-1'] : beatId === 'payload' || beatId === 'reinforcement' ? ['claim-1'] : ['app_summary'],
      unsupportedSpans: [], reason: 'Supported.',
    })),
  }] };
  if (stage === 'script_critic') return { reviews: [{
    assignmentId: binding.assignmentId, verdict: 'pass', hookContinuity: 5, topicCoherence: 5, evidenceAlignment: 5,
    proofAlignment: 5, nativeVoice: 5, arcStrength: 5, claimSafety: 5,
    supportedEvidenceRefs: ['app_summary', 'claim-1', 'screen-1'], unsupportedSpans: [], reason: 'Fully evidence-bound and coherent.',
  }] };
  throw new Error(`Unexpected stage ${stage}`);
}
