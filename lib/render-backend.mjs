/* RenderBackend: the finishing/composition layer.

   The finishing compositor owns everything factual in a final ad: real app
   screenshots (proof), captions, CTA, icon, timing, and the packaged output.
   Source generators only feed it layers. Backends are swappable behind one
   contract:

     backend.renderComposition({ task, inputAssets }) -> { asset, costUnits, providerMutations }

   Implementations:
   - createLocalFinishingBackend  — portable local/dev backend. Image ads are
     composited in-process (sharp). Video ads are rendered by the repo's
     HTML-composition renderer CLI (the same engine the hosted finishing
     service runs), never by ad-hoc media shell tools.
   - createHostedFinishingBackend — scaffold for the hosted finishing service
     (Cloud-hosted HTML-composition renderer). Validates configuration and
     speaks a generic submit/poll API; stays inert without credentials.

   Neutral by contract: asset records, task errors, and composition manifests
   never carry backend/provider names. Diagnostics go to workDir log files
   and the optional ledger. */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { probeMp4 } from './media-probe.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RENDERER_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'hyperframes');

export function createLocalFinishingBackend({
  assetStore,
  workDir,
  rendererBin = DEFAULT_RENDERER_BIN,
  ledger = null,
  renderTimeoutMs = 420_000,
  softwareRender = false,
  lowMemoryMode = false,
  renderWorkers = null,
} = {}) {
  if (!assetStore) throw new Error('Local finishing backend needs an asset store.');
  if (!workDir) throw new Error('Local finishing backend needs a workDir for render projects.');

  return {
    id: 'finishing-compositor-local',
    capability: 'finishing_compositor',
    live: true,
    async renderComposition({ task, inputAssets }) {
      const spec = task.renderSpec;
      if (!spec?.compositionKey || !spec?.outputKey) {
        throw new Error('Render task is missing its composition contract.');
      }
      await writeCompositionManifest({ assetStore, task, inputAssets });
      if (spec.format === 'image') {
        return composeImageAd({ assetStore, task, inputAssets });
      }
      return composeVideoAd({ assetStore, workDir, rendererBin, renderTimeoutMs, softwareRender, lowMemoryMode, renderWorkers, task, inputAssets, ledger });
    },
  };
}

