/* Provider-neutral, evidence-bound UGC Script Agent.

   The Hook Agent owns the opening line. This agent owns every remaining
   spoken beat plus creator framing. It deliberately contains no category,
   app, or vertical templates: an unknown app receives the exact same
   writer -> evidence-critic contract as every regression fixture.

   Deterministic code owns timing, proof placement, brand-reveal policy,
   schemas, budgets, and immutable fingerprints. Intelligence owns copy and
   framing, but every factual line must cite reviewed evidence. */

import { createHash } from 'node:crypto';
import { buildHookEvidence } from './hook-agent.mjs';

export const SCRIPT_PLAN_SCHEMA_VERSION = 'ugc-script-plan.v1';
export const SCRIPT_PROMPT_VERSION = 'ugc-script-prompts.v3';
export const SCRIPT_MAX_ROUNDS = 4;
export const SCRIPT_MAX_OUTPUTS_PER_PLAN = 6;
export const SCRIPT_MAX_INPUT_CHARACTERS = 60_000;
export const SCRIPT_MIN_TOTAL_WORDS = 58;
export const SCRIPT_MAX_TOTAL_WORDS = 100;
export const SCRIPT_MAX_WORDS_PER_BEAT = 18;

export const SCRIPT_BEAT_IDS = Object.freeze([
  'hook',
  'tension',
  'bridge',
  'payload',
  'proof_voice',
  'reinforcement',
  'reaction',
]);

const WRITTEN_BEAT_IDS = Object.freeze(SCRIPT_BEAT_IDS.filter((beatId) => beatId !== 'hook'));
const VISUAL_BEAT_IDS = Object.freeze(['payload', 'proof_voice', 'reinforcement']);

export function buildScriptPlanningRequest({ source = {}, hookPlan, unitBindings = [], maxRounds = SCRIPT_MAX_ROUNDS } = {}) {
  if (!hookPlan?.planFingerprint || hookPlan.status !== 'selected') {
    throw new Error('Script Agent needs a selected immutable Hook Plan.');
  }
  const selectedHooks = Array.isArray(hookPlan.selectedHooks) ? hookPlan.selectedHooks : [];
  if (!selectedHooks.length || selectedHooks.length > SCRIPT_MAX_OUTPUTS_PER_PLAN) {
    throw new Error(`Script Agent supports 1-${SCRIPT_MAX_OUTPUTS_PER_PLAN} selected hooks per plan.`);
  }
  const evidence = buildHookEvidence(source);
  const evidenceIds = new Set(evidence.reviewedEvidence.map((item) => item.id));
  const normalizedBindings = selectedHooks.map((hook, index) => {
    const input = unitBindings[index] || {};
    const claimId = cleanText(input.claimId);
    const claimIds = unique([claimId, ...(input.claimIds || [])].map(cleanText).filter(Boolean));
    const proofIds = unique((input.proofIds || []).map(cleanText).filter(Boolean));
    const allowedEvidenceRefs = unique([
      source?.appSummary ? 'app_summary' : null,
      ...claimIds,
      ...proofIds,
      ...(hook.critic?.supportedEvidenceRefs || []),
    ].filter((ref) => ref && evidenceIds.has(ref)));
    if (!input.assignmentId || hook.assignmentId !== input.assignmentId) {
      throw new Error('Script Agent unit binding does not match the selected Hook Plan assignment.');
    }
    if (!allowedEvidenceRefs.length) {
      throw new Error(`Script Agent assignment ${input.assignmentId} has no reviewed evidence.`);
    }
    return {
      assignmentId: input.assignmentId,
      unitId: cleanText(input.unitId),
      claimId: claimId || null,
      claimIds,
      proofIds,
      allowedEvidenceRefs,
      hookCandidateId: hook.candidateId,
      spokenHook: cleanText(hook.spokenHook),
      hookCaption: cleanText(hook.caption),
      targetBehavior: cleanText(hook.targetBehavior),
      tension: cleanText(hook.tension),
    };
  });
  const sourceFingerprint = fingerprint(evidence);
  const hookPlanFingerprint = hookPlan.planFingerprint;
  const qualityRounds = Math.min(SCRIPT_MAX_ROUNDS, positiveInteger(maxRounds, SCRIPT_MAX_ROUNDS));
  const body = {
    schemaVersion: SCRIPT_PLAN_SCHEMA_VERSION,
    promptVersion: SCRIPT_PROMPT_VERSION,
    outputCount: normalizedBindings.length,
    unitBindings: normalizedBindings,
    sourceFingerprint,
    hookPlanFingerprint,
    brandRevealName: shortAppName(source.appName),
    maxQualityRounds: qualityRounds,
    maxIntelligenceCalls: qualityRounds * 3,
    maxInputCharacters: SCRIPT_MAX_INPUT_CHARACTERS,
  };
  return { ...body, requestFingerprint: fingerprint(body) };
}

