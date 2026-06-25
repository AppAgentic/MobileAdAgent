// Mobile Ad Agent — local product prototype data model and deterministic mock pipeline.
//
// This module powers the local SaaS prototype. It never calls a provider, never
// mutates ad-network spend, and never writes to R2. Every job records
// providerMutations: 0. All generation is deterministic mock output so Mission
// Control can smoke-test the critical product flow.

const CREDIT_RATE = {
  imageAd: 6, // credits per image ad draft
  ugcVideo: 18, // credits per UGC video draft
};

// ---------------------------------------------------------------------------
// Seed portfolio
// ---------------------------------------------------------------------------

const PROOF_KINDS = {
  screen: { label: 'App screen', trust: 'raw_app_proof' },
  recording: { label: 'Screen recording', trust: 'raw_app_proof' },
  store_art: { label: 'Store art', trust: 'store_art' },
};

function proof(id, label, kind, hue, ocr) {
  return {
    id,
    label,
    kind,
    trust: PROOF_KINDS[kind].trust,
    hue,
    ocr: ocr || label,
  };
}

function claim(id, text, status, supportingProofIds, confidence) {
  return { id, text, status, supportingProofIds, confidence };
}

const APPS = [
  {
    id: 'focushabit',
    name: 'FocusHabit',
    category: 'Health & Fitness',
    icon: 'FH',
    hue: 152,
    storeUrl: 'https://apps.apple.com/app/focushabit/id000000001',
    audience: 'People building daily habits and routines who keep falling off track.',
    objective: 'Show that streaks and gentle reminders keep habits alive.',
    avoidList: 'No medical claims. No guaranteed-results promises. No fabricated UI.',
    proofAssets: [
      proof('fh-streak', 'Streak dashboard', 'screen', 152, 'Current streak 28 days'),
      proof('fh-today', 'Today checklist', 'screen', 150, "Today — 4 of 6 habits done"),
      proof('fh-reminder', 'Smart reminder', 'screen', 158, 'Reminder 7:30 PM — Evening walk'),
      proof('fh-insights', 'Weekly insights', 'screen', 146, 'Consistency 86% this week'),
      proof('fh-recording', 'Check-off recording', 'recording', 154, 'Tap to complete habit'),
      proof('fh-storeicon', 'App Store icon', 'store_art', 152, 'Store art — not raw proof'),
    ],
    claims: [
      claim('fh-c1', 'Track daily habits and check them off in seconds.', 'approved', ['fh-today', 'fh-recording'], 0.94),
      claim('fh-c2', 'See your streak grow to keep momentum.', 'approved', ['fh-streak'], 0.91),
      claim('fh-c3', 'Smart reminders nudge you at the right time.', 'needs_review', ['fh-reminder'], 0.78),
      claim('fh-c4', 'Weekly insights show your real consistency.', 'approved', ['fh-insights'], 0.88),
      claim('fh-c5', 'Build better habits than ever before.', 'needs_review', [], 0.41),
      claim('fh-c6', 'Personalized plan adapts to your day.', 'needs_review', ['fh-today'], 0.62),
    ],
  },
  {
    id: 'trailpace',
    name: 'TrailPace',
    category: 'Health & Fitness',
    icon: 'TP',
    hue: 28,
    storeUrl: 'https://apps.apple.com/app/trailpace/id000000002',
    audience: 'Trail runners and hikers who want pacing and elevation insight.',
    objective: 'Show live pacing and route stats that keep runners on target.',
    avoidList: 'No injury or weight-loss claims. No fake maps.',
    proofAssets: [
      proof('tp-pace', 'Live pace screen', 'screen', 28, 'Pace 8:42 /mi — on target'),
      proof('tp-route', 'Route map', 'screen', 24, 'Elevation gain 1,240 ft'),
      proof('tp-splits', 'Split history', 'screen', 32, 'Mile splits — last run'),
      proof('tp-store', 'Store screenshot', 'store_art', 28, 'Store art — not raw proof'),
    ],
    claims: [
      claim('tp-c1', 'See live pace so you never burn out early.', 'approved', ['tp-pace'], 0.9),
      claim('tp-c2', 'Track elevation and route in real time.', 'needs_review', ['tp-route'], 0.83),
      claim('tp-c3', 'Review every split after your run.', 'approved', ['tp-splits'], 0.86),
    ],
  },
  {
    id: 'budgetpal',
    name: 'BudgetPal',
    category: 'Finance',
    icon: 'BP',
    hue: 210,
    storeUrl: 'https://apps.apple.com/app/budgetpal/id000000003',
    audience: 'Young professionals who want a calm handle on spending.',
    objective: 'Show simple budgets and spend tracking that reduce money stress.',
    avoidList: 'No investment-return claims. No guaranteed savings figures.',
    proofAssets: [
      proof('bp-overview', 'Budget overview', 'screen', 210, 'Left to spend $420'),
      proof('bp-recording', 'Add expense recording', 'recording', 206, 'Add expense in two taps'),
    ],
    claims: [
      claim('bp-c1', 'See exactly what is safe to spend today.', 'needs_review', ['bp-overview'], 0.8),
      claim('bp-c2', 'Log an expense in two taps.', 'needs_review', ['bp-recording'], 0.74),
    ],
  },
  {
    id: 'calmdawn',
    name: 'CalmDawn',
    category: 'Wellness',
    icon: 'CD',
    hue: 268,
    storeUrl: 'https://apps.apple.com/app/calmdawn/id000000004',
    audience: 'People who want a gentler morning routine and better sleep.',
    objective: 'Show wind-down and wake-up routines that feel calm.',
    avoidList: 'No medical sleep claims. No cure language.',
    proofAssets: [],
    claims: [],
  },
];

