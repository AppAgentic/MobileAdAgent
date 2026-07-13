import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportManifest, runLocalCreativePipeline } from '../lib/local-pipeline.mjs';
import {
  buildPreviewPayload,
  canonicalPreviewAppId,
  createPreviewStore,
  isAllowedPreviewUrl,
} from '../lib/local-preview.mjs';

const PROVIDER_TERMS = ['hyperframes', 'heygen', 'kling', 'seedance', 'gemini', 'remotion', 'sora', 'veo', 'nano banana'];

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function checkNoProviderLeak(payload, label) {
  const text = JSON.stringify(payload).toLowerCase();
  for (const term of PROVIDER_TERMS) {
    if (text.includes(term)) {
      failures.push(`provider/backend name "${term}" leaked into ${label}`);
    }
  }
}

/* ---- existing pipeline smoke ---- */
const job = runLocalCreativePipeline();
const manifest = exportManifest(job);

check(job.providerMutations === 0, 'providerMutations must be 0');
check(job.status === 'approved_local_mock', `expected approved_local_mock, got ${job.status}`);
check(
  job.stages.some((stage) => stage.id === 'timeline_render' && stage.status === 'mocked'),
  'timeline_render stage missing or not mocked'
);
checkNoProviderLeak({ job, manifest }, 'API payloads');
check(
  job.qaReport.checks.every((qaCheck) => ['pass', 'warn'].includes(qaCheck.status)),
  'default sample should not have QA hold checks'
);
check(manifest.output.composition.providerMutations === 0, 'manifest render providerMutations must be 0');

/* ---- URL-first anonymous preview flow ---- */

// 1. Store-domain allowlist: previews are App Store / Google Play only pre-auth.
check(isAllowedPreviewUrl('https://apps.apple.com/us/app/example/id123456789'), 'App Store URLs must be previewable');
check(isAllowedPreviewUrl('https://play.google.com/store/apps/details?id=com.example.app'), 'Play Store URLs must be previewable');
check(!isAllowedPreviewUrl('https://example.com/some-product'), 'arbitrary websites must not be previewable pre-auth');
check(!isAllowedPreviewUrl('not a url'), 'garbage input must not be previewable');
check(
  canonicalPreviewAppId('https://apps.apple.com/us/app/example/id123456789') === 'app-store-123456789',
  'canonical App Store preview id must be stable'
);
check(
  canonicalPreviewAppId('https://play.google.com/store/apps/details?id=com.Example.App') === 'play-store-com.example.app',
  'canonical Play Store preview id must be stable'
);

// Fixture extraction: what the cheap public-store extraction returns.
const fixtureExtraction = {
  schemaVersion: 'local-app-extraction.v1',
  jobId: 'extract-fixture01',
  source: 'anonymous_preview',
  url: 'https://apps.apple.com/us/app/example/id123456789',
  providerMutations: 0,
  platform: 'app_store',
  app: {
    name: 'Example App',
    category: 'Health & Fitness',
    subtitle: 'Track routines without losing your place',
    iconUrl: 'https://cdn.example-store.test/icon.png',
    storeUrl: 'https://apps.apple.com/us/app/example/id123456789',
    summary: 'Example App helps people keep daily routines on track with reminders and history.',
    description: 'Track your daily routine with reminders. See your full history in one place. Log entries in seconds. Privacy policy: https://example.test/privacy',
  },
  aiProfile: { mode: 'automated_app_profile', status: 'applied', featureCount: 2 },
  uiObjects: [
    {
      id: 'ui-store-screen-1',
      title: 'Store screenshot 1',
      sourceType: 'store_art',
      sourceUrl: 'https://cdn.example-store.test/1290x2796bb.png',
      usability: { status: 'recommended', label: 'Looks usable', reason: 'High-resolution vertical app screenshot.' },
    },
    {
      id: 'ui-store-screen-2',
      title: 'Store screenshot 2',
      sourceType: 'store_art',
      sourceUrl: 'https://cdn.example-store.test/800x600bb.png',
      usability: { status: 'review', label: 'Check it', reason: 'Landscape or wide image; may not be a clean app screen.' },
    },
  ],
  claimCandidates: [
    { id: 'claim-1', text: 'Set reminders for daily routines.', source: 'App Store description', selected: true, confidence: 'medium' },
    { id: 'claim-2', text: 'Review tracked history in one place.', source: 'App Store description', selected: true, confidence: 'low' },
  ],
  reviewSummary: { screenCount: 2, claimCount: 2, holds: [] },
};