export async function runScriptAgent({ source, hookPlan, request, generateJson } = {}) {
  if (typeof generateJson !== 'function') throw new Error('Script Agent needs a structured-text intelligence adapter.');
  assertScriptRequestMatchesSource({ source, hookPlan, request });
  const evidence = buildHookEvidence(source);
  const stageHistory = [];
  const stageCalls = { script_writer: 0, script_evidence_verifier: 0, script_critic: 0 };
  let intelligenceCallCount = 0;
  let lastReasons = [];

  const call = async ({ stage, prompt, schema, round }) => {
    if (intelligenceCallCount >= request.maxIntelligenceCalls) {
      throw scriptAgentError('Script Agent exhausted its intelligence-call budget.', usage());
    }
    if (prompt.length > request.maxInputCharacters) {
      throw scriptAgentError('Script Agent prompt exceeded its input-size budget.', usage());
    }
    intelligenceCallCount += 1;
    stageCalls[stage] += 1;
    try {
      return await generateJson({
        stage,
        prompt,
        schema,
        callKey: `${request.requestFingerprint}:round-${round}:${stage}`,
        requestFingerprint: request.requestFingerprint,
      });
    } catch (error) {
      if (!error.scriptAgentMetrics) error.scriptAgentMetrics = usage();
      throw error;
    }
  };

  const usage = () => ({ intelligenceCallCount, maxIntelligenceCalls: request.maxIntelligenceCalls, stageCalls: { ...stageCalls } });

  for (let round = 1; round <= request.maxQualityRounds; round += 1) {
    const writer = await call({
      stage: 'script_writer',
      prompt: buildWriterPrompt({ evidence, request, previousReasons: lastReasons }),
      schema: writerSchema(request.outputCount),
      round,
    });
    const normalized = normalizeScripts(writer?.scripts, { source, request });
    if (normalized.rejections.length) {
      lastReasons = normalized.rejections;
      stageHistory.push({ round, scripts: normalized.audit, verifications: [], reviews: [], reasons: lastReasons });
      continue;
    }

    const verifier = await call({
      stage: 'script_evidence_verifier',
      prompt: buildEvidenceVerifierPrompt({ evidence, request, scripts: normalized.scripts }),
      schema: evidenceVerifierSchema(request.outputCount),
      round,
    });
    const verified = attachEvidenceVerification(normalized.scripts, verifier?.verifications, request);
    const verifierFailures = verified.filter((script) => script.evidenceVerification?.verdict !== 'pass');
    if (verifierFailures.length) {
      lastReasons = verifierFailures.map((script) => `${script.assignmentId}: ${script.evidenceVerification?.reason || 'line-by-line evidence verification failed'}`);
      stageHistory.push({ round, scripts: verified.map(scriptAuditRecord), verifications: verified.map((script) => script.evidenceVerification), reviews: [], reasons: lastReasons });
      continue;
    }

    const critic = await call({
      stage: 'script_critic',
      prompt: buildCriticPrompt({ evidence, request, scripts: verified }),
      schema: criticSchema(request.outputCount),
      round,
    });
    const reviewed = attachReviews(verified, critic?.reviews, request);
    const passing = reviewed.filter((script) => script.qualified);
    stageHistory.push({ round, scripts: reviewed.map(scriptAuditRecord), verifications: reviewed.map((script) => script.evidenceVerification), reviews: reviewed.map((script) => script.critic), reasons: [] });
    if (passing.length === request.outputCount) {
      return sealScriptPlan({
        schemaVersion: SCRIPT_PLAN_SCHEMA_VERSION,
        promptVersion: SCRIPT_PROMPT_VERSION,
        planId: `script-plan-${request.requestFingerprint.slice(0, 16)}`,
        appName: cleanText(source.appName),
        brandRevealName: request.brandRevealName,
        status: 'selected',
        requestFingerprint: request.requestFingerprint,
        sourceFingerprint: request.sourceFingerprint,
        hookPlanFingerprint: request.hookPlanFingerprint,
        outputCount: request.outputCount,
        unitBindings: request.unitBindings,
        scripts: passing.map(selectedScriptRecord),
        rounds: round,
        stageHistory,
        holdReasons: [],
        intelligenceUsage: usage(),
        planningBudget: planningBudget(request),
        intelligenceMode: 'evidence_bound_writer_then_independent_critic',
        generationProviderCalls: 0,
        providerMutations: 0,
      });
    }
    lastReasons = reviewed.filter((script) => !script.qualified).map((script) => `${script.assignmentId}: ${script.critic?.reason || 'quality threshold not met'}`);
  }

  return sealScriptPlan({
    schemaVersion: SCRIPT_PLAN_SCHEMA_VERSION,
    promptVersion: SCRIPT_PROMPT_VERSION,
    planId: `script-plan-${request.requestFingerprint.slice(0, 16)}`,
    appName: cleanText(source.appName),
    brandRevealName: request.brandRevealName,
    status: 'held',
    requestFingerprint: request.requestFingerprint,
    sourceFingerprint: request.sourceFingerprint,
    hookPlanFingerprint: request.hookPlanFingerprint,
    outputCount: request.outputCount,
    unitBindings: request.unitBindings,
    scripts: [],
    rounds: request.maxQualityRounds,
    stageHistory,
    holdReasons: lastReasons.length ? lastReasons : ['Script quality threshold not met.'],
    intelligenceUsage: usage(),
    planningBudget: planningBudget(request),
    intelligenceMode: 'evidence_bound_writer_then_independent_critic',
    generationProviderCalls: 0,
    providerMutations: 0,
  });
}

