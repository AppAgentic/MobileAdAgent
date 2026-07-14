import {
  buildPreviewPayload,
  canonicalPreviewAppId,
  createPreviewStore,
} from '../lib/local-preview.mjs';
import { createTenantStore } from '../lib/local-tenant-store.mjs';
import { createPlannedPack } from './pack-plan-test-fixture.mjs';

const PROVIDER_TERMS = ['hyperframes', 'heygen', 'kling', 'seedance', 'gemini', 'remotion', 'sora', 'veo', 'nano banana'];
const failures = [];
let currentTime = Date.UTC(2026, 6, 7, 12, 0, 0);

function now() {
  return currentTime;
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function checkNoProviderLeak(payload, label) {
  const text = JSON.stringify(payload).toLowerCase();
  for (const term of PROVIDER_TERMS) {
    if (text.includes(term)) failures.push(`provider/backend name "${term}" leaked into ${label}`);
  }
}

const fixtureExtraction = {
  schemaVersion: 'local-app-extraction.v1',
  jobId: 'extract-fixture01',
  source: 'anonymous_preview',
  url: 'https://apps.apple.com/us/app/example/id123456789',
  createdAt: new Date(now()).toISOString(),
  providerMutations: 0,
  platform: 'app_store',
  app: {
    name: 'Example App',
    category: 'Health & Fitness',
    subtitle: 'Track routines without losing your place',
    iconUrl: 'https://cdn.example-store.test/icon.png',
    storeUrl: 'https://apps.apple.com/us/app/example/id123456789',
    summary: 'Example App helps people keep daily routines on track with reminders and history.',
    description: 'Track routines, reminders, and history in one place.',
  },
  uiObjects: [
    {
      id: 'ui-store-screen-1',
      title: 'Store screenshot 1',
      description: 'Reminder screen with upcoming routine items.',
      screenType: 'reminder_list',
      sourceType: 'store_art',
      sourceUrl: 'https://cdn.example-store.test/1290x2796bb.png',
      rawifyEligible: true,
      trustLevel: 'high',
      usability: { status: 'recommended', label: 'Looks usable', reason: 'High-resolution vertical app screenshot.' },
    },
    {
      id: 'ui-store-screen-2',
      title: 'Store screenshot 2',
      description: 'History screen with recent activity.',
      screenType: 'history',
      sourceType: 'store_art',
      sourceUrl: 'https://cdn.example-store.test/800x600bb.png',
      rawifyEligible: false,
      trustLevel: 'medium',
      usability: { status: 'review', label: 'Check it', reason: 'Landscape image; review before use.' },
    },
  ],
  claimCandidates: [
    { id: 'claim-1', text: 'Set reminders for daily routines.', source: 'App Store description', selected: true, confidence: 'medium' },
    { id: 'claim-2', text: 'Review tracked history in one place.', source: 'App Store description', selected: true, confidence: 'low' },
  ],
  reviewSummary: {
    screenCount: 2,
    claimCount: 2,
    rawifyCandidateCount: 1,
    holds: [
      {
        id: 'review-store-art',
        severity: 'review',
        message: 'Store screenshots can guide ads, but review them before using them as source material.',
      },
    ],
  },
  styleNotes: ['Plain language', 'Show real app screens'],
};

const canonicalId = canonicalPreviewAppId(fixtureExtraction.url);

/* Preview cache + cost controls */
const previewStore = createPreviewStore({ now, maxPreviewsPerWindow: 10, dailyCostCeilingCents: 24, extractionCostCents: 8 });
let previewCheck = previewStore.checkPreviewAllowed({ canonicalAppId: canonicalId, ip: '203.0.113.10' });
check(previewCheck.cache === 'miss', 'first canonical preview should be a cache miss');
previewStore.cacheExtraction(canonicalId, fixtureExtraction);
check(previewStore.getCacheStats(canonicalId).extractionCount === 1, 'first extraction should increment count once');

previewCheck = previewStore.checkPreviewAllowed({ canonicalAppId: canonicalId, ip: '203.0.113.10' });
check(previewCheck.cache === 'hit', 'second canonical preview should be a cache hit');
check(previewCheck.cachedExtraction === fixtureExtraction, 'cache hit should return cached extraction');
check(previewStore.getCacheStats(canonicalId).extractionCount === 1, 'cache hit must not increment extraction count');

const session = previewStore.createSession({ canonicalAppId: canonicalId, url: fixtureExtraction.url });
const preview = buildPreviewPayload(fixtureExtraction, session);
check(preview.access.canGenerate === false, 'anonymous preview must not unlock generation');
checkNoProviderLeak(preview, 'preview payload');

const rateLimitedStore = createPreviewStore({ now, maxPreviewsPerWindow: 2 });
rateLimitedStore.checkPreviewAllowed({ canonicalAppId: canonicalId, ip: '198.51.100.1' });
rateLimitedStore.checkPreviewAllowed({ canonicalAppId: canonicalId, ip: '198.51.100.1' });
let rateLimited = false;
try {
  rateLimitedStore.checkPreviewAllowed({ canonicalAppId: canonicalId, ip: '198.51.100.1' });
} catch {
  rateLimited = true;
}
check(rateLimited, 'third preview inside the rate window should be blocked');

const costLimitedStore = createPreviewStore({ now, dailyCostCeilingCents: 8, extractionCostCents: 8 });
costLimitedStore.checkPreviewAllowed({ canonicalAppId: canonicalId, ip: '192.0.2.1' });
costLimitedStore.cacheExtraction(canonicalId, fixtureExtraction);
let costLimited = false;
try {
  costLimitedStore.checkPreviewAllowed({ canonicalAppId: 'app-store-987654321', ip: '192.0.2.2' });
} catch {
  costLimited = true;
}
check(costLimited, 'daily anonymous preview cost ceiling should block another miss');

/* Tenant bootstrap + claim */
const tenantStore = createTenantStore({ now });
const bootOne = tenantStore.bootstrapUser({ email: 'owner@example.test' });
const bootTwo = tenantStore.bootstrapUser({ email: 'owner@example.test' });
check(bootTwo.idempotent === true, 'bootstrap must be idempotent for the same user');
check(bootOne.orgId === bootTwo.orgId, 'bootstrap retry must return the same org');

const firstClaim = tenantStore.claimPreview({
  uid: bootOne.uid,
  email: bootOne.email,
  previewSessionId: session.id,
  canonicalAppId: canonicalId,
  extraction: fixtureExtraction,
  productId: 'launch_pack',
});
check(firstClaim.idempotent === false, 'first preview claim should be fresh');
check(firstClaim.claim.orgId === bootOne.orgId, 'claim should land in bootstrapped org');
check(firstClaim.app.orgId === bootOne.orgId, 'persisted app must carry orgId');
check(firstClaim.app.workspaceId === bootOne.workspaceId, 'persisted app must carry workspaceId');
check(firstClaim.app.sourceAssets.length === 3, 'icon plus two screenshots should persist as source assets');
check(firstClaim.app.sourceAssets.every((asset) => asset.storageKey.startsWith(`orgs/${bootOne.orgId}/workspaces/${bootOne.workspaceId}/apps/${firstClaim.app.appId}/source/`)), 'source assets must use tenant-scoped storage keys');
check(firstClaim.app.screens.every((screen) => screen.storageKey), 'screens must reference owned storage keys');
checkNoProviderLeak(firstClaim, 'tenant claim payload');

const secondClaim = tenantStore.claimPreview({
  uid: bootOne.uid,
  email: bootOne.email,
  previewSessionId: session.id,
  canonicalAppId: canonicalId,
  extraction: fixtureExtraction,
  productId: 'launch_pack',
});
check(secondClaim.idempotent === true, 'claim retry must be idempotent');
check(secondClaim.claim.appId === firstClaim.claim.appId, 'claim retry must not create a second app');

const reloadedApps = tenantStore.listAppsForUser({ uid: bootOne.uid, orgId: bootOne.orgId, workspaceId: bootOne.workspaceId });
check(reloadedApps.length === 1, 'claimed app should reload from tenant store');
check(reloadedApps[0].appId === firstClaim.app.appId, 'reloaded app should match claimed app');
checkNoProviderLeak(reloadedApps, 'reloaded app payload');

const firstPack = createPlannedPack(tenantStore, {
  uid: bootOne.uid,
  orgId: bootOne.orgId,
  workspaceId: bootOne.workspaceId,
  appId: firstClaim.app.appId,
  imageCount: 2,
  videoCount: 1,
  idempotencyKey: 'tenant-test-pack',
  appPlan: {
    tagline: 'Edited summary for the approved pack.',
    screens: firstClaim.app.screens.map((screen) => ({ id: screen.id, selected: screen.selected, ignored: Boolean(screen.ignored) })),
    claims: firstClaim.app.claims.map((claim) => ({ id: claim.id, text: claim.text, selected: claim.selected, ignored: Boolean(claim.ignored), supported: claim.supported })),
  },
});
check(firstPack.idempotent === false, 'first pack preauthorization should be fresh');
check(firstPack.pack.status === 'preauthorized_mock', 'pack should be preauthorized before renderer work');
check(firstPack.pack.costCredits === 68, 'pack cost should be computed on the server');
check(firstPack.creditBalance === 268, 'pack debit should reduce the credit balance once');
check(firstPack.readiness.ready === true, 'pack should require a ready reviewed app plan');
checkNoProviderLeak(firstPack, 'pack preauthorization payload');

const authorizedPack = tenantStore.authorizePackForGeneration({
  uid: bootOne.uid,
  orgId: bootOne.orgId,
  workspaceId: bootOne.workspaceId,
  appId: firstClaim.app.appId,
  packId: firstPack.pack.packId,
});
check(authorizedPack.pack.packId === firstPack.pack.packId, 'generation must authorize the pre-paid pack');

let forgedPackBlocked = false;
try {
  tenantStore.authorizePackForGeneration({
    uid: bootOne.uid,
    orgId: bootOne.orgId,
    workspaceId: bootOne.workspaceId,
    appId: firstClaim.app.appId,
    packId: 'pack-forged',
  });
} catch {
  forgedPackBlocked = true;
}
check(forgedPackBlocked, 'generation must block forged pack IDs');

const retryPack = tenantStore.createPackForUser({
  uid: bootOne.uid,
  orgId: bootOne.orgId,
  workspaceId: bootOne.workspaceId,
  appId: firstClaim.app.appId,
  imageCount: 2,
  videoCount: 1,
  idempotencyKey: 'tenant-test-pack',
  packPlanId: firstPack.pack.packPlanId,
});
check(retryPack.idempotent === true, 'pack retry must be idempotent');
check(retryPack.pack.packId === firstPack.pack.packId, 'pack retry must return the same pack');
check(retryPack.creditBalance === 268, 'pack retry must not debit credits twice');

let readinessBlocked = false;
try {
  createPlannedPack(tenantStore, {
    uid: bootOne.uid,
    orgId: bootOne.orgId,
    workspaceId: bootOne.workspaceId,
    appId: firstClaim.app.appId,
    imageCount: 1,
    videoCount: 0,
    idempotencyKey: 'tenant-test-no-claims',
    appPlan: {
      screens: firstClaim.app.screens.map((screen) => ({ id: screen.id, selected: screen.selected, ignored: Boolean(screen.ignored) })),
      claims: firstClaim.app.claims.map((claim) => ({ id: claim.id, text: claim.text, selected: false, ignored: true, supported: claim.supported })),
    },
  });
} catch {
  readinessBlocked = true;
}
check(readinessBlocked, 'pack creation must block when reviewed app info is not ready');

let creditBlocked = false;
try {
  createPlannedPack(tenantStore, {
    uid: bootOne.uid,
    orgId: bootOne.orgId,
    workspaceId: bootOne.workspaceId,
    appId: firstClaim.app.appId,
    imageCount: 40,
    videoCount: 6,
    idempotencyKey: 'tenant-test-too-expensive',
  });
} catch {
  creditBlocked = true;
}
check(creditBlocked, 'pack creation must block when credits are insufficient');

let denied = false;
try {
  tenantStore.listAppsForUser({ uid: 'user-outsider', orgId: bootOne.orgId, workspaceId: bootOne.workspaceId });
} catch {
  denied = true;
}
check(denied, 'outsider user must not read another org');
check(!tenantStore.canClientAccessServerCollection('previewCache'), 'previewCache must be server-only');
check(!tenantStore.canClientAccessServerCollection('previewSessions'), 'previewSessions must be server-only');
check(!previewStore.canClientAccessServerCollection('previewCache'), 'preview store must deny direct previewCache access');

if (failures.length) {
  console.error('Tenant store tests failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Tenant store tests passed');
console.log(JSON.stringify({
  orgId: bootOne.orgId,
  appId: firstClaim.app.appId,
  sourceAssets: firstClaim.app.sourceAssets.length,
  packId: firstPack.pack.packId,
  packCreditsLeft: firstPack.creditBalance,
  extractionCount: previewStore.getCacheStats(canonicalId).extractionCount,
  providerMutations: 0,
}, null, 2));
