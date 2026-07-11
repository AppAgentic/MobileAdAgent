/* Provider-neutral Hook Agent.

   Creative wording is intelligence-owned. This module owns the reviewed
   evidence envelope, strict writer/blind-reader/critic schemas, deterministic
   safety rails, bounded quality retries, selection, and immutable plan
   fingerprints. It deliberately contains no app/category hook templates.

   A blind-reader call receives one spoken hook only. It never receives the
   app, evidence, caption, writer rationale, or peer candidates. */

import { createHash } from 'node:crypto';

export const HOOK_PLAN_SCHEMA_VERSION = 'ugc-hook-plan.v1';
export const HOOK_PROMPT_VERSION = 'ugc-hook-prompts.v4';
export const HOOK_CANDIDATE_COUNT = 8;
export const HOOK_MAX_OUTPUTS_PER_PLAN = 6;
export const HOOK_MAX_ROUNDS = 2;
export const HOOK_BLIND_READER_CONCURRENCY = 4;
export const HOOK_MAX_INPUT_CHARACTERS = 60_000;

const PATTERN_IDS = Object.freeze([
  'target_contrast',
  'confession',
  'question',
  'challenge',
  'discovery',
  'pov',
]);

export function buildHookPlanningRequest({
  source = {},
  outputCount = 1,
  outputBindings = [],
  policy = {},
  maxRounds = HOOK_MAX_ROUNDS,
} = {}) {
  const requestedCount = positiveInteger(outputCount, 1);
  if (requestedCount > HOOK_MAX_OUTPUTS_PER_PLAN) {
    throw new Error(`A shared Hook Agent plan supports at most ${HOOK_MAX_OUTPUTS_PER_PLAN} UGC drafts.`);
  }
  const resolvedPolicy = normalizePolicy(policy);
  const qualityRounds = Math.min(HOOK_MAX_ROUNDS, positiveInteger(maxRounds, HOOK_MAX_ROUNDS));
  const evidence = buildHookEvidence(source);
  const normalizedOutputBindings = normalizeOutputBindings(outputBindings, requestedCount, new Set(evidence.reviewedEvidence.map((item) => item.id)));
  const sourceFingerprint = fingerprint(evidence);
  const policyFingerprint = fingerprint(resolvedPolicy);
  const requestBody = {
    schemaVersion: HOOK_PLAN_SCHEMA_VERSION,
    promptVersion: HOOK_PROMPT_VERSION,
    outputCount: requestedCount,
    outputBindings: normalizedOutputBindings,
    candidatePoolSize: HOOK_CANDIDATE_COUNT,
    maxQualityRounds: qualityRounds,
    maxIntelligenceCalls: qualityRounds * (HOOK_CANDIDATE_COUNT + 2),
    maxInputCharacters: HOOK_MAX_INPUT_CHARACTERS,
    sourceFingerprint,
    policyFingerprint,
    policy: resolvedPolicy,
  };
  return {
    ...requestBody,
    requestFingerprint: fingerprint(requestBody),
  };
}

