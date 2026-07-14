const STAGE_ORDER = [
  'app_intake',
  'proof_agent',
  'creative_director',
  'script_agent',
  'generation_worker',
  'proof_prep',
  'timeline_render',
  'qa_agent',
  'pack_export',
];

const DEFAULT_PROFILE = {
  name: 'PepMod',
  storeUrl: 'https://apps.apple.com/us/app/pepmod/id0000000000',
  audience: 'People tracking peptide protocols, reminders, and progress.',
  channel: 'TikTok / Reels 9:16',
  objective: 'Create a proof-driven UGC ad that shows protocol logging and reminder value.',
  avoidList: 'No medical outcome promises. No weight-loss claims. No fake app UI.',
};

const DEFAULT_PROOFS = [
  {
    id: 'proof-protocol-log',
    label: 'Protocol log',
    type: 'screen',
    trustLevel: 'raw_app_proof',
    source: 'sample/local/protocol-log.png',
    claim: 'Users can log protocol doses and schedule details.',
    ocr: 'Today - Protocol - Dose logged - Next reminder',
    visualCategory: 'log',
  },
  {
    id: 'proof-reminder-card',
    label: 'Reminder card',
    type: 'screen',
    trustLevel: 'raw_app_proof',
    source: 'sample/local/reminder-card.png',
    claim: 'Users can see upcoming reminders.',
    ocr: 'Next reminder - 7:30 PM - Check-in',
    visualCategory: 'reminder',
  },
  {
    id: 'proof-progress-chart',
    label: 'Progress chart',
    type: 'screen',
    trustLevel: 'raw_app_proof',
    source: 'sample/local/progress-chart.png',
    claim: 'Users can review tracked protocol history.',
    ocr: 'Progress - Weekly consistency - 86%',
    visualCategory: 'chart',
  },
];

const DEFAULT_CONSTRAINTS = {
  durationSeconds: 15,
  dimensions: { width: 1080, height: 1920 },
  fps: 30,
  renderBackend: 'local-timeline-preview',
  generationBackend: 'local-mock-generation',
  providerMutations: 0,
};

export function createSampleState() {
  return {
    appProfile: { ...DEFAULT_PROFILE },
    proofAssets: DEFAULT_PROOFS.map((proof) => ({ ...proof })),
    constraints: { ...DEFAULT_CONSTRAINTS, dimensions: { ...DEFAULT_CONSTRAINTS.dimensions } },
  };
}

export function runLocalCreativePipeline(input = {}) {
  const sample = createSampleState();
  const appProfile = normalizeProfile(input.appProfile || sample.appProfile);
  const proofAssets = normalizeProofAssets(input.proofAssets || sample.proofAssets);
  const constraints = normalizeConstraints(input.constraints || sample.constraints);
  const now = new Date().toISOString();
  const jobId = createStableJobId(appProfile, proofAssets, constraints);

  const selectedProofs = proofAssets.slice(0, 3);
  const proofHoldReasons = [];
  if (!appProfile.name) {
    proofHoldReasons.push('Missing app name.');
  }
  if (!selectedProofs.length) {
    proofHoldReasons.push('At least one real app proof asset is required.');
  }
  const unsupportedClaims = findUnsupportedClaims(appProfile, selectedProofs);
  proofHoldReasons.push(...unsupportedClaims);

  const brief = buildCreativeBrief(appProfile, selectedProofs, constraints);
  const script = buildScript(appProfile, brief, selectedProofs);
  const generatedMedia = buildGeneratedMedia(appProfile, constraints);
  const proofPrep = buildProofPrep(selectedProofs);
  const composition = buildHyperFramesComposition({
    appProfile,
    brief,
    script,
    generatedMedia,
    proofPrep,
    constraints,
  });
  const qaReport = buildQaReport({
    appProfile,
    selectedProofs,
    script,
    composition,
    constraints,
    holdReasons: proofHoldReasons,
  });
  const creativePack = buildCreativePack({
    jobId,
    appProfile,
    selectedProofs,
    script,
    composition,
    qaReport,
    constraints,
    createdAt: now,
  });
  const stages = buildStages({
    appProfile,
    selectedProofs,
    brief,
    script,
    generatedMedia,
    proofPrep,
    composition,
    qaReport,
    creativePack,
    holdReasons: proofHoldReasons,
  });

  return {
    jobId,
    status: qaReport.verdict === 'pass' ? 'approved_local_mock' : 'hold',
    mode: 'local_mock',
    providerMutations: 0,
    createdAt: now,
    appProfile,
    proofAssets,
    selectedProofIds: selectedProofs.map((proof) => proof.id),
    constraints,
    stages,
    brief,
    script,
    generatedMedia,
    proofPrep,
    composition,
    qaReport,
    creativePack,
    costLedger: buildCostLedger(constraints),
  };
}

