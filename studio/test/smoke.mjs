// Studio smoke test — zero dependencies, runs the pipeline in-process and also
// boots the HTTP server to exercise the API. Asserts the full workflow plus the
// hard safety invariants (providerMutations==0, proof-fidelity, QA gating).
// Exit code 0 on success, 1 on any failed assertion.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runStudioPipeline, sampleIntake, STAGE_ORDER } from '../engine/pipeline.mjs';

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

function deepProviderMutationScan(obj, path = '$') {
  // Recursively confirm every providerMutations / provider_mutations field is 0.
  let bad = [];
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if ((k === 'providerMutations' || k === 'provider_mutations') && v !== 0) {
        bad.push(`${path}.${k}=${v}`);
      }
      bad = bad.concat(deepProviderMutationScan(v, `${path}.${k}`));
    }
  }
  return bad;
}

console.log('1. Happy path (sample intake)');
const job = runStudioPipeline(sampleIntake());
assert(job.jobId?.startsWith('job_'), 'job has stable id');
assert(job.providerMutations === 0, 'job.providerMutations === 0');
assert(STAGE_ORDER.every((s) => job.stages[s]), 'all eight stages produced output');
assert(job.stages.proof_library.usableProofIds.length >= 1, 'proof library has usable raw proof');
assert(job.stages.proof_library.objects.some((o) => !o.usableAsProof), 'marketing collage flagged not-usable');
assert(job.stages.creative_brief.heroProofId, 'brief picked a hero proof');
assert(job.stages.script.beats.length >= 5, 'script has full beat arc');
assert(job.stages.generation.backendId === 'kling-v3-pro-i2v', 'generation uses our pipeline backend (not heygen)');
assert(job.stages.generation.tasks.every((t) => t.status === 'planned'), 'generation tasks are plan-only');
assert(job.stages.timeline.composition.engine === 'hyperframes', 'timeline is HyperFrames-first');
assert(job.stages.timeline.renderTask.backendId === 'heygen-hyperframes-cloud', 'finishing backend is a RenderBackend only');
assert(job.stages.qa.passed === true, 'QA passes on the clean sample');
assert(job.manifest.exportState === 'ready_to_export', 'manifest ready to export');
assert(job.manifest.sourceProofIds.length >= 1, 'manifest carries source proof ids');

const mutationLeaks = deepProviderMutationScan(job);
assert(mutationLeaks.length === 0, `no providerMutations leaks (${mutationLeaks.join(', ') || 'clean'})`);

console.log('2. Determinism (same input -> same ids/fingerprint)');
const job2 = runStudioPipeline(sampleIntake());
assert(job2.jobId === job.jobId, 'job id is deterministic');
assert(job2.manifest.contentFingerprint === job.manifest.contentFingerprint, 'manifest fingerprint is deterministic');

console.log('3. Safety gating: no proof -> blocked, no export');
const noProof = runStudioPipeline({ ...sampleIntake(), proofAssets: [] });
assert(noProof.status === 'blocked_no_proof', 'empty proof library blocks the job');
assert(noProof.stages.qa.passed === false, 'QA holds when no proof');
assert(noProof.manifest.exportState === 'held', 'no export when held');
assert(noProof.providerMutations === 0, 'blocked job still providerMutations 0');

console.log('4. Safety gating: marketing-only proof is not usable');
const marketingOnly = runStudioPipeline({
  ...sampleIntake(),
  proofAssets: [
    { label: 'store collage', kind: 'store_screenshot', source: 'x/store.png', ocrText: 'BUY NOW', dimensions: { width: 1, height: 1 }, visualCategory: 'marketing_collage', supportsFacts: [] },
  ],
});
assert(marketingOnly.stages.proof_library.usableProofIds.length === 0, 'store screenshot not usable as proof');
assert(marketingOnly.status === 'blocked_no_proof', 'marketing-only intake is blocked');

console.log('5. Safety gating: identity transform < 3 attrs holds QA');
const weakIdentity = runStudioPipeline({
  ...sampleIntake(),
  creatorProfile: { creatorProfileId: 'c1', rightsStatus: 'approved', identityTransform: { hairColorStyle: 'red' } },
});
assert(weakIdentity.stages.generation.identityAttributesChanged < 3, 'weak identity detected');
assert(weakIdentity.stages.qa.passed === false, 'weak identity holds QA');

console.log('6. Cost ceiling holds QA');
const tightCeiling = runStudioPipeline({ ...sampleIntake(), pack: { ...sampleIntake().pack, costCeilingUsd: 1 } });
assert(tightCeiling.stages.generation.overCeiling === true, 'estimate exceeds $1 ceiling');
assert(tightCeiling.stages.qa.passed === false, 'over-ceiling holds QA');

console.log('7. HTTP API smoke');
await httpSmoke();

console.log('');
if (failures) {
  console.error(`SMOKE FAILED: ${failures} assertion(s)`);
  process.exit(1);
} else {
  console.log('SMOKE PASSED: all assertions green, providerMutations=0 throughout.');
  process.exit(0);
}

async function httpSmoke() {
  const serverPath = fileURLToPath(new URL('../server/server.mjs', import.meta.url));
  const testPort = 3199;
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(testPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForListen(child, testPort);
    const base = `http://127.0.0.1:${testPort}`;

    const health = await (await fetch(`${base}/api/health`)).json();
    assert(health.ok === true && health.providerMutations === 0, 'GET /api/health ok, mutations 0');

    const runRes = await fetch(`${base}/api/run-sample`, { method: 'POST' });
    const runJob = await runRes.json();
    assert(runJob.jobId === job.jobId, 'POST /api/run-sample matches in-process job id');
    assert(runJob.manifest.exportState === 'ready_to_export', 'API job ready to export');

    const idx = await fetch(`${base}/`);
    assert(idx.status === 200 && (idx.headers.get('content-type') || '').includes('text/html'), 'GET / serves the web UI');
  } finally {
    child.kill('SIGKILL');
  }
}

function waitForListen(child, port) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 5000);
    const tryConnect = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (r.ok) {
          clearTimeout(timer);
          resolve();
          return;
        }
      } catch {
        // not up yet
      }
      setTimeout(tryConnect, 120);
    };
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code})`));
    });
    tryConnect();
  });
}
