#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const sourceDir = process.env.PEPMOD_UGC_SOURCE_DIR
  ? path.resolve(process.env.PEPMOD_UGC_SOURCE_DIR)
  : '/Users/missioncontrol/.mission-control/shared-assets/creatives/generated-factory/_tmp/organic-youtube-pepmod-peptide-log-app-e2e-001-ugc-gcfv-37a07de707acdaac';

const jobId = process.env.HYPERFRAMES_PEPMOD_UGC_JOB_ID
  || 'pepmod-peptide-log-app-ugc-short-20260622';

const width = 1080;
const height = 1920;
const fps = 30;
const captionFontSource = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';

const source = {
  finalBrollPath: path.join(sourceDir, 'final_broll.mp4'),
  originalCaptionedPath: path.join(sourceDir, 'final_captioned.mp4'),
  seedanceMasterPath: path.join(sourceDir, 'seedance_master.mp4'),
  brollPlanPath: path.join(sourceDir, 'broll_edit_plan.json'),
};

const outputDir = path.join(REPO_ROOT, 'artifacts', 'pepmod-ugc-hyperframes-copy', jobId);
const projectDir = path.join(outputDir, 'project');
const assetsDir = path.join(projectDir, 'assets');
const outputPath = path.join(outputDir, 'hyperframes-copy.mp4');
const contactSheetPath = path.join(outputDir, 'hyperframes-contact-sheet.jpg');
const originalContactSheetPath = path.join(outputDir, 'original-remotion-contact-sheet.jpg');
const brollContactSheetPath = path.join(outputDir, 'input-broll-contact-sheet.jpg');
const comparisonContactSheetPath = path.join(outputDir, 'comparison-contact-sheet.jpg');
const firstFramePath = path.join(outputDir, 'first-frame.png');
const reportPath = path.join(outputDir, 'render-report.json');

