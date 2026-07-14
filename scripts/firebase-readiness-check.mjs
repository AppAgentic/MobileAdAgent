import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'mobileadagent';
const GCLOUD_CONFIG = process.env.GCLOUD_CONFIG || 'app-agentic';
const APP_HOSTING_LOCATION = process.env.FIREBASE_APP_HOSTING_LOCATION || 'us-central1';
const APP_HOSTING_BACKEND_ID = process.env.FIREBASE_APP_HOSTING_BACKEND_ID || 'mobileadagent-web';

const REQUIRED_SERVICES = [
  'artifactregistry.googleapis.com',
  'cloudbuild.googleapis.com',
  'firebase.googleapis.com',
  'firebaseapphosting.googleapis.com',
  'firestore.googleapis.com',
  'firebaserules.googleapis.com',
  'identitytoolkit.googleapis.com',
  'run.googleapis.com',
  'securetoken.googleapis.com',
  'secretmanager.googleapis.com',
  'storage.googleapis.com',
];

const OPTIONAL_SERVICES = [];

const REQUIRED_INDEXES = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes || [];

const report = {
  projectId: PROJECT_ID,
  gcloudConfig: GCLOUD_CONFIG,
  checks: [],
};

const token = gcloud(['auth', 'print-access-token']).trim();

const project = JSON.parse(gcloud([
  'projects',
  'describe',
  PROJECT_ID,
  '--format=json(projectId,name,lifecycleState)',
]));
addCheck('project', project.lifecycleState === 'ACTIVE', project);

const enabledServices = gcloud([
  'services',
  'list',
  '--enabled',
  `--project=${PROJECT_ID}`,
  '--format=value(config.name)',
]).trim().split('\n').filter(Boolean);
for (const service of REQUIRED_SERVICES) {
  addCheck(`required-service:${service}`, enabledServices.includes(service), { service });
}
for (const service of OPTIONAL_SERVICES) {
  addCheck(`optional-service:${service}`, enabledServices.includes(service), { service }, 'warn');
}

const firestoreDatabases = JSON.parse(gcloud([
  'firestore',
  'databases',
  'list',
  `--project=${PROJECT_ID}`,
  '--format=json(name,locationId,type,pointInTimeRecoveryEnablement,deleteProtectionState)',
]));
const defaultDatabase = firestoreDatabases.find((database) => database.name.endsWith('/databases/(default)'));
addCheck('firestore-default-database', Boolean(defaultDatabase), defaultDatabase || {});
if (defaultDatabase) {
  addCheck('firestore-native-mode', defaultDatabase.type === 'FIRESTORE_NATIVE', defaultDatabase);
  addCheck('firestore-pitr-enabled', defaultDatabase.pointInTimeRecoveryEnablement === 'POINT_IN_TIME_RECOVERY_ENABLED', defaultDatabase, 'warn');
  addCheck('firestore-delete-protection-enabled', defaultDatabase.deleteProtectionState === 'DELETE_PROTECTION_ENABLED', defaultDatabase, 'warn');
}

const firebaseProject = await fetchJson(`https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}`);
addCheck('firebase-project-active', firebaseProject.state === 'ACTIVE', pick(firebaseProject, ['projectId', 'displayName', 'state']));

const webApps = await fetchJson(`https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps?pageSize=20`);
addCheck('firebase-web-app', (webApps.apps || []).length > 0, {
  apps: (webApps.apps || []).map((app) => pick(app, ['appId', 'displayName', 'state'])),
});

const authConfig = await fetchJson(`https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`, { allow404: true });
addCheck('firebase-auth-config', authConfig.ok, authConfig.ok
  ? summarizeAuthConfig(authConfig.body)
  : { status: authConfig.status, message: authConfig.message });

const rulesReleases = await fetchJson(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`);
const firestoreRelease = (rulesReleases.releases || []).find((release) => release.name.endsWith('/releases/cloud.firestore'));
addCheck('firestore-rules-release', Boolean(firestoreRelease), firestoreRelease || {
  releases: (rulesReleases.releases || []).map((release) => pick(release, ['name', 'rulesetName', 'updateTime'])),
});

const liveIndexes = JSON.parse(gcloud([
  'firestore',
  'indexes',
  'composite',
  'list',
  `--project=${PROJECT_ID}`,
  '--format=json(name,queryScope,fields,state)',
]));
for (const requiredIndex of REQUIRED_INDEXES) {
  const liveIndex = liveIndexes.find((index) => indexMatches(requiredIndex, index));
  addCheck(
    `firestore-index:${requiredIndex.collectionGroup}`,
    liveIndex?.state === 'READY',
    liveIndex
      ? {
          collectionGroup: requiredIndex.collectionGroup,
          state: liveIndex.state,
          name: liveIndex.name,
        }
      : {
          collectionGroup: requiredIndex.collectionGroup,
          expectedFields: requiredIndex.fields,
        },
    liveIndex ? 'warn' : 'fail',
  );
}

const appHostingBackends = await fetchJson(
  `https://firebaseapphosting.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/${APP_HOSTING_LOCATION}/backends`,
  { allow404: true },
);
const expectedBackendName = `projects/${PROJECT_ID}/locations/${APP_HOSTING_LOCATION}/backends/${APP_HOSTING_BACKEND_ID}`;
const appHostingBackend = (appHostingBackends.body?.backends || []).find((backend) => backend.name === expectedBackendName);
addCheck('app-hosting-backend', Boolean(appHostingBackend), appHostingBackends.ok
  ? {
      expectedBackendName,
      backends: (appHostingBackends.body.backends || []).map((backend) => pick(backend, [
        'name',
        'appId',
        'uri',
        'displayName',
        'servingLocality',
        'serviceAccount',
        'environment',
      ])),
    }
  : { status: appHostingBackends.status, message: appHostingBackends.message });