export function exportManifest(job) {
  return {
    schemaVersion: 'local-mobile-ad-agent-manifest.v1',
    jobId: job.jobId,
    mode: job.mode,
    status: job.status,
    providerMutations: job.providerMutations,
    app: {
      name: job.appProfile.name,
      storeUrl: job.appProfile.storeUrl,
      audience: job.appProfile.audience,
      channel: job.appProfile.channel,
    },
    inputs: {
      proofAssetIds: job.selectedProofIds,
      constraints: job.constraints,
    },
    output: {
      creativePack: job.creativePack,
      qaReport: job.qaReport,
      composition: job.composition,
    },
    audit: {
      generatedAt: job.createdAt,
      note: 'Local mock manifest. No provider calls, no R2 writes, no ad-network mutations.',
    },
  };
}

function normalizeProfile(profile) {
  return {
    name: stringValue(profile.name || DEFAULT_PROFILE.name),
    storeUrl: stringValue(profile.storeUrl || ''),
    audience: stringValue(profile.audience || DEFAULT_PROFILE.audience),
    channel: stringValue(profile.channel || DEFAULT_PROFILE.channel),
    objective: stringValue(profile.objective || DEFAULT_PROFILE.objective),
    avoidList: stringValue(profile.avoidList || DEFAULT_PROFILE.avoidList),
  };
}

function normalizeProofAssets(proofs) {
  if (!Array.isArray(proofs)) {
    return [];
  }

  return proofs
    .filter((proof) => proof && typeof proof === 'object')
    .map((proof, index) => {
      const id = stringValue(proof.id || `proof-${index + 1}`);
      return {
        id,
        label: stringValue(proof.label || `Proof ${index + 1}`),
        type: stringValue(proof.type || 'screen'),
        trustLevel: stringValue(proof.trustLevel || 'raw_app_proof'),
        source: stringValue(proof.source || 'local/browser'),
        claim: stringValue(proof.claim || 'Real app proof uploaded by the operator.'),
        ocr: stringValue(proof.ocr || ''),
        visualCategory: stringValue(proof.visualCategory || 'screen'),
      };
    });
}

function normalizeConstraints(constraints) {
  const durationSeconds = clampNumber(constraints.durationSeconds, 6, 30, DEFAULT_CONSTRAINTS.durationSeconds);
  const fps = clampNumber(constraints.fps, 24, 60, DEFAULT_CONSTRAINTS.fps);
  return {
    durationSeconds,
    dimensions: {
      width: clampNumber(constraints.dimensions?.width, 720, 2160, DEFAULT_CONSTRAINTS.dimensions.width),
      height: clampNumber(constraints.dimensions?.height, 1280, 3840, DEFAULT_CONSTRAINTS.dimensions.height),
    },
    fps,
    renderBackend: stringValue(constraints.renderBackend || DEFAULT_CONSTRAINTS.renderBackend),
    generationBackend: stringValue(constraints.generationBackend || DEFAULT_CONSTRAINTS.generationBackend),
    providerMutations: 0,
  };
}

