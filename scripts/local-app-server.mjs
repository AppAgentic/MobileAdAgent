import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAppFromUrl } from '../lib/local-extraction.mjs';
import { createDemoAppExtraction } from '../lib/demo-app-fixture.mjs';
import {
  fetchStoreReviews,
  storeReviewSignalsForPackPlan,
} from '../lib/store-review-adapter.mjs';
import { buildJobManifest } from '../lib/creative-job-model.mjs';
import { researchMarketSignals } from '../lib/pack-plan-adapter.mjs';
import {
  buildCreativePackPlan,
  buildLearnedPackPlanStrategy,
  buildPackPlanResearchSnapshot,
  buildSelectedProductTruth,
} from '../lib/pack-plan-model.mjs';
import { resolveGenerationAdapters } from '../lib/generation-adapters.mjs';
import { runCreativeJob } from '../lib/local-job-runner.mjs';
import { createSampleState, exportManifest, runLocalCreativePipeline } from '../lib/local-pipeline.mjs';
import {
  buildPreviewPayload,
  canonicalPreviewAppId,
  createPreviewStore,
  isAllowedPreviewUrl,
} from '../lib/local-preview.mjs';
import {
  authContextForRequest,
  authErrorResponse,
  firebaseAuthRequired,
  tenantBackendMode,
} from '../lib/server-auth.mjs';
import { createConfiguredTenantStore } from '../lib/tenant-store-factory.mjs';
import { applyReviewedPlanPatch, buildClaimedAppDocs } from '../lib/tenant-model.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(rootDir, 'local-app');
const defaultHost = process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1';
const host = process.env.HOST || defaultHost;
const port = Number(process.env.PORT || process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] || 3107);