// 2. Preview payload shape: public app info only, generation locked.
const store = createPreviewStore();
const canonicalId = canonicalPreviewAppId(fixtureExtraction.url);
store.cacheExtraction(canonicalId, fixtureExtraction);
check(store.getCachedExtraction(canonicalId) === fixtureExtraction, 'preview cache must return cached extraction');

const session = store.createSession({ canonicalAppId: canonicalId, url: fixtureExtraction.url });
const preview = buildPreviewPayload(fixtureExtraction, session);

check(preview.app.name === 'Example App', 'preview must include app name');
check(Boolean(preview.app.iconUrl), 'preview must include app icon');
check(Boolean(preview.app.summary), 'preview must include app summary');
check(preview.features.length === 2, 'preview must include feature candidates');
check(preview.screenshots.length === 2, 'preview must include the screenshot grid');
check(preview.readiness.readyCount === 1 && preview.readiness.reviewCount === 1, 'preview must report screenshot readiness');

const internalCopyExtraction = structuredClone(fixtureExtraction);
internalCopyExtraction.uiObjects[1].usability = {
  status: 'review',
  label: 'Rawify first',
  reason: 'Store art is in pre_rawification and needs raw UI extraction.',
};
internalCopyExtraction.uiObjects[1].rawifyEligible = true;
const customerSafePreview = buildPreviewPayload(internalCopyExtraction, session);
check(
  !/rawify|pre_rawification|store_art|raw_app_proof/i.test(JSON.stringify(customerSafePreview)),
  'anonymous preview must translate internal screenshot stages into customer-safe wording',
);
check(customerSafePreview.screenshots[1].readiness.label === 'Needs review', 'store screenshot preview should use plain-language readiness');
check(Array.isArray(preview.readiness.gaps), 'preview must report readiness gaps');
check(preview.access.tier === 'anonymous_preview', 'preview access tier must be anonymous_preview');
check(preview.access.canGenerate === false, 'anonymous preview must not allow generation');
check(preview.access.canUploadScreenshots === false, 'anonymous preview must not allow uploads');
check(preview.access.canExport === false, 'anonymous preview must not allow export');
check(preview.access.claimRequired === true, 'anonymous preview must require a claim');
check(preview.access.generationRequires === 'launch_pack_or_plan', 'generation must require Launch Pack or plan credits');
check(preview.providerMutations === 0, 'preview providerMutations must be 0');
check(Boolean(preview.previewSession.expiresAt), 'preview session must be short-lived (expiry set)');
checkNoProviderLeak(preview, 'anonymous preview payload');

// 3. Session lifecycle: short-lived, restorable, expired sessions vanish.
check(store.getSession(session.id)?.id === session.id, 'preview session must be restorable before expiry');
const expiringStore = createPreviewStore({ sessionTtlMs: -1 });
const expiredSession = expiringStore.createSession({ canonicalAppId: canonicalId, url: fixtureExtraction.url });
check(expiringStore.getSession(expiredSession.id) === null, 'expired preview sessions must not be restorable');

// 4. Claim gate: durable ownership only via claim; grants credits once, idempotently.
let expiredClaimRejected = false;
try {
  expiringStore.claimSession({ sessionId: expiredSession.id, email: 'joe@example.test', productId: 'launch_pack' });
} catch {
  expiredClaimRejected = true;
}
check(expiredClaimRejected, 'claiming an expired preview session must fail');

let badEmailRejected = false;
try {
  store.claimSession({ sessionId: session.id, email: 'nope', productId: 'launch_pack', appName: fixtureExtraction.app.name });
} catch {
  badEmailRejected = true;
}
check(badEmailRejected, 'claim must require a valid email (sign-up gate)');

const firstClaim = store.claimSession({
  sessionId: session.id,
  email: 'joe@example.test',
  productId: 'launch_pack',
  appName: fixtureExtraction.app.name,
});
check(firstClaim.idempotent === false, 'first claim must be a fresh grant');
check(firstClaim.claim.orgId?.startsWith('org-'), 'claim must create an org boundary');
check(firstClaim.claim.workspaceId === 'ws-default', 'claim must land in the default workspace');
check(firstClaim.claim.entitlement.credits === 336, 'Launch Pack claim must grant exactly 336 credits (24 image + 4 UGC)');
check(firstClaim.claim.product.type === 'launch_pack', 'Launch Pack claim must be a one-time entitlement');
check(firstClaim.claim.providerMutations === 0, 'claim providerMutations must be 0');
checkNoProviderLeak(firstClaim.claim, 'claim payload');