function buildCreativeBrief(appProfile, proofs, constraints) {
  const primaryProof = proofs[0];
  return {
    formatFamily: 'problem-proof-cta-ugc',
    channel: appProfile.channel,
    durationSeconds: constraints.durationSeconds,
    hookAngle: `Stop losing track of ${appProfile.name} actions.`,
    primaryProofId: primaryProof?.id || null,
    acceptanceCriteria: [
      'Uses only real proof assets from the proof library.',
      'Shows a human-readable problem in the first 3 seconds.',
      'Moves proof cutaways through timeline assembly.',
      'Avoids unsupported health, income, or outcome claims.',
      'Exports manifest, contact sheet spec, first-frame spec, and QA verdict.',
    ],
  };
}

function buildScript(appProfile, brief, proofs) {
  const proofLabel = proofs[0]?.label || 'the app screen';
  return {
    spokenLines: [
      `I kept forgetting what I logged in ${appProfile.name}.`,
      `Now I can see ${proofLabel.toLowerCase()} and what is coming next.`,
      'It keeps the routine visible without turning it into a spreadsheet.',
    ],
    captions: [
      {
        id: 'caption-hook',
        start: 0,
        end: 3,
        text: `Stop losing track of ${appProfile.name}`,
        role: 'hook',
      },
      {
        id: 'caption-proof',
        start: 5,
        end: 10,
        text: 'Real app proof, not fake UI',
        role: 'proof',
      },
      {
        id: 'caption-cta',
        start: 12,
        end: 15,
        text: `Try ${appProfile.name}`,
        role: 'cta',
      },
    ],
    claimReferences: proofs.map((proof) => ({
      proofId: proof.id,
      supportedClaim: proof.claim,
    })),
    avoidList: appProfile.avoidList,
    briefId: brief.formatFamily,
  };
}

function buildGeneratedMedia(appProfile, constraints) {
  return {
    backendId: constraints.generationBackend,
    mode: 'mock_no_provider_call',
    segments: [
      {
        id: 'creator-hook',
        start: 0,
        end: 4,
        type: 'creator_video',
        description: `Creator opens with a specific ${appProfile.name} tracking problem.`,
      },
      {
        id: 'creator-context',
        start: 4,
        end: 8,
        type: 'creator_video',
        description: 'Creator points to the phone before proof cutaway enters.',
      },
      {
        id: 'creator-payoff',
        start: 10,
        end: constraints.durationSeconds,
        type: 'creator_video',
        description: 'Creator lands the payoff and CTA.',
      },
    ],
  };
}

function buildProofPrep(proofs) {
  return {
    mode: 'metadata_only',
    assets: proofs.map((proof, index) => ({
      proofId: proof.id,
      start: 4 + index * 2,
      end: Math.min(10 + index, 7 + index * 2),
      crop: {
        x: 80 + index * 24,
        y: 160 + index * 20,
        width: 920 - index * 32,
        height: 1240 - index * 28,
      },
      treatment: index === 0 ? 'full-phone-contained' : 'floating-proof-panel',
      label: proof.label,
    })),
  };
}

function buildHyperFramesComposition({ appProfile, brief, script, generatedMedia, proofPrep, constraints }) {
  const layers = [];
  generatedMedia.segments.forEach((segment) => {
    layers.push({
      id: segment.id,
      type: 'video',
      start: segment.start,
      duration: segment.end - segment.start,
      source: 'mock-creator-segment',
    });
  });
  proofPrep.assets.forEach((asset) => {
    layers.push({
      id: `proof-layer-${asset.proofId}`,
      type: 'proof_media',
      start: asset.start,
      duration: asset.end - asset.start,
      proofId: asset.proofId,
      crop: asset.crop,
      treatment: asset.treatment,
    });
  });
  script.captions.forEach((caption) => {
    layers.push({
      id: caption.id,
      type: 'caption',
      start: caption.start,
      duration: caption.end - caption.start,
      text: caption.text,
      role: caption.role,
    });
  });
  layers.push({
    id: 'cta-lockup',
    type: 'cta',
    start: Math.max(0, constraints.durationSeconds - 3),
    duration: 3,
    text: `Download ${appProfile.name}`,
  });

  return {
    backendId: constraints.renderBackend,
    compositionKey: `local/compositions/${slug(appProfile.name)}-${brief.formatFamily}.zip`,
    variablesKey: `local/variables/${slug(appProfile.name)}-${Date.now()}.json`,
    dimensions: constraints.dimensions,
    fps: constraints.fps,
    durationSeconds: constraints.durationSeconds,
    providerMutations: 0,
    timeline: layers.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)),
  };
}