async function main() {
  ensureFile(source.finalBrollPath);
  ensureFile(source.originalCaptionedPath);
  ensureFile(source.brollPlanPath);
  ensureFile(captionFontSource);

  const startedAt = new Date().toISOString();
  const brollPlan = JSON.parse(await fs.readFile(source.brollPlanPath, 'utf8'));
  const baseProbe = await ffprobe(source.finalBrollPath);
  const originalProbe = await ffprobe(source.originalCaptionedPath);
  const baseDurationSeconds = Number(baseProbe.format.duration);
  const durationFrames = Math.ceil(baseDurationSeconds * fps);
  const durationSeconds = durationFrames / fps;
  const captionPlan = buildCaptionPlan({ durationFrames });

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'input-broll-plan.json'), JSON.stringify(brollPlan, null, 2) + '\n');
  await fs.writeFile(path.join(outputDir, 'caption-plan.json'), JSON.stringify(captionPlan, null, 2) + '\n');

  await prepareBaseVideo();
  await fs.copyFile(captionFontSource, path.join(assetsDir, 'caption-bold.ttf'));
  await fs.writeFile(path.join(projectDir, 'index.html'), hyperframesHtml({ durationSeconds, durationFrames, captionPlan }));

  const hyperframesBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'hyperframes');
  const lint = await runAllowFailure(hyperframesBin, ['lint', projectDir, '--json'], 'hyperframes lint');
  await fs.writeFile(path.join(outputDir, 'lint.json'), lint.stdout || lint.stderr || '{}');
  const lintReport = parseJsonOrNull(lint.stdout);

  const inspect = await runAllowFailure(hyperframesBin, ['inspect', projectDir, '--json', '--samples', '12'], 'hyperframes inspect');
  await fs.writeFile(path.join(outputDir, 'inspect.json'), inspect.stdout || inspect.stderr || '{}');

  const command = [
    hyperframesBin,
    'render',
    projectDir,
    '--output',
    outputPath,
    '--fps',
    String(fps),
    '--quality',
    'standard',
    '--strict',
    '--browser-timeout',
    '180',
  ];
  const started = performance.now();
  const render = await run(command[0], command.slice(1), 'hyperframes render');
  const elapsedMs = Math.round(performance.now() - started);

  await run('ffmpeg', ['-y', '-i', outputPath, '-frames:v', '1', firstFramePath], 'first frame');
  await writeContactSheet(outputPath, contactSheetPath, durationFrames);
  await writeContactSheet(source.originalCaptionedPath, originalContactSheetPath, durationFrames);
  await writeContactSheet(source.finalBrollPath, brollContactSheetPath, durationFrames);
  await run('ffmpeg', [
    '-y',
    '-i',
    originalContactSheetPath,
    '-i',
    contactSheetPath,
    '-filter_complex',
    'vstack=inputs=2',
    comparisonContactSheetPath,
  ], 'comparison contact sheet');

  const recreatedProbe = await ffprobe(outputPath);
  const ssim = await calculateSsim(source.originalCaptionedPath, outputPath, durationSeconds);
  const outputHash = await sha256File(outputPath);
  const finishedAt = new Date().toISOString();
  const checks = buildChecks({
    lintReport,
    recreatedProbe,
    originalProbe,
    durationSeconds,
    ssim,
  });

  const report = {
    jobId,
    status: checks.some((check) => check.verdict === 'fail') ? 'hold' : 'pass',
    startedAt,
    finishedAt,
    renderer: 'HyperFrames 0.7.3',
    testFamily: 'pepmod_ugc_ad_renderer_caption_finish',
    source,
    target: { width, height, fps, durationFrames, durationSeconds },
    command: shellCommand(command),
    elapsedMs,
    outputPath,
    firstFramePath,
    contactSheetPath,
    originalContactSheetPath,
    brollContactSheetPath,
    comparisonContactSheetPath,
    outputSha256: outputHash,
    provider_mutations: 0,
    lint: lintReport,
    inspectExitCode: inspect.code,
    renderStdoutTail: tail(render.stdout),
    renderStderrTail: tail(render.stderr),
    captionPlan,
    inputSummary: {
      baseVideo: {
        path: source.finalBrollPath,
        role: 'PepMod UGC b-roll with proof cutaways and creator audio already baked in',
        durationSeconds: baseDurationSeconds,
      },
      remotionBaseline: {
        path: source.originalCaptionedPath,
        commentTag: originalProbe.format.tags?.comment ?? null,
      },
      proofCutaways: brollPlan.cutaways,
      proofCutawayAudioPolicy: brollPlan.audio_policy,
    },
    checks,
    metrics: {
      recreated: recreatedProbe,
      original: originalProbe,
      inputBroll: baseProbe,
      fileSizeBytes: Number((await fs.stat(outputPath)).size),
      ssim,
    },
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`Report: ${reportPath}`);
  console.log(`Status: ${report.status}`);
  console.log(`Render: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Output: ${outputPath}`);
  console.log(`Comparison: ${comparisonContactSheetPath}`);
}

function buildCaptionPlan({ durationFrames }) {
  const hookFrames = Math.min(durationFrames, Math.round(4 * fps));
  const ctaFrames = Math.min(durationFrames, Math.round(3 * fps));
  const ctaStartFrame = Math.max(
    hookFrames,
    durationFrames - ctaFrames - Math.round(0.5 * fps),
  );

  return {
    hook: {
      id: 'hook-caption',
      text: 'peptide log app\nfor records',
      startFrame: 0,
      durationFrames: hookFrames,
      x: 50,
      y: 18,
      width: 88,
      style: {
        fontSize: `${fontSizeFor('peptide log app\nfor records')}px`,
        fontWeight: '900',
        textAlign: 'center',
        lineHeight: '1.08',
        color: '#FFFFFF',
        fontFamily: '"PepModCaption", sans-serif',
        textShadow: '0 5px 16px rgba(0,0,0,0.95), 0 2px 5px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)',
      },
    },
    cta: {
      id: 'cta-caption',
      text: 'Try PepMod',
      startFrame: ctaStartFrame,
      durationFrames: ctaFrames,
      x: 50,
      y: 80,
      width: 88,
      style: {
        fontSize: `${ctaFontSizeFor('Try PepMod')}px`,
        fontWeight: '950',
        textAlign: 'center',
        lineHeight: '1.02',
        color: '#FFFFFF',
        fontFamily: '"PepModCaption", sans-serif',
        textShadow: '0 6px 18px rgba(0,0,0,0.98), 0 3px 7px rgba(0,0,0,0.98), 0 0 2px rgba(0,0,0,1)',
      },
    },
  };
}