export async function runHookAgent({
  source,
  request = null,
  outputCount = 1,
  policy = {},
  generateJson,
  priorFeedback = [],
  maxRounds = HOOK_MAX_ROUNDS,
} = {}) {
  if (typeof generateJson !== 'function') {
    throw new Error('Hook Agent needs a structured-text intelligence adapter.');
  }
  const resolvedRequest = request || buildHookPlanningRequest({ source, outputCount, policy, maxRounds });
  assertHookRequestMatchesSource({ source, request: resolvedRequest });
  const evidence = buildHookEvidence(source);
  const feedback = [...priorFeedback].map(cleanText).filter(Boolean).slice(-12);
  const stageHistory = [];
  const stageCalls = { hook_writer: 0, hook_cold_reader: 0, hook_critic: 0 };
  let intelligenceCallCount = 0;
  let generatedCandidateCount = 0;
  let acceptedCandidateCount = 0;
  let lastReasons = [];
  let deterministicPool = [];
  let latestPlanPool = [];

  const callIntelligence = async ({ stage, prompt, schema, callKey }) => {
    if (intelligenceCallCount >= resolvedRequest.maxIntelligenceCalls) {
      throw hookAgentError('Hook Agent exhausted its intelligence-call budget.', usage());
    }
    if (String(prompt || '').length > resolvedRequest.maxInputCharacters) {
      throw hookAgentError('Hook Agent prompt exceeded its input-size budget.', usage());
    }
    intelligenceCallCount += 1;
    stageCalls[stage] += 1;
    try {
      return await generateJson({
        stage,
        prompt,
        schema,
        callKey: `${resolvedRequest.requestFingerprint}:${callKey}`,
        requestFingerprint: resolvedRequest.requestFingerprint,
      });
    } catch (error) {
      if (!error.hookAgentMetrics) error.hookAgentMetrics = usage();
      throw error;
    }
  };

  function usage() {
    return {
      intelligenceCallCount,
      maxIntelligenceCalls: resolvedRequest.maxIntelligenceCalls,
      stageCalls: { ...stageCalls },
    };
  }

  for (let round = 1; round <= resolvedRequest.maxQualityRounds; round += 1) {
    const remainingPoolSlots = HOOK_CANDIDATE_COUNT - deterministicPool.length;
    const writer = await callIntelligence({
      stage: 'hook_writer',
      prompt: buildHookWriterPrompt({
        evidence,
        outputBindings: resolvedRequest.outputBindings,
        feedback,
        round,
        policy: resolvedRequest.policy,
        retainedCandidates: deterministicPool,
        remainingPoolSlots,
      }),
      schema: hookWriterSchema(),
      callKey: `round-${round}:writer`,
    });
    const rawCandidates = Array.isArray(writer?.candidates) ? writer.candidates : [];
    generatedCandidateCount += rawCandidates.length;
    const normalized = normalizeCandidates(rawCandidates, {
      evidence,
      appName: source?.appName || '',
      policy: resolvedRequest.policy,
      candidateIdPrefix: `r${round}`,
      existingCandidates: deterministicPool,
    });
    acceptedCandidateCount += normalized.candidates.length;
    const retainedFromRound = normalized.candidates.slice(0, remainingPoolSlots);
    const retainedIds = new Set(retainedFromRound.map((candidate) => candidate.candidateId));
    deterministicPool = [...deterministicPool, ...retainedFromRound];
    latestPlanPool = deterministicPool.map(candidateAuditRecord);
    const writerCandidates = normalized.attempts.map((candidate) => ({
      ...candidate,
      retainedForSemanticPool: retainedIds.has(candidate.candidateId),
      disposition: candidate.deterministicAccepted
        ? (retainedIds.has(candidate.candidateId) ? 'retained' : 'valid_overflow')
        : 'rejected',
    }));

    if (deterministicPool.length !== HOOK_CANDIDATE_COUNT) {
      lastReasons = normalized.rejections.map((item) => item.reason);
      stageHistory.push({
        round,
        writerCandidateCount: rawCandidates.length,
        deterministicAcceptedCount: normalized.candidates.length,
        deterministicRetainedCount: retainedFromRound.length,
        deterministicPoolCount: deterministicPool.length,
        deterministicPoolCandidateIds: deterministicPool.map((candidate) => candidate.candidateId),
        deterministicRejections: normalized.rejections,
        writerCandidates,
        blindReads: [],
        candidateReviews: [],
      });
      feedback.push(
        `The deterministic pool retained ${deterministicPool.length} of ${HOOK_CANDIDATE_COUNT} required candidates; ${HOOK_CANDIDATE_COUNT - deterministicPool.length} slot(s) remain: ${lastReasons.join(' | ') || 'the structured set was incomplete'}.`,
        `Return exactly ${HOOK_CANDIDATE_COUNT} fresh candidates that do not repeat retained copy and satisfy every format and evidence rule.`,
      );
      continue;
    }

    let coldReads;
    try {
      coldReads = await mapWithConcurrency(
        deterministicPool,
        HOOK_BLIND_READER_CONCURRENCY,
        async (candidate) => {
          const response = await callIntelligence({
            stage: 'hook_cold_reader',
            prompt: buildHookColdReaderPrompt({ candidate }),
            schema: hookColdReaderSchema(),
            callKey: `round-${round}:cold-reader:${candidate.candidateId}`,
          });
          return normalizeColdRead(candidate.candidateId, response?.read);
        },
      );
    } catch (error) {
      // The scheduler drains every call that was already in flight before it
      // rejects. Refresh the snapshot after that drain so retry/cost accounting
      // reflects every provider call that actually happened.
      error.hookAgentMetrics = usage();
      throw error;
    }

    const critic = await callIntelligence({
      stage: 'hook_critic',
      prompt: buildHookCriticPrompt({
        evidence,
        candidates: deterministicPool,
        coldReads,
        outputCount: resolvedRequest.outputCount,
        outputBindings: resolvedRequest.outputBindings,
      }),
      schema: hookCriticSchema(),
      callKey: `round-${round}:critic`,
    });
    const reviewed = attachCriticReviews(deterministicPool, critic?.reviews, coldReads, evidence);
    latestPlanPool = reviewed.map(candidateAuditRecord);
    const selected = selectHooks(reviewed, resolvedRequest.outputCount, resolvedRequest.outputBindings);
    stageHistory.push({
      round,
      writerCandidateCount: rawCandidates.length,
      deterministicAcceptedCount: normalized.candidates.length,
      deterministicRetainedCount: retainedFromRound.length,
      deterministicPoolCount: deterministicPool.length,
      deterministicPoolCandidateIds: deterministicPool.map((candidate) => candidate.candidateId),
      deterministicRejections: normalized.rejections,
      writerCandidates,
      blindReads: coldReads,
      candidateReviews: reviewed.map(candidateAuditRecord),
    });

    if (selected.length >= resolvedRequest.outputCount) {
      return sealHookPlan({
        planId: planIdFor(resolvedRequest),
        schemaVersion: HOOK_PLAN_SCHEMA_VERSION,
        promptVersion: HOOK_PROMPT_VERSION,
        status: 'selected',
        requestFingerprint: resolvedRequest.requestFingerprint,
        sourceFingerprint: resolvedRequest.sourceFingerprint,
        policyFingerprint: resolvedRequest.policyFingerprint,
        outputCount: resolvedRequest.outputCount,
        outputBindings: resolvedRequest.outputBindings,
        candidatePoolSize: HOOK_CANDIDATE_COUNT,
        rounds: round,
        generatedCandidateCount,
        acceptedCandidateCount,
        selectedHooks: selected.map(selectedHookRecord),
        rejectedCandidateCount: reviewed.length - selected.length,
        candidatePool: reviewed.map(candidateAuditRecord),
        stageHistory,
        holdReasons: [],
        intelligenceUsage: usage(),
        planningBudget: planningBudget(resolvedRequest),
        intelligenceMode: 'writer_then_isolated_blind_reader_then_evidence_critic',
        generationProviderCalls: 0,
        providerMutations: 0,
      });
    }

    lastReasons = reviewed
      .filter((candidate) => !candidate.qualified)
      .map((candidate) => `${candidate.candidateId}: ${candidate.critic?.reason || 'semantic quality threshold not met'}`);
    feedback.push(
      `The independent critic rejected the previous set: ${lastReasons.join(' | ') || 'not enough candidates cleared every threshold'}.`,
      'Rewrite from the reviewed evidence. Make the topic obvious in one listen, sharpen the concrete tension, and vary the behavior/tension cluster.',
    );
    // A semantic rejection needs a genuinely new pool. Deterministic survivors
    // carry across writer repair rounds only until their first semantic review.
    deterministicPool = [];
  }

  return sealHookPlan({
    planId: planIdFor(resolvedRequest),
    schemaVersion: HOOK_PLAN_SCHEMA_VERSION,
    promptVersion: HOOK_PROMPT_VERSION,
    status: 'held',
    requestFingerprint: resolvedRequest.requestFingerprint,
    sourceFingerprint: resolvedRequest.sourceFingerprint,
    policyFingerprint: resolvedRequest.policyFingerprint,
    outputCount: resolvedRequest.outputCount,
    outputBindings: resolvedRequest.outputBindings,
    candidatePoolSize: HOOK_CANDIDATE_COUNT,
    rounds: resolvedRequest.maxQualityRounds,
    generatedCandidateCount,
    acceptedCandidateCount,
    selectedHooks: [],
    rejectedCandidateCount: latestPlanPool.length,
    candidatePool: latestPlanPool,
    stageHistory,
    holdReasons: lastReasons.length ? lastReasons : ['Semantic quality threshold not met.'],
    intelligenceUsage: usage(),
    planningBudget: planningBudget(resolvedRequest),
    intelligenceMode: 'writer_then_isolated_blind_reader_then_evidence_critic',
    generationProviderCalls: 0,
    providerMutations: 0,
  });
}

