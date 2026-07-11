/* Deterministic, read-only Google Play customer-review ingestion.
 *
 * Google Play's public store loads written reviews through a batched data
 * request. This adapter keeps that transport isolated behind the same bounded,
 * source-backed evidence contract as the App Store adapter.
 */

const REVIEW_TIMEOUT_MS = 9_000;
const MAX_REVIEW_SIGNALS = 8;
const MIN_REVIEW_LENGTH = 40;
const REVIEW_BATCH_SIZE = 20;
const REVIEW_RPC_ID = 'UsvDTd';
const REVIEW_ENDPOINT_RPC_ID = 'qnKhOb';
const SORT_HELPFUL = 1;
const SORT_NEWEST = 2;

export async function fetchGooglePlayReviews({
  app,
  locale = 'en-US',
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = REVIEW_TIMEOUT_MS,
  maxReviews = MAX_REVIEW_SIGNALS,
} = {}) {
  const capturedAt = new Date(now()).toISOString();
  const identity = googlePlayIdentity(app, locale);
  if (!identity) {
    return limitedGooglePlayReviews({
      capturedAt,
      reason: 'Written review import is available for Google Play listings.',
      status: 'not_applicable',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const sorts = [SORT_HELPFUL, SORT_NEWEST];
  try {
    const results = await Promise.allSettled(sorts.map(async (sort, feedIndex) => {
      const response = await fetchImpl(googlePlayReviewEndpoint(identity), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          accept: '*/*',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: googlePlayReviewBody({ appId: identity.appId, sort }),
      });
      if (!response.ok) throw new Error(`Google Play reviews returned HTTP ${response.status}.`);
      const payload = await response.text();
      return normalizeGoogleReviewRows(parseGoogleReviewRows(payload), { feedIndex, identity });
    }));
    const reviews = selectReviews(
      results.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
      maxReviews,
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (!reviews.length) {
      const timedOut = failures.some((result) => result.reason?.name === 'AbortError');
      return limitedGooglePlayReviews({
        capturedAt,
        identity,
        reason: timedOut
          ? 'Google Play written reviews timed out.'
          : 'No usable Google Play written reviews were returned.',
      });
    }

    return {
      schemaVersion: 'google-play-reviews.v1',
      platform: 'play_store',
      status: failures.length ? 'partial' : 'complete',
      locale: identity.locale,
      country: identity.country,
      appId: identity.appId,
      storeUrl: identity.storeUrl,
      reviewPageUrl: identity.reviewPageUrl,
      reviews,
      limitations: failures.length
        ? ['One Google Play review feed was unavailable; the reviews shown were still fetched directly from Google Play.']
        : [],
      capturedAt,
      providerMutations: 0,
    };
  } catch (error) {
    return limitedGooglePlayReviews({
      capturedAt,
      identity,
      reason: error?.name === 'AbortError'
        ? 'Google Play written reviews timed out.'
        : safeMessage(error?.message || 'Google Play written reviews were unavailable.'),
    });
  } finally {
    clearTimeout(timer);
  }
}

export function googlePlayReviewSignalsForPackPlan(reviewResearch) {
  return (reviewResearch?.reviews || []).slice(0, MAX_REVIEW_SIGNALS).map((review, index) => ({
    id: `google-play-review-${String(index + 1).padStart(2, '0')}-${safeId(review.id)}`,
    kind: 'store_review',
    theme: reviewTheme(review),
    paraphrase: `Review excerpt: ${cleanText(review.text).slice(0, 520)}`,
    observedItemCount: 1,
    source: {
      platform: `Google Play review · ${review.rating}★`,
      url: review.sourceUrl || reviewResearch.reviewPageUrl,
      observedAt: review.updatedAt || null,
      capturedAt: reviewResearch.capturedAt,
    },
    canSupportProductClaim: false,
  }));
}

export function limitedGooglePlayReviews({
  capturedAt = new Date().toISOString(),
  identity = null,
  reason = 'Google Play written reviews were unavailable.',
  status = 'limited',
} = {}) {
  return {
    schemaVersion: 'google-play-reviews.v1',
    platform: 'play_store',
    status,
    locale: identity?.locale || '',
    country: identity?.country || '',
    appId: identity?.appId || '',
    storeUrl: identity?.storeUrl || '',
    reviewPageUrl: identity?.reviewPageUrl || '',
    reviews: [],
    limitations: [safeMessage(reason)],
    capturedAt,
    providerMutations: 0,
  };
}

function googlePlayIdentity(app, locale) {
  const candidates = [
    app?.extraction?.app?.storeUrl,
    app?.extraction?.url,
    app?.storeUrl,
    app?.url,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(String(candidate));
      if (!/(^|\.)play\.google\.com$/i.test(url.hostname)) continue;
      const appId = cleanText(url.searchParams.get('id'));
      if (!appId || !/^[a-zA-Z0-9._-]+$/.test(appId)) continue;
      const fallbackLocale = normalizeLocale(locale);
      const language = normalizeLanguage(url.searchParams.get('hl')) || fallbackLocale.language;
      const country = normalizeCountry(url.searchParams.get('gl')) || fallbackLocale.country;
      const storeUrl = url.href;
      const reviewPage = new URL('https://play.google.com/store/apps/details');
      reviewPage.searchParams.set('id', appId);
      reviewPage.searchParams.set('hl', language);
      reviewPage.searchParams.set('gl', country);
      reviewPage.searchParams.set('showAllReviews', 'true');
      return {
        appId,
        language,
        country,
        locale: `${language}-${country}`,
        storeUrl,
        reviewPageUrl: reviewPage.href,
      };
    } catch {
      // Try the next known app URL.
    }
  }
  return null;
}

function googlePlayReviewEndpoint({ language, country }) {
  const url = new URL('https://play.google.com/_/PlayStoreUi/data/batchexecute');
  url.searchParams.set('rpcids', REVIEW_ENDPOINT_RPC_ID);
  url.searchParams.set('hl', language);
  url.searchParams.set('gl', country);
  return url.href;
}

function googlePlayReviewBody({ appId, sort }) {
  const requestPayload = [null, null, [2, sort, [REVIEW_BATCH_SIZE, null, null], null, []], [appId, 7]];
  const request = [[[REVIEW_RPC_ID, JSON.stringify(requestPayload), null, 'generic']]];
  return new URLSearchParams({ 'f.req': JSON.stringify(request) }).toString();
}

function parseGoogleReviewRows(payload) {
  const cleaned = String(payload || '').replace(/^\)\]\}'\s*/, '');
  const outer = JSON.parse(cleaned);
  const responseRow = outer.find((row) => row?.[0] === 'wrb.fr' && typeof row?.[2] === 'string');
  if (!responseRow) return [];
  const data = JSON.parse(responseRow[2]);
  return Array.isArray(data?.[0]) ? data[0] : [];
}

