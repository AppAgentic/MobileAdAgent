/* In-memory tenant store adapter for local demo/testing.
   Shares document shapes with the production Firestore adapter through
   lib/tenant-model.mjs; only the persistence differs. */

import { CLAIM_PRODUCTS } from './local-preview.mjs';
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

export function createTenantStore({ now = () => Date.now() } = {}) {
  const users = new Map();
  const orgs = new Map();
  const bootstrapKeys = new Map();
  const claimKeys = new Map();
  const packKeys = new Map();
  const packPlanKeys = new Map();
  const packPlansById = new Map();
  const packsById = new Map();
  const jobsById = new Map();

  function bootstrapUser({ uid, email, previewSessionId = null } = {}) {
    const cleanEmail = normalizeEmail(email);
    const cleanUid = uid || uidForEmail(cleanEmail);
    const bootstrapKey = cleanUid;

    if (bootstrapKeys.has(bootstrapKey)) {
      const existing = bootstrapKeys.get(bootstrapKey);
      return { ...existing, idempotent: true };
    }

    const createdAt = isoNow(now);
    const docs = buildBootstrapDocs({ uid: cleanUid, email: cleanEmail, createdAt });
    const org = {
      ...docs.org,
      members: new Map([[cleanUid, docs.member]]),
      workspaces: new Map([[docs.workspaceId, { ...docs.workspace, apps: new Map() }]]),
      creditLedger: new Map(),
      entitlements: new Map(),
      auditEvents: new Map(),
      apiKeys: new Map(),
    };
    users.set(cleanUid, docs.user);
    orgs.set(docs.orgId, org);

    const result = {
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
    bootstrapKeys.set(bootstrapKey, result);
    return result;
  }

  function claimPreview({ uid, email, previewSessionId, canonicalAppId, extraction, productId = 'launch_pack' } = {}) {
    if (!previewSessionId) {
      throw new Error('Preview session is required.');
    }
    if (!canonicalAppId) {
      throw new Error('Canonical app ID is required.');
    }
    if (!extraction?.app) {
      throw new Error('Cached app extraction is required.');
    }

    const bootstrap = bootstrapUser({ uid, email, previewSessionId });
    const idempotencyKey = claimIdempotencyKey({ uid: bootstrap.uid, previewSessionId, canonicalAppId });
    if (claimKeys.has(idempotencyKey)) {
      return { ...claimKeys.get(idempotencyKey), idempotent: true };
    }

    const product = CLAIM_PRODUCTS[productId];
    if (!product) {
      throw new Error('Choose the Launch Pack or a plan to continue.');
    }

    const org = orgs.get(bootstrap.orgId);
    const workspace = org.workspaces.get(bootstrap.workspaceId);
    const createdAt = isoNow(now);
    const appId = uniqueAppId(workspace, slugify(extraction.app.name || canonicalAppId));
    const { app } = buildClaimedAppDocs({
      orgId: bootstrap.orgId,
      workspaceId: bootstrap.workspaceId,
      appId,
      createdBy: bootstrap.uid,
      extraction,
      createdAt,
    });

    workspace.apps.set(appId, app);

    const claim = buildClaimRecord({
      uid: bootstrap.uid,
      email: bootstrap.email,
      orgId: bootstrap.orgId,
      workspaceId: bootstrap.workspaceId,
      appId,
      previewSessionId,
      canonicalAppId,
      product,
      createdAt,
    });
    const claimDocId = stableHash(idempotencyKey);
    org.entitlements.set(claimDocId, {
      entitlementId: claimDocId,
      orgId: bootstrap.orgId,
      uid: bootstrap.uid,
      productId: product.id,
      creditGrant: product.credits,
      packMix: product.packMix || null,
      source: 'preview_claim',
      idempotencyKey,
      createdAt,
      providerMutations: 0,
    });
    org.creditLedger.set(claimDocId, {
      txnId: claimDocId,
      orgId: bootstrap.orgId,
      uid: bootstrap.uid,
      type: 'grant',
      credits: product.credits,
      source: product.id,
      idempotencyKey,
      createdAt,
      providerMutations: 0,
    });
    org.auditEvents.set(`claim-${claimDocId}`, {
      eventId: `claim-${claimDocId}`,
      orgId: bootstrap.orgId,
      actorUid: bootstrap.uid,
      type: 'preview_claimed',
      appId,
      workspaceId: bootstrap.workspaceId,
      canonicalAppId,
      createdAt,
      providerMutations: 0,
    });
    const result = {
      session: sessionPayload(bootstrap),
      claim,
      app: customerSafeApp(app),
      apps: [customerSafeApp(app)],
      idempotent: false,
      providerMutations: 0,
    };
    claimKeys.set(idempotencyKey, result);
    return result;
  }

  function createAppFromExtraction({
    uid,
    email,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    extraction,
    entrySource = 'Dashboard URL',
  } = {}) {
    if (!extraction?.app) throw new Error('App extraction is required.');
    let cleanUid = uid;
    let cleanEmail = email;
    let cleanOrgId = orgId;
    let cleanWorkspaceId = workspaceId;
    if (!cleanUid || !cleanOrgId) {
      const bootstrap = bootstrapUser({ uid, email });
      cleanUid = bootstrap.uid;
      cleanEmail = bootstrap.email;
      cleanOrgId = bootstrap.orgId;
      cleanWorkspaceId = bootstrap.workspaceId;
    }
    const org = orgs.get(cleanOrgId);
    if (!org?.members.has(cleanUid)) throw new Error('Access denied for this org.');
    const workspace = org.workspaces.get(cleanWorkspaceId);
    if (!workspace) throw new Error('Workspace not found.');

    const createdAt = isoNow(now);
    const appId = uniqueAppId(workspace, slugify(extraction.app.name || extraction.url || 'app'));
    const { app } = buildClaimedAppDocs({
      orgId: cleanOrgId,
      workspaceId: cleanWorkspaceId,
      appId,
      createdBy: cleanUid,
      extraction,
      createdAt,
    });
    app.entrySource = entrySource;
    workspace.apps.set(appId, app);
    org.auditEvents.set(`app-import-${appId}`, {
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
      apps: [...workspace.apps.values()].map(customerSafeApp),
      session: {
        uid: cleanUid,
        email: cleanEmail,
        orgId: cleanOrgId,
        workspaceId: cleanWorkspaceId,
      },
      providerMutations: 0,
    };
  }

  function listAppsForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
    const workspace = workspaceForMember({ uid, orgId, workspaceId });
    return [...workspace.apps.values()].map(customerSafeApp);
  }

  function readAppForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID, appId } = {}) {
    const workspace = workspaceForMember({ uid, orgId, workspaceId });
    const app = workspace.apps.get(appId);
    if (!app) throw new Error('App not found.');
    return customerSafeApp(app);
  }

  function createPackPlanForUser({
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
    const workspace = workspaceForMember({ uid, orgId, workspaceId });
    let app = workspace.apps.get(appId);
    if (!app) throw new Error('App not found.');
    const cleanKey = String(idempotencyKey || '').trim();
    if (!cleanKey) throw new Error('Pack Plan idempotency key is required.');
    const key = `${uid}:${orgId}:${workspaceId}:${appId}:${cleanKey}`;
    if (packPlanKeys.has(key)) {
      const existing = packPlanKeys.get(key);
      return { ...existing, idempotent: true, providerMutations: 0 };
    }

    app = appPlan ? applyReviewedPlanPatch(app, { ...appPlan, updatedAt: isoNow(now) }) : app;
    const readiness = appReadiness(app);
    if (!readiness.ready) throw new Error(readiness.messages[0] || 'Review the app info before planning.');
    validatePackPlanResearchSnapshot(researchSnapshot);
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
    app = {
      ...app,
      extractionStatus: 'approved',
      status: 'Pack Plan ready',
      packPlanStatus: 'proposed',
      activePackPlanId: plan.planId,
      activePackPlan: customerSafeCreativePackPlan(plan),
      latestResearchSnapshotId: `research-${researchSnapshot.snapshotFingerprint.slice(0, 20)}`,
      planRevision,
      angles: [
        { id: 'primary', label: plan.experiment.primary.angle, evidence: plan.experiment.primary.rationale, selected: true },
        { id: 'challenger', label: plan.experiment.challenger.angle, evidence: plan.experiment.challenger.rationale, selected: true },
      ],
      updatedAt: createdAt,
      providerMutations: 0,
    };
    workspace.apps.set(appId, app);
    packPlansById.set(plan.planId, { plan, uid, orgId, workspaceId, appId, status: 'proposed', planRevision });
    const result = {
      plan: customerSafeCreativePackPlan(plan),
      app: customerSafeApp(app),
      readiness,
      planRevision,
      idempotent: false,
      providerMutations: 0,
    };
    packPlanKeys.set(key, result);
    return result;
  }

  function readPackPlanForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID, appId, planId } = {}) {
    workspaceForMember({ uid, orgId, workspaceId });
    const entry = packPlansById.get(planId);
    if (!entry || entry.orgId !== orgId || entry.workspaceId !== workspaceId || entry.appId !== appId) {
      throw new Error('Pack Plan not found.');
    }
    return { plan: customerSafeCreativePackPlan(entry.plan), status: entry.status, planRevision: entry.planRevision, providerMutations: 0 };
  }

  function readPackPlanRequestForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID, appId, idempotencyKey } = {}) {
    workspaceForMember({ uid, orgId, workspaceId });
    const cleanKey = String(idempotencyKey || '').trim();
    if (!cleanKey) throw new Error('Pack Plan idempotency key is required.');
    const result = packPlanKeys.get(`${uid}:${orgId}:${workspaceId}:${appId}:${cleanKey}`);
    return result ? { ...result, idempotent: true, providerMutations: 0 } : null;
  }

  function createPackForUser({
    uid,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    appId,
    imageCount,
    videoCount,
    idempotencyKey,
    packPlanId,
  } = {}) {
    const workspace = workspaceForMember({ uid, orgId, workspaceId });
    const org = orgs.get(orgId);
    let app = workspace.apps.get(appId);
    if (!app) throw new Error('App not found.');
    const planEntry = packPlansById.get(packPlanId);
    if (!planEntry || planEntry.orgId !== orgId || planEntry.workspaceId !== workspaceId || planEntry.appId !== appId) {
      throw new Error('Build and review a Pack Plan before generating.');
    }
    if (planEntry.status !== 'proposed') {
      const existingKey = `${uid}:${orgId}:${workspaceId}:${appId}:pack-plan:${packPlanId}`;
      if (packKeys.has(existingKey)) return { ...packKeys.get(existingKey), idempotent: true, providerMutations: 0 };
      throw new Error('This Pack Plan has already been used. Build the next plan before generating again.');
    }
    validateCreativePackPlan({ plan: planEntry.plan, currentApp: app });
    const normalized = normalizePackRequest({ imageCount, videoCount });
    if (normalized.imageCount !== planEntry.plan.request.outputMix.image || normalized.videoCount !== planEntry.plan.request.outputMix.ugc) {
      throw new Error('The output mix changed after planning. Refresh the Pack Plan before generating.');
    }
    const costCredits = creditCostForPack(normalized);
    if (costCredits !== planEntry.plan.costCredits) throw new Error('Pack Plan credit cost is stale.');
    const key = `${uid}:${orgId}:${workspaceId}:${appId}:pack-plan:${packPlanId}`;
    const packId = creativePackIdFromKey(key);
    if (packKeys.has(key)) {
      return { ...packKeys.get(key), idempotent: true, providerMutations: 0 };
    }
    const reviewedApp = app;
    const appInfoReadiness = appReadiness(reviewedApp);
    if (!appInfoReadiness.ready) {
      throw new Error(appInfoReadiness.messages[0] || 'Review the app info before generating.');
    }
    const creativePreflight = preflightUgcGenerationForApp({ app: reviewedApp, packPlan: planEntry.plan, videoCount: normalized.videoCount });
    buildCreativeJobGraph({
      jobId: generationJobIdForPack(packId),
      orgId,
      workspaceId,
      appId,
      packId,
      createdBy: uid,
      imageCount: normalized.imageCount,
      videoCount: normalized.videoCount,
      app: reviewedApp,
      packPlan: planEntry.plan,
      costCredits,
      createdAt: '2000-01-01T00:00:00.000Z',
    });
    const readiness = { ...appInfoReadiness, creativePreflight };
    const creditBalance = creditBalanceFromLedger([...org.creditLedger.values()]);
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
      packPlan: planEntry.plan,
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
    org.creditLedger.set(debit.txnId, debit);
    packsById.set(packId, {
      pack,
      orgId,
      workspaceId,
      appId,
    });
    planEntry.status = 'accepted';
    app = {
      ...reviewedApp,
      packPlanStatus: 'accepted',
      status: 'Generating from approved plan',
      updatedAt: createdAt,
    };
    workspace.apps.set(appId, app);
    org.auditEvents.set(`pack-${packId}`, {
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
    app.runs.unshift({
      id: packId,
      label: 'Generated pack',
      cost: costCredits,
      count: normalized.imageCount + normalized.videoCount,
      status: 'preauthorized_mock',
      when: 'Now',
      providerMutations: 0,
    });
    const result = {
      pack,
      app: customerSafeApp(app),
      creditBalance: creditBalance - costCredits,
      readiness,
      idempotent: false,
      providerMutations: 0,
    };
    packKeys.set(key, result);
    return result;
  }

  function recordReviewDecisionForUser({
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
    const workspace = workspaceForMember({ uid, orgId, workspaceId });
    const app = workspace.apps.get(appId);
    if (!app) throw new Error('App not found.');
    const packEntry = packsById.get(packId);
    if (!packEntry || packEntry.orgId !== orgId || packEntry.workspaceId !== workspaceId || packEntry.appId !== appId) {
      throw new Error('Creative pack not found.');
    }
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
    const prior = (app.reviewDecisions || []).find((decision) => decision.decisionId === pair.decision.decisionId);
    if (prior) {
      return { decision: prior, learningEvent: (app.learningEvents || []).find((event) => event.eventId === pair.learningEvent.eventId), app: customerSafeApp(app), idempotent: true, providerMutations: 0 };
    }
    draft.status = pair.decision.action === 'approved' ? 'approved' : pair.decision.action === 'rejected' ? 'rejected' : draft.status;
    if (pair.decision.note) draft.tweakNote = pair.decision.note;
    app.reviewDecisions = [pair.decision, ...(app.reviewDecisions || [])];
    app.learningEvents = [pair.learningEvent, ...(app.learningEvents || [])];
    app.updatedAt = isoNow(now);
    return { ...pair, app: customerSafeApp(app), idempotent: false, providerMutations: 0 };
  }

  function authorizePackForGeneration({
    uid,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    appId,
    packId,
  } = {}) {
    const workspace = workspaceForMember({ uid, orgId, workspaceId });
    const app = workspace.apps.get(appId);
    if (!app) throw new Error('App not found.');
    const packEntry = packsById.get(packId);
    if (
      !packEntry
      || packEntry.orgId !== orgId
      || packEntry.workspaceId !== workspaceId
      || packEntry.appId !== appId
    ) {
      throw new Error('Create a paid pack before generation.');
    }
    if (!isPackGenerationReady(packEntry.pack)) {
      throw new Error('This pack is not ready to generate yet.');
    }
    return {
      pack: toPlain(packEntry.pack),
      app: customerSafeApp(app),
      providerMutations: 0,
    };
  }

  function createGenerationJob({
    uid,
    orgId,
    workspaceId = DEFAULT_WORKSPACE_ID,
    appId,
    packId,
    ugcRoute,
  } = {}) {
    const workspace = workspaceForMember({ uid, orgId, workspaceId });
    const app = workspace.apps.get(appId);
    if (!app) throw new Error('App not found.');
    const packEntry = packsById.get(packId);
    if (
      !packEntry
      || packEntry.orgId !== orgId
      || packEntry.workspaceId !== workspaceId
      || packEntry.appId !== appId
    ) {
      throw new Error('Create a paid pack before generation.');
    }

    const jobId = generationJobIdForPack(packId);
    const existing = jobsById.get(jobId);
    if (existing) {
      return { job: customerSafeJob(existing.job), idempotent: true, providerMutations: 0 };
    }
    if (!isPackGenerationReady(packEntry.pack)) {
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
      imageCount: packEntry.pack.outputMix.image,
      videoCount: packEntry.pack.outputMix.video,
      app,
      packPlan: packPlansById.get(packEntry.pack.packPlanId)?.plan || null,
      costCredits: packEntry.pack.costCredits,
      createdAt,
      ...(ugcRoute ? { ugcRoute } : {}),
    });
    jobsById.set(jobId, { job, orgId, workspaceId, appId });
    packEntry.pack.status = 'generation_queued';
    packEntry.pack.jobId = jobId;
    packEntry.pack.updatedAt = createdAt;
    const run = app.runs.find((candidate) => candidate.id === packId || candidate.packId === packId);
    if (run) {
      run.status = 'generating';
      run.jobId = jobId;
    }
    orgs.get(orgId).auditEvents.set(`job-${jobId}`, {
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
  }

  function readJobForUser({ uid, orgId, workspaceId = DEFAULT_WORKSPACE_ID, appId, jobId } = {}) {
    workspaceForMember({ uid, orgId, workspaceId });
    const entry = jobsById.get(jobId);
    if (!entry || entry.orgId !== orgId || entry.workspaceId !== workspaceId || (appId && entry.appId !== appId)) {
      throw new Error('Job not found.');
    }
    return customerSafeJob(entry.job);
  }

  /* Server-only runner hooks: never routed to client requests. */
  function serverReadJob({ orgId, workspaceId, appId, jobId } = {}) {
    const entry = jobsById.get(jobId);
    if (!entry || entry.orgId !== orgId || entry.workspaceId !== workspaceId || entry.appId !== appId) {
      return null;
    }
    return entry.job;
  }

  function serverClaimTask({ orgId, workspaceId, appId, jobId, taskId, workerId, claimedAt, leaseExpiresAt } = {}) {
    const entry = jobsById.get(jobId);
    if (!entry || entry.orgId !== orgId || entry.workspaceId !== workspaceId || entry.appId !== appId) return null;
    const job = entry.job;
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
    return job;
  }

  function serverCommitTask({ job, taskId, workerId } = {}) {
    const entry = jobsById.get(job?.jobId);
    if (!entry) throw new Error('Job not found while committing a task.');
    const currentTask = entry.job.tasks.find((task) => task.taskId === taskId);
    const incomingTask = job.tasks.find((task) => task.taskId === taskId);
    if (!currentTask || !incomingTask || currentTask.lease?.workerId !== workerId) {
      throw new Error('Task lease was lost before commit.');
    }
    incomingTask.lease = null;
    entry.job = job;
    return job;
  }

  function serverSaveJob(job) {
    const entry = jobsById.get(job.jobId);
    if (entry) entry.job = job;
    return job;
  }

  function serverFinalizeJob({ job } = {}) {
    serverSaveJob(job);
    const org = orgs.get(job.orgId);
    const workspace = org?.workspaces.get(job.workspaceId);
    const app = workspace?.apps.get(job.appId);
    const packEntry = packsById.get(job.packId);
    const finalizedAt = isoNow(now);
    if (packEntry) {
      packEntry.pack.status = job.status === 'failed' ? 'generation_failed' : 'drafts_ready';
      packEntry.pack.updatedAt = finalizedAt;
    }
    if (app) {
      const run = app.runs.find((candidate) => candidate.id === job.packId || candidate.packId === job.packId);
      if (run) {
        run.status = job.status === 'failed' ? 'failed' : 'ready';
        run.jobId = job.jobId;
      }
      const existingDraftIds = new Set((app.ads || []).map((ad) => ad.id));
      for (const draft of [...job.drafts].reverse()) {
        if (existingDraftIds.has(draft.draftId)) continue;
        app.ads.unshift({
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
        });
      }
      app.updatedAt = finalizedAt;
    }
    org?.auditEvents.set(`job-${job.jobId}-final`, {
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
    return job;
  }

  function canReadOrg({ uid, orgId } = {}) {
    const org = orgs.get(orgId);
    return Boolean(uid && org?.members.has(uid));
  }

  function canClientAccessServerCollection(collectionName) {
    return !isServerOnlyCollection(collectionName);
  }

  function serverSnapshot() {
    return {
      backend: 'memory',
      users: users.size,
      orgs: orgs.size,
      claims: claimKeys.size,
      packPlans: packPlansById.size,
      providerMutations: 0,
    };
  }

  function workspaceForMember({ uid, orgId, workspaceId }) {
    if (!canReadOrg({ uid, orgId })) {
      throw new Error('Access denied for this org.');
    }
    const workspace = orgs.get(orgId)?.workspaces.get(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    return workspace;
  }

  return {
    backend: 'memory',
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
}

function isPackGenerationReady(pack) {
  return ['preauthorized_mock', 'preauthorized', 'ready_for_generation'].includes(pack?.status);
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

function uniqueAppId(workspace, base) {
  let id = base || 'app';
  let suffix = 2;
  while (workspace.apps.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}