export function validateScriptPlanForRequest({ plan, request, allowHeld = false } = {}) {
  if (!plan || plan.schemaVersion !== SCRIPT_PLAN_SCHEMA_VERSION) throw new Error('Script Plan schema is invalid.');
  if (!request?.requestFingerprint || plan.requestFingerprint !== request.requestFingerprint) throw new Error('Script Plan request fingerprint does not match.');
  if (plan.sourceFingerprint !== request.sourceFingerprint || plan.hookPlanFingerprint !== request.hookPlanFingerprint) {
    throw new Error('Script Plan source or Hook Plan fingerprint does not match.');
  }
  if (!['selected', 'held'].includes(plan.status) || (!allowHeld && plan.status !== 'selected')) throw new Error('Script Plan is not selected.');
  if (plan.planFingerprint !== fingerprint(planWithoutFingerprint(plan))) throw new Error('Script Plan immutable fingerprint does not match.');
  if (plan.status === 'selected') {
    if (!Array.isArray(plan.scripts) || plan.scripts.length !== request.outputCount) throw new Error('Script Plan output count is invalid.');
    const assignmentIds = new Set();
    for (const script of plan.scripts) {
      const binding = request.unitBindings.find((item) => item.assignmentId === script.assignmentId);
      if (!binding || assignmentIds.has(script.assignmentId)) throw new Error('Script Plan assignment is missing or duplicated.');
      assignmentIds.add(script.assignmentId);
      validateSelectedScript({ script, binding, appName: plan.brandRevealName || plan.appName || '' });
    }
  }
  return plan;
}

export function assertScriptRequestMatchesSource({ source, hookPlan, request } = {}) {
  if (!request) throw new Error('Script Agent request is missing.');
  const rebuilt = buildScriptPlanningRequest({
    source,
    hookPlan,
    unitBindings: request.unitBindings,
    maxRounds: request.maxQualityRounds,
  });
  if (rebuilt.requestFingerprint !== request.requestFingerprint) throw new Error('Script Agent request is stale for the reviewed source or Hook Plan.');
  return true;
}

export function sealScriptPlan(plan) {
  const clean = structuredClone(plan);
  delete clean.planFingerprint;
  return Object.freeze({ ...clean, planFingerprint: fingerprint(clean) });
}

export function buildLocalMockScriptPlan({ source, hookPlan, request } = {}) {
  assertScriptRequestMatchesSource({ source, hookPlan, request });
  const scripts = request.unitBindings.map((binding, index) => {
    const proofForBeat = (beatIndex) => binding.proofIds[Math.min(beatIndex, Math.max(0, binding.proofIds.length - 1))] || null;
    const proofLabel = (proofId) => source.screens?.find((screen) => screen.id === proofId)?.label || 'the app screen';
    const payloadProofId = proofForBeat(0);
    const proofVoiceProofId = proofForBeat(1);
    const reinforcementProofId = proofForBeat(2);
    const claimText = redactAppName(source.claims?.find((claim) => claim.id === binding.claimId)?.text || source.appSummary, source.appName);
    const hook = hookPlan.selectedHooks.find((item) => item.assignmentId === binding.assignmentId);
    const script = {
      assignmentId: binding.assignmentId,
      hookCandidateId: binding.hookCandidateId,
      beats: {
        hook: binding.spokenHook,
        tension: `I kept running into the same problem without a clear next step.`,
        bridge: `Then I tried a different way to look at it.`,
        payload: cleanText(claimText).split(/\s+/).slice(0, 10).join(' '),
        proof_voice: `This ${lowercaseFirst(proofLabel(proofVoiceProofId))} shows the part I needed to see.`,
        reinforcement: `The ${lowercaseFirst(proofLabel(reinforcementProofId))} makes the next decision easier.`,
      reaction: `It is called ${request.brandRevealName}. I would check it before doing this again.`,
      },
      evidenceRefsByBeat: {
        tension: hook?.evidenceRefs || binding.allowedEvidenceRefs.slice(0, 1),
        bridge: binding.allowedEvidenceRefs.slice(0, 1),
        payload: unique([binding.claimId, payloadProofId].filter(Boolean)),
        proof_voice: [proofVoiceProofId].filter(Boolean),
        reinforcement: [reinforcementProofId].filter(Boolean),
        reaction: ['app_summary'].filter((ref) => binding.allowedEvidenceRefs.includes(ref)),
      },
      creatorPlan: {
        setting: 'ordinary familiar place appropriate to the viewer situation',
        framing: 'handheld front-camera selfie at arm length',
        persona: 'plausible everyday user of this app',
        wardrobe: 'plain unbranded everyday clothing',
        emotionalArc: 'recognition to useful relief',
        startingEmotion: 'mildly frustrated and candid',
        endingEmotion: 'more certain, still conversational',
        firstFramePrompt: 'Paused front-camera phone-video frame of the same everyday creator mid-sentence, ordinary flat light, imperfect crop, natural skin texture, scene mostly in focus. The recording phone is the camera and remains out of frame; no second phone or visible device. No app UI or text.',
        negativePrompt: 'visible phone, visible device, second phone, studio portrait, beauty lighting, shallow bokeh, polished commercial, captions, logos, app UI, extra people, anatomy errors',
        continuityAnchors: ['same person', 'same clothing', 'same setting', 'same camera distance', 'same light direction'],
      },
      evidenceVerification: passingEvidenceVerification(binding),
      critic: passingCritic(binding),
    };
    return { ...script, scriptFingerprint: fingerprint(scriptWithoutFingerprint(script)), selectionIndex: index + 1 };
  });
  return sealScriptPlan({
    schemaVersion: SCRIPT_PLAN_SCHEMA_VERSION,
    promptVersion: SCRIPT_PROMPT_VERSION,
    planId: `script-plan-${request.requestFingerprint.slice(0, 16)}`,
    appName: cleanText(source.appName),
    brandRevealName: request.brandRevealName,
    status: 'selected',
    requestFingerprint: request.requestFingerprint,
    sourceFingerprint: request.sourceFingerprint,
    hookPlanFingerprint: request.hookPlanFingerprint,
    outputCount: request.outputCount,
    unitBindings: request.unitBindings,
    scripts,
    rounds: 1,
    stageHistory: [],
    holdReasons: [],
    intelligenceUsage: { intelligenceCallCount: 0, maxIntelligenceCalls: request.maxIntelligenceCalls, stageCalls: { script_writer: 0, script_evidence_verifier: 0, script_critic: 0 } },
    planningBudget: planningBudget(request),
    intelligenceMode: 'local_mock_fixture',
    generationProviderCalls: 0,
    providerMutations: 0,
  });
}

