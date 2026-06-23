#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ADAGENTIC_ROOT = process.env.ADAGENTIC_ROOT
  ? path.resolve(process.env.ADAGENTIC_ROOT)
  : path.resolve(REPO_ROOT, '..', 'AdAgentic');

const jobId = process.env.HYPERFRAMES_COPY_JOB_ID || 'gymlevels-seedance-adrenderer-v2';
const fps = 30;
const width = 720;
const height = 1280;
const durationFrames = 450;
const durationSeconds = durationFrames / fps;

const source = {
  propsPath: path.join(ADAGENTIC_ROOT, 'public', 'gymlevels-seedance-adrenderer-v1-props.json'),
  originalOutputPath: '/Users/missioncontrol/.mission-control/ceo-workers/marketing-paid-ads/tmp/seedance_adrenderer/gymlevels_seedance_adrenderer_v2.mp4',
  originalManifestPath: '/Users/missioncontrol/.mission-control/ceo-workers/marketing-paid-ads/tmp/seedance_adrenderer/gymlevels_seedance_adrenderer_v2_manifest.json',
};

const outputDir = path.join(REPO_ROOT, 'artifacts', 'adrenderer-hyperframes-copy', jobId);
const projectDir = path.join(outputDir, 'project');
const assetsDir = path.join(projectDir, 'assets');
const outputPath = path.join(outputDir, 'hyperframes-copy.mp4');
const contactSheetPath = path.join(outputDir, 'hyperframes-contact-sheet.jpg');
const originalContactSheetPath = path.join(outputDir, 'original-contact-sheet.jpg');
const comparisonContactSheetPath = path.join(outputDir, 'comparison-contact-sheet.jpg');
const firstFramePath = path.join(outputDir, 'first-frame.png');
const reportPath = path.join(outputDir, 'render-report.json');

async function main() {
  ensureFile(source.propsPath);
  ensureFile(source.originalOutputPath);
  const props = JSON.parse(readFileSync(source.propsPath, 'utf8'));
  const startedAt = new Date().toISOString();

  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'input-props.json'), JSON.stringify(props, null, 2) + '\n');
  await prepareAssets(props);
  await fs.writeFile(path.join(projectDir, 'index.html'), hyperframesHtml(props));

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
  await run('ffmpeg', [
    '-y',
    '-i',
    outputPath,
    '-vf',
    contactSheetFilter(),
    '-frames:v',
    '1',
    contactSheetPath,
  ], 'hyperframes contact sheet');
  await run('ffmpeg', [
    '-y',
    '-i',
    source.originalOutputPath,
    '-vf',
    contactSheetFilter(),
    '-frames:v',
    '1',
    originalContactSheetPath,
  ], 'original contact sheet');
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
  const originalProbe = await ffprobe(source.originalOutputPath);
  const ssim = await calculateSsim(source.originalOutputPath, outputPath);
  const outputHash = await sha256File(outputPath);
  const finishedAt = new Date().toISOString();

  const report = {
    jobId,
    status: 'pass',
    startedAt,
    finishedAt,
    renderer: 'HyperFrames 0.7.3',
    source,
    target: { width, height, fps, durationFrames, durationSeconds },
    command: shellCommand(command),
    elapsedMs,
    outputPath,
    contactSheetPath,
    originalContactSheetPath,
    comparisonContactSheetPath,
    firstFramePath,
    outputSha256: outputHash,
    provider_mutations: 0,
    lint: lintReport,
    inspectExitCode: inspect.code,
    renderStdoutTail: tail(render.stdout),
    renderStderrTail: tail(render.stderr),
    inputSummary: {
      baseVideoSrc: props.baseVideoSrc,
      textLayers: props.textLayers?.map((layer) => ({
        text: layer.text,
        startFrame: layer.startFrame,
        durationFrames: layer.durationFrames,
      })),
      overlays: props.overlays?.map((overlay) => ({
        assetSrc: overlay.assetSrc,
        startFrame: overlay.startFrame,
        durationFrames: overlay.durationFrames,
        animation: overlay.config?.animation,
      })),
      jumpCuts: props.jumpCuts,
      musicVolume: props.musicVolume,
    },
    checks: buildChecks({ lintReport, recreatedProbe, originalProbe }),
    metrics: {
      recreated: recreatedProbe,
      original: originalProbe,
      fileSizeBytes: Number((await fs.stat(outputPath)).size),
      ssim,
    },
  };
  report.status = report.checks.some((check) => check.verdict === 'fail') ? 'hold' : 'pass';
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`Report: ${reportPath}`);
  console.log(`Status: ${report.status}`);
  console.log(`Render: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Output: ${outputPath}`);
  console.log(`Comparison: ${comparisonContactSheetPath}`);
}

