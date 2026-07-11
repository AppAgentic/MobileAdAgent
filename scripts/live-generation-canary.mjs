#!/usr/bin/env node
/* Live generation canary for the production-shaped creative job rail.
 *
 * Modes:
 *   node scripts/live-generation-canary.mjs           # dry-run (default)
 *   node scripts/live-generation-canary.mjs --live    # one image + one UGC hook canary
 *
 * Dry-run proves the safety rail: mock adapters end to end, live adapters
 * refuse without the worker runtime/credentials, manifests stay leak-free.
 *
 * Live mode exercises the same job graph with:
 *   - a truthful app fixture built from the REAL App Store listing
 *     (iTunes lookup metadata + real store screenshots downloaded as proof)
 *   - live source generation (one image ad canvas + V6 creator performance blocks)
 *   - the local finishing backend for composition (image compositor +
 *     HTML-composition video renderer; no ad-hoc media shell tools)
 *
 * Secrets: the generation key is pulled from the local vault inside this
 * process and held in memory only. It is never printed, logged, or written.
 *
 * Boundaries: providerMutations stays 0 (no ad-network/publishing calls).
 * Generation provider calls are counted separately and reported.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createLocalAssetStore } from '../lib/asset-store.mjs';
import { buildJobManifest } from '../lib/creative-job-model.mjs';
import { resolveGenerationAdapters } from '../lib/generation-adapters.mjs';
import { createGenerationLedger } from '../lib/live-generation.mjs';
import { probeImage } from '../lib/media-probe.mjs';
import { runCreativeJob } from '../lib/local-job-runner.mjs';
import { createTenantStore } from '../lib/local-tenant-store.mjs';
import { createPlannedPack } from './pack-plan-test-fixture.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APP_URL = 'https://apps.apple.com/us/app/gymstreak-ai-gym-workout-plan/id1371187280';
const VAULT_SERVICE = 'mobileadagent-gemini-api-key';

const args = process.argv.slice(2);
const live = args.includes('--live');
const appUrlArg = valueArg(args, '--app-url') || DEFAULT_APP_URL;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = valueArg(args, '--out') || path.join(REPO_ROOT, 'artifacts', 'live-generation-canary', timestamp);

function valueArg(list, flag) {
  const index = list.indexOf(flag);
  return index >= 0 ? list[index + 1] : null;
}

/* In-memory secret retrieval. stdout is captured, never echoed. */
const secretCache = new Map();
function secretResolver({ purpose } = {}) {
  if (purpose !== 'media_generation') {
    throw new Error(`No vault mapping for secret purpose "${purpose}".`);
  }
  if (!secretCache.has(purpose)) {
    const value = execFileSync('security', ['find-generic-password', '-s', VAULT_SERVICE, '-w'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();
    if (!value) throw new Error('Vault returned an empty generation key.');
    secretCache.set(purpose, value);
  }
  return secretCache.get(purpose);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  return response.json();
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': 'MobileAdAgentCanary/0.1 (+https://appagentic.com; generation canary)',
    },
  });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  return response.text();
}

/* Truthful fixture: real listing metadata, claims quoted verbatim from the
   real store description, real store screenshots as proof. Nothing invented. */
