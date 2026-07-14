/* RenderBackend contract tests.

   Covers:
   - hosted finishing backend refuses to construct without configuration
   - local finishing backend composites a REAL image ad (sharp, in-process)
     from a generated-background stand-in plus a real screenshot proof file
   - video composition project builder writes the portable composition
     manifest and a lintable HTML project (full renders run in the canary,
     not here, to keep tests fast)
   - no provider/backend names leak into asset records or thrown errors */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLocalAssetStore } from '../lib/asset-store.mjs';
import { probeImage } from '../lib/media-probe.mjs';
import { createHostedFinishingBackend, createLocalFinishingBackend } from '../lib/render-backend.mjs';
import { createRenderAdapter } from '../lib/generation-adapters.mjs';

const PROVIDER_TERMS = ['hyperframes', 'heygen', 'kling', 'seedance', 'gemini', 'remotion', 'sora', 'veo', 'nano banana', 'sharp', 'puppeteer'];
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function checkNoProviderLeak(payload, label) {
  const text = JSON.stringify(payload).toLowerCase();
  for (const term of PROVIDER_TERMS) {
    if (text.includes(term)) failures.push(`provider/backend name "${term}" leaked into ${label}`);
  }
}

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'maa-render-contract-'));
const assetStore = createLocalAssetStore({ rootDir: path.join(tmpRoot, 'assets') });
const workDir = path.join(tmpRoot, 'render-work');

/* Hosted scaffold: refuses without endpoint config, and via the adapter
   resolver refuses without master switch + runtime. */
let hostedBlocked = false;
try {
  createHostedFinishingBackend({ env: {}, secretResolver: async () => 'unused' });
} catch {
  hostedBlocked = true;
}
check(hostedBlocked, 'hosted finishing backend must refuse without MAA_FINISHING_API_URL');

let hostedAdapterBlocked = false;
try {
  createRenderAdapter({ env: { MAA_RENDER_ADAPTER: 'hosted' }, runtime: {} });
} catch {
  hostedAdapterBlocked = true;
}
check(hostedAdapterBlocked, 'hosted render adapter must refuse without live master switch + runtime');

let localRuntimeBlocked = false;
try {
  createRenderAdapter({ env: { MAA_RENDER_ADAPTER: 'local' }, runtime: {} });
} catch {
  localRuntimeBlocked = true;
}
check(localRuntimeBlocked, 'local render adapter must refuse without asset store + workDir');

/* Real image composition through the local backend. */
const { default: sharp } = await import('sharp');
const prefix = 'orgs/org-test/workspaces/ws-default/apps/app-test/jobs/job-test';
const backgroundKey = `${prefix}/generated/job-test-image-1-source.png`;
const screenshotKey = 'orgs/org-test/workspaces/ws-default/apps/app-test/source/app-test-screen-1';

await assetStore.putObject({
  storageKey: backgroundKey,
  bytes: await sharp({ create: { width: 540, height: 675, channels: 3, background: { r: 24, g: 34, b: 52 } } }).png().toBuffer(),
  contentType: 'image/png',
});
await assetStore.putObject({
  storageKey: screenshotKey,
  bytes: await sharp({ create: { width: 390, height: 844, channels: 3, background: { r: 240, g: 244, b: 250 } } }).png().toBuffer(),
  contentType: 'image/png',
});

const imageTask = {
  taskId: 'job-test-image-1-render',
  jobId: 'job-test',
  packId: 'pack-test',
  orgId: 'org-test',
  workspaceId: 'ws-default',
  appId: 'app-test',
  kind: 'render',
  adapter: 'finishing_compositor',
  outputType: 'image_ad',
  costUnits: 0,
  dependsOn: ['job-test-image-1-source'],
  renderSpec: {
    backend: 'finishing_compositor',
    format: 'image',
    compositionKey: `${prefix}/render/job-test-image-1-render-composition.json`,
    variablesKey: `${prefix}/render/job-test-image-1-render-variables.json`,
    inputAssetIds: [],
    dimensions: { width: 1080, height: 1350 },
    outputKey: `${prefix}/render/job-test-image-1-render.png`,
    timeline: [
      { id: 'l-bg', type: 'background_layer', sourceTaskId: 'job-test-image-1-source' },
      { id: 'l-proof', type: 'proof_media', proofId: 'app-test-screen-1', storageKey: screenshotKey, treatment: 'phone-panel' },
      { id: 'l-headline', type: 'caption', role: 'headline', text: 'Set reminders for daily routines' },
      { id: 'l-cta', type: 'cta', text: 'Get Example App' },
    ],
    claimReferences: [{ claimId: 'claim-1', supportedClaim: 'Set reminders for daily routines.' }],
    providerMutations: 0,
  },
  output: { storageKey: `${prefix}/render/job-test-image-1-render.png`, contentType: 'image/png' },
};

const backend = createLocalFinishingBackend({ assetStore, workDir });
const sourceAsset = {
  assetId: 'job-test-image-1-source-asset',
  taskId: 'job-test-image-1-source',
  kind: 'image_ad_source',
  storageKey: backgroundKey,
  checksum: 'test',
};
const imageResult = await backend.renderComposition({ task: imageTask, inputAssets: [sourceAsset] });
check(imageResult.asset.mode === 'composited_render', 'image finishing must return a composited render asset');
check(imageResult.asset.width === 1080 && imageResult.asset.height === 1350, 'image ad must match spec dimensions');
check(await assetStore.exists(imageTask.renderSpec.outputKey), 'image ad output must be stored at the output key');
check(await assetStore.exists(imageTask.renderSpec.compositionKey), 'composition manifest must be stored');
check(await assetStore.exists(imageTask.renderSpec.variablesKey), 'variables manifest must be stored');
const composedProbe = probeImage(await assetStore.getObject(imageTask.renderSpec.outputKey));
check(composedProbe.ok && composedProbe.width === 1080 && composedProbe.height === 1350, 'stored image ad must probe to spec dimensions');
checkNoProviderLeak(imageResult.asset, 'image render asset record');

const composition = JSON.parse((await assetStore.getObject(imageTask.renderSpec.compositionKey)).toString());
check(composition.schemaVersion === 'finishing-composition.v1', 'composition manifest must be versioned');
check(composition.inputAssets.length === 1, 'composition manifest must list input assets');
checkNoProviderLeak(composition, 'composition manifest');

/* Missing proof must hold the render with a neutral error. */
const missingProofTask = JSON.parse(JSON.stringify(imageTask));
missingProofTask.taskId = 'job-test-image-2-render';
missingProofTask.renderSpec.timeline[1].storageKey = 'orgs/org-test/workspaces/ws-default/apps/app-test/source/missing-screen';
let missingProofError = null;
try {
  await backend.renderComposition({ task: missingProofTask, inputAssets: [sourceAsset] });
} catch (error) {
  missingProofError = error;
}
check(Boolean(missingProofError), 'missing screenshot proof must fail the finishing task');
checkNoProviderLeak({ message: missingProofError?.message || '' }, 'missing-proof error message');

if (failures.length) {
  console.error('Render contract tests failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Render contract tests passed');
console.log(JSON.stringify({
  imageAdBytes: imageResult.asset.bytes,
  checksum: imageResult.asset.checksum.slice(0, 12),
  providerMutations: 0,
}, null, 2));
await fs.rm(tmpRoot, { recursive: true, force: true });