const previewStore = createPreviewStore({
  maxPreviewsPerWindow: numberEnv('MAA_PREVIEW_RATE_LIMIT', 12),
  dailyCostCeilingCents: numberEnv('MAA_PREVIEW_DAILY_COST_CENTS', 400),
  extractionCostCents: numberEnv('MAA_PREVIEW_COST_CENTS', 8),
  previewKillSwitch: process.env.MAA_PREVIEW_DISABLED === '1',
});
const tenantStore = await createConfiguredTenantStore();
const firebaseWebConfig = {
  apiKey: process.env.MAA_FIREBASE_WEB_API_KEY || '',
  authDomain: process.env.MAA_FIREBASE_AUTH_DOMAIN || 'mobileadagent.firebaseapp.com',
  projectId: process.env.MAA_FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'mobileadagent',
  appId: process.env.MAA_FIREBASE_WEB_APP_ID || '1:581210343786:web:9f0172651f8c60d0f27d13',
};

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const marketingRoutes = new Set(['/', '/pricing', '/launch-pack']);
const appShellRoutes = new Set(['/app', '/app/import', '/preview', '/login', '/signup']);
const appShellPrefixes = ['/app/apps/', '/app/packs/'];
const publicAssets = new Map([
  ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'],
  ['/marketing/styles.css', 'landing/styles.css'],
  ['/marketing/landing.js', 'landing/landing.js'],
  ['/demo-assets/duolingo-vocabulary-choice.jpg', 'demo-assets/duolingo-vocabulary-choice.jpg'],
  ['/demo-assets/duolingo-sentence-translation.jpg', 'demo-assets/duolingo-sentence-translation.jpg'],
  ['/demo-assets/duolingo-listening-exercise.jpg', 'demo-assets/duolingo-listening-exercise.jpg'],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/' && hasLegacyRootHandoffParams(url.searchParams)) {
      sendJson(response, { ok: false, error: 'Not found' }, 404);
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(response, {
        ok: true,
        app: 'Mobile Ad Agent local prototype',
        tenantBackend: tenantBackendMode(),
        firebaseAuthRequired: firebaseAuthRequired(),
        providerMutations: 0,
      });
      return;
    }

    if (url.pathname === '/api/firebase-config' && request.method === 'GET') {
      const authRequired = firebaseAuthRequired();
      sendJson(response, {
        ok: true,
        enabled: authRequired && Boolean(firebaseWebConfig.apiKey),
        authRequired,
        config: authRequired && firebaseWebConfig.apiKey ? firebaseWebConfig : null,
        providerMutations: 0,
      });
      return;
    }

    if (url.pathname === '/api/sample-state') {
      sendJson(response, createSampleState());
      return;
    }

    if (url.pathname === '/api/bootstrap' && request.method === 'POST') {
      const body = await readJson(request);
      try {
        const auth = await authContextForRequest({ request, body });
        const bootstrap = await tenantStore.bootstrapUser({
          uid: auth.uid || body.uid,
          email: auth.email || body.email,
          previewSessionId: body.previewSessionId,
        });
        sendJson(response, { ok: true, bootstrap });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        sendJson(response, { ok: false, error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === '/api/apps' && request.method === 'GET') {
      try {
        const auth = await authContextForRequest({ request, url });
        const apps = await tenantStore.listAppsForUser({
          uid: auth.uid || url.searchParams.get('uid'),
          orgId: url.searchParams.get('orgId'),
          workspaceId: url.searchParams.get('workspaceId') || 'ws-default',
        });
        sendJson(response, { ok: true, apps, providerMutations: 0 });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        sendJson(response, { ok: false, error: error.message }, 403);
      }
      return;
    }

    if (url.pathname === '/api/apps/import' && request.method === 'POST') {
      const body = await readJson(request);
      try {
        const auth = await authContextForRequest({ request, body });
        const extraction = await extractAppFromUrl({
          url: body.url,
          source: body.source || 'Dashboard URL',
        });
        const result = await tenantStore.createAppFromExtraction({
          uid: auth.uid || body.uid,
          email: auth.email || body.email,
          orgId: body.orgId,
          workspaceId: body.workspaceId || 'ws-default',
          extraction,
          entrySource: body.source || 'Dashboard URL',
        });
        sendJson(response, { ok: true, extraction, ...result, providerMutations: 0 });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        sendJson(response, { ok: false, error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === '/api/apps/demo' && request.method === 'POST') {
      if (process.env.K_SERVICE && process.env.MAA_ENABLE_DEMO_FIXTURE !== '1') {
        sendJson(response, { ok: false, error: 'Not found' }, 404);
        return;
      }
      const body = await readJson(request);
      try {
        const auth = await authContextForRequest({ request, body });
        const extraction = createDemoAppExtraction();
        let uid = auth.uid || body.uid;
        let email = auth.email || body.email;
        let session = null;
        if (!uid || !email) {
          if (process.env.K_SERVICE) {
            throw new Error('Sign in to use the demo fixture.');
          }
          session = await tenantStore.bootstrapUser({
            email: 'browser-demo@example.test',
          });
          uid = session.uid;
          email = session.email;
        }
        const result = await tenantStore.claimPreview({
          uid,
          email,
          previewSessionId: `proof-backed-demo-${uid}`,
          canonicalAppId: 'demo-duolingo-570060128',
          extraction,
          productId: 'launch_pack',
        });
        sendJson(response, { ok: true, extraction, session, ...result, providerMutations: 0 });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        sendJson(response, { ok: false, error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === '/api/previews/from-url' && request.method === 'POST') {
      const body = await readJson(request);
      if (!isAllowedPreviewUrl(body.url)) {
        sendJson(response, {
          ok: false,
          error: 'Previews work with App Store and Google Play links. Websites can be imported after you sign up.',
        }, 400);
        return;
      }
      const canonicalAppId = canonicalPreviewAppId(body.url);
      let previewCheck;
      try {
        previewCheck = previewStore.checkPreviewAllowed({ canonicalAppId, ip: clientIp(request) });
      } catch (error) {
        sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, 429);
        return;
      }
      let extraction = previewCheck.cachedExtraction;
      const cache = previewCheck.cache;
      if (!extraction) {
        extraction = await extractAppFromUrl({
          url: body.url,
          source: 'anonymous_preview',
        });
        previewStore.cacheExtraction(canonicalAppId, extraction);
      }
      const session = previewStore.createSession({ canonicalAppId, url: body.url });
      sendJson(response, {
        ok: true,
        cache,
        preview: buildPreviewPayload(extraction, session),
        previewStats: previewStore.getCacheStats(canonicalAppId),
      });
      return;
    }

    if (url.pathname === '/api/previews/session' && request.method === 'GET') {
      const session = previewStore.getSession(url.searchParams.get('id'));
      const extraction = session ? previewStore.getCachedExtraction(session.canonicalAppId) : null;
      if (!session || !extraction) {
        sendJson(response, { ok: false, error: 'Preview expired. Paste the app URL again to refresh it.' }, 404);
        return;
      }
      sendJson(response, { ok: true, claimed: Boolean(session.claim), preview: buildPreviewPayload(extraction, session) });
      return;
    }

    if (url.pathname === '/api/previews/pack-plan' && request.method === 'POST') {
      const body = await readJson(request);
      const pending = previewStore.getSession(body.previewSessionId);
      const extraction = pending ? previewStore.getCachedExtraction(pending.canonicalAppId) : null;
      if (!pending || !extraction) {
        sendJson(response, { ok: false, error: 'Preview expired. Paste the app URL again to refresh it.' }, 410);
        return;
      }

      const cached = previewStore.getCachedPackPlan(pending.canonicalAppId);
      if (cached) {
        sendJson(response, { ok: true, ...cached, cache: 'hit', providerMutations: 0 });
        return;
      }

      try {
        const createdAt = new Date().toISOString();
        const reviewedApp = buildAnonymousPreviewPlanningApp({
          extraction,
          canonicalAppId: pending.canonicalAppId,
          createdAt,
        });
        const materials = await buildPackPlanMaterials({
          reviewedApp,
          locale: body.locale || 'en-US',
        });
        const plan = buildCreativePackPlan({
          orgId: 'anonymous-preview',
          workspaceId: 'preview',
          appId: pending.canonicalAppId,
          createdBy: 'anonymous-preview',
          createdAt,
          researchSnapshot: materials.researchSnapshot,
          strategy: materials.strategy,
          outputMix: {
            image: Number.isInteger(body.imageCount) ? body.imageCount : 24,
            ugc: Number.isInteger(body.videoCount) ? body.videoCount : 4,
          },
          goal: 'Choose the clearest first creative direction before checkout.',
          channel: 'Paid social',
        });
        const result = {
          plan,
          researchStatus: materials.researchStatus,
          researchLimitations: materials.researchLimitations,
        };
        previewStore.cachePackPlan(pending.canonicalAppId, result);
        sendJson(response, { ok: true, ...result, cache: 'miss', providerMutations: 0 });
      } catch (error) {
        sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, 400);
      }
      return;
    }

    if (url.pathname === '/api/previews/claim' && request.method === 'POST') {
      const body = await readJson(request);
      const auth = await authContextForRequest({ request, body });
      const pending = previewStore.getSession(body.previewSessionId);
      const extraction = pending ? previewStore.getCachedExtraction(pending.canonicalAppId) : null;
      if (!pending || !extraction) {
        sendJson(response, { ok: false, error: 'Preview session expired. Paste the app URL again to refresh the preview.' }, 410);
        return;
      }
      try {
        const email = auth.email || body.email;
        const uid = auth.uid || body.uid;
        previewStore.claimSession({
          sessionId: body.previewSessionId,
          email,
          productId: body.productId,
          appName: extraction.app?.name,
        });
        const result = await tenantStore.claimPreview({
          uid,
          email,
          previewSessionId: body.previewSessionId,
          canonicalAppId: pending.canonicalAppId,
          extraction,
          productId: body.productId,
        });
        sendJson(response, {
          ok: true,
          idempotent: result.idempotent,
          session: result.session,
          claim: result.claim,
          app: result.app,
          apps: result.apps,
          extraction: result.app.extraction,
          providerMutations: 0,
        });
      } catch (error) {
        sendJson(response, { ok: false, error: error.message }, 400);
      }
      return;
    }

    if (url.pathname === '/api/pack-plans/create' && request.method === 'POST') {
      const body = await readJson(request);
      try {
        const auth = await authContextForRequest({ request, body, required: firebaseAuthRequired() });
        const context = {
          uid: auth.uid || body.uid,
          orgId: body.orgId,
          workspaceId: body.workspaceId || 'ws-default',
          appId: body.appId,
        };
        const existing = await tenantStore.readPackPlanRequestForUser?.({ ...context, idempotencyKey: body.idempotencyKey });
        if (existing) {
          const cachedSourceCount = Number(existing.plan?.research?.coverage?.sourceCount || 0);
          sendJson(response, {
            ok: true,
            ...existing,
            researchStatus: cachedSourceCount ? 'cached' : 'limited',
            researchLimitations: cachedSourceCount
              ? []
              : ['No public feedback was available when this saved plan was created. Refresh the plan to retry.'],
            providerMutations: 0,
          });
          return;
        }
        const currentApp = await tenantStore.readAppForUser(context);
        const reviewedApp = body.appPlan
          ? applyReviewedPlanPatch(currentApp, { ...body.appPlan, updatedAt: new Date().toISOString() })
          : currentApp;
        const materials = await buildPackPlanMaterials({ reviewedApp, locale: body.locale || 'en-US' });
        const result = await tenantStore.createPackPlanForUser({
          ...context,
          appPlan: body.appPlan,
          researchSnapshot: materials.researchSnapshot,
          strategy: materials.strategy,
          imageCount: body.imageCount,
          videoCount: body.videoCount,
          goal: body.goal || 'Find the clearest creative direction for this app.',
          channel: body.channel || 'Paid social',
          idempotencyKey: body.idempotencyKey,
        });
        sendJson(response, {
          ok: true,
          ...result,
          researchStatus: materials.researchStatus,
          researchLimitations: materials.researchLimitations,
          providerMutations: 0,
        });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, 400);
      }
      return;
    }

    if (url.pathname === '/api/pack-plans/state' && request.method === 'GET') {
      try {
        const auth = await authContextForRequest({ request, url, required: firebaseAuthRequired() });
        const result = await tenantStore.readPackPlanForUser({
          uid: auth.uid || url.searchParams.get('uid'),
          orgId: url.searchParams.get('orgId'),
          workspaceId: url.searchParams.get('workspaceId') || 'ws-default',
          appId: url.searchParams.get('appId'),
          planId: url.searchParams.get('planId'),
        });
        sendJson(response, { ok: true, ...result, providerMutations: 0 });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, 404);
      }
      return;
    }

    if (url.pathname === '/api/packs/create' && request.method === 'POST') {
      const body = await readJson(request);
      try {
        const auth = await authContextForRequest({ request, body });
        const result = await tenantStore.createPackForUser({
          uid: auth.uid || body.uid,
          orgId: body.orgId,
          workspaceId: body.workspaceId || 'ws-default',
          appId: body.appId,
          imageCount: body.imageCount,
          videoCount: body.videoCount,
          idempotencyKey: body.idempotencyKey,
          packPlanId: body.packPlanId,
        });
        sendJson(response, { ok: true, ...result, providerMutations: 0 });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, 402);
      }
      return;
    }

    if (url.pathname === '/api/review-decisions' && request.method === 'POST') {
      const body = await readJson(request);
      try {
        const auth = await authContextForRequest({ request, body, required: firebaseAuthRequired() });
        const result = await tenantStore.recordReviewDecisionForUser({
          uid: auth.uid || body.uid,
          orgId: body.orgId,
          workspaceId: body.workspaceId || 'ws-default',
          appId: body.appId,
          packId: body.packId,
          draftId: body.draftId,
          action: body.action,
          format: body.format,
          angle: body.angle,
          note: body.note,
          idempotencyKey: body.idempotencyKey,
        });
        sendJson(response, { ok: true, ...result, providerMutations: 0 });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, 400);
      }
      return;
    }

    if (url.pathname === '/api/extractions/from-url' && request.method === 'POST') {
      const body = await readJson(request);
      await authContextForRequest({ request, body, required: firebaseAuthRequired() });
      const extraction = await extractAppFromUrl(body);
      sendJson(response, { ok: true, extraction });
      return;
    }

    if (url.pathname === '/api/jobs/generate' && request.method === 'POST') {
      const body = await readJson(request);
      const auth = await authContextForRequest({ request, body, required: firebaseAuthRequired() });
      await authorizePackRequest({ auth, body });
      const jobContext = {
        uid: auth.uid || body.uid,
        orgId: body.orgId,
        workspaceId: body.workspaceId || 'ws-default',
        appId: body.appId,
        packId: body.packId,
      };
      let result;
      try {
        result = await tenantStore.createGenerationJob(jobContext);
      } catch (error) {
        const status = /access denied/i.test(error.message) ? 403 : 402;
        sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, status);
        return;
      }
      // Respond before any generation work; the worker runs out of band.
      sendJson(response, {
        ok: true,
        jobId: result.job.jobId,
        packId: body.packId,
        status: result.job.status,
        progress: result.job.progress,
        idempotent: result.idempotent,
        providerMutations: 0,
      }, 202);
      queueLocalJobRun({ ...jobContext, jobId: result.job.jobId });
      return;
    }

    if (url.pathname === '/api/jobs/state' && request.method === 'GET') {
      try {
        const auth = await authContextForRequest({ request, url, required: firebaseAuthRequired() });
        const job = await tenantStore.readJobForUser({
          uid: auth.uid || url.searchParams.get('uid'),
          orgId: url.searchParams.get('orgId'),
          workspaceId: url.searchParams.get('workspaceId') || 'ws-default',
          appId: url.searchParams.get('appId'),
          jobId: url.searchParams.get('jobId'),
        });
        sendJson(response, { ok: true, job, providerMutations: 0 });
      } catch (error) {
        if (sendAuthError(response, error)) return;
        const status = /access denied/i.test(error.message) ? 403 : 404;
        sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, status);
      }
      return;
    }

    if (url.pathname === '/api/jobs/manifest' && request.method === 'POST') {
      const body = await readJson(request);
      const auth = await authContextForRequest({ request, body, required: firebaseAuthRequired() });
      if (body.jobId && body.orgId) {
        try {
          const job = await tenantStore.readJobForUser({
            uid: auth.uid || body.uid,
            orgId: body.orgId,
            workspaceId: body.workspaceId || 'ws-default',
            appId: body.appId,
            jobId: body.jobId,
          });
          sendJson(response, buildJobManifest(job));
        } catch (error) {
          const status = /access denied/i.test(error.message) ? 403 : 404;
          sendJson(response, { ok: false, error: error.message, providerMutations: 0 }, status);
        }
        return;
      }
      await authorizePackRequest({ auth, body });
      const job = body.jobId && body.qaReport ? body : runLocalCreativePipeline(body);
      sendJson(response, exportManifest(job));
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      sendJson(response, authResponse.payload, authResponse.status);
      return;
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    sendJson(response, { ok: false, error: error.message }, status);
  }
});

