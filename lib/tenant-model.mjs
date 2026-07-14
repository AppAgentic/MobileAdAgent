/* Shared tenant document model for the Mobile Ad Agent tenant boundary.
   Pure builders only: no I/O, no Firebase imports. Both the in-memory local
   adapter (lib/local-tenant-store.mjs) and the production Firestore adapter
   (lib/firestore-tenant-store.mjs) build the exact same document shapes from
   here, so switching backends is an env change, not a structural rewrite.

   Invariants:
   - Every tenant-owned doc carries orgId/workspaceId (and appId on leaves).
   - Assets store tenant-scoped storage keys + source metadata, never signed
     URLs or secrets.
   - Customer-visible payloads carry providerMutations: 0 and no backend
   provider/model names. */

import { customerSafeCreativePackPlan } from './pack-plan-model.mjs';

export const DEFAULT_WORKSPACE_ID = 'ws-default';
export const PROFILE_ID = 'profile-current';
export const CREDIT_RULES = Object.freeze({
  image: 4,
  video: 60,
});
export const PACK_LIMITS = Object.freeze({
  maxImageAds: 40,
  // UGC planning intentionally stays in small, high-quality jobs. One pack
  // shares one eight-candidate Hook Agent pool across at most six drafts;
  // larger workloads scale horizontally as multiple idempotent packs.
  maxVideoAds: 6,
});

export const SERVER_ONLY_COLLECTIONS = Object.freeze([
  'previewCache',
  'previewSessions',
  'renderTasks',
  'apiKeys',
  'auditEvents',
  'claims',
]);

export function isServerOnlyCollection(collectionName) {
  return SERVER_ONLY_COLLECTIONS.includes(String(collectionName || ''));
}

export function buildBootstrapDocs({ uid, email, createdAt }) {
  const orgId = `org-${stableHash(uid).slice(0, 8)}`;
  const workspaceId = DEFAULT_WORKSPACE_ID;
  const user = {
    uid,
    email,
    orgId,
    workspaceId,
    createdAt,
    updatedAt: createdAt,
    providerMutations: 0,
  };
  const org = {
    orgId,
    name: orgNameFromEmail(email),
    ownerUid: uid,
    createdAt,
    updatedAt: createdAt,
    billing: { status: 'local_mock', creditOwner: orgId },
    providerMutations: 0,
  };
  const member = {
    uid,
    orgId,
    email,
    role: 'owner',
    workspaceIds: [workspaceId],
    createdAt,
    providerMutations: 0,
  };
  const workspace = {
    orgId,
    workspaceId,
    name: 'Default workspace',
    default: true,
    createdAt,
    updatedAt: createdAt,
    providerMutations: 0,
  };
  return { orgId, workspaceId, user, org, member, workspace };
}

export function claimIdempotencyKey({ uid, previewSessionId, canonicalAppId }) {
  return `${uid}:${previewSessionId}:${canonicalAppId}`;
}

export function buildClaimedAppDocs({ orgId, workspaceId, appId, createdBy, extraction, createdAt }) {
  const safeExtraction = safeExtractionPayload(extraction);
  const sourceAssets = buildSourceAssets({
    orgId,
    workspaceId,
    appId,
    extraction: safeExtraction,
    createdBy,
    createdAt,
  });
  const appProfile = {
    profileId: PROFILE_ID,
    orgId,
    workspaceId,
    appId,
    summary: safeExtraction.app.summary || '',
    features: safeExtraction.claimCandidates.map((claim, index) => ({
      id: claim.id || `${appId}-feature-${index + 1}`,
      text: claim.text,
      source: claim.source || 'Store listing',
      selected: claim.selected ?? index < 3,
      confidence: claim.confidence || 'medium',
    })),
    readiness: safeExtraction.reviewSummary,
    updatedBy: createdBy,
    createdAt,
    updatedAt: createdAt,
    providerMutations: 0,
  };
  const app = {
    id: appId,
    appId,
    orgId,
    workspaceId,
    appProfileId: PROFILE_ID,
    name: safeExtraction.app.name,
    source: sourceLabel(safeExtraction),
    status: 'Plan ready',
    tagline: safeExtraction.app.summary || `Imported from ${hostLabel(safeExtraction.url)}.`,
    iconUrl: safeExtraction.app.iconUrl || null,
    iconStorageKey: sourceAssets.find((asset) => asset.sourceType === 'store_icon')?.storageKey || null,
    iconTone: safeExtraction.platform === 'play_store' ? 'blue' : 'lime',
    entrySource: 'URL preview',
    extraction: safeExtraction,
    holds: safeExtraction.reviewSummary.holds || [],
    extractionStatus: 'review',
    screens: safeExtraction.uiObjects.map((object, index) => {
      const asset = sourceAssets.find((candidate) => candidate.sourceObjectId === object.id);
      return screenFromUiObject(appId, object, index, asset);
    }),
    claims: appProfile.features.map((feature, index) => ({
      id: `${appId}-claim-${index + 1}`,
      text: feature.text,
      source: feature.source,
      supported: true,
      selected: feature.selected,
      confidence: feature.confidence,
    })),
    style: safeExtraction.styleNotes.length
      ? safeExtraction.styleNotes
      : ['Plain language', 'Show real app screens', 'No unsupported performance claims'],
    reviewSignals: reviewSignalsFromExtraction(safeExtraction),
    angles: anglesFromExtraction(safeExtraction),
    sourceAssets,
    runs: [],
    ads: [],
    reviewDecisions: [],
    learningEvents: [],
    packPlanStatus: 'idle',
    activePackPlanId: null,
    activePackPlan: null,
    latestResearchSnapshotId: null,
    planRevision: 0,
    createdAt,
    updatedAt: createdAt,
    providerMutations: 0,
  };
  return { app, appProfile, sourceAssets };
}

