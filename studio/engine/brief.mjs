// Stage 3 — Creative Brief (Creative Director Agent).
// Pick format family, hook angle, the proof object the ad will pivot on, target
// duration, and acceptance criteria. Provider-neutral and auditable.
import { stableId } from './util.mjs';

// Hook angle templates keyed by the proof object's visual category. Intelligence
// would normally rank these; here we deterministically pick the strongest match.
const ANGLE_BY_CATEGORY = {
  live_metric: { angle: 'in_the_moment_proof', hook: 'pov: the app is literally coaching me mid-climb' },
  chart: { angle: 'planning_payoff', hook: 'i check this before every run now' },
  score_card: { angle: 'daily_check', hook: 'this number decides if i run hard today' },
  log: { angle: 'consistency_proof', hook: 'my streak is the only reason i kept going' },
  reminder: { angle: 'never_miss', hook: 'it nudges me before i forget' },
  converter: { angle: 'instant_answer', hook: 'no more guessing the math' },
  unknown: { angle: 'discovery', hook: 'found this and had to share' },
};

function pickHeroProof(proofLibrary) {
  // Prefer a usable live_metric, then score_card/chart, then any usable proof.
  const usable = proofLibrary.objects.filter((o) => o.usableAsProof);
  const order = ['live_metric', 'score_card', 'chart', 'log', 'reminder', 'converter'];
  for (const cat of order) {
    const match = usable.find((o) => o.visualCategory === cat);
    if (match) return match;
  }
  return usable[0] || null;
}

export function runBrief(profile, proofLibrary, packRequest) {
  const heroProof = pickHeroProof(proofLibrary);
  const cutawayProof = proofLibrary.objects
    .filter((o) => o.usableAsProof && o.proofObjectId !== heroProof?.proofObjectId)
    .slice(0, 2);

  const angleSpec = ANGLE_BY_CATEGORY[heroProof?.visualCategory] || ANGLE_BY_CATEGORY.unknown;

  const briefId = stableId('brief', `${profile.appId}|${heroProof?.proofObjectId || 'none'}`);

  const acceptanceCriteria = [
    'Hook readable in first 1.5s at 9:16 safe area.',
    'At least one raw proof cutaway visible and legible.',
    'CTA caption + app name present in final 3s.',
    'No claim outside declared product facts.',
    'No fabricated UI; only proof-backed screens shown.',
    `Final duration within ±2s of ${packRequest.durationSeconds}s.`,
  ];

  return {
    stage: 'creative_brief',
    briefId,
    formatFamily: packRequest.formats.includes('ugc_video') ? 'proof_ugc_talking_head' : 'static_proof_ad',
    hookAngle: angleSpec.angle,
    hookConcept: angleSpec.hook,
    heroProofId: heroProof?.proofObjectId || null,
    cutawayProofIds: cutawayProof.map((o) => o.proofObjectId),
    targetDurationSeconds: packRequest.durationSeconds,
    aspectRatio: packRequest.aspectRatio,
    channels: packRequest.channels,
    acceptanceCriteria,
    blocked: !heroProof,
    notes: heroProof ? [] : ['No usable hero proof — brief is blocked until raw proof is added.'],
  };
}