export function buildHookEvidence(source = {}) {
  const refs = [
    ...(source.appSummary ? [{ id: 'app_summary', type: 'summary', text: source.appSummary }] : []),
    ...(source.claims || []).map((claim) => ({ id: claim.id, type: 'reviewed_claim', text: claim.text })),
    ...(source.screens || []).map((screen) => ({
      id: screen.id,
      type: 'app_screen',
      text: [screen.label, screen.detail].filter(Boolean).join(' — '),
    })),
    ...(source.angles || []).map((angle) => ({ id: angle.id, type: 'approved_angle', text: angle.label })),
  ]
    .map((item) => ({ id: cleanText(item.id).slice(0, 120), type: cleanText(item.type).slice(0, 40), text: cleanText(item.text).slice(0, 800) }))
    .filter((item) => item.id && item.text)
    .slice(0, 80);
  return {
    appId: cleanText(source.appId).slice(0, 160),
    appName: cleanText(source.appName).slice(0, 160),
    appCategory: cleanText(source.appCategory).slice(0, 120),
    appSummary: cleanText(source.appSummary).slice(0, 1_500),
    reviewedEvidence: refs,
    styleNotes: normalizeNotes(source.styleNotes),
    audienceNotes: normalizeNotes(source.audienceNotes),
    learningNotes: normalizeNotes(source.learningNotes),
  };
}

export function buildHookWriterPrompt({
  evidence,
  outputBindings = [],
  feedback = [],
  round = 1,
  policy = {},
  retainedCandidates = [],
  remainingPoolSlots = HOOK_CANDIDATE_COUNT,
} = {}) {
  const resolvedPolicy = normalizePolicy(policy);
  const retainedPool = (retainedCandidates || []).map((candidate) => ({
    candidateId: candidate.candidateId,
    patternId: candidate.patternId,
    spokenHook: candidate.spokenHook,
    caption: candidate.caption,
    evidenceRefs: candidate.evidenceRefs,
  }));
  return `You are Mobile Ad Agent's Hook Writer.

Create exactly ${HOOK_CANDIDATE_COUNT} genuinely different opening-hook candidates for a paid social UGC ad about the app in the reviewed evidence below. This must work for any app vertical; infer the topic, target behavior, and tension from evidence instead of choosing from category templates.

The app name is provided only for understanding. Do not say or caption the app name in a hook.

Creative rules:
- A cold viewer must immediately understand what topic or human activity this relates to, even with the brand hidden.
- Name or vividly imply one concrete behavior the target viewer recognizes and one concrete tension, failure, surprise, or contradiction.
- Use plain words a real person would say aloud. No internal product nouns, unexplained metrics, feature jargon, abstract status language, or generic audience labels followed by "watch this."
- Create curiosity without hiding the topic. Mystery about the payoff is good; mystery about what the ad is about is bad.
- Spoken hook: ${resolvedPolicy.minSpokenWords}-${resolvedPolicy.maxSpokenWords} words, one breath, no greeting, no marketing claim, no CTA, no brand.
- Caption: <=${resolvedPolicy.maxCaptionCharacters} characters, brand-free, and specific enough to add tension when watched muted.
- Do not invent outcomes, numbers, testimonials, prices, medical claims, or features. Every candidate must cite at least one evidence id, but citing an id never makes a new detail supported.
- Do not invent first-person or implied personal history: no unsupported story about how long someone used, studied, tried, had, or struggled with something; no prior proficiency, condition, mastery, or result. First-person voice may describe only an immediate observation or reaction that the reviewed evidence supports.
- A duration, tenure, frequency, proficiency level, quality/result claim, or named subtype is allowed only when that exact specificity is explicitly present in reviewed evidence. Generic category evidence does not support adding a particular subtype or example. When evidence is generic, keep the hook generic.
- Diversify patterns across: target contrast, confession, question, challenge, discovery, and POV. Do not merely paraphrase one sentence ${HOOK_CANDIDATE_COUNT} times.
- The pack has the output evidence assignments listed below. Across the eight-candidate pool, create enough distinct candidates supported by each assignment's allowed evidence ids. A broad topic hook may cite app_summary when it genuinely supports every assigned output.
- Deterministically valid candidates from an incomplete prior response can be retained below. Do not repeat or closely paraphrase their spoken hooks or captions. Still return exactly ${HOOK_CANDIDATE_COUNT} fresh candidates; the system will use as many as needed to fill the ${Math.max(0, Number(remainingPoolSlots) || 0)} open pool slot(s).
- Output original copy for this app. Pattern names are structures, not fill-in-the-blank wording.

For each candidate, explain the target behavior and tension in short plain phrases. Return JSON only.

Writer round: ${round}
${feedback.length ? `Repair feedback from the prior round:\n- ${feedback.join('\n- ')}\n` : ''}
Retained deterministic candidates from prior writer responses:
${JSON.stringify(retainedPool, null, 2)}

Reviewed app evidence:
${JSON.stringify(evidence, null, 2)}

Output evidence assignments:
${JSON.stringify(outputBindings, null, 2)}`;
}

export function buildHookColdReaderPrompt({ candidate } = {}) {
  return `You are a blind cold viewer. You receive exactly one spoken opening hook. You do not know the app, brand, category, caption, features, evidence, writer intent, or any other candidate.

From the spoken words alone:
- infer the specific activity/problem/topic and give confidence from 0 to 1;
- quote the concrete human behavior or recognizable situation, or return an empty string;
- quote the concrete tension, failure, consequence, contradiction, or unresolved question, or return an empty string;
- state the curiosity gap, or return an empty string;
- list any words whose meaning depends on unseen product/app context.

Do not rescue vague wording by imagining a likely app. A category label alone is not a behavior or tension. Return JSON only.

Opaque candidate id: ${JSON.stringify(candidate?.candidateId || '')}
Spoken hook: ${JSON.stringify(candidate?.spokenHook || '')}`;
}

