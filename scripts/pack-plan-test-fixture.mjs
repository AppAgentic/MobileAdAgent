import {
  buildPackPlanResearchSnapshot,
  buildSelectedProductTruth,
} from '../lib/pack-plan-model.mjs';
import { applyReviewedPlanPatch } from '../lib/tenant-model.mjs';

/**
 * Exercise the same approval boundary as the product: create an immutable,
 * uncharged Pack Plan first, then accept that exact plan into a paid pack.
 */
export function createPlannedPack(store, {
  uid,
  orgId,
  workspaceId,
  appId,
  imageCount,
  videoCount,
  idempotencyKey,
  appPlan = null,
  marketSignals = [],
  learningSignals = [],
} = {}) {
  const context = { uid, orgId, workspaceId, appId };
  const currentApp = store.readAppForUser(context);
  const capturedAt = new Date().toISOString();
  const reviewedApp = appPlan
    ? applyReviewedPlanPatch(currentApp, { ...appPlan, updatedAt: capturedAt })
    : currentApp;
  const researchSnapshot = buildPackPlanResearchSnapshot({
    productTruth: buildSelectedProductTruth(reviewedApp),
    marketSignals,
    learningSignals,
    capturedAt,
  });
  const planned = store.createPackPlanForUser({
    ...context,
    appPlan,
    researchSnapshot,
    strategy: null,
    imageCount,
    videoCount,
    goal: 'Test fixture controlled creative experiment.',
    channel: 'Paid social',
    idempotencyKey: `plan-${idempotencyKey}`,
  });
  return store.createPackForUser({
    ...context,
    imageCount,
    videoCount,
    idempotencyKey,
    packPlanId: planned.plan.planId,
  });
}