async function buildLiveExtraction(appUrl) {
  const idMatch = appUrl.match(/id(\d+)/);
  if (!idMatch) throw new Error('App Store URL must contain a numeric app id.');
  const lookup = await fetchJson(`https://itunes.apple.com/lookup?id=${idMatch[1]}&country=us`);
  const result = lookup.results?.[0];
  if (!result) throw new Error('App Store lookup returned no app.');

  const screenshotUrls = [
    ...(Array.isArray(result.screenshotUrls) ? result.screenshotUrls : []),
    ...(Array.isArray(result.ipadScreenshotUrls) ? result.ipadScreenshotUrls : []),
  ].length
    ? [
      ...(Array.isArray(result.screenshotUrls) ? result.screenshotUrls : []),
      ...(Array.isArray(result.ipadScreenshotUrls) ? result.ipadScreenshotUrls : []),
    ].map(upgradeAppleScreenshotUrl).slice(0, 3)
    : (await extractApplePageScreenshotUrls(result.trackViewUrl || appUrl)).map(upgradeAppleScreenshotUrl).slice(0, 3);
  if (!screenshotUrls.length) throw new Error('App Store listing has no screenshots to use as proof.');

  const description = String(result.description || '');
  const claims = description
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/^[•\-\s]+/, '').trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 110 && /[a-z]/i.test(sentence))
    .slice(0, 2)
    .map((sentence, index) => ({
      id: `claim-${index + 1}`,
      text: sentence,
      source: 'App Store description',
      selected: true,
      confidence: 'medium',
    }));
  if (!claims.length) throw new Error('Could not derive verbatim claims from the store description.');

  return {
    extraction: {
      schemaVersion: 'local-app-extraction.v1',
      jobId: `extract-canary-${idMatch[1]}`,
      source: 'generation_canary',
      url: result.trackViewUrl || appUrl,
      createdAt: new Date().toISOString(),
      providerMutations: 0,
      platform: 'app_store',
      app: {
        name: result.trackName,
        category: result.primaryGenreName || '',
        subtitle: '',
        iconUrl: result.artworkUrl512 || result.artworkUrl100 || null,
        storeUrl: result.trackViewUrl || appUrl,
        summary: `${result.trackName} on the App Store.`,
        description,
      },
      uiObjects: screenshotUrls.map((sourceUrl, index) => ({
        id: `ui-store-screen-${index + 1}`,
        title: `Store screenshot ${index + 1}`,
        sourceType: 'store_art',
        extractionStage: 'pre_rawification',
        requiresRawificationBeforeUiExtraction: true,
        rawifyEligible: true,
        trustLevel: 'store_listing_candidate',
        sourceUrl,
        usability: { status: 'recommended', label: 'Rawify candidate', reason: 'Real App Store screenshot; requires rawification before UI extraction, then preservation QA and approval before proof-led UGC is ready.' },
      })),
      claimCandidates: claims,
      reviewSummary: { screenCount: screenshotUrls.length, claimCount: claims.length, rawifyCandidateCount: screenshotUrls.length, holds: [] },
      styleNotes: ['Plain language', 'Show real app screens'],
    },
    canonicalAppId: `app-store-${idMatch[1]}`,
    screenshotUrls,
  };
}

