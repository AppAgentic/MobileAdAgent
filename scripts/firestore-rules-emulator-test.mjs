import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'mobileadagent-rules-test';

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
    port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080),
    rules: readFileSync(join(repoRoot, 'firestore.rules'), 'utf8'),
  },
});

try {
  await testEnv.clearFirestore();
  await seedTenant();

  const ownerDb = testEnv.authenticatedContext('user-owner', { email: 'owner@example.test' }).firestore();
  const selfCreateDb = testEnv.authenticatedContext('user-self-create', { email: 'self@example.test' }).firestore();
  const outsiderDb = testEnv.authenticatedContext('user-outsider', { email: 'outsider@example.test' }).firestore();
  const anonDb = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(ownerDb, 'users/user-owner')));
  await assertFails(getDoc(doc(ownerDb, 'users/user-outsider')));
  await assertFails(getDoc(doc(anonDb, 'users/user-owner')));

  await assertSucceeds(setDoc(doc(selfCreateDb, 'users/user-self-create'), {
    uid: 'user-self-create',
    email: 'self@example.test',
    orgId: 'org-a',
    workspaceId: 'ws-default',
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:00.000Z',
    providerMutations: 0,
  }));
  await assertFails(setDoc(doc(ownerDb, 'users/user-bad'), {
    uid: 'user-bad',
    email: 'bad@example.test',
    orgId: 'org-a',
    workspaceId: 'ws-default',
  }));
  await assertSucceeds(updateDoc(doc(ownerDb, 'users/user-owner'), {
    displayName: 'Owner',
    updatedAt: '2026-07-07T00:00:00.000Z',
  }));
  await assertFails(updateDoc(doc(ownerDb, 'users/user-owner'), {
    orgId: 'org-b',
  }));

  await assertSucceeds(getDoc(doc(ownerDb, 'orgs/org-a')));
  await assertSucceeds(getDoc(doc(ownerDb, 'orgs/org-a/workspaces/ws-default/apps/example-app')));
  await assertSucceeds(getDoc(doc(ownerDb, 'orgs/org-a/workspaces/ws-default/apps/example-app/researchSnapshots/research-1')));
  await assertSucceeds(getDoc(doc(ownerDb, 'orgs/org-a/workspaces/ws-default/apps/example-app/packPlans/plan-1')));
  await assertFails(getDoc(doc(outsiderDb, 'orgs/org-a')));
  await assertFails(getDoc(doc(anonDb, 'orgs/org-a')));

  await assertFails(setDoc(doc(ownerDb, 'orgs/org-a/workspaces/ws-default/apps/new-app'), {
    orgId: 'org-a',
    workspaceId: 'ws-default',
    appId: 'new-app',
  }));
  await assertFails(setDoc(doc(ownerDb, 'orgs/org-a/creditLedger/txn-client'), {
    orgId: 'org-a',
    credits: 999,
  }));
  await assertFails(setDoc(doc(ownerDb, 'orgs/org-a/workspaces/ws-default/apps/example-app/packPlans/plan-client'), { providerMutations: 0 }));
  await assertFails(getDoc(doc(ownerDb, 'orgs/org-a/workspaces/ws-default/apps/example-app/packPlanRequests/request-1')));
  await assertFails(setDoc(doc(ownerDb, 'orgs/org-a/workspaces/ws-default/apps/example-app/packPlanRequests/request-client'), { providerMutations: 0 }));

  for (const path of [
    'previewCache/app-store-1',
    'previewSessions/session-1',
    'renderTasks/task-1',
    'orgs/org-a/apiKeys/key-1',
    'orgs/org-a/auditEvents/event-1',
    'orgs/org-a/claims/claim-1',
  ]) {
    await assertFails(getDoc(doc(ownerDb, path)));
    await assertFails(setDoc(doc(ownerDb, path), { providerMutations: 0 }));
  }

  console.log('Firestore emulator rules test passed');
} finally {
  await testEnv.cleanup();
}

async function seedTenant() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/user-owner'), {
      uid: 'user-owner',
      email: 'owner@example.test',
      orgId: 'org-a',
      workspaceId: 'ws-default',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      providerMutations: 0,
    });
    await setDoc(doc(db, 'users/user-outsider'), {
      uid: 'user-outsider',
      email: 'outsider@example.test',
      orgId: 'org-b',
      workspaceId: 'ws-default',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      providerMutations: 0,
    });
    await setDoc(doc(db, 'orgs/org-a'), {
      orgId: 'org-a',
      name: 'Org A',
      ownerUid: 'user-owner',
      providerMutations: 0,
    });
    await setDoc(doc(db, 'orgs/org-a/members/user-owner'), {
      uid: 'user-owner',
      orgId: 'org-a',
      role: 'owner',
      workspaceIds: ['ws-default'],
      providerMutations: 0,
    });
    await setDoc(doc(db, 'orgs/org-a/workspaces/ws-default'), {
      orgId: 'org-a',
      workspaceId: 'ws-default',
      name: 'Default workspace',
      providerMutations: 0,
    });
    await setDoc(doc(db, 'orgs/org-a/workspaces/ws-default/apps/example-app'), {
      orgId: 'org-a',
      workspaceId: 'ws-default',
      appId: 'example-app',
      id: 'example-app',
      name: 'Example App',
      providerMutations: 0,
    });
    await setDoc(doc(db, 'orgs/org-a/workspaces/ws-default/apps/example-app/researchSnapshots/research-1'), { providerMutations: 0 });
    await setDoc(doc(db, 'orgs/org-a/workspaces/ws-default/apps/example-app/packPlans/plan-1'), { providerMutations: 0 });
    await setDoc(doc(db, 'orgs/org-a/workspaces/ws-default/apps/example-app/packPlanRequests/request-1'), { providerMutations: 0 });
    await setDoc(doc(db, 'previewCache/app-store-1'), { providerMutations: 0 });
    await setDoc(doc(db, 'previewSessions/session-1'), { providerMutations: 0 });
    await setDoc(doc(db, 'renderTasks/task-1'), { providerMutations: 0 });
    await setDoc(doc(db, 'orgs/org-a/apiKeys/key-1'), { providerMutations: 0 });
    await setDoc(doc(db, 'orgs/org-a/auditEvents/event-1'), { providerMutations: 0 });
    await setDoc(doc(db, 'orgs/org-a/claims/claim-1'), { providerMutations: 0 });
  });
}