async function prepareBaseVideo() {
  await run('ffmpeg', [
    '-y',
    '-i',
    source.finalBrollPath,
    '-vf',
    `fps=${fps},scale=${width}:${height}:flags=lanczos`,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(fps),
    '-keyint_min',
    String(fps),
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-b:a',
    '256k',
    path.join(assetsDir, 'base-video.mp4'),
  ], 'prepare dense PepMod b-roll');
}

function hyperframesHtml({ durationSeconds, durationFrames, captionPlan }) {
  const compositionId = `${jobId}-hyperframes-copy`;
  const layers = [captionPlan.hook, captionPlan.cta];
  const textHtml = layers.map((layer, index) => `
    <div
      id="${escapeHtml(layer.id)}"
      class="clip text-layer"
      data-start="0"
      data-duration="${durationSeconds}"
      data-track-index="${10 + index}"
      style="${styleAttr({
        top: `${layer.y}%`,
        left: `${layer.x}%`,
        width: `${layer.width}%`,
      })}"
    >
      <div class="text-content" style="${styleAttr(layer.style)}">${escapeHtml(layer.text)}</div>
    </div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width}, height=${height}">
  <title>${escapeHtml(jobId)} HyperFrames PepMod UGC Copy</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    @font-face {
      font-family: "PepModCaption";
      src: url("assets/caption-bold.ttf") format("truetype");
      font-weight: 700 950;
      font-style: normal;
      font-display: block;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #000;
      font-family: "PepModCaption", sans-serif;
    }
    #root {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #000;
      color: #fff;
    }
    #base-video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 0;
    }
    .text-layer {
      position: absolute;
      transform: translate(-50%, -50%);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      z-index: 20;
      pointer-events: none;
    }
    .text-content {
      width: 100%;
      white-space: pre-wrap;
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${escapeHtml(compositionId)}" data-start="0" data-width="${width}" data-height="${height}" data-duration="${durationSeconds}">
    <video id="base-video" class="clip" src="assets/base-video.mp4" muted playsinline preload="auto" data-start="0" data-duration="${durationSeconds}" data-track-index="0"></video>
    <audio id="base-audio" src="assets/base-video.mp4" preload="auto" data-start="0" data-duration="${durationSeconds}" data-track-index="1" data-volume="1"></audio>
${textHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const FPS = ${fps};
    const tl = gsap.timeline({ paused: true });
    const frame = (value) => value / FPS;

${textTimeline(layers, durationFrames)}

    window.__timelines[${JSON.stringify(compositionId)}] = tl;
  </script>
</body>
</html>
`;
}

function textTimeline(layers) {
  return layers.map((layer) => {
    const endFrame = layer.startFrame + layer.durationFrames;
    return `    tl.set("#${layer.id}", { opacity: 1 }, frame(${layer.startFrame}));
    tl.set("#${layer.id}", { opacity: 0 }, frame(${endFrame}));`;
  }).join('\n');
}

async function writeContactSheet(videoPath, imagePath, durationFrames) {
  const sampleFrames = [0, 60, 126, 150, 210, 270, 360, 425]
    .map((frame) => Math.min(frame, durationFrames - 1));
  const selector = sampleFrames.map((frame) => `eq(n\\,${frame})`).join('+');
  await run('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-vf',
    `select=${selector},scale=216:384,tile=8x1`,
    '-frames:v',
    '1',
    '-update',
    '1',
    imagePath,
  ], `contact sheet ${path.basename(videoPath)}`);
}