function buildWriterPrompt({ evidence, request, previousReasons }) {
  return `You are the UGC Script Writer for an unknown mobile app. There are no category templates.

Write the remainder of each cold-traffic UGC selfie ad around the LOCKED hook. Use only the reviewed evidence and each assignment's allowed evidence IDs.

Rules:
- Return exactly ${request.outputCount} scripts, one per assignmentId.
- Copy each locked hook exactly; never rewrite it.
- The full arc is hook -> tension -> bridge -> payload -> proof_voice -> reinforcement -> reaction.
- Make the dialogue socially native, concrete, punchy, and one continuous thought rather than product copy.
- Build tension only from the locked hook plus its approved targetBehavior/tension fields. Do not substitute a more dramatic category stereotype.
- proof_voice must literally describe what the assigned proof screen visibly supports.
- Across payload, proof_voice, and reinforcement, cite every assigned proof ID at least once so every approved screenshot selected for this ad is visibly used. A line that cites a proof ID must literally describe what that screen visibly supports.
- Save the exact app name for the reaction beat. Do not name the app earlier.
- Reaction ends with a casual behavioral action, not a hard-sales CTA or card.
- Never tell the viewer to download, install, buy, purchase, subscribe, sign up, or "get it now". Use a natural product behavior such as trying the relevant workflow.
- Use the exact short reveal name ${JSON.stringify(request.brandRevealName)} in reaction; do not use the full store subtitle/title.
- Keep every non-hook beat at ${SCRIPT_MAX_WORDS_PER_BEAT} words or fewer, and the full seven-beat script between ${SCRIPT_MIN_TOTAL_WORDS}-${SCRIPT_MAX_TOTAL_WORDS} spoken words.
- Do not invent personal tenure, frequency, results, prices, ratings, statistics, outcomes, named subtypes, or mechanics.
- Do not introduce illustrative examples, object types, use cases, fields, or nouns that are absent from reviewed evidence, even if they seem typical for the category.
- Every non-hook beat must list one or more evidenceRefs from that assignment's allowedEvidenceRefs.
- When revising after a verifier hold, remove every quoted unsupported span and rewrite with exact vocabulary from the cited evidence. Do not replace it with a new category synonym.
- Choose creator setting, persona, emotion, and first frame from the evidence/audience context. Do not use a category lookup.
- First frame must feel like a paused ordinary phone selfie video: flat/deep focus, imperfect framing, mundane setting, no app UI/text/logos.
- The recording phone is the camera and must stay outside the image. The creator must not hold, show, or look at a second phone/device. State the no-visible-device rule in the firstFramePrompt or negativePrompt.

Reviewed evidence:
${JSON.stringify(evidence, null, 2)}

Locked assignments:
${JSON.stringify(request.unitBindings, null, 2)}

Previous rejection reasons:
${JSON.stringify(previousReasons || [])}`;
}

function buildEvidenceVerifierPrompt({ evidence, request, scripts }) {
  return `You are a strict line-by-line evidence verifier. You are not a copy editor and may not rescue a plausible claim from general knowledge.

For every non-hook beat, decide whether every factual detail and concrete example is directly entailed by the cited reviewed evidence. A typical category association is NOT evidence. If a line introduces any concrete example, object type, field, use case, personal history, duration, result, named subtype, or mechanic absent from the source, quote that exact unsupported span and hold the script.

Rules:
- Return one verification per assignment and one beatSupport row for each of: ${WRITTEN_BEAT_IDS.join(', ')}.
- evidenceRefs must be within that assignment's allowedEvidenceRefs.
- supported=true only when the whole beat is directly supported or clearly non-factual connective/reaction language.
- Personal grammar (I/my/we) is not evidence that an event or result happened. A present/future intention may pass as non-factual reaction language only when the intended action itself is supported by the app evidence and it does not imply a prior result.
- verdict=pass only if all six rows are supported and every unsupportedSpans array is empty.

Reviewed evidence:
${JSON.stringify(evidence, null, 2)}

Assignments:
${JSON.stringify(request.unitBindings, null, 2)}

Scripts:
${JSON.stringify(scripts, null, 2)}`;
}