const secondClaim = store.claimSession({
  sessionId: session.id,
  email: 'joe@example.test',
  productId: 'launch_pack',
  appName: fixtureExtraction.app.name,
});
check(secondClaim.idempotent === true, 'repeat claim must be idempotent');
check(secondClaim.claim.orgId === firstClaim.claim.orgId, 'repeat claim must return the same org');
check(secondClaim.claim.entitlement.credits === firstClaim.claim.entitlement.credits, 'repeat claim must not double-grant credits');

/* ---- Launch Annual upsell: state + copy guards on public local-app surfaces ---- */

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_SURFACES = [
  'local-app/app.js',
  'local-app/index.html',
  'local-app/styles.css',
  'local-app/landing/index.html',
  'local-app/landing/landing.js',
  'local-app/landing/styles.css',
];
const surfaces = PUBLIC_SURFACES.map((path) => ({ path, text: readFileSync(join(repoRoot, path), 'utf8') }));
const appJsText = surfaces.find((surface) => surface.path === 'local-app/app.js').text;
const landingHtmlText = surfaces.find((surface) => surface.path === 'local-app/landing/index.html').text;
const landingJsText = surfaces.find((surface) => surface.path === 'local-app/landing/landing.js').text;

// No provider/model/backend names on any public surface.
for (const { path, text } of surfaces) {
  const lower = text.toLowerCase();
  for (const term of PROVIDER_TERMS) {
    if (lower.includes(term)) failures.push(`provider/backend name "${term}" leaked into ${path}`);
  }
}

// No installs/ROAS/revenue outcome claims. The only allowed occurrences are
// explicit disclaimers ("we don't promise installs, ROAS, or revenue").
const OUTCOME_TERMS = [/\broas\b/i, /\binstalls?\b/i, /\brevenue\b/i];
for (const { path, text } of surfaces) {
  for (const [index, line] of text.split('\n').entries()) {
    for (const term of OUTCOME_TERMS) {
      if (term.test(line) && !/don'?t promise|never promise|no .*promise/i.test(line)) {
        failures.push(`possible outcome claim (${term}) in ${path}:${index + 1}`);
      }
    }
  }
}

