/* Anonymous URL-first preview + claim mock for the local prototype.
   Mirrors the previewCache / previewSessions / claim shape from
   docs/plans/mobile-ad-agent-auth-infra-plan-2026-07-07.md without Firebase.
   Pre-auth previews are ephemeral: no generation, no uploads, no durable
   edits, no exports, no credit spend (providerMutations: 0). */

const PREVIEW_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_PREVIEWS_PER_WINDOW = 12;
const DEFAULT_EXTRACTION_COST_CENTS = 8;
const DEFAULT_DAILY_COST_CEILING_CENTS = 400;

export const CLAIM_PRODUCTS = {
  launch_pack: {
    id: 'launch_pack',
    label: 'Same-Day Launch Pack',
    price: '$249 one-time',
    credits: 336,
    packMix: { image: 24, video: 4 },
    grantLabel: '$249 Same-Day Launch Pack credits',
  },
  launch: {
    id: 'launch',
    label: 'Launch plan',
    price: '$99/mo',
    credits: 600,
    grantLabel: 'Launch plan monthly credits',
  },
  scale: {
    id: 'scale',
    label: 'Scale plan',
    price: '$249/mo',
    credits: 2000,
    grantLabel: 'Scale plan monthly credits',
  },
  studio: {
    id: 'studio',
    label: 'Studio plan',
    price: '$599/mo',
    credits: 6000,
    grantLabel: 'Studio plan monthly credits',
  },
};

export function isAllowedPreviewUrl(rawUrl) {
  const url = tryParseUrl(rawUrl);
  if (!url) return false;
  return isAppleHost(url.hostname) || isPlayHost(url.hostname);
}

export function canonicalPreviewAppId(rawUrl) {
  const url = tryParseUrl(rawUrl);
  if (!url) return null;
  if (isAppleHost(url.hostname)) {
    const pathMatch = url.pathname.match(/\/id(\d+)/);
    const id = pathMatch?.[1] || url.searchParams.get('id');
    return id ? `app-store-${id}` : null;
  }
  if (isPlayHost(url.hostname)) {
    const id = url.searchParams.get('id');
    return id ? `play-store-${id.toLowerCase()}` : null;
  }
  return null;
}

export function createPreviewStore({
  now = () => Date.now(),
  cacheTtlMs = PREVIEW_CACHE_TTL_MS,
  sessionTtlMs = PREVIEW_SESSION_TTL_MS,
  rateLimitWindowMs = RATE_LIMIT_WINDOW_MS,
  maxPreviewsPerWindow = MAX_PREVIEWS_PER_WINDOW,
  extractionCostCents = DEFAULT_EXTRACTION_COST_CENTS,
  dailyCostCeilingCents = DEFAULT_DAILY_COST_CEILING_CENTS,
  previewKillSwitch = false,
} = {}) {
  const previewCache = new Map();
  const previewSessions = new Map();
  const requestBuckets = new Map();
  const costDays = new Map();
  const extractionCounts = new Map();
  let sessionSeq = 0;

  function checkPreviewAllowed({ canonicalAppId, ip = 'local' }) {
    if (previewKillSwitch) {
      throw new Error('Preview is temporarily unavailable. Try again shortly.');
    }
    if (!canonicalAppId) {
      throw new Error('Use a valid App Store or Google Play link.');
    }

    const bucket = currentRequestBucket(ip);
    bucket.count += 1;
    if (bucket.count > maxPreviewsPerWindow) {
      throw new Error('Too many previews from this connection. Wait a minute, then try again.');
    }

    const cachedExtraction = getCachedExtraction(canonicalAppId);
    if (!cachedExtraction) {
      const day = currentCostDay();
      if (day.costCents + extractionCostCents > dailyCostCeilingCents) {
        throw new Error('Preview limit reached for today. Try again tomorrow.');
      }
    }

    return { cache: cachedExtraction ? 'hit' : 'miss', cachedExtraction };
  }

  function getCachedExtraction(canonicalAppId) {
    if (!canonicalAppId) return null;
    const entry = previewCache.get(canonicalAppId);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      previewCache.delete(canonicalAppId);
      return null;
    }
    return entry.extraction;
  }

  function cacheExtraction(canonicalAppId, extraction) {
    if (!canonicalAppId || !extraction) return;
    const existing = previewCache.get(canonicalAppId);
    const priorCount = extractionCounts.get(canonicalAppId) || 0;
    const extractionCount = priorCount + 1;
    extractionCounts.set(canonicalAppId, extractionCount);
    currentCostDay().costCents += extractionCostCents;
    previewCache.set(canonicalAppId, {
      extraction,
      packPlan: existing?.packPlan || null,
      expiresAt: now() + cacheTtlMs,
      extractionCount,
    });
  }

  function getCachedPackPlan(canonicalAppId) {
    if (!getCachedExtraction(canonicalAppId)) return null;
    return previewCache.get(canonicalAppId)?.packPlan || null;
  }

  function cachePackPlan(canonicalAppId, packPlan) {
    const entry = previewCache.get(canonicalAppId);
    if (!entry || !packPlan) return;
    entry.packPlan = packPlan;
  }

  function createSession({ canonicalAppId, url }) {
    sessionSeq += 1;
    const createdAt = now();
    const session = {
      id: `prev-${createdAt.toString(36)}-${sessionSeq.toString(36)}-${randomSuffix()}`,
      canonicalAppId,
      url,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + sessionTtlMs).toISOString(),
      expiresAtMs: createdAt + sessionTtlMs,
      claim: null,
    };
    previewSessions.set(session.id, session);
    return session;
  }

  function getSession(sessionId) {
    const session = previewSessions.get(String(sessionId || ''));
    if (!session) return null;
    if (session.expiresAtMs <= now() && !session.claim) {
      previewSessions.delete(session.id);
      return null;
    }
    return session;
  }

  function claimSession({ sessionId, email, productId, appName }) {
    const session = getSession(sessionId);
    if (!session) {
      throw new Error('Preview session expired. Paste the app URL again to refresh the preview.');
    }
    if (session.claim) {
      return { session, claim: session.claim, idempotent: true };
    }
    const product = CLAIM_PRODUCTS[productId];
    if (!product) {
      throw new Error('Choose the Launch Pack or a plan to continue.');
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Enter a valid email to create your account.');
    }
    const orgId = `org-${stableHash(`${session.id}:${cleanEmail}`).slice(0, 8)}`;
    const claim = {
      orgId,
      workspaceId: 'ws-default',
      appId: `${slugify(appName || 'app')}`,
      email: cleanEmail,
      previewSessionId: session.id,
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
      claimedAt: new Date(now()).toISOString(),
      providerMutations: 0,
    };
    session.claim = claim;
    return { session, claim, idempotent: false };
  }

  function getCacheStats(canonicalAppId = null) {
    const day = currentCostDay();
    return {
      cachedAppCount: previewCache.size,
      dailyCostCents: day.costCents,
      extractionCostCents,
      dailyCostCeilingCents,
      totalExtractionCount: [...extractionCounts.values()].reduce((total, count) => total + count, 0),
      extractionCount: canonicalAppId ? extractionCounts.get(canonicalAppId) || 0 : null,
      providerMutations: 0,
    };
  }

  function canClientAccessServerCollection(collectionName) {
    return !['previewCache', 'previewSessions'].includes(String(collectionName || ''));
  }

  function currentRequestBucket(ip) {
    const key = String(ip || 'local');
    const current = now();
    const existing = requestBuckets.get(key);
    if (!existing || current - existing.windowStartMs >= rateLimitWindowMs) {
      const bucket = { windowStartMs: current, count: 0 };
      requestBuckets.set(key, bucket);
      return bucket;
    }
    return existing;
  }

  function currentCostDay() {
    const dayKey = new Date(now()).toISOString().slice(0, 10);
    const existing = costDays.get(dayKey);
    if (existing) return existing;
    const day = { dayKey, costCents: 0 };
    costDays.set(dayKey, day);
    return day;
  }

  return {
    checkPreviewAllowed,
    getCachedExtraction,
    cacheExtraction,
    getCachedPackPlan,
    cachePackPlan,
    createSession,
    getSession,
    claimSession,
    getCacheStats,
    canClientAccessServerCollection,
  };
}