function normalizeGoogleReviewRows(rows, { feedIndex, identity }) {
  return rows
    .map((row, entryIndex) => ({
      id: cleanText(row?.[0]),
      title: '',
      text: cleanText(row?.[4]),
      rating: Number(row?.[2]),
      version: cleanText(row?.[10]),
      updatedAt: googleReviewDate(row?.[5]),
      thumbsUp: Number(row?.[6]) || 0,
      sourceUrl: googleReviewSourceUrl(identity, row?.[0]),
      feedIndex,
      entryIndex,
    }))
    .filter((review) => review.id && review.text.length >= MIN_REVIEW_LENGTH && review.rating >= 1 && review.rating <= 5);
}

function googleReviewDate(value) {
  const seconds = Number(value?.[0]);
  const nanoseconds = Number(value?.[1] || 0);
  if (!Number.isFinite(seconds)) return null;
  const timestamp = (seconds * 1_000) + Math.floor(nanoseconds / 1_000_000);
  return new Date(timestamp).toISOString();
}

function googleReviewSourceUrl(identity, reviewId) {
  const url = new URL(identity.reviewPageUrl);
  if (reviewId) url.searchParams.set('reviewId', String(reviewId));
  return url.href;
}

function selectReviews(inputs, maxReviews) {
  const unique = new Map();
  for (const review of inputs) {
    if (!unique.has(review.id)) unique.set(review.id, review);
  }
  const ordered = [...unique.values()].sort((left, right) => (
    reviewQuality(right) - reviewQuality(left)
    || left.feedIndex - right.feedIndex
    || left.entryIndex - right.entryIndex
  ));
  const positive = ordered.filter((review) => review.rating >= 4);
  const critical = ordered.filter((review) => review.rating <= 3);
  const selected = [];
  while (selected.length < maxReviews && (positive.length || critical.length)) {
    if (positive.length) selected.push(positive.shift());
    if (selected.length < maxReviews && critical.length) selected.push(critical.shift());
  }
  return selected.slice(0, maxReviews);
}

function reviewQuality(review) {
  const helpfulFeed = review.feedIndex === 0 ? 4 : 0;
  const helpfulVotes = Math.min(4, Math.floor(Math.log10(Math.max(1, review.thumbsUp))));
  const substantive = Math.min(4, Math.floor(review.text.length / 180));
  return helpfulFeed + helpfulVotes + substantive;
}

function reviewTheme(review) {
  const sentences = cleanText(review.text).split(/(?<=[.!?])\s+/).filter(Boolean);
  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: sentenceScore(sentence) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return cleanText(ranked[0]?.sentence || review.text).replace(/[.!?]+$/g, '').slice(0, 240);
}

function sentenceScore(sentence) {
  const text = cleanText(sentence).toLowerCase();
  const signalTerms = /\b(help|helps|useful|easy|fun|learn|practice|remind|habit|goal|issue|problem|difficult|annoy|frustrat|crash|bug|slow|ad|price|cost|subscription|energy|streak|voice|feature)\w*\b/g;
  const matches = text.match(signalTerms)?.length || 0;
  const lengthScore = text.length >= 45 && text.length <= 220 ? 2 : text.length >= 25 ? 1 : 0;
  return (matches * 3) + lengthScore;
}

function normalizeLocale(locale) {
  const match = String(locale || '').match(/^([a-z]{2})(?:[-_]([a-z]{2}))?/i);
  return {
    language: match?.[1]?.toLowerCase() || 'en',
    country: match?.[2]?.toUpperCase() || 'US',
  };
}

function normalizeLanguage(value) {
  const match = String(value || '').match(/^([a-z]{2})/i);
  return match?.[1]?.toLowerCase() || '';
}

function normalizeCountry(value) {
  const match = String(value || '').match(/^([a-z]{2})$/i);
  return match?.[1]?.toUpperCase() || '';
}

function safeId(value) {
  return cleanText(value).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100) || 'unknown';
}

function safeMessage(value) {
  return cleanText(value).slice(0, 180);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