export function buildClaimRecord({
  uid,
  email,
  orgId,
  workspaceId,
  appId,
  previewSessionId,
  canonicalAppId,
  product,
  createdAt,
}) {
  return {
    uid,
    email,
    orgId,
    workspaceId,
    appId,
    previewSessionId,
    canonicalAppId,
    product: {
      id: product.id,
      label: product.label,
      price: product.price,
      type: product.id === 'launch_pack' ? 'launch_pack' : 'plan',
    },
    entitlement: {
      credits: product.credits,
      grantLabel: product.grantLabel,
      packMix: product.packMix || null,
    },
    claimedAt: createdAt,
    providerMutations: 0,
  };
}

export function normalizePackRequest({ imageCount = 0, videoCount = 0 } = {}) {
  const image = Math.trunc(Number(imageCount));
  const video = Math.trunc(Number(videoCount));
  if (!Number.isFinite(image) || !Number.isFinite(video) || image < 0 || video < 0) {
    throw new Error('Choose a valid number of image and UGC ads.');
  }
  if (image + video <= 0) {
    throw new Error('Choose at least one ad to generate.');
  }
  if (image > PACK_LIMITS.maxImageAds || video > PACK_LIMITS.maxVideoAds) {
    throw new Error(`This pack is too large. Use at most ${PACK_LIMITS.maxImageAds} image ads and ${PACK_LIMITS.maxVideoAds} UGC ads per pack.`);
  }
  return { imageCount: image, videoCount: video };
}

export function creditCostForPack({ imageCount = 0, videoCount = 0 } = {}) {
  return (imageCount * CREDIT_RULES.image) + (videoCount * CREDIT_RULES.video);
}

export function packIdempotencyKey({
  uid,
  orgId,
  workspaceId,
  appId,
  imageCount,
  videoCount,
  idempotencyKey,
}) {
  const clientKey = String(idempotencyKey || '').trim();
  if (clientKey) {
    return `${uid}:${orgId}:${workspaceId}:${appId}:${clientKey}`;
  }
  return `${uid}:${orgId}:${workspaceId}:${appId}:${imageCount}:${videoCount}`;
}

export function creativePackIdFromKey(idempotencyKey) {
  return `pack-${stableHash(idempotencyKey).slice(0, 12)}`;
}

export function appReadiness(app) {
  const screens = (app?.screens || []).filter((screen) => (
    screen
    && screen.selected !== false
    && !screen.ignored
    && screen.usability !== 'blocked'
    && (screen.storageKey || screen.sourceUrl || screen.assetId)
  ));
  const claims = (app?.claims || []).filter((claim) => (
    claim
    && claim.selected !== false
    && !claim.ignored
    && claim.supported !== false
    && String(claim.text || '').trim()
  ));
  const holds = (app?.holds || []).filter(isBlockingHold);
  const messages = [];
  if (!screens.length) messages.push('Choose at least one usable app screenshot.');
  if (!claims.length) messages.push('Choose at least one true app feature.');
  if (holds.length) messages.push('Resolve the app info hold before generating.');
  return {
    ready: screens.length > 0 && claims.length > 0 && holds.length === 0,
    selectedScreenCount: screens.length,
    selectedClaimCount: claims.length,
    holdCount: holds.length,
    messages,
    providerMutations: 0,
  };
}

