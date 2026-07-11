import assert from 'node:assert/strict';
import {
  limitedResearch,
  normalizeGroundedResearch,
  researchMarketSignals,
} from '../lib/pack-plan-adapter.mjs';

const citedText = JSON.stringify({
  audience: { segment: 'People tracking a recurring routine', triggerMoment: 'When they cannot remember what comes next' },
  marketOpening: 'Lead with uncertainty before showing the verified reminder flow.',
  signals: [
    {
      kind: 'audience_tension',
      text: 'People worry about losing track of a recurring routine.',
      sourceUrls: ['https://www.reddit.com/r/example/comments/one'],
    },
    {
      kind: 'desired_outcome',
      text: 'This uncited claim must be removed.',
      sourceUrls: ['https://invented.example/review'],
    },
  ],
});
const citedPhrase = 'People worry about losing track of a recurring routine.';
const start = citedText.indexOf(citedPhrase);
const payload = {
  steps: [
    { type: 'google_search_call', arguments: { queries: ['routine tracking app reviews'] } },
    {
      type: 'model_output',
      content: [{
        type: 'text',
        text: citedText,
        annotations: [{
          type: 'url_citation',
          url: 'https://www.reddit.com/r/example/comments/one',
          title: 'reddit.com',
          start_index: start,
          end_index: start + citedPhrase.length,
        }],
      }],
    },
  ],
};

const normalized = normalizeGroundedResearch(payload, {
  app: { name: 'Routine App', extraction: { app: { storeUrl: 'https://apps.apple.com/us/app/routine/id123' } } },
  capturedAt: '2026-07-10T12:00:00.000Z',
});
assert.equal(normalized.status, 'complete');
assert.equal(normalized.coverage, 'directional');
assert.equal(normalized.marketSignals.length, 1, 'uncited signals must be discarded');
assert.equal(normalized.marketSignals[0].canSupportProductClaim, false);
assert.equal(normalized.sources.length, 1);
assert.equal(normalized.sources[0].family, 'community');
assert.equal(normalized.sourceCounts.communitySources, 1);
assert.equal(normalized.searchQueryCount, 1);

const limited = limitedResearch({ capturedAt: '2026-07-10T12:00:00.000Z', reason: 'No source connection.' });
assert.equal(limited.status, 'limited');
assert.equal(limited.coverage, 'exploratory');
assert.equal(limited.marketSignals.length, 0);
assert.equal(limited.sourceCounts.publicSources, 0);

const noKey = await researchMarketSignals({ app: { name: 'Routine App' }, apiKey: '' });
assert.equal(noKey.status, 'limited');
assert.equal(noKey.researchIntelligenceCalls, 0);
assert.equal(noKey.sources.length, 0);
assert.equal(noKey.providerMutations, 0);

let requestBody = null;
const liveFixture = await researchMarketSignals({
  app: { name: 'Routine App', claims: [{ text: 'Plan recurring routines.', selected: true, supported: true }] },
  priorLearnings: [{ instruction: 'Create more work that explores the reminder angle.' }],
  apiKey: 'fixture-key',
  fetchImpl: async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return { ok: true, async json() { return payload; } };
  },
});
assert.equal(liveFixture.status, 'complete');
assert.ok(requestBody.input.includes('Create more work that explores the reminder angle.'), 'typed learning instructions must inform the next bounded research pass');
assert.deepEqual(requestBody.tools, [{ type: 'google_search' }]);

console.log('Pack-plan research adapter tests passed.');
