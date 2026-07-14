/* Provider-neutral Creative Pack Plan contract.
 *
 * This module is deliberately pure: it performs no I/O, calls no model, and
 * owns no mutable state. A research/planning adapter may supply market and
 * strategy inputs, but this contract owns evidence typing, bounded snapshots,
 * deterministic assignments, immutable fingerprints, and claim-safety rails.
 */

import { createHash } from 'node:crypto';

export const CREATIVE_PACK_PLAN_SCHEMA_VERSION = 'creative-pack-plan.v1';
export const PACK_PLAN_RESEARCH_SCHEMA_VERSION = 'pack-plan-research-snapshot.v1';
export const REVIEW_DECISION_SCHEMA_VERSION = 'review-decision.v1';
export const LEARNING_EVENT_SCHEMA_VERSION = 'learning-event.v1';

export const PACK_PLAN_LIMITS = Object.freeze({
  productTruth: 48,
  marketSignals: 24,
  learningSignals: 24,
  imageAds: 40,
  ugcAds: 6,
  totalOutputs: 46,
  evidenceRefsPerStrategyField: 24,
});

export const PACK_PLAN_CREDIT_RULES = Object.freeze({
  image_ad: 4,
  ugc_ad: 60,
});

export const PRODUCT_TRUTH_KINDS = Object.freeze(['app_summary', 'claim', 'screen']);
export const MARKET_SIGNAL_KINDS = Object.freeze([
  'store_review',
  'community_discussion',
  'competitor_review',
  'website_context',
  'creator_language',
]);
export const LEARNING_SIGNAL_TYPES = Object.freeze([
  'liked_angle',
  'rejected_angle',
  'tweak_instruction',
  'avoid_angle',
]);
export const REVIEW_ACTIONS = Object.freeze(['approved', 'rejected', 'tweak']);

/**
 * Convert the currently selected app summary, claims, and screens into the
 * canonical product-truth records used by a Pack Plan.
 */
export function buildSelectedProductTruth(app = {}) {
  const appId = boundedText(app.appId || app.id || 'app', 160);
  const storeUrl = safeHttpUrl(app.extraction?.app?.storeUrl || app.storeUrl || null);
  const records = [];
  const summary = boundedText(app.tagline || app.summary || app.extraction?.app?.summary || '', 1_500);

  if (summary) {
    records.push({
      id: `summary:${appId}`,
      kind: 'app_summary',
      text: summary,
      source: compactObject({
        label: boundedText(app.source || 'Reviewed app info', 160),
        url: storeUrl,
      }),
      canSupportProductClaim: true,
    });
  }

  for (const claim of app.claims || []) {
    if (!claim || claim.selected === false || claim.ignored || claim.supported === false) continue;
    const claimId = boundedText(claim.id, 160);
    const text = boundedText(claim.text, 800);
    if (!claimId || !text) continue;
    records.push({
      id: `claim:${claimId}`,
      kind: 'claim',
      text,
      source: compactObject({
        label: boundedText(claim.source || 'Reviewed app info', 160),
        url: safeHttpUrl(claim.sourceUrl || storeUrl),
      }),
      canSupportProductClaim: true,
    });
  }

  for (const screen of app.screens || []) {
    if (
      !screen
      || screen.selected === false
      || screen.ignored
      || screen.usability === 'blocked'
      || !(screen.assetId || screen.storageKey || screen.sourceUrl)
    ) continue;
    const screenId = boundedText(screen.id, 160);
    if (!screenId) continue;
    records.push({
      id: `screen:${screenId}`,
      kind: 'screen',
      text: boundedText([screen.label, screen.detail].filter(Boolean).join(' — ') || 'Reviewed app screen', 800),
      source: compactObject({
        label: boundedText(screen.sourceType || 'Reviewed app screen', 160),
        url: safeHttpUrl(screen.sourceUrl),
        assetId: boundedText(screen.assetId, 160) || null,
        storageKey: boundedText(screen.storageKey, 500) || null,
      }),
      canSupportProductClaim: false,
    });
  }

  const normalized = normalizeProductTruth(records);
  assertProductTruthReady(normalized);
  return deepFreeze(normalized);
}

/**
 * Build an immutable, bounded research snapshot. Counts and source rows are
 * always derived from supplied signals; an empty input therefore reports real
 * zeroes and never manufactures evidence for a more impressive fallback.
 */
export function buildPackPlanResearchSnapshot({
  app = null,
  productTruth = null,
  marketSignals = [],
  learningSignals = [],
  capturedAt,
} = {}) {
  const truth = productTruth ? normalizeProductTruth(productTruth) : buildSelectedProductTruth(app || {});
  assertProductTruthReady(truth);
  const markets = normalizeMarketSignals(marketSignals);
  const learnings = normalizeLearningSignals(learningSignals);
  const sourceRows = uniqueSourceRows(markets);
  const observedItemCount = markets.reduce((total, signal) => total + signal.observedItemCount, 0);
  const coverage = {
    level: marketCoverageLevel(markets, sourceRows),
    marketSignalCount: markets.length,
    observedItemCount,
    sourceCount: sourceRows.length,
    sources: sourceRows,
  };
  const productTruthFingerprint = fingerprint(truth);
  const snapshotBody = {
    schemaVersion: PACK_PLAN_RESEARCH_SCHEMA_VERSION,
    capturedAt: requiredIso(capturedAt, 'Research snapshot capturedAt'),
    productTruth: truth,
    marketSignals: markets,
    learningSignals: learnings,
    coverage,
    productTruthFingerprint,
    providerMutations: 0,
  };
  const snapshotFingerprint = fingerprint(snapshotBody);
  return deepFreeze({ ...snapshotBody, snapshotFingerprint });
}

