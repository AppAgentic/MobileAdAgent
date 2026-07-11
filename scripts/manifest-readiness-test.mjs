/* Job manifest schema + readiness tests.

   The job manifest is the portable record a hosted worker persists to
   Firestore and an exporter reads from R2. This test locks its schema,
   verifies readiness/hold semantics when proof is missing, and runs the
   provider-name leak guard over every persisted shape. */

import {
  JOB_MANIFEST_SCHEMA_VERSION,
  buildCreativeJobGraph,
  buildJobManifest,
} from '../lib/creative-job-model.mjs';
import { resolveGenerationAdapters } from '../lib/generation-adapters.mjs';
import { runCreativeJob } from '../lib/local-job-runner.mjs';
import { createTenantStore } from '../lib/local-tenant-store.mjs';
import { createPlannedPack } from './pack-plan-test-fixture.mjs';

const PROVIDER_TERMS = ['hyperframes', 'heygen', 'kling', 'seedance', 'gemini', 'remotion', 'sora', 'veo', 'nano banana'];
const failures = [];
let currentTime = Date.UTC(2026, 6, 8, 10, 0, 0);
const now = () => (currentTime += 250);

function check(condition, message) {
  if (!condition) failures.push(message);
}

function checkNoProviderLeak(payload, label) {
  const text = JSON.stringify(payload).toLowerCase();
  for (const term of PROVIDER_TERMS) {
    if (text.includes(term)) failures.push(`provider/backend name "${term}" leaked into ${label}`);
  }
}

function fixtureExtraction({ withScreens = true } = {}) {
  return {
    schemaVersion: 'local-app-extraction.v1',
    jobId: 'extract-manifest01',
    source: 'anonymous_preview',
    url: 'https://apps.apple.com/us/app/example/id123456789',
    createdAt: new Date(currentTime).toISOString(),
    providerMutations: 0,
    platform: 'app_store',
    app: {
      name: 'Example App',
      category: 'Health & Fitness',
      subtitle: 'Track routines without losing your place',
      iconUrl: 'https://cdn.example-store.test/icon.png',
      storeUrl: 'https://apps.apple.com/us/app/example/id123456789',
      summary: 'Example App helps people keep daily routines on track.',
      description: 'Track routines, reminders, and history in one place.',
    },
    uiObjects: withScreens
      ? [{
        id: 'ui-store-screen-1',
        title: 'Routine dashboard screen',
        description: 'First-party app screen showing daily routines, reminders, and history.',
        sourceType: 'raw_app_proof',
        sourceUrl: 'https://cdn.example-store.test/1290x2796bb.png',
        usability: { status: 'recommended', label: 'Looks usable', reason: 'High-resolution vertical app screenshot.' },
      }]
      : [],
    claimCandidates: [
      { id: 'claim-1', text: 'Set reminders for daily routines.', source: 'App Store description', selected: true, confidence: 'medium' },
    ],
    reviewSummary: { screenCount: withScreens ? 1 : 0, claimCount: 1, rawifyCandidateCount: 0, holds: [] },
    styleNotes: ['Plain language'],
  };
}

async function runFixtureJob({ withScreens }) {
  const store = createTenantStore({ now });
  const boot = store.bootstrapUser({ email: `owner-${withScreens}@example.test` });
  const claim = store.claimPreview({
    uid: boot.uid,
    email: boot.email,
    previewSessionId: `session-manifest-${withScreens}`,
    canonicalAppId: 'app-store-123456789',
    extraction: fixtureExtraction({ withScreens }),
    productId: 'launch_pack',
  });
  const ctx = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: claim.app.appId };
  const pack = createPlannedPack(store, { ...ctx, imageCount: 1, videoCount: 1, idempotencyKey: `manifest-pack-${withScreens}` });
  const created = store.createGenerationJob({ ...ctx, packId: pack.pack.packId, ugcRoute: 'ugc_selfie_proof_reveal' });
  const finished = await runCreativeJob({
    store,
    orgId: boot.orgId,
    workspaceId: boot.workspaceId,
    appId: ctx.appId,
    jobId: created.job.jobId,
    adapters: resolveGenerationAdapters({}),
    now,
  });
  return { finished, manifest: buildJobManifest(finished) };
}