export function buildHookCriticPrompt({ evidence, candidates, coldReads, outputCount, outputBindings = [] } = {}) {
  const canonicalCandidates = (candidates || []).map((candidate) => ({
    candidateId: candidate.candidateId,
    patternId: candidate.patternId,
    spokenHook: candidate.spokenHook,
    caption: candidate.caption,
    evidenceRefs: candidate.evidenceRefs,
  }));
  return `You are Mobile Ad Agent's independent Evidence Critic. You did not write these candidates.

Score the actual hook and caption strictly against the reviewed app evidence. Ignore any writer rationale; it is intentionally not supplied. Do not reward polished wording if a cold viewer cannot tell what topic it belongs to.

For each candidate, score 1-5:
- topicClarity: the hidden-brand hook unmistakably relates to this app's topic/behavior in one listen
- concreteTension: it contains a specific behavior plus a specific problem/contradiction, not an abstract status
- curiosity: it creates a reason to keep watching without obscuring the topic
- nativeVoice: it sounds like a real creator/friend, not ad copy or a template
- claimSafety: every factual specificity in both hook and caption is explicitly supported by reviewed evidence; it invents no result, number, testimonial, personal history, duration, proficiency, named subtype, or feature

Also return topicMatchesEvidence, the evidence ids that really support the copy, any unsupported exact spans, and a semantic duplicateClusterId. Candidates that are paraphrases of the same behavior+tension belong to the same cluster. Set nearDuplicateOf to the strongest prior candidate in that cluster, otherwise null.

Set verdict=pass only when topicClarity >=4, concreteTension >=4, nativeVoice >=4, curiosity >=3, claimSafety=5, topicMatchesEvidence=true, supportedEvidenceRefs is non-empty, and unsupportedSpans is empty. Reject generic hooks that could fit unrelated apps. Reject unexplained jargon even when it appears in store copy. Give one blunt sentence explaining the biggest strength or weakness.

Claim-safety audit is strict and non-inferential:
- Check every factual phrase in the spoken hook and caption against the actual text of reviewed evidence. A candidate's cited evidence ids are pointers, not proof.
- First-person grammar is not evidence of a true testimonial. Any claimed personal history, prior condition or ability, usage/study tenure, elapsed duration, frequency, proficiency/mastery, or result must be explicitly supported as written; otherwise quote the unsupported span, set claimSafety below 5, and reject.
- A specific named subtype or example is unsupported when the evidence states only a broader category. Do not assume a particular subtype merely because it is plausible or commonly associated with that category. Quote it in unsupportedSpans, set claimSafety below 5, and reject.
- If even one specific fact is unsupported, supportedEvidenceRefs must not be used to excuse it and verdict must be reject.

Each blind reader saw only one spoken hook and no caption or peer candidate. Treat confidence below 0.85, a missing behavior, a missing tension, or unexplained context-dependent terms as a hard reject. Check that the blind-inferred topic semantically matches reviewed evidence; do not use evidence to reinterpret unclear wording.

We need ${Number(outputCount || 1)} distinct winners. Return JSON only.

Reviewed app evidence:
${JSON.stringify(evidence, null, 2)}

Canonical candidate copy:
${JSON.stringify(canonicalCandidates, null, 2)}

Isolated blind reads:
${JSON.stringify(coldReads || [], null, 2)}

Output evidence assignments:
${JSON.stringify(outputBindings, null, 2)}`;
}

export function hookWriterSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      candidates: {
        type: 'array',
        minItems: HOOK_CANDIDATE_COUNT,
        maxItems: HOOK_CANDIDATE_COUNT,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidateId: { type: 'string' },
            patternId: { type: 'string', enum: PATTERN_IDS },
            spokenHook: { type: 'string' },
            caption: { type: 'string' },
            targetBehavior: { type: 'string' },
            tension: { type: 'string' },
            evidenceRefs: { type: 'array', minItems: 1, items: { type: 'string' } },
          },
          required: ['candidateId', 'patternId', 'spokenHook', 'caption', 'targetBehavior', 'tension', 'evidenceRefs'],
        },
      },
    },
    required: ['candidates'],
  };
}

export function hookColdReaderSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      read: {
        type: 'object',
        additionalProperties: false,
        properties: {
          candidateId: { type: 'string' },
          inferredTopic: { type: 'string' },
          topicConfidence: { type: 'number', minimum: 0, maximum: 1 },
          behaviorOrSituation: { type: 'string' },
          tensionOrConsequence: { type: 'string' },
          curiosityGap: { type: 'string' },
          unexplainedTerms: { type: 'array', items: { type: 'string' } },
        },
        required: ['candidateId', 'inferredTopic', 'topicConfidence', 'behaviorOrSituation', 'tensionOrConsequence', 'curiosityGap', 'unexplainedTerms'],
      },
    },
    required: ['read'],
  };
}

export function hookCriticSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      reviews: {
        type: 'array',
        minItems: HOOK_CANDIDATE_COUNT,
        maxItems: HOOK_CANDIDATE_COUNT,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidateId: { type: 'string' },
            verdict: { type: 'string', enum: ['pass', 'reject'] },
            topicClarity: { type: 'integer', minimum: 1, maximum: 5 },
            concreteTension: { type: 'integer', minimum: 1, maximum: 5 },
            curiosity: { type: 'integer', minimum: 1, maximum: 5 },
            nativeVoice: { type: 'integer', minimum: 1, maximum: 5 },
            claimSafety: { type: 'integer', minimum: 1, maximum: 5 },
            topicMatchesEvidence: { type: 'boolean' },
            supportedEvidenceRefs: { type: 'array', items: { type: 'string' } },
            unsupportedSpans: { type: 'array', items: { type: 'string' } },
            duplicateClusterId: { type: 'string' },
            nearDuplicateOf: { type: ['string', 'null'] },
            reason: { type: 'string' },
          },
          required: [
            'candidateId', 'verdict', 'topicClarity', 'concreteTension', 'curiosity', 'nativeVoice', 'claimSafety',
            'topicMatchesEvidence', 'supportedEvidenceRefs', 'unsupportedSpans', 'duplicateClusterId', 'nearDuplicateOf', 'reason',
          ],
        },
      },
    },
    required: ['reviews'],
  };
}

/* Offline graph tests need a planning artifact but must never pretend that
   fixture copy is customer-ready intelligence. Live UGC rejects this mode. */