async function prepareAssets(props) {
  const baseSource = path.join(ADAGENTIC_ROOT, 'public', props.baseVideoSrc);
  ensureFile(baseSource);
  await run('ffmpeg', [
    '-y',
    '-i',
    baseSource,
    '-vf',
    `fps=${fps}`,
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
    '-b:a',
    '160k',
    path.join(assetsDir, 'base-video.mp4'),
  ], 'prepare dense base video');

  const assetNames = new Set((props.overlays || []).map((overlay) => overlay.assetSrc));
  for (const assetName of assetNames) {
    const sourcePath = path.join(ADAGENTIC_ROOT, 'public', assetName);
    ensureFile(sourcePath);
    await fs.copyFile(sourcePath, path.join(assetsDir, assetName));
  }
}

function hyperframesHtml(props) {
  const compositionId = `${jobId}-hyperframes-copy`;
  const textHtml = (props.textLayers || []).map((layer, index) => {
    const style = layer.style || {};
    return `
    <div
      id="text-layer-${index}"
      class="clip text-layer"
      data-start="0"
      data-duration="${durationSeconds}"
      data-track-index="${10 + index}"
      style="${styleAttr({
        top: `${layer.y ?? 35}%`,
        left: `${layer.x ?? 50}%`,
        width: `${layer.width ?? 90}%`,
        fontSize: `${style.fontSize ?? 72}px`,
        fontWeight: style.fontWeight ?? '900',
        color: style.color ?? '#FFFFFF',
        textShadow: style.textShadow ?? '0 4px 12px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8)',
        lineHeight: style.lineHeight ?? '1.15',
        textAlign: style.textAlign ?? 'center',
      })}"
    >${escapeHtml(layer.text)}</div>`;
  }).join('');

  const overlayHtml = (props.overlays || []).map((overlay, index) => {
    const config = overlay.config || {};
    const padding = Number(config.backdropPadding ?? 16);
    const backdropRadius = Number(config.backdropRadius ?? 20);
    return `
    <div
      id="overlay-${index}"
      class="clip overlay"
      data-start="0"
      data-duration="${durationSeconds}"
      data-track-index="${20 + index}"
      style="${styleAttr({
        left: `${Number(config.positionX ?? 50)}%`,
        top: `${Number(config.positionY ?? 52)}%`,
        width: `${Number(config.width ?? 320)}px`,
      })}"
    >
      ${config.backdropColor ? `<div class="overlay-backdrop" style="${styleAttr({
        top: `${-padding}px`,
        left: `${-padding}px`,
        right: `${-padding}px`,
        bottom: `${-padding}px`,
        backgroundColor: config.backdropColor,
        borderRadius: `${backdropRadius}px`,
      })}"></div>` : ''}
      <img src="assets/${escapeHtml(overlay.assetSrc)}" alt="">
    </div>`;
  }).join('');

  const flashHtml = (props.jumpCuts || []).map((cut, index) => `
    <div
      id="flash-${index}"
      class="clip flash"
      data-start="0"
      data-duration="${durationSeconds}"
      data-track-index="${30 + index}"
      data-layout-ignore
    ></div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width}, height=${height}">
  <title>${escapeHtml(jobId)} HyperFrames AdRenderer Copy</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #000;
      font-family: sans-serif;
    }
    #root {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #000;
      color: white;
    }
    #base-video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .text-layer {
      position: absolute;
      transform: translate(-50%, -50%);
      display: flex;
      justify-content: center;
      align-items: center;
      white-space: pre-wrap;
      opacity: 0;
      z-index: 20;
    }
    .overlay {
      position: absolute;
      transform: translate(-50%, -50%) scale(0.01);
      opacity: 0;
      filter: drop-shadow(0 12px 24px rgba(0,0,0,0.4));
      z-index: 18;
    }
    .overlay-backdrop {
      position: absolute;
      z-index: 0;
    }
    .overlay img {
      display: block;
      width: 100%;
      height: auto;
      position: relative;
      z-index: 1;
      filter: brightness(1.45) contrast(1.08) saturate(1.06);
    }
    .flash {
      position: absolute;
      inset: 0;
      background: #fff;
      opacity: 0;
      z-index: 40;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${escapeHtml(compositionId)}" data-start="0" data-width="${width}" data-height="${height}" data-duration="${durationSeconds}">
    <video id="base-video" class="clip" src="assets/base-video.mp4" muted playsinline data-start="0" data-duration="${durationSeconds}" data-track-index="0"></video>
    <audio id="base-audio" src="assets/base-video.mp4" data-start="0" data-duration="${durationSeconds}" data-track-index="1" data-volume="1"></audio>
${textHtml}
${overlayHtml}
${flashHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const FPS = ${fps};
    const tl = gsap.timeline({ paused: true });
    const frame = (value) => value / FPS;

${textTimeline(props.textLayers || [])}
${overlayTimeline(props.overlays || [])}
${flashTimeline(props.jumpCuts || [])}

    window.__timelines[${JSON.stringify(compositionId)}] = tl;
  </script>
</body>
</html>
`;
}

function textTimeline(layers) {
  return layers.map((layer, index) => {
    const start = layer.startFrame;
    const end = layer.startFrame + layer.durationFrames;
    return `    tl.set("#text-layer-${index}", { opacity: 1 }, frame(${start}));
    tl.set("#text-layer-${index}", { opacity: 0 }, frame(${end}));`;
  }).join('\n');
}

function overlayTimeline(overlays) {
  return overlays.map((overlay, index) => {
    const config = overlay.config || {};
    const start = overlay.startFrame;
    const end = overlay.startFrame + overlay.durationFrames;
    const exitStart = Math.max(start, end - 10);
    const startScale = Number(config.startScale ?? 0.9);
    const endScale = Number(config.endScale ?? 1);
    const animation = config.animation || 'pop-in';
    const selector = `#overlay-${index}`;
    const common = `    tl.set("${selector}", { opacity: 0, y: 0, scale: 0.01 }, 0);`;
    if (animation === 'slide-up') {
      return `${common}
    tl.set("${selector}", { opacity: 0, y: 80, scale: ${startScale} }, frame(${start}));
    tl.to("${selector}", { opacity: 1, duration: 0.12, ease: "none" }, frame(${start}));
    tl.to("${selector}", { y: 0, duration: 0.45, ease: "power3.out" }, frame(${start}));
    tl.to("${selector}", { scale: ${endScale}, duration: frame(${overlay.durationFrames}), ease: "none" }, frame(${start}));
    tl.to("${selector}", { opacity: 0, duration: frame(10), ease: "none" }, frame(${exitStart}));`;
    }
    if (animation === 'bounce') {
      return `${common}
    tl.set("${selector}", { opacity: 0, y: 0, scale: 0.3 }, frame(${start}));
    tl.to("${selector}", { opacity: 1, duration: 0.08, ease: "none" }, frame(${start}));
    tl.to("${selector}", { scale: ${startScale}, duration: 0.42, ease: "elastic.out(1, 0.55)" }, frame(${start}));
    tl.to("${selector}", { scale: ${endScale}, duration: frame(${Math.max(overlay.durationFrames - 13, 1)}), ease: "none" }, frame(${start + 13}));
    tl.to("${selector}", { opacity: 0, duration: frame(10), ease: "none" }, frame(${exitStart}));`;
    }
    if (animation === 'none') {
      return `${common}
    tl.set("${selector}", { opacity: 1, y: 0, scale: ${startScale} }, frame(${start}));
    tl.to("${selector}", { scale: ${endScale}, duration: frame(${overlay.durationFrames}), ease: "none" }, frame(${start}));
    tl.to("${selector}", { opacity: 0, duration: frame(10), ease: "none" }, frame(${exitStart}));`;
    }
    return `${common}
    tl.set("${selector}", { opacity: 0, y: 0, scale: 0.01 }, frame(${start}));
    tl.to("${selector}", { opacity: 1, duration: 0.1, ease: "none" }, frame(${start}));
    tl.to("${selector}", { scale: ${startScale}, duration: 0.38, ease: "back.out(1.7)" }, frame(${start}));
    tl.to("${selector}", { scale: ${endScale}, duration: frame(${Math.max(overlay.durationFrames - 12, 1)}), ease: "none" }, frame(${start + 12}));
    tl.to("${selector}", { opacity: 0, duration: frame(10), ease: "none" }, frame(${exitStart}));`;
  }).join('\n');
}