function isBlockingHold(hold) {
  if (!hold) return false;
  if (typeof hold === 'string') return true;
  return !['review', 'info'].includes(String(hold.severity || '').toLowerCase());
}

export function applyReviewedPlanPatch(app, patch = {}) {
  const next = toPlain(app);
  const updatedAt = patch.updatedAt || new Date().toISOString();
  if (typeof patch.tagline === 'string' && patch.tagline.trim()) {
    next.tagline = patch.tagline.trim().slice(0, 1200);
  }
  if (Array.isArray(patch.screens)) {
    const screenUpdates = new Map(patch.screens.map((screen) => [String(screen.id || ''), screen]));
    next.screens = (next.screens || []).map((screen) => {
      const update = screenUpdates.get(String(screen.id || ''));
      if (!update) return screen;
      return {
        ...screen,
        selected: update.selected === true,
        ignored: update.ignored === true,
      };
    });
  }
  if (Array.isArray(patch.claims)) {
    const existing = new Map((next.claims || []).map((claim) => [String(claim.id || ''), claim]));
    const patchedClaims = [];
    for (const claim of patch.claims) {
      const id = String(claim.id || '').trim();
      const text = String(claim.text || '').trim().slice(0, 280);
      if (!id || !text) continue;
      const prior = existing.get(id);
      if (prior) {
        patchedClaims.push({
          ...prior,
          text,
          selected: claim.selected === true,
          ignored: claim.ignored === true,
          supported: claim.supported !== false,
        });
      } else if (id.startsWith(`${next.appId || next.id}-`)) {
        patchedClaims.push({
          id,
          text,
          source: 'Edited by user',
          selected: claim.selected !== false,
          ignored: claim.ignored === true,
          supported: true,
          confidence: 'user',
          providerMutations: 0,
        });
      }
    }
    if (patchedClaims.length) next.claims = patchedClaims;
  }
  next.extractionStatus = 'approved';
  next.status = 'Profile ready';
  // Any product-truth edit invalidates the visible strategy until a new plan
  // snapshots and fingerprints the reviewed summary, claims, and screens.
  next.packPlanStatus = 'idle';
  next.activePackPlanId = null;
  next.activePackPlan = null;
  next.updatedAt = updatedAt;
  next.providerMutations = 0;
  return next;
}

export function creditBalanceFromLedger(ledgerDocs = []) {
  return ledgerDocs.reduce((total, doc) => total + Number(doc?.credits || 0), 0);
}

export function buildCreativePackRecord({
  packId,
  uid,
  orgId,
  workspaceId,
  appId,
  imageCount,
  videoCount,
  costCredits,
  idempotencyKey,
  readiness,
  packPlan,
  createdAt,
}) {
  if (!packPlan?.planId || !packPlan?.planFingerprint) {
    throw new Error('Approve a valid Pack Plan before creating a paid creative pack.');
  }
  return {
    packId,
    orgId,
    workspaceId,
    appId,
    createdBy: uid,
    status: 'preauthorized_mock',
    outputMix: { image: imageCount, video: videoCount },
    costCredits,
    sourceReadiness: readiness,
    packPlanId: packPlan.planId,
    packPlanFingerprint: packPlan.planFingerprint,
    packPlanSnapshot: customerSafeCreativePackPlan(packPlan),
    idempotencyKey,
    createdAt,
    updatedAt: createdAt,
    providerMutations: 0,
  };
}

export function buildCreditDebitRecord({
  txnId,
  uid,
  orgId,
  workspaceId,
  appId,
  packId,
  costCredits,
  idempotencyKey,
  createdAt,
}) {
  return {
    txnId,
    orgId,
    workspaceId,
    appId,
    uid,
    type: 'debit',
    credits: -Math.abs(costCredits),
    source: 'creative_pack',
    packId,
    idempotencyKey,
    createdAt,
    providerMutations: 0,
  };
}