function buildChecks({ lintReport, recreatedProbe, originalProbe, durationSeconds, ssim }) {
  const recreatedVideo = recreatedProbe.streams.find((stream) => stream.codec_type === 'video');
  const originalVideo = originalProbe.streams.find((stream) => stream.codec_type === 'video');
  const recreatedDuration = Number(recreatedProbe.format.duration);
  const originalDuration = Number(originalProbe.format.duration);
  const lintOk = lintReport?.errorCount === 0 && lintReport?.warningCount === 0;

  return [
    {
      id: 'hyperframes_lint',
      verdict: lintOk ? 'pass' : 'fail',
      observed: lintReport ? {
        ok: lintReport.ok,
        errorCount: lintReport.errorCount,
        warningCount: lintReport.warningCount,
        infoCount: lintReport.infoCount,
      } : null,
      expected: { errorCount: 0, warningCount: 0 },
    },
    {
      id: 'dimensions',
      verdict: Number(recreatedVideo?.width) === width && Number(recreatedVideo?.height) === height ? 'pass' : 'fail',
      observed: { width: recreatedVideo?.width, height: recreatedVideo?.height },
      expected: { width, height },
    },
    {
      id: 'fps',
      verdict: Math.abs(parseFps(recreatedVideo?.avg_frame_rate) - fps) < 0.05 ? 'pass' : 'fail',
      observed: parseFps(recreatedVideo?.avg_frame_rate),
      expected: fps,
    },
    {
      id: 'duration',
      verdict: Math.abs(recreatedDuration - durationSeconds) <= 0.18 ? 'pass' : 'fail',
      observed: Number(recreatedDuration.toFixed(3)),
      expected: durationSeconds,
    },
    {
      id: 'matches_remotion_shape',
      verdict: Number(originalVideo?.width) === width
        && Number(originalVideo?.height) === height
        && Math.abs(originalDuration - recreatedDuration) <= 0.22
        ? 'pass'
        : 'fail',
      observed: {
        originalWidth: originalVideo?.width,
        originalHeight: originalVideo?.height,
        originalDuration: Number(originalDuration.toFixed(3)),
        recreatedDuration: Number(recreatedDuration.toFixed(3)),
      },
    },
    {
      id: 'visual_similarity_ssim',
      verdict: ssim.ok && Number(ssim.all) >= 0.9 ? 'pass' : 'fail',
      observed: ssim.all,
      expected: '>=0.9',
    },
    {
      id: 'provider_mutations',
      verdict: 'pass',
      observed: 0,
      expected: 0,
    },
  ];
}

async function calculateSsim(originalPath, recreatedPath, durationSeconds) {
  const result = await runAllowFailure('ffmpeg', [
    '-i',
    originalPath,
    '-i',
    recreatedPath,
    '-filter_complex',
    `[0:v]fps=${fps},scale=${width}:${height},trim=duration=${durationSeconds},setpts=PTS-STARTPTS[orig];[1:v]fps=${fps},scale=${width}:${height},trim=duration=${durationSeconds},setpts=PTS-STARTPTS[copy];[orig][copy]ssim`,
    '-f',
    'null',
    '-',
  ], 'ffmpeg ssim');
  const text = `${result.stdout}\n${result.stderr}`;
  const match = text.match(/All:([0-9.]+)/);
  return {
    ok: result.code === 0,
    all: match ? Number(match[1]) : null,
    tail: tail(text),
  };
}

async function ffprobe(filePath) {
  const result = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], `ffprobe ${path.basename(filePath)}`);
  return JSON.parse(result.stdout);
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const bytes = await fs.readFile(filePath);
  hash.update(bytes);
  return hash.digest('hex');
}

function fontSizeFor(text) {
  const flat = text.replace(/\n/g, ' ');
  if (flat.length <= 34) return 76;
  if (flat.length <= 48) return 68;
  return 60;
}

function ctaFontSizeFor(text) {
  const flat = text.replace(/\n/g, ' ');
  if (flat.length <= 22) return 82;
  if (flat.length <= 36) return 74;
  return 66;
}

function styleAttr(style) {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${toKebab(key)}: ${escapeAttribute(value)};`)
    .join(' ');
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function parseFps(value) {
  if (!value || !value.includes('/')) return Number(value || 0);
  const [num, den] = value.split('/').map(Number);
  return den ? num / den : 0;
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function ensureFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

function shellCommand(parts) {
  return parts.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
}

function tail(text, lines = 30) {
  return text.split('\n').slice(-lines).join('\n').trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

async function run(command, args, label) {
  const result = await runAllowFailure(command, args, label);
  if (result.code !== 0) {
    throw new Error(`${label} failed with exit code ${result.code}\n${tail(result.stderr || result.stdout)}`);
  }
  return result;
}

function runAllowFailure(command, args, label) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr, label }));
  });
}

main().catch(async (error) => {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'render-error.log'), `${error.stack || error.message}\n`);
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