function flashTimeline(jumpCuts) {
  return jumpCuts.map((cut, index) => {
    const start = cut.frame;
    return `    tl.set("#flash-${index}", { opacity: 0 }, 0);
    tl.set("#flash-${index}", { opacity: 0 }, frame(${start}));
    tl.set("#flash-${index}", { opacity: 0.9 }, frame(${start + 1}));
    tl.to("#flash-${index}", { opacity: 0, duration: frame(3), ease: "none" }, frame(${start + 1}));`;
  }).join('\n');
}

function buildChecks({ lintReport, recreatedProbe, originalProbe }) {
  const recreatedVideo = recreatedProbe.streams.find((stream) => stream.codec_type === 'video');
  const originalVideo = originalProbe.streams.find((stream) => stream.codec_type === 'video');
  const recreatedDuration = Number(recreatedProbe.format.duration);
  const originalDuration = Number(originalProbe.format.duration);
  return [
    {
      id: 'hyperframes_lint',
      verdict: lintReport?.errorCount === 0 ? 'pass' : 'fail',
      observed: lintReport ? {
        ok: lintReport.ok,
        errorCount: lintReport.errorCount,
        warningCount: lintReport.warningCount,
        infoCount: lintReport.infoCount,
      } : null,
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
      verdict: Math.abs(recreatedDuration - durationSeconds) <= 0.12 ? 'pass' : 'fail',
      observed: Number(recreatedDuration.toFixed(3)),
      expected: durationSeconds,
    },
    {
      id: 'matches_original_shape',
      verdict: Number(originalVideo?.width) === width
        && Number(originalVideo?.height) === height
        && Math.abs(originalDuration - recreatedDuration) <= 0.18
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
      id: 'provider_mutations',
      verdict: 'pass',
      observed: 0,
      expected: 0,
    },
  ];
}

async function calculateSsim(originalPath, recreatedPath) {
  const result = await runAllowFailure('ffmpeg', [
    '-i',
    originalPath,
    '-i',
    recreatedPath,
    '-filter_complex',
    `[0:v]fps=${fps},scale=${width}:${height},setpts=PTS-STARTPTS[orig];[1:v]fps=${fps},scale=${width}:${height},setpts=PTS-STARTPTS[copy];[orig][copy]ssim`,
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

function contactSheetFilter() {
  const frames = [0, 4.7, 8.2, 11, 13.8]
    .map((seconds) => Math.min(Math.round(seconds * fps), durationFrames - 1));
  const selector = frames.map((frame) => `eq(n\\,${frame})`).join('+');
  return `select=${selector},scale=270:480,tile=5x1`;
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
