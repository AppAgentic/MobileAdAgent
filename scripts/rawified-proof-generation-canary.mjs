#!/usr/bin/env node
/* Generate a real creative pack from already-rawified app proof candidates.
 *
 * This canary is for the pipeline point after:
 *   source.classified -> proof.rawified -> ui.extraction.ready_pending_preservation_qa
 *
 * It creates a requested image/UGC mix through the normal job graph, using
 * rawified candidates as proof inputs. It does not publish anywhere.
 *
 * Production-shaped live validation should pass --reviewed-profile plus an
 * explicit --proof for every profile proof entry. The reviewed profile owns
 * app summary, supported claims, and proof labels/details; store lookup is
 * used only for URL identity and public metadata. --require-no-holds makes
 * any QA hold a non-zero canary result.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createLocalAssetStore } from '../lib/asset-store.mjs';
import { applyHookPlanToJob, applyScriptPlanToJob, buildJobManifest } from '../lib/creative-job-model.mjs';
import { resolveGenerationAdapters } from '../lib/generation-adapters.mjs';
import { createGenerationLedger } from '../lib/live-generation.mjs';
import { validateHookPlanForRequest } from '../lib/hook-agent.mjs';
import { validateScriptPlanForRequest } from '../lib/script-agent.mjs';
import { probeImage } from '../lib/media-probe.mjs';
import { runCreativeJob } from '../lib/local-job-runner.mjs';
import { createTenantStore } from '../lib/local-tenant-store.mjs';
import { createPlannedPack } from './pack-plan-test-fixture.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APP_URL = 'https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543';
const DEFAULT_PROOF_PATHS = [
  'artifacts/rawification-canary/2026-07-09T-fitbod-live-1/rawified-candidate.jpg',
  'artifacts/rawification-canary/2026-07-09T-fitbod-live-2/rawified-candidate.jpg',
  'artifacts/rawification-canary/2026-07-09T-fitbod-live-3/rawified-candidate.jpg',
];
const VAULT_SERVICE = 'mobileadagent-gemini-api-key';
const REVIEWED_PROFILE_SCHEMA_VERSION = 'mobile-ad-agent-reviewed-profile.v1';

const args = process.argv.slice(2);
const live = args.includes('--live');
const appUrlArg = valueArg(args, '--app-url') || DEFAULT_APP_URL;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(valueArg(args, '--out') || path.join(REPO_ROOT, 'artifacts', 'rawified-proof-generation-canary', timestamp));
const explicitProofPaths = proofPathArgs(args);
const reviewedProfileArg = valueArg(args, '--reviewed-profile');
const reviewedProfilePath = reviewedProfileArg ? path.resolve(reviewedProfileArg) : null;
const reusableHookPlanArg = valueArg(args, '--reuse-hook-plan');
const reusableHookPlanPath = reusableHookPlanArg ? path.resolve(reusableHookPlanArg) : null;
const reusableScriptPlanArg = valueArg(args, '--reuse-script-plan');
const reusableScriptPlanPath = reusableScriptPlanArg ? path.resolve(reusableScriptPlanArg) : null;
const proofPaths = (explicitProofPaths.length ? explicitProofPaths : DEFAULT_PROOF_PATHS).map((proofPath) => path.resolve(proofPath));
const imageCount = positiveIntegerArg(args, '--image-count', 1);
const videoCount = positiveIntegerArg(args, '--video-count', 1);
const requireNoHolds = args.includes('--require-no-holds');

function valueArg(list, flag) {
  const index = list.indexOf(flag);
  return index >= 0 ? list[index + 1] : null;
}

function proofPathArgs(list) {
  const values = [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === '--proof' && list[index + 1]) {
      values.push(list[index + 1]);
      index += 1;
    }
  }
  return values;
}

function positiveIntegerArg(list, flag, fallback) {
  const value = valueArg(list, flag);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

const secretCache = new Map();
function secretResolver({ purpose } = {}) {
  if (purpose !== 'media_generation') {
    throw new Error(`No vault mapping for secret purpose "${purpose}".`);
  }
  if (!secretCache.has(purpose)) {
    const injected = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const value = injected || execFileSync('security', ['find-generic-password', '-s', VAULT_SERVICE, '-w'], {
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

async function appStoreLookup(appUrl) {
  const idMatch = String(appUrl || '').match(/id(\d+)/);
  if (!idMatch) throw new Error('App Store URL must contain a numeric app id.');
  const lookup = await fetchJson(`https://itunes.apple.com/lookup?id=${idMatch[1]}&country=us`);
  const result = lookup.results?.[0];
  if (!result) throw new Error('App Store lookup returned no app.');
  return { appId: idMatch[1], result };
}

export async function loadProofInputs(paths) {
  const loaded = [];
  for (const [index, proofPath] of paths.entries()) {
    let bytes;
    try {
      bytes = await fs.readFile(proofPath);
    } catch (error) {
      throw new Error(`Proof ${index + 1} could not be read at ${proofPath}: ${error.message}`);
    }
    const probe = probeImage(bytes);
    if (!probe.ok) throw new Error(`Proof ${index + 1} is not PNG/JPEG: ${probe.reason}`);
    loaded.push({
      path: proofPath,
      realPath: await fs.realpath(proofPath),
      bytes,
      probe,
      contentType: probe.container === 'jpeg' ? 'image/jpeg' : 'image/png',
    });
  }
  return loaded;
}

export async function loadReviewedProfile({ profilePath, proofInputs, storeAppId } = {}) {
  if (!profilePath) throw new Error('Reviewed profile path is required.');
  if (!Array.isArray(proofInputs) || !proofInputs.length) {
    throw new Error('Reviewed profile validation needs at least one explicit --proof file.');
  }

  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(profilePath, 'utf8'));
  } catch (error) {
    throw new Error(`Reviewed profile could not be read as JSON at ${profilePath}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Reviewed profile must be a JSON object.');
  }
  if (parsed.schemaVersion !== REVIEWED_PROFILE_SCHEMA_VERSION) {
    throw new Error(`Reviewed profile schemaVersion must be ${REVIEWED_PROFILE_SCHEMA_VERSION}.`);
  }
  if (parsed.approvedForGeneration !== true) {
    throw new Error('Reviewed profile must set approvedForGeneration: true before any generation task can be created.');
  }

  const reviewedStoreAppId = requiredText(parsed.storeAppId, 'storeAppId', 32);
  if (!/^\d+$/.test(reviewedStoreAppId)) {
    throw new Error('Reviewed profile storeAppId must contain only digits.');
  }
  if (storeAppId && reviewedStoreAppId !== String(storeAppId)) {
    throw new Error(`Reviewed profile is bound to App Store id ${reviewedStoreAppId}, not ${storeAppId}.`);
  }

  const app = parsed.app;
  if (!app || typeof app !== 'object' || Array.isArray(app)) {
    throw new Error('Reviewed profile app must be an object.');
  }
  const normalizedApp = {
    name: requiredText(app.name, 'app.name', 160),
    category: requiredText(app.category, 'app.category', 120),
    summary: requiredText(app.summary, 'app.summary', 1_500),
  };

  if (!Array.isArray(parsed.supportedClaims) || !parsed.supportedClaims.length) {
    throw new Error('Reviewed profile supportedClaims must contain at least one approved feature claim.');
  }
  if (parsed.supportedClaims.length > 20) {
    throw new Error('Reviewed profile supports at most 20 feature claims in one canary.');
  }
  const claimIds = new Set();
  const supportedClaims = parsed.supportedClaims.map((claim, index) => {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
      throw new Error(`Reviewed profile supportedClaims[${index}] must be an object.`);
    }
    if (claim.supported !== true) {
      throw new Error(`Reviewed profile supportedClaims[${index}] must set supported: true.`);
    }
    const id = requiredText(claim.id, `supportedClaims[${index}].id`, 120);
    if (claimIds.has(id)) throw new Error(`Reviewed profile contains duplicate claim id ${id}.`);
    claimIds.add(id);
    return {
      id,
      text: requiredText(claim.text, `supportedClaims[${index}].text`, 800),
      source: optionalText(claim.source, 160) || 'Reviewed app profile',
      supported: true,
    };
  });

  if (!Array.isArray(parsed.proofs) || parsed.proofs.length !== proofInputs.length) {
    throw new Error(`Reviewed profile proofs must contain exactly one entry for each --proof file (${proofInputs.length} expected).`);
  }
  if (parsed.proofs.length > 20) {
    throw new Error('Reviewed profile supports at most 20 proof files in one canary.');
  }
  const profileDir = path.dirname(path.resolve(profilePath));
  const proofIds = new Set();
  const proofRealPaths = new Set();
  const proofs = [];
  for (const [index, proof] of parsed.proofs.entries()) {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
      throw new Error(`Reviewed profile proofs[${index}] must be an object.`);
    }
    if (proof.approvedForGeneration !== true) {
      throw new Error(`Reviewed profile proofs[${index}] must set approvedForGeneration: true.`);
    }
    const id = requiredText(proof.id, `proofs[${index}].id`, 120);
    if (proofIds.has(id)) throw new Error(`Reviewed profile contains duplicate proof id ${id}.`);
    proofIds.add(id);
    const sourcePath = requiredText(proof.sourcePath, `proofs[${index}].sourcePath`, 2_000);
    const resolvedSourcePath = path.resolve(profileDir, sourcePath);
    let profileProofRealPath;
    try {
      profileProofRealPath = await fs.realpath(resolvedSourcePath);
    } catch (error) {
      throw new Error(`Reviewed profile proofs[${index}] sourcePath could not be read: ${error.message}`);
    }
    if (profileProofRealPath !== proofInputs[index].realPath) {
      throw new Error(`Reviewed profile proofs[${index}] is not bound to --proof ${index + 1}. Keep profile proofs and CLI --proof files in the same order.`);
    }
    if (proofRealPaths.has(profileProofRealPath)) {
      throw new Error(`Reviewed profile reuses the same source file for proofs[${index}].`);
    }
    proofRealPaths.add(profileProofRealPath);
    proofs.push({
      id,
      label: requiredText(proof.label, `proofs[${index}].label`, 160),
      detail: requiredText(proof.detail, `proofs[${index}].detail`, 800),
      sourcePath,
      resolvedSourcePath,
      approvedForGeneration: true,
    });
  }

  const styleNotes = Array.isArray(parsed.styleNotes)
    ? parsed.styleNotes.map((note, index) => requiredText(note, `styleNotes[${index}]`, 240)).slice(0, 20)
    : [];

  return {
    schemaVersion: REVIEWED_PROFILE_SCHEMA_VERSION,
    profilePath: path.resolve(profilePath),
    storeAppId: reviewedStoreAppId,
    approvedForGeneration: true,
    app: normalizedApp,
    supportedClaims,
    proofs,
    styleNotes,
  };
}

function requiredText(value, field, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`Reviewed profile ${field} is required.`);
  if (text.length > maxLength) throw new Error(`Reviewed profile ${field} exceeds ${maxLength} characters.`);
  return text;
}

function optionalText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : '';
}

export function buildReviewedExtraction({ appId, result, proofInputs, reviewedProfile }) {
  if (!reviewedProfile?.approvedForGeneration) {
    throw new Error('Reviewed extraction cannot be built without approvedForGeneration: true.');
  }
  if (reviewedProfile.proofs.length !== proofInputs.length) {
    throw new Error('Reviewed extraction proof metadata no longer matches the loaded proof files.');
  }
  const description = String(result.description || '');
  return {
    schemaVersion: 'local-app-extraction.v1',
    jobId: `extract-reviewed-proof-${appId}`,
    source: 'reviewed_profile_generation_canary',
    url: result.trackViewUrl || DEFAULT_APP_URL,
    createdAt: new Date().toISOString(),
    providerMutations: 0,
    platform: 'app_store',
    app: {
      name: reviewedProfile.app.name,
      category: reviewedProfile.app.category,
      subtitle: result.sellerName || '',
      iconUrl: result.artworkUrl512 || result.artworkUrl100 || null,
      storeUrl: result.trackViewUrl || DEFAULT_APP_URL,
      summary: reviewedProfile.app.summary,
      description,
    },
    uiObjects: reviewedProfile.proofs.map((proof) => ({
      id: proof.id,
      title: proof.label,
      description: proof.detail,
      screenType: slugify(proof.label).replace(/-/g, '_'),
      sourceType: 'rawified_store_art',
      sourceUrl: null,
      extractionStage: 'proof.rawified.reviewed',
      requiresRawificationBeforeUiExtraction: false,
      rawifyEligible: false,
      trustLevel: 'rawified_from_store_listing_approved',
      approvedForGeneration: true,
      usability: {
        status: 'recommended',
        label: 'Reviewed app screen',
        reason: 'The reviewed profile explicitly approved this bound proof file for generation.',
      },
    })),
    claimCandidates: reviewedProfile.supportedClaims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      source: claim.source,
      selected: true,
      supported: true,
      confidence: 'high',
    })),
    reviewSummary: {
      screenCount: proofInputs.length,
      claimCount: reviewedProfile.supportedClaims.length,
      rawifyCandidateCount: 0,
      readyForGeneration: true,
      approvedForGeneration: true,
      holds: [],
    },
    styleNotes: [...reviewedProfile.styleNotes],
  };
}

function buildLegacyExtraction({ appId, result, proofInputs }) {
  const description = String(result.description || '');
  const shortName = shortStoreName(result.trackName);
  const category = canaryCategoryFor(result);
  const claims = preferredClaimsForApp({ description, result, category });
  const screenLabels = screenLabelsForCategory(category);
  return {
    schemaVersion: 'local-app-extraction.v1',
    jobId: `extract-rawified-proof-${appId}`,
    source: 'rawified_proof_generation_canary',
    url: result.trackViewUrl || DEFAULT_APP_URL,
    createdAt: new Date().toISOString(),
    providerMutations: 0,
    platform: 'app_store',
    app: {
      name: result.trackName || 'Imported app',
      category: result.primaryGenreName || '',
      subtitle: result.sellerName || '',
      iconUrl: result.artworkUrl512 || result.artworkUrl100 || null,
      storeUrl: result.trackViewUrl || DEFAULT_APP_URL,
      summary: summaryForApp({ shortName, result, category }),
      description,
    },
    uiObjects: proofInputs.map((proof, index) => {
      const [title, detail] = screenLabels[index] || [`Rawified app screen ${index + 1}`, 'Rawified candidate derived from store-listing screenshot.'];
      return {
        id: `rawified-${slugify(shortName)}-screen-${index + 1}`,
        title,
        description: detail,
        screenType: title.toLowerCase().replace(/\s+/g, '_'),
        sourceType: 'rawified_store_art',
        sourceUrl: null,
        extractionStage: 'proof.rawified',
        requiresRawificationBeforeUiExtraction: false,
        rawifyEligible: true,
        trustLevel: 'rawified_from_store_listing_manual_review',
        usability: {
          status: 'recommended',
          label: 'Rawified candidate',
          reason: 'Generated from a real store screenshot and visually reviewed as a candidate; preservation QA is still required before production approval.',
        },
      };
    }),
    claimCandidates: claims.map((text, index) => ({
      id: `claim-${index + 1}`,
      text,
      source: 'App Store description',
      selected: index < 3,
      confidence: 'medium',
    })),
    reviewSummary: {
      screenCount: proofInputs.length,
      claimCount: claims.length,
      rawifyCandidateCount: 0,
      holds: [{
        severity: 'review',
        message: 'Rawified candidates are suitable for this canary but still require preservation QA before production approval.',
      }],
    },
    styleNotes: ['Organic UGC', 'Show real app screens', 'No unsupported product claims'],
  };
}

function canaryCategoryFor(result) {
  const text = `${result.primaryGenreName || ''} ${result.trackName || ''} ${result.description || ''}`.toLowerCase();
  if (/\b(study|learn|lesson|language|quiz|school|education|spanish|french|german)\b/.test(text)) return 'education';
  if (/\b(gym|workout|fitness|training|exercise|muscle|rank|streak|xp)\b/.test(text)) return 'fitness';
  if (/\b(budget|money|spend|finance|invoice|expense|saving)\b/.test(text)) return 'finance';
  if (/\b(photo|image|video|camera|edit|creator|design)\b/.test(text)) return 'photo_video';
  if (/\b(task|routine|habit|reminder|calendar|productivity|daily)\b/.test(text)) return 'productivity';
  return 'utility';
}

function summaryForApp({ shortName, result, category }) {
  const text = `${result.trackName || ''} ${result.description || ''}`;
  if (category === 'education' && /\blanguage|spanish|french|german|duolingo/i.test(text)) {
    return `${shortName} helps people build language skills with short lessons, practice, and progress tracking.`;
  }
  if (category === 'education') return `${shortName} helps people learn through lessons, practice, and progress tracking.`;
  if (category === 'fitness') return `${shortName} helps people plan, track, and improve workouts using app-guided training screens.`;
  if (category === 'finance') return `${shortName} helps people understand spending and money details from one app view.`;
  if (category === 'photo_video') return `${shortName} helps people create or improve visual output from app-guided inputs.`;
  if (category === 'productivity') return `${shortName} helps people keep routines, reminders, and progress together.`;
  return `${shortName} helps users complete the task shown in its app screens.`;
}

function screenLabelsForCategory(category) {
  if (category === 'education') {
    return [
      ['Lesson screen', 'Rawified app screen showing a lesson or learning exercise in progress.'],
      ['Practice flow', 'Rawified app screen showing a language practice, answer, or skill-building step.'],
      ['Progress view', 'Rawified app screen showing learning progress, goals, streak, or lesson path.'],
    ];
  }
  if (category === 'fitness') {
    return [
      ['Workout builder', 'Rawified app screen showing workout setup, target muscles, exercise list, and gym equipment controls.'],
      ['Exercise logger', 'Rawified app screen showing an exercise detail/logging flow with reps, weight, rest, history, and replace actions.'],
      ['Muscle recovery', 'Rawified app screen showing muscle recovery status, days since last workout, and fresh muscle groups.'],
    ];
  }
  if (category === 'finance') {
    return [
      ['Money overview', 'Rawified app screen showing account, spending, or budget details.'],
      ['Breakdown view', 'Rawified app screen showing transaction, category, or financial breakdown detail.'],
      ['Progress view', 'Rawified app screen showing financial progress, goal, or summary state.'],
    ];
  }
  return [
    ['Primary app screen', 'Rawified app screen showing the main app workflow.'],
    ['Detail screen', 'Rawified app screen showing a detail, input, or action step.'],
    ['Progress screen', 'Rawified app screen showing progress, history, or result state.'],
  ];
}

function preferredClaimsForApp({ description, result, category }) {
  const shortName = shortStoreName(result.trackName);
  const text = `${result.trackName || ''} ${description}`.toLowerCase();
  const preferred = category === 'education' && /\blanguage|spanish|french|german|duolingo/.test(text)
    ? [
        'Practice a new language with quick, bite-sized lessons.',
        'Build reading, listening, speaking, and writing skills with guided exercises.',
        'Keep a daily learning habit with progress, goals, and streaks.',
      ]
    : category === 'education'
      ? [
          'Practice lessons in short sessions.',
          'Review mistakes and progress while studying.',
          'Build a daily learning habit with guided exercises.',
        ]
      : category === 'fitness'
        ? [
            'Plan workouts from real app screens.',
            'Track exercise details and workout progress.',
            'Use app-guided workout information while training.',
          ]
        : [
            `${shortName} shows the task clearly inside the app.`,
            `${shortName} keeps the important details in one place.`,
            `${shortName} helps users move from a messy step to a clear next step.`,
          ];
  const normalized = String(description || '').toLowerCase();
  const supported = preferred.filter((claim) => {
    const importantTerms = claim
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 4 && !['users', 'shows', 'clearly', 'inside', 'important', 'details', 'place'].includes(term));
    return importantTerms.length === 0 || importantTerms.some((term) => normalized.includes(term));
  });
  return supported.length ? supported : preferred;
}

function shortStoreName(name) {
  return String(name || 'The app').replace(/\s*[:|-]\s*.*/i, '').trim() || 'The app';
}