export function createPortfolioState() {
  return {
    credits: 12450,
    user: { name: 'Alex Chan', role: 'Growth' },
    apps: APPS.map(decorateApp),
  };
}

function decorateApp(app) {
  const proofAssets = app.proofAssets.map((p) => ({ ...p }));
  const claims = app.claims.map((c) => ({ ...c }));
  const rawProof = proofAssets.filter((p) => p.trust === 'raw_app_proof');
  const approved = claims.filter((c) => c.status === 'approved');
  const needsReview = claims.filter((c) => c.status === 'needs_review');

  let status = 'ready';
  if (!rawProof.length) {
    status = 'needs_proof';
  } else if (!approved.length || needsReview.length > approved.length) {
    status = 'needs_proof';
  }

  const proofReadiness = computeProofReadiness({ rawProof, approved, claims });

  return {
    id: app.id,
    name: app.name,
    category: app.category,
    icon: app.icon,
    hue: app.hue,
    storeUrl: app.storeUrl,
    audience: app.audience,
    objective: app.objective,
    avoidList: app.avoidList,
    proofAssets,
    claims,
    status,
    proofReadiness,
    counts: {
      proof: proofAssets.length,
      rawProof: rawProof.length,
      storeArt: proofAssets.filter((p) => p.trust === 'store_art').length,
      claims: claims.length,
      approvedClaims: approved.length,
      needsReviewClaims: needsReview.length,
    },
    lastPack: app.id === 'budgetpal' ? 'Draft pack' : app.id === 'calmdawn' ? null : '3 days ago',
  };
}

function computeProofReadiness({ rawProof, approved, claims }) {
  if (!rawProof.length) {
    return 0;
  }
  if (!claims.length) {
    return 20;
  }
  const claimRatio = approved.length / claims.length;
  const proofBonus = Math.min(1, rawProof.length / 4);
  return Math.round(Math.min(100, 40 + claimRatio * 45 + proofBonus * 15));
}

// ---------------------------------------------------------------------------
// Draft pack generation (deterministic mock — providerMutations: 0)
// ---------------------------------------------------------------------------

const IMAGE_LAYOUTS = {
  product_proof: 'Product proof',
  lifestyle: 'Lifestyle',
  comparison: 'Comparison',
};

const UGC_STYLES = {
  natural: 'Natural & authentic',
  energetic: 'Energetic creator',
  calm: 'Calm explainer',
};

export function defaultPackConfig(app) {
  return {
    outputs: { imageAds: true, ugcVideos: false },
    imageSetup: {
      layouts: ['product_proof', 'lifestyle'],
      formats: ['1:1', '4:5', '9:16'],
      perClaim: 1,
    },
    ugcSetup: {
      style: 'natural',
      durationSeconds: 15,
      count: 3,
    },
  };
}

