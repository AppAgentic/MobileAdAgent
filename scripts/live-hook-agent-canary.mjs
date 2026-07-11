#!/usr/bin/env node
/* Persisted Hook Agent canary.
 *
 * Safe default:
 *   node scripts/live-hook-agent-canary.mjs
 *
 * Explicit live structured-intelligence run:
 *   node scripts/live-hook-agent-canary.mjs --live
 *
 * This script deliberately imports and invokes only the persisted Hook Agent
 * planning adapter. It never resolves a creative job, image/video adapter, or
 * render backend. Both modes use two unrelated, reviewed app fixtures and a
 * tenant-scoped local asset store. Dry mode supplies deterministic structured
 * writer/reader/critic responses; live mode uses the existing structured JSON
 * provider. No media provider or downstream ad state is touched.
 *
 * The live API key is read from the macOS keychain into memory, is never
 * printed, and is never written to the report or plan artifacts.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createLocalAssetStore } from '../lib/asset-store.mjs';
import { createPersistedHookAgentAdapter } from '../lib/hook-agent-adapter.mjs';
import {
  HOOK_CANDIDATE_COUNT,
  buildHookColdReaderPrompt,
  buildHookPlanningRequest,
  validateHookPlanForRequest,
} from '../lib/hook-agent.mjs';
import { createGeminiMediaClient } from '../lib/providers/gemini-media.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_SERVICE = 'mobileadagent-gemini-api-key';
const TENANT = Object.freeze({
  orgId: 'org-hook-canary',
  workspaceId: 'workspace-hook-canary',
  packId: 'pack-hook-canary',
});

const cli = parseArgs(process.argv.slice(2));
const environmentRequestsLive = process.env.MAA_HOOK_ADAPTER === 'live'
  || process.env.MAA_HOOK_CANARY_LIVE === '1';
if (!cli.live && environmentRequestsLive) {
  throw new Error('Live Hook Agent access requires the explicit --live CLI flag; environment flags alone are not authorization.');
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(cli.outDir || path.join(REPO_ROOT, 'artifacts', 'live-hook-agent-canary', timestamp));
const reportPath = path.join(outDir, 'canary-report.json');
const assetRoot = path.join(outDir, 'assets');
const startedAt = new Date().toISOString();
const providerAudit = [];
const fixtures = buildReviewedFixtures();

const report = {
  schemaVersion: 'live-hook-agent-canary.v1',
  status: 'running',
  mode: cli.live ? 'live' : 'dry_run',
  startedAt,
  finishedAt: null,
  explicit_live_authorization: cli.live,
  scope: 'persisted_hook_agent_only',
  fixture_count: fixtures.length,
  asset_store: {
    kind: 'local_directory',
    root: displayPath(assetRoot),
    tenant_scoped_keys: true,
  },
  fixture_results: [],
  structured_intelligence_calls: 0,
  intelligence_provider_calls: 0,
  generation_provider_calls: 0,
  image_provider_calls: 0,
  video_provider_calls: 0,
  render_calls: 0,
  provider_mutations: 0,
  refusal_checks: [verifyLiveFlagRefusal()],
};

let secretCache = null;
function secretResolver({ purpose } = {}) {
  if (purpose !== 'creative_intelligence') {
    throw new Error(`This canary has no secret mapping for ${JSON.stringify(purpose)}; media capabilities are disabled.`);
  }
  if (secretCache === null) {
    try {
      secretCache = execFileSync('security', ['find-generic-password', '-s', VAULT_SERVICE, '-w'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      }).trim();
    } catch {
      throw new Error('The Hook Agent canary could not resolve its structured-intelligence credential from the local vault.');
    }
    if (!secretCache) throw new Error('The local vault returned an empty structured-intelligence credential.');
  }
  return secretCache;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const assetStore = createLocalAssetStore({ rootDir: assetRoot });
  const liveClient = cli.live
    ? createGeminiMediaClient({
      apiKey: secretResolver({ purpose: 'creative_intelligence' }),
      timeoutMs: positiveInteger(process.env.MAA_GENERATION_TIMEOUT_MS, 180_000),
      onCall: (entry) => providerAudit.push(sanitizeProviderCall(entry)),
    })
    : null;

  for (const fixture of fixtures) {
    const fixtureResult = await runFixture({ fixture, assetStore, liveClient });
    report.fixture_results.push(fixtureResult);
  }

  validateCrossFixtureReport(report.fixture_results);
  const storedFiles = await listFiles(assetRoot);
  ensure(storedFiles.length === fixtures.length, `Expected ${fixtures.length} persisted plan objects; found ${storedFiles.length}.`);
  ensure(storedFiles.every((file) => file.endsWith('.json')), 'The Hook Agent canary wrote a non-JSON asset.');

  report.structured_intelligence_calls = report.fixture_results
    .reduce((total, item) => total + item.call_budget.actual, 0);
  report.intelligence_provider_calls = providerAudit.filter((call) => call.kind === 'intelligence').length;
  report.generation_provider_calls = providerAudit.filter((call) => call.kind === 'generation').length;
  report.image_provider_calls = providerAudit.filter((call) => call.kind === 'image_generation').length;
  report.video_provider_calls = providerAudit.filter((call) => call.kind === 'video_generation').length;
  report.render_calls = 0;
  report.provider_mutations = 0;
  report.persisted_plan_files = storedFiles.map((file) => displayPath(file));

  ensure(report.generation_provider_calls === 0, 'A media generation provider was called by the Hook Agent canary.');
  ensure(report.image_provider_calls === 0, 'An image provider was called by the Hook Agent canary.');
  ensure(report.video_provider_calls === 0, 'A video provider was called by the Hook Agent canary.');
  ensure(report.render_calls === 0, 'A render backend was called by the Hook Agent canary.');
  ensure(report.provider_mutations === 0, 'The Hook Agent canary recorded a downstream provider mutation.');
  if (cli.live) {
    ensure(
      report.intelligence_provider_calls === report.structured_intelligence_calls,
      'Live structured-provider calls do not match the persisted plans\' intelligence usage.',
    );
  } else {
    ensure(report.intelligence_provider_calls === 0, 'Dry mode unexpectedly called an external intelligence provider.');
  }

  report.status = 'passed';
  report.finishedAt = new Date().toISOString();
  await writeReport();

  console.log(JSON.stringify({
    status: report.status,
    mode: report.mode,
    report: displayPath(reportPath),
    fixtures: report.fixture_results.map((item) => ({
      fixtureId: item.fixtureId,
      candidates: item.candidate_count,
      selectedHooks: item.selected_hook_count,
      isolatedReaderCalls: item.isolated_reader_calls,
      planFingerprint: item.plan_fingerprint,
      persistedResumeCalls: item.persistence.resume_additional_calls,
    })),
    structuredIntelligenceCalls: report.structured_intelligence_calls,
    intelligenceProviderCalls: report.intelligence_provider_calls,
    generationProviderCalls: report.generation_provider_calls,
    providerMutations: report.provider_mutations,
  }, null, 2));
}

async function runFixture({ fixture, assetStore, liveClient }) {
  const request = buildHookPlanningRequest({
    source: fixture.source,
    outputCount: fixture.outputBindings.length,
    outputBindings: fixture.outputBindings,
    maxRounds: 2,
  });
  const task = buildPlanningTask({ fixture, request });
  const capturedCalls = [];
  let structuredCalls = 0;
  const deterministicGenerator = cli.live ? null : createDeterministicGenerator(fixture);
  const generateJson = async (input) => {
    structuredCalls += 1;
    capturedCalls.push({
      stage: input.stage,
      callKey: input.callKey,
      prompt: input.prompt,
    });
    if (liveClient) {
      return liveClient.generateJson({
        prompt: input.prompt,
        schema: input.schema,
        model: process.env.MAA_HOOK_TEXT_MODEL || undefined,
        label: input.stage,
      });
    }
    return deterministicGenerator(input);
  };

  const blockers = [];
  const adapter = createPersistedHookAgentAdapter({
    assetStore,
    generateJson,
    recordBlocker: (blocker) => blockers.push({
      taskId: blocker.taskId,
      capability: blocker.capability,
      stage: blocker.stage,
      planningProviderCalls: blocker.planningProviderCalls,
    }),
    live: cli.live,
    id: cli.live ? 'hook-canary-live-persisted' : 'hook-canary-deterministic-persisted',
  });

  const first = await adapter.planHooks({ task, source: fixture.source });
  ensure(first.reusedArtifact === false, `${fixture.fixtureId}: first planning call unexpectedly reused an artifact.`);
  ensure(blockers.length === 0, `${fixture.fixtureId}: Hook Agent recorded a planning blocker.`);
  const plan = first.hookPlan;
  validateHookPlanForRequest({ plan, request, allowHeld: false });
  validateSelectedPlan({ fixture, request, task, plan, first, capturedCalls, structuredCalls });

  const storedBytes = await assetStore.getObject(task.output.storageKey);
  const storedPlan = JSON.parse(Buffer.from(storedBytes).toString('utf8'));
  ensure(storedPlan.planFingerprint === plan.planFingerprint, `${fixture.fixtureId}: persisted plan readback fingerprint changed.`);

  let resumeAdditionalCalls = 0;
  const resumeAdapter = createPersistedHookAgentAdapter({
    assetStore,
    generateJson: async () => {
      resumeAdditionalCalls += 1;
      throw new Error('Persisted retry must never call intelligence.');
    },
    live: cli.live,
    id: 'hook-canary-persisted-resume',
  });
  const resumed = await resumeAdapter.planHooks({ task, source: fixture.source });
  ensure(resumed.reusedArtifact === true, `${fixture.fixtureId}: retry did not read the persisted plan.`);
  ensure(resumeAdditionalCalls === 0, `${fixture.fixtureId}: persisted retry made a new intelligence call.`);
  ensure(resumed.hookPlan.planFingerprint === plan.planFingerprint, `${fixture.fixtureId}: retry returned a different plan fingerprint.`);
  ensure(resumed.asset.checksum === first.asset.checksum, `${fixture.fixtureId}: retry returned different persisted bytes.`);

  return {
    fixtureId: fixture.fixtureId,
    vertical: fixture.vertical,
    appId: fixture.source.appId,
    taskId: task.taskId,
    status: plan.status,
    storage_key: task.output.storageKey,
    candidate_count: plan.candidatePool.length,
    selected_hook_count: plan.selectedHooks.length,
    isolated_reader_calls: plan.intelligenceUsage.stageCalls.hook_cold_reader,
    writer_calls: plan.intelligenceUsage.stageCalls.hook_writer,
    critic_calls: plan.intelligenceUsage.stageCalls.hook_critic,
    plan_fingerprint: plan.planFingerprint,
    request_fingerprint: plan.requestFingerprint,
    source_fingerprint: plan.sourceFingerprint,
    policy_fingerprint: plan.policyFingerprint,
    call_budget: {
      actual: plan.intelligenceUsage.intelligenceCallCount,
      maximum: plan.intelligenceUsage.maxIntelligenceCalls,
      bounded: plan.intelligenceUsage.intelligenceCallCount <= plan.intelligenceUsage.maxIntelligenceCalls,
    },
    context_isolation_verified: true,
    evidence_assignments: plan.selectedHooks.map((hook) => ({
      assignmentId: hook.assignmentId,
      assignmentEvidenceRefs: hook.assignmentEvidenceRefs,
      selectedEvidenceRefs: hook.evidenceRefs,
      criticSupportedEvidenceRefs: hook.critic.supportedEvidenceRefs,
    })),
    selected_hooks: plan.selectedHooks.map((hook) => ({
      candidateId: hook.candidateId,
      patternId: hook.patternId,
      spokenHook: hook.spokenHook,
      caption: hook.caption,
      inferredTopic: hook.coldRead.inferredTopic,
      topicConfidence: hook.coldRead.topicConfidence,
    })),
    persistence: {
      first_reused_artifact: first.reusedArtifact,
      retry_reused_artifact: resumed.reusedArtifact,
      resume_additional_calls: resumeAdditionalCalls,
      checksum: first.asset.checksum,
    },
    generation_provider_calls: plan.generationProviderCalls,
    provider_mutations: plan.providerMutations,
  };
}

function validateSelectedPlan({ fixture, request, task, plan, first, capturedCalls, structuredCalls }) {
  ensure(plan.status === 'selected', `${fixture.fixtureId}: Hook Agent held instead of selecting a plan.`);
  ensure(plan.candidatePool.length === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: candidate pool must contain exactly eight candidates.`);
  ensure(plan.candidatePoolSize === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: candidatePoolSize must be eight.`);
  ensure(plan.rounds >= 1 && plan.rounds <= request.maxQualityRounds, `${fixture.fixtureId}: quality-round count is outside the bounded request.`);
  ensure(plan.stageHistory.length === plan.rounds, `${fixture.fixtureId}: planning round history is incomplete.`);
  ensure(plan.generatedCandidateCount === plan.rounds * HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: every writer round must return exactly eight auditable candidates.`);
  ensure(plan.acceptedCandidateCount >= HOOK_CANDIDATE_COUNT && plan.acceptedCandidateCount <= plan.generatedCandidateCount, `${fixture.fixtureId}: deterministic accepted-candidate accounting is invalid.`);
  const semanticStages = plan.stageHistory.filter((stage) => stage.blindReads.length > 0);
  ensure(semanticStages.length >= 1, `${fixture.fixtureId}: no complete semantic review was preserved.`);
  ensure(plan.stageHistory.at(-1)?.blindReads.length === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: selected plan did not finish with eight isolated reader results.`);
  for (const stage of plan.stageHistory) {
    ensure(stage.writerCandidateCount === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: writer response was not exactly eight candidates.`);
    ensure(stage.writerCandidates.length === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: writer attempt audit is incomplete.`);
    ensure(stage.deterministicPoolCount <= HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: deterministic pool exceeded eight candidates.`);
    if (stage.blindReads.length > 0) {
      ensure(stage.deterministicPoolCount === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: semantic review ran before the pool reached eight.`);
      ensure(stage.blindReads.length === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: semantic stage did not preserve eight isolated reader results.`);
      ensure(stage.candidateReviews.length === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: semantic stage did not preserve eight critic reviews.`);
    } else {
      ensure(stage.deterministicPoolCount < HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: a full deterministic pool skipped semantic review.`);
      ensure(stage.candidateReviews.length === 0, `${fixture.fixtureId}: incomplete deterministic pool contains critic reviews.`);
    }
  }
  ensure(plan.selectedHooks.length === request.outputCount, `${fixture.fixtureId}: selected hook count does not match output assignments.`);
  ensure(plan.intelligenceUsage.intelligenceCallCount === structuredCalls, `${fixture.fixtureId}: adapter call count does not match plan usage.`);
  ensure(plan.intelligenceUsage.intelligenceCallCount <= request.maxIntelligenceCalls, `${fixture.fixtureId}: intelligence call ceiling exceeded.`);
  ensure(plan.intelligenceUsage.stageCalls.hook_writer === plan.rounds, `${fixture.fixtureId}: writer call count does not match round history.`);
  ensure(plan.intelligenceUsage.stageCalls.hook_cold_reader === semanticStages.length * HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: reader call count does not match semantic-stage history.`);
  ensure(plan.intelligenceUsage.stageCalls.hook_critic === semanticStages.length, `${fixture.fixtureId}: critic call count does not match semantic-stage history.`);
  ensure(
    plan.intelligenceUsage.intelligenceCallCount
      === plan.intelligenceUsage.stageCalls.hook_writer
        + plan.intelligenceUsage.stageCalls.hook_cold_reader
        + plan.intelligenceUsage.stageCalls.hook_critic,
    `${fixture.fixtureId}: intelligence stage-call accounting does not sum to the total.`,
  );
  ensure(first.planningProviderCalls === plan.intelligenceUsage.intelligenceCallCount, `${fixture.fixtureId}: adapter usage did not match plan usage.`);
  ensure(first.providerCalls === 0, `${fixture.fixtureId}: persisted planning adapter reported a media provider call.`);
  ensure(first.providerMutations === 0, `${fixture.fixtureId}: persisted planning adapter reported a provider mutation.`);
  ensure(plan.generationProviderCalls === 0, `${fixture.fixtureId}: plan reported a media-generation call.`);
  ensure(plan.providerMutations === 0, `${fixture.fixtureId}: plan reported a provider mutation.`);
  ensure(first.asset.storageKey === task.output.storageKey, `${fixture.fixtureId}: adapter persisted to an unexpected key.`);
  ensure(task.output.storageKey.startsWith(`orgs/${TENANT.orgId}/workspaces/${TENANT.workspaceId}/apps/${fixture.source.appId}/`), `${fixture.fixtureId}: plan key is not tenant scoped.`);
  for (const fingerprint of [plan.planFingerprint, plan.requestFingerprint, plan.sourceFingerprint, plan.policyFingerprint]) {
    ensure(/^[a-f0-9]{64}$/.test(fingerprint), `${fixture.fixtureId}: plan contains an invalid fingerprint.`);
  }

  const selectedHookCopy = plan.selectedHooks.map((hook) => normalizeCopy(hook.spokenHook));
  const selectedCaptionCopy = plan.selectedHooks.map((hook) => normalizeCopy(hook.caption));
  ensure(new Set(selectedHookCopy).size === selectedHookCopy.length, `${fixture.fixtureId}: selected spoken hooks are not distinct.`);
  ensure(new Set(selectedCaptionCopy).size === selectedCaptionCopy.length, `${fixture.fixtureId}: selected captions are not distinct.`);
  for (let index = 0; index < plan.selectedHooks.length; index += 1) {
    const hook = plan.selectedHooks[index];
    const binding = request.outputBindings[index];
    ensure(hook.assignmentId === binding.assignmentId, `${fixture.fixtureId}: selected hook assignment id drifted.`);
    ensure(equalJson(hook.assignmentEvidenceRefs, binding.evidenceRefs), `${fixture.fixtureId}: selected hook evidence assignment drifted.`);
    const supported = new Set([...hook.evidenceRefs, ...hook.critic.supportedEvidenceRefs]);
    ensure(binding.evidenceRefs.some((ref) => supported.has(ref)), `${fixture.fixtureId}: selected hook does not support its assigned evidence.`);
    ensure(hook.coldRead.topicConfidence >= 0.85, `${fixture.fixtureId}: blind reader confidence is below threshold.`);
    ensure(Boolean(hook.coldRead.behaviorOrSituation), `${fixture.fixtureId}: blind reader did not identify a concrete behavior.`);
    ensure(Boolean(hook.coldRead.tensionOrConsequence), `${fixture.fixtureId}: blind reader did not identify a concrete tension.`);
    ensure(hook.coldRead.unexplainedTerms.length === 0, `${fixture.fixtureId}: blind reader found unexplained context-dependent terms.`);
    ensure(hook.critic.topicMatchesEvidence === true, `${fixture.fixtureId}: independent critic did not bind the inferred topic to reviewed evidence.`);
  }

  validateReaderIsolation({ fixture, plan, capturedCalls });
}

function validateReaderIsolation({ fixture, plan, capturedCalls }) {
  const readerCalls = capturedCalls.filter((call) => call.stage === 'hook_cold_reader');
  ensure(readerCalls.length === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: expected eight isolated reader calls.`);
  const candidateById = new Map(plan.candidatePool.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set();
  for (const call of readerCalls) {
    const candidateId = String(call.callKey).match(/cold-reader:(r\d+-\d+)$/)?.[1];
    const candidate = candidateById.get(candidateId);
    ensure(candidate, `${fixture.fixtureId}: reader call has an unknown opaque candidate id.`);
    ensure(!seen.has(candidateId), `${fixture.fixtureId}: candidate received more than one reader context.`);
    seen.add(candidateId);
    const expectedPrompt = buildHookColdReaderPrompt({ candidate });
    ensure(call.prompt === expectedPrompt, `${fixture.fixtureId}: reader context included data beyond one opaque id and spoken hook.`);
  }
  ensure(seen.size === HOOK_CANDIDATE_COUNT, `${fixture.fixtureId}: not every candidate received an isolated reader context.`);
}

function validateCrossFixtureReport(results) {
  ensure(results.length === 2, 'The canary must exercise exactly two unrelated fixtures.');
  ensure(new Set(results.map((item) => item.vertical)).size === 2, 'The canary fixtures must use unrelated verticals.');
  ensure(new Set(results.map((item) => item.source_fingerprint)).size === 2, 'Unrelated fixtures produced the same source fingerprint.');
  ensure(new Set(results.map((item) => item.request_fingerprint)).size === 2, 'Unrelated fixtures produced the same request fingerprint.');
  ensure(new Set(results.map((item) => item.plan_fingerprint)).size === 2, 'Unrelated fixtures produced the same plan fingerprint.');
  const allHooks = results.flatMap((item) => item.selected_hooks.map((hook) => normalizeCopy(hook.spokenHook)));
  ensure(new Set(allHooks).size === allHooks.length, 'Selected hooks are duplicated across unrelated fixtures.');
  ensure(results.every((item) => item.generation_provider_calls === 0), 'A fixture plan reported a media generation call.');
  ensure(results.every((item) => item.provider_mutations === 0), 'A fixture plan reported a provider mutation.');
}

function buildPlanningTask({ fixture, request }) {
  const taskId = `job-${fixture.fixtureId}-ugc-hook-plan`;
  return {
    taskId,
    jobId: `job-${fixture.fixtureId}`,
    packId: `${TENANT.packId}-${fixture.fixtureId}`,
    orgId: TENANT.orgId,
    workspaceId: TENANT.workspaceId,
    appId: fixture.source.appId,
    spec: {
      outputCount: request.outputCount,
      hookRequest: request,
    },
    output: {
      storageKey: `orgs/${TENANT.orgId}/workspaces/${TENANT.workspaceId}/apps/${fixture.source.appId}/packs/${TENANT.packId}-${fixture.fixtureId}/plans/${taskId}.json`,
      contentType: 'application/json',
    },
  };
}

function createDeterministicGenerator(fixture) {
  return async ({ stage, callKey }) => {
    const round = Number(String(callKey).match(/round-(\d+)/)?.[1] || 1);
    if (stage === 'hook_writer') {
      return { candidates: fixture.candidates.map((candidate) => ({ ...candidate })) };
    }
    if (stage === 'hook_cold_reader') {
      const candidateId = String(callKey).match(/cold-reader:(r\d+-\d+)$/)?.[1] || '';
      const candidateIndex = Number(candidateId.split('-').pop()) - 1;
      const candidate = fixture.candidates[candidateIndex];
      ensure(candidate, `${fixture.fixtureId}: deterministic reader received an unknown candidate.`);
      return {
        read: {
          candidateId,
          inferredTopic: fixture.readerTopic,
          topicConfidence: 0.98,
          behaviorOrSituation: candidate.targetBehavior,
          tensionOrConsequence: candidate.tension,
          curiosityGap: `How the app addresses ${candidate.tension.toLowerCase()}`,
          unexplainedTerms: [],
        },
      };
    }
    if (stage === 'hook_critic') {
      return {
        reviews: fixture.candidates.map((candidate, index) => ({
          candidateId: `r${round}-${index + 1}`,
          verdict: 'pass',
          topicClarity: 5,
          concreteTension: 5,
          curiosity: 4,
          nativeVoice: 5,
          claimSafety: 5,
          topicMatchesEvidence: true,
          supportedEvidenceRefs: [...candidate.evidenceRefs],
          unsupportedSpans: [],
          duplicateClusterId: `${fixture.fixtureId}-cluster-${index + 1}`,
          nearDuplicateOf: null,
          reason: 'The behavior, tension, and topic are concrete and supported by reviewed evidence.',
        })),
      };
    }
    throw new Error(`${fixture.fixtureId}: unexpected deterministic Hook Agent stage ${JSON.stringify(stage)}.`);
  };
}

function buildReviewedFixtures() {
  const patterns = ['target_contrast', 'confession', 'question', 'challenge', 'discovery', 'pov', 'question', 'confession'];
  const languageEvidenceA = ['claim-speaking', 'screen-speaking'];
  const languageEvidenceB = ['claim-listening', 'screen-listening'];
  const labelEvidenceA = ['claim-scan', 'screen-camera'];
  const labelEvidenceB = ['claim-result', 'screen-result'];

  return [
    {
      fixtureId: 'language-learning',
      vertical: 'language_learning',
      readerTopic: 'language learning for speaking and listening in real conversations',
      requiredReaderTopicPattern: /\b(language|speaking|listening|conversation)\b/i,
      source: {
        appId: 'app-canary-language-learning',
        appName: 'PhrasePilot: Conversation Practice',
        appCategory: 'Education',
        appSummary: 'Practice speaking and listening through short guided language conversations.',
        claims: [
          { id: 'claim-speaking', text: 'Practice short spoken conversations using guided language prompts.' },
          { id: 'claim-listening', text: 'Complete listening exercises with spoken sentences and responses.' },
        ],
        screens: [
          { id: 'screen-speaking', label: 'Speaking practice', detail: 'A guided language conversation asks the learner to answer aloud.' },
          { id: 'screen-listening', label: 'Listening exercise', detail: 'A spoken sentence plays before the learner chooses a response.' },
        ],
        angles: [{ id: 'angle-real-conversation', label: 'Bridge study time to real conversation behavior.' }],
        audienceNotes: ['People who study a language but struggle to respond in live conversations.'],
        learningNotes: ['The topic must be obvious without the app name.'],
        styleNotes: ['Plain spoken language, concrete tension, no hype.'],
      },
      outputBindings: [
        { assignmentId: 'language-speaking-output', evidenceRefs: languageEvidenceA },
        { assignmentId: 'language-listening-output', evidenceRefs: languageEvidenceB },
      ],
      candidates: [
        candidate(patterns[0], 'You practise answering aloud, then freeze when someone actually replies.', 'when the reply comes back', 'practising answers aloud before a guided exchange', 'freezing when another person replies', languageEvidenceA, 1),
        candidate(patterns[1], 'You study phrases all week but speaking still feels impossible.', 'studied it, still cannot say it', 'studying language phrases before speaking', 'being unable to speak despite studying', languageEvidenceA, 2),
        candidate(patterns[2], 'Why can you translate sentences but not answer out loud?', 'reading it is not saying it', 'translating language sentences before answering', 'being unable to answer aloud', languageEvidenceA, 3),
        candidate(patterns[3], 'I could read the language, but conversations left me blank.', 'the conversation changed everything', 'reading a language before a conversation', 'going blank during live conversation', languageEvidenceA, 4),
        candidate(patterns[4], 'Listening feels easy until a real conversation speeds up.', 'then the words start moving', 'listening to spoken language in conversation', 'losing the meaning when speech speeds up', languageEvidenceB, 5),
        candidate(patterns[5], 'You recognize every word, then miss what the speaker means.', 'every word, none of the meaning', 'listening for familiar language words', 'missing the speaker\'s meaning', languageEvidenceB, 6),
        candidate(patterns[6], 'Slow language audio is clear, then real speech becomes noise.', 'practice speed versus real speed', 'listening to slow language practice audio', 'real speech becoming hard to follow', languageEvidenceB, 7),
        candidate(patterns[7], 'The words look familiar, but spoken together they disappear.', 'familiar on screen, gone aloud', 'recognizing written language words', 'not recognizing those words in speech', languageEvidenceB, 8),
      ],
    },
    {
      fixtureId: 'label-scanner-utility',
      vertical: 'label_scanner_utility',
      readerTopic: 'scanning small product labels to find readable details',
      requiredReaderTopicPattern: /\b(label|scan|product)\b/i,
      source: {
        appId: 'app-canary-label-scanner',
        appName: 'LabelLens: Product Label Scanner',
        appCategory: 'Utilities',
        appSummary: 'Scan a product label and review its useful details in one readable result.',
        claims: [
          { id: 'claim-scan', text: 'Use the camera to scan product labels and extract visible label text.' },
          { id: 'claim-result', text: 'Review extracted product-label details in a readable result.' },
        ],
        screens: [
          { id: 'screen-camera', label: 'Label camera', detail: 'The camera is aimed at a small product label.' },
          { id: 'screen-result', label: 'Readable result', detail: 'Extracted product-label details appear in a clear list.' },
        ],
        angles: [{ id: 'angle-small-print', label: 'Stop searching tiny product labels manually.' }],
        audienceNotes: ['People who struggle to find useful details in small product-label text.'],
        learningNotes: ['Prefer a specific label-reading situation over generic convenience.'],
        styleNotes: ['Native voice, concrete physical behavior, no unsupported health claims.'],
      },
      outputBindings: [
        { assignmentId: 'label-camera-output', evidenceRefs: labelEvidenceA },
        { assignmentId: 'label-result-output', evidenceRefs: labelEvidenceB },
      ],
      candidates: [
        candidate(patterns[0], 'You scan the label, then still hunt for the important line.', 'scanned it, still searching', 'scanning a small product label', 'still hunting for the important line', labelEvidenceA, 1),
        candidate(patterns[1], 'I photographed the product label and still could not read it.', 'the photo did not fix the print', 'photographing a small product label', 'still being unable to read it', labelEvidenceA, 2),
        candidate(patterns[2], 'Why does one tiny product label need endless zooming?', 'one label, endless zooming', 'zooming into a tiny product label', 'still struggling to read the label', labelEvidenceA, 3),
        candidate(patterns[3], 'That product label is clear until you need one detail.', 'the one detail keeps hiding', 'looking for one detail on a product label', 'the detail becoming hard to find', labelEvidenceA, 4),
        candidate(patterns[4], 'You capture every label, then still search for the warning.', 'captured it, still searching', 'capturing text from a product label', 'still searching the result for a warning', labelEvidenceB, 5),
        candidate(patterns[5], 'The scan worked, but the useful label detail stayed buried.', 'the useful line is still buried', 'reviewing a scanned product-label result', 'the useful detail remaining hard to find', labelEvidenceB, 6),
        candidate(patterns[6], 'Reading one ingredient should not mean searching the whole label.', 'one ingredient, the whole label', 'finding an ingredient on a product label', 'searching the whole label for one item', labelEvidenceB, 7),
        candidate(patterns[7], 'The label is scanned, but the useful result still hides.', 'the scan is not the answer', 'reviewing a scanned label result', 'the useful result remaining hidden', labelEvidenceB, 8),
      ],
    },
  ];
}

function candidate(patternId, spokenHook, caption, targetBehavior, tension, evidenceRefs, index) {
  return {
    candidateId: `writer-${index}`,
    patternId,
    spokenHook,
    caption,
    targetBehavior,
    tension,
    evidenceRefs: [...evidenceRefs],
  };
}

function parseArgs(argv) {
  const result = { live: false, outDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--live') {
      result.live = true;
      continue;
    }
    if (arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--out requires a directory path.');
      result.outDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown Hook Agent canary argument: ${arg}`);
  }
  return result;
}

function verifyLiveFlagRefusal() {
  let refused = false;
  try {
    assertExplicitLiveAuthorization({ requestedLive: true, explicitLiveFlag: false });
  } catch {
    refused = true;
  }
  ensure(refused, 'The live canary authorization guard did not refuse an implicit live request.');
  return {
    name: 'implicit_live_without_cli_flag',
    refused,
    requiredFlag: '--live',
  };
}

function assertExplicitLiveAuthorization({ requestedLive, explicitLiveFlag }) {
  if (requestedLive && !explicitLiveFlag) {
    throw new Error('Live Hook Agent access requires explicit --live authorization.');
  }
}

function sanitizeProviderCall(entry = {}) {
  return {
    kind: String(entry.kind || 'unknown'),
    method: String(entry.method || ''),
    status: Number(entry.status) || null,
  };
}

async function listFiles(rootDir) {
  const files = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  await walk(rootDir);
  return files.sort();
}

async function writeReport() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function displayPath(filePath) {
  const relative = path.relative(REPO_ROOT, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCopy(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch(async (error) => {
  report.status = 'failed';
  report.finishedAt = new Date().toISOString();
  report.error = String(error?.message || 'Hook Agent canary failed.');
  report.intelligence_provider_calls = providerAudit.filter((call) => call.kind === 'intelligence').length;
  report.generation_provider_calls = providerAudit.filter((call) => call.kind === 'generation').length;
  report.provider_mutations = 0;
  try {
    await writeReport();
  } catch {
    // Preserve the original safe error if report persistence itself fails.
  }
  console.error(report.error);
  process.exitCode = 1;
});
