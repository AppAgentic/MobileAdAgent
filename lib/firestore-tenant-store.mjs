import { CLAIM_PRODUCTS } from './local-preview.mjs';
import { getFirestoreDb } from './firebase-admin.mjs';
import {
  buildCreativeJobGraph,
  customerSafeJob,
  generationJobIdForPack,
  preflightUgcGenerationForApp,
} from './creative-job-model.mjs';
import {
  buildCreativePackPlan,
  buildReviewDecisionLearningPair,
  customerSafeCreativePackPlan,
  validateCreativePackPlan,
  validatePackPlanResearchSnapshot,
} from './pack-plan-model.mjs';
import {
  DEFAULT_WORKSPACE_ID,
  applyReviewedPlanPatch,
  appReadiness,
  buildBootstrapDocs,
  buildClaimRecord,
  buildClaimedAppDocs,
  buildCreativePackRecord,
  buildCreditDebitRecord,
  claimIdempotencyKey,
  creativePackIdFromKey,
  creditBalanceFromLedger,
  creditCostForPack,
  customerSafeApp,
  isServerOnlyCollection,
  isoNow,
  normalizeEmail,
  normalizePackRequest,
  packIdempotencyKey,
  slugify,
  stableHash,
  toPlain,
  uidForEmail,
  workspaceSummary,
} from './tenant-model.mjs';