export function createHostedFinishingBackend({ env = process.env, secretResolver, ledger = null } = {}) {
  const endpoint = String(env.MAA_FINISHING_API_URL || '').trim().replace(/\/$/, '');
  if (!endpoint) {
    throw new Error('Hosted finishing backend needs MAA_FINISHING_API_URL in the worker environment.');
  }
  if (typeof secretResolver !== 'function') {
    throw new Error('Hosted finishing backend needs a secretResolver({ purpose }) from the worker runtime.');
  }

  return {
    id: 'finishing-compositor-hosted',
    capability: 'finishing_compositor',
    live: true,
    async renderComposition({ task, inputAssets }) {
      const spec = task.renderSpec;
      const apiKey = await secretResolver({ purpose: 'finishing_render' });
      if (!apiKey) throw new Error('Finishing render credentials are not configured for this worker.');
      const submit = await fetch(`${endpoint}/v1/renders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          compositionKey: spec.compositionKey,
          variablesKey: spec.variablesKey,
          outputKey: spec.outputKey,
          fps: spec.fps || null,
          durationSeconds: spec.durationSeconds || null,
          dimensions: spec.dimensions,
          inputAssetIds: inputAssets.map((asset) => asset.assetId),
        }),
      });
      if (!submit.ok) {
        ledger?.recordBlocker?.({
          taskId: task.taskId,
          capability: 'finishing_compositor',
          stage: 'hosted_submit',
          detail: `Hosted finishing endpoint responded HTTP ${submit.status}.`,
        });
        throw new Error('Hosted finishing render was not accepted.');
      }
      throw new Error('Hosted finishing render polling is not wired in this environment yet.');
    },
  };
}

/* ---------- composition manifest (stored next to the render output) ---------- */

async function writeCompositionManifest({ assetStore, task, inputAssets }) {
  const spec = task.renderSpec;
  const composition = {
    schemaVersion: 'finishing-composition.v1',
    taskId: task.taskId,
    jobId: task.jobId,
    format: spec.format || 'video',
    dimensions: spec.dimensions,
    fps: spec.fps || null,
    durationSeconds: spec.durationSeconds || null,
    outputKey: spec.outputKey,
    timeline: spec.timeline,
    recipe: spec.recipe || null,
    script: spec.script || null,
    emotionPlan: spec.emotionPlan || null,
    captionStyle: spec.captionStyle || null,
    proofAudioPolicy: spec.proofAudioPolicy || null,
    renderManifest: spec.renderManifest || null,
    claimReferences: spec.claimReferences || [],
    inputAssets: inputAssets.map((asset) => ({
      assetId: asset.assetId,
      taskId: asset.taskId,
      kind: asset.kind,
      storageKey: asset.storageKey,
      checksum: asset.checksum || null,
    })),
    providerMutations: 0,
  };
  const variables = {
    schemaVersion: 'finishing-variables.v1',
    taskId: task.taskId,
    captions: (spec.timeline || []).filter((layer) => layer.type === 'caption').map((layer) => ({ id: layer.id, role: layer.role, text: layer.text, start: layer.start, duration: layer.duration })),
    cta: (spec.timeline || []).find((layer) => layer.type === 'cta')?.text || null,
    captionStyle: spec.captionStyle || null,
    recipeId: spec.recipe?.id || spec.renderManifest?.recipeId || null,
    providerMutations: 0,
  };
  await assetStore.putObject({ storageKey: spec.compositionKey, bytes: Buffer.from(JSON.stringify(composition, null, 2)), contentType: 'application/json' });
  await assetStore.putObject({ storageKey: spec.variablesKey, bytes: Buffer.from(JSON.stringify(variables, null, 2)), contentType: 'application/json' });
}

/* ---------- image finishing (in-process compositor) ---------- */

async function composeImageAd({ assetStore, task, inputAssets }) {
  const { default: sharp } = await import('sharp');
  const spec = task.renderSpec;
  const { width, height } = spec.dimensions;
  const timeline = spec.timeline || [];

  const backgroundLayer = timeline.find((layer) => layer.type === 'background_layer');
  const backgroundAsset = backgroundLayer
    ? inputAssets.find((asset) => asset.taskId === backgroundLayer.sourceTaskId)
    : inputAssets[0];
  if (!backgroundAsset) throw new Error('Image finishing needs a generated background layer.');
  if (!(await assetStore.exists(backgroundAsset.storageKey))) {
    throw new Error('Generated background layer is missing from storage.');
  }

  const proofLayer = timeline.find((layer) => layer.type === 'proof_media');
  if (!proofLayer?.storageKey) throw new Error('Image finishing needs a real app screenshot proof layer.');
  if (!(await assetStore.exists(proofLayer.storageKey))) {
    throw new Error('App screenshot proof is missing from storage.');
  }

  const background = await sharp(await assetStore.getObject(backgroundAsset.storageKey))
    .resize(width, height, { fit: 'cover' })
    .toBuffer();

  // Real screenshot proof panel: rounded phone-style panel, center-right.
  const panelWidth = Math.round(width * 0.46);
  const proofResized = sharp(await assetStore.getObject(proofLayer.storageKey)).resize(panelWidth, null, { fit: 'inside' });
  const proofMeta = await proofResized.clone().metadata();
  const panelHeight = Math.min(proofMeta.height || Math.round(panelWidth * 2.05), Math.round(height * 0.62));
  const cornerRadius = Math.round(panelWidth * 0.09);
  const proofPanel = await proofResized
    .resize(panelWidth, panelHeight, { fit: 'cover', position: 'top' })
    .composite([{
      input: Buffer.from(`<svg width="${panelWidth}" height="${panelHeight}"><rect x="0" y="0" width="${panelWidth}" height="${panelHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#fff"/></svg>`),
      blend: 'dest-in',
    }])
    .png()
    .toBuffer();
  const proofLeft = Math.round(width * 0.5);
  const proofTop = Math.round(height * 0.30);

  const headline = timeline.find((layer) => layer.type === 'caption' && layer.role === 'headline')?.text || '';
  const ctaText = timeline.find((layer) => layer.type === 'cta')?.text || '';
  const overlaySvg = buildImageOverlaySvg({ width, height, headline, ctaText, proofLeft, proofTop, panelWidth, panelHeight, cornerRadius });

  const composed = await sharp(background)
    .composite([
      { input: overlaySvg.shadow, left: 0, top: 0 },
      { input: proofPanel, left: proofLeft, top: proofTop },
      { input: overlaySvg.foreground, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  const stored = await assetStore.putObject({ storageKey: spec.outputKey, bytes: composed, contentType: 'image/png' });
  return {
    asset: {
      assetId: `${task.taskId}-asset`,
      taskId: task.taskId,
      jobId: task.jobId,
      packId: task.packId,
      orgId: task.orgId,
      workspaceId: task.workspaceId,
      appId: task.appId,
      kind: 'image_ad',
      storageKey: stored.storageKey,
      contentType: 'image/png',
      width,
      height,
      durationSeconds: null,
      bytes: stored.bytes,
      checksum: stored.checksum,
      mode: 'composited_render',
      inputAssetIds: inputAssets.map((asset) => asset.assetId),
      proofIds: [proofLayer.proofId].filter(Boolean),
      providerMutations: 0,
    },
    costUnits: task.costUnits,
    providerMutations: 0,
  };
}

function buildImageOverlaySvg({ width, height, headline, ctaText, proofLeft, proofTop, panelWidth, panelHeight, cornerRadius }) {
  const headlineLines = wrapText(headline, 18).slice(0, 3);
  const headlineSize = Math.round(width * 0.062);
  const headlineY = Math.round(height * 0.085);
  const headlineSvgLines = headlineLines
    .map((line, index) => `<text x="${Math.round(width * 0.055)}" y="${headlineY + index * Math.round(headlineSize * 1.18)}" font-family="Helvetica, Arial, sans-serif" font-size="${headlineSize}" font-weight="900" fill="#FFFFFF" stroke="#000000" stroke-opacity="0.35" stroke-width="2" paint-order="stroke">${escapeXml(line)}</text>`)
    .join('\n');

  const ctaHeight = Math.round(height * 0.058);
  const ctaWidth = Math.round(width * 0.6);
  const ctaX = Math.round((width - ctaWidth) / 2);
  const ctaY = Math.round(height * 0.9);
  const ctaFont = Math.round(ctaHeight * 0.46);
  const cta = ctaText
    ? `<rect x="${ctaX}" y="${ctaY}" width="${ctaWidth}" height="${ctaHeight}" rx="${Math.round(ctaHeight / 2)}" fill="#111111" fill-opacity="0.92"/>
       <text x="${width / 2}" y="${ctaY + Math.round(ctaHeight * 0.66)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${ctaFont}" font-weight="800" fill="#FFFFFF">${escapeXml(ctaText)}</text>`
    : '';

  const shadow = Buffer.from(`<svg width="${width}" height="${height}">
    <defs><filter id="blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="26"/></filter></defs>
    <rect x="${proofLeft + 10}" y="${proofTop + 22}" width="${panelWidth}" height="${panelHeight}" rx="${cornerRadius}" fill="#000000" fill-opacity="0.45" filter="url(#blur)"/>
  </svg>`);

  const foreground = Buffer.from(`<svg width="${width}" height="${height}">
    ${headlineSvgLines}
    ${cta}
  </svg>`);
  return { shadow, foreground };
}

/* ---------- video finishing (HTML-composition renderer CLI) ---------- */

async function composeVideoAd({ assetStore, workDir, rendererBin, renderTimeoutMs, softwareRender, lowMemoryMode, renderWorkers, task, inputAssets, ledger }) {
  const spec = task.renderSpec;
  const projectRoot = path.resolve(workDir, task.taskId);
  const projectDir = path.join(projectRoot, 'project');
  const assetsDir = path.join(projectDir, 'assets');
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const localAssets = await stageVideoAssets({ assetStore, spec, inputAssets, assetsDir });
  await fs.writeFile(path.join(projectDir, 'index.html'), buildVideoCompositionHtml({ task, spec, localAssets }));

  const lint = await runRenderer(rendererBin, ['lint', projectDir, '--json'], projectRoot, 'lint');
  const lintReport = parseJsonSafe(lint.stdout);
  await fs.writeFile(path.join(projectRoot, 'lint.json'), lint.stdout || lint.stderr || '{}');
  if (lintReport && lintReport.errorCount > 0) {
    ledger?.recordBlocker?.({ taskId: task.taskId, capability: 'finishing_compositor', stage: 'composition_lint', detail: `Composition lint reported ${lintReport.errorCount} error(s). See lint.json in the render workspace.` });
    throw new Error('Ad composition failed validation before render.');
  }

  const outputPath = path.join(projectRoot, 'output.mp4');
  const renderArgs = [
    'render', projectDir,
    '--output', outputPath,
    '--fps', String(spec.fps || 30),
    '--quality', lowMemoryMode ? 'draft' : 'standard',
    '--strict',
    '--browser-timeout', lowMemoryMode ? '600' : '240',
    '--protocol-timeout', lowMemoryMode ? '600000' : '300000',
    '--player-ready-timeout', '60000',
    ...(Number.isInteger(renderWorkers) && renderWorkers > 0 ? ['--workers', String(renderWorkers)] : []),
    ...(softwareRender ? ['--no-browser-gpu'] : []),
    ...(lowMemoryMode ? ['--low-memory-mode'] : []),
  ];
  const render = await runRenderer(rendererBin, renderArgs, projectRoot, 'render', { timeoutMs: renderTimeoutMs });
  await fs.writeFile(path.join(projectRoot, 'render.log'), `exit=${render.code}\n${render.stdout}\n${render.stderr}`);

  /* Success is judged by the output artifact, not the CLI exit code: the
     renderer sometimes exits nonzero during post-render cleanup after the
     file is fully written. A missing or unparseable file always fails. */
  const outputBytes = await fs.readFile(outputPath).catch(() => null);
  if (!outputBytes) {
    ledger?.recordBlocker?.({ taskId: task.taskId, capability: 'finishing_compositor', stage: 'render', detail: `Renderer exited ${render.code} with no output file. See render.log in the render workspace.` });
    throw new Error('Ad finishing render failed.');
  }
  const probe = probeMp4(outputBytes);
  if (!probe.ok) {
    ledger?.recordBlocker?.({ taskId: task.taskId, capability: 'finishing_compositor', stage: 'render', detail: `Renderer output did not parse as MP4 (${probe.reason}). Exit ${render.code}.` });
    throw new Error('Ad finishing render produced an invalid file.');
  }
  const stored = await assetStore.putObject({ storageKey: spec.outputKey, bytes: outputBytes, contentType: 'video/mp4' });

  return {
    asset: {
      assetId: `${task.taskId}-asset`,
      taskId: task.taskId,
      jobId: task.jobId,
      packId: task.packId,
      orgId: task.orgId,
      workspaceId: task.workspaceId,
      appId: task.appId,
      kind: 'ugc_ad',
      storageKey: stored.storageKey,
      contentType: 'video/mp4',
      width: probe.ok ? probe.width : spec.dimensions.width,
      height: probe.ok ? probe.height : spec.dimensions.height,
      durationSeconds: probe.ok ? Math.round(probe.durationSeconds * 100) / 100 : null,
      fps: spec.fps,
      bytes: stored.bytes,
      checksum: stored.checksum,
      mode: 'composited_render',
      mediaValidation: probe.ok ? 'parsed' : `unverified: ${probe.reason}`,
      inputAssetIds: inputAssets.map((asset) => asset.assetId),
      compositionLint: lintReport ? { errors: lintReport.errorCount ?? 0, warnings: lintReport.warningCount ?? 0 } : null,
      providerMutations: 0,
    },
    costUnits: task.costUnits,
    providerMutations: 0,
  };
}

async function stageVideoAssets({ assetStore, spec, inputAssets, assetsDir }) {
  const staged = { creator: new Map(), proof: new Map() };
  for (const layer of spec.timeline || []) {
    if (layer.type === 'creator_video') {
      const asset = inputAssets.find((candidate) => candidate.taskId === layer.sourceTaskId);
      if (!asset) throw new Error('A creator video layer is missing its source clip.');
      if (!(await assetStore.exists(asset.storageKey))) {
        throw new Error('A creator video source clip is missing from storage.');
      }
      const bytes = await assetStore.getObject(asset.storageKey);
      const probe = probeMp4(bytes);
      const fileName = `creator-${staged.creator.size + 1}.mp4`;
      await fs.writeFile(path.join(assetsDir, fileName), bytes);
      // Audio elements are only emitted for clips that really carry audio;
      // a silent clip would stall the renderer's audio extraction.
      staged.creator.set(layer.id, { fileName, hasAudio: Boolean(probe.ok && probe.hasAudio) });
    }
    if (layer.type === 'proof_media') {
      const storageKey = layer.storageKey;
      if (!storageKey || !(await assetStore.exists(storageKey))) {
        throw new Error('An app screenshot proof layer is missing from storage.');
      }
      const fileName = `proof-${staged.proof.size + 1}.png`;
      const bytes = await prepareVideoProofBytes({
        bytes: await assetStore.getObject(storageKey),
        layer,
      });
      await fs.writeFile(path.join(assetsDir, fileName), bytes);
      staged.proof.set(layer.id, { fileName, className: proofPanelClassName(layer) });
    }
  }
  return staged;
}

async function prepareVideoProofBytes({ bytes, layer }) {
  if (!shouldCropProofLayer(layer)) return bytes;
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) return bytes;
  const crop = cropRectForProofLayer({ layer, width: metadata.width, height: metadata.height });
  return sharp(bytes)
    .extract(crop)
    .png()
    .toBuffer();
}

function shouldCropProofLayer(layer) {
  const treatment = String(layer?.treatment || '').toLowerCase();
  return treatment === 'cropped-store-proof-overlay';
}

function cropRectForProofLayer({ layer, width, height }) {
  const relative = layer?.crop?.units === 'relative'
    ? layer.crop
    : { x: 0.19, y: 0.29, width: 0.62, height: 0.61 };
  const left = Math.round(width * clampRatio(relative.x, 0, 0.9));
  const top = Math.round(height * clampRatio(relative.y, 0, 0.9));
  const cropWidth = Math.round(width * clampRatio(relative.width, 0.1, 1));
  const cropHeight = Math.round(height * clampRatio(relative.height, 0.1, 1));
  return {
    left: Math.max(0, Math.min(width - 1, left)),
    top: Math.max(0, Math.min(height - 1, top)),
    width: Math.max(1, Math.min(width - Math.max(0, left), cropWidth)),
    height: Math.max(1, Math.min(height - Math.max(0, top), cropHeight)),
  };
}

function clampRatio(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function proofPanelClassName(layer) {
  const sourceType = String(layer?.sourceType || '').toLowerCase();
  const treatment = String(layer?.treatment || '').toLowerCase();
  return sourceType === 'rawified_store_art' || treatment === 'rawified-proof-overlay' || treatment === 'cropped-store-proof-overlay'
    ? 'clip proof-panel proof-rawified'
    : 'clip proof-panel';
}

/* House caption style: heavy white type, hard shadow, instant on/off (no
   animations). Clip visibility windows come from data-start/data-duration. */
function buildVideoCompositionHtml({ task, spec, localAssets }) {
  const { width, height } = spec.dimensions;
  const duration = spec.durationSeconds;
  const layers = [];
  let track = 2;

  for (const layer of spec.timeline || []) {
    const id = escapeHtml(layer.id);
    if (layer.type === 'creator_video') {
      const staged = localAssets.creator.get(layer.id);
      const audioElement = staged.hasAudio
        ? `
    <audio id="${id}-audio" class="clip" src="assets/${staged.fileName}" preload="auto" data-start="${layer.start}" data-duration="${layer.duration}" data-track-index="${track + 1}" data-volume="1"></audio>`
        : '';
      layers.push(`
    <video id="${id}" class="clip creator" src="assets/${staged.fileName}" muted playsinline preload="auto" data-start="${layer.start}" data-duration="${layer.duration}" data-track-index="${track}"></video>${audioElement}`);
      track += 2;
    } else if (layer.type === 'proof_media') {
      const staged = localAssets.proof.get(layer.id);
      layers.push(`
    <div id="${id}" class="${escapeHtml(staged.className)}" data-start="${layer.start}" data-duration="${layer.duration}" data-track-index="${track}">
      <img src="assets/${staged.fileName}" alt="">
    </div>`);
      track += 1;
    } else if (layer.type === 'caption') {
      layers.push(`
    <div id="${id}" class="clip caption caption-${escapeHtml(layer.role || 'body')}" data-start="${layer.start}" data-duration="${layer.duration}" data-track-index="${track}">${escapeHtml(layer.text)}</div>`);
      track += 1;
    } else if (layer.type === 'cta') {
      layers.push(`
    <div id="${id}" class="clip cta-pill" data-start="${layer.start}" data-duration="${layer.duration}" data-track-index="${track}">${escapeHtml(layer.text)}</div>`);
      track += 1;
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(task.taskId)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
    #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: linear-gradient(165deg, #101418 0%, #1c2530 55%, #0c0f13 100%); font-family: Arial, sans-serif; }
    .creator { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .proof-panel { position: absolute; left: 50%; top: 47%; transform: translate(-50%, -50%); width: ${Math.round(width * 0.66)}px; border-radius: ${Math.round(width * 0.045)}px; overflow: hidden; box-shadow: 0 22px 56px rgba(0,0,0,0.46); background: #000; }
    .proof-rawified { top: 50%; width: ${Math.round(width * 0.55)}px; border-radius: ${Math.round(width * 0.032)}px; box-shadow: 0 16px 42px rgba(0,0,0,0.45); background: transparent; }
    .proof-panel img { display: block; width: 100%; height: auto; }
    .caption { position: absolute; left: 50%; transform: translateX(-50%); width: 88%; text-align: center; color: #fff; font-weight: 900; font-size: ${Math.round(width * 0.067)}px; line-height: 1.14; text-shadow: 0 4px 12px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8); white-space: pre-wrap; }
    .caption-hook { top: 11%; }
    .caption-proof { top: 8%; }
    .caption-cta { top: 12%; font-size: ${Math.round(width * 0.058)}px; }
    .caption-reveal { bottom: 11%; font-size: ${Math.round(width * 0.055)}px; }
    .cta-pill { position: absolute; left: 50%; bottom: 9%; transform: translateX(-50%); padding: ${Math.round(width * 0.022)}px ${Math.round(width * 0.055)}px; border-radius: 999px; background: rgba(17,17,17,0.92); color: #fff; font-weight: 800; font-size: ${Math.round(width * 0.045)}px; text-shadow: none; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${escapeHtml(task.taskId)}" data-start="0" data-width="${width}" data-height="${height}" data-duration="${duration}">
${layers.join('\n')}
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    /* Static composition: clip windows come from data-start/data-duration.
       The runtime still requires a registered (paused) timeline spanning the
       composition, so register a no-op one. */
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to({ t: 0 }, { t: 1, duration: ${duration} }, 0);
    window.__timelines[${JSON.stringify(task.taskId)}] = tl;
  </script>
</body>
</html>
`;
}

/* ---------- helpers ---------- */

function runRenderer(bin, args, cwd, label, { timeoutMs = label === 'render' ? 420_000 : 60_000 } = {}) {
  return new Promise((resolve) => {
    // detached: the renderer signals its own process group during cleanup;
    // isolating it keeps the worker process alive.
    const child = spawn(bin, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      const message = `Renderer ${label} exceeded ${Math.round(timeoutMs / 1000)}s wall-clock timeout.`;
      try {
        process.kill(-child.pid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // Process group already exited.
          }
        }, 5_000).unref();
      } catch {
        child.kill('SIGTERM');
      }
      settle({ code: -2, stdout, stderr: `${stderr}\n${message}`, label, timedOut: true });
    }, timeoutMs);
    timer.unref();
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => settle({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, label }));
    child.on('close', (code) => settle({ code, stdout, stderr, label }));
  });
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function wrapText(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
