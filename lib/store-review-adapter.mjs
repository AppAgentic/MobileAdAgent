import {
  appStoreReviewSignalsForPackPlan,
  fetchAppStoreReviews,
} from './app-store-review-adapter.mjs';
import {
  fetchGooglePlayReviews,
  googlePlayReviewSignalsForPackPlan,
} from './google-play-review-adapter.mjs';

export async function fetchStoreReviews(options = {}) {
  const storeUrl = appStoreUrl(options.app);
  if (isAppleStoreUrl(storeUrl)) return fetchAppStoreReviews(options);
  if (isGooglePlayUrl(storeUrl)) return fetchGooglePlayReviews(options);
  const capturedAt = new Date((options.now || (() => Date.now()))()).toISOString();
  return {
    schemaVersion: 'store-reviews.v1',
    platform: 'unsupported',
    status: 'not_applicable',
    reviews: [],
    limitations: ['Written review import requires an App Store or Google Play listing.'],
    capturedAt,
    providerMutations: 0,
  };
}

export function storeReviewSignalsForPackPlan(reviewResearch) {
  if (reviewResearch?.platform === 'play_store') {
    return googlePlayReviewSignalsForPackPlan(reviewResearch);
  }
  if (reviewResearch?.platform === 'app_store') {
    return appStoreReviewSignalsForPackPlan(reviewResearch);
  }
  return [];
}

function appStoreUrl(app) {
  return [
    app?.extraction?.app?.storeUrl,
    app?.extraction?.url,
    app?.storeUrl,
    app?.url,
  ].find(Boolean) || '';
}

function isAppleStoreUrl(value) {
  try { return /(^|\.)((apps|itunes)\.apple\.com)$/i.test(new URL(String(value)).hostname); } catch { return false; }
}

function isGooglePlayUrl(value) {
  try { return /(^|\.)play\.google\.com$/i.test(new URL(String(value)).hostname); } catch { return false; }
}