export function generateDraftPack(payload = {}) {
  const portfolio = createPortfolioState();
  const seedApp = portfolio.apps.find((candidate) => candidate.id === payload.appId) || portfolio.apps[0];
  // Honor an edited working copy (approved/ignored/edited claims) when provided.
  const app = mergeAppOverride(seedApp, payload.appOverride);
  const config = normalizeConfig(payload.config, app);
  const approvedClaims = app.claims.filter((c) => c.status === 'approved');
  const usableClaims = approvedClaims.length ? approvedClaims : app.claims.filter((c) => c.status !== 'ignored');

  const drafts = [];

  if (config.outputs.imageAds) {
    const formats = config.imageSetup.formats.length ? config.imageSetup.formats : ['1:1'];
    const layouts = config.imageSetup.layouts.length ? config.imageSetup.layouts : ['product_proof'];
    usableClaims.forEach((c, claimIndex) => {
      layouts.forEach((layout, layoutIndex) => {
        for (let copy = 0; copy < config.imageSetup.perClaim; copy += 1) {
          const format = formats[(claimIndex + layoutIndex + copy) % formats.length];
          const id = `img-${app.id}-${c.id}-${layout}-${copy}`;
          drafts.push({
            id,
            type: 'image',
            app: app.name,
            headline: imageHeadline(c, layout),
            subhead: claimToProofLine(app, c),
            claimId: c.id,
            layout,
            layoutLabel: IMAGE_LAYOUTS[layout] || layout,
            format,
            proofIds: c.supportingProofIds,
            hue: app.hue + (layoutIndex * 14),
            status: 'needs_review',
          });
        }
      });
    });
  }

  if (config.outputs.ugcVideos) {
    const count = clamp(config.ugcSetup.count, 1, 8, 3);
    for (let i = 0; i < count; i += 1) {
      const c = usableClaims[i % Math.max(1, usableClaims.length)] || usableClaims[0];
      const id = `ugc-${app.id}-${i}`;
      drafts.push({
        id,
        type: 'ugc',
        app: app.name,
        hook: ugcHook(app, c, i),
        beat: c ? claimToProofLine(app, c) : 'Real app proof cutaway',
        claimId: c ? c.id : null,
        style: config.ugcSetup.style,
        styleLabel: UGC_STYLES[config.ugcSetup.style] || config.ugcSetup.style,
        durationSeconds: config.ugcSetup.durationSeconds,
        proofIds: c ? c.supportingProofIds : [],
        hue: app.hue,
        status: 'needs_review',
      });
    }
  }

  const imageCount = drafts.filter((d) => d.type === 'image').length;
  const ugcCount = drafts.filter((d) => d.type === 'ugc').length;
  const cost = imageCount * CREDIT_RATE.imageAd + ugcCount * CREDIT_RATE.ugcVideo;
  const derivedAssets = imageCount * 2 + ugcCount * 3; // story crops + thumbnails are derived later

  return {
    packId: `pack-${stableHash(`${app.id}|${imageCount}|${ugcCount}`)}`,
    appId: app.id,
    appName: app.name,
    mode: 'local_mock',
    providerMutations: 0,
    config,
    drafts,
    summary: {
      imageCount,
      ugcCount,
      total: drafts.length,
      derivedAssets,
    },
    cost: {
      currency: 'credits',
      total: cost,
      imageAds: imageCount * CREDIT_RATE.imageAd,
      ugcVideos: ugcCount * CREDIT_RATE.ugcVideo,
      note: 'Credits are only spent when drafts are generated.',
    },
  };
}

function mergeAppOverride(seedApp, override) {
  if (!override) {
    return seedApp;
  }
  return {
    ...seedApp,
    proofAssets: Array.isArray(override.proofAssets) ? override.proofAssets : seedApp.proofAssets,
    claims: Array.isArray(override.claims) ? override.claims : seedApp.claims,
  };
}

function normalizeConfig(config, app) {
  const base = defaultPackConfig(app);
  if (!config) {
    return base;
  }
  return {
    outputs: {
      imageAds: config.outputs?.imageAds !== false,
      ugcVideos: Boolean(config.outputs?.ugcVideos),
    },
    imageSetup: {
      layouts: Array.isArray(config.imageSetup?.layouts) && config.imageSetup.layouts.length
        ? config.imageSetup.layouts.filter((l) => IMAGE_LAYOUTS[l])
        : base.imageSetup.layouts,
      formats: Array.isArray(config.imageSetup?.formats) && config.imageSetup.formats.length
        ? config.imageSetup.formats
        : base.imageSetup.formats,
      perClaim: clamp(config.imageSetup?.perClaim, 1, 3, 1),
    },
    ugcSetup: {
      style: UGC_STYLES[config.ugcSetup?.style] ? config.ugcSetup.style : base.ugcSetup.style,
      durationSeconds: clamp(config.ugcSetup?.durationSeconds, 8, 30, 15),
      count: clamp(config.ugcSetup?.count, 1, 8, base.ugcSetup.count),
    },
  };
}

// ---------------------------------------------------------------------------
// QA report
// ---------------------------------------------------------------------------