export function customerSafeApp(app) {
  return {
    id: app.id,
    appId: app.appId,
    orgId: app.orgId,
    workspaceId: app.workspaceId,
    appProfileId: app.appProfileId,
    name: app.name,
    source: app.source,
    status: app.status,
    tagline: app.tagline,
    iconUrl: app.iconUrl,
    iconStorageKey: app.iconStorageKey,
    iconTone: app.iconTone,
    entrySource: app.entrySource,
    extraction: app.extraction,
    holds: app.holds,
    extractionStatus: app.extractionStatus,
    screens: app.screens,
    claims: app.claims,
    style: app.style,
    reviewSignals: app.reviewSignals,
    angles: app.angles,
    sourceAssets: (app.sourceAssets || []).map(toPlain),
    runs: app.runs || [],
    ads: app.ads || [],
    reviewDecisions: app.reviewDecisions || [],
    learningEvents: app.learningEvents || [],
    packPlanStatus: app.packPlanStatus || 'idle',
    activePackPlanId: app.activePackPlanId || null,
    activePackPlan: app.activePackPlan || null,
    latestResearchSnapshotId: app.latestResearchSnapshotId || null,
    planRevision: Number(app.planRevision) || 0,
    providerMutations: 0,
  };
}

export function safeExtractionPayload(extraction) {
  const uiObjects = (extraction.uiObjects || []).map((object, index) => ({
    id: object.id || `ui-store-screen-${index + 1}`,
    title: object.title || `Screenshot ${index + 1}`,
    description: object.description || '',
    screenType: object.screenType || null,
    sourceType: object.sourceType || 'store_art',
    sourceUrl: object.sourceUrl || null,
    extractionStage: object.extractionStage || (object.sourceType === 'store_art' ? 'pre_rawification' : 'ui_extracted'),
    requiresRawificationBeforeUiExtraction: Boolean(object.requiresRawificationBeforeUiExtraction),
    rawifyEligible: Boolean(object.rawifyEligible),
    trustLevel: object.trustLevel || 'medium',
    usability: object.usability || { status: 'review', label: 'Check it', reason: 'Review this screenshot before generation.' },
  }));
  const claimCandidates = (extraction.claimCandidates || []).map((claim, index) => ({
    id: claim.id || `claim-${index + 1}`,
    text: claim.text,
    source: claim.source || 'Store listing',
    status: claim.status || 'suggested',
    selected: claim.selected ?? index < 3,
    confidence: claim.confidence || 'medium',
  }));
  return {
    schemaVersion: 'local-app-extraction.v1',
    jobId: extraction.jobId || `extract-${stableHash(extraction.url || extraction.app?.name || 'app').slice(0, 10)}`,
    source: extraction.source || 'preview_claim',
    url: extraction.url || extraction.app?.storeUrl || null,
    createdAt: extraction.createdAt || new Date().toISOString(),
    providerMutations: 0,
    platform: extraction.platform || 'app_store',
    app: {
      name: extraction.app?.name || 'Imported app',
      category: extraction.app?.category || null,
      subtitle: extraction.app?.subtitle || null,
      iconUrl: extraction.app?.iconUrl || null,
      storeUrl: extraction.app?.storeUrl || extraction.url || null,
      summary: extraction.app?.summary || '',
      description: extraction.app?.description || '',
    },
    uiObjects,
    claimCandidates,
    reviewSummary: {
      screenCount: extraction.reviewSummary?.screenCount ?? uiObjects.length,
      claimCount: extraction.reviewSummary?.claimCount ?? claimCandidates.length,
      rawifyCandidateCount: extraction.reviewSummary?.rawifyCandidateCount ?? uiObjects.filter((object) => object.rawifyEligible).length,
      holds: extraction.reviewSummary?.holds || [],
    },
    styleNotes: extraction.styleNotes || [],
  };
}

export function buildSourceAssets({ orgId, workspaceId, appId, extraction, createdBy, createdAt }) {
  const assets = [];
  if (extraction.app.iconUrl) {
    assets.push(assetDoc({
      orgId,
      workspaceId,
      appId,
      assetId: `${appId}-icon`,
      sourceObjectId: 'app-icon',
      sourceType: 'store_icon',
      originalUrl: extraction.app.iconUrl,
      createdBy,
      createdAt,
    }));
  }
  extraction.uiObjects.forEach((object, index) => {
    assets.push(assetDoc({
      orgId,
      workspaceId,
      appId,
      assetId: `${appId}-screen-${index + 1}`,
      sourceObjectId: object.id,
      sourceType: object.sourceType || 'store_art',
      originalUrl: object.sourceUrl || null,
      createdBy,
      createdAt,
    }));
  });
  return assets;
}