function buildQaReport({ appProfile, selectedProofs, script, composition, constraints, holdReasons }) {
  const checks = [
    {
      id: 'provider_mutations',
      label: 'Provider mutations',
      status: 'pass',
      detail: 'Local run records providerMutations=0.',
    },
    {
      id: 'proof_exists',
      label: 'Proof exists',
      status: selectedProofs.length ? 'pass' : 'hold',
      detail: selectedProofs.length ? `${selectedProofs.length} proof assets selected.` : 'No proof asset selected.',
    },
    {
      id: 'no_fake_ui',
      label: 'No fake UI',
      status: selectedProofs.every((proof) => proof.trustLevel === 'raw_app_proof') ? 'pass' : 'warn',
      detail: 'Only proof assets marked raw_app_proof are accepted as app UI.',
    },
    {
      id: 'duration',
      label: 'Duration',
      status: composition.durationSeconds <= 30 ? 'pass' : 'hold',
      detail: `${composition.durationSeconds}s at ${constraints.fps}fps.`,
    },
    {
      id: 'caption_ocr',
      label: 'Caption OCR',
      status: script.captions.every((caption) => caption.text.length <= 48) ? 'pass' : 'warn',
      detail: 'Mock check: captions are short enough for OCR review.',
    },
    {
      id: 'claim_boundary',
      label: 'Claim boundary',
      status: holdReasons.length ? 'hold' : 'pass',
      detail: holdReasons.length ? holdReasons.join(' ') : `Claims are tied to ${appProfile.name} proof assets.`,
    },
  ];

  const held = checks.some((check) => check.status === 'hold');
  return {
    verdict: held ? 'hold' : 'pass',
    reviewer: 'local-qa-agent',
    checks,
    notes: held
      ? 'Held locally. Fix the proof/profile inputs and rerun.'
      : 'Local QA pass. This is still mock output and needs real media QA before launch.',
  };
}

function buildCreativePack({ jobId, appProfile, selectedProofs, script, composition, qaReport, constraints, createdAt }) {
  return {
    packId: `pack-${jobId}`,
    createdAt,
    status: qaReport.verdict === 'pass' ? 'ready_for_review' : 'held',
    files: [
      {
        name: 'manifest.json',
        type: 'application/json',
        role: 'audit',
      },
      {
        name: `${slug(appProfile.name)}-local-preview.mp4`,
        type: 'video/mp4',
        role: 'placeholder_render',
      },
      {
        name: `${slug(appProfile.name)}-contact-sheet.jpg`,
        type: 'image/jpeg',
        role: 'contact_sheet_spec',
      },
      {
        name: `${slug(appProfile.name)}-first-frame.jpg`,
        type: 'image/jpeg',
        role: 'thumbnail_spec',
      },
    ],
    summary: {
      appName: appProfile.name,
      selectedProofs: selectedProofs.map((proof) => proof.label),
      captionCount: script.captions.length,
      layerCount: composition.timeline.length,
      dimensions: `${constraints.dimensions.width}x${constraints.dimensions.height}`,
      durationSeconds: constraints.durationSeconds,
    },
  };
}