server.listen(port, host, () => {
  console.log(`Mobile Ad Agent local prototype running at http://${host}:${port}`);
});

async function serveStatic(pathname, response) {
  const route = canonicalRoute(pathname);
  const assetPath = publicAssets.get(pathname);

  if (assetPath) {
    await serveFile(assetPath, response);
    return;
  }

  if (marketingRoutes.has(route)) {
    await serveFile('landing/index.html', response);
    return;
  }

  if (appShellRoutes.has(route) || appShellPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    await serveFile('index.html', response);
    return;
  }

  sendJson(response, { ok: false, error: 'Not found' }, 404);
}

async function serveFile(relativePath, response) {
  const safePath = normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(response, { ok: false, error: 'Invalid path' }, 400);
    return;
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(data);
  } catch {
    sendJson(response, { ok: false, error: 'Not found' }, 404);
  }
}

function canonicalRoute(pathname) {
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '');
}

function hasLegacyRootHandoffParams(searchParams) {
  return ['u', 'url', 'pack', 'flow', 'demo'].some((param) => searchParams.has(param));
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendAuthError(response, error) {
  const authResponse = authErrorResponse(error);
  if (!authResponse) return false;
  sendJson(response, authResponse.payload, authResponse.status);
  return true;
}

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'local';
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function buildAnonymousPreviewPlanningApp({ extraction, canonicalAppId, createdAt }) {
  const { app } = buildClaimedAppDocs({
    orgId: 'anonymous-preview',
    workspaceId: 'preview',
    appId: canonicalAppId,
    createdBy: 'anonymous-preview',
    extraction,
    createdAt,
  });
  return {
    ...app,
    extractionStatus: 'approved',
    screens: app.screens.map((screen) => ({
      ...screen,
      // Before checkout these are planning references only. They may shape
      // the two ideas, but they still require review before paid generation.
      selected: screen.usability !== 'blocked',
      ignored: screen.usability === 'blocked',
    })),
  };
}

async function buildPackPlanMaterials({ reviewedApp, locale = 'en-US' }) {
  const [storeReviews, publicResearch] = await Promise.all([
    fetchStoreReviews({ app: reviewedApp, locale }),
    researchMarketSignals({
      app: reviewedApp,
      priorLearnings: reviewedApp.learningEvents || [],
      locale,
    }),
  ]);
  const directReviewSignals = storeReviewSignalsForPackPlan(storeReviews);
  const publicWebSignals = marketSignalsForPackPlan(publicResearch);
  const marketSignals = [...directReviewSignals, ...publicWebSignals].slice(0, 24);
  const researchLimitations = combinedResearchLimitations({
    storeReviews,
    publicResearch,
    hasDirectReviews: directReviewSignals.length > 0,
  });
  const researchStatus = marketSignals.length
    ? researchLimitations.length ? 'partial' : 'complete'
    : 'limited';
  const researchSnapshot = buildPackPlanResearchSnapshot({
    productTruth: buildSelectedProductTruth(reviewedApp),
    marketSignals,
    learningSignals: learningSignalsForPackPlan(reviewedApp.learningEvents || []),
    capturedAt: new Date().toISOString(),
  });
  const strategy = buildLearnedPackPlanStrategy({ reviewedApp, researchSnapshot, publicResearch });
  return { researchSnapshot, strategy, researchStatus, researchLimitations };
}

function marketSignalsForPackPlan(research) {
  const sources = new Map((research?.sources || []).map((source) => [source.id, source]));
  const rows = [];
  for (const signal of research?.marketSignals || []) {
    for (const sourceId of signal.sourceIds || []) {
      const source = sources.get(sourceId);
      if (!source?.url || rows.length >= 24) continue;
      rows.push({
        id: `${signal.id}-${sourceId}`,
        kind: packPlanSignalKind(source.family),
        theme: String(signal.text || '').slice(0, 240),
        paraphrase: String(signal.text || '').slice(0, 800),
        // One cited source is one actually observed public item. Never turn a
        // search result into an invented review/comment count.
        observedItemCount: 1,
        source: {
          platform: source.title || publicHostname(source.url) || 'Public web',
          url: source.url,
          capturedAt: research.capturedAt || new Date().toISOString(),
        },
        canSupportProductClaim: false,
      });
    }
  }
  return rows;
}

function combinedResearchLimitations({ storeReviews, publicResearch, hasDirectReviews }) {
  const direct = storeReviews?.limitations || [];
  const publicWeb = (publicResearch?.limitations || []).map((limitation) => {
    if (!hasDirectReviews) return limitation;
    if (/timed out/i.test(limitation)) {
      return 'Additional community research timed out; direct store reviews are still included.';
    }
    if (/not configured/i.test(limitation)) {
      return 'Additional community research is not configured; direct store reviews are still included.';
    }
    return `Additional community research was limited: ${String(limitation).replace(/[.!]+$/g, '')}.`;
  });
  return [...new Set([...direct, ...publicWeb].filter(Boolean))].slice(0, 4);
}

function learningSignalsForPackPlan(events) {
  return (events || [])
    .filter((event) => event?.eventId && event?.type && event?.polarity && event?.angle && event?.instruction && event?.createdAt)
    .slice(0, 24)
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      polarity: event.polarity,
      angle: event.angle,
      instruction: event.instruction,
      sourceDecisionId: event.sourceDecisionId || null,
      createdAt: event.createdAt,
    }));
}