// Launch Annual price math and credit window are pinned to the approved offer.
check(appJsText.includes('annualPriceUsd: 990'), 'Launch Annual must be $990/year');
check(appJsText.includes('monthlyEquivalentUsd: 1188'), 'annual math must anchor on $1,188 monthly equivalent');
check(appJsText.includes('launchPackCreditUsd: 249'), 'Launch Pack credit must be the full $249');
check(appJsText.includes('netFirstYearToday: 741'), 'net first year today must be $741 with credit applied');
check(appJsText.includes('creditWindowDays: 7'), 'Launch Pack credit window must be 7 days');
check(appJsText.includes("credit.status = 'expired'"), 'credit must silently expire after the window');
check(appJsText.includes("credit.status = 'applied'"), 'applying annual must consume the credit');
check(appJsText.includes('startLaunchPackCredit'), 'Launch Pack checkout must start the credit window');
check(appJsText.includes('Ready to generate ads from this app?'), 'pre-auth preview must lead with generation value before showing price');
check(appJsText.includes('Generate My Ads'), 'pre-auth preview CTA must be outcome-led');
check(
  appJsText.indexOf("const AUTH_SESSION_KEY = 'maaAuthSession'") < appJsText.indexOf('const STORED_AUTH_SESSION_RAW = readStoredAuthSession()'),
  'auth storage key must be initialized before reading the persisted local session'
);
check(
  appJsText.includes("startImport($('#importUrl').value, 'Proof-backed local demo', { demo: true })"),
  'the browser demo button must use the proof-backed demo import instead of the live preview path'
);
check(appJsText.includes("<p class=\"mono-label\">What we're testing</p>"), 'Pack Plan must present a neutral customer-facing test question');
check(appJsText.includes('Which ${shortName} message resonates more?'), 'Pack Plan test question must name the selected app');
check(!appJsText.includes('<p class="mono-label">Our idea</p>'), 'first Pack Plan must not imply the system already picked a winning idea');
check(!appJsText.includes('escapeHtml(plan.hypothesis?.statement'), 'internal hypothesis prediction must not be rendered as the customer-facing winner');
check(appJsText.includes('Create an account to continue'), 'first modal after preview CTA must be account creation');
check(appJsText.includes('Continue to checkout'), 'account modal must continue to checkout after auth');
check(appJsText.includes('No payment yet. Checkout appears after your account is created.'), 'account modal must clarify no payment happens before checkout');
check(!appJsText.includes('Save app plan'), 'pre-auth preview must not use the save-plan CTA');
check(!appJsText.includes('previewCheckoutPlan'), 'pre-auth preview must have one CTA before account creation');
check(!appJsText.includes('Need ongoing creatives? See monthly plans'), 'pre-auth preview must not show plan navigation before account creation');
check(!appJsText.includes('Get Same-Day Launch Pack · $249'), 'pre-auth preview must not show Launch Pack price before auth');
check(!appJsText.includes('Need ongoing creatives? Start at $99/mo'), 'pre-auth preview must not show plan price before auth');
check(appJsText.includes('winnersVault: true'), 'annual entitlements must include Winners Vault');
check(appJsText.includes('quarterlyAudit'), 'annual entitlements must include the quarterly audit');
check(appJsText.includes('Maybe later'), 'post-checkout upsell must have a soft "Maybe later" secondary CTA');
check(appJsText.includes('Not now'), 'annual sheet must have a "Not now" secondary CTA');
check(appJsText.includes('Continue monthly at $99/mo'), 'export upsell must offer continue-monthly secondary CTA');
check(!/\$249[^\n]{0,60}toward[^\n]{0,30}monthly/i.test(appJsText), 'credit must never be framed as applying toward monthly');
check(!/countdown/i.test(appJsText), 'no countdown timers in the annual upsell');
check(!landingHtmlText.includes('href="/?'), 'landing CTAs must not use legacy root query paths');
check(!landingJsText.includes("location.assign('/?"), 'landing URL form must not use legacy root query paths');
check(landingHtmlText.includes('href="/login"'), 'landing sign-in must point to /login');
check(landingHtmlText.includes('href="/launch-pack"'), 'landing launch CTA must point to /launch-pack');
check(landingHtmlText.includes('href="/preview?offer=launch-pack"'), 'launch pack CTA must start from /preview');
check(landingHtmlText.includes('href="/preview?plan=launch"'), 'plan CTA must start from /preview');
check(landingJsText.includes("'/preview?u='"), 'URL form must hand off to /preview?u=');

/* ---- Production route contract: no legacy landing/dashboard paths ---- */