if (appHostingBackend) {
  addCheck('app-hosting-backend-uri', Boolean(appHostingBackend.uri), pick(appHostingBackend, ['name', 'uri']));
  if (authConfig.ok) {
    addCheck('firebase-auth-hosted-domain', (authConfig.body.authorizedDomains || []).includes(appHostingBackend.uri), {
      requiredDomain: appHostingBackend.uri,
      authorizedDomains: authConfig.body.authorizedDomains || [],
    });
  }
  const rolloutList = await fetchJson(`${appHostingEndpoint(appHostingBackend.name)}/rollouts`, { allow404: true });
  const rollouts = rolloutList.ok
    ? [...(rolloutList.body.rollouts || [])].sort(byNewestRollout)
    : [];
  const latestRollout = rollouts[0];
  addCheck('app-hosting-rollout', rolloutList.ok && isSuccessfulAppHostingRollout(latestRollout), rolloutList.ok
    ? {
        latestRollout: latestRollout
          ? pick(latestRollout, [
              'name',
              'build',
              'state',
              'createTime',
              'updateTime',
            ])
          : null,
        rollouts: rollouts.map((rollout) => pick(rollout, [
          'name',
          'build',
          'state',
          'createTime',
          'updateTime',
        ])),
      }
    : { status: rolloutList.status, message: rolloutList.message });
}

const buckets = JSON.parse(gcloud([
  'storage',
  'buckets',
  'list',
  `--project=${PROJECT_ID}`,
  '--format=json(name,location,uniformBucketLevelAccess.enabled)',
]));
addCheck('storage-bucket', buckets.length > 0, { buckets }, 'warn');

const secrets = JSON.parse(gcloud([
  'secrets',
  'list',
  `--project=${PROJECT_ID}`,
  '--format=json(name)',
]));
addCheck('runtime-secrets-present', secrets.length > 0, {
  secrets: secrets.map((secret) => secret.name.split('/').pop()),
});

printReport();

const failed = report.checks.filter((check) => check.status === 'fail');
process.exit(failed.length > 0 ? 1 : 0);

function gcloud(args) {
  return execFileSync('gcloud', [
    ...args,
    `--configuration=${GCLOUD_CONFIG}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': PROJECT_ID,
    },
  });
  const text = await response.text();
  if (response.ok) {
    const body = text ? JSON.parse(text) : {};
    return options.allow404 ? { ok: true, status: response.status, body } : body;
  }
  if (options.allow404 && response.status === 404) {
    return { ok: false, status: response.status, message: parseErrorMessage(text) };
  }
  throw new Error(`${response.status} ${text}`);
}

function appHostingEndpoint(resourceName) {
  return `https://firebaseapphosting.googleapis.com/v1beta/${resourceName}`;
}

function parseErrorMessage(text) {
  try {
    return JSON.parse(text).error?.message || text;
  } catch {
    return text;
  }
}

function addCheck(name, passed, details = {}, severity = 'fail') {
  report.checks.push({
    name,
    status: passed ? 'pass' : severity,
    details,
  });
}

function pick(object, keys) {
  return Object.fromEntries(keys
    .filter((key) => Object.hasOwn(object || {}, key))
    .map((key) => [key, object[key]]));
}

function summarizeAuthConfig(config) {
  return {
    authorizedDomains: config.authorizedDomains || [],
    signIn: {
      email: config.signIn?.email || null,
      phoneNumber: config.signIn?.phoneNumber
        ? { enabled: config.signIn.phoneNumber.enabled === true }
        : null,
      anonymous: config.signIn?.anonymous || null,
      allowDuplicateEmails: config.signIn?.allowDuplicateEmails === true,
    },
    mfa: config.mfa ? { state: config.mfa.state } : null,
    subtype: config.subtype,
  };
}

function indexMatches(requiredIndex, liveIndex) {
  if (!liveIndex?.name?.includes(`/collectionGroups/${requiredIndex.collectionGroup}/`)) {
    return false;
  }
  if (liveIndex.queryScope !== requiredIndex.queryScope) {
    return false;
  }

  const liveFields = (liveIndex.fields || []).filter((field) => field.fieldPath !== '__name__');
  if (liveFields.length !== requiredIndex.fields.length) {
    return false;
  }

  return requiredIndex.fields.every((field, index) => (
    liveFields[index]?.fieldPath === field.fieldPath
    && liveFields[index]?.order === field.order
  ));
}

function byNewestRollout(a, b) {
  return newestTimestamp(b) - newestTimestamp(a);
}

function newestTimestamp(rollout) {
  return Date.parse(rollout?.updateTime || rollout?.createTime || 0);
}

function isSuccessfulAppHostingRollout(rollout) {
  return ['SUCCEEDED', 'READY'].includes(rollout?.state);
}

function printReport() {
  const counts = report.checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, {});

  console.log(`Firebase readiness for ${PROJECT_ID}`);
  console.log(`pass=${counts.pass || 0} warn=${counts.warn || 0} fail=${counts.fail || 0}`);
  for (const check of report.checks) {
    console.log(`${check.status.toUpperCase()} ${check.name}`);
    console.log(JSON.stringify(check.details, null, 2));
  }
}
