// Stage 8 — Pack + Manifest Export.
// Assemble the downloadable creative-pack manifest: planned artifacts, source
// proof IDs, QA verdict, cost ledger, and platform notes. This is the export
// SHAPE — local mode plans R2 object keys but writes no provider artifacts.
import { stableId, fingerprint } from './util.mjs';

export function runPack({ profile, packRequest, proofLibrary, brief, script, generation, timeline, qa }) {
  const packId = stableId('pack', `${profile.appId}|${script.scriptId || 'none'}`);
  const jobReady = qa.passed && !script.blocked;

  const keyPrefix = `orgs/local/apps/${profile.appId}/packs/${packId}`;

  // Planned artifacts (object keys only — nothing is uploaded in local mode).
  const artifacts = [];
  if (!timeline.blocked) {
    artifacts.push(
      { type: 'video_mp4', keyPlan: `${keyPrefix}/renders/${timeline.renderTask.taskId}/output.mp4`, status: 'planned' },
      { type: 'first_frame', keyPlan: `${keyPrefix}/renders/${timeline.renderTask.taskId}/first-frame.png`, status: 'planned' },
      { type: 'thumbnail', keyPlan: `${keyPrefix}/renders/${timeline.renderTask.taskId}/thumbnail.png`, status: 'planned' },
      { type: 'contact_sheet', keyPlan: `${keyPrefix}/qa/contact-sheet.jpg`, status: 'planned' },
      { type: 'composition_zip', keyPlan: timeline.composition.bundlePlan.compositionZipKeyPlan, status: 'planned' },
      { type: 'qa_report', keyPlan: `${keyPrefix}/qa/qaReport.json`, status: 'planned' },
      { type: 'manifest', keyPlan: `${keyPrefix}/manifest.json`, status: 'planned' },
    );
  }

  const costLedger = {
    generationEstimateUsd: generation.estimateUsd,
    finishingEstimateUsd: timeline.blocked ? 0 : timeline.renderTask.estimatedCostUsd,
    totalEstimateUsd: Number((generation.estimateUsd + (timeline.blocked ? 0 : timeline.renderTask.estimatedCostUsd)).toFixed(4)),
    costCeilingUsd: packRequest.costCeilingUsd,
    actualUsd: 0, // nothing executed locally
  };

  const platformNotes = packRequest.channels.map((channel) => ({
    channel,
    aspectRatio: packRequest.aspectRatio,
    note: `${packRequest.aspectRatio} ${timeline.blocked ? '—' : timeline.composition.durationSeconds + 's'} suited for ${channel}; captions inside safe area.`,
  }));

  const manifest = {
    manifestVersion: 1,
    packId,
    app: { appId: profile.appId, name: profile.name },
    deliverable: {
      formats: packRequest.formats,
      aspectRatio: packRequest.aspectRatio,
      durationSeconds: timeline.blocked ? null : timeline.composition.durationSeconds,
      channels: packRequest.channels,
    },
    sourceProofIds: Array.from(
      new Set([brief.heroProofId, ...brief.cutawayProofIds].filter(Boolean)),
    ),
    generation: {
      backendId: generation.backendId || null,
      taskCount: generation.tasks.length,
      providerMutations: 0,
    },
    finishing: timeline.blocked
      ? null
      : { backendId: timeline.renderTask.backendId, compositionId: timeline.composition.compositionId, providerMutations: 0 },
    qa: { verdict: qa.verdict, passed: qa.passed, blockers: qa.blockers.length, warnings: qa.warnings.length },
    costLedger,
    platformNotes,
    artifacts,
    exportState: jobReady ? 'ready_to_export' : 'held',
    providerMutations: 0,
  };

  manifest.contentFingerprint = fingerprint(manifest);

  return {
    stage: 'pack',
    packId,
    jobReady,
    manifest,
    notes: jobReady
      ? ['Pack manifest ready; export would write artifacts to R2 and offer a download zip.']
      : ['Pack held — QA did not pass; no export offered.'],
  };
}