await withLocalServer(async (baseUrl) => {
  await checkHtml(baseUrl, '/', 200, 'Same-day ad creatives');
  await checkHtml(baseUrl, '/pricing', 200, 'Same-Day Launch Pack');
  await checkHtml(baseUrl, '/launch-pack', 200, 'Same-Day Launch Pack');
  await checkHtml(baseUrl, '/preview', 200, 'app-shell');
  await checkHtml(baseUrl, '/preview?u=https%3A%2F%2Fapps.apple.com%2Fus%2Fapp%2Fexample%2Fid123456789', 200, 'app-shell');
  await checkHtml(baseUrl, '/app', 200, 'app-shell');
  await checkHtml(baseUrl, '/app/import', 200, 'app-shell');
  await checkHtml(baseUrl, '/app/apps/example-app', 200, 'app-shell');
  await checkHtml(baseUrl, '/app/packs/pack-001', 200, 'app-shell');
  await checkHtml(baseUrl, '/login', 200, 'app-shell');
  await checkHtml(baseUrl, '/signup', 200, 'app-shell');
  await checkHtml(baseUrl, '/landing', 404, 'Not found');
  await checkHtml(baseUrl, '/landing/', 404, 'Not found');
  await checkHtml(baseUrl, '/dashboard', 404, 'Not found');
  await checkHtml(baseUrl, '/?u=https%3A%2F%2Fapps.apple.com%2Fus%2Fapp%2Fexample%2Fid123456789', 404, 'Not found');
  await checkJsonStatus(baseUrl, '/api/jobs/generate', 402, { appId: 'example-app' });
  await checkJsonStatus(baseUrl, '/api/jobs/generate', 403, {
    uid: 'user-forged',
    orgId: 'org-forged',
    workspaceId: 'ws-default',
    appId: 'example-app',
    packId: 'pack-forged',
  });
  await checkJsonGetStatus(
    baseUrl,
    '/api/jobs/state?jobId=job-forged&orgId=org-forged&workspaceId=ws-default&appId=example-app&uid=user-forged',
    403
  );

  const anonymousDemoResponse = await fetch(`${baseUrl}/api/apps/demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'Anonymous proof-backed local demo' }),
  });
  const anonymousDemoPayload = await anonymousDemoResponse.json();
  check(anonymousDemoResponse.status === 200 && anonymousDemoPayload.ok, `anonymous proof-backed demo must bootstrap and import: ${anonymousDemoPayload.error || anonymousDemoResponse.status}`);
  check(anonymousDemoPayload.session?.uid, 'anonymous proof-backed demo must return a local session');
  check(anonymousDemoPayload.app?.screens?.length === 3, 'anonymous proof-backed demo must return three reviewed screens');
  check(anonymousDemoPayload.claim?.entitlement?.credits === 336, 'anonymous proof-backed demo must grant the mock Launch Pack entitlement');
  check(anonymousDemoPayload.providerMutations === 0, 'anonymous proof-backed demo must keep providerMutations at 0');

  const demoBootstrapResponse = await fetch(`${baseUrl}/api/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'browser-demo@example.test' }),
  });
  const demoBootstrap = await demoBootstrapResponse.json();
  check(demoBootstrapResponse.status === 200 && demoBootstrap.ok, 'local demo bootstrap must succeed');
  const demoResponse = await fetch(`${baseUrl}/api/apps/demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      uid: demoBootstrap.bootstrap.uid,
      email: demoBootstrap.bootstrap.email,
      orgId: demoBootstrap.bootstrap.orgId,
      workspaceId: demoBootstrap.bootstrap.workspaceId,
      source: 'Proof-backed local demo',
    }),
  });
  const demoPayload = await demoResponse.json();
  check(demoResponse.status === 200 && demoPayload.ok, `proof-backed demo import must succeed: ${demoPayload.error || demoResponse.status}`);
  check(demoPayload.app?.screens?.length === 3, 'proof-backed demo must return three reviewed screens');
  check(demoPayload.app?.screens?.every((screen) => screen.selected), 'proof-backed demo screens must be selected for review');
  check(demoPayload.claim?.entitlement?.credits === 336, 'local demo must carry a mock Launch Pack entitlement for full-loop QA');
  check(demoPayload.providerMutations === 0, 'proof-backed demo must keep providerMutations at 0');

  const demoAssetResponse = await fetch(`${baseUrl}/demo-assets/duolingo-vocabulary-choice.jpg`);
  check(demoAssetResponse.status === 200, 'proof-backed demo asset must be served locally');
  check(demoAssetResponse.headers.get('content-type') === 'image/jpeg', 'proof-backed demo asset must use image/jpeg');
});

if (failures.length) {
  console.error('Local app smoke failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Local app smoke passed');
console.log(JSON.stringify({
  jobId: job.jobId,
  stages: job.stages.length,
  qaVerdict: job.qaReport.verdict,
  packStatus: job.creativePack.status,
  previewSession: session.id,
  previewTier: preview.access.tier,
  claimOrg: firstClaim.claim.orgId,
  claimCredits: firstClaim.claim.entitlement.credits,
}, null, 2));

async function withLocalServer(testFn) {
  const port = 4100 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['scripts/local-app-server.mjs', `--port=${port}`], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      MAA_TENANT_BACKEND: 'memory',
      MAA_AUTH_MODE: 'local',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(baseUrl, child, () => output);
    await testFn(baseUrl);
  } finally {
    child.kill();
    await Promise.race([
      once(child, 'exit').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
}

async function waitForServer(baseUrl, child, outputFn) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      failures.push(`local route server exited early: ${outputFn()}`);
      return;
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Retry until the server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  failures.push(`local route server did not become ready: ${outputFn()}`);
}

async function checkHtml(baseUrl, path, expectedStatus, expectedText) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  const text = await response.text();
  check(response.status === expectedStatus, `${path} expected ${expectedStatus}, got ${response.status}`);
  check(text.includes(expectedText), `${path} should include "${expectedText}"`);
}

async function checkJsonGetStatus(baseUrl, path, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  check(response.status === expectedStatus, `${path} expected ${expectedStatus}, got ${response.status}: ${text}`);
}

async function checkJsonStatus(baseUrl, path, expectedStatus, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  check(response.status === expectedStatus, `${path} expected ${expectedStatus}, got ${response.status}: ${text}`);
}