function buildCriticPrompt({ evidence, request, scripts }) {
  return `You are an independent UGC Script Critic. The writer did not choose the evidence rules.

Review every script against the reviewed evidence and its assignment. Reject any script that is vague, ad-copy-like, off-topic, unsupported, mismatched to visible proof, or structurally weak.

Hard requirements:
- locked hook is copied exactly;
- topic and viewer tension remain coherent after the hook;
- proof_voice describes what the assigned proof can visibly show;
- payload, proof_voice, and reinforcement collectively cite every assigned proof ID, with each cited screen matching the spoken line that will run over it;
- all factual lines cite allowed evidence;
- line-by-line evidenceVerification must pass; the creative critic may not override a verifier hold;
- no unsupported personal history, duration, frequency, result, price, rating, statistic, subtype, or mechanic;
- app name appears only in reaction;
- dialogue sounds like one person talking, not feature bullets;
- creator framing is plausible for this app/audience and contains no unsupported claim;
- every unsupported span is quoted verbatim and claimSafety must be below 5;
- pass requires hookContinuity=5, evidenceAlignment=5, claimSafety=5, unsupportedSpans=[], and all other scores >=4.

Reviewed evidence:
${JSON.stringify(evidence, null, 2)}

Assignments:
${JSON.stringify(request.unitBindings, null, 2)}

Scripts:
${JSON.stringify(scripts, null, 2)}`;
}

function normalizeScripts(rawScripts, { source, request }) {
  const inputs = Array.isArray(rawScripts) ? rawScripts : [];
  const audit = [];
  const scripts = [];
  const rejections = [];
  if (inputs.length !== request.outputCount) rejections.push(`Writer returned ${inputs.length} scripts; expected exactly ${request.outputCount}.`);
  for (const input of inputs) {
    const binding = request.unitBindings.find((item) => item.assignmentId === cleanText(input?.assignmentId));
    const normalized = normalizeWriterScript(input, binding);
    const reasons = deterministicScriptReasons({
      script: normalized,
      binding,
      appName: request.brandRevealName,
    });
    audit.push({ ...normalized, deterministicAccepted: reasons.length === 0, deterministicReasons: reasons });
    if (reasons.length) rejections.push(...reasons.map((reason) => `${normalized.assignmentId || 'unknown'}: ${reason}`));
    else scripts.push(normalized);
  }
  if (new Set(scripts.map((script) => script.assignmentId)).size !== scripts.length) rejections.push('Writer returned duplicate assignment IDs.');
  return { scripts, audit, rejections: unique(rejections) };
}

function normalizeWriterScript(input, binding) {
  const beats = {};
  for (const beatId of SCRIPT_BEAT_IDS) beats[beatId] = cleanText(input?.beats?.[beatId]);
  const refs = {};
  for (const beatId of WRITTEN_BEAT_IDS) refs[beatId] = unique((input?.evidenceRefsByBeat?.[beatId] || []).map(cleanText).filter(Boolean));
  const creator = input?.creatorPlan || {};
  return {
    assignmentId: cleanText(input?.assignmentId),
    hookCandidateId: binding?.hookCandidateId || cleanText(input?.hookCandidateId),
    beats,
    evidenceRefsByBeat: refs,
    creatorPlan: {
      setting: cleanText(creator.setting),
      framing: cleanText(creator.framing),
      persona: cleanText(creator.persona),
      wardrobe: cleanText(creator.wardrobe),
      emotionalArc: cleanText(creator.emotionalArc),
      startingEmotion: cleanText(creator.startingEmotion),
      endingEmotion: cleanText(creator.endingEmotion),
      firstFramePrompt: cleanText(creator.firstFramePrompt),
      negativePrompt: cleanText(creator.negativePrompt),
      continuityAnchors: unique((creator.continuityAnchors || []).map(cleanText).filter(Boolean)).slice(0, 8),
    },
  };
}