async function extractApplePageScreenshotUrls(appUrl) {
  const html = await fetchText(appUrl);
  const urls = extractUrls(html, /https:\/\/[^"'\\\s<>;)]+mzstatic\.com[^"'\\\s<>;)]+/g)
    .map(cleanAppleImageUrl)
    .filter((candidate) => /\/PurpleSource/i.test(candidate))
    .filter((candidate) => !/(Placeholder|AppIcon)/i.test(candidate))
    .filter((candidate) => /\/\d+x\d+[^/]*\.(webp|jpg|jpeg|png)$/i.test(candidate));
  const bestBySource = new Map();
  for (const candidate of urls) {
    const sourceKey = candidate.replace(/\/\d+x\d+[^/]*\.(webp|jpg|jpeg|png)$/i, '');
    const size = imageUrlArea(candidate);
    const formatBonus = /\.(jpg|jpeg|png)$/i.test(candidate) ? 1 : 0;
    const score = size * 10 + formatBonus;
    const existing = bestBySource.get(sourceKey);
    if (!existing || score > existing.score) {
      bestBySource.set(sourceKey, { url: candidate, score });
    }
  }
  return [...bestBySource.values()]
    .sort((left, right) => right.score - left.score)
    .map((item) => item.url)
    .slice(0, 10);
}

function upgradeAppleScreenshotUrl(url) {
  return String(url || '').replace(
    /\/(\d+)x(\d+)([^/]*?)\.(webp|jpg|jpeg|png)$/i,
    (match, widthValue, heightValue, suffix, extension) => {
      const width = Number(widthValue);
      const height = Number(heightValue);
      if (!width || !height || (width >= 600 && height >= 1100)) return match;
      const ratio = height / Math.max(1, width);
      if (ratio >= 2) return `/1290x2796${suffix}.${extension}`;
      if (ratio >= 1.45) return `/1242x2208${suffix}.${extension}`;
      const scale = Math.max(600 / width, 1100 / height, 2);
      return `/${Math.round(width * scale)}x${Math.round(height * scale)}${suffix}.${extension}`;
    },
  );
}

function cleanAppleImageUrl(url) {
  return decodeHtml(String(url || ''))
    .replace(/\\\//g, '/')
    .replace(/[),;]+$/g, '');
}

function extractUrls(html, regex) {
  return [...String(html || '').matchAll(regex)].map((match) => match[0]);
}

function imageUrlArea(url) {
  const match = String(url).match(/\/(\d+)x(\d+)[^/]*\.(webp|jpg|jpeg|png)$/i);
  return match ? Number(match[1]) * Number(match[2]) : 0;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&quot;/g, '"');
}

function offlineExtraction() {
  return {
    extraction: {
      schemaVersion: 'local-app-extraction.v1',
      jobId: 'extract-canary-dryrun',
      source: 'generation_canary',
      url: 'https://apps.apple.com/us/app/example/id123456789',
      createdAt: new Date().toISOString(),
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
      uiObjects: [1, 2, 3].map((index) => ({
        id: `ui-store-screen-${index}`,
        title: `Store screenshot ${index}`,
        sourceType: 'store_art',
        sourceUrl: `https://cdn.example-store.test/screen-${index}.png`,
        usability: { status: 'recommended', label: 'Looks usable', reason: 'High-resolution vertical app screenshot.' },
      })),
      claimCandidates: [
        { id: 'claim-1', text: 'Set reminders for daily routines.', source: 'App Store description', selected: true, confidence: 'medium' },
        { id: 'claim-2', text: 'Review tracked history in one place.', source: 'App Store description', selected: true, confidence: 'low' },
      ],
      reviewSummary: { screenCount: 3, claimCount: 2, rawifyCandidateCount: 0, holds: [] },
      styleNotes: ['Plain language', 'Show real app screens'],
    },
    canonicalAppId: 'app-store-123456789',
    screenshotUrls: [],
  };
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const assetStore = createLocalAssetStore({ rootDir: path.join(outDir, 'assets') });
  const workDir = path.join(outDir, 'render-work');
  const ledger = createGenerationLedger();

  const report = {
    schemaVersion: 'live-generation-canary.v1',
    mode: live ? 'live' : 'dry_run',
    startedAt: new Date().toISOString(),
    appUrl: live ? appUrlArg : null,
    outDir,
    provider_mutations: 0,
    generation_provider_calls: 0,
    refusalChecks: [],
    holds: [],
    blockers: [],
    artifacts: {},
  };

  /* Refusal checks run in BOTH modes: live adapters must refuse without the
     master switch, and without the worker runtime. */
  report.refusalChecks.push(
    refusalCheck('live_without_master_switch', () => resolveGenerationAdapters({ MAA_IMAGE_ADAPTER: 'live' })),
    refusalCheck('live_without_worker_runtime', () => resolveGenerationAdapters({ MAA_LIVE_ADAPTERS_ENABLED: '1', MAA_IMAGE_ADAPTER: 'live' })),
    refusalCheck('hosted_render_without_endpoint', () => resolveGenerationAdapters(
      { MAA_LIVE_ADAPTERS_ENABLED: '1', MAA_RENDER_ADAPTER: 'hosted' },
      { secretResolver, assetStore, workDir },
    )),
  );
  const refusalFailures = report.refusalChecks.filter((entry) => !entry.refused);
  if (refusalFailures.length) {
    report.status = 'failed';
    report.error = 'Live adapter refusal contract is broken; aborting before any provider call.';
    await writeReport(report);
    console.error(report.error);
    process.exit(1);
  }

  const fixture = live ? await buildLiveExtraction(appUrlArg) : offlineExtraction();
  const store = createTenantStore();
  const boot = store.bootstrapUser({ email: 'canary@appagentic.dev' });
  const claim = store.claimPreview({
    uid: boot.uid,
    email: boot.email,
    previewSessionId: `canary-${timestamp}`,
    canonicalAppId: fixture.canonicalAppId,
    extraction: fixture.extraction,
    productId: 'launch_pack',
  });
  const ctx = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: claim.app.appId };

  /* Live mode: download the real store screenshots into the asset lake under
     the exact tenant-scoped proof keys the job graph references. */
  if (live) {
    for (let index = 0; index < claim.app.screens.length; index += 1) {
      const screen = claim.app.screens[index];
      const sourceUrl = fixture.extraction.uiObjects[index]?.sourceUrl;
      if (!screen.storageKey || !sourceUrl) continue;
      const bytes = await fetchBytes(sourceUrl);
      const probe = probeImage(bytes);
      await assetStore.putObject({
        storageKey: screen.storageKey,
        bytes,
        contentType: probe.container === 'jpeg' ? 'image/jpeg' : 'image/png',
      });
    }
    report.proofScreens = claim.app.screens.map((screen) => screen.storageKey).filter(Boolean);
  }

  const pack = createPlannedPack(store, {
    ...ctx,
    imageCount: 1,
    videoCount: 1,
    idempotencyKey: `canary-pack-${timestamp}`,
    appPlan: {
      screens: claim.app.screens.map((screen) => ({ id: screen.id, selected: true, ignored: false })),
      claims: claim.app.claims.map((item) => ({ id: item.id, text: item.text, selected: true, ignored: false, supported: true })),
    },
  });
  const created = store.createGenerationJob({ ...ctx, packId: pack.pack.packId, ugcRoute: 'ugc_selfie_proof_reveal' });

  const env = live
    ? { MAA_LIVE_ADAPTERS_ENABLED: '1', MAA_IMAGE_ADAPTER: 'live', MAA_UGC_ADAPTER: 'live', MAA_RENDER_ADAPTER: 'local', MAA_RENDER_TIMEOUT_MS: '900000', MAA_RENDER_SOFTWARE: '1', MAA_RENDER_LOW_MEMORY: '1' }
    : {};
  const runtime = live ? { secretResolver, assetStore, workDir, ledger } : {};
  const adapters = resolveGenerationAdapters(env, runtime);

  const finished = await runCreativeJob({
    store,
    orgId: ctx.orgId,
    workspaceId: ctx.workspaceId,
    appId: ctx.appId,
    jobId: created.job.jobId,
    adapters,
  });

  const manifest = buildJobManifest(finished);
  await fs.writeFile(path.join(outDir, 'job-manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(outDir, 'qa-reports.json'), JSON.stringify(finished.qaReports, null, 2));

  /* Copy customer-visible outputs to the top of the canary dir. */
  for (const draft of finished.drafts) {
    if (!draft.storageKey || !(await assetStore.exists(draft.storageKey))) continue;
    const extension = path.extname(draft.storageKey) || (draft.format === 'image_ad' ? '.png' : '.mp4');
    const target = path.join(outDir, `${draft.format}${extension}`);
    await fs.copyFile(assetStore.resolvePath(draft.storageKey), target);
    report.artifacts[draft.format] = target;
  }
  for (const asset of finished.assets) {
    if (['image_ad_source', 'ugc_first_frame', 'ugc_segment'].includes(asset.kind) && asset.storageKey && (await assetStore.exists(asset.storageKey))) {
      const target = path.join(outDir, `${asset.kind}-${path.basename(asset.storageKey)}`);
      await fs.copyFile(assetStore.resolvePath(asset.storageKey), target);
      const artifactKey = asset.kind === 'ugc_segment'
        ? `ugc_segment_${String(asset.taskId || '').split('-segment-').pop() || 'clip'}`
        : asset.kind;
      report.artifacts[artifactKey] = target;
    }
  }

  report.jobId = finished.jobId;
  report.jobStatus = finished.status;
  report.taskStates = finished.tasks.map((task) => ({ taskId: task.taskId, kind: task.kind, status: task.status, error: task.error }));
  report.qaVerdicts = finished.qaReports.map((qa) => ({ reportId: qa.reportId, verdict: qa.verdict }));
  report.holds = finished.qaReports
    .flatMap((qa) => qa.checks.filter((check) => check.status === 'hold').map((check) => ({ reportId: qa.reportId, checkId: check.id, detail: check.detail })));
  report.generation_provider_calls = ledger.generationProviderCalls();
  report.providerCallLog = ledger.calls;
  report.blockers = ledger.blockers;
  report.creditsSpent = finished.costPlan.spentCredits;
  report.finishedAt = new Date().toISOString();
  report.status = finished.status === 'failed' ? 'failed' : 'ok';
  await writeReport(report);

  console.log(`Canary ${report.mode} finished: job ${report.jobId} -> ${report.jobStatus}`);
  console.log(`Report: ${path.join(outDir, 'canary-report.json')}`);
  console.log(`generation_provider_calls: ${report.generation_provider_calls}`);
  console.log('provider_mutations: 0');
  for (const [kind, file] of Object.entries(report.artifacts)) {
    console.log(`artifact ${kind}: ${file}`);
  }
  if (report.holds.length) {
    console.log(`holds: ${report.holds.map((hold) => `${hold.reportId}:${hold.checkId}`).join(', ')}`);
  }
  if (report.blockers.length) {
    console.log(`blockers: ${report.blockers.length} (see canary-report.json)`);
  }
  process.exit(report.status === 'failed' ? 1 : 0);
}

function refusalCheck(name, build) {
  try {
    build();
    return { name, refused: false };
  } catch (error) {
    return { name, refused: true, message: error.message };
  }
}

async function writeReport(report) {
  await fs.writeFile(path.join(outDir, 'canary-report.json'), JSON.stringify(report, null, 2));
}

main().catch(async (error) => {
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'canary-error.log'), `${error.stack || error.message}\n`);
  console.error(error.stack || error.message);
  process.exit(1);
});
