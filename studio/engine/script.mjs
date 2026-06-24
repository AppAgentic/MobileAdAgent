// Stage 4 — Script + Scene Plan (Script Agent).
// Produce the exact spoken script, hook caption, CTA caption, and proof-cutaway
// beat plan. Every spoken claim must trace to a declared product fact, and the
// script is checked against the avoid-list. This is where "no invented features"
// is enforced before anything renders.
import { stableId, round, wordSet } from './util.mjs';

function factsForProof(proofId, proofLibrary) {
  const obj = proofLibrary.objects.find((o) => o.proofObjectId === proofId);
  if (!obj) return [];
  return obj.supportedFactIds
    .map((fid) => proofLibrary.facts.find((f) => f.factId === fid)?.text)
    .filter(Boolean);
}

// Cheap avoid-list guard: if a script line shares >=2 significant words with an
// avoid clause, flag it for QA rather than shipping silently.
function avoidListHits(line, avoidClaims) {
  const lineWords = wordSet(line);
  const hits = [];
  for (const clause of avoidClaims) {
    const clauseWords = wordSet(clause);
    let overlap = 0;
    for (const w of clauseWords) if (lineWords.has(w)) overlap += 1;
    if (overlap >= 2) hits.push(clause);
  }
  return hits;
}

export function runScript(profile, proofLibrary, brief) {
  if (brief.blocked) {
    return { stage: 'script', blocked: true, beats: [], lines: [], notes: ['Script blocked: no hero proof from brief.'] };
  }

  const heroFacts = factsForProof(brief.heroProofId, proofLibrary);
  const supportFacts = brief.cutawayProofIds.flatMap((id) => factsForProof(id, proofLibrary));
  const primaryFact = heroFacts[0] || profile.productFacts[0] || null;

  // Six-beat emotional arc, but compressed and tied to real proof beats.
  const beats = [
    { id: 'hook', role: 'hook', proofId: null, line: brief.hookConcept },
    {
      id: 'tension',
      role: 'tension',
      proofId: null,
      line: `i used to just guess my ${profile.name.toLowerCase().includes('pace') ? 'pacing' : 'numbers'} and bonk halfway.`,
    },
    {
      id: 'reveal',
      role: 'reveal',
      proofId: brief.heroProofId,
      line: primaryFact ? `then this — ${primaryFact.replace(/\.$/, '').toLowerCase()}.` : 'then this changed it.',
    },
    {
      id: 'proof',
      role: 'proof',
      proofId: brief.cutawayProofIds[0] || brief.heroProofId,
      line: supportFacts[0] ? `look — ${supportFacts[0].replace(/\.$/, '').toLowerCase()}.` : 'and it is right there on screen.',
    },
    {
      id: 'cta',
      role: 'cta',
      proofId: null,
      line: `it's called ${profile.name}. try it before your next run.`,
    },
  ];

  // Distribute beat timings across the target duration.
  const total = brief.targetDurationSeconds;
  const weights = { hook: 0.18, tension: 0.18, reveal: 0.27, proof: 0.22, cta: 0.15 };
  let cursor = 0;
  const timed = beats.map((beat) => {
    const dur = round(total * (weights[beat.role] || 0.2), 2);
    const out = { ...beat, startSeconds: round(cursor, 2), endSeconds: round(cursor + dur, 2), durationSeconds: dur };
    cursor = round(cursor + dur, 2);
    return out;
  });

  // Claim-safety: collect avoid-list hits across all spoken lines.
  const avoidFlags = [];
  for (const beat of timed) {
    const hits = avoidListHits(beat.line, profile.avoidClaims);
    if (hits.length) avoidFlags.push({ beatId: beat.id, line: beat.line, clauses: hits });
  }

  const scriptId = stableId('script', `${brief.briefId}|${timed.map((b) => b.line).join('|')}`);

  return {
    stage: 'script',
    scriptId,
    blocked: false,
    hookCaption: brief.hookConcept,
    ctaCaption: `Get ${profile.name}`,
    spokenWordCount: timed.reduce((n, b) => n + b.line.split(/\s+/).length, 0),
    beats: timed,
    claimTrace: {
      primaryFact,
      heroFacts,
      supportFacts,
    },
    avoidFlags,
    notes: avoidFlags.length ? ['Script lines overlap avoid-list clauses — QA will review.'] : [],
  };
}
