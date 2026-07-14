import assert from 'node:assert/strict';

import {
  appStoreReviewSignalsForPackPlan,
  fetchAppStoreReviews,
} from '../lib/app-store-review-adapter.mjs';

const helpfulEntries = [
  reviewEntry({
    id: 'review-positive-helpful',
    rating: 5,
    title: 'Short lessons make practice easy',
    text: 'The short lessons make it easy to practice each morning before work, and the reminders help me keep the habit going.',
    updated: '2026-07-09T09:00:00-07:00',
  }),
  reviewEntry({
    id: 'review-critical-helpful',
    rating: 2,
    title: 'Voice recognition keeps failing',
    text: 'Voice recognition repeatedly marks correct pronunciation as wrong, which makes speaking practice frustrating.',
    updated: '2026-07-08T08:00:00-07:00',
  }),
];
const recentEntries = [
  helpfulEntries[0],
  reviewEntry({
    id: 'review-positive-recent',
    rating: 4,
    title: 'Useful reminders',
    text: 'The daily reminders bring me back to a lesson when I would otherwise forget to practice during a busy week.',
    updated: '2026-07-10T10:00:00-07:00',
  }),
];

const requestedUrls = [];
const research = await fetchAppStoreReviews({
  app: {
    extraction: {
      app: { storeUrl: 'https://apps.apple.com/gb/app/example/id123456789' },
    },
  },
  locale: 'en-GB',
  now: () => Date.parse('2026-07-11T09:00:00.000Z'),
  fetchImpl: async (url) => {
    requestedUrls.push(url);
    const entries = url.includes('mostHelpful') ? helpfulEntries : recentEntries;
    return { ok: true, async json() { return { feed: { entry: entries } }; } };
  },
});

assert.equal(research.status, 'complete');
assert.equal(research.country, 'gb');
assert.equal(research.appId, '123456789');
assert.equal(research.reviews.length, 3, 'duplicate review ids must be removed');
assert.ok(requestedUrls.every((url) => url.includes('/gb/rss/customerreviews/')));
assert.ok(requestedUrls.some((url) => url.includes('sortBy=mostHelpful')));
assert.ok(requestedUrls.some((url) => url.includes('sortBy=mostRecent')));
assert.equal(research.providerMutations, 0);

const signals = appStoreReviewSignalsForPackPlan(research);
assert.equal(signals.length, 3);
assert.equal(signals[0].kind, 'store_review');
assert.equal(signals[0].theme, 'Short lessons make practice easy');
assert.match(signals[0].paraphrase, /^Review excerpt:/);
assert.equal(signals[0].source.platform, 'App Store review · 5★');
assert.equal(signals[0].source.url, 'https://apps.apple.com/gb/app/example/id123456789?see-all=reviews');
assert.equal(signals[0].source.observedAt, '2026-07-09T16:00:00.000Z');
assert.equal(signals[0].canSupportProductClaim, false);

const partial = await fetchAppStoreReviews({
  app: { extraction: { url: 'https://apps.apple.com/us/app/example/id987654321' } },
  fetchImpl: async (url) => {
    if (url.includes('mostRecent')) throw new Error('fixture unavailable');
    return { ok: true, async json() { return { feed: { entry: helpfulEntries } }; } };
  },
});
assert.equal(partial.status, 'partial');
assert.equal(partial.reviews.length, 2);
assert.match(partial.limitations[0], /one App Store review feed/i);

const notApplicable = await fetchAppStoreReviews({
  app: { extraction: { url: 'https://play.google.com/store/apps/details?id=com.example' } },
});
assert.equal(notApplicable.status, 'not_applicable');
assert.equal(notApplicable.reviews.length, 0);
assert.equal(notApplicable.providerMutations, 0);

console.log('App Store review adapter tests passed.');

function reviewEntry({ id, rating, title, text, updated }) {
  return {
    id: { label: id },
    title: { label: title },
    content: { label: text, attributes: { type: 'text' } },
    updated: { label: updated },
    'im:rating': { label: String(rating) },
    'im:version': { label: '1.0.0' },
  };
}