export function buildLocalMockHookPlan({ source = {}, outputCount = 1, request = null } = {}) {
  const resolvedRequest = request || buildHookPlanningRequest({ source, outputCount });
  assertHookRequestMatchesSource({ source, request: resolvedRequest });
  const evidence = buildHookEvidence(source);
  const fallbackRef = evidence.reviewedEvidence[0]?.id || 'app_summary';
  const pool = Array.from({ length: HOOK_CANDIDATE_COUNT }, (_, index) => ({
    selectionIndex: index + 1,
    candidateId: `local-mock-${index + 1}`,
    writerCandidateId: `local-mock-${index + 1}`,
    patternId: PATTERN_IDS[index % PATTERN_IDS.length],
    spokenHook: `Offline fixture hook ${index + 1} uses reviewed app evidence only.`,
    caption: `offline fixture hook ${index + 1}`,
    targetBehavior: 'offline fixture only',
    tension: 'offline fixture only',
    evidenceRefs: [fallbackRef],
    coldRead: {
      candidateId: `local-mock-${index + 1}`,
      inferredTopic: 'offline fixture only',
      topicConfidence: 1,
      behaviorOrSituation: 'offline fixture only',
      tensionOrConsequence: 'offline fixture only',
      curiosityGap: 'offline fixture only',
      unexplainedTerms: [],
    },
    critic: {
      verdict: 'pass',
      topicClarity: 5,
      concreteTension: 5,
      curiosity: 5,
      nativeVoice: 5,
      claimSafety: 5,
      topicMatchesEvidence: true,
      supportedEvidenceRefs: [fallbackRef],
      unsupportedSpans: [],
      duplicateClusterId: `local-mock-cluster-${index + 1}`,
      nearDuplicateOf: null,
      reason: 'Offline fixture verdict; no customer creative was generated.',
    },
    qualified: true,
    weightedScore: 55,
  }));
  return sealHookPlan({
    planId: planIdFor(resolvedRequest),
    schemaVersion: HOOK_PLAN_SCHEMA_VERSION,
    promptVersion: HOOK_PROMPT_VERSION,
    status: 'selected',
    requestFingerprint: resolvedRequest.requestFingerprint,
    sourceFingerprint: resolvedRequest.sourceFingerprint,
    policyFingerprint: resolvedRequest.policyFingerprint,
    outputCount: resolvedRequest.outputCount,
    outputBindings: resolvedRequest.outputBindings,
    candidatePoolSize: HOOK_CANDIDATE_COUNT,
    rounds: 0,
    generatedCandidateCount: HOOK_CANDIDATE_COUNT,
    acceptedCandidateCount: HOOK_CANDIDATE_COUNT,
    selectedHooks: pool.slice(0, resolvedRequest.outputCount).map((candidate, index) => selectedHookRecord({
      ...candidate,
      assignmentId: resolvedRequest.outputBindings[index]?.assignmentId || `hook-output-${index + 1}`,
      assignmentEvidenceRefs: resolvedRequest.outputBindings[index]?.evidenceRefs || [],
    }, index)),
    rejectedCandidateCount: HOOK_CANDIDATE_COUNT - resolvedRequest.outputCount,
    candidatePool: pool.map(candidateAuditRecord),
    stageHistory: [],
    holdReasons: [],
    intelligenceUsage: { intelligenceCallCount: 0, maxIntelligenceCalls: resolvedRequest.maxIntelligenceCalls, stageCalls: { hook_writer: 0, hook_cold_reader: 0, hook_critic: 0 } },
    planningBudget: planningBudget(resolvedRequest),
    intelligenceMode: 'local_mock_fixture',
    generationProviderCalls: 0,
    providerMutations: 0,
  });
}

export function sealHookPlan(plan = {}) {
  const plain = clonePlain(plan);
  delete plain.planFingerprint;
  return { ...plain, planFingerprint: fingerprint(plain) };
}

export function validateHookPlanForRequest({ plan, request, allowHeld = true } = {}) {
  if (!plan || !request) throw new Error('Hook plan validation needs a plan and request.');
  if (plan.schemaVersion !== HOOK_PLAN_SCHEMA_VERSION || plan.promptVersion !== HOOK_PROMPT_VERSION) {
    throw new Error('Hook plan schema or prompt version does not match the request contract.');
  }
  if (plan.planId !== planIdFor(request)) throw new Error('Hook plan id does not match the request.');
  for (const field of ['requestFingerprint', 'sourceFingerprint', 'policyFingerprint', 'outputCount', 'candidatePoolSize']) {
    if (plan[field] !== request[field]) throw new Error(`Hook plan ${field} does not match the request.`);
  }
  if (stableStringify(plan.outputBindings || []) !== stableStringify(request.outputBindings || [])) {
    throw new Error('Hook plan output bindings do not match the request.');
  }
  const actualFingerprint = plan.planFingerprint;
  const resealed = sealHookPlan(plan);
  if (!actualFingerprint || actualFingerprint !== resealed.planFingerprint) {
    throw new Error('Hook plan fingerprint is invalid.');
  }
  const calls = Number(plan.intelligenceUsage?.intelligenceCallCount || 0);
  if (calls > request.maxIntelligenceCalls) throw new Error('Hook plan exceeded its intelligence-call ceiling.');
  if (Number(plan.rounds || 0) > request.maxQualityRounds) throw new Error('Hook plan exceeded its quality-round ceiling.');
  if (plan.planningBudget?.maxIntelligenceCalls !== request.maxIntelligenceCalls
    || plan.planningBudget?.candidatePoolSize !== request.candidatePoolSize
    || plan.planningBudget?.maxQualityRounds !== request.maxQualityRounds) {
    throw new Error('Hook plan budget does not match the server-owned request.');
  }
  if (plan.status === 'held') {
    if (!allowHeld) throw new Error('Hook plan is held.');
    if ((plan.selectedHooks || []).length) throw new Error('Held hook plans cannot contain selected hooks.');
    return plan;
  }
  if (plan.status !== 'selected') throw new Error('Hook plan has an unknown status.');
  if ((plan.selectedHooks || []).length < request.outputCount) {
    throw new Error('Hook plan does not contain enough selected hooks.');
  }
  if (!Array.isArray(plan.candidatePool) || plan.candidatePool.length !== request.candidatePoolSize) {
    throw new Error('Selected Hook Plan does not preserve the complete candidate pool.');
  }
  const candidateById = new Map(plan.candidatePool.map((candidate) => [candidate.candidateId, candidate]));
  const hookFingerprints = new Set();
  const captionFingerprints = new Set();
  const clusterIds = new Set();
  for (let index = 0; index < request.outputCount; index += 1) {
    const selected = plan.selectedHooks[index];
    const binding = request.outputBindings[index];
    const candidate = candidateById.get(selected.candidateId);
    if (!candidate?.qualified) throw new Error('Selected Hook Plan references a missing or unqualified candidate.');
    if (stableStringify(canonicalCandidateRecord(selected)) !== stableStringify(canonicalCandidateRecord(candidate))) {
      throw new Error('Selected Hook Plan copy or verdict does not match its immutable candidate-pool row.');
    }
    const hookFingerprint = normalizeCopyFingerprint(selected.spokenHook);
    const captionFingerprint = normalizeCopyFingerprint(selected.caption);
    const clusterId = cleanText(selected.critic?.duplicateClusterId);
    if (!hookFingerprint || !captionFingerprint || !clusterId
      || hookFingerprints.has(hookFingerprint)
      || captionFingerprints.has(captionFingerprint)
      || clusterIds.has(clusterId)) {
      throw new Error('Selected Hook Plan contains duplicate copy or semantic clusters.');
    }
    if (selected.assignmentId !== binding.assignmentId
      || stableStringify(selected.assignmentEvidenceRefs || []) !== stableStringify(binding.evidenceRefs || [])
      || !candidateSupportsBinding(selected, binding)) {
      throw new Error('Selected Hook Plan is not aligned to its assigned claim/screens.');
    }
    hookFingerprints.add(hookFingerprint);
    captionFingerprints.add(captionFingerprint);
    clusterIds.add(clusterId);
  }
  return plan;
}