function slugify(value) {
  return String(value || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
}

async function readHookPlanAudit({ finished, assetStore, outputDirectory }) {
  const planningTask = (finished.tasks || []).find((task) => task.outputType === 'ugc_hook_plan') || null;
  const planSummary = (finished.hookPlans || []).find((plan) => plan.taskId === planningTask?.taskId)
    || (finished.hookPlans || [])[0]
    || planningTask?.hookPlan
    || null;
  const planAsset = (finished.assets || []).find((asset) => asset.kind === 'ugc_hook_plan' && (!planningTask || asset.taskId === planningTask.taskId)) || null;
  let fullPlan = null;
  let persistedPath = null;
  let reportCopyPath = null;
  let readbackError = null;

  if (planAsset?.storageKey) {
    try {
      if (!(await assetStore.exists(planAsset.storageKey))) {
        throw new Error('plan asset record exists but its object is missing');
      }
      persistedPath = assetStore.resolvePath(planAsset.storageKey);
      const bytes = await assetStore.getObject(planAsset.storageKey);
      fullPlan = JSON.parse(Buffer.from(bytes).toString('utf8'));
      reportCopyPath = path.join(outputDirectory, 'hook-plan.json');
      await fs.writeFile(reportCopyPath, Buffer.from(bytes));
    } catch (error) {
      readbackError = error.message;
    }
  }

  const plan = fullPlan || planSummary || {};
  const stageHistory = Array.isArray(fullPlan?.stageHistory) ? fullPlan.stageHistory : [];
  const isolatedBlindReadCount = stageHistory.reduce(
    (total, stage) => total + (Array.isArray(stage?.blindReads) ? stage.blindReads.length : 0),
    0,
  );
  const selectedHooks = Array.isArray(fullPlan?.selectedHooks) ? fullPlan.selectedHooks : [];
  return {
    required: Boolean(planningTask),
    taskId: planningTask?.taskId || null,
    status: plan.status || null,
    persisted: Boolean(fullPlan),
    persistedStorageKey: planAsset?.storageKey || null,
    persistedPath,
    reportCopyPath,
    readbackError,
    mode: planAsset?.mode || null,
    planId: plan.planId || null,
    planFingerprint: plan.planFingerprint || null,
    requestFingerprint: plan.requestFingerprint || planningTask?.spec?.hookRequest?.requestFingerprint || null,
    sourceFingerprint: plan.sourceFingerprint || planningTask?.spec?.hookRequest?.sourceFingerprint || null,
    policyFingerprint: plan.policyFingerprint || planningTask?.spec?.hookRequest?.policyFingerprint || null,
    rounds: Number(plan.rounds || 0),
    candidatePoolSize: Array.isArray(fullPlan?.candidatePool)
      ? fullPlan.candidatePool.length
      : Number(plan.candidatePoolSize || 0),
    selectedHookCount: selectedHooks.length
      || (Array.isArray(plan.selectedCandidateIds) ? plan.selectedCandidateIds.length : 0)
      || Number(plan.selectedHookCount || 0),
    isolatedBlindReadCount,
    intelligenceUsage: fullPlan?.intelligenceUsage || plan.intelligenceUsage || null,
    reusedArtifact: Boolean(planAsset?.reusedArtifact),
  };
}

async function readScriptPlanAudit({ finished, assetStore, outputDirectory }) {
  const planningTask = (finished.tasks || []).find((task) => task.outputType === 'ugc_script_plan') || null;
  const planSummary = (finished.scriptPlans || []).find((plan) => plan.taskId === planningTask?.taskId)
    || (finished.scriptPlans || [])[0]
    || planningTask?.scriptPlan
    || null;
  const planAsset = (finished.assets || []).find((asset) => asset.kind === 'ugc_script_plan' && (!planningTask || asset.taskId === planningTask.taskId)) || null;
  let fullPlan = null;
  let persistedPath = null;
  let reportCopyPath = null;
  let readbackError = null;
  if (planAsset?.storageKey) {
    try {
      if (!(await assetStore.exists(planAsset.storageKey))) throw new Error('plan asset record exists but its object is missing');
      persistedPath = assetStore.resolvePath(planAsset.storageKey);
      const bytes = await assetStore.getObject(planAsset.storageKey);
      fullPlan = JSON.parse(Buffer.from(bytes).toString('utf8'));
      reportCopyPath = path.join(outputDirectory, 'script-plan.json');
      await fs.writeFile(reportCopyPath, Buffer.from(bytes));
    } catch (error) {
      readbackError = error.message;
    }
  }
  const plan = fullPlan || planSummary || {};
  return {
    required: Boolean(planningTask), taskId: planningTask?.taskId || null, status: plan.status || null,
    persisted: Boolean(fullPlan), persistedStorageKey: planAsset?.storageKey || null, persistedPath, reportCopyPath, readbackError,
    mode: planAsset?.mode || null, planId: plan.planId || null, planFingerprint: plan.planFingerprint || null,
    requestFingerprint: plan.requestFingerprint || planningTask?.spec?.scriptRequest?.requestFingerprint || null,
    sourceFingerprint: plan.sourceFingerprint || planningTask?.spec?.scriptRequest?.sourceFingerprint || null,
    hookPlanFingerprint: plan.hookPlanFingerprint || planningTask?.spec?.scriptRequest?.hookPlanFingerprint || null,
    rounds: Number(plan.rounds || 0), selectedScriptCount: Array.isArray(fullPlan?.scripts) ? fullPlan.scripts.length : Number(plan.outputCount || 0),
    intelligenceUsage: fullPlan?.intelligenceUsage || plan.intelligenceUsage || null, reusedArtifact: Boolean(planAsset?.reusedArtifact),
  };
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  if (imageCount === 0 && videoCount === 0) {
    throw new Error('Canary must request at least one image or UGC output.');
  }
  if (live && !reviewedProfilePath) {
    throw new Error('Live rawified-proof generation requires --reviewed-profile; category/app template fixtures are dry-run legacy only.');
  }
  if (live && !requireNoHolds) {
    throw new Error('Live rawified-proof generation requires --require-no-holds so QA holds produce a non-zero result.');
  }
  if (reviewedProfilePath && !explicitProofPaths.length) {
    throw new Error('--reviewed-profile requires one or more explicit --proof files; legacy default proof files are never inferred for an approved run.');
  }
  const proofInputs = await loadProofInputs(proofPaths);
  const { appId: storeAppId, result } = await appStoreLookup(appUrlArg);
  const reviewedProfile = reviewedProfilePath
    ? await loadReviewedProfile({ profilePath: reviewedProfilePath, proofInputs, storeAppId })
    : null;
  const extraction = reviewedProfile
    ? buildReviewedExtraction({ appId: storeAppId, result, proofInputs, reviewedProfile })
    : buildLegacyExtraction({ appId: storeAppId, result, proofInputs });
  const assetStore = createLocalAssetStore({ rootDir: path.join(outDir, 'assets') });
  const workDir = path.join(outDir, 'render-work');
  const ledger = createGenerationLedger();
  const report = {
    schemaVersion: 'rawified-proof-generation-canary.v1',
    mode: live ? 'live' : 'dry_run',
    startedAt: new Date().toISOString(),
    appUrl: appUrlArg,
    requireNoHolds,
    reviewedProfile: reviewedProfile ? {
      path: path.relative(REPO_ROOT, reviewedProfile.profilePath),
      schemaVersion: reviewedProfile.schemaVersion,
      storeAppId: reviewedProfile.storeAppId,
      approvedForGeneration: reviewedProfile.approvedForGeneration,
      supportedClaimCount: reviewedProfile.supportedClaims.length,
      proofCount: reviewedProfile.proofs.length,
    } : null,
    requestedMix: { imageCount, videoCount },
    proofInputs: proofInputs.map((proof) => ({ path: path.relative(REPO_ROOT, proof.path), probe: proof.probe })),
    provider_mutations: 0,
    generation_provider_calls: 0,
    reusedHookPlan: null,
    reusedScriptPlan: null,
    holds: [],
    blockers: [],
    artifacts: {},
  };

  const store = createTenantStore();
  const boot = store.bootstrapUser({ email: 'canary@appagentic.dev' });
  const claim = store.claimPreview({
    uid: boot.uid,
    email: boot.email,
    previewSessionId: `rawified-proof-canary-${timestamp}`,
    canonicalAppId: `app-store-${storeAppId}-rawified`,
    extraction,
    productId: 'launch_pack',
  });
  const ctx = { uid: boot.uid, orgId: boot.orgId, workspaceId: boot.workspaceId, appId: claim.app.appId };

  for (let index = 0; index < claim.app.screens.length; index += 1) {
    const screen = claim.app.screens[index];
    const proof = proofInputs[index];
    if (!screen.storageKey || !proof) continue;
    await assetStore.putObject({
      storageKey: screen.storageKey,
      bytes: proof.bytes,
      contentType: proof.contentType,
    });
  }

  const pack = createPlannedPack(store, {
    ...ctx,
    imageCount,
    videoCount,
    idempotencyKey: `rawified-proof-pack-${timestamp}`,
    appPlan: {
      screens: claim.app.screens.map((screen) => ({ id: screen.id, selected: true, ignored: false })),
      claims: claim.app.claims.map((item) => ({ id: item.id, text: item.text, selected: true, ignored: false, supported: true })),
    },
  });
  const created = store.createGenerationJob({ ...ctx, packId: pack.pack.packId, ugcRoute: 'ugc_selfie_proof_reveal' });
  let reusableHookPlan = null;
  const hookTask = created.job.tasks.find((task) => task.outputType === 'ugc_hook_plan');
  if (reusableHookPlanPath) {
    if (!hookTask?.spec?.hookRequest || !hookTask.output?.storageKey) {
      throw new Error('Canary job is missing the Hook Agent task required for --reuse-hook-plan.');
    }
    let bytes;
    try {
      bytes = await fs.readFile(reusableHookPlanPath);
      reusableHookPlan = JSON.parse(bytes.toString('utf8'));
      validateHookPlanForRequest({ plan: reusableHookPlan, request: hookTask.spec.hookRequest, allowHeld: false });
    } catch (error) {
      throw new Error(`Reusable Hook Plan failed immutable request validation: ${error.message}`);
    }
    await assetStore.putObject({
      storageKey: hookTask.output.storageKey,
      bytes,
      contentType: hookTask.output.contentType,
    });
    report.reusedHookPlan = {
      sourcePath: path.relative(REPO_ROOT, reusableHookPlanPath),
      planId: reusableHookPlan.planId,
      planFingerprint: reusableHookPlan.planFingerprint,
      requestFingerprint: reusableHookPlan.requestFingerprint,
      sourceFingerprint: reusableHookPlan.sourceFingerprint,
      policyFingerprint: reusableHookPlan.policyFingerprint,
      providerMutations: 0,
    };
  }
  if (reusableScriptPlanPath) {
    if (!reusableHookPlan) {
      throw new Error('--reuse-script-plan requires --reuse-hook-plan so the Script Agent request can be reconstructed and validated.');
    }
    applyHookPlanToJob({ job: created.job, planningTask: hookTask, hookPlan: reusableHookPlan });
    const scriptTask = created.job.tasks.find((task) => task.outputType === 'ugc_script_plan');
    let bytes;
    let plan;
    try {
      bytes = await fs.readFile(reusableScriptPlanPath);
      plan = JSON.parse(bytes.toString('utf8'));
      validateScriptPlanForRequest({ plan, request: scriptTask.spec.scriptRequest, allowHeld: false });
      applyScriptPlanToJob({ job: created.job, planningTask: scriptTask, scriptPlan: plan });
    } catch (error) {
      throw new Error(`Reusable Script Plan failed immutable request validation: ${error.message}`);
    }
    await assetStore.putObject({
      storageKey: scriptTask.output.storageKey,
      bytes,
      contentType: scriptTask.output.contentType,
    });
    store.serverSaveJob(created.job);
    report.reusedScriptPlan = {
      sourcePath: path.relative(REPO_ROOT, reusableScriptPlanPath),
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      requestFingerprint: plan.requestFingerprint,
      sourceFingerprint: plan.sourceFingerprint,
      hookPlanFingerprint: plan.hookPlanFingerprint,
      providerMutations: 0,
    };
  }

  const env = live
    ? {
        MAA_LIVE_ADAPTERS_ENABLED: '1',
        MAA_HOOK_ADAPTER: 'live',
        MAA_SCRIPT_ADAPTER: 'live',
        MAA_IMAGE_ADAPTER: 'live',
        MAA_UGC_FRAME_ADAPTER: 'live',
        MAA_UGC_ADAPTER: 'live',
        MAA_RENDER_ADAPTER: 'local',
        MAA_RENDER_TIMEOUT_MS: '1200000',
        MAA_RENDER_SOFTWARE: '1',
        MAA_RENDER_LOW_MEMORY: '1',
        MAA_RENDER_WORKERS: '1',
      }
    : { MAA_RENDER_ADAPTER: 'mock' };
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

  const hookPlanAudit = videoCount > 0
    ? await readHookPlanAudit({ finished, assetStore, outputDirectory: outDir })
    : {
        required: false,
        status: 'not_required',
        persisted: false,
        persistedStorageKey: null,
        persistedPath: null,
        reportCopyPath: null,
        readbackError: null,
        candidatePoolSize: 0,
        selectedHookCount: 0,
        isolatedBlindReadCount: 0,
      };
  const scriptPlanAudit = videoCount > 0
    ? await readScriptPlanAudit({ finished, assetStore, outputDirectory: outDir })
    : { required: false, status: 'not_required', persisted: false, reportCopyPath: null, readbackError: null, selectedScriptCount: 0 };

  const manifest = buildJobManifest(finished);
  await fs.writeFile(path.join(outDir, 'job-manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(outDir, 'qa-reports.json'), JSON.stringify(finished.qaReports, null, 2));

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
  if (hookPlanAudit.reportCopyPath) {
    report.artifacts.hook_plan = hookPlanAudit.reportCopyPath;
  }
  if (scriptPlanAudit.reportCopyPath) report.artifacts.script_plan = scriptPlanAudit.reportCopyPath;

  report.jobId = finished.jobId;
  report.jobStatus = finished.status;
  report.taskStates = finished.tasks.map((task) => ({ taskId: task.taskId, kind: task.kind, outputType: task.outputType || null, status: task.status, error: task.error }));
  report.stageTimings = finished.tasks.map((task) => ({
    taskId: task.taskId,
    kind: task.kind,
    outputType: task.outputType || null,
    status: task.status,
    queueWaitMs: task.timing?.queueWaitMs ?? null,
    executionMs: task.timing?.totalExecutionMs ?? null,
    startedAt: task.timing?.firstStartedAt || null,
    finishedAt: task.timing?.lastAttemptFinishedAt || null,
  }));
  report.qaVerdicts = finished.qaReports.map((qa) => ({ reportId: qa.reportId, outputType: qa.outputType, verdict: qa.verdict }));
  report.holds = finished.qaReports
    .flatMap((qa) => qa.checks.filter((check) => check.status === 'hold').map((check) => ({ reportId: qa.reportId, checkId: check.id, detail: check.detail })));
  report.creative_intelligence_calls = ledger.creativeIntelligenceCalls();
  report.job_creative_intelligence_calls = Number(finished.creativeIntelligenceCalls || 0);
  report.generation_provider_calls = ledger.generationProviderCalls();
  report.job_generation_provider_calls = Number(finished.generationProviderCalls || 0);
  report.providerCallLog = ledger.calls;
  report.blockers = ledger.blockers;
  report.hookPlan = hookPlanAudit;
  report.scriptPlan = scriptPlanAudit;
  report.creditsSpent = finished.costPlan.spentCredits;
  report.finishedAt = new Date().toISOString();
  report.totalElapsedMs = Math.max(0, Date.parse(report.finishedAt) - Date.parse(report.startedAt));
  const ugcMediaCalls = (finished.tasks || [])
    .filter((task) => task.outputType === 'ugc_first_frame' || task.outputType === 'ugc_segment')
    .reduce((total, task) => total + Number(task.usage?.generationProviderCalls || 0), 0);
  const failureReasons = [];
  if (finished.status === 'failed') failureReasons.push('creative job failed');
  if (requireNoHolds && report.holds.length) failureReasons.push(`strict no-holds check found ${report.holds.length} QA hold(s)`);
  if (live && videoCount > 0) {
    if (hookPlanAudit.status !== 'selected') {
      failureReasons.push(`live UGC requires a selected Hook Plan; found ${hookPlanAudit.status || 'missing'}`);
    }
    if (!hookPlanAudit.persisted || hookPlanAudit.readbackError) {
      failureReasons.push(`live Hook Plan immutable readback failed${hookPlanAudit.readbackError ? `: ${hookPlanAudit.readbackError}` : ''}`);
    }
    if (hookPlanAudit.mode !== 'intelligence_plan') {
      failureReasons.push(`live UGC requires an intelligence_plan artifact; found ${hookPlanAudit.mode || 'missing'}`);
    }
    if (report.creative_intelligence_calls <= 0) {
      failureReasons.push('live Hook Plan recorded zero creative-intelligence calls');
    }
    if (hookPlanAudit.candidatePoolSize !== 8) {
      failureReasons.push(`live Hook Plan must persist exactly 8 candidates; found ${hookPlanAudit.candidatePoolSize}`);
    }
    if (hookPlanAudit.isolatedBlindReadCount < 8) {
      failureReasons.push(`live Hook Plan must persist at least 8 isolated blind reads; found ${hookPlanAudit.isolatedBlindReadCount}`);
    }
    if (!hookPlanAudit.planFingerprint || !hookPlanAudit.requestFingerprint || !hookPlanAudit.sourceFingerprint || !hookPlanAudit.policyFingerprint) {
      failureReasons.push('live Hook Plan is missing one or more immutable fingerprints');
    }
    if (hookPlanAudit.status !== 'selected' && ugcMediaCalls > 0) {
      failureReasons.push(`safety violation: ${ugcMediaCalls} live UGC media call(s) ran without a selected Hook Plan`);
    }
    if (scriptPlanAudit.status !== 'selected') failureReasons.push(`live UGC requires a selected Script Plan; found ${scriptPlanAudit.status || 'missing'}`);
    if (!scriptPlanAudit.persisted || scriptPlanAudit.readbackError) {
      failureReasons.push(`live Script Plan immutable readback failed${scriptPlanAudit.readbackError ? `: ${scriptPlanAudit.readbackError}` : ''}`);
    }
    if (scriptPlanAudit.mode !== 'intelligence_plan') failureReasons.push(`live UGC requires a Script Agent intelligence_plan artifact; found ${scriptPlanAudit.mode || 'missing'}`);
    if (scriptPlanAudit.selectedScriptCount !== videoCount) failureReasons.push(`live Script Plan must persist ${videoCount} selected script(s); found ${scriptPlanAudit.selectedScriptCount}`);
    if (!scriptPlanAudit.planFingerprint || !scriptPlanAudit.requestFingerprint || !scriptPlanAudit.sourceFingerprint || !scriptPlanAudit.hookPlanFingerprint) {
      failureReasons.push('live Script Plan is missing one or more immutable fingerprints');
    }
    if (scriptPlanAudit.status !== 'selected' && ugcMediaCalls > 0) {
      failureReasons.push(`safety violation: ${ugcMediaCalls} live UGC media call(s) ran without a selected Script Plan`);
    }
  }
  report.ugc_media_generation_provider_calls = ugcMediaCalls;
  report.failureReasons = failureReasons;
  report.status = failureReasons.length ? 'failed' : 'ok';
  await fs.writeFile(path.join(outDir, 'canary-report.json'), JSON.stringify(report, null, 2));

  console.log(`Rawified proof canary ${report.mode} finished: job ${report.jobId} -> ${report.jobStatus}`);
  console.log(`Report: ${path.join(outDir, 'canary-report.json')}`);
  console.log(`creative_intelligence_calls: ${report.creative_intelligence_calls}`);
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
  if (report.failureReasons.length) {
    console.log(`failures: ${report.failureReasons.join(' | ')}`);
  }
  process.exit(report.status === 'failed' ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(async (error) => {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'canary-error.log'), `${error.stack || error.message}\n`);
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