function buildStages({
  appProfile,
  selectedProofs,
  brief,
  script,
  generatedMedia,
  proofPrep,
  composition,
  qaReport,
  creativePack,
  holdReasons,
}) {
  const stageData = {
    app_intake: {
      label: 'App Intake',
      status: appProfile.name ? 'complete' : 'hold',
      output: `${appProfile.name || 'Unnamed app'} profile prepared for ${appProfile.channel}.`,
    },
    proof_agent: {
      label: 'Proof Agent',
      status: selectedProofs.length ? 'complete' : 'hold',
      output: selectedProofs.length
        ? `${selectedProofs.length} proof assets verified as source inventory.`
        : 'No proof assets available.',
    },
    creative_director: {
      label: 'Creative Director',
      status: selectedProofs.length ? 'complete' : 'blocked',
      output: `${brief.formatFamily}: ${brief.hookAngle}`,
    },
    script_agent: {
      label: 'Script Agent',
      status: script.captions.length ? 'complete' : 'hold',
      output: `${script.spokenLines.length} spoken lines, ${script.captions.length} captions, ${script.claimReferences.length} claim references.`,
    },
    generation_worker: {
      label: 'Generation Worker',
      status: 'mocked',
      output: `${generatedMedia.segments.length} creator media segments planned via ${generatedMedia.backendId}.`,
    },
    proof_prep: {
      label: 'Proof Prep',
      status: proofPrep.assets.length ? 'complete' : 'hold',
      output: `${proofPrep.assets.length} proof beats cropped/timestamped for the timeline render.`,
    },
    timeline_render: {
      label: 'Timeline Render',
      status: 'mocked',
      output: `${composition.timeline.length} timeline layers in ${composition.backendId}.`,
    },
    qa_agent: {
      label: 'QA Agent',
      status: qaReport.verdict === 'pass' ? 'complete' : 'hold',
      output: `${qaReport.verdict.toUpperCase()}: ${qaReport.notes}`,
    },
    pack_export: {
      label: 'Pack Export',
      status: qaReport.verdict === 'pass' ? 'complete' : 'blocked',
      output: `${creativePack.files.length} output specs ready in ${creativePack.packId}.`,
    },
  };

  if (holdReasons.length) {
    stageData.proof_agent.output = holdReasons.join(' ');
  }

  return STAGE_ORDER.map((id, index) => ({
    id,
    order: index + 1,
    ...stageData[id],
  }));
}

function buildCostLedger(constraints) {
  return {
    currency: 'USD',
    mode: 'local_mock',
    estimatedProviderCost: 0,
    actualProviderCost: 0,
    lineItems: [
      {
        stage: 'generation_worker',
        backend: constraints.generationBackend,
        estimatedCost: 0,
        note: 'Mocked locally; no provider call.',
      },
      {
        stage: 'timeline_render',
        backend: constraints.renderBackend,
        estimatedCost: 0,
        note: 'Mocked locally; no external render call.',
      },
      {
        stage: 'qa_agent',
        backend: 'local-rules',
        estimatedCost: 0,
        note: 'No external QA model call in local prototype.',
      },
    ],
  };
}

function findUnsupportedClaims(profile, proofs) {
  const avoid = `${profile.avoidList} ${profile.objective}`.toLowerCase();
  const blockedTerms = ['cure', 'guaranteed', 'diagnose', 'treat disease', 'medical outcome'];
  const reasons = [];
  blockedTerms.forEach((term) => {
    if (avoid.includes(term)) {
      return;
    }
  });
  proofs.forEach((proof) => {
    const claim = proof.claim.toLowerCase();
    if (claim.includes('cure') || claim.includes('guaranteed') || claim.includes('diagnose')) {
      reasons.push(`Unsupported claim risk in ${proof.label}.`);
    }
  });
  return reasons;
}

function createStableJobId(profile, proofs, constraints) {
  const source = `${profile.name}|${proofs.map((proof) => proof.id).join(',')}|${constraints.durationSeconds}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `local-job-${hash.toString(16).padStart(8, '0')}`;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function stringValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function slug(value) {
  return stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'mobile-ad-agent';
}