function packPlanSignalKind(family) {
  if (family === 'app_reviews') return 'store_review';
  if (family === 'community') return 'community_discussion';
  if (family === 'official') return 'website_context';
  return 'competitor_review';
}

function publicHostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/* In-process worker for the local/dev backend. Hosted deployments set
   MAA_JOB_RUNNER=off and drain jobs from a dedicated worker instead. */
function queueLocalJobRun(ref) {
  if (process.env.MAA_JOB_RUNNER === 'off') return;
  setImmediate(async () => {
    try {
      const adapters = resolveGenerationAdapters();
      await runCreativeJob({ store: tenantStore, ...ref, adapters });
    } catch (error) {
      console.error(`Creative job ${ref.jobId} failed:`, error.message);
      try {
        const job = await tenantStore.serverReadJob(ref);
        if (job && !['completed', 'completed_with_holds', 'failed'].includes(job.status)) {
          job.status = 'failed';
          job.updatedAt = new Date().toISOString();
          await tenantStore.serverSaveJob(job);
        }
      } catch (saveError) {
        console.error(`Could not mark job ${ref.jobId} as failed:`, saveError.message);
      }
    }
  });
}

async function authorizePackRequest({ auth, body }) {
  if (!body.packId) {
    throw Object.assign(new Error('Create a paid pack before generation.'), { status: 402 });
  }
  try {
    return await tenantStore.authorizePackForGeneration({
      uid: auth.uid || body.uid,
      orgId: body.orgId,
      workspaceId: body.workspaceId || 'ws-default',
      appId: body.appId,
      packId: body.packId,
    });
  } catch (error) {
    const status = /access denied/i.test(error.message) ? 403 : 402;
    throw Object.assign(error, { status });
  }
}
