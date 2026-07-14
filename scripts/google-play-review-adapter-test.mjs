import assert from 'node:assert/strict';

import {
  fetchGooglePlayReviews,
  googlePlayReviewSignalsForPackPlan,
} from '../lib/google-play-review-adapter.mjs';
import {
  fetchStoreReviews,
  storeReviewSignalsForPackPlan,
} from '../lib/store-review-adapter.mjs';

const helpfulRows = [
  reviewRow({
    id: 'play-positive-helpful',
    rating: 5,
    text: 'The short guided lessons make language practice easy to fit into my commute every morning.',
    seconds: 1_752_067_200,
    thumbsUp: 84,
    version: '7.1.0',
  }),
  reviewRow({
    id: 'play-critical-helpful',
    rating: 2,
    text: 'Speaking practice keeps rejecting correct answers, and the repeated voice recognition issue is frustrating.',
    seconds: 1_751_980_800,
    thumbsUp: 52,
    version: '7.0.1',
  }),
];
const recentRows = [
  helpfulRows[0],
  reviewRow({
    id: 'play-positive-recent',
    rating: 4,
    text: 'Daily reminders help me return to a lesson during busy weeks when I would otherwise forget.',
    seconds: 1_752_153_600,
    thumbsUp: 3,
    version: '7.1.1',
  }),
];

const requests = [];
const fetchImpl = async (url, init) => {
  const request = JSON.parse(new URLSearchParams(init.body).get('f.req'));
  const inner = JSON.parse(request[0][0][1]);
  const sort = inner[2][1];
  requests.push({ url, init, sort, appId: inner[3][0] });
  return {
    ok: true,
    async text() {
      return googleBatchResponse(sort === 1 ? helpfulRows : recentRows);
    },
  };
};

const research = await fetchGooglePlayReviews({
  app: {
    extraction: {
      app: { storeUrl: 'https://play.google.com/store/apps/details?id=com.example.app&hl=en&gl=GB' },
    },
  },
  locale: 'en-GB',
  now: () => Date.parse('2026-07-12T09:00:00.000Z'),
  fetchImpl,
});

assert.equal(research.platform, 'play_store');
assert.equal(research.status, 'complete');
assert.equal(research.country, 'GB');
assert.equal(research.appId, 'com.example.app');
assert.equal(research.reviews.length, 3, 'duplicate Google Play review ids must be removed');
assert.deepEqual(requests.map((request) => request.sort).sort(), [1, 2]);
assert.ok(requests.every((request) => request.url.includes('rpcids=qnKhOb')));
assert.ok(requests.every((request) => request.url.includes('hl=en')));
assert.ok(requests.every((request) => request.url.includes('gl=GB')));
assert.ok(requests.every((request) => request.init.method === 'POST'));
assert.ok(requests.every((request) => request.appId === 'com.example.app'));
assert.equal(research.providerMutations, 0);

const signals = googlePlayReviewSignalsForPackPlan(research);
assert.equal(signals.length, 3);
assert.equal(signals[0].kind, 'store_review');
assert.match(signals[0].paraphrase, /^Review excerpt:/);
assert.equal(signals[0].source.platform, 'Google Play review · 5★');
assert.match(signals[0].source.url, /play\.google\.com\/store\/apps\/details/);
assert.match(signals[0].source.url, /reviewId=play-positive-helpful/);
assert.equal(signals[0].source.observedAt, '2025-07-09T13:20:00.000Z');
assert.equal(signals[0].canSupportProductClaim, false);

const selected = await fetchStoreReviews({
  app: { extraction: { url: 'https://play.google.com/store/apps/details?id=com.example.app' } },
  fetchImpl,
});
assert.equal(selected.platform, 'play_store');
assert.equal(storeReviewSignalsForPackPlan(selected)[0].source.platform, 'Google Play review · 5★');

const partial = await fetchGooglePlayReviews({
  app: { extraction: { url: 'https://play.google.com/store/apps/details?id=com.partial.app' } },
  fetchImpl: async (_url, init) => {
    const request = JSON.parse(new URLSearchParams(init.body).get('f.req'));
    const inner = JSON.parse(request[0][0][1]);
    if (inner[2][1] === 2) throw new Error('fixture unavailable');
    return { ok: true, async text() { return googleBatchResponse(helpfulRows); } };
  },
});
assert.equal(partial.status, 'partial');
assert.equal(partial.reviews.length, 2);
assert.match(partial.limitations[0], /one Google Play review feed/i);

const notApplicable = await fetchGooglePlayReviews({
  app: { extraction: { url: 'https://apps.apple.com/us/app/example/id123456789' } },
});
assert.equal(notApplicable.status, 'not_applicable');
assert.equal(notApplicable.reviews.length, 0);
assert.equal(notApplicable.providerMutations, 0);

console.log('Google Play review adapter tests passed.');

function reviewRow({ id, rating, text, seconds, thumbsUp, version }) {
  return [
    id,
    ['Reviewer', null],
    rating,
    null,
    text,
    [seconds, 0],
    thumbsUp,
    null,
    null,
    null,
    version,
  ];
}

function googleBatchResponse(rows) {
  const inner = JSON.stringify([rows, [null, 'next-token']]);
  return `)]}'\n\n${JSON.stringify([['wrb.fr', 'UsvDTd', inner]])}`;
}