function assetDoc({ orgId, workspaceId, appId, assetId, sourceObjectId, sourceType, originalUrl, createdBy, createdAt }) {
  return {
    assetId,
    orgId,
    workspaceId,
    appId,
    sourceObjectId,
    sourceType,
    originalUrl,
    storageKey: `orgs/${orgId}/workspaces/${workspaceId}/apps/${appId}/source/${assetId}`,
    createdBy,
    createdAt,
    qaStatus: 'pending_review',
    providerMutations: 0,
  };
}

function screenFromUiObject(appId, object, index, asset) {
  const judgement = object.usability || { status: 'review', label: 'Check it', reason: 'Review this screenshot before generation.' };
  return {
    id: `${appId}-screen-${index + 1}`,
    assetId: asset?.assetId || null,
    storageKey: asset?.storageKey || null,
    label: /^store screenshot \d+$/i.test(object.title || '') ? `Screenshot ${index + 1}` : object.title || `Screen ${index + 1}`,
    detail: [object.description, object.screenType ? `Type: ${String(object.screenType).replace(/_/g, ' ')}` : ''].filter(Boolean).join(' '),
    sourceType: object.sourceType,
    extractionStage: object.extractionStage || (object.sourceType === 'store_art' ? 'pre_rawification' : 'ui_extracted'),
    requiresRawificationBeforeUiExtraction: Boolean(object.requiresRawificationBeforeUiExtraction),
    rawifyEligible: Boolean(object.rawifyEligible),
    trustLevel: object.trustLevel,
    sourceUrl: object.sourceUrl,
    usability: judgement.status,
    usabilityLabel: judgement.label,
    usabilityReason: judgement.reason,
    selected: judgement.status === 'recommended',
    ignored: judgement.status === 'blocked',
    providerMutations: 0,
  };
}

function reviewSignalsFromExtraction(extraction) {
  const signals = [];
  if (extraction.reviewSummary.screenCount) {
    signals.push(`${extraction.reviewSummary.screenCount} screen candidates found for review.`);
  } else {
    signals.push('No app screens were found. Add screenshots or recordings before creating app-screen ads.');
  }
  if (extraction.reviewSummary.claimCount) {
    signals.push(`${extraction.reviewSummary.claimCount} key features extracted from ${sourceLabel(extraction)}.`);
  } else {
    signals.push('No clear features were found. Add one true product feature before generating ads.');
  }
  return signals;
}

function anglesFromExtraction(extraction) {
  const claims = extraction.claimCandidates.slice(0, 2);
  const angles = claims.map((claim, index) => ({
    id: `angle-${index + 1}`,
    label: shortAngleLabel(claim.text, index),
    evidence: claim.source || 'Found app info',
    selected: index < 2,
  }));
  angles.push({
    id: 'clarity',
    label: 'Show the core value',
    evidence: extraction.reviewSummary.screenCount ? 'Based on reviewed app info' : 'Needs app info before generation',
    selected: !angles.length,
  });
  return angles;
}

function shortAngleLabel(text, index) {
  const cleaned = String(text || '')
    .replace(/^(this app|the app|users can|you can)\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
  return sentenceLikeTitle(words || (index === 0 ? 'Core value' : 'User benefit'));
}

function sourceLabel(extraction) {
  const platform = extraction.platform === 'app_store'
    ? 'App Store'
    : extraction.platform === 'play_store'
      ? 'Play Store'
      : 'Website';
  return `${platform} · ${extraction.app.category || 'imported'}`;
}

function hostLabel(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'the app listing';
  }
}

export function workspaceSummary(workspace) {
  return {
    orgId: workspace.orgId,
    workspaceId: workspace.workspaceId,
    name: workspace.name,
    default: workspace.default,
    providerMutations: 0,
  };
}

export function normalizeEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Enter a valid email to create your account.');
  }
  return cleanEmail;
}

export function uidForEmail(email) {
  return `user-${stableHash(email).slice(0, 10)}`;
}

function orgNameFromEmail(email) {
  const domain = email.split('@')[1] || 'workspace';
  return `${domain.split('.')[0]} workspace`;
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'app';
}

function sentenceLikeTitle(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1).toLowerCase()}`;
}

export function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isoNow(now) {
  return new Date(now()).toISOString();
}

export function toPlain(value) {
  if (value instanceof Map) {
    return [...value.values()].map(toPlain);
  }
  if (Array.isArray(value)) {
    return value.map(toPlain);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toPlain(child)]));
  }
  return value;
}
