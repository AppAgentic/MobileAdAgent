let adminAppPromise = null;
let adminAuthPromise = null;
let adminDbPromise = null;

export function firebaseProjectId() {
  return process.env.FIREBASE_ADMIN_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    || 'mobileadagent';
}

export async function getFirebaseAdminApp() {
  if (!adminAppPromise) {
    adminAppPromise = initFirebaseAdminApp();
  }
  return adminAppPromise;
}

export async function getFirebaseAuth() {
  if (!adminAuthPromise) {
    adminAuthPromise = (async () => {
      const [{ getAuth }, app] = await Promise.all([
        import('firebase-admin/auth'),
        getFirebaseAdminApp(),
      ]);
      return getAuth(app);
    })();
  }
  return adminAuthPromise;
}

export async function getFirestoreDb() {
  if (!adminDbPromise) {
    adminDbPromise = (async () => {
      const [{ getFirestore }, app] = await Promise.all([
        import('firebase-admin/firestore'),
        getFirebaseAdminApp(),
      ]);
      return getFirestore(app);
    })();
  }
  return adminDbPromise;
}

export async function verifyFirebaseIdToken(idToken) {
  const auth = await getFirebaseAuth();
  return auth.verifyIdToken(idToken, true);
}

async function initFirebaseAdminApp() {
  let adminApp;
  try {
    adminApp = await import('firebase-admin/app');
  } catch (error) {
    throw new Error('firebase-admin is not installed. Run pnpm install before enabling Firestore mode.');
  }

  const { getApps, initializeApp, applicationDefault, cert } = adminApp;
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = firebaseProjectId();
  const credential = explicitServiceAccountCredential({ cert })
    || applicationDefault();

  return initializeApp({
    projectId,
    credential,
  });
}

function explicitServiceAccountCredential({ cert }) {
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;

  return cert({
    projectId: firebaseProjectId(),
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
  });
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n');
}
