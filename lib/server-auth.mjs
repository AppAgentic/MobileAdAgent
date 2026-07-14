import { verifyFirebaseIdToken } from './firebase-admin.mjs';

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export function tenantBackendMode() {
  return String(process.env.MAA_TENANT_BACKEND || 'memory').toLowerCase();
}

export function firebaseAuthRequired() {
  const authMode = String(process.env.MAA_AUTH_MODE || '').toLowerCase();
  return authMode === 'firebase' || tenantBackendMode() === 'firestore';
}

export async function authContextForRequest({ request, body = {}, url = null, required = firebaseAuthRequired() } = {}) {
  if (firebaseAuthRequired()) {
    const token = bearerToken(request);
    if (!token) {
      if (required) throw new AuthError('Sign in to continue.', 401);
      return { uid: null, email: null, mode: 'firebase', verified: false };
    }
    const decoded = await verifyFirebaseIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email || body.email || url?.searchParams?.get('email') || null,
      mode: 'firebase',
      verified: true,
      token: {
        uid: decoded.uid,
        emailVerified: Boolean(decoded.email_verified),
        signInProvider: decoded.firebase?.sign_in_provider || null,
      },
    };
  }

  return {
    uid: body.uid || url?.searchParams?.get('uid') || null,
    email: body.email || url?.searchParams?.get('email') || null,
    mode: 'local',
    verified: false,
  };
}

export function authErrorResponse(error) {
  if (error instanceof AuthError) {
    return { status: error.status, payload: { ok: false, error: error.message, providerMutations: 0 } };
  }
  return null;
}

function bearerToken(request) {
  const header = request?.headers?.authorization || request?.headers?.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