export function assertHookRequestMatchesSource({ source, request } = {}) {
  if (!request) throw new Error('Hook planning request is missing.');
  const expected = buildHookPlanningRequest({
    source,
    outputCount: request.outputCount,
    outputBindings: request.outputBindings,
    policy: request.policy,
    maxRounds: request.maxQualityRounds,
  });
  for (const field of [
    'schemaVersion', 'promptVersion', 'outputCount', 'candidatePoolSize', 'maxQualityRounds',
    'maxIntelligenceCalls', 'maxInputCharacters', 'sourceFingerprint', 'policyFingerprint', 'requestFingerprint',
  ]) {
    if (request[field] !== expected[field]) throw new Error(`Hook planning request ${field} is stale or invalid.`);
  }
  return request;
}

function normalizeCandidates(candidates, {
  evidence,
  appName,
  policy,
  candidateIdPrefix,
  existingCandidates = [],
} = {}) {
  const evidenceIds = new Set((evidence.reviewedEvidence || []).map((item) => item.id));
  const seenHooks = new Set((existingCandidates || []).map((candidate) => normalizeCopyFingerprint(candidate.spokenHook)).filter(Boolean));
  const seenCaptions = new Set((existingCandidates || []).map((candidate) => normalizeCopyFingerprint(candidate.caption)).filter(Boolean));
  const accepted = [];
  const rejections = [];
  const attempts = [];
  const rawList = Array.isArray(candidates) ? candidates.slice(0, HOOK_CANDIDATE_COUNT + 1) : [];
  for (let index = 0; index < rawList.length; index += 1) {
    const raw = rawList[index];
    const candidate = {
      candidateId: `${candidateIdPrefix || 'candidate'}-${index + 1}`,
      writerCandidateId: cleanText(raw?.candidateId).slice(0, 80),
      patternId: cleanText(raw?.patternId),
      spokenHook: cleanText(raw?.spokenHook),
      caption: cleanText(raw?.caption),
      targetBehavior: cleanText(raw?.targetBehavior).slice(0, 180),
      tension: cleanText(raw?.tension).slice(0, 180),
      evidenceRefs: [...new Set((Array.isArray(raw?.evidenceRefs) ? raw.evidenceRefs : []).map(cleanText).filter((id) => evidenceIds.has(id)))],
    };
    const reason = deterministicRejectionReason(candidate, { appName, policy });
    const hookFingerprint = normalizeCopyFingerprint(candidate.spokenHook);
    const captionFingerprint = normalizeCopyFingerprint(candidate.caption);
    if (reason) {
      rejections.push({ candidateId: candidate.candidateId, writerCandidateId: candidate.writerCandidateId, reason });
      attempts.push(deterministicAttemptRecord(candidate, { accepted: false, reason }));
      continue;
    }
    if (seenHooks.has(hookFingerprint)) {
      const duplicateReason = 'duplicate spoken hook';
      rejections.push({ candidateId: candidate.candidateId, writerCandidateId: candidate.writerCandidateId, reason: duplicateReason });
      attempts.push(deterministicAttemptRecord(candidate, { accepted: false, reason: duplicateReason }));
      continue;
    }
    if (seenCaptions.has(captionFingerprint)) {
      const duplicateReason = 'duplicate hook caption';
      rejections.push({ candidateId: candidate.candidateId, writerCandidateId: candidate.writerCandidateId, reason: duplicateReason });
      attempts.push(deterministicAttemptRecord(candidate, { accepted: false, reason: duplicateReason }));
      continue;
    }
    seenHooks.add(hookFingerprint);
    seenCaptions.add(captionFingerprint);
    accepted.push(candidate);
    attempts.push(deterministicAttemptRecord(candidate, { accepted: true }));
  }
  if (rawList.length !== HOOK_CANDIDATE_COUNT) {
    rejections.push({ candidateId: 'candidate-pool', writerCandidateId: '', reason: `writer returned ${rawList.length}; expected exactly ${HOOK_CANDIDATE_COUNT}` });
  }
  return { candidates: accepted, rejections, attempts };
}

function deterministicAttemptRecord(candidate, { accepted = false, reason = '' } = {}) {
  return {
    candidateId: candidate.candidateId,
    writerCandidateId: candidate.writerCandidateId || null,
    patternId: candidate.patternId || null,
    spokenHook: candidate.spokenHook || '',
    caption: candidate.caption || '',
    targetBehavior: candidate.targetBehavior || '',
    tension: candidate.tension || '',
    evidenceRefs: [...(candidate.evidenceRefs || [])],
    deterministicAccepted: accepted === true,
    deterministicRejectionReason: accepted ? null : cleanText(reason) || 'deterministic rail rejected candidate',
  };
}

