// Stage 6 — HyperFrames-first Render / Timeline Planning (Render Planner).
// The creative timeline is HyperFrames-first: we emit a self-contained
// composition spec (scenes, tracks, layers, keyframes) plus a RenderTask whose
// backend is a finishing renderer ONLY. ffmpeg is a utility, never the editor.
// Local mode produces the plan; it does not call any renderer.
import { stableId, round } from './util.mjs';

const RATIO_DIMENSIONS = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
};

// Caption styling defaults — TikTok-organic house style (no animation, instant on/off).
const CAPTION_STYLE = {
  hook: { fontPx: 82, weight: 900, color: '#FFFFFF', shadow: 'heavy', safeAreaTopPct: 12 },
  body: { fontPx: 72, weight: 900, color: '#FFFFFF', shadow: 'heavy' },
  cta: { fontPx: 54, weight: 900, color: '#FFFFFF', shadow: 'heavy', linkEmoji: '🔗' },
};

function buildScenes(script, brief) {
  // One scene per script beat. Reveal/proof beats carry a proof cutaway layer.
  return script.beats.map((beat) => {
    const isProofBeat = Boolean(beat.proofId);
    return {
      sceneId: stableId('scene', `${script.scriptId}|${beat.id}`),
      role: beat.role,
      startSeconds: beat.startSeconds,
      endSeconds: beat.endSeconds,
      creatorSegmentTaskRef: `gentask:${beat.id}`,
      proofCutaway: isProofBeat
        ? {
            proofObjectId: beat.proofId,
            insetStyle: beat.role === 'reveal' ? 'fullscreen_with_lower_third' : 'corner_inset',
            cropHold: true, // hold the real crop steady; no fabricated motion
          }
        : null,
    };
  });
}

function buildTracks(script, brief, dims) {
  const total = brief.targetDurationSeconds;

  // Caption keyframes — instant in/out, no tween (house rule).
  const captionLayers = [];
  const hook = script.beats.find((b) => b.role === 'hook');
  if (hook) {
    captionLayers.push({
      layerId: 'caption_hook',
      text: script.hookCaption,
      style: CAPTION_STYLE.hook,
      keyframes: [
        { t: hook.startSeconds, opacity: 1 },
        { t: round(Math.min(hook.endSeconds + 0.6, total), 2), opacity: 0 },
      ],
    });
  }
  const cta = script.beats.find((b) => b.role === 'cta');
  if (cta) {
    captionLayers.push({
      layerId: 'caption_cta',
      text: `${script.ctaCaption} ${CAPTION_STYLE.cta.linkEmoji}`,
      style: CAPTION_STYLE.cta,
      keyframes: [
        { t: cta.startSeconds, opacity: 1 },
        { t: round(total, 2), opacity: 1 },
      ],
    });
  }

  return {
    video: {
      trackId: 'video_main',
      role: 'creator_and_proof',
      note: 'Creator segments + proof cutaways composited in HyperFrames; ffmpeg only validates.',
    },
    captions: { trackId: 'captions', layers: captionLayers },
    overlay: {
      trackId: 'overlay',
      layers: [
        {
          layerId: 'app_icon_cta',
          asset: 'sample/brand/app-icon.png',
          keyframes: [
            { t: cta ? cta.startSeconds : round(total * 0.85, 2), opacity: 1 },
            { t: round(total, 2), opacity: 1 },
          ],
        },
      ],
    },
    audio: {
      trackId: 'audio',
      layers: [
        { layerId: 'voiceover', source: 'creator_native_audio', gainDb: 0 },
        { layerId: 'music_bed', source: 'sample/music/lofi-bed.mp3', gainDb: -12, ducked: true },
      ],
    },
  };
}

export function runTimelinePlan(profile, script, brief, packRequest) {
  if (script.blocked) {
    return { stage: 'timeline', blocked: true, composition: null, renderTask: null };
  }

  const dims = RATIO_DIMENSIONS[packRequest.aspectRatio] || RATIO_DIMENSIONS['9:16'];
  const fps = 30;
  const duration = brief.targetDurationSeconds;

  const scenes = buildScenes(script, brief);
  const tracks = buildTracks(script, brief, dims);

  // Thumbnail / first-frame hold — pick the reveal beat's proof moment.
  const reveal = script.beats.find((b) => b.role === 'reveal') || script.beats[0];
  const thumbnailHold = {
    atSeconds: reveal ? round(reveal.startSeconds + reveal.durationSeconds / 2, 2) : 0,
    overlayText: script.hookCaption,
  };

  const composition = {
    compositionId: stableId('comp', `${script.scriptId}|${packRequest.aspectRatio}`),
    engine: 'hyperframes', // HyperFrames-first
    format: 'html_css_js_bundle',
    dimensions: dims,
    fps,
    durationSeconds: duration,
    scenes,
    tracks,
    thumbnailHold,
    bundlePlan: {
      // Portable composition bundle we would store in R2 (key planned, not written).
      compositionZipKeyPlan: `local/studio/comps/${stableId('comp', script.scriptId)}.zip`,
      variablesKeyPlan: `local/studio/comps/${stableId('comp', script.scriptId)}.vars.json`,
    },
  };

  // Render finishing task — backend is a RenderBackend only (never a generator).
  const renderTask = {
    taskId: stableId('rendertask', composition.compositionId),
    role: 'finishing',
    backendId: 'heygen-hyperframes-cloud', // V1 hosted finishing; swappable for hyperframes-cloud-run
    swappableBackends: ['hyperframes-cloud-run', 'remotion-cloud-run', 'remotion-lambda'],
    compositionRef: composition.compositionId,
    dimensions: dims,
    fps,
    durationSeconds: duration,
    format: 'mp4',
    estimatedCostUsd: round((0.1 / 60) * duration, 4), // 0.1 credits/min @ ~$1/credit assumption
    status: 'planned',
    providerMutations: 0,
    outputAssetId: null,
  };

  return {
    stage: 'timeline',
    blocked: false,
    composition,
    renderTask,
    notes: [
      'Timeline is HyperFrames-first: creator + proof composited in the composition bundle.',
      'ffmpeg/ffprobe reserved for validation only, not editing.',
    ],
  };
}
