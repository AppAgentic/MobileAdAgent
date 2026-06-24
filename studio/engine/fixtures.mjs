// Sample intake used by the Studio UI "Load sample" button and the smoke test.
// This is fixture data only — no real provider calls, no live assets.
// Designed to be distinct from the sibling prototype's PepMod sample.

export const SAMPLE_INTAKE = {
  app: {
    name: 'TrailPace',
    storeUrl: 'https://apps.apple.com/us/app/trailpace/id000000000',
    platforms: ['ios', 'android'],
    audience: 'Trail runners who want pacing, elevation, and recovery tracking on routes.',
    tone: 'Grounded, energetic, outdoorsy — not hype-bro.',
    productFacts: [
      'Live pacing guidance adapts to elevation grade.',
      'Route library shows elevation profile before you start.',
      'Recovery score combines heart-rate drift and sleep.',
      'Workouts export to GPX.',
    ],
    avoidClaims: [
      'No medical or injury-prevention claims.',
      'No guaranteed performance or weight-loss outcomes.',
      'No fabricated app UI or invented screens.',
    ],
    complianceNotes: ['Show only screens that exist in the shipped build.'],
  },
  pack: {
    formats: ['ugc_video', 'thumbnail'],
    count: 1,
    durationSeconds: 18,
    aspectRatio: '9:16',
    channels: ['tiktok', 'instagram_reels'],
    costCeilingUsd: 12,
  },
  proofAssets: [
    {
      label: 'Live pacing screen',
      kind: 'raw_screenshot',
      source: 'sample/trailpace/live-pacing.png',
      ocrText: 'PACE 8:42 /mi · GRADE +6% · TARGET 8:30 · HOLD STEADY',
      dimensions: { width: 1170, height: 2532 },
      visualCategory: 'live_metric',
      supportsFacts: ['Live pacing guidance adapts to elevation grade.'],
    },
    {
      label: 'Route elevation profile',
      kind: 'raw_screenshot',
      source: 'sample/trailpace/route-profile.png',
      ocrText: 'EAGLE RIDGE LOOP · 7.4 mi · +1,240 ft · EST 1:18',
      dimensions: { width: 1170, height: 2532 },
      visualCategory: 'chart',
      supportsFacts: ['Route library shows elevation profile before you start.'],
    },
    {
      label: 'Recovery score card',
      kind: 'raw_screenshot',
      source: 'sample/trailpace/recovery-card.png',
      ocrText: 'RECOVERY 72 · HR DRIFT LOW · SLEEP 7h12m · READY',
      dimensions: { width: 1170, height: 2532 },
      visualCategory: 'score_card',
      supportsFacts: ['Recovery score combines heart-rate drift and sleep.'],
    },
    {
      label: 'App Store hero collage',
      kind: 'store_screenshot',
      source: 'sample/trailpace/store-hero.png',
      ocrText: 'TRAILPACE — RUN SMARTER ON EVERY CLIMB',
      dimensions: { width: 1242, height: 2688 },
      visualCategory: 'marketing_collage',
      supportsFacts: [],
    },
  ],
  creatorProfile: {
    creatorProfileId: 'creator_shared_trail_01',
    displayName: 'Shared creator — trail runner (beta reference)',
    rightsStatus: 'approved',
    identityTransform: {
      faceShape: 'softened jaw',
      hairColorStyle: 'auburn ponytail',
      skinToneShade: 'warm tan',
      age: 'late 20s',
    },
    voiceStyle: 'calm, slightly breathless mid-run',
  },
};
