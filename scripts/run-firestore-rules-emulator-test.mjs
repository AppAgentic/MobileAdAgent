import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REQUIRED_JAVA_MAJOR = 21;

const javaHome = findJavaHome();

if (!javaHome) {
  console.error([
    `Firebase emulator tests require JDK ${REQUIRED_JAVA_MAJOR}+`,
    'Install JDK 21 or newer, or set JAVA_HOME to a compatible runtime.',
    'Homebrew example: brew install openjdk@21',
  ].join('\n'));
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH || ''}`,
};

const result = spawnSync('firebase', [
  'emulators:exec',
  '--only',
  'firestore',
  '--project',
  'mobileadagent',
  'node scripts/firestore-rules-emulator-test.mjs',
], {
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function findJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    '/opt/homebrew/opt/openjdk@21',
    '/usr/local/opt/openjdk@21',
    '/opt/homebrew/opt/openjdk',
    '/usr/local/opt/openjdk',
    '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
    '/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const javaPath = join(candidate, 'bin', 'java');
    if (!existsSync(javaPath)) {
      continue;
    }

    const version = spawnSync(javaPath, ['-version'], { encoding: 'utf8' });
    const output = `${version.stdout || ''}\n${version.stderr || ''}`;
    if (javaMajor(output) >= REQUIRED_JAVA_MAJOR) {
      return candidate;
    }
  }

  return null;
}

function javaMajor(versionOutput) {
  const match = versionOutput.match(/version\s+"(?<major>\d+)/);
  return Number(match?.groups?.major || 0);
}
