import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const requiredPaths = [
  'apphosting.yaml',
  'local-app/index.html',
  'scripts/local-app-server.mjs',
  'lib/firebase-admin.mjs',
  'lib/firestore-tenant-store.mjs',
  'lib/server-auth.mjs',
];

for (const path of requiredPaths) {
  await access(path);
}

for (const file of [
  'scripts/local-app-server.mjs',
  'lib/firebase-admin.mjs',
  'lib/firestore-tenant-store.mjs',
  'lib/server-auth.mjs',
  'lib/creative-job-model.mjs',
  'lib/generation-adapters.mjs',
  'lib/local-job-runner.mjs',
  'lib/script-agent.mjs',
  'lib/script-agent-adapter.mjs',
]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('App Hosting build check passed');