export async function createFirestoreTenantStore({ db = null, now = () => Date.now() } = {}) {
  const firestore = db || await getFirestoreDb();

  async function bootstrapUser({ uid, email, previewSessionId = null } = {}) {
    const cleanEmail = normalizeEmail(email);
    const cleanUid = uid || uidForEmail(cleanEmail);

    return firestore.runTransaction(async (tx) => {
      const existingUserSnap = await tx.get(userRef(cleanUid));
      if (existingUserSnap.exists) {
        const user = existingUserSnap.data();
        return {
          uid: cleanUid,
          email: user.email || cleanEmail,
          orgId: user.orgId,
          workspaceId: user.workspaceId || DEFAULT_WORKSPACE_ID,
          previewSessionId,
          user: toPlain(user),
          idempotent: true,
          providerMutations: 0,
        };
      }

      const createdAt = isoNow(now);
      const docs = buildBootstrapDocs({ uid: cleanUid, email: cleanEmail, createdAt });
      tx.set(userRef(cleanUid), docs.user);
      tx.set(orgRef(docs.orgId), docs.org);
      tx.set(memberRef(docs.orgId, cleanUid), docs.member);
      tx.set(workspaceRef(docs.orgId, docs.workspaceId), docs.workspace);
      tx.set(auditEventRef(docs.orgId, `bootstrap-${cleanUid}`), {
        eventId: `bootstrap-${cleanUid}`,
        orgId: docs.orgId,
        actorUid: cleanUid,
        type: 'tenant_bootstrap',
        createdAt,
        providerMutations: 0,
      });

      return {
        uid: cleanUid,
        email: cleanEmail,
        orgId: docs.orgId,
        workspaceId: docs.workspaceId,
        previewSessionId,
        user: toPlain(docs.user),
        member: toPlain(docs.member),
        workspace: workspaceSummary(docs.workspace),
        idempotent: false,
        providerMutations: 0,
      };
    });
  }

  async function claimPreview({ uid, email, previewSessionId, canonicalAppId, extraction, productId = 'launch_pack' } = {}) {
    if (!previewSessionId) throw new Error('Preview session is required.');
    if (!canonicalAppId) throw new Error('Canonical app ID is required.');
    if (!extraction?.app) throw new Error('Cached app extraction is required.');

    const cleanEmail = normalizeEmail(email);
    const cleanUid = uid || uidForEmail(cleanEmail);
    const product = CLAIM_PRODUCTS[productId];
    if (!product) throw new Error('Choose the Launch Pack or a plan to continue.');

    return firestore.runTransaction(async (tx) => {
      const createdAt = isoNow(now);
      const userSnap = await tx.get(userRef(cleanUid));
      const bootstrapDocs = userSnap.exists
        ? null
        : buildBootstrapDocs({ uid: cleanUid, email: cleanEmail, createdAt });
      const bootstrap = userSnap.exists
        ? {
          uid: cleanUid,
          email: userSnap.data().email || cleanEmail,
          orgId: userSnap.data().orgId,
          workspaceId: userSnap.data().workspaceId || DEFAULT_WORKSPACE_ID,
          idempotent: true,
          providerMutations: 0,
        }
        : {
          uid: cleanUid,
          email: cleanEmail,
          orgId: bootstrapDocs.orgId,
          workspaceId: bootstrapDocs.workspaceId,
          idempotent: false,
          providerMutations: 0,
        };
      const idempotencyKey = claimIdempotencyKey({ uid: cleanUid, previewSessionId, canonicalAppId });
      const claimDocId = stableHash(idempotencyKey);
      const claimSnap = await tx.get(claimRef(bootstrap.orgId, claimDocId));
      if (claimSnap.exists) {
        const claim = claimSnap.data();
        const appSnap = await tx.get(appRef(claim.orgId, claim.workspaceId, claim.appId));
        if (!appSnap.exists) throw new Error('Claimed app is missing.');
        const app = appSnap.data();
        return {
          session: sessionPayload(bootstrap),
          claim,
          app: customerSafeApp(app),
          apps: [customerSafeApp(app)],
          idempotent: true,
          providerMutations: 0,
        };
      }

      if (userSnap.exists) {
        const workspaceSnap = await tx.get(workspaceRef(bootstrap.orgId, bootstrap.workspaceId));
        if (!workspaceSnap.exists) throw new Error('Workspace not found.');
      }

      const appId = await uniqueAppIdInTransaction(tx, {
        orgId: bootstrap.orgId,
        workspaceId: bootstrap.workspaceId,
        base: slugify(extraction.app.name || canonicalAppId),
      });
      const { app, appProfile, sourceAssets } = buildClaimedAppDocs({
        orgId: bootstrap.orgId,
        workspaceId: bootstrap.workspaceId,
        appId,
        createdBy: cleanUid,
        extraction,
        createdAt,
      });
      const claim = buildClaimRecord({
        uid: cleanUid,
        email: cleanEmail,
        orgId: bootstrap.orgId,
        workspaceId: bootstrap.workspaceId,
        appId,
        previewSessionId,
        canonicalAppId,
        product,
        createdAt,
      });

      if (bootstrapDocs) {
        tx.set(userRef(cleanUid), bootstrapDocs.user);
        tx.set(orgRef(bootstrapDocs.orgId), bootstrapDocs.org);
        tx.set(memberRef(bootstrapDocs.orgId, cleanUid), bootstrapDocs.member);
        tx.set(workspaceRef(bootstrapDocs.orgId, bootstrapDocs.workspaceId), bootstrapDocs.workspace);
        tx.set(auditEventRef(bootstrapDocs.orgId, `bootstrap-${cleanUid}`), {
          eventId: `bootstrap-${cleanUid}`,
          orgId: bootstrapDocs.orgId,
          actorUid: cleanUid,
          type: 'tenant_bootstrap',
          createdAt,
          providerMutations: 0,
        });
      }
      tx.set(appRef(bootstrap.orgId, bootstrap.workspaceId, appId), app);
      tx.set(appProfileRef(bootstrap.orgId, bootstrap.workspaceId, appId, appProfile.profileId), appProfile);
      for (const asset of sourceAssets) {
        tx.set(sourceAssetRef(bootstrap.orgId, bootstrap.workspaceId, appId, asset.assetId), asset);
      }
      tx.set(claimRef(bootstrap.orgId, claimDocId), {
        ...claim,
        idempotencyKey,
        claimDocId,
      });
      tx.set(entitlementRef(bootstrap.orgId, claimDocId), {
        entitlementId: claimDocId,
        orgId: bootstrap.orgId,
        uid: cleanUid,
        productId: product.id,
        creditGrant: product.credits,
        packMix: product.packMix || null,
        source: 'preview_claim',
        idempotencyKey,
        createdAt,
        providerMutations: 0,
      });
      tx.set(creditLedgerRef(bootstrap.orgId, claimDocId), {
        txnId: claimDocId,
        orgId: bootstrap.orgId,
        uid: cleanUid,
        type: 'grant',
        credits: product.credits,
        source: product.id,
        idempotencyKey,
        createdAt,
        providerMutations: 0,
      });
      tx.set(auditEventRef(bootstrap.orgId, `claim-${claimDocId}`), {
        eventId: `claim-${claimDocId}`,
        orgId: bootstrap.orgId,
        actorUid: cleanUid,
        type: 'preview_claimed',
        appId,
        workspaceId: bootstrap.workspaceId,
        canonicalAppId,
        createdAt,
        providerMutations: 0,
      });

      return {
        session: sessionPayload(bootstrap),
        claim,
        app: customerSafeApp(app),
        apps: [customerSafeApp(app)],
        idempotent: false,
        providerMutations: 0,
      };
    });
  }

  async function createAppFromExtraction({
    uid,
    email,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    extraction,
    entrySource = 'Dashboard URL',
  } = {}) {
    if (!extraction?.app) throw new Error('App extraction is required.');
    const cleanEmail = email ? normalizeEmail(email) : null;
    const cleanUid = uid || (cleanEmail ? uidForEmail(cleanEmail) : null);
    if (!cleanUid) throw new Error('Sign in to continue.');

    return firestore.runTransaction(async (tx) => {
      let cleanOrgId = orgId;
      let cleanWorkspaceId = workspaceId || DEFAULT_WORKSPACE_ID;
      const createdAt = isoNow(now);
      const userSnap = await tx.get(userRef(cleanUid));
      let bootstrapDocs = null;
      if (!cleanOrgId) {
        if (userSnap.exists) {
          const user = userSnap.data();
          cleanOrgId = user.orgId;
          cleanWorkspaceId = user.workspaceId || DEFAULT_WORKSPACE_ID;
        } else if (cleanEmail) {
          bootstrapDocs = buildBootstrapDocs({ uid: cleanUid, email: cleanEmail, createdAt });
          cleanOrgId = bootstrapDocs.orgId;
          cleanWorkspaceId = bootstrapDocs.workspaceId;
        } else {
          throw new Error('Sign in to continue.');
        }
      }

      const [memberSnap, workspaceSnap] = await Promise.all([
        tx.get(memberRef(cleanOrgId, cleanUid)),
        tx.get(workspaceRef(cleanOrgId, cleanWorkspaceId)),
      ]);
      if (!memberSnap.exists && !bootstrapDocs) throw new Error('Access denied for this org.');
      if (!workspaceSnap.exists && !bootstrapDocs) throw new Error('Workspace not found.');

      const appId = await uniqueAppIdInTransaction(tx, {
        orgId: cleanOrgId,
        workspaceId: cleanWorkspaceId,
        base: slugify(extraction.app.name || extraction.url || 'app'),
      });
      const { app, appProfile, sourceAssets } = buildClaimedAppDocs({
        orgId: cleanOrgId,
        workspaceId: cleanWorkspaceId,
        appId,
        createdBy: cleanUid,
        extraction,
        createdAt,
      });
      app.entrySource = entrySource;

      if (bootstrapDocs) {
        tx.set(userRef(cleanUid), bootstrapDocs.user);
        tx.set(orgRef(bootstrapDocs.orgId), bootstrapDocs.org);
        tx.set(memberRef(bootstrapDocs.orgId, cleanUid), bootstrapDocs.member);
        tx.set(workspaceRef(bootstrapDocs.orgId, bootstrapDocs.workspaceId), bootstrapDocs.workspace);
        tx.set(auditEventRef(bootstrapDocs.orgId, `bootstrap-${cleanUid}`), {
          eventId: `bootstrap-${cleanUid}`,
          orgId: bootstrapDocs.orgId,
          actorUid: cleanUid,
          type: 'tenant_bootstrap',
          createdAt,
          providerMutations: 0,
        });
      }
      tx.set(appRef(cleanOrgId, cleanWorkspaceId, appId), app);
      tx.set(appProfileRef(cleanOrgId, cleanWorkspaceId, appId, appProfile.profileId), appProfile);
      for (const asset of sourceAssets) {
        tx.set(sourceAssetRef(cleanOrgId, cleanWorkspaceId, appId, asset.assetId), asset);
      }
      tx.set(auditEventRef(cleanOrgId, `app-import-${appId}`), {
        eventId: `app-import-${appId}`,
        orgId: cleanOrgId,
        actorUid: cleanUid,
        type: 'app_imported',
        appId,
        workspaceId: cleanWorkspaceId,
        createdAt,
        providerMutations: 0,
      });

      return {
        app: customerSafeApp(app),
        session: {
          uid: cleanUid,
          email: cleanEmail || userSnap.data()?.email || null,
          orgId: cleanOrgId,
          workspaceId: cleanWorkspaceId,
        },
        providerMutations: 0,
      };
    });
  }

  async function listAppsForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
    await assertCanReadOrg({ uid, orgId });
    const workspaceSnap = await workspaceRef(orgId, workspaceId).get();
    if (!workspaceSnap.exists) throw new Error('Workspace not found.');
    const snapshot = await appsCollection(orgId, workspaceId).get();
    return snapshot.docs.map((doc) => customerSafeApp(doc.data()));
  }

  async function readAppForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID, appId } = {}) {
    await assertCanReadOrg({ uid, orgId });
    const appSnap = await appRef(orgId, workspaceId, appId).get();
    if (!appSnap.exists) throw new Error('App not found.');
    return customerSafeApp(appSnap.data());
  }

  async function createPackPlanForUser({
    uid,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    appId,
    appPlan,
    researchSnapshot,
    strategy,
    imageCount,
    videoCount,
    goal,
    channel,
    idempotencyKey,
  } = {}) {
    if (!uid) throw new Error('Sign in to continue.');
    if (!orgId || !workspaceId || !appId) throw new Error('Choose an app before planning.');
    const cleanKey = String(idempotencyKey || '').trim();
    if (!cleanKey) throw new Error('Pack Plan idempotency key is required.');
    validatePackPlanResearchSnapshot(researchSnapshot);
    const requestId = stableHash(`${uid}:${orgId}:${workspaceId}:${appId}:${cleanKey}`);

    return firestore.runTransaction(async (tx) => {
      const requestRef = packPlanRequestRef(orgId, workspaceId, appId, requestId);
      const [memberSnap, appSnap, requestSnap] = await Promise.all([
        tx.get(memberRef(orgId, uid)),
        tx.get(appRef(orgId, workspaceId, appId)),
        tx.get(requestRef),
      ]);
      if (!memberSnap.exists) throw new Error('Access denied for this org.');
      if (!appSnap.exists) throw new Error('App not found.');
      if (requestSnap.exists) {
        const requestRecord = requestSnap.data();
        const existingPlanSnap = await tx.get(packPlanRef(orgId, workspaceId, appId, requestRecord.planId));
        if (!existingPlanSnap.exists) throw new Error('Saved Pack Plan is missing.');
        const existing = existingPlanSnap.data();
        return {
          plan: customerSafeCreativePackPlan(existing.plan),
          app: customerSafeApp(appSnap.data()),
          readiness: appReadiness(appSnap.data()),
          planRevision: existing.planRevision,
          idempotent: true,
          providerMutations: 0,
        };
      }

      let app = appPlan ? applyReviewedPlanPatch(appSnap.data(), { ...appPlan, updatedAt: isoNow(now) }) : appSnap.data();
      const readiness = appReadiness(app);
      if (!readiness.ready) throw new Error(readiness.messages[0] || 'Review the app info before planning.');
      const createdAt = isoNow(now);
      const plan = buildCreativePackPlan({
        orgId,
        workspaceId,
        appId,
        createdBy: uid,
        createdAt,
        researchSnapshot,
        outputMix: { image: imageCount, ugc: videoCount },
        strategy,
        goal,
        channel,
      });
      validateCreativePackPlan({ plan, currentApp: app });
      const planRevision = Number(app.planRevision || 0) + 1;
      const researchSnapshotId = `research-${researchSnapshot.snapshotFingerprint.slice(0, 20)}`;
      app = {
        ...app,
        extractionStatus: 'approved',
        status: 'Pack Plan ready',
        packPlanStatus: 'proposed',
        activePackPlanId: plan.planId,
        activePackPlan: customerSafeCreativePackPlan(plan),
        latestResearchSnapshotId: researchSnapshotId,
        planRevision,
        angles: [
          { id: 'primary', label: plan.experiment.primary.angle, evidence: plan.experiment.primary.rationale, selected: true },
          { id: 'challenger', label: plan.experiment.challenger.angle, evidence: plan.experiment.challenger.rationale, selected: true },
        ],
        updatedAt: createdAt,
        providerMutations: 0,
      };
      tx.set(researchSnapshotRef(orgId, workspaceId, appId, researchSnapshotId), toPlain(researchSnapshot));
      tx.set(packPlanRef(orgId, workspaceId, appId, plan.planId), {
        plan: toPlain(plan),
        status: 'proposed',
        planRevision,
        createdAt,
        providerMutations: 0,
      });
      tx.set(requestRef, { requestId, planId: plan.planId, createdAt, providerMutations: 0 });
      tx.set(appRef(orgId, workspaceId, appId), app);
      tx.set(appProfileRef(orgId, workspaceId, appId, app.appProfileId || 'profile-current'), {
        profileId: app.appProfileId || 'profile-current',
        orgId,
        workspaceId,
        appId,
        summary: app.tagline,
        features: (app.claims || []).map(toPlain),
        readiness,
        updatedBy: uid,
        updatedAt: createdAt,
        providerMutations: 0,
      }, { merge: true });
      tx.set(auditEventRef(orgId, `pack-plan-${plan.planId}`), {
        eventId: `pack-plan-${plan.planId}`,
        orgId,
        actorUid: uid,
        type: 'pack_plan_proposed',
        appId,
        workspaceId,
        planId: plan.planId,
        researchSnapshotId,
        createdAt,
        providerMutations: 0,
      });
      return {
        plan: customerSafeCreativePackPlan(plan),
        app: customerSafeApp(app),
        readiness,
        planRevision,
        idempotent: false,
        providerMutations: 0,
      };
    });
  }

  async function readPackPlanForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID, appId, planId } = {}) {
    await assertCanReadOrg({ uid, orgId });
    const snap = await packPlanRef(orgId, workspaceId, appId, planId).get();
    if (!snap.exists) throw new Error('Pack Plan not found.');
    const record = snap.data();
    return { plan: customerSafeCreativePackPlan(record.plan), status: record.status, planRevision: record.planRevision, providerMutations: 0 };
  }

  async function readPackPlanRequestForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID, appId, idempotencyKey } = {}) {
    if (!uid) throw new Error('Sign in to continue.');
    const cleanKey = String(idempotencyKey || '').trim();
    if (!cleanKey) throw new Error('Pack Plan idempotency key is required.');
    await assertCanReadOrg({ uid, orgId });
    const requestId = stableHash(`${uid}:${orgId}:${workspaceId}:${appId}:${cleanKey}`);
    const requestSnap = await packPlanRequestRef(orgId, workspaceId, appId, requestId).get();
    if (!requestSnap.exists) return null;
    const requestRecord = requestSnap.data();
    const [planSnap, appSnap] = await Promise.all([
      packPlanRef(orgId, workspaceId, appId, requestRecord.planId).get(),
      appRef(orgId, workspaceId, appId).get(),
    ]);
    if (!planSnap.exists || !appSnap.exists) throw new Error('Saved Pack Plan is missing.');
    const record = planSnap.data();
    return {
      plan: customerSafeCreativePackPlan(record.plan),
      app: customerSafeApp(appSnap.data()),
      readiness: appReadiness(appSnap.data()),
      planRevision: record.planRevision,
      idempotent: true,
      providerMutations: 0,
    };
  }

  async function createPackForUser({
    uid,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    appId,
    imageCount,
    videoCount,
    idempotencyKey,
    packPlanId,
  } = {}) {
    if (!uid) throw new Error('Sign in to continue.');
    if (!orgId || !workspaceId || !appId) throw new Error('Choose an app before generating.');
    if (!packPlanId) throw new Error('Build and review a Pack Plan before generating.');
    const normalized = normalizePackRequest({ imageCount, videoCount });
    const key = `${uid}:${orgId}:${workspaceId}:${appId}:pack-plan:${packPlanId}`;
    const packId = creativePackIdFromKey(key);

    return firestore.runTransaction(async (tx) => {
      const [memberSnap, appSnap, planSnap, packSnap, ledgerSnap] = await Promise.all([
        tx.get(memberRef(orgId, uid)),
        tx.get(appRef(orgId, workspaceId, appId)),
        tx.get(packPlanRef(orgId, workspaceId, appId, packPlanId)),
        tx.get(creativePackRef(orgId, workspaceId, appId, packId)),
        tx.get(creditLedgerCollection(orgId)),
      ]);
      if (!memberSnap.exists) throw new Error('Access denied for this org.');
      if (!appSnap.exists) throw new Error('App not found.');
      if (!planSnap.exists) throw new Error('Build and review a Pack Plan before generating.');
      const creditBalance = creditBalanceFromLedger(ledgerSnap.docs.map((doc) => doc.data()));
      if (packSnap.exists) {
        const pack = packSnap.data();
        return {
          pack,
          app: customerSafeApp(appSnap.data()),
          creditBalance,
          readiness: pack.sourceReadiness || appReadiness(appSnap.data()),
          idempotent: true,
          providerMutations: 0,
        };
      }

      let app = appSnap.data();
      const planRecord = planSnap.data();
      if (planRecord.status !== 'proposed') throw new Error('This Pack Plan has already been used. Build the next plan before generating again.');
      const packPlan = planRecord.plan;
      validateCreativePackPlan({ plan: packPlan, currentApp: app });
      if (normalized.imageCount !== packPlan.request.outputMix.image || normalized.videoCount !== packPlan.request.outputMix.ugc) {
        throw new Error('The output mix changed after planning. Refresh the Pack Plan before generating.');
      }
      const costCredits = creditCostForPack(normalized);
      if (costCredits !== packPlan.costCredits) throw new Error('Pack Plan credit cost is stale.');
      const appInfoReadiness = appReadiness(app);
      if (!appInfoReadiness.ready) {
        throw new Error(appInfoReadiness.messages[0] || 'Review the app info before generating.');
      }
      const creativePreflight = preflightUgcGenerationForApp({ app, packPlan, videoCount: normalized.videoCount });
      buildCreativeJobGraph({
        jobId: generationJobIdForPack(packId),
        orgId,
        workspaceId,
        appId,
        packId,
        createdBy: uid,
        imageCount: normalized.imageCount,
        videoCount: normalized.videoCount,
        app,
        packPlan,
        costCredits,
        createdAt: '2000-01-01T00:00:00.000Z',
      });
      const readiness = { ...appInfoReadiness, creativePreflight };
      if (creditBalance < costCredits) {
        throw new Error(`You need ${costCredits} credits for this pack. Add credits or reduce the output count.`);
      }

      const createdAt = isoNow(now);
      const pack = buildCreativePackRecord({
        packId,
        uid,
        orgId,
        workspaceId,
        appId,
        ...normalized,
        costCredits,
        idempotencyKey: key,
        readiness,
        packPlan,
        createdAt,
      });
      const debit = buildCreditDebitRecord({
        txnId: packId,
        uid,
        orgId,
        workspaceId,
        appId,
        packId,
        costCredits,
        idempotencyKey: key,
        createdAt,
      });
      tx.set(creativePackRef(orgId, workspaceId, appId, packId), pack);
      tx.set(creditLedgerRef(orgId, packId), debit);
      const run = {
        id: packId,
        packId,
        label: 'Generated pack',
        cost: costCredits,
        count: normalized.imageCount + normalized.videoCount,
        status: 'preauthorized',
        when: 'Now',
        providerMutations: 0,
      };
      app = { ...app, packPlanStatus: 'accepted', status: 'Generating from approved plan', runs: [run, ...(app.runs || [])], updatedAt: createdAt };
      tx.set(appRef(orgId, workspaceId, appId), app);
      tx.set(packPlanRef(orgId, workspaceId, appId, packPlanId), { ...planRecord, status: 'accepted', acceptedAt: createdAt, packId });
      tx.set(auditEventRef(orgId, `pack-${packId}`), {
        eventId: `pack-${packId}`,
        orgId,
        actorUid: uid,
        type: 'creative_pack_preauthorized',
        appId,
        workspaceId,
        packId,
        costCredits,
        createdAt,
        providerMutations: 0,
      });
      return {
        pack,
        app: customerSafeApp(app),
        creditBalance: creditBalance - costCredits,
        readiness,
        idempotent: false,
        providerMutations: 0,
      };
    });
  }

  async function recordReviewDecisionForUser({
    uid,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    appId,
    packId,
    draftId,
    action,
    format,
    angle,
    note,
    idempotencyKey,
  } = {}) {
    if (!uid) throw new Error('Sign in to continue.');
    return firestore.runTransaction(async (tx) => {
      const [memberSnap, appSnap, packSnap] = await Promise.all([
        tx.get(memberRef(orgId, uid)),
        tx.get(appRef(orgId, workspaceId, appId)),
        tx.get(creativePackRef(orgId, workspaceId, appId, packId)),
      ]);
      if (!memberSnap.exists) throw new Error('Access denied for this org.');
      if (!appSnap.exists) throw new Error('App not found.');
      if (!packSnap.exists) throw new Error('Creative pack not found.');
      const app = appSnap.data();
      const draft = (app.ads || []).find((candidate) => candidate.id === draftId && candidate.packId === packId);
      if (!draft) throw new Error('Review draft not found.');
      const pair = buildReviewDecisionLearningPair({
        orgId,
        workspaceId,
        appId,
        packId,
        draftId,
        createdBy: uid,
        action,
        format: format || draft.format,
        angle: angle || draft.angle,
        note,
        createdAt: isoNow(now),
        idempotencyKey,
      });
      const decisionRef = reviewDecisionRef(orgId, workspaceId, appId, packId, pair.decision.decisionId);
      const existing = await tx.get(decisionRef);
      if (existing.exists) {
        const learningSnap = await tx.get(learningEventRef(orgId, workspaceId, appId, pair.learningEvent.eventId));
        return { decision: existing.data(), learningEvent: learningSnap.data(), app: customerSafeApp(app), idempotent: true, providerMutations: 0 };
      }
      const ads = (app.ads || []).map((candidate) => candidate.id === draftId
        ? {
          ...candidate,
          status: pair.decision.action === 'approved' ? 'approved' : pair.decision.action === 'rejected' ? 'rejected' : candidate.status,
          ...(pair.decision.note ? { tweakNote: pair.decision.note } : {}),
        }
        : candidate);
      const updatedApp = {
        ...app,
        ads,
        reviewDecisions: [pair.decision, ...(app.reviewDecisions || [])].slice(0, 100),
        learningEvents: [pair.learningEvent, ...(app.learningEvents || [])].slice(0, 100),
        updatedAt: isoNow(now),
      };
      tx.set(decisionRef, toPlain(pair.decision));
      tx.set(learningEventRef(orgId, workspaceId, appId, pair.learningEvent.eventId), toPlain(pair.learningEvent));
      tx.set(appRef(orgId, workspaceId, appId), updatedApp);
      return { ...pair, app: customerSafeApp(updatedApp), idempotent: false, providerMutations: 0 };
    });
  }

  async function authorizePackForGeneration({
    uid,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    appId,
    packId,
  } = {}) {
    if (!uid) throw new Error('Sign in to continue.');
    if (!orgId || !workspaceId || !appId || !packId) {
      throw new Error('Create a paid pack before generation.');
    }
    const [memberSnap, appSnap, packSnap] = await Promise.all([
      memberRef(orgId, uid).get(),
      appRef(orgId, workspaceId, appId).get(),
      creativePackRef(orgId, workspaceId, appId, packId).get(),
    ]);
    if (!memberSnap.exists) throw new Error('Access denied for this org.');
    if (!appSnap.exists) throw new Error('App not found.');
    if (!packSnap.exists) throw new Error('Create a paid pack before generation.');
    const pack = packSnap.data();
    if (!isPackGenerationReady(pack)) {
      throw new Error('This pack is not ready to generate yet.');
    }
    return {
      pack,
      app: customerSafeApp(appSnap.data()),
      providerMutations: 0,
    };
  }

  async function createGenerationJob({
    uid,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    appId,
    packId,
  } = {}) {
    if (!uid) throw new Error('Sign in to continue.');
    if (!orgId || !workspaceId || !appId || !packId) {
      throw new Error('Create a paid pack before generation.');
    }
    const jobId = generationJobIdForPack(packId);

    return firestore.runTransaction(async (tx) => {
      const [memberSnap, appSnap, packSnap, jobSnap] = await Promise.all([
        tx.get(memberRef(orgId, uid)),
        tx.get(appRef(orgId, workspaceId, appId)),
        tx.get(creativePackRef(orgId, workspaceId, appId, packId)),
        tx.get(creativeJobRef(orgId, workspaceId, appId, jobId)),
      ]);
      if (!memberSnap.exists) throw new Error('Access denied for this org.');
      if (!appSnap.exists) throw new Error('App not found.');
      if (!packSnap.exists) throw new Error('Create a paid pack before generation.');
      if (jobSnap.exists) {
        return { job: customerSafeJob(jobSnap.data()), idempotent: true, providerMutations: 0 };
      }
      const pack = packSnap.data();
      if (!isPackGenerationReady(pack)) {
        throw new Error('This pack is not ready to generate yet.');
      }

      const createdAt = isoNow(now);
      const job = buildCreativeJobGraph({
        jobId,
        orgId,
        workspaceId,
        appId,
        packId,
        createdBy: uid,
        imageCount: pack.outputMix.image,
        videoCount: pack.outputMix.video,
        app: appSnap.data(),
        packPlan: pack.packPlanSnapshot || null,
        costCredits: pack.costCredits,
        createdAt,
      });
      tx.set(creativeJobRef(orgId, workspaceId, appId, jobId), toPlain(job));
      tx.set(creativePackRef(orgId, workspaceId, appId, packId), {
        ...pack,
        status: 'generation_queued',
        jobId,
        updatedAt: createdAt,
      });
      tx.set(auditEventRef(orgId, `job-${jobId}`), {
        eventId: `job-${jobId}`,
        orgId,
        actorUid: uid,
        type: 'creative_job_queued',
        appId,
        workspaceId,
        packId,
        jobId,
        createdAt,
        providerMutations: 0,
      });
      return { job: customerSafeJob(job), idempotent: false, providerMutations: 0 };
    });
  }

  async function readJobForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID, appId, jobId } = {}) {
    await assertCanReadOrg({ uid, orgId });
    const jobSnap = await creativeJobRef(orgId, workspaceId, appId, jobId).get();
    if (!jobSnap.exists) throw new Error('Job not found.');
    return customerSafeJob(jobSnap.data());
  }

  /* Server-only runner hooks (admin SDK; never routed to client requests). */
  async function serverReadJob({ orgId, workspaceId, appId, jobId } = {}) {
    const jobSnap = await creativeJobRef(orgId, workspaceId, appId, jobId).get();
    return jobSnap.exists ? jobSnap.data() : null;
  }

  async function serverClaimTask({ orgId, workspaceId, appId, jobId, taskId, workerId, claimedAt, leaseExpiresAt } = {}) {
    const ref = creativeJobRef(orgId, workspaceId, appId, jobId);
    return firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const job = toPlain(snap.data());
      if (['completed', 'completed_with_holds', 'failed'].includes(job.status)) return null;
      const observedAtMs = Date.parse(claimedAt);
      const tasksById = new Map((job.tasks || []).map((task) => [task.taskId, task]));
      const task = tasksById.get(taskId);
      const leaseExpired = (candidate) => {
        const expiresAt = Date.parse(candidate?.lease?.expiresAt || '');
        return !Number.isFinite(expiresAt) || expiresAt <= observedAtMs;
      };
      const anotherActiveLease = (job.tasks || []).some((candidate) => (
        candidate.taskId !== taskId
        && candidate.status === 'running'
        && !leaseExpired(candidate)
      ));
      if (!task || anotherActiveLease || Number(task.attempts || 0) >= Number(task.maxAttempts || 1)) return null;
      if (!(task.status === 'queued' || (task.status === 'running' && leaseExpired(task)))) return null;
      if (!(task.dependsOn || []).every((dependency) => tasksById.get(dependency)?.status === 'succeeded')) return null;
      task.status = 'running';
      task.attempts = Number(task.attempts || 0) + 1;
      task.lease = { workerId, claimedAt, expiresAt: leaseExpiresAt };
      task.updatedAt = claimedAt;
      job.status = 'running';
      job.updatedAt = claimedAt;
      tx.set(ref, job);
      return job;
    });
  }

  async function serverCommitTask({ job, taskId, workerId } = {}) {
    const ref = creativeJobRef(job.orgId, job.workspaceId, job.appId, job.jobId);
    return firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Job not found while committing a task.');
      const current = snap.data();
      const currentTask = (current.tasks || []).find((task) => task.taskId === taskId);
      const incomingTask = (job.tasks || []).find((task) => task.taskId === taskId);
      if (!currentTask || !incomingTask || currentTask.lease?.workerId !== workerId || currentTask.attempts !== incomingTask.attempts) {
        throw new Error('Task lease was lost before commit.');
      }
      incomingTask.lease = null;
      tx.set(ref, toPlain(job));
      return job;
    });
  }

  async function serverSaveJob(job) {
    await creativeJobRef(job.orgId, job.workspaceId, job.appId, job.jobId).set(toPlain(job));
    return job;
  }

  async function serverFinalizeJob({ job } = {}) {
    const finalizedAt = isoNow(now);
    await firestore.runTransaction(async (tx) => {
      const [packSnap, appSnap] = await Promise.all([
        tx.get(creativePackRef(job.orgId, job.workspaceId, job.appId, job.packId)),
        tx.get(appRef(job.orgId, job.workspaceId, job.appId)),
      ]);
      tx.set(creativeJobRef(job.orgId, job.workspaceId, job.appId, job.jobId), toPlain(job));
      if (packSnap.exists) {
        tx.set(creativePackRef(job.orgId, job.workspaceId, job.appId, job.packId), {
          ...packSnap.data(),
          status: job.status === 'failed' ? 'generation_failed' : 'drafts_ready',
          updatedAt: finalizedAt,
        });
      }
      if (appSnap.exists) {
        const app = appSnap.data();
        const runs = (app.runs || []).map((run) => (
          run.id === job.packId || run.packId === job.packId
            ? { ...run, status: job.status === 'failed' ? 'failed' : 'ready', jobId: job.jobId }
            : run
        ));
        const existingIds = new Set((app.ads || []).map((ad) => ad.id));
        const ads = [
          ...job.drafts
            .filter((draft) => !existingIds.has(draft.draftId))
            .map((draft) => ({
              id: draft.draftId,
              appId: job.appId,
              format: draft.format === 'image_ad' ? 'image' : 'ugc',
              caption: draft.caption,
              angle: draft.angleId,
              screenId: draft.screenId,
              status: draft.status === 'ready_for_review' ? 'ready' : 'held',
              jobId: job.jobId,
              packId: job.packId,
              storageKey: draft.storageKey,
              providerMutations: 0,
            })),
          ...(app.ads || []),
        ];
        tx.set(appRef(job.orgId, job.workspaceId, job.appId), { ...app, runs, ads, updatedAt: finalizedAt });
      }
      tx.set(auditEventRef(job.orgId, `job-${job.jobId}-final`), {
        eventId: `job-${job.jobId}-final`,
        orgId: job.orgId,
        actorUid: job.createdBy,
        type: 'creative_job_finished',
        appId: job.appId,
        workspaceId: job.workspaceId,
        packId: job.packId,
        jobId: job.jobId,
        status: job.status,
        createdAt: finalizedAt,
        providerMutations: 0,
      });
    });
    return job;
  }

  async function canReadOrg({ uid, orgId } = {}) {
    if (!uid || !orgId) return false;
    return (await memberRef(orgId, uid).get()).exists;
  }

  async function assertCanReadOrg({ uid, orgId } = {}) {
    if (!await canReadOrg({ uid, orgId })) {
      throw new Error('Access denied for this org.');
    }
  }

  function canClientAccessServerCollection(collectionName) {
    return !isServerOnlyCollection(collectionName);
  }

  function serverSnapshot() {
    return {
      backend: 'firestore',
      providerMutations: 0,
    };
  }

  return {
    backend: 'firestore',
    bootstrapUser,
    claimPreview,
    createAppFromExtraction,
    listAppsForUser,
    readAppForUser,
    createPackPlanForUser,
    readPackPlanForUser,
    readPackPlanRequestForUser,
    createPackForUser,
    recordReviewDecisionForUser,
    authorizePackForGeneration,
    createGenerationJob,
    readJobForUser,
    serverReadJob,
    serverClaimTask,
    serverCommitTask,
    serverSaveJob,
    serverFinalizeJob,
    canReadOrg,
    canClientAccessServerCollection,
    serverSnapshot,
  };

  async function uniqueAppIdInTransaction(tx, { orgId, workspaceId, base }) {
    let appId = base || 'app';
    let suffix = 2;
    while ((await tx.get(appRef(orgId, workspaceId, appId))).exists) {
      appId = `${base}-${suffix}`;
      suffix += 1;
    }
    return appId;
  }

  function userRef(uid) {
    return firestore.collection('users').doc(uid);
  }

  function orgRef(orgId) {
    return firestore.collection('orgs').doc(orgId);
  }

  function memberRef(orgId, uid) {
    return orgRef(orgId).collection('members').doc(uid);
  }

  function workspaceRef(orgId, workspaceId) {
    return orgRef(orgId).collection('workspaces').doc(workspaceId);
  }

  function appsCollection(orgId, workspaceId) {
    return workspaceRef(orgId, workspaceId).collection('apps');
  }

  function appRef(orgId, workspaceId, appId) {
    return appsCollection(orgId, workspaceId).doc(appId);
  }

  function appProfileRef(orgId, workspaceId, appId, profileId) {
    return appRef(orgId, workspaceId, appId).collection('appProfiles').doc(profileId);
  }

  function sourceAssetRef(orgId, workspaceId, appId, assetId) {
    return appRef(orgId, workspaceId, appId).collection('sourceAssets').doc(assetId);
  }

  function researchSnapshotRef(orgId, workspaceId, appId, snapshotId) {
    return appRef(orgId, workspaceId, appId).collection('researchSnapshots').doc(snapshotId);
  }

  function packPlanRef(orgId, workspaceId, appId, planId) {
    return appRef(orgId, workspaceId, appId).collection('packPlans').doc(planId);
  }

  function packPlanRequestRef(orgId, workspaceId, appId, requestId) {
    return appRef(orgId, workspaceId, appId).collection('packPlanRequests').doc(requestId);
  }

  function creativePackRef(orgId, workspaceId, appId, packId) {
    return appRef(orgId, workspaceId, appId).collection('creativePacks').doc(packId);
  }

  function reviewDecisionRef(orgId, workspaceId, appId, packId, decisionId) {
    return creativePackRef(orgId, workspaceId, appId, packId).collection('reviewDecisions').doc(decisionId);
  }

  function learningEventRef(orgId, workspaceId, appId, eventId) {
    return appRef(orgId, workspaceId, appId).collection('learningEvents').doc(eventId);
  }

  function creativeJobRef(orgId, workspaceId, appId, jobId) {
    return appRef(orgId, workspaceId, appId).collection('creativeJobs').doc(jobId);
  }

  function claimRef(orgId, claimDocId) {
    return orgRef(orgId).collection('claims').doc(claimDocId);
  }

  function creditLedgerCollection(orgId) {
    return orgRef(orgId).collection('creditLedger');
  }

  function entitlementRef(orgId, entitlementId) {
    return orgRef(orgId).collection('entitlements').doc(entitlementId);
  }

  function creditLedgerRef(orgId, txnId) {
    return creditLedgerCollection(orgId).doc(txnId);
  }

  function auditEventRef(orgId, eventId) {
    return orgRef(orgId).collection('auditEvents').doc(eventId);
  }
}

function sessionPayload(bootstrap) {
  return {
    uid: bootstrap.uid,
    email: bootstrap.email,
    orgId: bootstrap.orgId,
    workspaceId: bootstrap.workspaceId,
    providerMutations: 0,
  };
}

function isPackGenerationReady(pack) {
  return ['preauthorized_mock', 'preauthorized', 'ready_for_generation'].includes(pack?.status);
}
