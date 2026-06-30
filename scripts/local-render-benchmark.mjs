#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_JOB_ID = 'local-benchmark-001';
const ADAGENTIC_ROOT = process.env.ADAGENTIC_ROOT
  ? path.resolve(process.env.ADAGENTIC_ROOT)
  : path.resolve(REPO_ROOT, '..', 'AdAgentic');

const jobId = process.env.BENCHMARK_JOB_ID || DEFAULT_JOB_ID;
const artifactsRoot = path.join(REPO_ROOT, 'artifacts', 'local-render-benchmark', jobId);
const inputDir = path.join(artifactsRoot, 'input');
const hyperframesDir = path.join(artifactsRoot, 'hyperframes');
const hyperframesProjectDir = path.join(hyperframesDir, 'project');
const remotionDir = path.join(artifactsRoot, 'remotion-adrenderer');
const remotionPublicDir = path.join(remotionDir, 'public');
const reportPath = path.join(artifactsRoot, 'benchmark-report.json');

const spec = {
  jobId,
  app: {
    name: 'BenchFit',
    iconPath: path.join(inputDir, 'app-icon.png'),
    brandColors: ['#0F172A', '#22D3EE', '#F97316'],
  },
  creative: {
    format: 'ugc_video_ad',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 15,
    hook: 'Stop tracking this in Notes',
    cta: 'Download BenchFit',
    proofCaption: 'Real app proof',
    voiceoverText: 'Stop tracking this in Notes. BenchFit keeps every lift organized.',
  },
  proof: {
    screenshots: [path.join(inputDir, 'app-screenshot.png')],
    proofObjects: [path.join(inputDir, 'proof-card.png')],
  },
  render: {
    musicPath: null,
    safeArea: 'paid-social-9x16',
    thumbnailFirstFrameDurationMs: 200,
  },
};

const rendererConfigs = [
  {
    id: 'hyperframes',
    versionCommand: [path.join(REPO_ROOT, 'node_modules', '.bin', 'hyperframes'), '--version'],
    outputPath: path.join(hyperframesDir, 'output.mp4'),
    commandLabel: 'hyperframes render',
  },
  {
    id: 'remotion-adrenderer',
    outputPath: path.join(remotionDir, 'output.mp4'),
    commandLabel: 'AdAgentic Remotion AdRenderer via @remotion/renderer',
  },
];

async function main() {
  const startedAt = new Date().toISOString();
  await ensureFixture();
  await fs.writeFile(path.join(inputDir, 'spec.json'), JSON.stringify(spec, null, 2) + '\n');

  const renderResults = [];
  renderResults.push(await renderHyperframes());
  renderResults.push(await renderRemotionAdRenderer());

  const qaResults = [];
  for (const renderer of rendererConfigs) {
    const result = renderResults.find((item) => item.renderer === renderer.id);
    qaResults.push(await qaRenderer(renderer, result));
  }

  const finishedAt = new Date().toISOString();
  const report = {
    jobId,
    status: qaResults.every((qa) => qa.verdict === 'pass') ? 'pass' : 'hold',
    startedAt,
    finishedAt,
    specPath: path.join(inputDir, 'spec.json'),
    safety: {
      generationOnly: true,
      provider_mutations: 0,
      live_ad_automation_touched: false,
      sourced_creatives_written: false,
    },
    renderers: qaResults,
    recommendation: buildRecommendation(qaResults),
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  printSummary(report);
}

async function ensureFixture() {
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(hyperframesDir, { recursive: true });
  await fs.mkdir(remotionDir, { recursive: true });

  await renderSvg(path.join(inputDir, 'app-icon.png'), appIconSvg(), 512, 512);
  await renderSvg(path.join(inputDir, 'app-screenshot.png'), appScreenshotSvg(), 900, 1600);
  await renderSvg(path.join(inputDir, 'proof-card.png'), proofCardSvg(), 900, 460);
  await ensureBaseVideo(path.join(inputDir, 'base-video.mp4'));
}

async function renderSvg(outputPath, svg, width, height) {
  await sharp(Buffer.from(svg)).resize(width, height).png().toFile(outputPath);
}

async function ensureBaseVideo(outputPath) {
  await fs.rm(outputPath, { force: true });

  const { width, height, fps, durationSeconds } = spec.creative;
  const filter = [
    `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSeconds}`,
    'format=yuv420p',
  ].join(',');
  await run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    filter,
    '-vf',
    'hue=s=0.35,eq=brightness=-0.08:contrast=1.12',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '26',
    '-r',
    String(fps),
    '-g',
    String(fps),
    '-keyint_min',
    String(fps),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ], { label: 'fixture base video' });
}