/**
 * Build one proposed Pack Plan with a common hypothesis and a controlled
 * primary/challenger experiment. The only experiment variable is `angle`.
 * When no usable market evidence exists and no strategy is supplied, the
 * deterministic exploratory fallback remains grounded solely in product truth.
 */
export function buildCreativePackPlan({
  orgId,
  workspaceId,
  appId,
  createdBy,
  createdAt,
  researchSnapshot,
  outputMix,
  strategy = null,
  goal = 'Find the clearest creative direction for this app.',
  channel = 'Paid social',
} = {}) {
  validatePackPlanResearchSnapshot(researchSnapshot);
  const mix = normalizeOutputMix(outputMix);
  const strategyResult = strategy
    ? normalizeSuppliedStrategy(strategy, researchSnapshot)
    : buildExploratoryStrategy(researchSnapshot);
  const assignments = buildOutputAssignments({
    outputMix: mix,
    researchSnapshot,
    experiment: strategyResult.experiment,
  });
  const costCredits = (mix.image * PACK_PLAN_CREDIT_RULES.image_ad)
    + (mix.ugc * PACK_PLAN_CREDIT_RULES.ugc_ad);
  const planBody = {
    schemaVersion: CREATIVE_PACK_PLAN_SCHEMA_VERSION,
    orgId: requiredText(orgId, 'orgId', 160),
    workspaceId: requiredText(workspaceId, 'workspaceId', 160),
    appId: requiredText(appId, 'appId', 160),
    createdBy: requiredText(createdBy, 'createdBy', 160),
    status: 'proposed',
    evidenceMode: strategyResult.evidenceMode,
    request: {
      goal: requiredText(goal, 'goal', 500),
      channel: requiredText(channel, 'channel', 120),
      outputMix: mix,
    },
    sourceFingerprint: researchSnapshot.snapshotFingerprint,
    productTruthFingerprint: researchSnapshot.productTruthFingerprint,
    researchSnapshot,
    hypothesis: strategyResult.hypothesis,
    experiment: strategyResult.experiment,
    assignments,
    costCredits,
    creativeDebitStatus: 'not_charged',
    createdAt: requiredIso(createdAt, 'Pack Plan createdAt'),
    providerMutations: 0,
  };
  const planFingerprint = fingerprint(planBody);
  const planId = `pack-plan-${planFingerprint.slice(0, 20)}`;
  const plan = deepFreeze({ ...planBody, planId, planFingerprint });
  validateCreativePackPlan({ plan });
  return plan;
}

/**
 * Turn cited market signals and typed review learning into the next plan's
 * user-readable strategy. Approved angles choose direction. Tweak notes refine
 * execution but must never promote an otherwise unapproved angle.
 */
export function buildLearnedPackPlanStrategy({ reviewedApp = {}, researchSnapshot, publicResearch = {} } = {}) {
  validatePackPlanResearchSnapshot(researchSnapshot);
  const claims = researchSnapshot.productTruth.filter((item) => item.canSupportProductClaim);
  const proofs = researchSnapshot.productTruth.filter((item) => item.kind === 'screen');
  const markets = researchSnapshot.marketSignals;
  const learnings = researchSnapshot.learningSignals;
  if (!markets.length && !learnings.length) {
    return productSpecificTruthStrategy(researchSnapshot);
  }

  const newestLearnings = [...learnings].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const latestByAngle = new Map(
    [...learnings]
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((item) => [copyKey(item.angle), item])
  );
  const rejectedAngles = new Set(
    [...latestByAngle.entries()]
      .filter(([, item]) => item.polarity === 'negative')
      .map(([angle]) => angle)
  );
  const likedLearning = newestLearnings.find((item) => (
    item.type === 'liked_angle'
    && item.polarity === 'positive'
    && latestByAngle.get(copyKey(item.angle))?.polarity !== 'negative'
  ));
  const tweakLearning = newestLearnings.find((item) => (
    item.type === 'tweak_instruction' && item.polarity === 'directive'
  ));

  const truthStrategy = productSpecificTruthStrategy(researchSnapshot);
  const defaultProofAngle = 'Show the app in action';
  const defaultBenefitAngle = 'Lead with the main benefit';
  const primaryAngle = likedLearning?.angle
    || truthStrategy.primary.angle;
  const defaultAlternate = likedLearning
    ? copyKey(primaryAngle) === copyKey(defaultProofAngle)
      ? defaultBenefitAngle
      : defaultProofAngle
    : truthStrategy.challenger.angle;
  let challengerAngle = defaultAlternate;
  if (copyKey(challengerAngle) === copyKey(primaryAngle) || rejectedAngles.has(copyKey(challengerAngle))) {
    const alternate = likedLearning ? truthStrategy.primary.angle : defaultBenefitAngle;
    challengerAngle = rejectedAngles.has(copyKey(alternate))
      ? 'Try a fresh opening with the same app evidence'
      : alternate;
  }

  const firstMarket = bestMarketSignalForAngle(primaryAngle, markets);
  const secondMarket = bestMarketSignalForAngle(
    challengerAngle,
    markets.filter((item) => item.id !== firstMarket?.id),
  ) || markets.find((item) => item.id !== firstMarket?.id) || firstMarket || null;

  const mechanism = claims[0]?.text || reviewedApp.tagline || 'the reviewed app value';
  const sharedRefs = [claims[0]?.id, proofs[0]?.id].filter(Boolean);
  const primaryTruthRefs = likedLearning ? sharedRefs : truthStrategy.primary.evidenceRefs;
  const challengerTruthRefs = likedLearning ? sharedRefs : truthStrategy.challenger.evidenceRefs;
  const primarySignalRef = likedLearning?.id || firstMarket?.id || null;
  const challengerSignalRef = secondMarket?.id || firstMarket?.id || null;
  const tweakRef = tweakLearning?.id || null;
  const audience = publicResearch?.audience?.segment || 'People whose needs match the reviewed app information';
  const trigger = publicResearch?.audience?.triggerMoment || 'when the problem becomes difficult to ignore';
  const statement = markets.length && publicResearch?.audience?.segment
    ? `We think “${primaryAngle}” will be the stronger opening for ${strategySentenceFragment(audience)}.`
    : `“${primaryAngle}” should lead the next pack.`;
  const tension = tweakLearning?.instruction
    || firstMarket?.paraphrase
    || likedLearning?.instruction
    || 'Previous creative review gives this pack a more specific direction.';

  return {
    claimIds: claims.map((item) => item.id),
    proofIds: proofs.map((item) => item.id),
    hypothesis: {
      statement,
      audience: `${audience} ${trigger}`.trim(),
      tension,
      valueConnection: `The approved app info supports: ${mechanism}`,
      intendedLearning: 'Which opening should lead the next pack.',
      evidenceRefs: unique([...sharedRefs, primarySignalRef, challengerSignalRef, tweakRef].filter(Boolean)),
    },
    primary: {
      angle: primaryAngle,
      rationale: likedLearning
        ? 'You approved this direction before.'
        : firstMarket
          ? 'This product message connects to a pattern in public feedback.'
          : 'This keeps the clearest app evidence front and centre.',
      evidenceRefs: unique([...primaryTruthRefs, primarySignalRef, tweakRef].filter(Boolean)),
    },
    challenger: {
      angle: challengerAngle,
      rationale: secondMarket
        ? 'This tests a different verified product message against another public-feedback pattern.'
        : 'A different opening using the same app facts and screens.',
      evidenceRefs: unique([...challengerTruthRefs, challengerSignalRef, tweakRef].filter(Boolean)),
    },
  };
}

