#!/usr/bin/env node
/* Rawification canary for store-listing screenshots.
 *
 * This validates the intended order:
 *   source.classified -> proof.rawified -> ui.extraction-ready
 *
 * Live mode performs one image-model edit from a real store-art screenshot into
 * a raw app-screen candidate. It does not approve the asset or unlock proof-led
 * generation; the output still needs preservation QA/user review.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { createGeminiMediaClient } from '../lib/providers/gemini-media.mjs';
import { probeImage } from '../lib/media-probe.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_SERVICE = 'mobileadagent-gemini-api-key';
const DEFAULT_SOURCE_CANDIDATES = [
  'artifacts/live-generation-canary/2026-07-09T-gymlevels-system-proof-v5/assets/orgs/org-bad2ea52/workspaces/ws-default/apps/gymlevels-ranked-gym-workouts/source/gymlevels-ranked-gym-workouts-screen-1',
  'artifacts/live-generation-canary/2026-07-09T-shared-first-frame-gymlevels-v4/assets/orgs/org-bad2ea52/workspaces/ws-default/apps/gymlevels-ranked-gym-workouts/source/gymlevels-ranked-gym-workouts-screen-1',
  'artifacts/live-generation-canary/2026-07-08T21-38-38-442Z/assets/orgs/org-bad2ea52/workspaces/ws-default/apps/gymlevels-ranked-gym-workouts/source/gymlevels-ranked-gym-workouts-screen-1',
];

const args = process.argv.slice(2);
const live = args.includes('--live');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(valueArg(args, '--out') || path.join(REPO_ROOT, 'artifacts', 'rawification-canary', timestamp));
const model = valueArg(args, '--model') || null;
const sourcePath = await resolveSourcePath(valueArg(args, '--source'));

function valueArg(list, flag) {
  const index = list.indexOf(flag);
  return index >= 0 ? list[index + 1] : null;
}

async function resolveSourcePath(value) {
  if (value) return path.resolve(value);
  for (const candidate of DEFAULT_SOURCE_CANDIDATES) {
    const fullPath = path.join(REPO_ROOT, candidate);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // Keep looking.
    }
  }
  throw new Error('No default GymLevels store screenshot found. Pass --source /path/to/store-screenshot.');
}

function readGenerationSecret() {
  const injected = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (injected) return injected;
  const value = execFileSync('security', ['find-generic-password', '-s', VAULT_SERVICE, '-w'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  }).trim();
  if (!value) throw new Error('Vault returned an empty generation key.');
  return value;
}

const calls = [];
await fs.mkdir(outDir, { recursive: true });

const sourceBytes = await fs.readFile(sourcePath);
const sourceProbe = probeImage(sourceBytes);
if (!sourceProbe.ok) {
  throw new Error(`Source image is not a supported PNG/JPEG file: ${sourceProbe.reason}`);
}

const sourceMimeType = sourceProbe.container === 'jpeg' ? 'image/jpeg' : 'image/png';
const sourceExt = sourceProbe.container === 'jpeg' ? 'jpg' : 'png';
const sourceCopyPath = path.join(outDir, `source-store-art.${sourceExt}`);
await fs.writeFile(sourceCopyPath, sourceBytes);

let rawifiedPath = null;
let rawifiedProbe = null;
let generated = null;

if (live) {
  const client = createGeminiMediaClient({
    apiKey: readGenerationSecret(),
    timeoutMs: 180_000,
    onCall: (entry) => calls.push({ ...entry, at: new Date().toISOString() }),
  });

  generated = await client.generateImage({
    model,
    aspectRatio: '9:16',
    inputImages: [{ bytes: sourceBytes, mimeType: sourceMimeType }],
    prompt: rawificationPrompt(),
  });

  rawifiedProbe = probeImage(generated.bytes);
  const rawifiedExt = (generated.mimeType || '').includes('jpeg') || (generated.mimeType || '').includes('jpg') ? 'jpg' : 'png';
  rawifiedPath = path.join(outDir, `rawified-candidate.${rawifiedExt}`);
  await fs.writeFile(rawifiedPath, generated.bytes);
} else {
  calls.push({ kind: 'metadata', label: 'rawification.generate:dry-run', method: 'POST', status: 'skipped', at: new Date().toISOString() });
}

const contactSheetPath = rawifiedPath
  ? path.join(outDir, 'rawification-contact-sheet.jpg')
  : null;
if (contactSheetPath) {
  await makeContactSheet({
    sourcePath: sourceCopyPath,
    rawifiedPath,
    outPath: contactSheetPath,
  });
}

const report = {
  schemaVersion: 'rawification-canary.v1',
  createdAt: new Date().toISOString(),
  mode: live ? 'live' : 'dry_run',
  source: {
    path: path.relative(REPO_ROOT, sourcePath),
    copiedTo: path.relative(REPO_ROOT, sourceCopyPath),
    sourceType: 'store_art',
    extractionStage: 'pre_rawification',
    requiresRawificationBeforeUiExtraction: true,
    probe: sourceProbe,
  },
  output: rawifiedPath
    ? {
      path: path.relative(REPO_ROOT, rawifiedPath),
      contactSheetPath: path.relative(REPO_ROOT, contactSheetPath),
      sourceType: 'rawified_store_art',
      extractionStage: 'proof.rawified',
      uiExtractionReady: true,
      requiresPreservationQaBeforeApproval: true,
      mimeType: generated?.mimeType || null,
      model: generated?.model || null,
      probe: rawifiedProbe,
    }
    : null,
  stageSequence: [
    'source.classified',
    live ? 'proof.rawified' : 'proof.rawification.skipped',
    live ? 'ui.extraction.ready_pending_preservation_qa' : 'ui.extraction.blocked_until_rawification',
  ],
  qa: {
    status: live ? 'manual_review_required' : 'not_run',
    notes: live
      ? [
        'Confirm marketing headline, device frame, and decorative background are removed.',
        'Confirm the remaining screen is a plausible raw app screenshot.',
        'Confirm visible UI text/layout was preserved closely enough before feeding UI extraction.',
      ]
      : ['Run with --live to generate a rawified candidate.'],
  },
  generationProviderCalls: calls.filter((call) => call.kind === 'generation').length,
  providerMutations: 0,
  calls: calls.map(({ kind, label, method, status, at }) => ({ kind, label, method, status, at })),
};

const reportPath = path.join(outDir, 'rawification-report.json');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  mode: report.mode,
  outDir: path.relative(REPO_ROOT, outDir),
  source: report.source.copiedTo,
  rawified: report.output?.path || null,
  contactSheet: report.output?.contactSheetPath || null,
  generationProviderCalls: report.generationProviderCalls,
  providerMutations: report.providerMutations,
}, null, 2));

function rawificationPrompt() {
  return [
    'Transform the provided App Store marketing screenshot into one clean raw mobile app screenshot candidate for product-proof UI extraction.',
    '',
    'Keep only the actual in-phone app UI that is visible in the source image.',
    'Remove marketing headline text, App Store poster copy, decorative background, device bezel/mockup frame, shadows, glows, badges, floating labels, mockup hands, and any non-app elements.',
    'Output a vertical full-screen app screenshot crop that looks like it was captured from the app itself.',
    'Preserve the real visible app UI layout, colors, screen hierarchy, words, numbers, labels, buttons, and navigation as closely as possible.',
    'Do not invent a new screen, new features, new ratings, new prices, new testimonials, new user data, or new claims.',
    'Do not add captions, ad copy, app-store badges, borders, phone bezels, or decorative backgrounds.',
    'If some source UI is obscured or too small, keep the output conservative and faithful to what is visible rather than filling in unsupported details.',
  ].join('\n');
}

async function makeContactSheet({ sourcePath: leftPath, rawifiedPath: rightPath, outPath }) {
  const panels = await Promise.all([
    makePanel({ imagePath: leftPath, label: 'SOURCE STORE ART' }),
    makePanel({ imagePath: rightPath, label: 'RAWIFIED CANDIDATE' }),
  ]);
  const gap = 36;
  const margin = 36;
  const width = panels.reduce((sum, panel) => sum + panel.width, margin * 2 + gap);
  const height = Math.max(...panels.map((panel) => panel.height)) + margin * 2;
  const composites = [];
  let x = margin;
  for (const panel of panels) {
    composites.push({ input: panel.bytes, top: margin, left: x });
    x += panel.width + gap;
  }
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#141414',
    },
  })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(outPath);
}

async function makePanel({ imagePath, label }) {
  const labelHeight = 58;
  const resized = await sharp(imagePath)
    .rotate()
    .resize({ width: 560, height: 1000, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const imageMeta = await sharp(resized).metadata();
  const panelWidth = Math.max(560, imageMeta.width || 560);
  const panelHeight = labelHeight + (imageMeta.height || 1000);
  const labelSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#f2f0ea"/>
      <text x="22" y="37" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#181818">${escapeXml(label)}</text>
    </svg>
  `);
  const imageLeft = Math.round((panelWidth - (imageMeta.width || panelWidth)) / 2);
  const panel = await sharp({
    create: {
      width: panelWidth,
      height: panelHeight,
      channels: 3,
      background: '#242424',
    },
  })
    .composite([
      { input: labelSvg, top: 0, left: 0 },
      { input: resized, top: labelHeight, left: imageLeft },
    ])
    .png()
    .toBuffer();
  return { bytes: panel, width: panelWidth, height: panelHeight };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
