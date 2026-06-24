// Stage 7 — QA (QA Agent).
// Runs deterministic checks over the plan: dimensions, duration, caption/CTA
// presence (OCR-stand-in), proof legibility + fidelity, claim safety, identity
// rules, cost ceiling, and the providerMutations==0 invariant. Emits a verdict
// of pass / hold / retry with structured reasons. Never silently ships.

function check(id, ok, severity, message) {
  return { id, ok, severity, message };
}

export function runQa({ profile, proofLibrary, brief, script, generation, timeline, packRequest }) {
  const checks = [];

  // --- Blocking precondition checks ---
  if (brief.blocked || script.blocked || timeline.blocked) {
    checks.push(check('plan_complete', false, 'blocker', 'Plan incomplete — a prior stage was blocked (missing proof).'));
    return verdict('qa', checks);
  }
  checks.push(check('plan_complete', true, 'info', 'All planning stages produced output.'));

  const comp = timeline.composition;

  // --- Dimensions / duration / codec target ---
  const expected = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] }[packRequest.aspectRatio];
  const dimsOk = expected && comp.dimensions.width === expected[0] && comp.dimensions.height === expected[1];
  checks.push(check('dimensions', Boolean(dimsOk), 'blocker', `Composition ${comp.dimensions.width}x${comp.dimensions.height} for ${packRequest.aspectRatio}.`));

  const durDelta = Math.abs(comp.durationSeconds - packRequest.durationSeconds);
  checks.push(check('duration', durDelta <= 2, 'warn', `Planned ${comp.durationSeconds}s vs requested ${packRequest.durationSeconds}s (±2s).`));
  checks.push(check('codec_target', timeline.renderTask.format === 'mp4', 'warn', `Render format ${timeline.renderTask.format}.`));

  // --- Caption / CTA presence (OCR stand-in over planned caption layers) ---
  const captionLayers = comp.tracks.captions.layers || [];
  const hasHook = captionLayers.some((l) => l.layerId === 'caption_hook' && l.text);
  const hasCta = captionLayers.some((l) => l.layerId === 'caption_cta' && l.text);
  checks.push(check('hook_caption_present', hasHook, 'blocker', hasHook ? `Hook: "${script.hookCaption}"` : 'No hook caption layer.'));
  checks.push(check('cta_present', hasCta, 'blocker', hasCta ? `CTA: "${script.ctaCaption}"` : 'No CTA caption layer.'));
  checks.push(check('app_icon_present', comp.tracks.overlay.layers.some((l) => l.layerId === 'app_icon_cta'), 'warn', 'App icon overlay in CTA window.'));

  // --- Proof fidelity: every proof beat must reference a USABLE raw proof ---
  const usable = new Set(proofLibrary.usableProofIds);
  const proofScenes = comp.scenes.filter((s) => s.proofCutaway);
  const allProofUsable = proofScenes.every((s) => usable.has(s.proofCutaway.proofObjectId));
  checks.push(check('proof_present', proofScenes.length >= 1, 'blocker', `${proofScenes.length} proof cutaway scene(s).`));
  checks.push(check('proof_fidelity', allProofUsable, 'blocker', allProofUsable ? 'All proof cutaways trace to raw usable proof.' : 'A proof cutaway references non-usable/marketing asset.'));

  // OCR legibility stand-in: hero proof must carry OCR text.
  const heroObj = proofLibrary.objects.find((o) => o.proofObjectId === brief.heroProofId);
  checks.push(check('proof_legible', Boolean(heroObj && heroObj.ocrText), 'warn', heroObj?.ocrText ? `Hero proof OCR: "${heroObj.ocrText.slice(0, 48)}…"` : 'Hero proof has no OCR text.'));

  // --- Claim safety: no avoid-list overlaps; claims trace to facts ---
  checks.push(check('avoid_list_clear', script.avoidFlags.length === 0, 'blocker', script.avoidFlags.length ? `${script.avoidFlags.length} line(s) overlap avoid-list.` : 'No avoid-list overlaps in spoken script.'));
  const primaryTraced = Boolean(script.claimTrace.primaryFact);
  checks.push(check('claims_traced', primaryTraced, 'warn', primaryTraced ? `Primary claim traces to: "${script.claimTrace.primaryFact}"` : 'No traced primary fact.'));

  // --- Identity transform rule (>=3 changed attributes) ---
  checks.push(check('identity_changed', generation.identityAttributesChanged >= 3, 'blocker', `Identity transform changed ${generation.identityAttributesChanged} attribute(s); minimum 3.`));

  // --- Cost ceiling ---
  checks.push(check('cost_ceiling', !generation.overCeiling, 'blocker', `Estimate $${generation.estimateUsd} vs ceiling $${packRequest.costCeilingUsd}.`));

  // --- Provider-mutation invariant (the hard safety rail) ---
  const mutations = (generation.providerMutations || 0) + (timeline.renderTask.providerMutations || 0);
  checks.push(check('provider_mutations_zero', mutations === 0, 'blocker', `providerMutations=${mutations} (must be 0 in local mode).`));

  return verdict('qa', checks);
}

function verdict(stage, checks) {
  const blockers = checks.filter((c) => !c.ok && c.severity === 'blocker');
  const warnings = checks.filter((c) => !c.ok && c.severity === 'warn');
  let result;
  if (blockers.length) result = 'hold';
  else if (warnings.length) result = 'pass_with_warnings';
  else result = 'pass';

  return {
    stage,
    verdict: result,
    passed: blockers.length === 0,
    blockers: blockers.map((b) => ({ id: b.id, message: b.message })),
    warnings: warnings.map((w) => ({ id: w.id, message: w.message })),
    checks,
    providerMutations: 0,
  };
}
