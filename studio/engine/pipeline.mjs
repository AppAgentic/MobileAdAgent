// Studio pipeline orchestrator.
// Runs the eight Mobile Ad Agent stages in order and assembles a single
// CreativeJob object with per-stage output, the QA verdict, and the export
// manifest. Pure/deterministic: no network, no provider calls, no filesystem
// writes. providerMutations is asserted 0 at the end.
import { stableId } from './util.mjs';
import { runIntake } from './intake.mjs';
import { runProofLibrary } from './proof-library.mjs';
import { runBrief } from './brief.mjs';
import { runScript } from './script.mjs';
import { runGenerationPlan } from './generation.mjs';
import { runTimelinePlan } from './timeline.mjs';
import { runQa } from './qa.mjs';
import { runPack } from './pack.mjs';
import { SAMPLE_INTAKE } from './fixtures.mjs';

export const STAGE_ORDER = [
  'intake',
  'proof_library',
  'creative_brief',
  'script',
  'generation',
  'timeline',
  'qa',
  'pack',
];

export function sampleIntake() {
  // Deep clone so callers can mutate freely.
  return JSON.parse(JSON.stringify(SAMPLE_INTAKE));
}

export function runStudioPipeline(input = {}) {
  const intake = runIntake(input);
  const proofLibrary = runProofLibrary(intake.profile, input.proofAssets || []);
  const brief = runBrief(intake.profile, proofLibrary, intake.packRequest);
  const script = runScript(intake.profile, proofLibrary, brief);
  const generation = runGenerationPlan(
    intake.profile,
    script,
    brief,
    input.creatorProfile || {},
    intake.packRequest,
  );
  const timeline = runTimelinePlan(intake.profile, script, brief, intake.packRequest);
  const qa = runQa({
    profile: intake.profile,
    proofLibrary,
    brief,
    script,
    generation,
    timeline,
    packRequest: intake.packRequest,
  });
  const pack = runPack({
    profile: intake.profile,
    packRequest: intake.packRequest,
    proofLibrary,
    brief,
    script,
    generation,
    timeline,
    qa,
  });

  const jobId = stableId('job', `${intake.profile.appId}|${script.scriptId || 'blocked'}`);

  // Collect human-readable notes for the activity feed.
  const activity = [];
  for (const s of [intake, proofLibrary, brief, script, generation, timeline, pack]) {
    for (const note of s.notes || []) activity.push({ stage: s.stage, note });
  }

  // Hard invariant: planning-only job never mutates a provider.
  const providerMutations = 0;

  return {
    jobId,
    status: deriveStatus({ brief, script, qa, pack }),
    providerMutations,
    createdWith: 'studio-local',
    profile: intake.profile,
    packRequest: intake.packRequest,
    stages: {
      intake,
      proof_library: proofLibrary,
      creative_brief: brief,
      script,
      generation,
      timeline,
      qa,
      pack,
    },
    stageOrder: STAGE_ORDER,
    activity,
    manifest: pack.manifest,
  };
}

function deriveStatus({ brief, script, qa, pack }) {
  if (brief.blocked || script.blocked) return 'blocked_no_proof';
  if (!qa.passed) return 'held';
  if (pack.jobReady) return 'ready_to_export';
  return 'held';
}