function bestMarketSignalForAngle(angle, markets) {
  const terms = strategyMatchTerms(angle);
  return [...markets]
    .map((market, index) => ({
      market,
      index,
      score: [...strategyMatchTerms(`${market.theme} ${market.paraphrase}`)]
        .filter((term) => terms.has(term)).length,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.market || null;
}

function strategyMatchTerms(value) {
  const stop = new Set(['about', 'after', 'again', 'against', 'another', 'could', 'different', 'from', 'have', 'into', 'more', 'should', 'their', 'there', 'these', 'they', 'this', 'through', 'using', 'very', 'with', 'your']);
  return new Set(
    copyKey(value)
      .split(/\s+/)
      .filter((term) => term.length >= 4 && !stop.has(term))
  );
}

/**
 * Validate structure, immutable fingerprints, evidence typing, deterministic
 * assignments, and (when supplied) freshness against the currently selected
 * app truth. Returns the original plan on success and throws on failure.
 */
export function validateCreativePackPlan({ plan, currentApp = null } = {}) {
  if (!plan || plan.schemaVersion !== CREATIVE_PACK_PLAN_SCHEMA_VERSION) {
    throw new Error('Creative Pack Plan schema is invalid.');
  }
  validatePackPlanResearchSnapshot(plan.researchSnapshot);
  if (plan.sourceFingerprint !== plan.researchSnapshot.snapshotFingerprint) {
    throw new Error('Creative Pack Plan source fingerprint is stale.');
  }
  if (plan.productTruthFingerprint !== plan.researchSnapshot.productTruthFingerprint) {
    throw new Error('Creative Pack Plan product-truth fingerprint is stale.');
  }
  const expectedFingerprint = fingerprint(planWithoutIdentity(plan));
  if (plan.planFingerprint !== expectedFingerprint) {
    throw new Error('Creative Pack Plan immutable fingerprint does not match.');
  }
  if (plan.planId !== `pack-plan-${expectedFingerprint.slice(0, 20)}`) {
    throw new Error('Creative Pack Plan ID does not match its fingerprint.');
  }
  if (plan.status !== 'proposed' || plan.creativeDebitStatus !== 'not_charged') {
    throw new Error('Creative Pack Plan must be proposed and uncharged before pack acceptance.');
  }
  validateExperiment(plan.experiment, plan.researchSnapshot);
  validateAssignments(plan);
  if (plan.costCredits !== expectedCreditCost(plan.request.outputMix)) {
    throw new Error('Creative Pack Plan credit cost does not match its output mix.');
  }
  if (currentApp) {
    const currentTruth = buildSelectedProductTruth(currentApp);
    const currentFingerprint = fingerprint(currentTruth);
    if (currentFingerprint !== plan.productTruthFingerprint) {
      throw new Error('Creative Pack Plan is stale because the selected app truth changed.');
    }
  }
  return plan;
}

/** Validate an immutable research snapshot independently of a plan. */
export function validatePackPlanResearchSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== PACK_PLAN_RESEARCH_SCHEMA_VERSION) {
    throw new Error('Pack Plan research snapshot schema is invalid.');
  }
  const truth = normalizeProductTruth(snapshot.productTruth || []);
  assertProductTruthReady(truth);
  const markets = normalizeMarketSignals(snapshot.marketSignals || []);
  const learnings = normalizeLearningSignals(snapshot.learningSignals || []);
  if (canonicalStringify(truth) !== canonicalStringify(snapshot.productTruth)) {
    throw new Error('Pack Plan product truth is not canonical.');
  }
  if (canonicalStringify(markets) !== canonicalStringify(snapshot.marketSignals)) {
    throw new Error('Pack Plan market signals are not canonical.');
  }
  if (canonicalStringify(learnings) !== canonicalStringify(snapshot.learningSignals)) {
    throw new Error('Pack Plan learning signals are not canonical.');
  }
  if (snapshot.productTruthFingerprint !== fingerprint(truth)) {
    throw new Error('Pack Plan product-truth fingerprint does not match.');
  }
  const expectedBody = { ...toPlain(snapshot) };
  delete expectedBody.snapshotFingerprint;
  if (snapshot.snapshotFingerprint !== fingerprint(expectedBody)) {
    throw new Error('Pack Plan research snapshot fingerprint does not match.');
  }
  const expectedSources = uniqueSourceRows(markets);
  const expectedCoverage = {
    level: marketCoverageLevel(markets, expectedSources),
    marketSignalCount: markets.length,
    observedItemCount: markets.reduce((total, signal) => total + signal.observedItemCount, 0),
    sourceCount: expectedSources.length,
    sources: expectedSources,
  };
  if (canonicalStringify(snapshot.coverage) !== canonicalStringify(expectedCoverage)) {
    throw new Error('Pack Plan market coverage must be derived from real supplied signals.');
  }
  return snapshot;
}

/**
 * Return the customer-facing plan without actor IDs, storage keys, content
 * hashes, or internal source payloads. Public provenance remains inspectable.
 */
export function customerSafeCreativePackPlan(plan) {
  validateCreativePackPlan({ plan });
  const safe = {
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    status: plan.status,
    evidenceMode: plan.evidenceMode,
    request: plan.request,
    hypothesis: plan.hypothesis,
    experiment: plan.experiment,
    assignments: plan.assignments,
    costCredits: plan.costCredits,
    creativeDebitStatus: plan.creativeDebitStatus,
    research: {
      capturedAt: plan.researchSnapshot.capturedAt,
      coverage: plan.researchSnapshot.coverage,
      productTruth: plan.researchSnapshot.productTruth.map(customerSafeProductTruthItem),
      marketSignals: plan.researchSnapshot.marketSignals.map((signal) => ({
        id: signal.id,
        kind: signal.kind,
        theme: signal.theme,
        paraphrase: signal.paraphrase,
        observedItemCount: signal.observedItemCount,
        source: signal.source,
        canSupportProductClaim: false,
      })),
      learningSignals: plan.researchSnapshot.learningSignals,
    },
    sourceFingerprint: plan.sourceFingerprint,
    planFingerprint: plan.planFingerprint,
    createdAt: plan.createdAt,
    providerMutations: 0,
  };
  return deepFreeze(safe);
}

function customerSafeProductTruthItem(item) {
  const sourceLabel = item.kind === 'screen'
    ? customerScreenSourceLabel(item.source?.label)
    : boundedText(item.source?.label || 'Reviewed app info', 160);
  const text = item.kind === 'screen'
    ? customerScreenEvidenceText(item.text, sourceLabel)
    : item.text;
  return {
    id: item.id,
    kind: item.kind,
    text,
    source: compactObject({ label: sourceLabel, url: item.source?.url }),
    canSupportProductClaim: item.canSupportProductClaim,
  };
}

function customerScreenSourceLabel(value) {
  const sourceType = copyKey(value).replaceAll(' ', '_');
  const labels = {
    store_art: 'Store screenshot',
    rawified_store_art: 'Store screenshot',
    raw_app_proof: 'Uploaded screenshot',
    raw_proof: 'Uploaded screenshot',
    app_screenshot: 'Uploaded screenshot',
    user_upload: 'Uploaded screenshot',
    screen_recording: 'Screen recording',
    website_asset: 'Website image',
    first_party_capture: 'App screenshot',
  };
  return labels[sourceType] || 'Reviewed app screen';
}

function customerScreenEvidenceText(value, sourceLabel) {
  const label = boundedText(String(value || '').split(/\s+—\s+/)[0], 300) || sourceLabel;
  return sourceLabel === 'Store screenshot'
    ? `${label} — selected visual reference from the app’s store listing`
    : label;
}

/**
 * Build one immutable review decision and its typed, idempotent learning event.
 * These records can be written atomically by a tenant store without deriving
 * creative memory in a route or browser.
 */
export function buildReviewDecisionLearningPair({
  orgId,
  workspaceId,
  appId,
  packId,
  draftId,
  createdBy,
  action,
  format,
  angle,
  note = '',
  createdAt,
  idempotencyKey = '',
} = {}) {
  const normalizedAction = normalizeReviewAction(action);
  const normalizedFormat = normalizeFormat(format);
  const cleanNote = boundedText(note, 1_000);
  if (normalizedAction === 'tweak' && !cleanNote) {
    throw new Error('A tweak decision needs a concrete instruction.');
  }
  const scope = {
    orgId: requiredText(orgId, 'orgId', 160),
    workspaceId: requiredText(workspaceId, 'workspaceId', 160),
    appId: requiredText(appId, 'appId', 160),
    packId: requiredText(packId, 'packId', 160),
    draftId: requiredText(draftId, 'draftId', 200),
    createdBy: requiredText(createdBy, 'createdBy', 160),
  };
  const normalizedAngle = requiredText(angle, 'angle', 240);
  const timestamp = requiredIso(createdAt, 'Review decision createdAt');
  const stableKey = boundedText(idempotencyKey, 240) || canonicalStringify({
    ...scope,
    action: normalizedAction,
    format: normalizedFormat,
    angle: normalizedAngle,
    note: cleanNote,
    createdAt: timestamp,
  });
  const decisionId = `decision-${fingerprint(stableKey).slice(0, 20)}`;
  const learningEventId = `learning-${decisionId.slice('decision-'.length)}`;
  const learning = learningForDecision({
    action: normalizedAction,
    angle: normalizedAngle,
    note: cleanNote,
  });
  const decision = deepFreeze({
    schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
    decisionId,
    learningEventId,
    ...scope,
    action: normalizedAction,
    format: normalizedFormat,
    angle: normalizedAngle,
    note: cleanNote || null,
    idempotencyKey: stableKey,
    createdAt: timestamp,
    providerMutations: 0,
  });
  const learningEvent = deepFreeze({
    schemaVersion: LEARNING_EVENT_SCHEMA_VERSION,
    eventId: learningEventId,
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    appId: scope.appId,
    packId: scope.packId,
    draftId: scope.draftId,
    sourceDecisionId: decisionId,
    type: learning.type,
    polarity: learning.polarity,
    scope: 'angle',
    angle: normalizedAngle,
    instruction: learning.instruction,
    createdAt: timestamp,
    providerMutations: 0,
  });
  return deepFreeze({ decision, learningEvent });
}

function normalizeProductTruth(records) {
  const inputs = Array.isArray(records) ? records : [];
  if (inputs.length > PACK_PLAN_LIMITS.productTruth) {
    throw new Error(`Pack Plan supports at most ${PACK_PLAN_LIMITS.productTruth} product-truth records.`);
  }
  const normalized = inputs.map((item) => {
    const kind = requiredEnum(item?.kind, PRODUCT_TRUTH_KINDS, 'product truth kind');
    return {
      id: requiredText(item?.id, 'product truth id', 200),
      kind,
      text: requiredText(item?.text, 'product truth text', 1_500),
      source: compactObject({
        label: boundedText(item?.source?.label || 'Reviewed app info', 160),
        url: safeHttpUrl(item?.source?.url),
        assetId: boundedText(item?.source?.assetId, 160) || null,
        storageKey: boundedText(item?.source?.storageKey, 500) || null,
      }),
      canSupportProductClaim: kind === 'app_summary' || kind === 'claim',
    };
  });
  assertUniqueIds(normalized, 'product truth');
  return normalized.sort(compareById);
}

function normalizeMarketSignals(signals) {
  const inputs = Array.isArray(signals) ? signals : [];
  if (inputs.length > PACK_PLAN_LIMITS.marketSignals) {
    throw new Error(`Pack Plan supports at most ${PACK_PLAN_LIMITS.marketSignals} market signals.`);
  }
  const normalized = inputs.map((signal) => ({
    id: requiredText(signal?.id, 'market signal id', 200),
    kind: requiredEnum(signal?.kind, MARKET_SIGNAL_KINDS, 'market signal kind'),
    theme: requiredText(signal?.theme, 'market signal theme', 240),
    paraphrase: requiredText(signal?.paraphrase, 'market signal paraphrase', 800),
    observedItemCount: boundedPositiveInteger(signal?.observedItemCount, 1, 10_000),
    source: {
      platform: requiredText(signal?.source?.platform, 'market signal source platform', 120),
      url: requiredHttpUrl(signal?.source?.url, 'market signal source URL'),
      observedAt: optionalIso(signal?.source?.observedAt),
      capturedAt: requiredIso(signal?.source?.capturedAt, 'Market signal source capturedAt'),
    },
    canSupportProductClaim: false,
  }));
  assertUniqueIds(normalized, 'market signal');
  return normalized.sort(compareById);
}

function normalizeLearningSignals(signals) {
  const inputs = Array.isArray(signals) ? signals : [];
  if (inputs.length > PACK_PLAN_LIMITS.learningSignals) {
    throw new Error(`Pack Plan supports at most ${PACK_PLAN_LIMITS.learningSignals} learning signals.`);
  }
  const normalized = inputs.map((signal) => {
    const id = signal?.eventId || signal?.id;
    return {
      id: requiredText(id, 'learning signal id', 200),
      type: requiredEnum(signal?.type, LEARNING_SIGNAL_TYPES, 'learning signal type'),
      polarity: requiredEnum(signal?.polarity, ['positive', 'negative', 'directive'], 'learning signal polarity'),
      angle: requiredText(signal?.angle, 'learning signal angle', 240),
      instruction: requiredText(signal?.instruction, 'learning signal instruction', 1_000),
      sourceDecisionId: boundedText(signal?.sourceDecisionId, 200) || null,
      createdAt: requiredIso(signal?.createdAt, 'Learning signal createdAt'),
    };
  });
  assertUniqueIds(normalized, 'learning signal');
  return normalized.sort(compareById);
}

function normalizeOutputMix(outputMix = {}) {
  const image = boundedNonNegativeInteger(outputMix.image ?? outputMix.imageCount, 0, PACK_PLAN_LIMITS.imageAds, 'image ad count');
  const ugc = boundedNonNegativeInteger(outputMix.ugc ?? outputMix.video ?? outputMix.videoCount, 0, PACK_PLAN_LIMITS.ugcAds, 'UGC ad count');
  if (image + ugc <= 0) throw new Error('Creative Pack Plan needs at least one output.');
  if (image + ugc > PACK_PLAN_LIMITS.totalOutputs) throw new Error('Creative Pack Plan output mix is too large.');
  return { image, ugc };
}

function normalizeSuppliedStrategy(strategy, snapshot) {
  const validIds = evidenceIdSet(snapshot);
  const sharedClaimIds = normalizeTruthRefs(
    strategy.claimIds,
    snapshot,
    (item) => item.canSupportProductClaim === true,
    'strategy claim',
  );
  const sharedProofIds = normalizeTruthRefs(
    strategy.proofIds,
    snapshot,
    (item) => item.kind === 'screen',
    'strategy proof',
  );
  const claims = sharedClaimIds.length ? sharedClaimIds : eligibleClaimIds(snapshot);
  const proofs = sharedProofIds.length ? sharedProofIds : screenTruthIds(snapshot);
  if (!claims.length || !proofs.length) throw new Error('Pack Plan strategy needs reviewed claim and screen evidence.');
  const hypothesis = {
    statement: requiredText(strategy.hypothesis?.statement, 'hypothesis statement', 700),
    audience: requiredText(strategy.hypothesis?.audience, 'hypothesis audience', 300),
    tension: requiredText(strategy.hypothesis?.tension, 'hypothesis tension', 500),
    valueConnection: requiredText(strategy.hypothesis?.valueConnection, 'hypothesis value connection', 500),
    intendedLearning: requiredText(strategy.hypothesis?.intendedLearning, 'hypothesis intended learning', 500),
    evidenceRefs: normalizeEvidenceRefs(strategy.hypothesis?.evidenceRefs, validIds, 'hypothesis'),
  };
  const primary = normalizeLane(strategy.primary, 'primary', validIds);
  const challenger = normalizeLane(strategy.challenger, 'challenger', validIds);
  const experiment = experimentRecord({ primary, challenger, claimIds: claims, proofIds: proofs });
  return {
    evidenceMode: snapshot.coverage.level === 'none' ? 'exploratory' : snapshot.coverage.level === 'thin' ? 'evidence_led_thin' : 'evidence_led',
    hypothesis,
    experiment,
  };
}

function buildExploratoryStrategy(snapshot) {
  const strategy = productSpecificTruthStrategy(snapshot);
  return {
    evidenceMode: 'exploratory',
    hypothesis: strategy.hypothesis,
    experiment: experimentRecord(strategy),
  };
}

function productSpecificTruthStrategy(snapshot) {
  const reviewedClaims = snapshot.productTruth.filter((item) => item.kind === 'claim' && item.canSupportProductClaim);
  const claimOptions = reviewedClaims.length
    ? [...reviewedClaims].sort((left, right) => (
        productClaimSpecificity(right.text) - productClaimSpecificity(left.text)
        || left.id.localeCompare(right.id)
      ))
    : snapshot.productTruth.filter((item) => item.canSupportProductClaim);
  const screens = snapshot.productTruth.filter((item) => item.kind === 'screen');
  const primaryClaim = claimOptions[0];
  const challengerClaim = claimOptions.find((item) => item.id !== primaryClaim?.id) || null;
  const primaryScreen = bestScreenForClaim(primaryClaim, screens);
  const challengerScreen = bestScreenForClaim(challengerClaim || primaryClaim, screens, new Set([primaryScreen?.id]));
  const screenName = planScreenName(primaryScreen?.text);
  const challengerScreenName = planScreenName(challengerScreen?.text);
  const primaryAngle = planAngleFromClaim(primaryClaim?.text);
  let challengerAngle = challengerClaim
    ? planAngleFromClaim(challengerClaim.text)
    : `Show ${planScreenWithArticle(screenName)}`;
  if (copyKey(primaryAngle) === copyKey(challengerAngle)) {
    challengerAngle = `See ${screenName} solve the job`;
  }
  const claimIds = eligibleClaimIds(snapshot);
  const proofIds = screenTruthIds(snapshot);
  const learningRefs = snapshot.learningSignals.slice(0, 2).map((signal) => signal.id);
  const primaryRefs = unique([primaryClaim?.id, primaryScreen?.id, ...learningRefs]);
  const challengerRefs = unique([challengerClaim?.id || primaryClaim?.id, challengerScreen?.id, ...learningRefs]);

  return {
    claimIds,
    proofIds,
    hypothesis: {
      statement: `“${primaryAngle}” should be the stronger opening.`,
      audience: 'People whose needs match the reviewed app information.',
      tension: `The approved ${screenName} gives this plan a concrete product moment.`,
      valueConnection: primaryClaim?.text || 'Every ad stays grounded in the selected app facts and screens.',
      intendedLearning: 'Which product message should lead the next pack.',
      evidenceRefs: unique([...primaryRefs, ...challengerRefs]),
    },
    primary: {
      id: 'primary',
      angle: primaryAngle,
      rationale: `Use the ${screenName} to make this benefit concrete.`,
      evidenceRefs: primaryRefs,
    },
    challenger: {
      id: 'challenger',
      angle: challengerAngle,
      rationale: challengerClaim
        ? `Use the ${challengerScreenName} to test a different reviewed benefit.`
        : `Use the ${screenName} itself as the alternate opening.`,
      evidenceRefs: challengerRefs,
    },
  };
}

function normalizeLane(lane, id, validIds) {
  return {
    id,
    angle: requiredText(lane?.angle, `${id} angle`, 300),
    rationale: requiredText(lane?.rationale, `${id} rationale`, 600),
    evidenceRefs: normalizeEvidenceRefs(lane?.evidenceRefs, validIds, `${id} lane`),
  };
}

function experimentRecord({ primary, challenger, claimIds, proofIds }) {
  if (copyKey(primary.angle) === copyKey(challenger.angle)) {
    throw new Error('Primary and challenger must test different angles.');
  }
  return {
    variable: 'angle',
    controlledVariables: ['audience', 'output mix', 'reviewed claims', 'reviewed proof pool'],
    claimIds: unique(claimIds),
    proofIds: unique(proofIds),
    primary,
    challenger,
  };
}

function buildOutputAssignments({ outputMix, researchSnapshot, experiment }) {
  const claimIds = experiment.claimIds;
  const proofIds = experiment.proofIds;
  const marketIds = new Set(researchSnapshot.marketSignals.map((signal) => signal.id));
  const assignments = [];
  let globalIndex = 0;
  for (const [format, count] of [['image_ad', outputMix.image], ['ugc_ad', outputMix.ugc]]) {
    for (let formatIndex = 0; formatIndex < count; formatIndex += 1) {
      const laneId = globalIndex % 2 === 0 ? 'primary' : 'challenger';
      const lane = experiment[laneId];
      const pairIndex = Math.floor(formatIndex / 2);
      const claimRef = claimIds[pairIndex % claimIds.length];
      const proofRef = proofIds[pairIndex % proofIds.length];
      assignments.push({
        assignmentId: `${format}-${String(formatIndex + 1).padStart(2, '0')}`,
        format,
        lane: laneId,
        angle: lane.angle,
        claimEvidenceRefs: [claimRef],
        proofEvidenceRefs: [proofRef],
        marketSignalRefs: lane.evidenceRefs.filter((ref) => marketIds.has(ref)),
      });
      globalIndex += 1;
    }
  }
  return assignments;
}

function validateExperiment(experiment, snapshot) {
  if (!experiment || experiment.variable !== 'angle') throw new Error('Pack Plan experiment must vary angle.');
  if (!experiment.primary || !experiment.challenger) throw new Error('Pack Plan needs one primary and one challenger.');
  if (copyKey(experiment.primary.angle) === copyKey(experiment.challenger.angle)) {
    throw new Error('Primary and challenger must use different angles.');
  }
  const validIds = evidenceIdSet(snapshot);
  normalizeEvidenceRefs(experiment.primary.evidenceRefs, validIds, 'primary lane');
  normalizeEvidenceRefs(experiment.challenger.evidenceRefs, validIds, 'challenger lane');
  normalizeTruthRefs(experiment.claimIds, snapshot, (item) => item.canSupportProductClaim === true, 'experiment claim');
  normalizeTruthRefs(experiment.proofIds, snapshot, (item) => item.kind === 'screen', 'experiment proof');
}

function validateAssignments(plan) {
  const assignments = Array.isArray(plan.assignments) ? plan.assignments : [];
  const expectedCount = plan.request.outputMix.image + plan.request.outputMix.ugc;
  if (assignments.length !== expectedCount) throw new Error('Pack Plan assignment count does not match its output mix.');
  const truthById = new Map(plan.researchSnapshot.productTruth.map((item) => [item.id, item]));
  const marketIds = new Set(plan.researchSnapshot.marketSignals.map((item) => item.id));
  const ids = new Set();
  const laneCounts = { primary: 0, challenger: 0 };
  const formatCounts = { image_ad: 0, ugc_ad: 0 };
  for (const assignment of assignments) {
    if (!assignment.assignmentId || ids.has(assignment.assignmentId)) throw new Error('Pack Plan assignment IDs must be unique.');
    ids.add(assignment.assignmentId);
    if (!['image_ad', 'ugc_ad'].includes(assignment.format)) throw new Error('Pack Plan assignment format is invalid.');
    if (!['primary', 'challenger'].includes(assignment.lane)) throw new Error('Pack Plan assignment lane is invalid.');
    if (assignment.angle !== plan.experiment[assignment.lane].angle) throw new Error('Pack Plan assignment angle does not match its lane.');
    if (!(assignment.claimEvidenceRefs || []).length || !(assignment.proofEvidenceRefs || []).length) {
      throw new Error('Every Pack Plan assignment needs claim and proof evidence.');
    }
    for (const ref of assignment.claimEvidenceRefs) {
      const truth = truthById.get(ref);
      if (!truth || truth.canSupportProductClaim !== true) {
        throw new Error('Market signals and screen-only proof cannot support product claims.');
      }
    }
    for (const ref of assignment.proofEvidenceRefs) {
      if (truthById.get(ref)?.kind !== 'screen') throw new Error('Pack Plan proof references must resolve to reviewed screens.');
    }
    for (const ref of assignment.marketSignalRefs || []) {
      if (!marketIds.has(ref)) throw new Error('Pack Plan market-signal reference is invalid.');
    }
    laneCounts[assignment.lane] += 1;
    formatCounts[assignment.format] += 1;
  }
  if (Math.abs(laneCounts.primary - laneCounts.challenger) > 1) throw new Error('Pack Plan primary/challenger assignments are not balanced.');
  if (formatCounts.image_ad !== plan.request.outputMix.image || formatCounts.ugc_ad !== plan.request.outputMix.ugc) {
    throw new Error('Pack Plan assignment formats do not match the requested mix.');
  }
}

function learningForDecision({ action, angle, note }) {
  if (action === 'approved') {
    return {
      type: 'liked_angle',
      polarity: 'positive',
      instruction: `Create more work that explores the “${angle}” angle.`,
    };
  }
  if (action === 'rejected') {
    return {
      type: 'rejected_angle',
      polarity: 'negative',
      instruction: `Reduce the “${angle}” angle unless new evidence supports another test.`,
    };
  }
  return {
    type: 'tweak_instruction',
    polarity: 'directive',
    instruction: note,
  };
}

function normalizeReviewAction(action) {
  const aliases = { approve: 'approved', approved: 'approved', reject: 'rejected', rejected: 'rejected', tweak: 'tweak' };
  const normalized = aliases[String(action || '').toLowerCase()];
  if (!REVIEW_ACTIONS.includes(normalized)) throw new Error('Review action must be approve, reject, or tweak.');
  return normalized;
}

function normalizeFormat(format) {
  const aliases = { image: 'image_ad', image_ad: 'image_ad', ugc: 'ugc_ad', video: 'ugc_ad', ugc_ad: 'ugc_ad' };
  const normalized = aliases[String(format || '').toLowerCase()];
  if (!normalized) throw new Error('Review decision format must be image or UGC.');
  return normalized;
}

function normalizeEvidenceRefs(refs, validIds, label) {
  const values = unique((Array.isArray(refs) ? refs : []).map((ref) => boundedText(ref, 200)).filter(Boolean));
  if (!values.length) throw new Error(`${label} needs at least one evidence reference.`);
  if (values.length > PACK_PLAN_LIMITS.evidenceRefsPerStrategyField) throw new Error(`${label} has too many evidence references.`);
  const invalid = values.filter((ref) => !validIds.has(ref));
  if (invalid.length) throw new Error(`${label} cites unknown evidence: ${invalid.join(', ')}.`);
  return values.sort();
}

function normalizeTruthRefs(refs, snapshot, predicate, label) {
  const values = unique((Array.isArray(refs) ? refs : []).map((ref) => boundedText(ref, 200)).filter(Boolean));
  const byId = new Map(snapshot.productTruth.map((item) => [item.id, item]));
  const invalid = values.filter((ref) => !byId.has(ref) || !predicate(byId.get(ref)));
  if (invalid.length) throw new Error(`${label} references are not eligible reviewed product truth: ${invalid.join(', ')}.`);
  return values.sort();
}

function eligibleClaimIds(snapshot) {
  return snapshot.productTruth.filter((item) => item.canSupportProductClaim).map((item) => item.id);
}

function screenTruthIds(snapshot) {
  return snapshot.productTruth.filter((item) => item.kind === 'screen').map((item) => item.id);
}

function evidenceIdSet(snapshot) {
  return new Set([
    ...snapshot.productTruth.map((item) => item.id),
    ...snapshot.marketSignals.map((item) => item.id),
    ...snapshot.learningSignals.map((item) => item.id),
  ]);
}

function assertProductTruthReady(truth) {
  if (!truth.some((item) => item.canSupportProductClaim)) {
    throw new Error('Pack Plan needs at least one reviewed app summary or claim.');
  }
  if (!truth.some((item) => item.kind === 'screen')) {
    throw new Error('Pack Plan needs at least one selected real app screen.');
  }
}

function uniqueSourceRows(markets) {
  const rows = new Map();
  for (const signal of markets) {
    const key = `${signal.source.platform.toLowerCase()}|${signal.source.url}`;
    if (!rows.has(key)) rows.set(key, { platform: signal.source.platform, url: signal.source.url });
  }
  return [...rows.values()].sort((left, right) => `${left.platform}|${left.url}`.localeCompare(`${right.platform}|${right.url}`));
}

function marketCoverageLevel(markets, sources) {
  if (!markets.length) return 'none';
  if (markets.length < 3 || sources.length < 2) return 'thin';
  return 'strong';
}

function expectedCreditCost(mix) {
  const normalized = normalizeOutputMix(mix);
  return (normalized.image * PACK_PLAN_CREDIT_RULES.image_ad) + (normalized.ugc * PACK_PLAN_CREDIT_RULES.ugc_ad);
}

function planWithoutIdentity(plan) {
  const copy = toPlain(plan);
  delete copy.planId;
  delete copy.planFingerprint;
  return copy;
}

function fingerprint(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function toPlain(value) {
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toPlain(child)]));
  return value;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null && child !== undefined && child !== ''));
}