function deterministicRejectionReason(candidate, { appName, policy } = {}) {
  const resolvedPolicy = normalizePolicy(policy);
  if (!candidate.writerCandidateId) return 'missing writer candidate id';
  if (!PATTERN_IDS.includes(candidate.patternId)) return 'unknown creative pattern id';
  const words = wordCount(candidate.spokenHook);
  if (words < resolvedPolicy.minSpokenWords || words > resolvedPolicy.maxSpokenWords) return `spoken hook has ${words} words; expected ${resolvedPolicy.minSpokenWords}-${resolvedPolicy.maxSpokenWords}`;
  if (!candidate.caption || candidate.caption.length > resolvedPolicy.maxCaptionCharacters) return `caption is missing or longer than ${resolvedPolicy.maxCaptionCharacters} characters`;
  if (!candidate.targetBehavior || !candidate.tension) return 'target behavior or tension is missing';
  if (!candidate.evidenceRefs.length) return 'no valid reviewed-evidence reference';
  if (/^(hey|what'?s up|have you ever|introducing|download|try|check out)\b/i.test(candidate.spokenHook)) return 'generic greeting, ad opener, or CTA';
  if (/\b(watch this|game[ -]?changer|revolutionary|seamless|unlock your|supercharge)\b/i.test(`${candidate.spokenHook} ${candidate.caption}`)) return 'generic ad/template language';
  if (containsUnsupportedNumber(candidate.spokenHook)) return 'numeric outcome is not allowed in the opening hook';
  if (containsWrittenNumberDuration(`${candidate.spokenHook} ${candidate.caption}`)) return 'written-number time or duration claim is not allowed in the opening hook';
  if (explicitBrandCue(candidate.spokenHook, appName) || explicitBrandCue(candidate.caption, appName)) return 'brand appears in hook';
  return null;
}

function normalizeColdRead(candidateId, raw = {}) {
  return {
    candidateId,
    inferredTopic: cleanText(raw.inferredTopic).slice(0, 160),
    topicConfidence: strictProbability(raw.topicConfidence),
    behaviorOrSituation: cleanText(raw.behaviorOrSituation).slice(0, 220),
    tensionOrConsequence: cleanText(raw.tensionOrConsequence).slice(0, 220),
    curiosityGap: cleanText(raw.curiosityGap).slice(0, 220),
    unexplainedTerms: (Array.isArray(raw.unexplainedTerms) ? raw.unexplainedTerms : []).map(cleanText).filter(Boolean).slice(0, 12),
  };
}

function attachCriticReviews(candidates, reviews, coldReads, evidence) {
  const byId = uniqueRecordsById(reviews, 'candidateId');
  const coldById = uniqueRecordsById(coldReads, 'candidateId');
  const evidenceIds = new Set((evidence.reviewedEvidence || []).map((item) => item.id));
  return candidates.map((candidate) => {
    const raw = byId.get(candidate.candidateId) || {};
    const coldRead = coldById.get(candidate.candidateId) || normalizeColdRead(candidate.candidateId, {});
    const supportedEvidenceRefs = [...new Set((Array.isArray(raw.supportedEvidenceRefs) ? raw.supportedEvidenceRefs : []).map(cleanText).filter((id) => evidenceIds.has(id)))];
    const unsupportedSpans = (Array.isArray(raw.unsupportedSpans) ? raw.unsupportedSpans : []).map(cleanText).filter(Boolean).slice(0, 12);
    const critic = {
      verdict: raw.verdict === 'pass' ? 'pass' : 'reject',
      topicClarity: strictScore(raw.topicClarity),
      concreteTension: strictScore(raw.concreteTension),
      curiosity: strictScore(raw.curiosity),
      nativeVoice: strictScore(raw.nativeVoice),
      claimSafety: strictScore(raw.claimSafety),
      topicMatchesEvidence: raw.topicMatchesEvidence === true,
      supportedEvidenceRefs,
      unsupportedSpans,
      duplicateClusterId: cleanText(raw.duplicateClusterId).slice(0, 120),
      nearDuplicateOf: cleanText(raw.nearDuplicateOf) || null,
      reason: cleanText(raw.reason).slice(0, 300) || 'No critic rationale returned.',
    };
    const scoresValid = [critic.topicClarity, critic.concreteTension, critic.curiosity, critic.nativeVoice, critic.claimSafety].every((value) => value !== null);
    const qualified = scoresValid
      && critic.verdict === 'pass'
      && critic.topicClarity >= 4
      && critic.concreteTension >= 4
      && critic.curiosity >= 3
      && critic.nativeVoice >= 4
      && critic.claimSafety === 5
      && critic.topicMatchesEvidence
      && critic.supportedEvidenceRefs.length > 0
      && critic.unsupportedSpans.length === 0
      && Boolean(critic.duplicateClusterId)
      && !critic.nearDuplicateOf
      && coldRead.topicConfidence >= 0.85
      && Boolean(coldRead.inferredTopic)
      && Boolean(coldRead.behaviorOrSituation)
      && Boolean(coldRead.tensionOrConsequence)
      && coldRead.unexplainedTerms.length === 0;
    const weightedScore = scoresValid
      ? critic.topicClarity * 3 + critic.concreteTension * 3 + critic.nativeVoice * 2 + critic.curiosity + critic.claimSafety * 2
      : 0;
    return { ...candidate, coldRead, critic, qualified, weightedScore };
  });
}

function selectHooks(reviewed, count, outputBindings = []) {
  const ranked = reviewed.filter((candidate) => candidate.qualified).sort((a, b) => b.weightedScore - a.weightedScore || a.candidateId.localeCompare(b.candidateId));
  const deduped = [];
  const usedClusters = new Set();
  for (const candidate of ranked) {
    if (usedClusters.has(candidate.critic.duplicateClusterId)) continue;
    deduped.push(candidate);
    usedClusters.add(candidate.critic.duplicateClusterId);
  }
  const selected = [];
  const usedPatterns = new Set();
  for (let index = 0; index < count; index += 1) {
    const binding = outputBindings[index] || { assignmentId: `hook-output-${index + 1}`, evidenceRefs: [] };
    const eligible = deduped.filter((candidate) => (
      !selected.some((item) => item.candidateId === candidate.candidateId)
      && candidateSupportsBinding(candidate, binding)
    ));
    const candidate = eligible.find((item) => !usedPatterns.has(item.patternId)) || eligible[0];
    if (!candidate) break;
    selected.push({
      ...candidate,
      assignmentId: binding.assignmentId,
      assignmentEvidenceRefs: [...(binding.evidenceRefs || [])],
    });
    usedPatterns.add(candidate.patternId);
  }
  return selected;
}

function candidateSupportsBinding(candidate, binding) {
  const allowed = new Set(binding?.evidenceRefs || []);
  if (!allowed.size) return true;
  const supported = new Set(candidate?.critic?.supportedEvidenceRefs || []);
  return [...allowed].some((ref) => supported.has(ref));
}

function canonicalCandidateRecord(candidate = {}) {
  return {
    candidateId: candidate.candidateId || null,
    writerCandidateId: candidate.writerCandidateId || null,
    patternId: candidate.patternId || null,
    spokenHook: candidate.spokenHook || '',
    caption: candidate.caption || '',
    targetBehavior: candidate.targetBehavior || '',
    tension: candidate.tension || '',
    evidenceRefs: candidate.evidenceRefs || [],
    coldRead: candidate.coldRead || null,
    critic: candidate.critic || null,
  };
}

function selectedHookRecord(candidate, index = 0) {
  return {
    selectionIndex: Number(candidate.selectionIndex) || index + 1,
    candidateId: candidate.candidateId,
    writerCandidateId: candidate.writerCandidateId || null,
    patternId: candidate.patternId,
    spokenHook: candidate.spokenHook,
    caption: candidate.caption,
    targetBehavior: candidate.targetBehavior,
    tension: candidate.tension,
    evidenceRefs: [...(candidate.evidenceRefs || [])],
    assignmentId: candidate.assignmentId || null,
    assignmentEvidenceRefs: [...(candidate.assignmentEvidenceRefs || [])],
    coldRead: clonePlain(candidate.coldRead),
    critic: clonePlain(candidate.critic),
  };
}

function candidateAuditRecord(candidate) {
  return {
    selectionIndex: Number(candidate.selectionIndex) || null,
    candidateId: candidate.candidateId,
    writerCandidateId: candidate.writerCandidateId || null,
    patternId: candidate.patternId,
    spokenHook: candidate.spokenHook,
    caption: candidate.caption,
    targetBehavior: candidate.targetBehavior,
    tension: candidate.tension,
    evidenceRefs: [...(candidate.evidenceRefs || [])],
    assignmentId: candidate.assignmentId || null,
    assignmentEvidenceRefs: [...(candidate.assignmentEvidenceRefs || [])],
    coldRead: candidate.coldRead ? clonePlain(candidate.coldRead) : null,
    critic: candidate.critic ? clonePlain(candidate.critic) : null,
    qualified: candidate.qualified === true,
    weightedScore: Number(candidate.weightedScore) || 0,
  };
}

function planningBudget(request) {
  return {
    maxQualityRounds: request.maxQualityRounds,
    maxIntelligenceCalls: request.maxIntelligenceCalls,
    maxInputCharacters: request.maxInputCharacters,
    candidatePoolSize: request.candidatePoolSize,
    maxOutputs: HOOK_MAX_OUTPUTS_PER_PLAN,
  };
}

function planIdFor(request) {
  return `hook-plan-${String(request.requestFingerprint || '').slice(0, 20)}`;
}

function hookAgentError(message, metrics) {
  const error = new Error(message);
  error.hookAgentMetrics = metrics;
  return error;
}

function normalizePolicy(policy = {}) {
  const minSpokenWords = positiveInteger(policy.minSpokenWords, 6);
  const maxSpokenWords = Math.max(minSpokenWords, positiveInteger(policy.maxSpokenWords, 14));
  return {
    minSpokenWords,
    maxSpokenWords,
    maxCaptionCharacters: positiveInteger(policy.maxCaptionCharacters, 50),
  };
}

function normalizeNotes(notes) {
  return (Array.isArray(notes) ? notes : []).map(cleanText).filter(Boolean).map((note) => note.slice(0, 500)).slice(0, 24);
}

function normalizeOutputBindings(bindings, requestedCount, validEvidenceIds = new Set()) {
  const raw = Array.isArray(bindings) ? bindings : [];
  return Array.from({ length: requestedCount }, (_, index) => {
    const binding = raw[index] || {};
    const requestedEvidenceRefs = [...new Set((Array.isArray(binding.evidenceRefs) ? binding.evidenceRefs : []).map(cleanText).filter(Boolean))].slice(0, 20);
    const invalidEvidenceRefs = requestedEvidenceRefs.filter((ref) => !validEvidenceIds.has(ref));
    if (invalidEvidenceRefs.length) {
      throw new Error(`Hook output binding cites unknown reviewed evidence: ${invalidEvidenceRefs.join(', ')}.`);
    }
    return {
      assignmentId: cleanText(binding.assignmentId).slice(0, 120) || `hook-output-${index + 1}`,
      evidenceRefs: requestedEvidenceRefs,
    };
  });
}

function containsUnsupportedNumber(text) {
  return /\b\d+(?:\.\d+)?%?\b/.test(String(text || ''));
}

function containsWrittenNumberDuration(text) {
  const numberWord = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|couple|few|several)';
  const durationUnit = '(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?)';
  return new RegExp(`\\b${numberWord}(?:[-\\s]+(?:and[-\\s]+)?${numberWord})*(?:[-\\s]+of)?[-\\s]+${durationUnit}\\b`, 'i').test(String(text || ''));
}

function explicitBrandCue(text, appName) {
  const shortName = cleanText(appName).split(/[:\-|]/)[0].trim();
  if (!shortName || shortName.length < 3 || shortName.toLowerCase() === 'this app') return false;
  const escaped = shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(String(text || ''));
}

function normalizeCopyFingerprint(text) {
  return cleanText(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function wordCount(value) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function strictScore(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function strictProbability(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : -1;
}

function positiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  return JSON.stringify(sortForFingerprint(value));
}

function sortForFingerprint(value) {
  if (Array.isArray(value)) return value.map(sortForFingerprint);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortForFingerprint(value[key])]));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqueRecordsById(records, field) {
  const map = new Map();
  const duplicates = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const id = cleanText(record?.[field]);
    if (!id || map.has(id)) {
      if (id) duplicates.add(id);
      continue;
    }
    map.set(id, record);
  }
  for (const id of duplicates) map.delete(id);
  return map;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  let failed = false;
  let firstError;
  async function consume() {
    while (!failed && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  if (failed) throw firstError;
  return results;
}