async function renderHyperframes() {
  const renderer = 'hyperframes';
  const outputPath = path.join(hyperframesDir, 'output.mp4');
  await fs.rm(hyperframesProjectDir, { recursive: true, force: true });
  await fs.mkdir(path.join(hyperframesProjectDir, 'assets'), { recursive: true });
  await copyInputAssets(path.join(hyperframesProjectDir, 'assets'));
  await fs.writeFile(path.join(hyperframesProjectDir, 'index.html'), hyperframesHtml());

  const hyperframesBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'hyperframes');
  const lint = await runAllowFailure(hyperframesBin, ['lint', hyperframesProjectDir, '--json'], {
    label: 'hyperframes lint',
  });
  await fs.writeFile(path.join(hyperframesDir, 'lint.json'), lint.stdout || lint.stderr || '{}');
  const lintReport = parseJsonOrNull(lint.stdout);

  const inspect = await runAllowFailure(hyperframesBin, ['inspect', hyperframesProjectDir, '--json', '--samples', '9'], {
    label: 'hyperframes inspect',
  });
  await fs.writeFile(path.join(hyperframesDir, 'inspect.json'), inspect.stdout || inspect.stderr || '{}');

  const command = [
    hyperframesBin,
    'render',
    hyperframesProjectDir,
    '--output',
    outputPath,
    '--fps',
    String(spec.creative.fps),
    '--quality',
    'standard',
    '--strict',
    '--browser-timeout',
    '180',
  ];

  const started = performance.now();
  const render = await run(command[0], command.slice(1), { label: 'hyperframes render' });
  const elapsedMs = Math.round(performance.now() - started);

  const metadata = {
    renderer,
    rendererVersion: await getCommandVersion(hyperframesBin, ['--version']),
    command: shellCommand(command),
    projectDir: hyperframesProjectDir,
    lintExitCode: lint.code,
    lintReport,
    inspectExitCode: inspect.code,
    elapsedMs,
    stdoutTail: tail(render.stdout),
    stderrTail: tail(render.stderr),
  };

  await fs.writeFile(path.join(hyperframesDir, 'render-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { renderer, ok: true, outputPath, elapsedMs, metadata };
}

async function renderRemotionAdRenderer() {
  const renderer = 'remotion-adrenderer';
  const outputPath = path.join(remotionDir, 'output.mp4');
  await fs.rm(remotionPublicDir, { recursive: true, force: true });
  await fs.mkdir(remotionPublicDir, { recursive: true });
  await copyInputAssets(remotionPublicDir);

  const entryPoint = path.join(ADAGENTIC_ROOT, 'src', 'remotion', 'index.tsx');
  const packageJson = path.join(ADAGENTIC_ROOT, 'package.json');
  if (!existsSync(entryPoint) || !existsSync(packageJson)) {
    throw new Error(`Missing AdAgentic Remotion baseline at ${ADAGENTIC_ROOT}`);
  }

  const adAgenticRequire = createRequire(packageJson);
  const bundlerPath = adAgenticRequire.resolve('@remotion/bundler');
  const rendererPath = adAgenticRequire.resolve('@remotion/renderer');
  const { bundle } = await import(pathToFileURL(bundlerPath).href);
  const { renderMedia, selectComposition } = await import(pathToFileURL(rendererPath).href);

  const inputProps = remotionProps();
  await fs.writeFile(path.join(remotionDir, 'adrenderer-props.json'), JSON.stringify(inputProps, null, 2) + '\n');

  const started = performance.now();
  const bundled = await bundle({
    entryPoint,
    publicDir: remotionPublicDir,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        extensionAlias: {
          '.js': ['.tsx', '.ts', '.js'],
        },
      },
    }),
  });

  const composition = await selectComposition({
    serveUrl: bundled,
    id: 'AdRenderer',
    inputProps,
  });
  composition.durationInFrames = spec.creative.durationSeconds * spec.creative.fps;
  composition.width = spec.creative.width;
  composition.height = spec.creative.height;

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    crf: 22,
    concurrency: 1,
    logLevel: 'warn',
  });
  const elapsedMs = Math.round(performance.now() - started);

  const metadata = {
    renderer,
    rendererVersion: getAdAgenticPackageVersion('@remotion/renderer'),
    command: 'bundle/selectComposition/renderMedia against AdAgentic src/remotion/index.tsx#AdRenderer',
    adAgenticRoot: ADAGENTIC_ROOT,
    elapsedMs,
  };
  await fs.writeFile(path.join(remotionDir, 'render-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { renderer, ok: true, outputPath, elapsedMs, metadata };
}

async function copyInputAssets(targetDir) {
  await fs.copyFile(path.join(inputDir, 'base-video.mp4'), path.join(targetDir, 'base-video.mp4'));
  await fs.copyFile(path.join(inputDir, 'app-icon.png'), path.join(targetDir, 'app-icon.png'));
  await fs.copyFile(path.join(inputDir, 'app-screenshot.png'), path.join(targetDir, 'app-screenshot.png'));
  await fs.copyFile(path.join(inputDir, 'proof-card.png'), path.join(targetDir, 'proof-card.png'));
}

function remotionProps() {
  const fps = spec.creative.fps;
  const shadow = '0 7px 20px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.9)';
  return {
    baseVideoSrc: 'base-video.mp4',
    textLayers: [
      {
        text: spec.creative.hook,
        startFrame: 0,
        durationFrames: 4 * fps,
        y: 13,
        width: 88,
        style: {
          fontSize: 70,
          fontWeight: '950',
          color: '#FFFFFF',
          textShadow: shadow,
          lineHeight: '1.04',
        },
      },
      {
        text: spec.creative.proofCaption,
        startFrame: 4 * fps,
        durationFrames: 7 * fps,
        y: 13,
        width: 88,
        style: {
          fontSize: 58,
          fontWeight: '900',
          color: '#22D3EE',
          textShadow: shadow,
          lineHeight: '1.04',
        },
      },
      {
        text: spec.creative.cta,
        startFrame: 12 * fps,
        durationFrames: 3 * fps,
        y: 86,
        width: 86,
        style: {
          fontSize: 64,
          fontWeight: '950',
          color: '#F97316',
          textShadow: shadow,
          lineHeight: '1.02',
        },
      },
    ],
    overlays: [
      {
        startFrame: 3 * fps,
        durationFrames: 9 * fps,
        type: 'floating_element',
        assetSrc: 'app-screenshot.png',
        position: 'center',
        config: {
          positionX: 50,
          positionY: 54,
          animation: 'slide-up',
          shadow: true,
          startScale: 0.95,
          endScale: 1,
          width: 520,
          backdropColor: 'rgba(15,23,42,0.72)',
          backdropRadius: 34,
          backdropPadding: 20,
        },
      },
      {
        startFrame: 6 * fps,
        durationFrames: 6 * fps,
        type: 'floating_element',
        assetSrc: 'proof-card.png',
        position: 'center',
        config: {
          positionX: 50,
          positionY: 68,
          animation: 'pop-in',
          shadow: true,
          startScale: 0.88,
          endScale: 1,
          width: 650,
          backdropColor: 'rgba(2,6,23,0.74)',
          backdropRadius: 28,
          backdropPadding: 18,
        },
      },
      {
        startFrame: 12 * fps,
        durationFrames: 3 * fps,
        type: 'floating_element',
        assetSrc: 'app-icon.png',
        position: 'center',
        config: {
          positionX: 50,
          positionY: 73,
          animation: 'bounce',
          shadow: true,
          startScale: 0.75,
          endScale: 1,
          width: 190,
          backdropColor: 'rgba(255,255,255,0.92)',
          backdropRadius: 44,
          backdropPadding: 16,
        },
      },
    ],
    jumpCuts: [
      { frame: 3 * fps, type: 'flash' },
      { frame: 6 * fps, type: 'flash' },
      { frame: 12 * fps, type: 'flash' },
    ],
    musicSrc: undefined,
    musicVolume: 0,
  };
}

function hyperframesHtml() {
  const { width, height, durationSeconds } = spec.creative;
  const compositionId = `${spec.jobId}-hyperframes`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width}, height=${height}">
  <title>${escapeHtml(spec.jobId)} HyperFrames Benchmark</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #020617;
      font-family: sans-serif;
    }
    #root {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #020617;
      color: white;
    }
    .base-video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: saturate(0.74) brightness(0.58) contrast(1.12);
    }
    .grain {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 20% 18%, rgba(34, 211, 238, 0.32), transparent 28%),
        radial-gradient(circle at 82% 78%, rgba(249, 115, 22, 0.26), transparent 30%),
        linear-gradient(180deg, rgba(2, 6, 23, 0.42), rgba(2, 6, 23, 0.18) 48%, rgba(2, 6, 23, 0.66));
    }
    .phone-grip {
      position: absolute;
      left: 50%;
      top: 47%;
      width: 660px;
      height: 1120px;
      transform: translate(-50%, -50%) rotate(-2deg);
      border-radius: 80px;
      background: linear-gradient(160deg, rgba(15, 23, 42, 0.34), rgba(15, 23, 42, 0.08));
      border: 2px solid rgba(255,255,255,0.12);
      box-shadow: inset 0 0 0 16px rgba(255,255,255,0.05), 0 34px 110px rgba(0,0,0,0.42);
    }
    .headline, .proof-label, .cta {
      position: absolute;
      left: 50%;
      width: 88%;
      transform: translateX(-50%);
      text-align: center;
      letter-spacing: 0;
      line-height: 1.04;
      text-wrap: balance;
      text-shadow: 0 7px 20px rgba(0,0,0,0.92), 0 2px 6px rgba(0,0,0,0.95);
    }
    .headline {
      top: 9%;
      font-size: 74px;
      font-weight: 950;
      opacity: 1;
    }
    .proof-label {
      top: 9.5%;
      font-size: 58px;
      font-weight: 930;
      color: #22D3EE;
      opacity: 0;
    }
    .phone {
      position: absolute;
      left: 50%;
      top: 52%;
      width: 520px;
      transform: translate(-50%, -50%);
      padding: 20px;
      border-radius: 38px;
      background: rgba(15, 23, 42, 0.74);
      box-shadow: 0 34px 90px rgba(0,0,0,0.55);
      opacity: 0;
    }
    .phone img {
      display: block;
      width: 100%;
      border-radius: 28px;
    }
    .proof-card {
      position: absolute;
      left: 50%;
      top: 69%;
      width: 660px;
      transform: translate(-50%, -50%);
      padding: 18px;
      border-radius: 30px;
      background: rgba(2, 6, 23, 0.78);
      box-shadow: 0 28px 76px rgba(0,0,0,0.58);
      opacity: 0;
    }
    .proof-card img {
      display: block;
      width: 100%;
      border-radius: 22px;
    }
    .icon-badge {
      position: absolute;
      left: 50%;
      top: 72%;
      width: 200px;
      height: 200px;
      transform: translate(-50%, -50%);
      border-radius: 48px;
      padding: 16px;
      background: rgba(255,255,255,0.94);
      box-shadow: 0 26px 68px rgba(0,0,0,0.56);
      opacity: 0;
    }
    .icon-badge img {
      width: 100%;
      height: 100%;
      display: block;
      border-radius: 32px;
    }
    .cta {
      top: 82%;
      font-size: 66px;
      font-weight: 950;
      color: #F97316;
      opacity: 0;
    }
    .flash {
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0.92);
      opacity: 0;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${escapeHtml(compositionId)}" data-start="0" data-width="${width}" data-height="${height}" data-duration="${durationSeconds}">
    <video id="base-video" class="clip base-video" src="assets/base-video.mp4" muted playsinline loop data-start="0" data-duration="${durationSeconds}" data-track-index="0"></video>
    <div id="color-grade" class="clip grain" data-start="0" data-duration="${durationSeconds}" data-track-index="1" data-layout-ignore></div>
    <div id="phone-grip" class="clip phone-grip" data-start="0" data-duration="${durationSeconds}" data-track-index="2" data-layout-ignore></div>
    <div id="hook-title" class="clip headline" data-start="0" data-duration="${durationSeconds}" data-track-index="3">${escapeHtml(spec.creative.hook)}</div>
    <div id="proof-label" class="clip proof-label" data-start="0" data-duration="${durationSeconds}" data-track-index="4">${escapeHtml(spec.creative.proofCaption)}</div>
    <div id="phone-proof" class="clip phone" data-start="0" data-duration="${durationSeconds}" data-track-index="5"><img src="assets/app-screenshot.png" alt=""></div>
    <div id="proof-card" class="clip proof-card" data-start="0" data-duration="${durationSeconds}" data-track-index="6"><img src="assets/proof-card.png" alt=""></div>
    <div id="icon-badge" class="clip icon-badge" data-start="0" data-duration="${durationSeconds}" data-track-index="7"><img src="assets/app-icon.png" alt=""></div>
    <div id="cta-text" class="clip cta" data-start="0" data-duration="${durationSeconds}" data-track-index="8">${escapeHtml(spec.creative.cta)}</div>
    <div id="flash-1" class="clip flash" data-start="0" data-duration="${durationSeconds}" data-track-index="9" data-layout-ignore></div>
    <div id="flash-2" class="clip flash" data-start="0" data-duration="${durationSeconds}" data-track-index="10" data-layout-ignore></div>
    <div id="flash-3" class="clip flash" data-start="0" data-duration="${durationSeconds}" data-track-index="11" data-layout-ignore></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set("#hook-title", { opacity: 1, y: 0, scale: 1 }, 0);
    tl.set(["#proof-label", "#phone-proof", "#proof-card", "#icon-badge", "#cta-text", "#flash-1", "#flash-2", "#flash-3"], { opacity: 0 }, 0);
    tl.to("#base-video", { scale: 1.035, duration: ${durationSeconds}, ease: "none" }, 0);
    tl.to("#hook-title", { opacity: 0, y: -18, duration: 0.25, ease: "power1.out" }, 3.75);
    tl.fromTo("#phone-proof", { opacity: 0, y: 86, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power2.out" }, 3);
    tl.fromTo("#proof-label", { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" }, 4);
    tl.fromTo("#proof-card", { opacity: 0, y: 64, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: "back.out(1.5)" }, 6);
    tl.to("#proof-label", { opacity: 0, y: -10, duration: 0.25, ease: "power1.out" }, 10.75);
    tl.to("#phone-proof", { opacity: 0, y: -42, scale: 0.98, duration: 0.35, ease: "power1.in" }, 11.65);
    tl.to("#proof-card", { opacity: 0, y: -34, scale: 0.96, duration: 0.35, ease: "power1.in" }, 11.7);
    tl.fromTo("#icon-badge", { opacity: 0, scale: 0.68 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.8)" }, 12);
    tl.fromTo("#cta-text", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }, 12.15);
    [
      ["#flash-1", 3],
      ["#flash-2", 6],
      ["#flash-3", 12],
    ].forEach(([id, at]) => {
      tl.set(id, { opacity: 0.86 }, at)
        .to(id, { opacity: 0, duration: 0.16, ease: "power1.out" }, at + 0.05);
    });
    window.__timelines[${JSON.stringify(compositionId)}] = tl;
  </script>
</body>
</html>
`;
}

async function qaRenderer(rendererConfig, renderResult) {
  const rendererDir = path.dirname(rendererConfig.outputPath);
  const qaPath = path.join(rendererDir, 'qa-report.json');
  const manifestPath = path.join(rendererDir, 'manifest.json');
  const firstFramePath = path.join(rendererDir, 'first-frame.png');
  const contactSheetPath = path.join(rendererDir, 'contact-sheet.jpg');

  const checks = [];
  let probe = null;
  let outputHash = null;
  let fileSizeBytes = 0;

  if (!renderResult?.ok || !existsSync(rendererConfig.outputPath)) {
    checks.push({ id: 'output_exists', verdict: 'fail', detail: 'Renderer did not produce output.mp4' });
  } else {
    checks.push({ id: 'output_exists', verdict: 'pass', detail: rendererConfig.outputPath });
    if (rendererConfig.id === 'hyperframes') {
      const lintReport = renderResult.metadata?.lintReport;
      checks.push({
        id: 'hyperframes_lint',
        verdict: lintReport?.errorCount === 0 && renderResult.metadata?.lintExitCode === 0 ? 'pass' : 'fail',
        observed: lintReport ? {
          ok: lintReport.ok,
          errorCount: lintReport.errorCount,
          warningCount: lintReport.warningCount,
          infoCount: lintReport.infoCount,
          errorCodes: (lintReport.findings || [])
            .filter((finding) => finding.severity === 'error')
            .map((finding) => finding.code),
        } : null,
        detail: lintReport ? 'HyperFrames lint report parsed from hyperframes/lint.json' : 'HyperFrames lint JSON could not be parsed',
      });
    }
    probe = await ffprobe(rendererConfig.outputPath);
    fileSizeBytes = Number((await fs.stat(rendererConfig.outputPath)).size);
    outputHash = await sha256File(rendererConfig.outputPath);

    const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
    const duration = Number(probe.format.duration);
    const fps = parseFps(videoStream?.avg_frame_rate);

    checks.push({
      id: 'dimensions',
      verdict: Number(videoStream?.width) === spec.creative.width && Number(videoStream?.height) === spec.creative.height ? 'pass' : 'fail',
      observed: { width: videoStream?.width, height: videoStream?.height },
      expected: { width: spec.creative.width, height: spec.creative.height },
    });
    checks.push({
      id: 'duration',
      verdict: Math.abs(duration - spec.creative.durationSeconds) <= 0.35 ? 'pass' : 'fail',
      observed: Number(duration.toFixed(3)),
      expected: spec.creative.durationSeconds,
    });
    checks.push({
      id: 'fps',
      verdict: Math.abs(fps - spec.creative.fps) <= 0.05 ? 'pass' : 'fail',
      observed: fps,
      expected: spec.creative.fps,
    });
    checks.push({
      id: 'codec',
      verdict: videoStream?.codec_name === 'h264' ? 'pass' : 'warn',
      observed: videoStream?.codec_name,
      expected: 'h264',
    });
    checks.push({
      id: 'file_size',
      verdict: fileSizeBytes > 0 ? 'pass' : 'fail',
      observed: fileSizeBytes,
    });
    checks.push({
      id: 'proof_assets_declared',
      verdict: spec.proof.screenshots.length > 0 && spec.proof.proofObjects.length > 0 ? 'pass' : 'fail',
      observed: { screenshots: spec.proof.screenshots, proofObjects: spec.proof.proofObjects },
    });
    checks.push({
      id: 'provider_mutations',
      verdict: 'pass',
      observed: 0,
      expected: 0,
    });

    await run('ffmpeg', ['-y', '-i', rendererConfig.outputPath, '-frames:v', '1', firstFramePath], {
      label: `${rendererConfig.id} first frame`,
    });
    await run('ffmpeg', [
      '-y',
      '-i',
      rendererConfig.outputPath,
      '-vf',
      contactSheetFilter(),
      '-frames:v',
      '1',
      contactSheetPath,
    ], { label: `${rendererConfig.id} contact sheet` });
    checks.push({
      id: 'derived_review_assets',
      verdict: existsSync(firstFramePath) && existsSync(contactSheetPath) ? 'pass' : 'fail',
      observed: { firstFramePath, contactSheetPath },
    });

    const ocr = await maybeOcr(contactSheetPath);
    checks.push(ocr);
  }

  const verdict = checks.some((check) => check.verdict === 'fail') ? 'hold' : 'pass';
  const qa = {
    renderer: rendererConfig.id,
    verdict,
    outputPath: rendererConfig.outputPath,
    manifestPath,
    firstFramePath,
    contactSheetPath,
    qaReportPath: qaPath,
    render: renderResult || null,
    metrics: {
      elapsedMs: renderResult?.elapsedMs ?? null,
      fileSizeBytes,
      sha256: outputHash,
      ffprobe: probe,
    },
    checks,
  };

  const manifest = {
    renderer: {
      id: rendererConfig.id,
      version: renderResult?.metadata?.rendererVersion ?? null,
    },
    command: renderResult?.metadata?.command ?? rendererConfig.commandLabel,
    backend: rendererConfig.commandLabel,
    inputSpecPath: path.join(inputDir, 'spec.json'),
    outputPath: rendererConfig.outputPath,
    dimensions: { width: spec.creative.width, height: spec.creative.height },
    durationSeconds: spec.creative.durationSeconds,
    fps: spec.creative.fps,
    fileSizeBytes,
    elapsedRenderTimeMs: renderResult?.elapsedMs ?? null,
    localCostEstimateUsd: 0,
    proofAssetPaths: [...spec.proof.screenshots, ...spec.proof.proofObjects],
    qaVerdict: verdict,
    provider_mutations: 0,
  };

  await fs.writeFile(qaPath, JSON.stringify(qa, null, 2) + '\n');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return qa;
}

async function maybeOcr(imagePath) {
  const which = await runAllowFailure('which', ['tesseract'], { label: 'which tesseract' });
  if (which.code !== 0) {
    return {
      id: 'ocr_expected_text',
      verdict: 'warn',
      detail: 'tesseract is not installed; OCR skipped',
      expectedText: [spec.creative.hook, spec.creative.proofCaption, spec.creative.cta, spec.app.name],
    };
  }
  const ocr = await runAllowFailure('tesseract', [imagePath, 'stdout'], { label: 'tesseract contact sheet' });
  const text = ocr.stdout || '';
  const expected = [spec.creative.hook, spec.creative.proofCaption, spec.creative.cta, spec.app.name];
  const matched = expected.filter((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
  return {
    id: 'ocr_expected_text',
    verdict: matched.length >= 2 ? 'pass' : 'warn',
    matched,
    expectedText: expected,
    text,
  };
}

function buildRecommendation(qaResults) {
  const hyper = qaResults.find((item) => item.renderer === 'hyperframes');
  const remotion = qaResults.find((item) => item.renderer === 'remotion-adrenderer');
  if (!hyper || !remotion) return 'Benchmark incomplete; rerun after both renderers produce QA reports.';
  if (hyper.verdict !== 'pass' && remotion.verdict === 'pass') {
    return 'Keep Remotion as the default until HyperFrames passes the local proof-driven render checks.';
  }
  if (hyper.verdict === 'pass' && remotion.verdict !== 'pass') {
    return 'HyperFrames passed while the Remotion baseline held; inspect the Remotion failure before changing defaults.';
  }
  if (hyper.verdict !== 'pass' || remotion.verdict !== 'pass') {
    return 'Both renderers need fixes before a default backend decision.';
  }

  const hyperMs = hyper.metrics.elapsedMs;
  const remotionMs = remotion.metrics.elapsedMs;
  if (typeof hyperMs === 'number' && typeof remotionMs === 'number' && hyperMs <= remotionMs * 1.15) {
    return 'HyperFrames is viable for the Mobile Ad Agent default RenderBackend candidate; keep Remotion as fallback while adding richer proof-fidelity QA.';
  }
  return 'Both passed. Remotion was materially faster locally, so keep Remotion as default for now and continue HyperFrames for agent-editable composition experiments.';
}

function printSummary(report) {
  console.log(`Benchmark report: ${reportPath}`);
  console.log(`Status: ${report.status}`);
  for (const renderer of report.renderers) {
    const seconds = renderer.metrics.elapsedMs == null ? 'n/a' : `${(renderer.metrics.elapsedMs / 1000).toFixed(1)}s`;
    const size = renderer.metrics.fileSizeBytes ? `${(renderer.metrics.fileSizeBytes / 1024 / 1024).toFixed(2)} MB` : 'n/a';
    console.log(`${renderer.renderer}: ${renderer.verdict}, render ${seconds}, ${size}`);
    console.log(`  output: ${renderer.outputPath}`);
    console.log(`  contact sheet: ${renderer.contactSheetPath}`);
  }
  console.log(`Recommendation: ${report.recommendation}`);
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
  ], { label: `ffprobe ${path.basename(filePath)}` });
  return JSON.parse(result.stdout);
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

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const bytes = await fs.readFile(filePath);
  hash.update(bytes);
  return hash.digest('hex');
}

async function getCommandVersion(command, args) {
  const result = await runAllowFailure(command, args, { label: `${path.basename(command)} version` });
  return (result.stdout || result.stderr || '').trim() || null;
}

function getAdAgenticPackageVersion(packageName) {
  try {
    const packagePath = path.join(ADAGENTIC_ROOT, 'node_modules', packageName, 'package.json');
    return JSON.parse(readFileSync(packagePath, 'utf8')).version;
  } catch {
    return null;
  }
}

async function run(command, args, options = {}) {
  const result = await runAllowFailure(command, args, options);
  if (result.code !== 0) {
    const label = options.label || shellCommand([command, ...args]);
    throw new Error(`${label} failed with exit code ${result.code}\n${tail(result.stderr || result.stdout)}`);
  }
  return result;
}

function runAllowFailure(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || REPO_ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (options.stream) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (options.stream) process.stderr.write(chunk);
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function tail(text, lines = 30) {
  return text.split('\n').slice(-lines).join('\n').trim();
}

function shellCommand(parts) {
  return parts.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function contactSheetFilter() {
  const { fps, durationSeconds } = spec.creative;
  const frames = [0, 3.8, 7.5, 12.5, Math.max(durationSeconds - 1, 0)]
    .map((seconds) => Math.min(Math.round(seconds * fps), durationSeconds * fps - 1));
  const selector = frames.map((frame) => `eq(n\\,${frame})`).join('+');
  return `select=${selector},scale=270:480,tile=5x1`;
}

function appIconSvg() {
  return `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#22D3EE"/>
      <stop offset="0.52" stop-color="#0F172A"/>
      <stop offset="1" stop-color="#F97316"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#g)"/>
  <circle cx="256" cy="256" r="154" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.38)" stroke-width="10"/>
  <path d="M151 310 L220 194 L277 280 L315 228 L365 310 Z" fill="#fff"/>
  <text x="256" y="394" text-anchor="middle" font-family="Arial, sans-serif" font-weight="900" font-size="58" fill="#fff">BF</text>
</svg>`;
}

function appScreenshotSvg() {
  return `<svg width="900" height="1600" viewBox="0 0 900 1600" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="1600" rx="86" fill="#0F172A"/>
  <rect x="46" y="46" width="808" height="1508" rx="58" fill="#F8FAFC"/>
  <text x="92" y="156" font-family="Arial, sans-serif" font-size="54" font-weight="900" fill="#0F172A">BenchFit</text>
  <text x="92" y="216" font-family="Arial, sans-serif" font-size="31" font-weight="700" fill="#64748B">Today: Push Strength</text>
  <rect x="92" y="284" width="716" height="208" rx="32" fill="#0F172A"/>
  <text x="132" y="358" font-family="Arial, sans-serif" font-size="34" font-weight="800" fill="#22D3EE">Workout Streak</text>
  <text x="132" y="438" font-family="Arial, sans-serif" font-size="72" font-weight="900" fill="#FFFFFF">18 days</text>
  <rect x="92" y="548" width="716" height="256" rx="36" fill="#E0F2FE"/>
  <text x="132" y="620" font-family="Arial, sans-serif" font-size="36" font-weight="900" fill="#0F172A">Bench Press</text>
  <rect x="132" y="672" width="566" height="36" rx="18" fill="#BAE6FD"/>
  <rect x="132" y="672" width="398" height="36" rx="18" fill="#0284C7"/>
  <text x="132" y="760" font-family="Arial, sans-serif" font-size="44" font-weight="900" fill="#0369A1">+42 XP logged</text>
  <rect x="92" y="860" width="330" height="246" rx="32" fill="#FFF7ED"/>
  <text x="132" y="936" font-family="Arial, sans-serif" font-size="31" font-weight="900" fill="#9A3412">Next Set</text>
  <text x="132" y="1016" font-family="Arial, sans-serif" font-size="52" font-weight="900" fill="#F97316">8 reps</text>
  <rect x="478" y="860" width="330" height="246" rx="32" fill="#ECFDF5"/>
  <text x="518" y="936" font-family="Arial, sans-serif" font-size="31" font-weight="900" fill="#166534">Weekly Rank</text>
  <text x="518" y="1016" font-family="Arial, sans-serif" font-size="52" font-weight="900" fill="#16A34A">Top 7%</text>
  <rect x="92" y="1168" width="716" height="182" rx="32" fill="#F1F5F9"/>
  <text x="132" y="1242" font-family="Arial, sans-serif" font-size="35" font-weight="900" fill="#0F172A">No notes app cleanup</text>
  <text x="132" y="1302" font-family="Arial, sans-serif" font-size="31" font-weight="700" fill="#64748B">Sets, history, and progress stay connected.</text>
</svg>`;
}

function proofCardSvg() {
  return `<svg width="900" height="460" viewBox="0 0 900 460" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="460" rx="38" fill="#0F172A"/>
  <rect x="32" y="32" width="836" height="396" rx="28" fill="#111827" stroke="#22D3EE" stroke-width="5"/>
  <text x="72" y="116" font-family="Arial, sans-serif" font-size="38" font-weight="900" fill="#22D3EE">PROOF OBJECT</text>
  <text x="72" y="188" font-family="Arial, sans-serif" font-size="58" font-weight="900" fill="#FFFFFF">18 day streak</text>
  <text x="72" y="252" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#CBD5E1">from uploaded app screenshot</text>
  <rect x="72" y="306" width="560" height="48" rx="24" fill="#334155"/>
  <rect x="72" y="306" width="432" height="48" rx="24" fill="#F97316"/>
  <text x="72" y="398" font-family="Arial, sans-serif" font-size="31" font-weight="800" fill="#F8FAFC">QA target: text readable, app UI visible</text>
</svg>`;
}

main().catch(async (error) => {
  await fs.mkdir(artifactsRoot, { recursive: true });
  await fs.writeFile(path.join(artifactsRoot, 'benchmark-error.log'), `${error.stack || error.message}\n`);
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