function deterministicScriptReasons({ script, binding, appName }) {
  const reasons = [];
  if (!binding) return ['unknown assignmentId'];
  if (script.beats.hook !== binding.spokenHook) reasons.push('locked hook was changed');
  for (const beatId of WRITTEN_BEAT_IDS) {
    const words = wordCount(script.beats[beatId]);
    if (!words) reasons.push(`${beatId} is empty`);
    if (words > SCRIPT_MAX_WORDS_PER_BEAT) reasons.push(`${beatId} is too long (${words} words; max ${SCRIPT_MAX_WORDS_PER_BEAT})`);
    const refs = script.evidenceRefsByBeat[beatId] || [];
    if (!refs.length || refs.some((ref) => !binding.allowedEvidenceRefs.includes(ref))) reasons.push(`${beatId} has missing or unapproved evidence refs`);
  }
  const beforeReveal = WRITTEN_BEAT_IDS.filter((beatId) => beatId !== 'reaction').map((beatId) => script.beats[beatId]).join(' ');
  if (appName && includesPhrase(beforeReveal, appName)) reasons.push('app name appears before reaction');
  if (appName && !includesPhrase(script.beats.reaction, appName)) reasons.push('reaction does not reveal the app name');
  if (/\b(download|install|buy|purchase|subscribe)\b|\bsign\s+up\b|\bget\s+it\s+now\b/i.test(script.beats.reaction)) {
    reasons.push('reaction uses a hard-sales CTA instead of a natural product behavior');
  }
  const totalWords = SCRIPT_BEAT_IDS.reduce((total, beatId) => total + wordCount(script.beats[beatId]), 0);
  if (totalWords < SCRIPT_MIN_TOTAL_WORDS || totalWords > SCRIPT_MAX_TOTAL_WORDS) reasons.push(`full script has ${totalWords} words; target ${SCRIPT_MIN_TOTAL_WORDS}-${SCRIPT_MAX_TOTAL_WORDS}`);
  if (!binding.proofIds.some((proofId) => script.evidenceRefsByBeat.proof_voice.includes(proofId))) reasons.push('proof_voice is not bound to assigned proof');
  const visualProofRefs = new Set(VISUAL_BEAT_IDS.flatMap((beatId) => script.evidenceRefsByBeat[beatId] || []));
  const missingVisualProofIds = binding.proofIds.filter((proofId) => !visualProofRefs.has(proofId));
  if (missingVisualProofIds.length) reasons.push(`visual beats omit assigned proof: ${missingVisualProofIds.join(', ')}`);
  const creatorValues = Object.values(script.creatorPlan).flat().filter(Boolean);
  if (creatorValues.length < 8 || !script.creatorPlan.firstFramePrompt || script.creatorPlan.continuityAnchors.length < 3) reasons.push('creator plan is incomplete');
  if (/\b(show|display|generate|include|render|add)\b.{0,28}\b(app ui|phone screen|caption|subtitle|logo|text)\b/i.test(script.creatorPlan.firstFramePrompt)) {
    reasons.push('first frame prompt asks the image model to create factual UI/text');
  }
  const firstFramePrompt = script.creatorPlan.firstFramePrompt;
  const creatorPrompt = `${firstFramePrompt} ${script.creatorPlan.negativePrompt}`;
  if (creatorPromptPlacesDeviceInFrame(firstFramePrompt)) {
    reasons.push('first frame prompt places a phone/device inside the selfie frame');
  }
  if (!creatorPlanLocksRecordingDeviceOutOfFrame(creatorPrompt)) {
    reasons.push('creator plan does not explicitly keep the recording phone and other devices out of frame');
  }
  return reasons;
}