/* Ready path: schema completeness. */
const ready = await runFixtureJob({ withScreens: true });
const manifest = ready.manifest;
check(manifest.schemaVersion === JOB_MANIFEST_SCHEMA_VERSION, 'manifest must carry the schema version');
for (const field of ['jobId', 'packId', 'orgId', 'workspaceId', 'appId', 'status', 'request', 'progress', 'tasks', 'assets', 'qaReports', 'drafts', 'costPlan', 'audit']) {
  check(manifest[field] !== undefined, `manifest must carry "${field}"`);
}
check(manifest.providerMutations === 0, 'manifest must record providerMutations 0');
check(Number.isInteger(manifest.generationProviderCalls), 'manifest must record generationProviderCalls');
check(manifest.tasks.every((task) => task.taskId && task.kind && task.status), 'manifest tasks must be summarized');
check(
  manifest.tasks.filter((task) => task.outputStorageKey).every((task) => task.outputStorageKey.startsWith(`orgs/${manifest.orgId}/`)),
  'manifest task outputs must be tenant-scoped'
);
check(manifest.status === 'completed', 'fixture job with screens must complete');
check(manifest.drafts.every((draft) => draft.status === 'ready_for_review'), 'passing drafts must be ready for review');
const ugcRenderTask = manifest.tasks.find((task) => task.outputType === 'ugc_ad' && task.renderSpec);
check(ugcRenderTask?.renderSpec?.recipeId === 'ugc_selfie_proof_reveal', 'ready manifest must summarize the V6 recipe');
check(ugcRenderTask?.renderSpec?.renderManifest?.noCtaCard === true, 'ready manifest must summarize the no-CTA-card policy');
check(
  (ugcRenderTask?.renderSpec?.timeline || []).some((layer) => layer.type === 'proof_media' && layer.audioPolicy === 'continuous_creator_audio'),
  'ready manifest must carry proof-under-voiceover timing'
);
check(!(ugcRenderTask?.renderSpec?.timeline || []).some((layer) => layer.type === 'cta'), 'V6 manifest timeline must not include a CTA layer');
checkNoProviderLeak(manifest, 'ready manifest');

/* Hard gate: proof disappears after pack purchase. The intelligent planning
   stages must fail before any media task instead of rendering a weak ad and
   waiting for downstream QA to notice. */
async function runProoflessJob() {
  const job = buildCreativeJobGraph({
    jobId: 'job-holdcase',
    orgId: 'org-hold',
    workspaceId: 'ws-default',
    appId: 'app-hold',
    packId: 'pack-hold',
    createdBy: 'user-hold',
    imageCount: 1,
    videoCount: 1,
    ugcRoute: 'ugc_selfie_proof_reveal',
    app: {
      name: 'Example App',
      screens: [],
      claims: [{ id: 'claim-1', text: 'Set reminders for daily routines.', selected: true, supported: true }],
      angles: [],
      style: ['Plain language'],
    },
    costCredits: 64,
    createdAt: new Date(currentTime).toISOString(),
  });
  const stubStore = {
    async serverReadJob() { return job; },
    async serverSaveJob(saved) { return saved; },
    async serverFinalizeJob() { return job; },
  };
  const finished = await runCreativeJob({
    store: stubStore,
    orgId: job.orgId,
    workspaceId: job.workspaceId,
    appId: job.appId,
    jobId: job.jobId,
    adapters: resolveGenerationAdapters({}),
    now,
  });
  return { finished, manifest: buildJobManifest(finished) };
}
const held = await runProoflessJob();
check(held.finished.status === 'failed', `job without proof must fail before media, got ${held.finished.status}`);
check(held.manifest.generationProviderCalls === 0, 'proofless planning failure must make zero media-generation calls');
check(held.manifest.tasks.filter((task) => ['ugc_first_frame', 'ugc_segment', 'ugc_ad'].includes(task.outputType)).every((task) => ['skipped', 'failed'].includes(task.status)), 'proofless job must skip all UGC media tasks');
check(!held.manifest.drafts.some((draft) => draft.format === 'ugc_ad'), 'proofless job must create no UGC drafts');
checkNoProviderLeak(held.manifest, 'held manifest');

if (failures.length) {
  console.error('Manifest readiness tests failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Manifest readiness tests passed');
console.log(JSON.stringify({
  readyStatus: ready.manifest.status,
  heldStatus: held.manifest.status,
  generationProviderCalls: ready.manifest.generationProviderCalls,
  providerMutations: 0,
}, null, 2));