export function buildPreviewPayload(extraction, session) {
  const sourceScreens = extraction.uiObjects || [];
  const screenshots = sourceScreens
    .filter(isUsablePreviewScreen)
    .map((object, index) => ({
      id: object.id || `preview-screen-${index + 1}`,
      label: /^store screenshot \d+$/i.test(object.title || '') ? `Screenshot ${index + 1}` : object.title || `Screenshot ${index + 1}`,
      url: object.sourceUrl,
    }));

  return {
    schemaVersion: 'local-app-preview.v1',
    previewSession: {
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    },
    app: {
      name: extraction.app?.name || 'Imported app',
      iconUrl: extraction.app?.iconUrl || null,
      category: extraction.app?.category || null,
      store: extraction.platform === 'app_store' ? 'App Store' : extraction.platform === 'play_store' ? 'Google Play' : 'Store listing',
      summary: extraction.app?.summary || '',
      storeUrl: extraction.app?.storeUrl || extraction.url || null,
    },
    features: (extraction.claimCandidates || []).map((claim, index) => ({
      id: claim.id || `feature-${index + 1}`,
      text: claim.text,
      source: claim.source || 'Store listing',
      confidence: claim.confidence || 'medium',
    })),
    screenshots,
    screenCoverage: {
      usableCount: screenshots.length,
      hiddenCount: Math.max(0, sourceScreens.length - screenshots.length),
    },
    access: {
      tier: 'anonymous_preview',
      canGenerate: false,
      canEditAppInfo: false,
      canUploadScreenshots: false,
      canExport: false,
      claimRequired: true,
      generationRequires: 'launch_pack_or_plan',
    },
    providerMutations: 0,
  };
}

function isUsablePreviewScreen(object = {}) {
  const status = ['recommended', 'review', 'blocked'].includes(object.usability?.status)
    ? object.usability.status
    : 'review';
  if (!object.sourceUrl || status === 'blocked') return false;
  return status === 'recommended' || object.rawifyEligible === true;
}

function isAppleHost(hostname) {
  return /(^|\.)apps\.apple\.com$/i.test(hostname) || /(^|\.)itunes\.apple\.com$/i.test(hostname);
}

function isPlayHost(hostname) {
  return /(^|\.)play\.google\.com$/i.test(hostname);
}

function tryParseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'app';
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
