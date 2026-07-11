/* Deterministic, read-only App Store customer-review ingestion.
 *
 * Written reviews are fetched from Apple's public customer-reviews feed and
 * retained as source-backed market signals. They are audience evidence only:
 * a review can shape an angle, but it can never authorize a product claim.
 */

const REVIEW_TIMEOUT_MS = 9_000;
const MAX_REVIEW_SIGNALS = 8;
const MIN_REVIEW_LENGTH = 40;

export async function fetchAppStoreReviews({
  app,
  locale = 'en-US',
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = REVIEW_TIMEOUT_MS,
  maxReviews = MAX_REVIEW_SIGNALS,
} = {}) {
  const capturedAt = new Date(now()).toISOString();
  const identity = appStoreIdentity(app, locale);
  if (!identity) {
    return limitedAppStoreReviews({
      capturedAt,
      reason: 'Written review import is available for App Store listings.',
      status: 'not_applicable',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const feedUrls = [
    appStoreReviewFeedUrl(identity, 'mostHelpful'),
    appStoreReviewFeedUrl(identity, 'mostRecent'),
  ];

  try {
    const results = await Promise.allSettled(feedUrls.map(async (url, feedIndex) => {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`App Store reviews returned HTTP ${response.status}.`);
      const payload = await response.json();
      return normalizeReviewEntries(payload, { feedIndex });
    }));
    const reviews = selectReviews(
      results.flatMap((result) => result.status === 'fulfilled' ? result.value : []),
      maxReviews,
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (!reviews.length) {
      const timedOut = failures.some((result) => result.reason?.name === 'AbortError');
      return limitedAppStoreReviews({
        capturedAt,
        identity,
        reason: timedOut
          ? 'App Store written reviews timed out.'
          : 'No usable App Store written reviews were returned.',
      });
    }

    return {
      schemaVersion: 'app-store-reviews.v1',
      status: failures.length ? 'partial' : 'complete',
      locale,
      country: identity.country,
      appId: identity.appId,
      storeUrl: identity.storeUrl,
      reviewPageUrl: identity.reviewPageUrl,
      reviews,
      limitations: failures.length
        ? ['One App Store review feed was unavailable; the reviews shown were still fetched directly from Apple.']
        : [],
      capturedAt,
      providerMutations: 0,
    };
  } catch (error) {
    return limitedAppStoreReviews({
      capturedAt,
      identity,
      reason: error?.name === 'AbortError'
        ? 'App Store written reviews timed out.'
        : safeMessage(error?.message || 'App Store written reviews were unavailable.'),
    });
  } finally {
    clearTimeout(timer);
  }
}

export function appStoreReviewSignalsForPackPlan(reviewResearch) {
  return (reviewResearch?.reviews || []).slice(0, MAX_REVIEW_SIGNALS).map((review, index) => ({
    id: `app-store-review-${String(index + 1).padStart(2, '0')}-${safeId(review.id)}`,
    kind: 'store_review',
    theme: reviewTheme(review),
    paraphrase: `Review excerpt: ${cleanText(review.text).slice(0, 520)}`,
    observedItemCount: 1,
    source: {
      platform: `App Store review · ${review.rating}★`,
      url: reviewResearch.reviewPageUrl,
      observedAt: review.updatedAt || null,
      capturedAt: reviewResearch.capturedAt,
    },
    canSupportProductClaim: false,
  }));
}

export function limitedAppStoreReviews({
  capturedAt = new Date().toISOString(),
  identity = null,
  reason = 'App Store written reviews were unavailable.',
  status = 'limited',
} = {}) {
  return {
    schemaVersion: 'app-store-reviews.v1',
    status,
    locale: '',
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

function appStoreIdentity(app, locale) {
  const candidates = [
    app?.extraction?.app?.storeUrl,
    app?.extraction?.url,
    app?.storeUrl,
    app?.url,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const url = new URL(String(candidate));
      if (!/(^|\.)apps\.apple\.com$/i.test(url.hostname) && !/(^|\.)itunes\.apple\.com$/i.test(url.hostname)) continue;
      const appId = url.pathname.match(/\/id(\d+)/i)?.[1];
      if (!appId) continue;
      const country = url.pathname.match(/^\/([a-z]{2})(?:\/|$)/i)?.[1]?.toLowerCase()
        || String(locale).match(/-([A-Z]{2})$/)?.[1]?.toLowerCase()
        || 'us';
      const storeUrl = url.href;
      const reviewPage = new URL(storeUrl);
      reviewPage.searchParams.set('see-all', 'reviews');
      return { appId, country, storeUrl, reviewPageUrl: reviewPage.href };
    } catch {
      // Try the next known app URL.
    }
  }
  return null;
}

function appStoreReviewFeedUrl({ appId, country }, sortBy) {
  return `https://itunes.apple.com/${encodeURIComponent(country)}/rss/customerreviews/page=1/id=${encodeURIComponent(appId)}/sortBy=${sortBy}/json`;
}

function normalizeReviewEntries(payload, { feedIndex }) {
  return (payload?.feed?.entry || [])
    .filter((entry) => entry?.['im:rating']?.label && entry?.content?.label)
    .map((entry, entryIndex) => ({
      id: cleanText(entry.id?.label),
      title: cleanText(entry.title?.label),
      text: cleanText(entry.content?.label),
      rating: Number(entry['im:rating']?.label),
      version: cleanText(entry['im:version']?.label),
      updatedAt: safeIso(entry.updated?.label),
      feedIndex,
      entryIndex,
    }))
    .filter((review) => review.id && review.text.length >= MIN_REVIEW_LENGTH && review.rating >= 1 && review.rating <= 5);
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
  const usefulTitle = genericReviewTitle(review.title) ? 0 : 3;
  const substantive = Math.min(4, Math.floor(review.text.length / 180));
  return helpfulFeed + usefulTitle + substantive;
}

function reviewTheme(review) {
  const title = cleanText(review.title).replace(/[.!?]+$/g, '');
  if (title && !genericReviewTitle(title)) return title.slice(0, 240);
  const sentences = cleanText(review.text).split(/(?<=[.!?])\s+/).filter(Boolean);
  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: sentenceScore(sentence) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0]?.sentence || review.text;
  return cleanText(best).replace(/[.!?]+$/g, '').slice(0, 240);
}

function sentenceScore(sentence) {
  const text = cleanText(sentence).toLowerCase();
  const signalTerms = /\b(help|helps|useful|easy|fun|learn|practice|remind|habit|goal|issue|problem|difficult|annoy|frustrat|crash|bug|slow|ad|price|cost|subscription|energy|streak|voice|feature)\w*\b/g;
  const matches = text.match(signalTerms)?.length || 0;
  const lengthScore = text.length >= 45 && text.length <= 220 ? 2 : text.length >= 25 ? 1 : 0;
  return (matches * 3) + lengthScore;
}

function genericReviewTitle(value) {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized || normalized.length < 4) return true;
  return /^(?:the )?(?:app name|good|great|amazing|awesome|best app ever|love it|i love it|must download|please read|plz read|why|duolingo|experience so far|this is great|to whoever|mary|five stars?)$/.test(normalized);
}

function safeIso(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeId(value) {
  return cleanText(value).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'unknown';
}

function safeMessage(value) {
  return cleanText(value).slice(0, 180);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
