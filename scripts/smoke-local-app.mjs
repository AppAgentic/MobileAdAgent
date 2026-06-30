import { exportManifest, runLocalCreativePipeline } from '../lib/local-pipeline.mjs';

const job = runLocalCreativePipeline();
const manifest = exportManifest(job);

const failures = [];
if (job.providerMutations !== 0) {
  failures.push('providerMutations must be 0');
}
if (job.status !== 'approved_local_mock') {
  failures.push(`expected approved_local_mock, got ${job.status}`);
}
if (!job.stages.some((stage) => stage.id === 'hyperframes_render' && stage.status === 'mocked')) {
  failures.push('hyperframes_render stage missing or not mocked');
}
if (!job.qaReport.checks.every((check) => ['pass', 'warn'].includes(check.status))) {
  failures.push('default sample should not have QA hold checks');
}
if (manifest.output.composition.providerMutations !== 0) {
  failures.push('manifest render providerMutations must be 0');
}

if (failures.length) {
  console.error('Local app smoke failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Local app smoke passed');
console.log(JSON.stringify({
  jobId: job.jobId,
  stages: job.stages.length,
  qaVerdict: job.qaReport.verdict,
  packStatus: job.creativePack.status,
}, null, 2));
