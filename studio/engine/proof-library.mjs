// Stage 2 — Proof Library (Proof Agent).
// Classify uploaded proof assets, assign trust levels, and link supported facts.
// No fabricated UI ever enters the library; marketing collages are flagged
// untrusted-for-proof. Mirrors the architecture's `proofObjects/{id}` shape.
import { stableId } from './util.mjs';

// Map of raw asset kind -> default trust level for proof use.
const TRUST_BY_KIND = {
  raw_screenshot: 'raw',
  screen_recording_clip: 'raw',
  cropped_proof: 'raw',
  rawified_store_screenshot: 'rawified',
  store_screenshot: 'marketing',
};

function classifyOne(asset, factIndex) {
  const kind = TRUST_BY_KIND[asset.kind] ? asset.kind : 'raw_screenshot';
  const trustLevel = TRUST_BY_KIND[kind];

  // Only facts that the app actually declares can be "supported".
  const claimedFacts = Array.isArray(asset.supportsFacts) ? asset.supportsFacts : [];
  const supportedFactIds = [];
  const unsupportedClaims = [];
  for (const fact of claimedFacts) {
    const id = factIndex.get(fact.trim());
    if (id) supportedFactIds.push(id);
    else unsupportedClaims.push(fact.trim());
  }

  const usableAsProof = trustLevel === 'raw' || trustLevel === 'rawified';
  const unsafeReasons = [];
  if (!usableAsProof) {
    unsafeReasons.push(
      `Trust level "${trustLevel}" — marketing/store collage, not usable as raw proof. Rawify or upload a raw screen.`,
    );
  }
  if (unsupportedClaims.length) {
    unsafeReasons.push(`Claims not in product facts: ${unsupportedClaims.join('; ')}`);
  }

  return {
    proofObjectId: stableId('proof', `${asset.label}|${asset.source}`),
    label: String(asset.label || 'Untitled proof'),
    kind,
    trustLevel,
    source: String(asset.source || ''),
    r2KeyPlan: null, // deterministic rails would assign on real upload; null in local mode
    dimensions: asset.dimensions || { width: 0, height: 0 },
    ocrText: String(asset.ocrText || ''),
    visualCategory: String(asset.visualCategory || 'unknown'),
    supportedFactIds,
    usableAsProof,
    unsafeReasons,
  };
}

export function runProofLibrary(profile, proofAssets = []) {
  // Index declared facts so proof claims can only reference real facts.
  const factIndex = new Map();
  profile.productFacts.forEach((fact, i) => {
    factIndex.set(fact.trim(), stableId('fact', `${profile.appId}|${i}|${fact}`));
  });

  const objects = proofAssets.map((asset) => classifyOne(asset, factIndex));
  const usable = objects.filter((o) => o.usableAsProof);

  const notes = [];
  if (usable.length === 0) {
    notes.push('No usable raw proof — pipeline cannot ship a proof-driven ad. Add raw screenshots.');
  }
  const flagged = objects.filter((o) => !o.usableAsProof);
  if (flagged.length) {
    notes.push(`${flagged.length} asset(s) flagged not-usable-as-proof (marketing/store or unsupported claim).`);
  }

  return {
    stage: 'proof_library',
    facts: Array.from(factIndex.entries()).map(([text, id]) => ({ factId: id, text })),
    objects,
    usableProofIds: usable.map((o) => o.proofObjectId),
    notes,
  };
}