export function buildQaReport(pack, appOverride) {
  const portfolio = createPortfolioState();
  const app = appOverride || portfolio.apps.find((candidate) => candidate.id === pack.appId) || portfolio.apps[0];
  const drafts = pack.drafts || [];
  const approvedDrafts = drafts.filter((d) => d.status === 'approved');
  const reviewSet = approvedDrafts.length ? approvedDrafts : drafts;

  const draftsWithProof = reviewSet.filter((d) => (d.proofIds || []).length > 0);
  const longHeadlines = reviewSet.filter((d) => (d.headline || d.hook || '').length > 48);
  const formatsOk = reviewSet.every((d) => d.type === 'ugc' || ['1:1', '4:5', '9:16'].includes(d.format));

  const checks = [
    {
      id: 'proof',
      label: 'Proof',
      status: reviewSet.length && draftsWithProof.length === reviewSet.length ? 'pass'
        : draftsWithProof.length ? 'warn' : 'hold',
      detail: reviewSet.length
        ? `${draftsWithProof.length}/${reviewSet.length} creatives map to approved raw proof.`
        : 'No creatives to check yet.',
    },
    {
      id: 'text',
      label: 'Text readability',
      status: longHeadlines.length ? 'warn' : 'pass',
      detail: longHeadlines.length
        ? `${longHeadlines.length} headline(s) may be long for small placements.`
        : 'Headlines fit comfortably across placements.',
    },
    {
      id: 'brand',
      label: 'Brand fit',
      status: 'pass',
      detail: `Tone and CTA match ${app.name} brand kit.`,
    },
    {
      id: 'formats',
      label: 'Formats & size',
      status: formatsOk ? 'pass' : 'warn',
      detail: formatsOk ? 'All requested formats are present and within spec.' : 'One or more formats are non-standard.',
    },
    {
      id: 'cost',
      label: 'Cost & credits',
      status: 'pass',
      detail: `${pack.cost?.total ?? 0} credits spent. No provider mutations.`,
    },
  ];

  const held = checks.some((c) => c.status === 'hold');
  const warned = checks.some((c) => c.status === 'warn');
  return {
    verdict: held ? 'hold' : warned ? 'warn' : 'pass',
    reviewer: 'local-qa-agent',
    checks,
    approvedCount: approvedDrafts.length,
    totalCount: drafts.length,
    note: held
      ? 'Resolve the held checks before export.'
      : 'Local QA pass. This is mock output; real media QA still runs before launch.',
  };
}

// ---------------------------------------------------------------------------
// Export manifest
// ---------------------------------------------------------------------------

export function exportManifest({ appId, pack, qa, destination } = {}) {
  const portfolio = createPortfolioState();
  const app = portfolio.apps.find((candidate) => candidate.id === (appId || pack?.appId)) || portfolio.apps[0];
  const resolvedQa = qa || (pack ? buildQaReport(pack, app) : null);
  const approved = (pack?.drafts || []).filter((d) => d.status === 'approved');

  return {
    schemaVersion: 'local-mobile-ad-agent-manifest.v2',
    packId: pack?.packId || `pack-${app.id}`,
    mode: 'local_mock',
    providerMutations: 0,
    app: {
      id: app.id,
      name: app.name,
      category: app.category,
      storeUrl: app.storeUrl,
    },
    outputs: {
      imageAds: (approved.length ? approved : pack?.drafts || []).filter((d) => d.type === 'image').length,
      ugcVideos: (approved.length ? approved : pack?.drafts || []).filter((d) => d.type === 'ugc').length,
    },
    creatives: (approved.length ? approved : pack?.drafts || []).map((d) => ({
      id: d.id,
      type: d.type,
      format: d.format || `${d.durationSeconds}s`,
      headline: d.headline || d.hook,
      claimId: d.claimId,
      proofIds: d.proofIds,
      status: d.status,
    })),
    qa: resolvedQa,
    cost: pack?.cost || { currency: 'credits', total: 0 },
    handoff: {
      destination: destination || 'download_zip',
      note: 'No live provider publishing. Assets stay as source inventory until a destination is explicitly chosen.',
    },
    audit: {
      generatedBy: 'local-mobile-ad-agent-prototype',
      note: 'Local mock manifest. No provider calls, no R2 writes, no ad-network mutations.',
    },
  };
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

function imageHeadline(claim, layout) {
  if (!claim) {
    return 'Real app proof, no fake UI';
  }
  const text = claim.text.replace(/\.$/, '');
  if (layout === 'comparison') {
    return `Before vs after: ${lower(text)}`;
  }
  if (layout === 'lifestyle') {
    return text;
  }
  return text;
}

function ugcHook(app, claim, index) {
  const hooks = [
    `I finally stuck with it because ${app.name} made it easy`,
    `POV: you stop forgetting and ${lower(claim?.text || 'it just works')}`,
    `Three weeks in and ${app.name} actually changed my routine`,
    `Nobody told me ${app.name} could do this`,
  ];
  return hooks[index % hooks.length];
}

function claimToProofLine(app, claim) {
  if (!claim || !claim.supportingProofIds?.length) {
    return 'Real app proof cutaway';
  }
  const found = app.proofAssets.find((p) => p.id === claim.supportingProofIds[0]);
  return found ? found.label : 'Real app proof cutaway';
}

function lower(value) {
  return String(value || '').charAt(0).toLowerCase() + String(value || '').slice(1);
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function stableHash(source) {
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
