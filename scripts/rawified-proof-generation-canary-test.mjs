#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildReviewedExtraction,
  loadProofInputs,
  loadReviewedProfile,
} from './rawified-proof-generation-canary.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'maa-reviewed-profile-'));
const proofOne = path.join(root, 'proof-one.png');
const proofTwo = path.join(root, 'proof-two.png');
const profilePath = path.join(root, 'reviewed-profile.json');
const otherProof = path.join(root, 'other-proof.png');
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
await Promise.all([
  fs.writeFile(proofOne, onePixelPng),
  fs.writeFile(proofTwo, onePixelPng),
  fs.writeFile(otherProof, onePixelPng),
]);

function fixture(overrides = {}) {
  return {
    schemaVersion: 'mobile-ad-agent-reviewed-profile.v1',
    storeAppId: '123456789',
    approvedForGeneration: true,
    app: {
      name: 'Example Learning Tool',
      category: 'Education',
      summary: 'Example Learning Tool helps people practice a skill with short guided exercises.',
    },
    supportedClaims: [
      {
        id: 'guided-practice',
        text: 'Practice with short guided exercises.',
        source: 'Reviewed product information',
        supported: true,
      },
    ],
    proofs: [
      {
        id: 'choice-exercise',
        sourcePath: './proof-one.png',
        label: 'Choice exercise',
        detail: 'A reviewed screen shows a learner choosing one answer.',
        approvedForGeneration: true,
      },
      {
        id: 'listening-exercise',
        sourcePath: './proof-two.png',
        label: 'Listening exercise',
        detail: 'A reviewed screen asks the learner to type what they hear.',
        approvedForGeneration: true,
      },
    ],
    styleNotes: ['Use the reviewed screens'],
    ...overrides,
  };
}

async function writeProfile(value) {
  await fs.writeFile(profilePath, JSON.stringify(value, null, 2));
}

const proofInputs = await loadProofInputs([proofOne, proofTwo]);
await writeProfile(fixture());
const reviewedProfile = await loadReviewedProfile({
  profilePath,
  proofInputs,
  storeAppId: '123456789',
});
const extraction = buildReviewedExtraction({
  appId: '123456789',
  result: {
    trackName: 'Unreviewed Store Name',
    primaryGenreName: 'Games',
    description: 'Live store description.',
    sellerName: 'Example Seller',
    artworkUrl512: 'https://cdn.example.test/icon.png',
    trackViewUrl: 'https://apps.apple.com/us/app/example/id123456789',
  },
  proofInputs,
  reviewedProfile,
});

assert.equal(extraction.app.name, 'Example Learning Tool');
assert.equal(extraction.app.category, 'Education');
assert.equal(extraction.app.summary, fixture().app.summary);
assert.deepEqual(extraction.claimCandidates.map((claim) => claim.text), ['Practice with short guided exercises.']);
assert.deepEqual(extraction.uiObjects.map((proof) => proof.title), ['Choice exercise', 'Listening exercise']);
assert.deepEqual(extraction.uiObjects.map((proof) => proof.description), [
  'A reviewed screen shows a learner choosing one answer.',
  'A reviewed screen asks the learner to type what they hear.',
]);
assert.equal(extraction.reviewSummary.approvedForGeneration, true);
assert.deepEqual(extraction.reviewSummary.holds, []);

await writeProfile(fixture({ approvedForGeneration: false }));
await assert.rejects(
  loadReviewedProfile({ profilePath, proofInputs, storeAppId: '123456789' }),
  /approvedForGeneration: true/,
);

await writeProfile(fixture({ proofs: fixture().proofs.slice(0, 1) }));
await assert.rejects(
  loadReviewedProfile({ profilePath, proofInputs, storeAppId: '123456789' }),
  /exactly one entry for each --proof file/,
);

const mismatched = fixture();
mismatched.proofs[1] = { ...mismatched.proofs[1], sourcePath: './other-proof.png' };
await writeProfile(mismatched);
await assert.rejects(
  loadReviewedProfile({ profilePath, proofInputs, storeAppId: '123456789' }),
  /is not bound to --proof 2/,
);

await writeProfile(fixture());
await assert.rejects(
  loadReviewedProfile({ profilePath, proofInputs, storeAppId: '987654321' }),
  /bound to App Store id 123456789/,
);

console.log('Rawified proof reviewed-profile tests passed');
console.log(JSON.stringify({
  approvedForGeneration: reviewedProfile.approvedForGeneration,
  claims: extraction.claimCandidates.length,
  proofs: extraction.uiObjects.length,
  providerMutations: 0,
}, null, 2));