function requiredText(value, label, maxLength) {
  const text = boundedText(value, maxLength);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function boundedText(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function requiredEnum(value, allowed, label) {
  const normalized = boundedText(value, 120).toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function requiredIso(value, label) {
  const text = boundedText(value, 80);
  const parsed = Date.parse(text);
  if (!text || !Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}

function optionalIso(value) {
  if (value === null || value === undefined || value === '') return null;
  return requiredIso(value, 'Timestamp');
}

function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function requiredHttpUrl(value, label) {
  const url = safeHttpUrl(value);
  if (!url) throw new Error(`${label} must be an http or https URL.`);
  return url;
}

function boundedNonNegativeInteger(value, fallback, max, label) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new Error(`${label} is invalid.`);
  return number;
}

function boundedPositiveInteger(value, fallback, max) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > max) throw new Error('Observed item count is invalid.');
  return number;
}

function assertUniqueIds(records, label) {
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`${label} IDs must be unique.`);
    ids.add(record.id);
  }
}

function compareById(left, right) {
  return left.id.localeCompare(right.id);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function copyKey(value) {
  return boundedText(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function strategySentenceFragment(value) {
  const text = String(value || '').trim().replace(/[.!?]+$/g, '');
  if (!text) return 'the people this app is built for';
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function planAngleFromClaim(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/g, '');
  text = text
    .replace(/^(?:users|people) can\s+/i, '')
    .replace(/^the app (?:helps|lets|allows) (?:users|people) (?:to )?/i, '');
  if (!text) return 'Show the reviewed product value';
  const words = text.split(/\s+/).slice(0, 12);
  while (words.length && /^(?:and|or|with|to|the|a|an)$/i.test(words.at(-1))) words.pop();
  const concise = words.join(' ');
  return `${concise.charAt(0).toUpperCase()}${concise.slice(1)}`;
}

function planScreenName(value) {
  const label = String(value || 'reviewed app screen').split(/\s+—\s+/)[0].trim();
  return label || 'reviewed app screen';
}

function planScreenWithArticle(value) {
  const label = String(value || 'reviewed app screen').trim();
  return /^(?:a|an|the)\s/i.test(label) ? label.toLowerCase() : `the ${label.toLowerCase()}`;
}

function productClaimSpecificity(value) {
  const text = String(value || '');
  const words = text.split(/\s+/).filter(Boolean).length;
  const concreteSeparators = (text.match(/[,;:]/g) || []).length;
  return Math.min(words, 16) + (concreteSeparators * 2);
}

function bestScreenForClaim(claim, screens, excludedIds = new Set()) {
  const available = screens.filter((screen) => !excludedIds.has(screen.id));
  const pool = available.length ? available : screens;
  const claimTerms = contentTerms(claim?.text);
  return [...pool].sort((left, right) => {
    const leftOverlap = [...contentTerms(left.text)].filter((term) => claimTerms.has(term)).length;
    const rightOverlap = [...contentTerms(right.text)].filter((term) => claimTerms.has(term)).length;
    return rightOverlap - leftOverlap || left.id.localeCompare(right.id);
  })[0];
}

function contentTerms(value) {
  const stop = new Set(['about', 'after', 'again', 'also', 'and', 'app', 'build', 'can', 'for', 'from', 'into', 'one', 'people', 'screen', 'showing', 'that', 'the', 'their', 'this', 'through', 'users', 'with']);
  return new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !stop.has(word))
  );
}
