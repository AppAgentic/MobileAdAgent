import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDemoAppExtraction } from '../lib/demo-app-fixture.mjs';
import { createTenantStore } from '../lib/local-tenant-store.mjs';
import { createPlannedPack } from './pack-plan-test-fixture.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
let currentTime = Date.UTC(2026, 6, 10, 16, 0, 0);
const now = () => {
  currentTime += 250;
  return currentTime;
};

const extraction = createDemoAppExtraction({ createdAt: new Date(now()).toISOString() });
assert.equal(extraction.providerMutations, 0);
assert.equal(extraction.reviewSummary.screenCount, 3);
assert.equal(extraction.reviewSummary.claimCount, 2);
assert.equal(extraction.reviewSummary.holds.length, 0);
assert.ok(extraction.uiObjects.every((screen) => screen.sourceType === 'raw_app_proof'));
assert.ok(extraction.uiObjects.every((screen) => screen.usability.status === 'recommended'));

for (const screen of extraction.uiObjects) {
  assert.ok(screen.sourceUrl.startsWith('/demo-assets/'));
  await access(join(repoRoot, 'local-app', screen.sourceUrl));
}

const store = createTenantStore({ now });
const bootstrap = store.bootstrapUser({ email: 'demo-flow@example.test' });
const claim = store.claimPreview({
  uid: bootstrap.uid,
  email: bootstrap.email,
  previewSessionId: `proof-backed-demo-${bootstrap.uid}`,
  canonicalAppId: 'demo-duolingo-570060128',
  extraction,
  productId: 'launch_pack',
});

assert.equal(claim.claim.entitlement.credits, 336);
assert.equal(claim.app.screens.length, 3);
assert.ok(claim.app.screens.every((screen) => screen.selected));
assert.ok(claim.app.screens.every((screen) => screen.assetId && screen.storageKey));
assert.equal(claim.app.claims.length, 2);

const context = {
  uid: bootstrap.uid,
  orgId: bootstrap.orgId,
  workspaceId: bootstrap.workspaceId,
  appId: claim.app.appId,
};
const planned = createPlannedPack(store, {
  ...context,
  imageCount: 1,
  videoCount: 1,
  idempotencyKey: 'proof-backed-demo-pack',
  appPlan: {
    screens: claim.app.screens.map((screen) => ({
      id: screen.id,
      selected: screen.selected,
      ignored: Boolean(screen.ignored),
    })),
    claims: claim.app.claims.map((item) => ({
      id: item.id,
      text: item.text,
      selected: item.selected,
      ignored: Boolean(item.ignored),
      supported: item.supported,
    })),
  },
});

const acceptedPlan = planned.pack.packPlanSnapshot;
assert.equal(acceptedPlan.request.outputMix.image, 1);
assert.equal(acceptedPlan.request.outputMix.ugc, 1);
assert.equal(acceptedPlan.assignments.length, 2);
assert.equal(planned.pack.packPlanId, acceptedPlan.planId);
assert.equal(planned.creditBalance, 272);

console.log('Proof-backed demo flow test passed');
console.log(JSON.stringify({
  appId: claim.app.appId,
  reviewedScreens: claim.app.screens.length,
  claims: claim.app.claims.length,
  planId: acceptedPlan.planId,
  assignments: acceptedPlan.assignments.length,
  creditsLeft: planned.creditBalance,
  providerMutations: 0,
}, null, 2));
