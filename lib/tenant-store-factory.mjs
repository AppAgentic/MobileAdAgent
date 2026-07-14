import { createTenantStore } from './local-tenant-store.mjs';

export async function createConfiguredTenantStore(options = {}) {
  if (tenantBackendMode() === 'firestore') {
    const { createFirestoreTenantStore } = await import('./firestore-tenant-store.mjs');
    return createFirestoreTenantStore(options);
  }
  return createTenantStore(options);
}

export function tenantBackendMode() {
  return String(process.env.MAA_TENANT_BACKEND || 'memory').toLowerCase();
}