function creatorPromptPlacesDeviceInFrame(text) {
  const cleaned = cleanText(text).toLowerCase();
  const pattern = /\b(holding|holds|showing|shows|carrying|carries|gripping|raising|looking at)\b.{0,28}\b(phone|iphone|smartphone|device)\b/g;
  for (const match of cleaned.matchAll(pattern)) {
    const prefix = cleaned.slice(Math.max(0, match.index - 36), match.index);
    if (!/\b(no|not|never|without|must not|mustn't|isn't|doesn't|does not)\b/.test(prefix)) return true;
  }
  return false;
}

function creatorPlanLocksRecordingDeviceOutOfFrame(text) {
  const cleaned = cleanText(text).toLowerCase();
  return /\bcamera is the (?:recording )?phone\b.{0,40}\b(?:out of|outside(?: the)?) frame\b/.test(cleaned)
    || /\brecording (?:phone|device)\b.{0,40}\b(?:out of|outside(?: the)?) frame\b/.test(cleaned)
    || /\bno (?:second |visible )?(?:phone|iphone|smartphone|device|recording device)s?\b/.test(cleaned)
    || /\bwithout (?:a |any )?(?:visible )?(?:phone|iphone|smartphone|device|recording device)s?\b/.test(cleaned);
}

function attachEvidenceVerification(scripts, rawVerifications, request) {
  const verifications = Array.isArray(rawVerifications) ? rawVerifications : [];
  return scripts.map((script) => {
    const binding = request.unitBindings.find((item) => item.assignmentId === script.assignmentId);
    const raw = verifications.find((item) => cleanText(item?.assignmentId) === script.assignmentId) || {};
    const rows = Array.isArray(raw.beatSupport) ? raw.beatSupport : [];
    const beatSupport = WRITTEN_BEAT_IDS.map((beatId) => {
      const row = rows.find((item) => cleanText(item?.beatId) === beatId) || {};
      return {
        beatId,
        supported: row.supported === true,
        evidenceRefs: unique((row.evidenceRefs || []).map(cleanText).filter(Boolean)),
        unsupportedSpans: unique((row.unsupportedSpans || []).map(cleanText).filter(Boolean)),
        reason: cleanText(row.reason),
      };
    });
    const invalidEvidenceRefs = beatSupport.flatMap((row) => row.evidenceRefs).filter((ref) => !binding?.allowedEvidenceRefs.includes(ref));
    const allSupported = beatSupport.every((row) => row.supported && row.evidenceRefs.length > 0 && row.unsupportedSpans.length === 0);
    const evidenceVerification = {
      assignmentId: script.assignmentId,
      verdict: raw.verdict === 'pass' && allSupported && invalidEvidenceRefs.length === 0 ? 'pass' : 'hold',
      beatSupport,
      invalidEvidenceRefs: unique(invalidEvidenceRefs),
      reason: cleanText(raw.reason) || (allSupported ? 'All beats are directly supported.' : 'One or more beats are not directly supported.'),
    };
    return { ...script, evidenceVerification };
  });
}

function attachReviews(scripts, rawReviews, request) {
  const reviews = Array.isArray(rawReviews) ? rawReviews : [];
  return scripts.map((script) => {
    const raw = reviews.find((review) => cleanText(review?.assignmentId) === script.assignmentId) || {};
    const critic = normalizeCritic(raw);
    const binding = request.unitBindings.find((item) => item.assignmentId === script.assignmentId);
    const qualified = critic.verdict === 'pass'
      && script.evidenceVerification?.verdict === 'pass'
      && critic.hookContinuity === 5
      && critic.topicCoherence >= 4
      && critic.evidenceAlignment === 5
      && critic.proofAlignment >= 4
      && critic.nativeVoice >= 4
      && critic.arcStrength >= 4
      && critic.claimSafety === 5
      && critic.unsupportedSpans.length === 0
      && critic.supportedEvidenceRefs.length > 0
      && critic.supportedEvidenceRefs.every((ref) => binding.allowedEvidenceRefs.includes(ref));
    return { ...script, critic, qualified };
  });
}

function normalizeCritic(raw) {
  return {
    assignmentId: cleanText(raw.assignmentId),
    verdict: raw.verdict === 'pass' ? 'pass' : 'hold',
    hookContinuity: score(raw.hookContinuity),
    topicCoherence: score(raw.topicCoherence),
    evidenceAlignment: score(raw.evidenceAlignment),
    proofAlignment: score(raw.proofAlignment),
    nativeVoice: score(raw.nativeVoice),
    arcStrength: score(raw.arcStrength),
    claimSafety: score(raw.claimSafety),
    supportedEvidenceRefs: unique((raw.supportedEvidenceRefs || []).map(cleanText).filter(Boolean)),
    unsupportedSpans: unique((raw.unsupportedSpans || []).map(cleanText).filter(Boolean)),
    reason: cleanText(raw.reason),
  };
}

function selectedScriptRecord(script) {
  const record = {
    assignmentId: script.assignmentId,
    hookCandidateId: script.hookCandidateId,
    beats: script.beats,
    evidenceRefsByBeat: script.evidenceRefsByBeat,
    evidenceVerification: script.evidenceVerification,
    creatorPlan: script.creatorPlan,
    critic: script.critic,
  };
  return { ...record, scriptFingerprint: fingerprint(record) };
}

function scriptAuditRecord(script) {
  return { ...script, scriptFingerprint: fingerprint(scriptWithoutFingerprint(script)) };
}

function validateSelectedScript({ script, binding, appName }) {
  if (script.scriptFingerprint !== fingerprint(scriptWithoutFingerprint(script))) throw new Error('Selected script immutable fingerprint does not match.');
  const reasons = deterministicScriptReasons({ script, binding, appName });
  if (reasons.length) throw new Error(`Selected script failed deterministic validation: ${reasons.join(' | ')}`);
  const critic = script.critic || {};
  if (script.evidenceVerification?.verdict !== 'pass') throw new Error('Selected script did not clear line-by-line evidence verification.');
  if (critic.verdict !== 'pass' || critic.hookContinuity !== 5 || critic.evidenceAlignment !== 5 || critic.claimSafety !== 5 || critic.unsupportedSpans?.length) {
    throw new Error('Selected script did not clear the evidence critic.');
  }
}

function passingCritic(binding) {
  return {
    assignmentId: binding.assignmentId,
    verdict: 'pass',
    hookContinuity: 5,
    topicCoherence: 5,
    evidenceAlignment: 5,
    proofAlignment: 5,
    nativeVoice: 4,
    arcStrength: 4,
    claimSafety: 5,
    supportedEvidenceRefs: binding.allowedEvidenceRefs,
    unsupportedSpans: [],
    reason: 'Local structural fixture only.',
  };
}

function passingEvidenceVerification(binding) {
  return {
    assignmentId: binding.assignmentId,
    verdict: 'pass',
    beatSupport: WRITTEN_BEAT_IDS.map((beatId) => ({
      beatId,
      supported: true,
      evidenceRefs: beatId === 'proof_voice' && binding.proofIds.length ? [binding.proofIds[0]] : [binding.allowedEvidenceRefs[0]],
      unsupportedSpans: [],
      reason: 'Local structural fixture only.',
    })),
    invalidEvidenceRefs: [],
    reason: 'Local structural fixture only.',
  };
}

function writerSchema(outputCount) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['scripts'],
    properties: {
      scripts: {
        type: 'array', minItems: outputCount, maxItems: outputCount,
        items: {
          type: 'object', additionalProperties: false,
          required: ['assignmentId', 'beats', 'evidenceRefsByBeat', 'creatorPlan'],
          properties: {
            assignmentId: { type: 'string' },
            beats: objectSchema(SCRIPT_BEAT_IDS, { type: 'string' }),
            evidenceRefsByBeat: objectSchema(WRITTEN_BEAT_IDS, { type: 'array', minItems: 1, items: { type: 'string' } }),
            creatorPlan: {
              type: 'object', additionalProperties: false,
              required: ['setting', 'framing', 'persona', 'wardrobe', 'emotionalArc', 'startingEmotion', 'endingEmotion', 'firstFramePrompt', 'negativePrompt', 'continuityAnchors'],
              properties: {
                setting: { type: 'string' }, framing: { type: 'string' }, persona: { type: 'string' }, wardrobe: { type: 'string' },
                emotionalArc: { type: 'string' }, startingEmotion: { type: 'string' }, endingEmotion: { type: 'string' },
                firstFramePrompt: { type: 'string' }, negativePrompt: { type: 'string' },
                continuityAnchors: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  };
}

function criticSchema(outputCount) {
  return {
    type: 'object', additionalProperties: false, required: ['reviews'],
    properties: {
      reviews: {
        type: 'array', minItems: outputCount, maxItems: outputCount,
        items: {
          type: 'object', additionalProperties: false,
          required: ['assignmentId', 'verdict', 'hookContinuity', 'topicCoherence', 'evidenceAlignment', 'proofAlignment', 'nativeVoice', 'arcStrength', 'claimSafety', 'supportedEvidenceRefs', 'unsupportedSpans', 'reason'],
          properties: {
            assignmentId: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'hold'] },
            hookContinuity: scoreSchema(), topicCoherence: scoreSchema(), evidenceAlignment: scoreSchema(), proofAlignment: scoreSchema(),
            nativeVoice: scoreSchema(), arcStrength: scoreSchema(), claimSafety: scoreSchema(),
            supportedEvidenceRefs: { type: 'array', items: { type: 'string' } }, unsupportedSpans: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' },
          },
        },
      },
    },
  };
}

function evidenceVerifierSchema(outputCount) {
  return {
    type: 'object', additionalProperties: false, required: ['verifications'],
    properties: {
      verifications: {
        type: 'array', minItems: outputCount, maxItems: outputCount,
        items: {
          type: 'object', additionalProperties: false,
          required: ['assignmentId', 'verdict', 'beatSupport', 'reason'],
          properties: {
            assignmentId: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'hold'] }, reason: { type: 'string' },
            beatSupport: {
              type: 'array', minItems: WRITTEN_BEAT_IDS.length, maxItems: WRITTEN_BEAT_IDS.length,
              items: {
                type: 'object', additionalProperties: false,
                required: ['beatId', 'supported', 'evidenceRefs', 'unsupportedSpans', 'reason'],
                properties: {
                  beatId: { type: 'string', enum: [...WRITTEN_BEAT_IDS] },
                  supported: { type: 'boolean' },
                  evidenceRefs: { type: 'array', minItems: 1, items: { type: 'string' } },
                  unsupportedSpans: { type: 'array', items: { type: 'string' } },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };
}

function planningBudget(request) {
  return { maxQualityRounds: request.maxQualityRounds, maxIntelligenceCalls: request.maxIntelligenceCalls, maxInputCharacters: request.maxInputCharacters };
}

function planWithoutFingerprint(plan) { const copy = structuredClone(plan); delete copy.planFingerprint; return copy; }
function scriptWithoutFingerprint(script) { const copy = structuredClone(script); delete copy.scriptFingerprint; delete copy.selectionIndex; delete copy.qualified; return copy; }
function objectSchema(keys, leaf) { return { type: 'object', additionalProperties: false, required: [...keys], properties: Object.fromEntries(keys.map((key) => [key, leaf])) }; }
function scoreSchema() { return { type: 'integer', minimum: 1, maximum: 5 }; }
function score(value) { const number = Number(value); return Number.isInteger(number) && number >= 1 && number <= 5 ? number : 0; }
function wordCount(text) { return cleanText(text).split(/\s+/).filter(Boolean).length; }
function positiveInteger(value, fallback) { const parsed = Math.floor(Number(value)); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function unique(values) { return [...new Set(values)]; }
function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function lowercaseFirst(value) { const text = cleanText(value); return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : ''; }
function includesPhrase(text, phrase) { return cleanText(text).toLowerCase().includes(cleanText(phrase).toLowerCase()); }
function redactAppName(text, appName) {
  let output = cleanText(text);
  const names = unique([cleanText(appName), cleanText(appName).replace(/\s*[:|-]\s*.*/, '')].filter(Boolean)).sort((a, b) => b.length - a.length);
  for (const name of names) output = output.replace(new RegExp(escapeRegExp(name), 'gi'), '').replace(/^\s*[:|-]\s*/, '');
  return cleanText(output) || 'The reviewed feature is visible in the app.';
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function shortAppName(value) { return cleanText(value).replace(/\s*[:|-]\s*.*/, '') || 'the app'; }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function scriptAgentError(message, usage) { const error = new Error(message); error.scriptAgentMetrics = usage; return error; }
