/* Mobile Ad Agent turn-4 prototype.
   Mocked state only: no provider, store, billing, or ad-network mutations. */

const CREDIT_RULES = {
  image: 4,
  video: 60,
};

const PACK_LIMITS = {
  image: 40,
  video: 6,
};

const DEFAULT_PACK_MIX = {
  image: 10,
  video: 2,
};

const LAUNCH_PACK_MIX = {
  image: 24,
  video: 4,
};

const PLAN_OPTIONS = [
  { id: 'launch', name: 'Launch', price: '$99/mo', monthly: 600, credits: 'Monthly creative allowance', desc: 'Fresh creative refreshes for one app after your first launch pack.', cta: 'Start here' },
  { id: 'scale', name: 'Scale', price: '$249/mo', monthly: 2000, credits: 'Weekly testing allowance', desc: 'More frequent refreshes, winner iteration, and testing across 1-3 apps.', cta: 'Upgrade', featured: true },
  { id: 'studio', name: 'Studio', price: '$599/mo', monthly: 6000, credits: 'Portfolio creative allowance', desc: 'Creative production, approvals, and handoff for portfolios and teams.', cta: 'Upgrade' },
];

/* Launch Annual is the only approved annual upsell path. Price math must always
   read: $1,188 monthly equivalent -> $990 annual -> $741 today with the $249
   Launch Pack credit (7-day window). No add-on menus, no Scale/Studio compare
   tables in the upsell, no credit-toward-monthly framing. */
const LAUNCH_ANNUAL = {
  planName: 'Launch',
  annualPriceUsd: 990,
  monthlyEquivalentUsd: 1188,
  launchPackCreditUsd: 249,
  netFirstYearToday: 741,
  creditWindowDays: 7,
  bonuses: [
    { id: 'winners-vault', label: 'Winners Vault', detail: 'Your approved winning ads, kept organized and reusable for every future pack.' },
    { id: 'price-lock', label: '2-year price lock', detail: 'Your annual price stays at $990/year for two years, even if list prices change.' },
    { id: 'quarterly-audit', label: 'Quarterly Ad Performance Audit', detail: 'An async creative review each quarter with a roadmap of your next 10 tests.' },
  ],
};

const DAY_MS = 24 * 60 * 60 * 1000;

const TOPUP_OPTIONS = [
  { id: 'topup-150', price: '$29', credits: 150 },
  { id: 'topup-500', price: '$99', credits: 500 },
  { id: 'topup-1100', price: '$199', credits: 1100 },
];

const BUILD_STEPS = [
  'Found listing',
  'Found screens',
  'Picked features',
  'Ready to generate',
];

const MIN_EXTRACTION_MS = 3600;
const EXTRACTION_STEP_MS = 900;

const GENERATION_STEPS = [
  'Planning ads from your app info',
  'Rendering image ads',
  'Rendering UGC ads',
  'Packaging exports',
];

const PREVIEW_SESSION_KEY = 'maaPreviewSession';
const AUTH_SESSION_KEY = 'maaAuthSession';
const queryParams = new URLSearchParams(window.location.search);
const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
const DEV_MODE = queryParams.get('dev') === '1';
const REQUESTED_PLAN = ['launch', 'scale', 'studio'].includes(queryParams.get('plan'))
  ? queryParams.get('plan')
  : null;
const START_PREVIEW_ROUTE = currentPath === '/preview' || currentPath === '/app/import';
const START_AUTH_ROUTE = currentPath === '/login' || currentPath === '/signup';
const START_LAUNCH_PACK = queryParams.get('offer') === 'launch-pack';
const PREVIEW_START_URL = (queryParams.get('u') || queryParams.get('url') || '').trim();
const STORED_AUTH_SESSION_RAW = readStoredAuthSession();
const USE_DEMO_WORKSPACE = DEV_MODE && queryParams.get('workspace') === 'demo';
// Human acquisition is URL-first: public paths land anonymous until Firebase Auth
// can restore a real session. Demo data is available only through an explicit dev URL.
const FORCE_ANONYMOUS_START = !USE_DEMO_WORKSPACE && (
  START_PREVIEW_ROUTE
  || START_AUTH_ROUTE
  || START_LAUNCH_PACK
  || Boolean(REQUESTED_PLAN)
  || Boolean(PREVIEW_START_URL)
  || !STORED_AUTH_SESSION_RAW
);
const FIREBASE_SDK_VERSION = '12.15.0';
const STORED_AUTH_SESSION = FORCE_ANONYMOUS_START ? null : STORED_AUTH_SESSION_RAW;
const RESTORE_PERSISTED_SESSION = Boolean(STORED_AUTH_SESSION?.uid);
const ANONYMOUS_START = FORCE_ANONYMOUS_START;
const authRuntime = {
  initPromise: null,
  ready: false,
  enabled: false,
  authRequired: false,
  error: null,
  app: null,
  auth: null,
  api: null,
  currentUser: null,
  bootstrapPromise: null,
};

const PREVIEW_STEPS = [
  'Found listing',
  'Found screenshots',
  'Picked key features',
  'Preview ready',
];

const PROOF_BACKED_DEMO_URL = 'https://apps.apple.com/us/app/duolingo-language-lessons/id570060128';

const CHECKOUT_PRODUCTS = [
  { id: 'launch_pack', name: 'Same-Day Launch Pack', price: '$249 one-time', credits: 336, detail: 'A launch sprint for one app: app review, 24 image ads, 4 UGC ads, one revision, and export handoff.' },
  { id: 'launch', name: 'Launch plan', price: '$99/mo', credits: 600, detail: 'Ongoing creative refreshes for one app after the first launch pack.' },
  { id: 'scale', name: 'Scale plan', price: '$249/mo', credits: 2000, detail: 'Weekly creative testing and winner iteration across 1-3 apps.' },
  { id: 'studio', name: 'Studio plan', price: '$599/mo', credits: 6000, detail: 'Portfolio-level creative production, approvals, and team handoff.' },
];

const AGENT_PROMPTS = {
  codex: {
    title: 'Codex prompt',
    text: `First, connect Mobile Ad Agent in this Codex session. If the MCP/tool connection is not available, stop and tell me what access or configuration you need.

Once connected, add this app to Mobile Ad Agent: [paste App Store, Play Store, or website URL].

Send the URL through Mobile Ad Agent, wait until the dashboard shows the automatic app-info preview, and tell me when it is ready. Do not generate ads for me.`,
  },
  claude: {
    title: 'Claude Code prompt',
    text: `First, connect Mobile Ad Agent in Claude Code. If the MCP/tool connection is not configured, stop and tell me what needs to be connected.

Once connected, add this app to Mobile Ad Agent: [paste App Store, Play Store, or website URL].

Use Mobile Ad Agent to send the app URL, then stop at the automatic app-info preview so I can either edit the chosen screens/features or generate the pack.`,
  },
  generic: {
    title: 'General agent prompt',
    text: `First, connect to Mobile Ad Agent through its agent tool integration. If you cannot access it, stop and ask me to connect it.

Once connected, send this app URL to Mobile Ad Agent: [paste App Store, Play Store, or website URL].

Create or update the app profile, wait for Mobile Ad Agent to pick the first screens, features, and angles, then return control to me before generating ads.`,
  },
};

let nextAdNumber = 14;

const state = {
  route: 'home',
  activeAppId: ANONYMOUS_START || RESTORE_PERSISTED_SESSION ? null : 'pepmod',
  activeTab: 'understanding',
  adFilter: 'all',
  infoOpen: false,
  reviewMode: 'guided',
  agentPromptPlatform: 'codex',
  // Anonymous visitors have no entitlement; the Launch Pack becomes active only
  // after the local checkout saves the preview.
  launchPackMode: false,
  launchIntent: START_LAUNCH_PACK,
  session: ANONYMOUS_START
    ? { authed: false, email: null, orgId: null, workspaceId: null }
    : RESTORE_PERSISTED_SESSION
      ? { authed: true, ...STORED_AUTH_SESSION }
      : { authed: true, uid: 'user-demo', email: 'demo@appagentic.dev', orgId: 'org-demo', workspaceId: 'ws-default' },
  preview: { status: 'idle', url: '', data: null },
  checkoutProductId: START_LAUNCH_PACK ? 'launch_pack' : REQUESTED_PLAN || 'launch_pack',
  checkoutStep: 'offer',
  checkoutEmail: '',
  credits: ANONYMOUS_START ? anonymousCredits() : initialCredits(),
  generate: {
    imageCount: initialPackMix().image,
    videoCount: initialPackMix().video,
    selectedAngles: new Set(['reminders', 'consistency']),
  },
  building: null,
  importSeq: 0,
  runSeq: 2,
  apps: ANONYMOUS_START || RESTORE_PERSISTED_SESSION ? [] : seedApps(),
  // Prototype-only clock offset (days) so dev controls can demo the day-5 banner
  // and the silent day-8 credit expiry.
  clockOffsetDays: 0,
  billing: initialBilling(),
  launchPackCredit: null,
  annualEntitlements: null,
  upsellTouchpoints: initialUpsellTouchpoints(),
};

function initialBilling() {
  return { interval: 'monthly', renewsAt: null, priceLockUntil: null };
}

function initialUpsellTouchpoints() {
  return { postCheckout: null, draftsReady: null, postExport: null, dismissed: {}, emails: [] };
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

init();

function init() {
  bindShell();
  syncUrlPlaceholder();
  syncDevControls();
  const authReady = initAuthClient();
  renderAll();
  if (PREVIEW_START_URL) {
    startPreview(PREVIEW_START_URL);
  } else if (!state.session.authed) {
    tryRestorePreview();
  } else if (RESTORE_PERSISTED_SESSION) {
    authReady.then(() => restorePersistedApps());
  }
}

function initAuthClient() {
  if (authRuntime.initPromise) return authRuntime.initPromise;
  authRuntime.initPromise = (async () => {
    try {
      const response = await fetch('/api/firebase-config');
      const payload = await response.json().catch(() => ({}));
      authRuntime.authRequired = Boolean(payload.authRequired);
      if (!payload.enabled || !payload.config?.apiKey) {
        authRuntime.ready = true;
        if (payload.authRequired) {
          authRuntime.error = 'Sign-in is not configured yet.';
        }
        renderAll();
        return authRuntime;
      }

      const [{ initializeApp }, authApi] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
      ]);
      authRuntime.app = initializeApp(payload.config);
      authRuntime.api = authApi;
      authRuntime.auth = authApi.getAuth(authRuntime.app);
      authRuntime.enabled = true;

      await new Promise((resolve) => {
        authApi.onAuthStateChanged(authRuntime.auth, async (user) => {
          authRuntime.currentUser = user || null;
          authRuntime.ready = true;
          if (user) {
            try {
              await bootstrapFirebaseUser(user);
            } catch (error) {
              authRuntime.error = error.message || 'Could not restore your session.';
            }
          } else if (authRuntime.authRequired && RESTORE_PERSISTED_SESSION) {
            clearStoredAuthSession();
            state.session = { authed: false, email: null, orgId: null, workspaceId: null };
            state.apps = [];
            state.activeAppId = null;
          }
          renderAll();
          resolve();
        });
      });
    } catch (error) {
      authRuntime.ready = true;
      authRuntime.error = error.message || 'Could not initialize sign-in.';
      renderAll();
    }
    return authRuntime;
  })();
  return authRuntime.initPromise;
}

async function bootstrapFirebaseUser(user) {
  if (!user) throw new Error('Sign in to continue.');
  if (authRuntime.bootstrapPromise) return authRuntime.bootstrapPromise;
  authRuntime.bootstrapPromise = (async () => {
    const headers = {
      'content-type': 'application/json',
      ...(await authHeaders({ skipInit: true })),
    };
    const response = await fetch('/api/bootstrap', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: user.email }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Could not create your workspace.');
    }
    applyBootstrap(payload.bootstrap);
    if (START_AUTH_ROUTE) {
      window.history.replaceState(null, '', '/app');
    }
    await restorePersistedApps();
    return payload.bootstrap;
  })();
  try {
    return await authRuntime.bootstrapPromise;
  } finally {
    authRuntime.bootstrapPromise = null;
  }
}

function applyBootstrap(bootstrap) {
  if (!bootstrap?.uid || !bootstrap?.email || !bootstrap?.orgId || !bootstrap?.workspaceId) return;
  state.session = {
    authed: true,
    uid: bootstrap.uid,
    email: bootstrap.email,
    orgId: bootstrap.orgId,
    workspaceId: bootstrap.workspaceId,
  };
  saveAuthSession(state.session);
  syncUrlPlaceholder();
}

async function authHeaders({ skipInit = false } = {}) {
  if (!skipInit && !authRuntime.ready) await initAuthClient();
  if (!authRuntime.enabled) {
    if (authRuntime.authRequired) throw new Error(authRuntime.error || 'Sign in to continue.');
    return {};
  }
  const user = authRuntime.auth?.currentUser || authRuntime.currentUser;
  if (!user) throw new Error('Sign in to continue.');
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

async function ensureSignedInForCheckout(email, password) {
  await initAuthClient();
  if (!authRuntime.enabled) {
    if (authRuntime.authRequired) throw new Error(authRuntime.error || 'Sign in is not ready yet.');
    if (state.session.authed) return;
    const response = await fetch('/api/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: String(email || '').trim().toLowerCase(),
        previewSessionId: state.preview.data?.previewSession?.id || null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not create your workspace.');
    applyBootstrap(payload.bootstrap);
    return;
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (authRuntime.auth.currentUser) return;
  if (!password || password.length < 6) {
    throw new Error('Enter a password with at least 6 characters.');
  }
  const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = authRuntime.api;
  try {
    await createUserWithEmailAndPassword(authRuntime.auth, cleanEmail, password);
  } catch (error) {
    if (error?.code !== 'auth/email-already-in-use') throw error;
    await signInWithEmailAndPassword(authRuntime.auth, cleanEmail, password);
  }
  await bootstrapFirebaseUser(authRuntime.auth.currentUser);
}

async function handleAuthForm(mode, email, password) {
  clearToast();
  await initAuthClient();
  try {
    if (authRuntime.enabled) {
      if (!password || password.length < 6) {
        throw new Error('Enter a password with at least 6 characters.');
      }
      const cleanEmail = String(email || '').trim().toLowerCase();
      const method = mode === 'signup'
        ? authRuntime.api.createUserWithEmailAndPassword
        : authRuntime.api.signInWithEmailAndPassword;
      const credential = await method(authRuntime.auth, cleanEmail, password);
      await bootstrapFirebaseUser(credential.user);
    } else {
      if (authRuntime.authRequired) throw new Error(authRuntime.error || 'Sign-in is not configured yet.');
      const response = await fetch('/api/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not create your workspace.');
      applyBootstrap(payload.bootstrap);
    }
    if (!authRuntime.enabled) await restorePersistedApps();
    if (START_AUTH_ROUTE) window.history.replaceState(null, '', '/app');
    const resumePreviewCheckout = Boolean(state.preview.data?.previewSession?.id);
    setRoute('home');
    if (resumePreviewCheckout) {
      openCheckout('launch_pack');
      toast('Signed in. Your app preview is still attached.');
    } else {
      toast(mode === 'signup' ? 'Workspace created.' : 'Signed in.');
    }
  } catch (error) {
    toast(readableAuthError(error));
    renderAll();
  }
}

function readableAuthError(error) {
  if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password') {
    return 'Email or password did not match.';
  }
  if (error?.code === 'auth/email-already-in-use') {
    return 'That email already has an account. Sign in instead.';
  }
  if (error?.code === 'auth/weak-password') {
    return 'Use a password with at least 6 characters.';
  }
  return error?.message || 'Could not sign in.';
}

function initialPackMix() {
  return DEFAULT_PACK_MIX;
}

function anonymousCredits() {
  return {
    balance: 0,
    monthly: 0,
    reset: '—',
    plan: 'No plan yet',
    topUpCount: 0,
    ledger: [],
  };
}

function creditsFromClaim(claim) {
  const isPack = claim.product.type === 'launch_pack';
  return {
    balance: claim.entitlement.credits,
    monthly: claim.entitlement.credits,
    reset: isPack ? 'one-time pack' : 'in 30 days',
    plan: isPack ? 'Launch Pack' : claim.product.label.replace(/\s*plan$/i, ''),
    topUpCount: 0,
    ledger: [
      { id: 'txn-claim', label: claim.entitlement.grantLabel, delta: claim.entitlement.credits, when: 'Today' },
    ],
  };
}

function initialCredits() {
  return {
    balance: 296,
    monthly: 600,
    reset: 'Aug 1',
    plan: 'Launch',
    topUpCount: 0,
    ledger: [
      { id: 'txn-1', label: 'Launch plan monthly credits', delta: 600, when: 'Jul 1' },
      { id: 'txn-2', label: 'Launch set · 10 image ads + 2 UGC ads', delta: -160, when: 'Jul 3' },
      { id: 'txn-3', label: 'Reminder hooks · 8 mixed ads', delta: -144, when: 'Jul 5' },
    ],
  };
}

function seedApps() {
  nextAdNumber = 14;

  const pepmod = {
    id: 'pepmod',
    name: 'PepMod',
    source: 'App Store · Health',
    status: 'Profile ready',
    tagline: 'A medication and peptide protocol tracker built around reminders, logs, and progress history.',
    iconUrl: null,
    iconTone: 'lime',
    entrySource: 'Dashboard URL',
    extractionStatus: 'approved',
    screens: [
      seedScreen({ id: 'screen-log', label: 'Protocol log', detail: 'Users can log protocol doses and schedule details.' }),
      seedScreen({ id: 'screen-reminder', label: 'Reminder card', detail: 'Users can see upcoming reminders.' }),
      seedScreen({ id: 'screen-progress', label: 'Progress chart', detail: 'Users can review tracked protocol history.' }),
    ],
    claims: [
      { id: 'claim-reminders', text: 'Users can see upcoming reminders.', source: 'Reminder card', supported: true, selected: true },
      { id: 'claim-log', text: 'Users can log protocol doses and schedule details.', source: 'Protocol log', supported: true, selected: true },
      { id: 'claim-history', text: 'Users can review tracked protocol history.', source: 'Progress chart', supported: true, selected: true },
      { id: 'claim-adherence', text: 'Helps keep protocols consistent.', source: 'Needs a clearer screen', supported: false, selected: false },
    ],
    style: ['Plain language', 'No medical outcome promises', 'Show app screens full-height', 'Keep hooks under 48 characters'],
    reviewSignals: [
      '86% of useful review snippets mention reminders or not losing track.',
      'Users respond better when the hook starts with the pain, not the app name.',
      'Protocol-log screens should be shown before progress messages.',
    ],
    angles: [
      { id: 'reminders', label: 'Stop losing track', evidence: '86% of review snippets mention reminders', selected: true },
      { id: 'consistency', label: 'Build a consistent routine', evidence: 'Supported by reminder and protocol log screens', selected: true },
      { id: 'history', label: 'See your protocol history', evidence: 'Supported by the progress chart screen', selected: false },
    ],
    runs: [
      { id: 'run-002', label: 'Launch set', cost: 40, count: 10, status: 'ready', when: 'Just now' },
      { id: 'run-001', label: 'Reminder hooks', cost: 144, count: 8, status: 'exported', when: 'Yesterday' },
    ],
    ads: [],
    reviewDecisions: [],
    learningEvents: [
      { id: 'learn-seed-1', type: 'liked_angle', text: 'Reminder-pain hooks outperformed in the last pack. More of those first.', when: 'Yesterday' },
    ],
  };

  pepmod.ads = [
    ad('pepmod', 'image', 'Stop losing track of PepMod', 'reminders', 'screen-reminder', 'approved'),
    ad('pepmod', 'image', 'Your next reminder is already waiting', 'reminders', 'screen-reminder', 'ready'),
    ad('pepmod', 'image', 'Log the dose. Keep the routine.', 'consistency', 'screen-log', 'ready'),
    ad('pepmod', 'ugc', 'I stopped guessing what was next', 'reminders', 'screen-reminder', 'ready'),
    ad('pepmod', 'image', 'Every protocol, one place', 'consistency', 'screen-log', 'ready'),
    ad('pepmod', 'ugc', 'The reminder that actually helped', 'reminders', 'screen-reminder', 'ready'),
  ];

  return [pepmod];
}

function ad(appId, format, caption, angle, screenId, status = 'ready') {
  nextAdNumber += 1;
  return {
    id: `ad-${nextAdNumber}`,
    appId,
    format,
    caption,
    angle,
    screenId,
    status,
  };
}

function seedScreen(screen) {
  return {
    ...screen,
    sourceType: 'raw_app_proof',
    usability: 'recommended',
    usabilityLabel: 'Ready for ads',
    usabilityReason: 'Clear in-app screen with a visible product moment.',
    selected: true,
    ignored: false,
  };
}

function bindShell() {
  $$('[data-route]').forEach((button) => {
    button.addEventListener('click', () => setRoute(button.dataset.route));
  });

  $('#importForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const url = $('#importUrl').value.trim();
    if (state.session.authed) startImport(url);
    else startPreview(url);
  });

  $('#modalImportForm').addEventListener('submit', (event) => {
    event.preventDefault();
    startImport($('#modalImportUrl').value.trim());
  });

  $('#demoUrl').addEventListener('click', () => {
    $('#importUrl').value = PROOF_BACKED_DEMO_URL;
    startImport($('#importUrl').value, 'Proof-backed local demo', { demo: true });
  });

  $('#mcpStartEmpty').addEventListener('click', () => {
    openAgentStart();
  });

  $('#mcpStartModal').addEventListener('click', () => {
    closeImportModal();
    openAgentStart();
  });

  $('#openImport').addEventListener('click', () => {
    openImportModal();
  });

  $('#showEmptyState').addEventListener('click', showEmptyState);

  $('#closeImport').addEventListener('click', closeImportModal);
  $('#importModal').addEventListener('click', (event) => {
    if (event.target.id === 'importModal') closeImportModal();
  });

  $('#resetDemo').addEventListener('click', () => {
    state.apps = seedApps();
    state.activeAppId = 'pepmod';
    state.activeTab = 'understanding';
    state.adFilter = 'all';
    state.infoOpen = false;
    closeImportModal();
    closeAgentStart();
    closeCheckout();
    state.session = { authed: true, email: 'demo@appagentic.dev', orgId: 'org-demo', workspaceId: 'ws-default' };
    state.launchPackMode = false;
    state.launchIntent = false;
    state.preview = { status: 'idle', url: '', data: null };
    state.credits = initialCredits();
    state.building = null;
    state.clockOffsetDays = 0;
    state.billing = initialBilling();
    state.launchPackCredit = null;
    state.annualEntitlements = null;
    state.upsellTouchpoints = initialUpsellTouchpoints();
    try { localStorage.removeItem(AUTH_SESSION_KEY); } catch { /* ignore */ }
    closeAnnualSheet();
    resetGenerate();
    renderAll();
    toast('Demo reset.');
  });

  window.addEventListener('resize', syncUrlPlaceholder);

  $('#closeGenerate').addEventListener('click', closeGenerate);
  $('#generateModal').addEventListener('click', (event) => {
    if (event.target.id === 'generateModal') closeGenerate();
  });
  $('#closeUpsell').addEventListener('click', closeUpsell);
  $('#upsellModal').addEventListener('click', (event) => {
    if (event.target.id === 'upsellModal') closeUpsell();
  });
  $('#closeAgentStart').addEventListener('click', closeAgentStart);
  $('#cancelAgentStart').addEventListener('click', closeAgentStart);
  $('#simulateAgentStart').addEventListener('click', simulateAgentStart);
  $('#copyAgentPrompt').addEventListener('click', copyAgentPrompt);
  $('#agentPromptTabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-agent-platform]');
    if (!button) return;
    state.agentPromptPlatform = button.dataset.agentPlatform;
    renderAgentStart();
  });
  $('#agentStartModal').addEventListener('click', (event) => {
    if (event.target.id === 'agentStartModal') closeAgentStart();
  });
  $('#closeHandoff').addEventListener('click', closeHandoff);
  $('#handoffModal').addEventListener('click', (event) => {
    if (event.target.id === 'handoffModal') closeHandoff();
  });
  $('#closeCheckout').addEventListener('click', closeCheckout);
  $('#checkoutModal').addEventListener('click', (event) => {
    if (event.target.id === 'checkoutModal') closeCheckout();
  });
  $('#closeAnnual').addEventListener('click', closeAnnualSheet);
  $('#annualModal').addEventListener('click', (event) => {
    if (event.target.id === 'annualModal') closeAnnualSheet();
  });
  $('#devClockPlus1').addEventListener('click', () => advanceClock(1));
  $('#devClockPlus3').addEventListener('click', () => advanceClock(3));
  $('#devClockReset').addEventListener('click', () => {
    state.clockOffsetDays = 0;
    renderAll();
    toast('Prototype clock reset to day 0.');
  });
}

function syncDevControls() {
  $('#devActions').hidden = !DEV_MODE;
  $('#simulateAgentStart').hidden = !DEV_MODE;
  const clockLabel = $('#devClockLabel');
  if (clockLabel) clockLabel.textContent = `Day ${state.clockOffsetDays}`;
}

function syncUrlPlaceholder() {
  const compact = window.matchMedia('(max-width: 640px)').matches;
  const placeholder = compact
    ? 'Paste app URL...'
    : state.session.authed
      ? 'Paste an App Store, Play Store, or website URL...'
      : 'Paste an App Store or Google Play URL...';
  ['#importUrl', '#modalImportUrl'].forEach((selector) => {
    const input = $(selector);
    if (input) input.placeholder = placeholder;
  });
}

function setRoute(route) {
  if (route === 'credits' && !state.session.authed) route = 'home';
  state.route = route;
  $('#homeView').hidden = route !== 'home';
  $('#creditsView').hidden = route !== 'credits';
  $$('[data-route]').forEach((button) => {
    button.classList.toggle('active', button.dataset.route === route);
  });
  $('#main').scrollTop = 0;
  renderAll();
}

function activeApp() {
  return state.apps.find((app) => app.id === state.activeAppId) || state.apps[0] || null;
}

function stageFor(app) {
  if (state.building) return 'extracting';
  if (!app) return 'initial';
  if (app.extractionStatus !== 'approved') return 'review';
  if (app.packPlanStatus === 'researching') return 'planning';
  if (app.packPlanStatus === 'proposed' && app.activePackPlan) return 'plan';
  if (app.runs[0]?.status === 'cooking') return 'generating';
  if (app.packPlanStatus === 'accepted' && !app.ads.length) return 'generating';
  return app.ads.length ? 'ads' : 'approved';
}

function renderAll() {
  syncCreditLifecycle();
  syncDevControls();
  renderSidebar();
  renderCreditMeter();
  renderHome();
  renderCredits();
}

function renderSidebar() {
  $('.credits-link').hidden = !state.session.authed;
  const sideApps = $('#sideApps');
  if (!state.session.authed) {
    sideApps.innerHTML = '<div class="side-empty">Your preview becomes an app after checkout</div>';
    return;
  }
  sideApps.innerHTML = state.apps.length ? state.apps.map((app) => `
    <button class="side-app ${app.id === state.activeAppId && state.route === 'home' ? 'active' : ''}" type="button" data-app="${app.id}">
      ${appIconHtml(app, 'swatch')}
      <span>${escapeHtml(app.name)}</span>
    </button>
  `).join('') : '<div class="side-empty">No apps yet</div>';
  sideApps.querySelectorAll('[data-app]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeAppId = button.dataset.app;
      state.activeTab = 'understanding';
      state.infoOpen = false;
      setRoute('home');
    });
  });

  $$('[data-route]').forEach((button) => {
    button.classList.toggle('active', button.dataset.route === state.route);
  });
}

function renderCreditMeter() {
  if (!state.session.authed) {
    $('#creditMeter').innerHTML = `
      <div class="meter-head">
        <span>Free preview</span>
        <strong>0</strong>
      </div>
      <div class="meter-foot">
        <span>Credits arrive with the Launch Pack or a plan</span>
      </div>
    `;
    return;
  }
  const pct = Math.min(100, Math.round((state.credits.balance / Math.max(1, state.credits.monthly)) * 100));
  $('#creditMeter').innerHTML = `
    <div class="meter-head">
      <span>Credits</span>
      <strong>${state.credits.balance}</strong>
    </div>
    <div class="meter-track"><span style="width:${pct}%"></span></div>
    <div class="meter-foot">
      <span>${state.credits.plan}</span>
      <button type="button" data-route="credits">Manage</button>
    </div>
  `;
  $('#creditMeter [data-route="credits"]').addEventListener('click', () => setRoute('credits'));
}

function renderHome() {
  renderBuildStrip();
  if (START_AUTH_ROUTE && !state.session.authed) {
    renderAuthHome();
    return;
  }
  if (!state.session.authed) {
    renderAnonymousHome();
    return;
  }
  $('#previewPane').hidden = true;
  const app = activeApp();
  const stage = stageFor(app);
  const initial = stage === 'initial';
  const showImport = initial;
  const workspaceVisible = Boolean(app) && !['initial', 'extracting'].includes(stage);

  const stageCopy = {
    review: ['Review the app info.', 'Check the features and screenshots we found. Next, we turn them into a focused creative plan.'],
    planning: ['Building your creative plan.', 'We are checking your app, public feedback, and what you liked before.'],
    plan: ['Review the plan before we generate.', 'See the two openings and output mix. No credits are used until you approve.'],
    generating: ['Generating your pack.', 'Every ad follows the plan you approved and uses verified app information.'],
    ads: ['Review your new ads.', 'Approve, reject, or suggest a change. Your feedback shapes the next pack.'],
    approved: ['Build your next creative plan.', 'We will use the latest app info, public feedback, and your previous reviews.'],
  };
  $('#homeTitle').textContent = showImport
    ? 'Paste your app link. Get a launch pack today.'
    : (stageCopy[stage]?.[0] || 'Review the app info, then generate.');
  $('#homeSub').textContent = showImport
    ? 'We pull your public listing, show the app info we found, then generate paid creative after checkout.'
    : (stageCopy[stage]?.[1] || 'Check the summary, key features, and screenshots before continuing.');
  $('#importForm').hidden = !showImport;
  $('#openImport').hidden = initial || stage === 'extracting';
  $('#showEmptyState').hidden = !DEV_MODE || initial;
  $('#urlNote').textContent = 'You see the app preview first. Generation starts only after checkout.';
  $('#urlNote').hidden = !initial;
  $('#emptyState').hidden = !initial;
  if (initial) {
    $('#emptyState h2').textContent = 'Add your first app.';
    $('#emptyState p').textContent = 'Paste your app link, check the screenshots and features we find, then generate your first paid creative pack.';
    $('#demoUrl').hidden = !DEV_MODE;
    $('#mcpStartEmpty').hidden = false;
    $('#emptyState .agent-note').textContent = 'Using a coding agent? It can add your app and stop at the plan preview for you.';
  }
  $('#appWorkspace').hidden = !workspaceVisible;
  if (!workspaceVisible || !app) {
    const touchHost = $('#upsellTouch');
    if (touchHost) touchHost.innerHTML = '';
    return;
  }
  renderUpsellTouch(app, stage);

  const showGrid = stage === 'ads';
  const showAds = stage === 'ads';
  const showTabs = showAds || state.infoOpen;
  $('#workspaceGrid').hidden = !showGrid;
  $('#workspaceGrid').classList.toggle('single-column', stage === 'approved');
  $('#adsPanel').hidden = !showAds;
  $('#nextPanel').hidden = !showGrid;
  $('.tabs').hidden = !showTabs;
  $('#tabPanel').hidden = !showTabs;
  if (!showTabs) $('#tabPanel').innerHTML = '';

  renderAppHero(app, stage);
  renderLiveRun(app);
  renderExtractionReview(app, stage);
  renderPackPlan(app, stage);
  if (showAds) renderAds(app);
  if (showGrid) renderNextPanel(app, stage);
  if (showTabs) renderTabs(app);
}

function renderAuthHome() {
  const mode = currentPath === '/signup' ? 'signup' : 'login';
  const isSignup = mode === 'signup';
  $('#previewPane').hidden = false;
  $('#appWorkspace').hidden = true;
  $('#importForm').hidden = true;
  $('#openImport').hidden = true;
  $('#showEmptyState').hidden = true;
  $('#urlNote').hidden = true;
  $('#emptyState').hidden = true;
  $('#homeTitle').textContent = isSignup ? 'Create your workspace.' : 'Sign in to Mobile Ad Agent.';
  $('#homeSub').textContent = 'Use your account to save app profiles, credits, packs, and exports in the right workspace.';
  $('#previewPane').innerHTML = `
    <section class="panel auth-panel">
      <div class="modal-head">
        <p class="eyebrow">${isSignup ? 'Create account' : 'Welcome back'}</p>
        <h2>${isSignup ? 'Start with email and password' : 'Sign in with email and password'}</h2>
        <p>${authRuntime.error ? escapeHtml(authRuntime.error) : 'Your app data and credits are stored under your workspace.'}</p>
      </div>
      <form class="checkout-form auth-form" id="authForm">
        <label for="authEmail">Email</label>
        <input id="authEmail" type="email" required placeholder="you@company.com" autocomplete="email">
        <label for="authPassword">Password</label>
        <input id="authPassword" type="password" required minlength="6" autocomplete="${isSignup ? 'new-password' : 'current-password'}">
        <button class="primary-button" type="submit" id="authSubmit">${isSignup ? 'Create workspace' : 'Sign in'}</button>
        <small class="checkout-note">${isSignup ? 'Already have an account?' : 'New here?'} <a href="${isSignup ? '/login' : '/signup'}">${isSignup ? 'Sign in' : 'Create a workspace'}</a></small>
      </form>
    </section>
  `;
  $('#authForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = $('#authSubmit');
    submit.disabled = true;
    submit.textContent = isSignup ? 'Creating...' : 'Signing in...';
    handleAuthForm(mode, $('#authEmail').value.trim(), $('#authPassword').value);
  });
}

function renderBuildStrip() {
  const strip = $('#buildStrip');
  if (!state.building) {
    strip.hidden = true;
    strip.innerHTML = '';
    return;
  }
  const steps = state.building.steps || BUILD_STEPS;
  strip.hidden = false;
  strip.innerHTML = `
    <div class="build-head">
      <strong>${escapeHtml(state.building.headline || `Preparing app info for ${state.building.name}`)}</strong>
      <span>${state.building.step + 1}/${steps.length}</span>
    </div>
    ${state.building.detail ? `<p class="build-detail">${escapeHtml(state.building.detail)}</p>` : ''}
    <div class="build-steps">
      ${steps.map((step, index) => `
        <span class="${index < state.building.step ? 'done' : index === state.building.step ? 'now' : ''}">${escapeHtml(step)}</span>
      `).join('')}
    </div>
  `;
}

function renderAnonymousHome() {
  const previewStatus = state.preview.status;
  const showPreview = previewStatus === 'ready';
  const loading = previewStatus === 'loading';

  $('#homeTitle').textContent = state.launchIntent
    ? 'Paste your app URL. Get 28 launch-ready ad creatives today.'
    : 'Paste your app URL. See the launch pack we can build.';
  $('#homeSub').textContent = 'We show the public app info we found before checkout, then generate the pack only after payment.';
  $('#importForm').hidden = loading;
  $('#openImport').hidden = true;
  $('#showEmptyState').hidden = true;
  $('#urlNote').textContent = 'No account needed for the app preview. Generated ads start with the Same-Day Launch Pack.';
  $('#urlNote').hidden = loading || showPreview;
  $('#appWorkspace').hidden = true;
  $('#previewPane').hidden = !showPreview;
  if (showPreview) renderPreviewPane();
  else $('#previewPane').innerHTML = '';

  const emptyState = $('#emptyState');
  emptyState.hidden = loading || showPreview;
  if (!emptyState.hidden) {
    emptyState.querySelector('h2').textContent = state.launchIntent
      ? 'Start your Same-Day Launch Pack with a URL.'
      : 'Start with your app URL.';
    emptyState.querySelector('p').textContent = 'We pull your public listing — icon, summary, key features, and screenshots — then show exactly what the paid pack will use.';
    $('#mcpStartEmpty').hidden = true;
    emptyState.querySelector('.agent-note').textContent = 'Building with the API or an agent? Those connections sign in first — this free preview is for checking your app.';
  }
}

function previewIconStub(previewApp) {
  return {
    iconUrl: previewApp.iconUrl,
    iconTone: previewApp.store === 'Google Play' ? 'blue' : 'lime',
  };
}

function renderPreviewPane() {
  const data = state.preview.data;
  if (!data) return;
  const features = data.features || [];
  const screenshots = data.screenshots || [];
  const gaps = data.readiness?.gaps || [];
  const expires = formatPreviewExpiry(data.previewSession?.expiresAt);
  $('#previewPane').innerHTML = `
    <section class="panel preview-head-card">
      <div class="preview-head-main">
        ${appIconHtml(previewIconStub(data.app), 'app-icon lg', `${data.app.name} icon`)}
        <div>
          <div class="crumb"><span class="lime">App preview</span> / ${escapeHtml(data.app.store)}${data.app.category ? ` · ${escapeHtml(data.app.category)}` : ''}</div>
          <h2>${escapeHtml(data.app.name)}</h2>
          <p>${escapeHtml(data.app.summary || 'No summary found on the listing yet. You can write one after you save the preview.')}</p>
          <div class="hero-pills">
            <span class="pill live"><span class="dot"></span>App found</span>
            <span class="pill">${screenshots.length} screenshot${screenshots.length === 1 ? '' : 's'}</span>
            <span class="pill">${features.length} key feature${features.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
      <div class="hero-actions">
        <button class="ghost-button" type="button" id="previewAnotherApp">Preview a different app</button>
      </div>
    </section>

    <div class="preview-grid">
      <section class="panel preview-features">
        <p class="mono-label">Key features</p>
        <h3>What ads could talk about</h3>
        <p class="panel-note">Pulled from the public listing. You can edit, remove, or add features after you save the preview.</p>
        ${features.length ? features.map((feature) => `
          <div class="claim-row">
            <span class="claim-check">✓</span>
            <div>
              <p>${escapeHtml(feature.text)}</p>
              <small>${escapeHtml(feature.source)}</small>
            </div>
          </div>
        `).join('') : '<div class="extract-empty"><strong>No clear features found yet</strong><small>You can add true product features after you save the preview.</small></div>'}
      </section>

      <section class="panel preview-shots">
        <p class="mono-label">Screenshots</p>
        <h3>${data.readiness.readyCount} of ${data.readiness.total} look ad-ready</h3>
        <p class="panel-note">Shown from the public listing. Uploading your own screenshots unlocks after checkout.</p>
        <div class="preview-shot-grid">
          ${screenshots.slice(0, 8).map((shot, index) => `
            <figure class="preview-shot ${escapeHtml(shot.readiness.status)}">
              <div class="preview-shot-frame">
                ${shot.url ? `<img src="${escapeHtml(shot.url)}" alt="${escapeHtml(shot.label)}" loading="lazy" decoding="async" onerror="this.remove()">` : '<span></span>'}
                <b>${escapeHtml(shot.readiness.label)}</b>
              </div>
              <figcaption>${escapeHtml(shot.label || `Screenshot ${index + 1}`)}</figcaption>
            </figure>
          `).join('')}
        </div>
        ${gaps.length ? `
          <div class="preview-gaps">
            ${gaps.map((gap) => `<p><span aria-hidden="true">△</span>${escapeHtml(gap)}</p>`).join('')}
          </div>
        ` : ''}
      </section>
    </div>

    <section class="panel preview-gate">
      <div>
        <p class="mono-label">Recommended next step</p>
        <h3>Ready to generate ads from this app?</h3>
        <p>Create an account in the next step so we can keep this app summary, features, and screenshots. Checkout appears after that, before any paid generation starts.</p>
        <small>Preview saved on this device until ${escapeHtml(expires)}. Paid generation starts only after checkout.</small>
      </div>
      <div class="preview-gate-actions">
        <button class="primary-button" type="button" id="previewCheckoutLaunch">Generate My Ads</button>
      </div>
    </section>
  `;
  $('#previewAnotherApp').addEventListener('click', () => {
    state.preview = { status: 'idle', url: '', data: null };
    renderAll();
    $('#importUrl')?.focus();
  });
  $('#previewCheckoutLaunch').addEventListener('click', () => openCheckout('launch_pack'));
}

function formatPreviewExpiry(iso) {
  const date = new Date(iso || Date.now());
  if (Number.isNaN(date.getTime())) return 'tomorrow';
  return date.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function renderAppHero(app, stage) {
  const extractionApproved = app.extractionStatus === 'approved';
  const planReady = canGenerateFromPlan(app);
  const firstRunCost = defaultPackCost();
  const statusText = stage === 'review'
    ? planReady ? 'App info ready' : 'Needs your input'
    : stage === 'planning'
      ? 'Researching'
      : stage === 'plan'
        ? 'Plan ready'
        : stage === 'approved'
          ? 'Ready to plan'
          : stage === 'generating'
            ? 'Generating'
            : 'Ads ready';
  $('#appHero').innerHTML = `
    <section class="app-hero-card">
      <div class="app-hero-main">
        ${appIconHtml(app, 'app-icon lg', `${app.name} icon`)}
        <div>
          <div class="crumb"><span class="lime">Home</span> / ${escapeHtml(app.name)}</div>
          <h2>${escapeHtml(app.name)}</h2>
          <p>${escapeHtml(app.tagline)}</p>
          <div class="hero-pills">
            <span class="pill live"><span class="dot"></span>${escapeHtml(statusText)}</span>
            ${stage === 'plan' ? `<span class="pill">${app.activePackPlan?.costCredits || firstRunCost} credits after approval</span>` : ''}
          </div>
        </div>
      </div>
      <div class="hero-actions">
        ${stage === 'review' && planReady
          ? '<button class="primary-button" type="button" id="nextFromPlan">Continue to pack plan</button><button class="ghost-button" type="button" id="reviewInfo">Edit app info</button>'
          : extractionApproved && stage === 'approved'
            ? '<button class="primary-button" type="button" id="openGenerate">Build pack plan</button><button class="ghost-button" type="button" id="reviewInfo">App info</button>'
            : stage === 'plan'
              ? '<button class="primary-button" type="button" id="reviewPackPlan">Review Pack Plan</button><button class="ghost-button" type="button" id="reviewInfo">App info</button>'
            : extractionApproved
              ? '<button class="ghost-button" type="button" id="reviewInfo">App info</button>'
              : '<button class="ghost-button" type="button" id="reviewInfo">Preview plan</button>'}
      </div>
    </section>
  `;
  $('#openGenerate')?.addEventListener('click', openGenerate);
  $('#nextFromPlan')?.addEventListener('click', () => generateReviewedPack(app));
  $('#reviewPackPlan')?.addEventListener('click', () => $('#packPlan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#reviewInfo').addEventListener('click', () => {
    if (extractionApproved) {
      state.infoOpen = true;
      state.activeTab = 'understanding';
      renderAll();
      $('#tabPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    $('#extractionReview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderLiveRun(app) {
  const latest = app.runs[0];
  const host = $('#liveRun');
  if (!latest || latest.status !== 'cooking') {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `
    <div class="live-run">
      <span class="spinner" aria-hidden="true"></span>
      <div>
        <strong>${escapeHtml(latest.label)} is cooking</strong>
        <p>${escapeHtml(GENERATION_STEPS[latest.step || 0] || 'Packaging exports')}.</p>
        <div class="run-steps">
          ${GENERATION_STEPS.map((step, index) => `
            <span class="${index < (latest.step || 0) ? 'done' : index === (latest.step || 0) ? 'now' : ''}">${escapeHtml(step)}</span>
          `).join('')}
        </div>
      </div>
      <span class="pill live">ready soon</span>
    </div>
  `;
}

function renderExtractionReview(app, stage) {
  const host = $('#extractionReview');
  if (!app) {
    host.innerHTML = '';
    return;
  }

  const pickedClaims = selectedClaims(app);
  const selectedScreens = selectedUsableScreens(app);
  const canProceed = selectedScreens.length > 0 && pickedClaims.length > 0;
  const approveCta = canProceed
    ? 'Continue to pack plan'
    : selectedScreens.length
      ? 'Add a feature'
      : pickedClaims.length
        ? 'Add a screenshot'
        : 'Add a screenshot and feature';

  if (stage !== 'review') {
    host.innerHTML = `
      <section class="extraction-bar" aria-label="Verified app information">
        <span class="extraction-check" aria-hidden="true">✓</span>
        <strong>App info verified</strong>
        <span>${selectedScreens.length} screenshots · ${pickedClaims.length} product facts selected</span>
        <div>
          <button class="text-button" type="button" data-extraction-action="viewApproved">View</button>
          <button class="text-button" type="button" data-extraction-action="editApproved">Edit</button>
        </div>
      </section>
    `;
    host.querySelector('[data-extraction-action="viewApproved"]').addEventListener('click', () => {
      state.infoOpen = true;
      state.activeTab = 'understanding';
      renderAll();
      $('#tabPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    host.querySelector('[data-extraction-action="editApproved"]').addEventListener('click', () => {
      invalidateClientPackPlan(app);
      app.extractionStatus = 'review';
      state.infoOpen = false;
      renderAll();
      $('#extractionReview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }

  host.innerHTML = `
    <section class="panel extraction-panel review app-info-review">
      ${renderAppInfoReview(app, selectedScreens, pickedClaims)}

      <div class="extraction-footer">
        <span class="checkpoint-note">${selectedScreens.length} screenshot${selectedScreens.length === 1 ? '' : 's'} · ${pickedClaims.length} feature${pickedClaims.length === 1 ? '' : 's'}</span>
        ${renderInlineGenerateDecision(canProceed)}
      </div>
    </section>
  `;

  host.querySelectorAll('[data-extraction-action]').forEach((button) => {
    button.addEventListener('click', () => handleExtractionAction(app, button.dataset.extractionAction));
  });
  host.querySelectorAll('[data-claim-action]').forEach((button) => {
    button.addEventListener('click', () => handleClaimAction(app, button.dataset.claimId, button.dataset.claimAction));
  });
  host.querySelectorAll('[data-screen-action]').forEach((button) => {
    button.addEventListener('click', () => handleScreenAction(app, button.dataset.screenId, button.dataset.screenAction));
  });
  host.querySelectorAll('[data-feature-input]').forEach((input) => {
    input.addEventListener('input', () => handleFeatureInput(app, input.dataset.featureId, input.value));
  });
  host.querySelectorAll('[data-summary-input]').forEach((input) => {
    input.addEventListener('input', () => {
      app.tagline = input.value;
      renderAppHero(app, 'review');
    });
  });
}

function renderAppInfoReview(app, screens, features) {
  return `
    <div class="app-info-layout">
      <section class="app-summary-card">
        <div class="source-card-head">
          <span class="extract-kicker">App summary</span>
          <strong>${escapeHtml(app.name)}</strong>
          <small>Pulled from your app listing. Edit it if anything looks off.</small>
        </div>
        <textarea class="summary-input" rows="4" data-summary-input aria-label="App summary">${escapeHtml(app.tagline)}</textarea>
      </section>

      <section class="feature-editor-card">
        <div class="source-card-head inline-head">
          <div>
            <span class="extract-kicker">Key features</span>
            <small>Pulled from your listing. Remove anything that looks wrong.</small>
          </div>
          <button class="small-action" type="button" data-extraction-action="addFeature">Add feature</button>
        </div>
        <div class="feature-list">
          ${features.length ? features.map((claim, index) => featureRowHtml(claim, index)).join('') : renderNoClaimsEmpty()}
        </div>
      </section>

      <section class="screenshot-editor-card">
        <div class="source-card-head inline-head">
          <div>
            <span class="extract-kicker">Screenshots</span>
            <strong>${screens.length} selected</strong>
            <small>${escapeHtml(sourceQualityLabel(screens))}</small>
          </div>
          <button class="small-action" type="button" data-extraction-action="add">Add screenshots</button>
        </div>
        <div class="large-screenshot-grid">
          ${screens.length ? screens.map((screen, index) => largeScreenshotCardHtml(screen, index)).join('') : renderNoScreensEmpty()}
        </div>
      </section>
    </div>
  `;
}

function renderInlineGenerateDecision(canProceed) {
  const mix = defaultPackMix();
  const cost = defaultPackCost();
  const after = Math.max(0, state.credits.balance - cost);
  const offerLabel = state.launchPackMode ? 'Same-Day Launch Pack' : 'First creative pack';
  return `
    <div class="inline-generate-decision">
      <div>
        <span class="extract-kicker">${escapeHtml(offerLabel)}</span>
        <strong>${packMixLabel(mix)}</strong>
        <small>Next: we build your creative plan · no credits yet</small>
      </div>
      <button class="primary-button" type="button" data-extraction-action="generateNow" ${canProceed ? '' : 'disabled'}>${canProceed ? 'Continue to pack plan' : 'Add app info first'}</button>
    </div>
  `;
}

function renderPackPlan(app, stage) {
  const host = $('#packPlan');
  if (!host || !app || stage === 'review') {
    if (host) host.innerHTML = '';
    return;
  }

  if (stage === 'planning' || app.packPlanStatus === 'researching') {
    host.innerHTML = `
      <section class="panel pack-plan-panel pack-plan-researching" aria-live="polite">
        <div class="pack-plan-status-mark"><span class="spinner" aria-hidden="true"></span></div>
        <div>
          <p class="mono-label">Building your plan</p>
          <h2>Finding the strongest idea for this pack.</h2>
          <p>We are checking your app, public feedback, and what you liked before.</p>
          <div class="pack-plan-research-note">
            <span class="dot"></span>
            <strong>Research in progress</strong>
            <small>No credits used yet.</small>
          </div>
        </div>
      </section>
    `;
    return;
  }

  const plan = app.activePackPlan;
  if (!plan) {
    host.innerHTML = stage === 'ads' ? '' : `
      <section class="panel pack-plan-empty">
        <div>
          <p class="mono-label">Creative plan</p>
          <h2>Turn the app info into one clear idea.</h2>
          <p>We will choose two focused openings and show you the plan before generation.</p>
        </div>
        <button class="primary-button" type="button" id="buildPackPlan">Build Pack Plan</button>
      </section>
    `;
    $('#buildPackPlan')?.addEventListener('click', () => buildPackPlanForApp(app));
    return;
  }

  if (app.packPlanStatus === 'accepted' && stage !== 'plan' && !app.packPlanExpanded) {
    host.innerHTML = `
      <section class="extraction-bar pack-plan-approved" aria-label="Approved Creative Pack Plan">
        <span class="extraction-check" aria-hidden="true">✓</span>
        <strong>Pack Plan approved</strong>
        <span>${escapeHtml(shorten(plan.hypothesis?.statement || 'Approved plan', 110))}</span>
        <div><button class="text-button" type="button" id="viewApprovedPlan">View plan</button></div>
      </section>
    `;
    $('#viewApprovedPlan')?.addEventListener('click', () => {
      app.packPlanExpanded = true;
      renderAll();
      $('#packPlan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }

  const research = plan.research || {};
  const acceptedReadOnly = app.packPlanStatus === 'accepted';
  const coverage = research.coverage || {};
  const marketSignals = research.marketSignals || [];
  const productTruth = research.productTruth || [];
  const learnings = [...(research.learningSignals || [])].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const plannedMix = plan.request?.outputMix || { image: 0, ugc: 0 };
  const pendingMix = { image: state.generate.imageCount, ugc: state.generate.videoCount };
  const mixChanged = Boolean(app.packPlanNeedsRefresh)
    || plannedMix.image !== pendingMix.image
    || plannedMix.ugc !== pendingMix.ugc;
  const displayedMix = mixChanged ? pendingMix : plannedMix;
  const displayedCost = mixChanged ? currentCost() : plan.costCredits;
  const generationSplit = packPlanGenerationSplit(plan.assignments);
  const generatedPackCount = (app.runs || []).length;
  const packNumber = app.packPlanStatus === 'accepted'
    ? Math.max(1, generatedPackCount)
    : generatedPackCount + 1;
  const returning = packNumber > 1 || learnings.length > 0;
  const balanceAfter = Math.max(0, state.credits.balance - displayedCost);

  host.innerHTML = `
    <section class="panel pack-plan-panel" aria-labelledby="packPlanTitle">
      <div class="pack-plan-head section-row">
        <div>
          <div class="pack-plan-kicker-row">
            <p class="mono-label">Creative plan · ${returning ? `Pack ${packNumber}` : 'First pack'}</p>
          </div>
          <h2 id="packPlanTitle">Your creative plan</h2>
          <small class="pack-plan-basis">${escapeHtml(packPlanBasisCopy({ productTruth, coverage, learnings }))}</small>
        </div>
      </div>

      ${learnings.length ? `
        <div class="pack-plan-delta">
          <span>What changed</span>
          <strong>Your feedback changed this plan.</strong>
          <p>${escapeHtml(packPlanDeltaCopy(learnings))}</p>
        </div>
      ` : ''}

      <section class="hypothesis-block">
        <div>
          <p class="mono-label">Our idea</p>
          <h3>${escapeHtml(plan.hypothesis?.statement || '')}</h3>
          ${coverage.sourceCount ? `<p>${escapeHtml(plan.hypothesis?.tension || '')}</p>` : ''}
          <div class="hypothesis-learning"><span>What this pack should teach us</span><strong>${escapeHtml(plan.hypothesis?.intendedLearning || '')}</strong></div>
        </div>
      </section>

      ${packPlanGenerationSplitHtml(generationSplit)}

      <div class="experiment-grid">
        ${packPlanLaneHtml('Idea A', plan.experiment?.primary, plan.assignments)}
        ${packPlanLaneHtml('Idea B', plan.experiment?.challenger, plan.assignments)}
      </div>

      <details class="pack-plan-evidence">
        <summary>
          <span>Why this plan?</span>
        </summary>
        <div class="evidence-grid">
          ${packPlanEvidenceGroup('From your app', 'claim', 'Facts and screens we can use', productTruth)}
          ${packPlanEvidenceGroup('From public feedback', 'signal', 'Audience signals, not product claims', marketSignals)}
          ${packPlanEvidenceGroup('From your reviews', 'learning', 'What you taught us before', learnings)}
        </div>
      </details>

      <div class="pack-plan-footer ${mixChanged ? 'needs-refresh' : ''}">
        <div class="pack-output-mix">
          <div>
            <p class="mono-label">Output mix</p>
            <strong>${packMixLabel(displayedMix)}</strong>
            <small>${displayedCost} credits · ${state.credits.balance} → ${balanceAfter} left</small>
          </div>
          ${acceptedReadOnly ? '<span class="pill live">Approved and generated</span>' : `
            <div class="pack-output-controls" aria-label="Adjust planned output mix">
              ${packPlanQuantityControl('image', 'Images', displayedMix.image)}
              ${packPlanQuantityControl('video', 'UGC', displayedMix.ugc)}
            </div>
          `}
        </div>
        <div class="pack-plan-actions">
          ${acceptedReadOnly
            ? '<button class="ghost-button" type="button" id="closeAcceptedPlan">Back to creative review</button>'
            : `
              <button class="ghost-button" type="button" id="editPlanSource">Edit app info</button>
              ${mixChanged
                ? '<button class="primary-button" type="button" id="refreshPackPlan">Refresh plan with this mix</button>'
                : `<button class="primary-button" type="button" id="approvePackPlan">Approve plan & generate · ${plan.costCredits} credits</button>`}
            `}
        </div>
      </div>
    </section>
  `;

  host.querySelectorAll('[data-plan-qty]').forEach((button) => {
    button.addEventListener('click', () => {
      adjustQuantity(button.dataset.planQty, Number(button.dataset.delta));
      app.packPlanNeedsRefresh = true;
      renderPackPlan(app, 'plan');
    });
  });
  $('#editPlanSource')?.addEventListener('click', () => {
    app.extractionStatus = 'review';
    invalidateClientPackPlan(app);
    state.infoOpen = false;
    renderAll();
    $('#extractionReview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#refreshPackPlan')?.addEventListener('click', () => buildPackPlanForApp(app, { force: true }));
  $('#closeAcceptedPlan')?.addEventListener('click', () => {
    app.packPlanExpanded = false;
    renderAll();
    $('#adsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#approvePackPlan')?.addEventListener('click', async () => {
    syncGenerateMixFromPlan(plan);
    if (plan.costCredits > state.credits.balance) {
      openUpsell({ reason: 'run' });
      return;
    }
    await commitGenerate(plan.costCredits);
  });
}

function packPlanBasisCopy({ productTruth = [], coverage = {}, learnings = [] } = {}) {
  const facts = productTruth.filter((item) => item.canSupportProductClaim).length;
  const parts = [`${facts} verified app fact${facts === 1 ? '' : 's'}`];
  if (coverage.sourceCount) parts.push(`${coverage.sourceCount} public source${coverage.sourceCount === 1 ? '' : 's'}`);
  else parts.push('No public feedback yet');
  if (learnings.length) parts.push(`${learnings.length} past decision${learnings.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function packPlanDeltaCopy(learnings = []) {
  const tweak = learnings.find((item) => item.type === 'tweak_instruction');
  const liked = learnings.find((item) => item.type === 'liked_angle');
  const rejected = learnings.find((item) => item.type === 'rejected_angle' || item.type === 'avoid_angle');
  const parts = [];
  if (tweak?.instruction) parts.push(tweak.instruction);
  if (liked?.angle) parts.push(`Keep exploring “${liked.angle}”.`);
  else if (rejected?.angle) parts.push(`Move away from “${rejected.angle}”.`);
  return parts.slice(0, 2).join(' ') || 'The next pack uses your latest review.';
}

function packPlanLaneHtml(label, lane, assignments = []) {
  const laneAssignments = assignments.filter((item) => item.lane === lane?.id);
  const count = laneAssignments.length;
  const images = laneAssignments.filter((item) => item.format === 'image_ad').length;
  const ugc = laneAssignments.filter((item) => item.format === 'ugc_ad').length;
  return `
    <article class="experiment-lane ${lane?.id || ''}">
      <div class="experiment-lane-head"><span>${escapeHtml(label)}</span><small>We'll generate ${count} creative${count === 1 ? '' : 's'}</small></div>
      <h3>${escapeHtml(lane?.angle || '')}</h3>
      <p>${escapeHtml(lane?.rationale || '')}</p>
      <div class="experiment-lane-mix">${packPlanLaneMixLabel({ images, ugc })}</div>
    </article>
  `;
}

function packPlanGenerationSplit(assignments = []) {
  const summarize = (lane) => {
    const items = assignments.filter((item) => item.lane === lane);
    return {
      count: items.length,
      images: items.filter((item) => item.format === 'image_ad').length,
      ugc: items.filter((item) => item.format === 'ugc_ad').length,
    };
  };
  return {
    total: assignments.length,
    primary: summarize('primary'),
    challenger: summarize('challenger'),
  };
}

function packPlanGenerationSplitHtml(split) {
  const bothIdeas = split.primary.count > 0 && split.challenger.count > 0;
  const evenlySplit = bothIdeas && split.primary.count === split.challenger.count;
  const sameFormatMix = evenlySplit
    && split.primary.images === split.challenger.images
    && split.primary.ugc === split.challenger.ugc;
  const allocationCopy = bothIdeas
    ? `${split.primary.count} for Idea A + ${split.challenger.count} for Idea B.${sameFormatMix ? ' Both ideas use the same format mix for a clear comparison.' : ''}`
    : `${split.primary.count || split.challenger.count} assigned to the active idea.`;
  const headline = evenlySplit
    ? `${split.total} creatives total, split evenly`
    : `${split.total} creative${split.total === 1 ? '' : 's'} ${bothIdeas ? 'split across both ideas' : 'in this plan'}`;
  return `
    <section class="generation-split" aria-label="How creatives will be split between the two ideas">
      <div class="generation-split-copy">
        <p class="mono-label">What we'll generate</p>
        <h3>${headline}</h3>
        <p>${allocationCopy}</p>
      </div>
      <div class="generation-split-visual" aria-hidden="true">
        ${packPlanSplitSegment('Idea A', split.primary, 'primary')}
        ${packPlanSplitSegment('Idea B', split.challenger, 'challenger')}
      </div>
    </section>
  `;
}

function packPlanSplitSegment(label, lane, tone) {
  return `
    <div class="generation-split-segment ${tone}" style="--allocation: ${Math.max(lane.count, 0.2)}">
      <span>${escapeHtml(label)}</span>
      <strong>${lane.count} creative${lane.count === 1 ? '' : 's'}</strong>
      <small>${packPlanLaneMixLabel(lane)}</small>
    </div>
  `;
}

function packPlanLaneMixLabel({ images = 0, ugc = 0 } = {}) {
  const parts = [];
  if (images) parts.push(`${images} image ad${images === 1 ? '' : 's'}`);
  if (ugc) parts.push(`${ugc} UGC ad${ugc === 1 ? '' : 's'}`);
  return parts.join(' + ') || 'No creatives assigned';
}

function packPlanEvidenceGroup(title, tone, helper, items) {
  const visible = (items || []).slice(0, 6);
  return `
    <section class="evidence-group ${tone}">
      <div class="evidence-group-head"><span></span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(helper)}</small></div></div>
      <div class="evidence-list">
        ${visible.length ? visible.map((item) => {
          const copy = item.instruction || item.paraphrase || item.text || item.theme || '';
          const source = item.source || {};
          const sourceLabel = source.platform || source.label || (item.kind === 'screen' ? 'Reviewed screen' : 'Reviewed app info');
          return `<article><p>${escapeHtml(shorten(copy, 220))}</p>${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel)} ↗</a>` : `<small>${escapeHtml(sourceLabel)}</small>`}</article>`;
        }).join('') : '<p class="evidence-empty">Nothing yet.</p>'}
        ${(items || []).length > visible.length ? `<small class="evidence-more">${items.length - visible.length} more in the saved snapshot</small>` : ''}
      </div>
    </section>
  `;
}

function packPlanQuantityControl(type, label, value) {
  return `
    <div class="pack-output-stepper">
      <span>${label}</span>
      <button type="button" data-plan-qty="${type}" data-delta="-1" aria-label="Remove one ${label}">−</button>
      <strong>${value}</strong>
      <button type="button" data-plan-qty="${type}" data-delta="1" aria-label="Add one ${label}">+</button>
    </div>
  `;
}

function featureRowHtml(claim, index) {
  return `
    <div class="feature-row">
      <span>${index + 1}</span>
      <textarea rows="2" data-feature-input data-feature-id="${escapeHtml(claim.id)}" aria-label="Feature ${index + 1}">${escapeHtml(claim.text)}</textarea>
      <button class="text-button" type="button" data-claim-action="ignore" data-claim-id="${escapeHtml(claim.id)}">Remove</button>
    </div>
  `;
}

function largeScreenshotCardHtml(screen, index) {
  return `
    <figure class="large-screen-card">
      <div class="large-screen-frame">
        ${screen.sourceUrl ? `<img src="${escapeHtml(screen.sourceUrl)}" alt="">` : '<span></span>'}
      </div>
      <figcaption>
        <strong>${escapeHtml(screenDisplayLabel(screen, index))}</strong>
        <button class="text-button" type="button" data-screen-action="remove" data-screen-id="${escapeHtml(screen.id)}">Remove</button>
      </figcaption>
    </figure>
  `;
}

function renderScreensReview(app, buckets) {
  return `
    <div class="screen-review-stack">
      ${screenSectionHtml('Selected for ads', 'These look like clear app screens and are already selected.', buckets.recommended, 'recommended')}
      ${screenSectionHtml('Needs a quick look', 'These might work — take a quick look to confirm.', buckets.review, 'review')}
      ${screenSectionHtml('Not used for ads', 'These look like marketing images or unclear screenshots, so we skip them.', buckets.blocked, 'blocked')}
      ${!app.screens.length ? renderNoScreensEmpty() : ''}
    </div>
  `;
}

function renderClaimsReview(app, visibleClaims, pickedClaims, optionalClaims) {
  return `
    <article class="extract-card claims-card wide">
      <div class="source-card-head">
        <span class="extract-kicker">Feature selection</span>
        <strong>${pickedClaims.length ? `${pickedClaims.length} feature${pickedClaims.length === 1 ? '' : 's'} picked` : 'Choose what ads may say'}</strong>
        <small>The agent chose the first-pass features automatically. Remove anything you do not want used.</small>
      </div>
      ${pickedClaims.map((claim) => claimRowHtml(claim, 'selected')).join('')}
      ${optionalClaims.map((claim) => claimRowHtml(claim, 'optional')).join('')}
      ${!visibleClaims.length ? renderNoClaimsEmpty() : ''}
    </article>
  `;
}

function screenSectionHtml(title, subtitle, screens, tone) {
  if (!screens.length) return '';
  return `
    <article class="extract-card screen-section ${tone}">
      <div class="source-card-head">
        <span class="extract-kicker">${escapeHtml(title)}</span>
        <strong>${screens.length} screenshot${screens.length === 1 ? '' : 's'}</strong>
        <small>${escapeHtml(subtitle)}</small>
      </div>
      <div class="screen-gallery review-grid">
        ${screens.map((screen, index) => screenTileHtml(screen, index)).join('')}
      </div>
    </article>
  `;
}

function screenTileHtml(screen, index, options = {}) {
  const judgement = screenJudgement(screen);
  const selected = isScreenSelected(screen);
  const blocked = judgement.status === 'blocked';
  const compact = Boolean(options.compact);
  return `
    <figure class="screen-tile ${escapeHtml(judgement.status)} ${selected ? 'selected' : ''} ${screen.ignored ? 'ignored' : ''}">
      <div class="screen-frame">
        ${screen.sourceUrl ? `<img src="${escapeHtml(screen.sourceUrl)}" alt="">` : '<span></span>'}
        <b>${escapeHtml(selected ? 'Selected' : judgement.label)}</b>
      </div>
      <figcaption>${escapeHtml(screenDisplayLabel(screen, index))}</figcaption>
      ${compact ? '' : `
        <small>${escapeHtml(judgement.reason)}</small>
        <div class="screen-actions">
          <button class="text-button" type="button" data-screen-action="toggle" data-screen-id="${escapeHtml(screen.id)}" ${blocked ? 'disabled' : ''}>${selected ? 'Remove' : 'Use'}</button>
          <button class="text-button" type="button" data-screen-action="ignore" data-screen-id="${escapeHtml(screen.id)}">${screen.ignored ? 'Restore' : 'Set aside'}</button>
        </div>
      `}
    </figure>
  `;
}

function claimRowHtml(claim, stateName) {
  const selected = stateName === 'selected';
  return `
    <div class="claim-row compact ${selected ? 'approved-claim' : 'pending-claim'}">
      <span class="claim-check ${selected ? '' : 'warn'}">${selected ? '✓' : '+'}</span>
      <div>
        <p>${escapeHtml(claim.text)}</p>
        <small>${escapeHtml(claim.source)}</small>
        <div class="inline-actions">
          ${selected ? `
            <button class="text-button" type="button" data-claim-action="remove" data-claim-id="${escapeHtml(claim.id)}">Remove</button>
          ` : `
            <button class="text-button" type="button" data-claim-action="use" data-claim-id="${escapeHtml(claim.id)}">Use</button>
          `}
          <button class="text-button" type="button" data-claim-action="ignore" data-claim-id="${escapeHtml(claim.id)}">Ignore</button>
        </div>
        ${selected ? '' : `
          <div class="inline-actions">
            <span class="claim-hint">Won't be used in ads unless you add it.</span>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderNoScreensEmpty() {
  return `
    <div class="extract-empty">
      <strong>No usable app screenshots yet</strong>
      <small>Upload real screenshots or a recording before creating ads from app screens.</small>
    </div>
  `;
}

function renderNoClaimsEmpty() {
  return `
    <div class="extract-empty">
      <strong>No key features found yet</strong>
      <small>Add one true product feature before generating ads.</small>
    </div>
  `;
}

function handleClaimAction(app, claimId, action) {
  const claim = app.claims.find((candidate) => candidate.id === claimId);
  if (!claim) return;
  if (action === 'use') {
    claim.selected = true;
    claim.ignored = false;
    toast('Feature added to your ad plan.');
  }
  if (action === 'remove') {
    claim.selected = false;
    toast('Feature removed from your ad plan.');
  }
  if (action === 'ignore') {
    claim.ignored = true;
    claim.selected = false;
    toast('Feature ignored for this app.');
  }
  renderAll();
}

function handleScreenAction(app, screenId, action) {
  const screen = app.screens.find((candidate) => candidate.id === screenId);
  if (!screen) return;
  if (action === 'toggle') {
    if (screenJudgement(screen).status === 'blocked') {
      toast('That screenshot is set aside because it does not look usable in ads.');
      return;
    }
    screen.selected = !isScreenSelected(screen);
    screen.ignored = false;
    toast(screen.selected ? 'Screenshot added to your ad plan.' : 'Screenshot removed from this plan.');
  }
  if (action === 'remove') {
    screen.selected = false;
    screen.ignored = true;
    toast('Screenshot removed.');
  }
  if (action === 'ignore') {
    screen.ignored = !screen.ignored;
    if (screen.ignored) screen.selected = false;
    if (!screen.ignored && screenJudgement(screen).status === 'recommended') screen.selected = true;
    toast(screen.ignored ? 'Screenshot set aside.' : 'Screenshot restored.');
  }
  renderAll();
}

function screenBuckets(app) {
  return app.screens.reduce((buckets, screen) => {
    const judgement = screenJudgement(screen);
    if (screen.ignored || judgement.status === 'blocked') buckets.blocked.push(screen);
    else if (judgement.status === 'review') buckets.review.push(screen);
    else buckets.recommended.push(screen);
    return buckets;
  }, { recommended: [], review: [], blocked: [] });
}

function selectedUsableScreens(app) {
  return app.screens.filter((screen) => isScreenSelected(screen));
}

function isScreenSelected(screen) {
  return screen.selected !== false && !screen.ignored && screenJudgement(screen).status !== 'blocked';
}

function selectedClaims(app) {
  return app.claims.filter((claim) => isClaimSelected(claim));
}

function isClaimSelected(claim) {
  if (claim.ignored) return false;
  if (claim.selected !== undefined) return claim.selected === true;
  return claim.supported === true;
}

function canGenerateFromPlan(app) {
  return selectedUsableScreens(app).length > 0 && selectedClaims(app).length > 0;
}

function screenJudgement(screen) {
  if (screen.usability && screen.usabilityLabel && screen.usabilityReason) {
    return {
      status: screen.usability,
      label: screen.usabilityLabel,
      reason: screen.usabilityReason,
    };
  }
  if (screen.sourceType === 'website_asset') {
    return {
      status: 'blocked',
      label: 'Not used',
      reason: 'This looks like a website or marketing image, not an app screen.',
    };
  }
  if (screen.sourceType === 'raw_app_proof') {
    return {
      status: 'recommended',
      label: 'Ready for ads',
      reason: 'Uploaded or captured app screen.',
    };
  }
  const dimensions = imageDimensionsFromUrl(screen.sourceUrl);
  if (dimensions) {
    const ratio = dimensions.height / Math.max(1, dimensions.width);
    if (dimensions.width >= 600 && dimensions.height >= 1100 && ratio >= 1.45) {
      return {
        status: 'recommended',
        label: 'Looks usable',
        reason: 'High-resolution vertical app screenshot.',
      };
    }
    if (dimensions.width < 420 || dimensions.height < 700) {
      return {
        status: 'blocked',
        label: 'Too small',
        reason: 'Too low-resolution to use cleanly in ads.',
      };
    }
    return {
      status: 'review',
      label: 'Check it',
      reason: ratio < 1.2 ? 'Landscape or wide image; may not be a clean app screen.' : 'Could be useful, but needs a quick look.',
    };
  }
  return {
    status: screen.sourceType === 'store_art' ? 'review' : 'blocked',
    label: screen.sourceType === 'store_art' ? 'Check it' : 'Not used',
    reason: screen.sourceType === 'store_art'
      ? 'Store screenshot found, but dimensions were not available in the URL.'
      : 'This asset is context only.',
  };
}

function imageDimensionsFromUrl(url) {
  const value = String(url || '');
  const apple = value.match(/\/(\d+)x(\d+)[^/]*\.(?:webp|jpg|jpeg|png)(?:\/|$)/i);
  if (apple) return { width: Number(apple[1]), height: Number(apple[2]) };
  const play = value.match(/=w(\d+)-h(\d+)(?:-|$)/i);
  if (play) return { width: Number(play[1]), height: Number(play[2]) };
  return null;
}

function sourceQualityLabel(screens) {
  if (!screens.length) return 'Add real app screenshots before generating.';
  const dimensions = screens
    .map((screen) => imageDimensionsFromUrl(screen.sourceUrl))
    .filter(Boolean);
  if (!dimensions.length) return 'Using uploaded or store screenshots.';
  const largest = dimensions.reduce((best, item) => {
    const area = item.width * item.height;
    const bestArea = best.width * best.height;
    return area > bestArea ? item : best;
  }, dimensions[0]);
  return `Using real source screenshots up to ${largest.width}x${largest.height}.`;
}

function reviewFooterMessage(app, selectedScreens, pickedClaims) {
  if (!selectedScreens.length && !pickedClaims.length) {
    return 'Add or choose one real app screenshot and one true feature so we can generate your first ads.';
  }
  if (!selectedScreens.length) {
    return 'Add or choose at least one usable screenshot so your ads show the real app.';
  }
  if (!pickedClaims.length) {
    return 'Screenshots are ready. Pick one true feature so the ads know what to say.';
  }
  return 'Ready — generate from these screenshots and features, or edit them first.';
}

function screensFoundTitle(app) {
  if (!app.screens.length) return 'No screenshots yet';
  const noun = app.screens.length === 1 ? 'screenshot' : 'screenshots';
  return `${app.screens.length} ${noun} from ${screenSourceName(app)}`;
}

function screensFoundSubtitle(app) {
  if (!app.screens.length) return 'We could not find real app screenshots from the URL.';
  return 'These are the screens we can use as visual references after review.';
}

function screenSourceName(app) {
  const source = app.source?.split(' · ')[0] || 'the app listing';
  if (source === 'App Store') return 'App Store';
  if (source === 'Play Store') return 'Google Play';
  return source.toLowerCase().includes('website') ? 'the website' : source;
}

function screenDisplayLabel(screen, index) {
  if (screen.label && !/^store screenshot \d+$/i.test(screen.label)) return screen.label;
  return `Screenshot ${index + 1}`;
}

function reviewHoldMessage(app, hold) {
  if (!hold) return '';
  if (hold.id === 'review-store-art') {
    return `The agent picked the best screenshots; review only if you want to customize.`;
  }
  if (hold.id === 'claims-need-approval' || hold.id === 'claims-need-selection') {
    return 'Pick at least one feature before ads can use this app profile.';
  }
  if (hold.id === 'no-screens-found') {
    return 'We need real app screenshots or a recording before creating ads from app screens.';
  }
  return hold.message || '';
}

function handleExtractionAction(app, action) {
  if (action === 'edit') {
    app.tagline = `Imported from ${app.source.split(' · ')[0]}. Edited summary: focus first ads on the clearest value moments users can see in the app.`;
    if (!app.reviewSignals.includes('User edited the app summary before generation.')) {
      app.reviewSignals.unshift('User edited the app summary before generation.');
    }
    toast('Summary edited in the demo.');
  }
  if (action === 'add') {
    openScreenshotPicker(app);
  }
  if (action === 'addFeature') {
    app.claims.push({
      id: `${app.id}-feature-${Date.now()}`,
      text: 'New key feature',
      source: 'Edited by user',
      supported: true,
      selected: true,
    });
    toast('Feature added.');
  }
  if (action === 'ignoreWeak') {
    const weak = app.claims.find((claim) => !isClaimSelected(claim) && !claim.ignored);
    if (weak) weak.ignored = true;
    toast('Feature set aside for this pack.');
  }
  if (action === 'generateNow') {
    generateReviewedPack(app);
    return;
  }
  if (action === 'approve') {
    approveExtraction(app, { openSheet: true });
    return;
  }
  renderAll();
}

function handleFeatureInput(app, claimId, value) {
  const claim = app.claims.find((candidate) => candidate.id === claimId);
  if (!claim) return;
  claim.text = value;
  claim.selected = true;
  claim.ignored = false;
}

function approveExtraction(app, { openSheet = false } = {}) {
  app.extractionStatus = 'approved';
  app.status = 'App info ready';
  toast('App info saved. Ready to build the Pack Plan.');
  renderAll();
  if (openSheet) buildPackPlanForApp(app);
}

async function generateReviewedPack(app) {
  if (!canGenerateFromPlan(app)) {
    toast('Add at least one screenshot and one key feature before planning.');
    return;
  }
  resetGenerate();
  app.extractionStatus = 'approved';
  app.status = 'App info ready';
  await buildPackPlanForApp(app);
}

async function buildPackPlanForApp(app, { force = false } = {}) {
  if (!app || !canGenerateFromPlan(app)) {
    toast('Add at least one screenshot and one key feature before planning.');
    return;
  }
  if (app.packPlanStatus === 'researching') return;
  if (!force && app.packPlanStatus === 'proposed' && app.activePackPlan) {
    renderAll();
    $('#packPlan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const priorStatus = app.packPlanStatus;
  app.extractionStatus = 'approved';
  app.packPlanStatus = 'researching';
  app.status = 'Researching Pack Plan';
  app.packPlanNeedsRefresh = false;
  app.packPlanExpanded = false;
  renderAll();
  $('#packPlan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const appId = app.appId || app.id;
  const nextRevision = Number(app.planRevision || 0) + 1;
  const idempotencyKey = `pack-plan-${appId}-${nextRevision}-${state.generate.imageCount}-${state.generate.videoCount}`;
  try {
    const response = await fetch('/api/pack-plans/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        uid: state.session.uid || null,
        orgId: state.session.orgId,
        workspaceId: state.session.workspaceId,
        appId,
        imageCount: state.generate.imageCount,
        videoCount: state.generate.videoCount,
        idempotencyKey,
        appPlan: reviewedPlanPayload(app),
        goal: app.runs?.length
          ? 'Use prior creative review to choose the next controlled angle test.'
          : 'Find the clearest creative direction for this app.',
        channel: 'Paid social',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !payload.plan) {
      throw new Error(payload.error || 'Could not build the Pack Plan.');
    }
    mergeServerApp(app, payload.app);
    app.activePackPlan = payload.plan;
    app.activePackPlanId = payload.plan.planId;
    app.packPlanStatus = 'proposed';
    app.packPlanResearchStatus = payload.researchStatus || 'limited';
    app.packPlanResearchLimitations = payload.researchLimitations || [];
    app.packPlanNeedsRefresh = false;
    syncGenerateMixFromPlan(payload.plan);
    renderAll();
    toast('Plan ready. Review it before generating.');
    $('#packPlan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    app.packPlanStatus = priorStatus === 'proposed' && app.activePackPlan ? 'proposed' : 'idle';
    app.status = app.packPlanStatus === 'proposed' ? 'Pack Plan ready' : 'App info ready';
    renderAll();
    toast(error.message || 'Could not build the Pack Plan.');
  }
}

function mergeServerApp(app, serverApp) {
  if (!app || !serverApp) return app;
  const localOnly = {
    packPlanNeedsRefresh: app.packPlanNeedsRefresh,
    packPlanResearchStatus: app.packPlanResearchStatus,
    packPlanResearchLimitations: app.packPlanResearchLimitations,
    packPlanExpanded: app.packPlanExpanded,
  };
  Object.assign(app, serverApp, localOnly);
  return app;
}

function syncGenerateMixFromPlan(plan) {
  if (!plan?.request?.outputMix) return;
  state.generate.imageCount = Number(plan.request.outputMix.image) || 0;
  state.generate.videoCount = Number(plan.request.outputMix.ugc) || 0;
}

function invalidateClientPackPlan(app) {
  if (!app) return;
  app.packPlanStatus = 'idle';
  app.activePackPlan = null;
  app.activePackPlanId = null;
  app.packPlanNeedsRefresh = false;
  app.packPlanExpanded = false;
}

function openScreenshotPicker(app) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener('change', () => {
    const files = [...input.files];
    if (!files.length) return;
    files.forEach((file, index) => {
      const objectUrl = URL.createObjectURL(file);
      app.screens.push({
        id: `${app.id}-upload-${Date.now()}-${index}`,
        label: file.name.replace(/\.[^.]+$/, '').slice(0, 42) || `Uploaded screenshot ${app.screens.length + 1}`,
        detail: 'Screenshot you added for use in ad plans.',
        sourceType: 'raw_app_proof',
        rawifyEligible: false,
        trustLevel: 'user_uploaded',
        sourceUrl: objectUrl,
        usability: 'recommended',
        usabilityLabel: 'User added',
        usabilityReason: 'User-uploaded app screenshot added to the source collection.',
        selected: true,
        ignored: false,
      });
    });
    invalidateClientPackPlan(app);
    app.extractionStatus = 'review';
    toast(`${files.length} screenshot${files.length === 1 ? '' : 's'} added to your ad plan.`);
    renderAll();
  }, { once: true });
  input.click();
}

function renderAds(app) {
  renderAnnualBanner(app);
  const extractionApproved = app.extractionStatus === 'approved';
  const filters = [
    ['all', 'All'],
    ['image', 'Image ads'],
    ['ugc', 'UGC ads'],
    ['approved', 'Approved'],
  ];
  if (app.ads.some((item) => item.status === 'rejected')) filters.push(['rejected', 'Rejected']);
  $('#adFilters').innerHTML = filters.map(([key, label]) => {
    const count = filterAds(app, key).length;
    return `<button class="filter-chip" type="button" data-filter="${key}" aria-pressed="${state.adFilter === key}">${label} · ${count}</button>`;
  }).join('');
  $('#adFilters').querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.adFilter = button.dataset.filter;
      renderAds(app);
    });
  });

  const ads = filterAds(app, state.adFilter);
  $('#adGrid').innerHTML = ads.length ? ads.map((item) => adCardHtml(app, item)).join('') :
    `<div class="empty-note">${extractionApproved ? 'No ads in this filter yet.' : 'Press Next to generate your first creative pack.'}</div>`;
  $('#adGrid').querySelectorAll('[data-ad-action]').forEach((button) => {
    button.addEventListener('click', () => decideAd(button.dataset.ad, button.dataset.adAction));
  });
}

function filterAds(app, filter) {
  if (filter === 'all') return app.ads;
  if (filter === 'approved') return app.ads.filter((item) => item.status === 'approved');
  if (filter === 'rejected') return app.ads.filter((item) => item.status === 'rejected');
  return app.ads.filter((item) => item.format === filter);
}

function adCardHtml(app, item) {
  const screen = app.screens.find((candidate) => candidate.id === item.screenId);
  const regenCost = CREDIT_RULES[item.format === 'ugc' ? 'video' : 'image'];
  const statusLabel = item.status === 'approved' ? 'approved' : item.status === 'rejected' ? 'rejected' : 'ready';
  return `
    <article class="ad-card ${item.status}">
      <div class="ad-thumb ${item.format === 'image' ? 'lit' : ''}">
        ${item.format === 'ugc' ? '<span class="play">▶</span>' : ''}
        <span class="badge">${item.format === 'ugc' ? 'UGC' : 'IMAGE'}</span>
      </div>
      <div class="ad-copy">
        <span class="pill ${item.status}">${statusLabel}</span>
        <h3>"${escapeHtml(item.caption)}"</h3>
        <p>Made from ${escapeHtml(screen?.label || 'selected app screen')} · ${escapeHtml(angleLabel(app, item.angle))}</p>
        ${item.tweakNote ? `<p class="tweak-note">Tweak note: ${escapeHtml(item.tweakNote)}</p>` : ''}
      </div>
      <div class="ad-actions">
        <button class="small-action ${item.status === 'approved' ? 'on' : ''}" type="button" data-ad="${item.id}" data-ad-action="approve">Approve</button>
        <button class="small-action" type="button" data-ad="${item.id}" data-ad-action="tweak">Tweak</button>
        <button class="small-action ${item.status === 'rejected' ? 'danger' : ''}" type="button" data-ad="${item.id}" data-ad-action="reject">Reject</button>
        <button class="small-action" type="button" data-ad="${item.id}" data-ad-action="regenerate">Redo · ${regenCost} credits</button>
      </div>
    </article>
  `;
}

async function decideAd(adId, action) {
  const app = activeApp();
  const item = app?.ads.find((candidate) => candidate.id === adId);
  if (!item) return;
  ensureLearningState(app);
  if (['approve', 'reject', 'tweak'].includes(action)) {
    let note = '';
    if (action === 'tweak') {
      const response = window.prompt('What should change in this ad?', item.tweakNote || '');
      if (response === null) return;
      note = response.trim();
      if (!note) {
        toast('Add a concrete tweak so the next Pack Plan can use it.');
        return;
      }
    }
    try {
      if (!item.packId) {
        // Explicit demo-workspace fallback. Real generated drafts always carry
        // a server-owned pack ID and use the persisted decision route below.
        item.status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : item.status;
        item.tweakNote = note || item.tweakNote;
        recordReviewDecision(app, item, action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'tweak', note);
      } else {
        const response = await fetch('/api/review-decisions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            uid: state.session.uid || null,
            orgId: state.session.orgId,
            workspaceId: state.session.workspaceId,
            appId: app.appId || app.id,
            packId: item.packId,
            draftId: item.id,
            action,
            format: item.format,
            angle: angleLabel(app, item.angle),
            note,
            idempotencyKey: reviewDecisionKey(item, action, note),
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not save the review decision.');
        mergeServerApp(app, payload.app);
      }
      if (action === 'approve') toast('Approved. We will use this in the next plan.');
      if (action === 'reject') toast('Rejected. We will adjust the next plan.');
      if (action === 'tweak') toast('Change saved for the next plan.');
    } catch (error) {
      toast(error.message || 'Could not save the review decision.');
      return;
    }
  }
  if (action === 'regenerate') {
    const cost = CREDIT_RULES[item.format === 'ugc' ? 'video' : 'image'];
    if (state.credits.balance < cost) {
      openUpsell({ reason: 'run' });
      return;
    }
    state.credits.balance -= cost;
    recordCreditTransaction(`Regenerated 1 ${item.format === 'ugc' ? 'UGC' : 'image'} ad`, -cost);
    item.caption = regeneratedCaption(app, item);
    item.status = 'ready';
    recordReviewDecision(app, item, 'regenerated', item.tweakNote || '');
    renderCreditMeter();
    toast(`New draft generated for ${cost} credits.`);
  }
  if (action === 'export') {
    openHandoff();
  }
  renderAds(app);
  renderNextPanel(app, stageFor(app));
}

function reviewDecisionKey(item, action, note) {
  const instruction = String(note || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64);
  return ['review', item.packId, item.id, action, instruction].filter(Boolean).join('-').slice(0, 220);
}

function ensureLearningState(app) {
  if (!app) return;
  if (!Array.isArray(app.reviewDecisions)) app.reviewDecisions = [];
  if (!Array.isArray(app.learningEvents)) app.learningEvents = [];
}

function recordReviewDecision(app, item, action, note = '') {
  ensureLearningState(app);
  app.reviewDecisions.unshift({
    id: `decision-${Date.now()}-${app.reviewDecisions.length}`,
    adId: item.id,
    action,
    format: item.format,
    angle: item.angle,
    note,
    when: 'Just now',
  });
  const event = learningEventFor(app, item, action, note);
  if (event) {
    app.learningEvents.unshift({
      id: `learn-${Date.now()}-${app.learningEvents.length}`,
      ...event,
      when: 'Just now',
    });
  }
}

function learningEventFor(app, item, action, note) {
  const angle = angleLabel(app, item.angle);
  if (action === 'approved') {
    return { type: 'liked_angle', text: `Approved a ${item.format === 'ugc' ? 'UGC' : 'image'} ad on "${angle}". More like this next pack.` };
  }
  if (action === 'rejected') {
    const rejections = app.reviewDecisions.filter((decision) => decision.action === 'rejected' && decision.angle === item.angle).length;
    if (rejections >= 2) {
      const angleRecord = app.angles.find((candidate) => candidate.id === item.angle);
      if (angleRecord && !angleRecord.deprioritized) {
        angleRecord.deprioritized = true;
        angleRecord.selected = false;
        return { type: 'avoid_angle', text: `"${angle}" rejected ${rejections} times. Parked for the next pack.` };
      }
    }
    return { type: 'rejected_creative', text: `Rejected a ${item.format === 'ugc' ? 'UGC' : 'image'} ad on "${angle}".` };
  }
  if (action === 'tweak' && note) {
    return { type: 'tweak_note', text: `Tweak note: ${note}` };
  }
  if (action === 'regenerated') {
    return { type: 'regenerated', text: `Asked for a new take on "${angle}"${note ? ` — ${note}` : ''}.` };
  }
  return null;
}

function regeneratedCaption(app, item) {
  const angle = angleLabel(app, item.angle);
  const variants = [
    `${angle}, without the guesswork`,
    `The ${angle.toLowerCase()} moment, up close`,
    `${app.name.split(':')[0]}: ${angle.toLowerCase()}`,
  ];
  const current = variants.indexOf(item.caption);
  return variants[(current + 1 + variants.length) % variants.length];
}

function renderNextPanel(app, stage) {
  if (app.extractionStatus !== 'approved') {
    $('#nextPanel').innerHTML = '';
    return;
  }

  const ready = app.ads.filter((item) => item.status === 'ready').length;
  const approved = app.ads.filter((item) => item.status === 'approved').length;
  if (stage === 'approved') {
    const mix = defaultPackMix();
    const firstRunCost = defaultPackCost();
    const afterFirstRun = state.credits.balance - firstRunCost;
    $('#nextPanel').innerHTML = `
      <p class="mono-label">Next best action</p>
      <h3>${state.launchPackMode ? 'Same-Day Launch Pack' : 'Your first creative pack'}</h3>
      <p>Your ad plan is saved. Generate the first pack, or open App info to adjust the screenshots and features.</p>
      <div class="credit-preview">
        <span>First pack</span>
        <strong>${firstRunCost} credits</strong>
        <small>${packMixLabel(mix)} · ${state.credits.balance} → ${Math.max(0, afterFirstRun)} left</small>
      </div>
    `;
    return;
  }

  const suggestedCost = defaultPackCost();
  ensureLearningState(app);
  const learnings = app.learningEvents.length;
  $('#nextPanel').innerHTML = `
    <p class="mono-label">Next best action</p>
    <h3>${ready ? `Review ${ready} ready ad${ready === 1 ? '' : 's'}` : 'Generate the next pack'}</h3>
    <p>${approved ? `${approved} approved ad${approved === 1 ? '' : 's'} ${approved === 1 ? 'is' : 'are'} saved to this app.` : 'Approve winners so the next pack gets sharper.'}</p>
    ${learnings ? `<p class="learning-line">Next pack starts from ${learnings} review learning${learnings === 1 ? '' : 's'}.</p>` : ''}
    <div class="next-stack">
      <button class="primary-button" type="button" id="nextGenerate">Generate more</button>
      <button class="ghost-button" type="button" id="nextExport">Export ads</button>
    </div>
    <div class="credit-preview">
      <span>Suggested pack</span>
      <strong>${packMixLabel(defaultPackMix())}</strong>
      <small>${suggestedCost} credits · ${state.credits.balance} → ${Math.max(0, state.credits.balance - suggestedCost)} left</small>
    </div>
  `;
  $('#nextGenerate').addEventListener('click', openGenerate);
  $('#nextExport').addEventListener('click', openHandoff);
}

function renderTabs(app) {
  if (state.activeTab === 'ads') state.activeTab = 'understanding';
  $$('.tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.activeTab);
    button.setAttribute('aria-selected', String(button.dataset.tab === state.activeTab));
    button.onclick = handleTabClick;
  });

  if (state.activeTab === 'understanding') renderUnderstanding(app);
  if (state.activeTab === 'runs') renderRuns(app);
}

function handleTabClick(event) {
  state.activeTab = event.currentTarget.dataset.tab;
  renderTabs(activeApp());
}

function renderUnderstanding(app) {
  ensureLearningState(app);
  const learningEvents = app.learningEvents;
  const selectedScreens = selectedUsableScreens(app);
  const screens = selectedScreens.length ? selectedScreens : app.screens.filter((screen) => !screen.ignored);
  const visibleScreens = screens.slice(0, 6);
  const features = selectedClaims(app);
  const visibleFeatures = features.length ? features : app.claims.filter((claim) => !claim.ignored);
  $('#tabPanel').innerHTML = `
    <div class="understanding-grid">
      <section class="panel">
        <div class="section-row">
          <div>
            <p class="mono-label">Screenshots</p>
            <h3>${screens.length} selected screenshot${screens.length === 1 ? '' : 's'}</h3>
          </div>
          <button class="small-action" type="button" id="addScreen">Add screenshots</button>
        </div>
        <p class="panel-note">Your ads are built from these real app screenshots.</p>
        <div class="source-screen-grid">
          ${visibleScreens.map((screen, index) => `
            <figure class="source-screen-tile">
              <div class="source-screen-thumb">
                ${screen.sourceUrl ? `<img src="${escapeHtml(screen.sourceUrl)}" alt="${escapeHtml(screenDisplayLabel(screen, index))}" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
                <span aria-hidden="true">▦</span>
              </div>
              <figcaption>
                <strong>${escapeHtml(screenDisplayLabel(screen, index))}</strong>
                <small>${escapeHtml(screenSourceLabel(screen))}</small>
              </figcaption>
            </figure>
          `).join('')}
        </div>
        ${screens.length > visibleScreens.length ? `<p class="more-source">${screens.length - visibleScreens.length} more screenshot${screens.length - visibleScreens.length === 1 ? '' : 's'} included</p>` : ''}
      </section>
      <section class="panel">
        <p class="mono-label">Key features</p>
        <h3>${visibleFeatures.length} feature${visibleFeatures.length === 1 ? '' : 's'} ads can mention</h3>
        <p class="panel-note">Pulled from your store listing. Edit them any time before generating.</p>
        ${visibleFeatures.map((claim) => `
          <div class="claim-row">
            <span class="claim-check ${isClaimSelected(claim) ? '' : 'warn'}">${isClaimSelected(claim) ? '✓' : '△'}</span>
            <div>
              <p>${escapeHtml(claim.text)}</p>
              <small>${escapeHtml(claim.source)}</small>
            </div>
          </div>
        `).join('')}
      </section>
      <section class="panel">
        <p class="mono-label">Next</p>
        <h3>Ready to generate</h3>
        <div class="info-step">
          <strong>Generate ${packMixLabel(defaultPackMix())}</strong>
          <span>${app.runs?.length ? 'The suggested pack' : 'The first run'} costs ${defaultPackCost()} credits and uses the selected screenshots and key features above.</span>
        </div>
        <div class="info-step">
          <strong>Edit only if something looks wrong</strong>
          <span>Remove weak screenshots or adjust the summary before generating.</span>
        </div>
        <div class="info-step">
          <strong>Teach the next pack</strong>
          <span>Approvals and tweaks become learning notes for future runs.</span>
        </div>
      </section>
      <section class="panel">
        <p class="mono-label">What we're learning</p>
        <h3>${learningEvents.length ? `${learningEvents.length} learning${learningEvents.length === 1 ? '' : 's'} shaping the next pack` : 'The next pack learns from your review'}</h3>
        <p class="panel-note">${learningEvents.length ? 'These notes shape the next plan.' : 'Approve, reject, or leave a change. Your review shapes the next plan.'}</p>
        ${learningEvents.slice(0, 5).map((event) => `
          <div class="claim-row">
            <span class="claim-check ${['rejected_creative', 'rejected_angle', 'avoid_angle'].includes(event.type) ? 'warn' : ''}">${['rejected_creative', 'rejected_angle', 'avoid_angle'].includes(event.type) ? '−' : '✓'}</span>
            <div>
              <p>${escapeHtml(event.instruction || event.text || '')}</p>
              <small>${escapeHtml(event.when || formatLearningWhen(event.createdAt) || 'Recently')}</small>
            </div>
          </div>
        `).join('')}
      </section>
    </div>
  `;
  $('#addScreen').addEventListener('click', () => {
    openScreenshotPicker(app);
  });
}

function formatLearningWhen(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function screenSourceLabel(screen) {
  if (screen.sourceType === 'raw_app_proof') return 'Uploaded app screen';
  if (screen.sourceType === 'store_art') return 'Store screenshot';
  if (screen.sourceType === 'website_asset') return 'Website image';
  return 'Imported source';
}

function renderRuns(app) {
  $('#tabPanel').innerHTML = `
    <div class="panel">
      <div class="section-row">
        <div>
          <p class="mono-label">Packs</p>
          <h3>Every pack for ${escapeHtml(app.name)}</h3>
        </div>
      </div>
      <div class="run-list">
        ${app.runs.map((run) => `
          <div class="run-row">
            <span class="run-dot ${run.status}"></span>
            <div>
              <strong>${escapeHtml(run.label)}</strong>
              <small>${run.count} ads · ${run.cost} credits · ${escapeHtml(run.when)}</small>
            </div>
            <span class="pill">${escapeHtml(run.status)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function openImportModal() {
  $('#modalImportUrl').value = '';
  $('#importModal').hidden = false;
  requestAnimationFrame(() => $('#modalImportUrl')?.focus());
}

function closeImportModal() {
  $('#importModal').hidden = true;
  $('#modalImportUrl').value = '';
}

function openAgentStart() {
  renderAgentStart();
  $('#agentStartModal').hidden = false;
}

function closeAgentStart() {
  $('#agentStartModal').hidden = true;
}

function simulateAgentStart() {
  closeAgentStart();
  startImport(PROOF_BACKED_DEMO_URL, 'Agent start', { demo: true });
}

function renderAgentStart() {
  const platform = AGENT_PROMPTS[state.agentPromptPlatform] ? state.agentPromptPlatform : 'codex';
  const prompt = AGENT_PROMPTS[platform];
  $('#agentPromptTitle').textContent = prompt.title;
  $('#agentPromptText').textContent = prompt.text;
  $$('#agentPromptTabs [data-agent-platform]').forEach((button) => {
    const selected = button.dataset.agentPlatform === platform;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  syncDevControls();
}

async function copyAgentPrompt() {
  const prompt = AGENT_PROMPTS[state.agentPromptPlatform]?.text || AGENT_PROMPTS.codex.text;
  try {
    await navigator.clipboard.writeText(prompt);
    toast('Prompt copied.');
  } catch {
    toast('Prompt ready to copy.');
  }
}

function openGenerate() {
  clearToast();
  const app = activeApp();
  if (!app) return;
  if (app.packPlanStatus === 'proposed' && app.activePackPlan) {
    syncGenerateMixFromPlan(app.activePackPlan);
    renderAll();
    $('#packPlan')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  resetGenerate();
  buildPackPlanForApp(app);
}

function closeGenerate() {
  $('#generateModal').hidden = true;
}

function resetGenerate() {
  const app = activeApp();
  const mix = defaultPackMix();
  state.generate.imageCount = mix.image;
  state.generate.videoCount = mix.video;
  const preferred = app ? app.angles.filter((angle) => angle.selected).map((angle) => angle.id) : [];
  if (!preferred.length && app?.angles.length) preferred.push(app.angles[0].id);
  state.generate.selectedAngles = new Set(preferred);
}

function showEmptyState() {
  state.apps = [];
  state.activeAppId = null;
  state.activeTab = 'understanding';
  state.adFilter = 'all';
  state.infoOpen = false;
  state.building = null;
  closeImportModal();
  closeAgentStart();
  closeGenerate();
  closeUpsell();
  closeHandoff();
  resetGenerate();
  setRoute('home');
  toast('First-run state shown.');
}

function renderGenerate() {
  const app = activeApp();
  const cost = currentCost();
  const after = state.credits.balance - cost;
  const enough = after >= 0;
  const outputCount = state.generate.imageCount + state.generate.videoCount;

  $('#generateContent').innerHTML = `
    <div class="modal-head generate-head">
      ${appIconHtml(app, 'app-icon generate-app-icon', `${app.name} icon`)}
      <div>
        <p class="eyebrow">Next</p>
        <h2 id="generateTitle">Ready to generate ads for ${escapeHtml(app.name)}</h2>
        <p>Review the app info being used, choose the output count, then generate.</p>
      </div>
    </div>

    ${renderGenerateSourcePreview(app)}

    <section class="sheet-section qty-grid">
      ${quantityControl('image', 'Image ads', state.generate.imageCount, `${CREDIT_RULES.image} credits each`)}
      ${quantityControl('video', 'UGC ads', state.generate.videoCount, `${CREDIT_RULES.video} credits each`)}
    </section>

    <div class="generate-footer ${enough ? '' : 'warning'}">
      <div class="generate-footer-summary">
        <span>This run</span>
        <strong>${cost} credits</strong>
        <small>${outputCount} output${outputCount === 1 ? '' : 's'} · ${state.generate.imageCount} images · ${state.generate.videoCount} UGC · ${state.credits.balance} → ${Math.max(0, after)} left</small>
      </div>
      <div class="modal-actions">
        <button class="primary-button" type="button" id="commitGenerate">${enough ? 'Generate ads' : 'Review credit options'}</button>
      </div>
    </div>
  `;

  $('#commitGenerate').addEventListener('click', () => {
    if (cost > state.credits.balance) {
      openUpsell({ reason: 'run' });
      return;
    }
    commitGenerate(cost);
  });
  $('#editSourceInfo')?.addEventListener('click', () => {
    closeGenerate();
    invalidateClientPackPlan(app);
    app.extractionStatus = 'review';
    state.infoOpen = false;
    renderAll();
    $('#extractionReview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $$('#generateContent [data-qty]').forEach((button) => {
    button.addEventListener('click', () => {
      adjustQuantity(button.dataset.qty, Number(button.dataset.delta));
      renderGenerate();
    });
  });
}

function renderGenerateSourcePreview(app) {
  const screens = selectedUsableScreens(app);
  const claims = selectedClaims(app);
  const visibleClaims = claims.slice(0, 5);
  return `
    <section class="sheet-section generate-source-preview">
      <div class="source-preview-head">
        <div>
          <span class="extract-kicker">Using reviewed app info</span>
          <strong>${screens.length} selected screenshot${screens.length === 1 ? '' : 's'} · ${claims.length} key feature${claims.length === 1 ? '' : 's'}</strong>
        </div>
        <button class="text-button" type="button" id="editSourceInfo">Edit</button>
      </div>
      <p class="source-summary">${escapeHtml(app.tagline)}</p>
      <div class="source-feature-list">
        ${visibleClaims.map((claim) => `<p><span aria-hidden="true"></span>${escapeHtml(claim.text)}</p>`).join('')}
        ${claims.length > visibleClaims.length ? `<small>${claims.length - visibleClaims.length} more feature${claims.length - visibleClaims.length === 1 ? '' : 's'} included</small>` : ''}
      </div>
    </section>
  `;
}

function quantityControl(type, label, value, helper) {
  return `
    <div class="qty-card">
      <div>
        <strong>${label}</strong>
        <small>${helper}</small>
      </div>
      <div class="stepper">
        <button type="button" data-qty="${type}" data-delta="-1">−</button>
        <span>${value}</span>
        <button type="button" data-qty="${type}" data-delta="1">+</button>
      </div>
    </div>
  `;
}

function adjustQuantity(type, delta) {
  if (type === 'image') state.generate.imageCount = clamp(state.generate.imageCount + delta, 0, PACK_LIMITS.image);
  if (type === 'video') state.generate.videoCount = clamp(state.generate.videoCount + delta, 0, PACK_LIMITS.video);
  if (state.generate.imageCount + state.generate.videoCount === 0) state.generate.imageCount = 1;
}

function currentCost() {
  return state.generate.imageCount * CREDIT_RULES.image + state.generate.videoCount * CREDIT_RULES.video;
}

function defaultPackCost() {
  return packCost(defaultPackMix());
}

function defaultPackMix() {
  return state.launchPackMode ? LAUNCH_PACK_MIX : DEFAULT_PACK_MIX;
}

function packCost(mix) {
  return (mix.image * CREDIT_RULES.image) + (mix.video * CREDIT_RULES.video);
}

function packMixLabel(mix) {
  const image = Number(mix.image) || 0;
  const ugc = Number(mix.ugc ?? mix.video) || 0;
  return `${image} image ad${image === 1 ? '' : 's'} + ${ugc} UGC ad${ugc === 1 ? '' : 's'}`;
}

async function commitGenerate(cost) {
  const app = activeApp();
  if (!app) return;
  const plan = app.activePackPlan;
  if (app.packPlanStatus !== 'proposed' || !plan?.planId) {
    toast('Build and review the Pack Plan before generating.');
    return;
  }
  syncGenerateMixFromPlan(plan);
  const count = state.generate.imageCount + state.generate.videoCount;
  const submit = $('#approvePackPlan') || $('#commitGenerate');
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Approving plan & authorizing credits...';
  }

  let packResult;
  try {
    packResult = await createPackGate(app);
  } catch (error) {
    if (submit) {
      submit.disabled = false;
      submit.textContent = `Approve plan & generate · ${plan.costCredits} credits`;
    }
    toast(error.message || 'Could not authorize this pack.');
    return;
  }

  const authorizedCost = packResult.pack.costCredits || cost;
  state.credits.balance = Number.isFinite(Number(packResult.creditBalance))
    ? Number(packResult.creditBalance)
    : state.credits.balance - authorizedCost;
  recordCreditTransaction(`${app.name} pack · ${count} ads`, -authorizedCost, packResult.pack.packId);

  state.runSeq += 1;
  const isLaunchPackRun = state.launchPackMode;
  mergeServerApp(app, packResult.app);
  const run = app.runs.find((candidate) => candidate.id === packResult.pack.packId || candidate.packId === packResult.pack.packId) || {
    id: packResult.pack.packId || `run-${String(state.runSeq).padStart(3, '0')}`,
    label: isLaunchPackRun ? 'Same-Day Launch Pack' : 'Generated pack',
    cost: authorizedCost,
    count,
    status: 'cooking',
    step: 0,
    when: 'Now',
    packId: packResult.pack.packId,
  };
  Object.assign(run, {
    label: isLaunchPackRun ? 'Same-Day Launch Pack' : 'Generated pack',
    cost: authorizedCost,
    count,
    status: 'cooking',
    step: 0,
    when: 'Now',
    packId: packResult.pack.packId,
  });
  if (isLaunchPackRun) state.launchPackMode = false;
  if (!app.runs.includes(run)) app.runs.unshift(run);
  app.packPlanStatus = 'accepted';
  closeGenerate();
  renderAll();
  startGenerationJob(app, run);
}

async function startGenerationJob(app, run) {
  try {
    const headers = { 'content-type': 'application/json', ...(await authHeaders()) };
    const response = await fetch('/api/jobs/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uid: state.session.uid || null,
        orgId: state.session.orgId,
        workspaceId: state.session.workspaceId,
        appId: app.appId || app.id,
        packId: run.packId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !payload.jobId) {
      throw new Error(payload.error || 'Could not start generation.');
    }
    run.jobId = payload.jobId;
    pollGenerationJob(app, run);
  } catch (error) {
    run.status = 'failed';
    run.error = error.message || 'Could not start the server generation job.';
    renderAll();
    toast('Generation did not start. No local/fake drafts were substituted.');
  }
}

async function pollGenerationJob(app, run) {
  if (run.status !== 'cooking') return;
  let job = null;
  try {
    const params = new URLSearchParams({
      jobId: run.jobId,
      orgId: state.session.orgId || '',
      workspaceId: state.session.workspaceId || 'ws-default',
      appId: app.appId || app.id,
      uid: state.session.uid || '',
    });
    const response = await fetch(`/api/jobs/state?${params}`, { headers: await authHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.ok) job = payload.job;
  } catch {
    // Transient polling errors should not kill the run.
  }
  if (job) {
    const percent = job.progress?.percent || 0;
    run.step = Math.min(GENERATION_STEPS.length - 1, Math.floor((percent / 100) * GENERATION_STEPS.length));
    if (['completed', 'completed_with_holds', 'failed'].includes(job.status)) {
      finishGenerationJob(app, run, job);
      return;
    }
    renderAll();
  }
  setTimeout(() => pollGenerationJob(app, run), 700);
}

function finishGenerationJob(app, run, job) {
  if (job.status === 'failed') {
    run.status = 'failed';
    renderAll();
    toast('Generation hit a problem. Your credits are safe — try again.');
    return;
  }
  run.status = 'ready';
  const drafts = job.drafts || [];
  if (drafts.length) {
    for (const draft of [...drafts].reverse()) {
      app.ads.unshift({
        id: draft.draftId,
        appId: app.id,
        format: draft.format === 'image_ad' ? 'image' : 'ugc',
        caption: draft.caption,
        angle: draft.angleId || 'clarity',
        screenId: draft.screenId || 'screen-log',
        status: draft.status === 'ready_for_review' ? 'ready' : 'held',
        packId: run.packId,
        jobId: job.jobId,
      });
    }
    run.count = drafts.length;
  } else {
    run.status = 'failed';
    run.error = 'The server job completed without persisted review drafts.';
    renderAll();
    toast('Generation completed without reviewable drafts. No fake drafts were substituted.');
    return;
  }
  state.activeTab = 'understanding';
  renderAll();
  toast(`${run.count} ads ready for review.`);
}

async function createPackGate(app) {
  const headers = {
    'content-type': 'application/json',
    ...(await authHeaders()),
  };
  const packPlanId = app.activePackPlanId || app.activePackPlan?.planId;
  if (!packPlanId) throw new Error('Build and review a Pack Plan before generating.');
  const response = await fetch('/api/packs/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      uid: state.session.uid || null,
      orgId: state.session.orgId,
      workspaceId: state.session.workspaceId,
      appId: app.appId || app.id,
      imageCount: state.generate.imageCount,
      videoCount: state.generate.videoCount,
      idempotencyKey: `pack-from-${packPlanId}`,
      packPlanId,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not authorize this pack.');
  }
  return payload;
}

function reviewedPlanPayload(app) {
  return {
    tagline: app.tagline,
    screens: (app.screens || []).map((screen) => ({
      id: screen.id,
      selected: isScreenSelected(screen),
      ignored: Boolean(screen.ignored),
    })),
    claims: (app.claims || []).map((claim) => ({
      id: claim.id,
      text: claim.text,
      selected: isClaimSelected(claim),
      ignored: Boolean(claim.ignored),
      supported: claim.supported !== false,
    })),
  };
}

function shorten(text, limit) {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function openUpsell({ reason = 'run' } = {}) {
  renderUpsell(reason);
  $('#upsellModal').hidden = false;
}

function closeUpsell() {
  $('#upsellModal').hidden = true;
}

function openHandoff() {
  renderHandoff();
  $('#handoffModal').hidden = false;
}

function closeHandoff() {
  $('#handoffModal').hidden = true;
}

function renderHandoff() {
  const app = activeApp();
  if (!app) return;
  ensureLearningState(app);
  const approvedAds = app.ads.filter((item) => item.status === 'approved');
  const approved = approvedAds.length;
  const total = app.ads.length;
  const held = approved === 0;
  const imageCount = approvedAds.filter((item) => item.format === 'image').length;
  const ugcCount = approvedAds.filter((item) => item.format === 'ugc').length;
  const checks = exportChecks(app, approvedAds);

  $('#handoffContent').innerHTML = `
    <div class="modal-head">
      <p class="eyebrow">Export</p>
      <h2 id="handoffTitle">Export ${escapeHtml(app.name)} approved ads</h2>
      <p>Only approved ads leave the workspace. Everything else stays in review.</p>
    </div>
    <section class="export-readiness ${held ? 'held' : ''}">
      <div class="export-readiness-head">
        <strong>${held ? 'Export on hold' : 'Ready to export'}</strong>
        <span>${approved} approved · ${total} total in this pack</span>
      </div>
      ${held
        ? '<p class="export-hold-note">Approve at least one ad before exporting.</p>'
        : `
          <div class="export-checklist">
            ${checks.map((check) => `
              <div class="export-check ${check.ok ? '' : 'warn'}">
                <span>${check.ok ? '✓' : '!'}</span>
                <p>${escapeHtml(check.label)}</p>
              </div>
            `).join('')}
          </div>
          <div class="manifest-preview">
            <p class="mono-label">Pack contents</p>
            <ul>
              ${imageCount ? `<li>${imageCount} image ad${imageCount === 1 ? '' : 's'} · sized for feed and story placements</li>` : ''}
              ${ugcCount ? `<li>${ugcCount} UGC ad${ugcCount === 1 ? '' : 's'} · 9:16 with captions</li>` : ''}
              <li>captions.csv · every approved caption with its angle</li>
              <li>review-notes.md · tweak notes and decisions from this pack</li>
              <li>manifest.json · pack summary for your records</li>
            </ul>
          </div>
        `}
    </section>
    <div class="handoff-options">
      <button class="handoff-option" type="button" data-handoff="zip" ${held ? 'disabled' : ''}>
        <strong>Download ad pack</strong>
        <span>Approved image ads, UGC ads, captions, and review notes.</span>
      </button>
      <button class="handoff-option" type="button" data-handoff="review" ${held ? 'disabled' : ''}>
        <strong>Copy review link</strong>
        <span>Send a lightweight approval page to a teammate or client.</span>
      </button>
      <button class="handoff-option" type="button" data-handoff="mcp">
        <strong>Point your agent to Mobile Ad Agent</strong>
        <span>Let another agent fetch the approved app info, packs, and next actions.</span>
        <code>maa.get_pack("${escapeHtml(app.id)}")</code>
      </button>
    </div>
    ${annualExportPanelHtml()}
  `;
  $('#handoffAnnualApply')?.addEventListener('click', () => applyLaunchAnnual('export'));
  $('#handoffContinueMonthly')?.addEventListener('click', continueMonthlyFromExport);
  $('#handoffContent').querySelectorAll('[data-handoff]').forEach((button) => {
    button.addEventListener('click', () => {
      const choice = button.dataset.handoff;
      if (choice === 'zip') {
        downloadPackManifest(app, approvedAds);
        toast('Pack summary downloaded. Media files are simulated in this demo.');
        return;
      }
      toast(choice === 'review' ? 'Review link copied in demo.' : 'Agent handoff copied in demo.');
    });
  });
}

function exportChecks(app, approvedAds) {
  const screens = selectedUsableScreens(app);
  const screenIds = new Set(screens.map((screen) => screen.id));
  return [
    {
      ok: approvedAds.every((item) => screenIds.has(item.screenId)),
      label: 'Every ad is made from a reviewed app screenshot.',
    },
    {
      ok: selectedClaims(app).length > 0,
      label: 'Captions only use the key features you approved.',
    },
    {
      ok: approvedAds.every((item) => item.caption.length <= 64),
      label: 'Caption lengths fit paid placements.',
    },
    {
      ok: true,
      label: 'No campaigns were created or changed. Export is files only.',
    },
  ];
}

function downloadPackManifest(app, approvedAds) {
  const manifest = {
    schema: 'mobile-ad-agent.pack-manifest.v1',
    generatedAt: new Date().toISOString(),
    workspace: state.session.authed
      ? { orgId: state.session.orgId, workspaceId: state.session.workspaceId }
      : null,
    app: {
      name: app.name,
      source: app.source,
      summary: app.tagline,
    },
    contents: {
      imageAds: approvedAds.filter((item) => item.format === 'image').length,
      ugcAds: approvedAds.filter((item) => item.format === 'ugc').length,
    },
    creatives: approvedAds.map((item) => ({
      id: item.id,
      format: item.format === 'ugc' ? 'ugc_ad' : 'image_ad',
      caption: item.caption,
      angle: angleLabel(app, item.angle),
      sourceScreenshot: app.screens.find((screen) => screen.id === item.screenId)?.label || 'Selected app screen',
      tweakNote: item.tweakNote || null,
    })),
    reviewDecisions: (app.reviewDecisions || []).length,
    learningEvents: (app.learningEvents || []).length,
    note: 'Export manifest for the approved pack.',
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${app.id}-pack-manifest.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---- Launch Annual upsell (local mock only; no real billing) ---- */

function localNow() {
  return Date.now() + state.clockOffsetDays * DAY_MS;
}

function startLaunchPackCredit() {
  const purchasedAt = localNow();
  state.launchPackCredit = {
    amount: LAUNCH_ANNUAL.launchPackCreditUsd,
    purchasedAt,
    expiresAt: purchasedAt + LAUNCH_ANNUAL.creditWindowDays * DAY_MS,
    status: 'available',
    appliedAt: null,
    reminderSent: false,
  };
  state.upsellTouchpoints = initialUpsellTouchpoints();
  recordMockEmail('receipt', `Receipt: Same-Day Launch Pack — $${LAUNCH_ANNUAL.launchPackCreditUsd}. PS: your full $${LAUNCH_ANNUAL.launchPackCreditUsd} applies to Launch Annual for the next ${LAUNCH_ANNUAL.creditWindowDays} days.`);
  recordUpsellTouchpoint('postCheckout');
}

function syncCreditLifecycle() {
  const credit = state.launchPackCredit;
  if (!credit) return;
  if (credit.status === 'available' && localNow() >= credit.expiresAt) {
    // Expiry is silent: the credit UI simply disappears; annual stays $990.
    credit.status = 'expired';
    return;
  }
  if (credit.status === 'available' && creditDaysLeft() <= 2 && !credit.reminderSent) {
    credit.reminderSent = true;
    recordMockEmail('expiry-reminder', `Reminder: your $${credit.amount} Launch Pack credit toward Launch Annual expires in about 48 hours. After that, Launch Annual is $${LAUNCH_ANNUAL.annualPriceUsd}/year.`);
  }
}

function launchPackCreditAvailable() {
  syncCreditLifecycle();
  return state.launchPackCredit?.status === 'available' && state.billing.interval !== 'annual';
}

function creditDaysLeft() {
  if (!state.launchPackCredit) return 0;
  return Math.max(0, Math.ceil((state.launchPackCredit.expiresAt - localNow()) / DAY_MS));
}

function formatDay(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function addCalendarYears(timestamp, years) {
  const date = new Date(timestamp);
  date.setFullYear(date.getFullYear() + years);
  return date.getTime();
}

function recordUpsellTouchpoint(key) {
  if (!state.upsellTouchpoints[key]) {
    state.upsellTouchpoints[key] = { shownAt: localNow(), day: state.clockOffsetDays };
  }
}

function recordMockEmail(kind, text) {
  state.upsellTouchpoints.emails.unshift({
    id: `email-${state.upsellTouchpoints.emails.length + 1}`,
    kind,
    text,
    when: `Day ${state.clockOffsetDays}`,
  });
}

function dismissUpsellTouchpoint(key) {
  state.upsellTouchpoints.dismissed[key] = true;
  renderAll();
}

function advanceClock(days) {
  state.clockOffsetDays = Math.max(0, state.clockOffsetDays + days);
  renderAll();
  toast(`Prototype clock: day ${state.clockOffsetDays}.`);
}

function applyLaunchAnnual(source) {
  syncCreditLifecycle();
  const credit = state.launchPackCredit;
  const creditApplied = credit?.status === 'available';
  const nowTs = localNow();
  if (creditApplied) {
    credit.status = 'applied';
    credit.appliedAt = nowTs;
  }
  state.billing = {
    interval: 'annual',
    renewsAt: addCalendarYears(nowTs, 1),
    priceLockUntil: addCalendarYears(nowTs, 2),
  };
  state.annualEntitlements = {
    winnersVault: true,
    priceLock: { until: state.billing.priceLockUntil },
    quarterlyAudit: { nextDueAt: nowTs + 91 * DAY_MS },
  };
  const launchPlan = PLAN_OPTIONS.find((plan) => plan.name === LAUNCH_ANNUAL.planName) || PLAN_OPTIONS[0];
  const wasPackOnly = state.credits.plan === 'Launch Pack' || state.credits.plan === 'No plan yet';
  state.credits.plan = launchPlan.name;
  state.credits.monthly = launchPlan.monthly;
  state.credits.reset = 'in 30 days';
  if (wasPackOnly) state.credits.balance += launchPlan.monthly;
  recordCreditTransaction(
    creditApplied
      ? `Launch Annual started · $${credit.amount} Launch Pack credit applied ($${LAUNCH_ANNUAL.netFirstYearToday} today)`
      : `Launch Annual started · $${LAUNCH_ANNUAL.annualPriceUsd}/year`,
    wasPackOnly ? launchPlan.monthly : 0
  );
  recordUpsellTouchpoint(source === 'export' ? 'postExport' : source);
  closeAnnualSheet();
  renderAll();
  if (!$('#handoffModal').hidden) renderHandoff();
  toast(creditApplied
    ? `Launch Annual active — $${LAUNCH_ANNUAL.netFirstYearToday} today with your $${credit.amount} credit applied.`
    : `Launch Annual active — $${LAUNCH_ANNUAL.annualPriceUsd}/year.`);
}

function continueMonthlyFromExport() {
  state.upsellTouchpoints.dismissed.postExport = true;
  const launchPlan = PLAN_OPTIONS.find((plan) => plan.name === LAUNCH_ANNUAL.planName) || PLAN_OPTIONS[0];
  const wasPackOnly = state.credits.plan === 'Launch Pack' || state.credits.plan === 'No plan yet';
  if (wasPackOnly) {
    state.credits.plan = launchPlan.name;
    state.credits.monthly = launchPlan.monthly;
    state.credits.reset = 'in 30 days';
    state.credits.balance += launchPlan.monthly;
    state.billing = { interval: 'monthly', renewsAt: localNow() + 30 * DAY_MS, priceLockUntil: null };
    recordCreditTransaction('Launch plan (monthly) started', launchPlan.monthly);
    toast('Launch plan active at $99/mo. You can switch to annual any time in Billing.');
  } else {
    toast('Sticking with monthly. Launch Annual stays available in Billing.');
  }
  renderAll();
  if (!$('#handoffModal').hidden) renderHandoff();
}

function openAnnualSheet(source = 'billing') {
  renderAnnualSheet(source);
  $('#annualModal').hidden = false;
}

function closeAnnualSheet() {
  $('#annualModal').hidden = true;
}

function renderAnnualSheet(source = 'billing') {
  const creditAvailable = launchPackCreditAvailable();
  const daysLeft = creditDaysLeft();
  $('#annualContent').innerHTML = `
    <div class="modal-head">
      <p class="eyebrow">Launch Annual</p>
      <h2 id="annualTitle">A year of creative testing, two months free.</h2>
      <p>Everything in the Launch plan, billed once a year.</p>
    </div>
    <div class="annual-price-math" aria-label="Launch Annual price math">
      <div class="price-step">
        <span>12 months of Launch</span>
        <strong>$${LAUNCH_ANNUAL.monthlyEquivalentUsd.toLocaleString()}</strong>
        <small>$99/mo billed monthly</small>
      </div>
      <span class="price-arrow" aria-hidden="true">→</span>
      <div class="price-step ${creditAvailable ? '' : 'highlight'}">
        <span>Launch Annual</span>
        <strong>$${LAUNCH_ANNUAL.annualPriceUsd}/yr</strong>
        <small>2 months free</small>
      </div>
      ${creditAvailable ? `
        <span class="price-arrow" aria-hidden="true">→</span>
        <div class="price-step highlight">
          <span>Today with your credit</span>
          <strong>$${LAUNCH_ANNUAL.netFirstYearToday}</strong>
          <small>full $${LAUNCH_ANNUAL.launchPackCreditUsd} Launch Pack payment applied</small>
        </div>
      ` : ''}
    </div>
    ${creditAvailable ? `<p class="annual-credit-note">Your $${LAUNCH_ANNUAL.launchPackCreditUsd} applies for ${daysLeft} more day${daysLeft === 1 ? '' : 's'} (until ${escapeHtml(formatDay(state.launchPackCredit.expiresAt))}). After that, Launch Annual is $${LAUNCH_ANNUAL.annualPriceUsd}/year.</p>` : ''}
    <div class="annual-bonuses">
      <p class="mono-label">Annual-only extras</p>
      ${LAUNCH_ANNUAL.bonuses.map((bonus) => `
        <div class="claim-row">
          <span class="claim-check">✓</span>
          <div><p><strong>${escapeHtml(bonus.label)}.</strong> ${escapeHtml(bonus.detail)}</p></div>
        </div>
      `).join('')}
    </div>
    <div class="modal-actions annual-actions">
      <button class="ghost-button" type="button" id="annualNotNow">Not now</button>
      <button class="primary-button" type="button" id="annualApply">${creditAvailable ? `Apply my $${LAUNCH_ANNUAL.launchPackCreditUsd} — $${LAUNCH_ANNUAL.netFirstYearToday} today` : `Start Launch Annual — $${LAUNCH_ANNUAL.annualPriceUsd}/year`}</button>
    </div>
    <small class="checkout-note">Then $${LAUNCH_ANNUAL.annualPriceUsd}/year. You can cancel before the next renewal.</small>
  `;
  $('#annualNotNow').addEventListener('click', closeAnnualSheet);
  $('#annualApply').addEventListener('click', () => applyLaunchAnnual(source));
}

function renderUpsellTouch(app, stage) {
  const host = $('#upsellTouch');
  if (!host) return;
  const showT1 = state.session.authed
    && state.upsellTouchpoints.postCheckout
    && !state.upsellTouchpoints.dismissed.postCheckout
    && launchPackCreditAvailable()
    && (!app || !app.ads.length)
    && stage !== 'extracting';
  if (!showT1) {
    host.innerHTML = '';
    return;
  }
  const daysLeft = creditDaysLeft();
  host.innerHTML = `
    <section class="panel post-checkout-card">
      <div class="post-checkout-main">
        <span class="claim-check" aria-hidden="true">✓</span>
        <div>
          <strong>Your Same-Day Launch Pack is started.</strong>
          <p>Review the app info below, then generate your 24 image ads + 4 UGC ads.</p>
        </div>
      </div>
      <div class="annual-soft-card">
        <div>
          <span class="mono-label">If you already know you'll keep testing</span>
          <strong>Launch Annual — $${LAUNCH_ANNUAL.annualPriceUsd}/year (2 months free)</strong>
          <p>Your full $${LAUNCH_ANNUAL.launchPackCreditUsd} Launch Pack payment applies for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}.</p>
        </div>
        <div class="annual-soft-actions">
          <button class="primary-button" type="button" id="seeLaunchAnnual">See Launch Annual</button>
          <button class="text-button" type="button" id="annualMaybeLater">Maybe later</button>
        </div>
      </div>
    </section>
  `;
  $('#seeLaunchAnnual').addEventListener('click', () => openAnnualSheet('postCheckout'));
  $('#annualMaybeLater').addEventListener('click', () => dismissUpsellTouchpoint('postCheckout'));
}

function renderAnnualBanner(app) {
  const host = $('#annualBanner');
  if (!host) return;
  const packReady = app.runs.some((run) => ['ready', 'exported'].includes(run.status));
  const show = launchPackCreditAvailable()
    && packReady
    && app.ads.length > 0
    && !state.upsellTouchpoints.dismissed.draftsReady;
  if (!show) {
    host.innerHTML = '';
    return;
  }
  if (!state.upsellTouchpoints.draftsReady) {
    recordUpsellTouchpoint('draftsReady');
    recordMockEmail('drafts-ready', `Your drafts are ready to review. PS: your $${LAUNCH_ANNUAL.launchPackCreditUsd} still applies to Launch Annual for ${creditDaysLeft()} more days.`);
  }
  const daysLeft = creditDaysLeft();
  host.innerHTML = `
    <div class="annual-banner" role="note">
      <span>Your $${LAUNCH_ANNUAL.launchPackCreditUsd} still applies to Launch Annual — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.</span>
      <div class="annual-banner-actions">
        <button class="small-action" type="button" id="annualBannerApply">Apply my $${LAUNCH_ANNUAL.launchPackCreditUsd}</button>
        <button class="banner-dismiss" type="button" id="annualBannerDismiss" aria-label="Dismiss Launch Annual reminder">×</button>
      </div>
    </div>
  `;
  $('#annualBannerApply').addEventListener('click', () => openAnnualSheet('draftsReady'));
  $('#annualBannerDismiss').addEventListener('click', () => dismissUpsellTouchpoint('draftsReady'));
}

function annualExportPanelHtml() {
  if (!launchPackCreditAvailable() || state.upsellTouchpoints.dismissed.postExport) return '';
  recordUpsellTouchpoint('postExport');
  const daysLeft = creditDaysLeft();
  return `
    <section class="annual-export-panel">
      <div>
        <p class="mono-label">Keep the testing loop going</p>
        <strong>Apply your $${LAUNCH_ANNUAL.launchPackCreditUsd} to Launch Annual.</strong>
        <p>$${LAUNCH_ANNUAL.monthlyEquivalentUsd.toLocaleString()} monthly equivalent → $${LAUNCH_ANNUAL.annualPriceUsd}/year → $${LAUNCH_ANNUAL.netFirstYearToday} today with your Launch Pack credit (${daysLeft} day${daysLeft === 1 ? '' : 's'} left). Includes Winners Vault, a 2-year price lock, and a quarterly Ad Performance Audit.</p>
      </div>
      <div class="annual-export-actions">
        <button class="primary-button" type="button" id="handoffAnnualApply">Apply $${LAUNCH_ANNUAL.launchPackCreditUsd} → $${LAUNCH_ANNUAL.netFirstYearToday} today</button>
        <button class="ghost-button" type="button" id="handoffContinueMonthly">Continue monthly at $99/mo</button>
      </div>
    </section>
  `;
}

function annualBillingCardHtml() {
  if (state.billing.interval === 'annual' && state.annualEntitlements) {
    return `
      <div class="annual-billing-card active">
        <div>
          <p class="mono-label">Your plan</p>
          <h3>Launch Annual active</h3>
          <p>$${LAUNCH_ANNUAL.annualPriceUsd}/year · renews ${escapeHtml(formatDay(state.billing.renewsAt))}</p>
        </div>
        <div class="entitlement-list">
          <div class="claim-row"><span class="claim-check">✓</span><div><p>Winners Vault active</p></div></div>
          <div class="claim-row"><span class="claim-check">✓</span><div><p>Price locked at $${LAUNCH_ANNUAL.annualPriceUsd}/year until ${escapeHtml(formatDay(state.annualEntitlements.priceLock.until))}</p></div></div>
          <div class="claim-row"><span class="claim-check">✓</span><div><p>Next Ad Performance Audit around ${escapeHtml(formatDay(state.annualEntitlements.quarterlyAudit.nextDueAt))}</p></div></div>
        </div>
      </div>
    `;
  }
  const creditAvailable = launchPackCreditAvailable();
  const daysLeft = creditDaysLeft();
  return `
    <div class="annual-billing-card">
      <div>
        <p class="mono-label">Annual billing</p>
        <h3>Launch Annual — $${LAUNCH_ANNUAL.annualPriceUsd}/year</h3>
        <p>2 months free vs $${LAUNCH_ANNUAL.monthlyEquivalentUsd.toLocaleString()} on monthly. Includes Winners Vault, a 2-year price lock, and a quarterly async Ad Performance Audit with a next-10-tests roadmap.</p>
        ${creditAvailable ? `<p class="credit-line">Credit available: $${LAUNCH_ANNUAL.launchPackCreditUsd} toward annual · expires ${escapeHtml(formatDay(state.launchPackCredit.expiresAt))} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)</p>` : ''}
      </div>
      <button class="primary-button" type="button" id="billingSeeAnnual">${creditAvailable ? `Apply my $${LAUNCH_ANNUAL.launchPackCreditUsd} — $${LAUNCH_ANNUAL.netFirstYearToday} today` : 'See Launch Annual'}</button>
    </div>
  `;
}

function mockEmailsHtml() {
  const emails = state.upsellTouchpoints.emails;
  if (!DEV_MODE || !emails.length) return '';
  return `
    <div class="email-touchpoints">
      <p class="mono-label">Dev email touchpoints</p>
      ${emails.slice(0, 4).map((email) => `
        <div class="email-row">
          <span>${escapeHtml(email.when)}</span>
          <p>${escapeHtml(email.text)}</p>
        </div>
      `).join('')}
    </div>
  `;
}

function renderUpsell(reason) {
  const cost = currentCost();
  const nudgeUpgrade = state.credits.topUpCount >= 2 && state.credits.plan !== 'Studio';
  $('#upsellContent').innerHTML = `
    <div class="modal-head">
      <p class="eyebrow">Credits</p>
      <h2 id="upsellTitle">${reason === 'run' ? 'Not enough credits for this run' : 'Choose how to keep generating'}</h2>
      <p>This run needs ${cost} credits, and you have ${state.credits.balance}. You can upgrade, top up, or trim the run before generating.</p>
    </div>
    ${nudgeUpgrade ? `
      <p class="upsell-nudge">You have topped up ${state.credits.topUpCount} times this cycle. Upgrading to ${state.credits.plan === 'Launch' ? 'Scale' : 'Studio'} is usually cheaper at this volume.</p>
    ` : ''}
    <div class="upsell-options">
      <button class="upsell-option" type="button" data-upsell="upgrade">
        <strong>Upgrade plan</strong>
        <span>More monthly credits every cycle. Best value for weekly testing.</span>
      </button>
      ${TOPUP_OPTIONS.map((pack) => `
        <button class="upsell-option" type="button" data-topup="${pack.id}">
          <strong>Top up · ${pack.price} for ${pack.credits.toLocaleString()} credits</strong>
          <span>Subscriber-only. Top-up credits never expire.</span>
        </button>
      `).join('')}
      <button class="upsell-option" type="button" data-upsell="trim">
        <strong>Trim & run</strong>
        <span>Reduce the batch to fit your current balance.</span>
      </button>
    </div>
  `;
  $$('#upsellContent [data-upsell]').forEach((button) => {
    button.addEventListener('click', () => handleUpsell(button.dataset.upsell));
  });
  $$('#upsellContent [data-topup]').forEach((button) => {
    button.addEventListener('click', () => purchaseTopUp(button.dataset.topup));
  });
}

function handleUpsell(choice) {
  if (choice === 'upgrade') {
    closeUpsell();
    closeGenerate();
    setRoute('credits');
    toast('Showing plan options.');
  }
  if (choice === 'trim') {
    trimToCredits();
    closeUpsell();
    renderGenerate();
    toast(currentCost() <= state.credits.balance ? 'Run trimmed to fit your credits.' : 'Add credits to generate this run.');
  }
}

function purchaseTopUp(topUpId) {
  const pack = TOPUP_OPTIONS.find((candidate) => candidate.id === topUpId);
  if (!pack) return;
  state.credits.balance += pack.credits;
  state.credits.topUpCount += 1;
  recordCreditTransaction(`Top-up · ${pack.price}`, pack.credits);
  closeUpsell();
  if (!$('#generateModal').hidden) renderGenerate();
  renderCreditMeter();
  if (state.route === 'credits') renderCredits();
  toast(state.credits.topUpCount >= 2
    ? `${pack.credits.toLocaleString()} credits added. Upgrading may be cheaper at this pace.`
    : `${pack.credits.toLocaleString()} credits added in this local demo.`);
}

function recordCreditTransaction(label, delta, id = null) {
  const txnId = id || `txn-${Date.now()}-${state.credits.ledger.length}`;
  if (state.credits.ledger.some((txn) => txn.id === txnId)) return;
  state.credits.ledger.unshift({
    id: txnId,
    label,
    delta,
    when: 'Today',
  });
}

function trimToCredits() {
  let remaining = state.credits.balance;
  const videos = Math.min(state.generate.videoCount, Math.floor(remaining / CREDIT_RULES.video));
  remaining -= videos * CREDIT_RULES.video;
  const images = Math.min(state.generate.imageCount, Math.floor(remaining / CREDIT_RULES.image));
  state.generate.videoCount = videos;
  state.generate.imageCount = Math.max(1, images);
}

function renderCredits() {
  if (!state.session.authed) return;
  const pct = Math.round((state.credits.balance / Math.max(1, state.credits.monthly)) * 100);
  const creditCycleLabel = state.credits.plan === 'Launch Pack'
    ? `${state.credits.monthly} Launch Pack credits · one-time pack`
    : `${state.credits.monthly} monthly credits · resets ${state.credits.reset}`;
  $('#creditsHero').innerHTML = `
    <div class="credit-balance">
      <div>
        <span class="mono-label">Current balance</span>
        <strong>${state.credits.balance}</strong>
        <small>${creditCycleLabel}</small>
      </div>
      <div class="big-meter"><span style="width:${Math.min(100, pct)}%"></span></div>
    </div>
    <div class="credit-rules">
      <div><strong>${CREDIT_RULES.image}</strong><span>credits per image ad</span></div>
      <div><strong>${CREDIT_RULES.video}</strong><span>credits per UGC ad</span></div>
      <div><strong>plan</strong><span>app setup, screenshot extraction, quality checks, and review included</span></div>
    </div>
    ${annualBillingCardHtml()}
  `;
  $('#billingSeeAnnual')?.addEventListener('click', () => openAnnualSheet('billing'));

  $('#planGrid').innerHTML = PLAN_OPTIONS.map((plan) => `
    <article class="plan-card ${plan.name === state.credits.plan ? 'current' : ''} ${plan.featured ? 'featured' : ''}">
      <span class="mono-label">${escapeHtml(plan.name)}${plan.featured ? ' · most popular' : ''}</span>
      <h3>${escapeHtml(plan.price)}</h3>
      <strong>${escapeHtml(plan.credits)}</strong>
      <p>${escapeHtml(plan.desc)}</p>
      <button class="${plan.name === state.credits.plan ? 'ghost-button' : 'primary-button'}" type="button" data-plan="${plan.name}">${escapeHtml(plan.name === state.credits.plan ? 'Current plan' : plan.cta)}</button>
    </article>
  `).join('');
  $('#planGrid').querySelectorAll('[data-plan]').forEach((button) => {
    button.addEventListener('click', () => {
      const plan = PLAN_OPTIONS.find((candidate) => candidate.name === button.dataset.plan) || PLAN_OPTIONS[0];
      if (plan.name === state.credits.plan) return;
      const previous = PLAN_OPTIONS.find((candidate) => candidate.name === state.credits.plan);
      const gained = Math.max(0, plan.monthly - (previous?.monthly || 0));
      state.credits.plan = plan.name;
      state.credits.monthly = plan.monthly;
      // Switching plans in the prototype always lands on monthly billing.
      state.billing = { interval: 'monthly', renewsAt: localNow() + 30 * DAY_MS, priceLockUntil: null };
      state.annualEntitlements = null;
      if (gained) {
        state.credits.balance += gained;
        recordCreditTransaction(`Upgraded to ${plan.name}`, gained);
      } else {
        recordCreditTransaction(`Plan changed to ${plan.name}`, 0);
      }
      renderAll();
      toast(`${plan.name} selected in this local demo.`);
    });
  });

  $('#upsellDemo').innerHTML = `
    <div class="billing-columns">
      <div>
        <p class="mono-label">Top-ups</p>
        <h3>Need more before the reset?</h3>
        <p>Top-ups are for active subscribers and never expire. Plan credits spend first.</p>
        <div class="topup-row">
          ${TOPUP_OPTIONS.map((pack) => `
            <button class="ghost-button" type="button" data-topup="${pack.id}">${pack.price} · ${pack.credits.toLocaleString()} credits</button>
          `).join('')}
        </div>
      </div>
      <div>
        <p class="mono-label">Recent activity</p>
        <h3>Credit ledger</h3>
        <div class="ledger-list">
          ${state.credits.ledger.slice(0, 6).map((txn) => `
            <div class="ledger-row">
              <span>${escapeHtml(txn.label)}</span>
              <strong class="${txn.delta >= 0 ? 'gain' : ''}">${txn.delta >= 0 ? '+' : ''}${txn.delta}</strong>
              <small>${escapeHtml(txn.when)}</small>
            </div>
          `).join('')}
        </div>
        ${mockEmailsHtml()}
      </div>
    </div>
  `;
  $('#upsellDemo').querySelectorAll('[data-topup]').forEach((button) => {
    button.addEventListener('click', () => purchaseTopUp(button.dataset.topup));
  });
}

async function startPreview(rawUrl) {
  if (!rawUrl) return;
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    toast('Paste a valid App Store or Google Play URL.');
    return;
  }
  const url = parsed.href;
  const importSeq = state.importSeq + 1;
  state.importSeq = importSeq;
  state.preview = { status: 'loading', url, data: null };
  state.building = {
    name: deriveName(parsed),
    headline: `Previewing ${deriveName(parsed)}`,
    url,
    step: 0,
    detail: 'Reading the public listing...',
    steps: PREVIEW_STEPS,
  };
  const startedAt = Date.now();
  $('#importUrl').value = '';
  renderAll();

  const timer = setInterval(() => {
    if (!state.building || state.importSeq !== importSeq) {
      clearInterval(timer);
      return;
    }
    state.building.step = Math.min(PREVIEW_STEPS.length - 2, state.building.step + 1);
    renderBuildStrip();
  }, EXTRACTION_STEP_MS);

  try {
    const response = await fetch('/api/previews/from-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Could not preview that URL.');
    }
    if (state.importSeq !== importSeq) return;
    const elapsed = Date.now() - startedAt;
    await wait(Math.max(0, MIN_EXTRACTION_MS - elapsed));
    if (state.importSeq !== importSeq) return;
    clearInterval(timer);
    state.building = null;
    state.preview = { status: 'ready', url, data: payload.preview };
    try {
      localStorage.setItem(PREVIEW_SESSION_KEY, JSON.stringify({ id: payload.preview.previewSession.id }));
    } catch { /* storage unavailable; preview still works for this visit */ }
    renderAll();
    toast(`${payload.preview.app.name} preview ready. Check it, then save it at checkout.`);
  } catch (error) {
    if (state.importSeq !== importSeq) return;
    clearInterval(timer);
    state.building = null;
    state.preview = { status: 'idle', url: '', data: null };
    renderAll();
    toast(error.message || 'Could not preview that URL.');
  }
}

async function tryRestorePreview() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(PREVIEW_SESSION_KEY) || 'null');
  } catch { /* ignore bad storage */ }
  if (!stored?.id) return;
  try {
    const response = await fetch(`/api/previews/session?id=${encodeURIComponent(stored.id)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || payload.claimed) throw new Error('expired');
    if (state.session.authed || state.preview.status !== 'idle') return;
    state.preview = { status: 'ready', url: payload.preview.app.storeUrl || '', data: payload.preview };
    renderAll();
    toast('Welcome back — your saved preview is ready.');
  } catch {
    try { localStorage.removeItem(PREVIEW_SESSION_KEY); } catch { /* ignore */ }
  }
}

async function restorePersistedApps() {
  if (!state.session.uid || !state.session.orgId || !state.session.workspaceId) return;
  try {
    const params = new URLSearchParams({
      uid: state.session.uid,
      orgId: state.session.orgId,
      workspaceId: state.session.workspaceId,
    });
    const headers = await authHeaders();
    const response = await fetch(`/api/apps?${params.toString()}`, { headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not restore saved apps.');
    if (Array.isArray(payload.apps) && payload.apps.length) {
      state.apps = payload.apps;
      state.activeAppId = payload.apps[0].id;
      state.activeTab = 'understanding';
      state.infoOpen = false;
      renderAll();
    }
  } catch {
    clearStoredAuthSession();
  }
}

function readStoredAuthSession() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    if (!session?.uid || !session?.email || !session?.orgId || !session?.workspaceId) return null;
    return {
      uid: session.uid,
      email: session.email,
      orgId: session.orgId,
      workspaceId: session.workspaceId,
    };
  } catch {
    return null;
  }
}

function saveAuthSession(session) {
  if (!session?.uid || !session?.email || !session?.orgId || !session?.workspaceId) return;
  try {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      uid: session.uid,
      email: session.email,
      orgId: session.orgId,
      workspaceId: session.workspaceId,
    }));
  } catch { /* storage unavailable; current visit still works */ }
}

function clearStoredAuthSession() {
  try { localStorage.removeItem(AUTH_SESSION_KEY); } catch { /* ignore */ }
}

function openCheckout(productId) {
  state.checkoutProductId = CHECKOUT_PRODUCTS.some((product) => product.id === productId) ? productId : 'launch_pack';
  state.checkoutStep = checkoutNeedsAccount() ? 'account' : 'offer';
  renderCheckout();
  $('#checkoutModal').hidden = false;
  requestAnimationFrame(() => {
    const target = $('#checkoutEmail') || $('#checkoutSubmit');
    target?.focus();
  });
}

function closeCheckout() {
  $('#checkoutModal').hidden = true;
}

function renderCheckout() {
  if (state.checkoutStep === 'account' && checkoutNeedsAccount()) {
    renderCheckoutAccount();
    return;
  }
  state.checkoutStep = 'offer';
  renderCheckoutOffer();
}

function checkoutNeedsAccount() {
  return !state.session.authed || (authRuntime.authRequired && !authRuntime.auth?.currentUser);
}

function renderCheckoutAccount() {
  const appName = state.preview.data?.app?.name || 'your app';
  $('#checkoutContent').innerHTML = `
    <div class="modal-head">
      <p class="eyebrow">Account</p>
      <h2 id="checkoutTitle">Create an account to continue</h2>
      <p>This keeps the ${escapeHtml(appName)} preview connected to your workspace. Checkout appears next; no ads generate and no credits are used until payment is confirmed.</p>
    </div>
    <div class="checkout-selected-offer">
      <span class="checkout-product-name">Your app preview is ready</span>
      <p>The next screen shows checkout for the launch pack.</p>
      <ul>
        <li>App summary, key features, and screenshots stay attached</li>
        <li>You can edit the app info before generation</li>
        <li>Ads generate only after checkout</li>
      </ul>
    </div>
    <form class="checkout-form" id="checkoutForm">
      <label for="checkoutEmail">Email — this becomes your sign-in</label>
      <input id="checkoutEmail" type="email" required placeholder="you@company.com" autocomplete="email" value="${escapeHtml(state.checkoutEmail || '')}">
      <label for="checkoutPassword">Password</label>
      <input id="checkoutPassword" type="password" required minlength="6" autocomplete="new-password">
      <button class="primary-button" type="submit" id="checkoutSubmit">Continue to checkout</button>
      <small class="checkout-note">No payment yet. Checkout appears after your account is created.</small>
    </form>
  `;
  $('#checkoutForm').addEventListener('submit', (event) => {
    event.preventDefault();
    continueCheckoutAfterAccount($('#checkoutEmail').value.trim(), $('#checkoutPassword')?.value || '');
  });
}

function renderCheckoutOffer() {
  const selected = CHECKOUT_PRODUCTS.find((product) => product.id === state.checkoutProductId) || CHECKOUT_PRODUCTS[0];
  const appName = state.preview.data?.app?.name || 'your app';
  const selectedIsPack = selected.id === 'launch_pack';
  const checkoutEmail = state.session.email || state.checkoutEmail;
  const alternateProducts = selectedIsPack
    ? CHECKOUT_PRODUCTS.filter((product) => product.id !== 'launch_pack')
    : CHECKOUT_PRODUCTS.filter((product) => product.id === 'launch_pack');
  $('#checkoutContent').innerHTML = `
    <div class="modal-head">
      <p class="eyebrow">Checkout</p>
      <h2 id="checkoutTitle">${selectedIsPack ? `Start the ${escapeHtml(appName)} Launch Pack` : `Start ${escapeHtml(selected.name)} for ${escapeHtml(appName)}`}</h2>
      <p>${selectedIsPack ? 'Checkout saves the app preview, creates your workspace, and starts the first paid launch sprint.' : 'Checkout saves the app preview and starts the ongoing creative testing loop.'}</p>
    </div>
    <div class="checkout-selected-offer">
      <span class="checkout-product-name">${escapeHtml(selected.name)}</span>
      <span class="checkout-product-price">${escapeHtml(selected.price)}</span>
      <p>${escapeHtml(selected.detail)}</p>
      ${selectedIsPack ? `
        <ul>
          <li>Uses the app summary, features, and screenshots you just previewed</li>
          <li>One revision round included</li>
          <li>Credit the full $249 toward an annual plan if you upgrade within 7 days</li>
        </ul>
      ` : `
        <ul>
          <li>Fresh creative batches and winner iteration every month</li>
          <li>App profile saved so each new pack starts faster</li>
          <li>Subscriber top-ups available for heavier testing months</li>
        </ul>
      `}
    </div>
    <div class="checkout-switcher">
      <span>${selectedIsPack ? 'Need ongoing creatives instead?' : 'Want the one-time starter pack instead?'}</span>
      <div>
        ${alternateProducts.map((product) => `
          <button class="text-button" type="button" data-product="${product.id}">${escapeHtml(product.name)} · ${escapeHtml(product.price)}</button>
        `).join('')}
      </div>
    </div>
    <form class="checkout-form" id="checkoutForm">
      <label for="checkoutEmail">Signed in as</label>
      <input id="checkoutEmail" type="email" required placeholder="you@company.com" autocomplete="email" value="${escapeHtml(checkoutEmail || '')}" ${checkoutEmail ? 'readonly' : ''}>
      <button class="primary-button" type="submit" id="checkoutSubmit">${selectedIsPack ? 'Start Same-Day Launch Pack' : `Start ${escapeHtml(selected.name)}`}</button>
      <small class="checkout-note">${selectedIsPack ? 'Delivery guarantee: if your app link and screenshots are usable, you get a usable pack on time or we rerun/credit the affected assets.' : 'Your plan saves this app profile and unlocks ongoing paid generation after checkout.'}</small>
    </form>
  `;
  $$('#checkoutContent [data-product]').forEach((button) => {
    button.addEventListener('click', () => {
      state.checkoutProductId = button.dataset.product;
      const email = $('#checkoutEmail').value || state.checkoutEmail;
      state.checkoutEmail = email;
      renderCheckout();
      $('#checkoutEmail').value = email;
    });
  });
  $('#checkoutForm').addEventListener('submit', (event) => {
    event.preventDefault();
    claimPreview(state.checkoutProductId, $('#checkoutEmail').value.trim(), '');
  });
}

async function continueCheckoutAfterAccount(email, password = '') {
  const submit = $('#checkoutSubmit');
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Creating account...';
  }
  try {
    await ensureSignedInForCheckout(email, password);
    state.checkoutEmail = String(email || '').trim().toLowerCase();
    state.checkoutStep = 'offer';
    renderCheckout();
  } catch (error) {
    renderCheckoutAccount();
    $('#checkoutEmail').value = email;
    if ($('#checkoutPassword')) $('#checkoutPassword').value = password;
    toast(readableAuthError(error) || 'Could not create the account. Try again.');
  }
}

async function claimPreview(productId, email, password = '') {
  const previewSessionId = state.preview.data?.previewSession?.id;
  if (!previewSessionId) {
    toast('Preview expired. Paste the app URL again.');
    closeCheckout();
    return;
  }
  const submit = $('#checkoutSubmit');
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Creating your workspace...';
  }
  try {
    await ensureSignedInForCheckout(email, password);
    const headers = {
      'content-type': 'application/json',
      ...(await authHeaders()),
    };
    const response = await fetch('/api/previews/claim', {
      method: 'POST',
      headers,
      body: JSON.stringify({ previewSessionId, email, productId, uid: state.session.uid || null }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Checkout failed. Try again.');
    }
    applyClaim(payload);
  } catch (error) {
    if (submit) {
      submit.disabled = false;
      renderCheckout();
      $('#checkoutEmail').value = email;
      if ($('#checkoutPassword')) $('#checkoutPassword').value = password;
    }
    toast(readableAuthError(error) || 'Checkout failed. Try again.');
  }
}

function applyClaim({ session, claim, extraction, app, apps }) {
  const claimedSession = session || {
    uid: claim.uid || `user-${claim.orgId}`,
    email: claim.email,
    orgId: claim.orgId,
    workspaceId: claim.workspaceId,
  };
  state.session = {
    authed: true,
    uid: claimedSession.uid,
    email: claimedSession.email,
    orgId: claimedSession.orgId,
    workspaceId: claimedSession.workspaceId,
  };
  saveAuthSession(state.session);
  state.launchIntent = false;
  state.launchPackMode = claim.product.type === 'launch_pack';
  state.credits = creditsFromClaim(claim);
  state.billing = initialBilling();
  state.annualEntitlements = null;
  if (claim.product.type === 'launch_pack') startLaunchPackCredit();
  else state.upsellTouchpoints = initialUpsellTouchpoints();
  state.preview = { status: 'idle', url: '', data: null };
  try { localStorage.removeItem(PREVIEW_SESSION_KEY); } catch { /* ignore */ }
  closeCheckout();
  syncUrlPlaceholder();
  if (app || apps?.length) {
    const nextApps = apps?.length ? apps : [app];
    state.apps = nextApps;
    state.activeAppId = nextApps[0].id;
    state.activeTab = 'understanding';
    state.infoOpen = false;
    renderAll();
  } else {
    finishImportFromExtraction(extraction, 'URL preview');
  }
  toast(`${claim.product.label} active. Review the app info, then generate your pack.`);
}

async function startImport(url, entrySource = 'Dashboard URL', { demo = false } = {}) {
  if (!url) return;
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    toast('Paste a valid App Store, Play Store, or website URL.');
    return;
  }
  url = parsed.href;
  const name = deriveName(parsed);
  const importSeq = state.importSeq + 1;
  state.importSeq = importSeq;
  state.building = { name, url, entrySource, step: 0, detail: 'Reading the app URL...' };
  const startedAt = Date.now();
  $('#importUrl').value = '';
  closeImportModal();
  setRoute('home');
  renderAll();

  const timer = setInterval(() => {
    if (!state.building || state.importSeq !== importSeq) {
      clearInterval(timer);
      return;
    }
    state.building.step = Math.min(BUILD_STEPS.length - 2, state.building.step + 1);
    renderBuildStrip();
  }, EXTRACTION_STEP_MS);

  try {
    const importResult = await requestAppImport(url, entrySource, { demo });
    const extraction = importResult.extraction;
    if (state.importSeq !== importSeq) return;
    const elapsed = Date.now() - startedAt;
    await wait(Math.max(0, MIN_EXTRACTION_MS - elapsed));
    setTimeout(() => {
      if (state.importSeq !== importSeq) return;
      clearInterval(timer);
      state.building = {
        name: extraction.app.name,
        url,
        entrySource,
        step: BUILD_STEPS.length - 1,
        detail: extractionStatusLine(extraction),
      };
      renderAll();
      setTimeout(() => {
        if (state.importSeq === importSeq) {
          if (importResult.app) finishImportFromApp(importResult.app);
          else finishImportFromExtraction(extraction, entrySource);
        }
      }, EXTRACTION_STEP_MS);
    }, 0);
  } catch (error) {
    if (state.importSeq !== importSeq) return;
    clearInterval(timer);
    state.building = null;
    renderAll();
    toast(error.message || 'Could not analyze that URL.');
  }
}

async function requestAppImport(url, entrySource, { demo = false } = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(await authHeaders()),
  };
  const response = await fetch(demo ? '/api/apps/demo' : '/api/apps/import', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      url,
      source: entrySource,
      uid: state.session.uid || null,
      email: state.session.email || null,
      orgId: state.session.orgId || null,
      workspaceId: state.session.workspaceId || null,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not analyze that URL.');
  }
  if (payload.session) applyBootstrap(payload.session);
  if (demo && payload.claim) {
    state.launchPackMode = true;
    state.credits = creditsFromClaim(payload.claim);
    state.billing = initialBilling();
  }
  return { extraction: payload.extraction, app: payload.app || null, claim: payload.claim || null };
}

function finishImportFromApp(app) {
  const existingIndex = state.apps.findIndex((candidate) => candidate.id === app.id);
  if (existingIndex >= 0) state.apps.splice(existingIndex, 1, app);
  else state.apps.unshift(app);
  state.activeAppId = app.id;
  state.activeTab = 'understanding';
  state.infoOpen = false;
  state.building = null;
  renderAll();
  toast(`${app.name} app info is ready. Review it, then generate the pack.`);
}

function finishImportFromExtraction(extraction, entrySource = 'Dashboard URL') {
  const id = uniqueAppId(slugify(extraction.app.name));
  const screens = extraction.uiObjects.map((object, index) => {
    const judgement = judgementFromUiObject(object);
    return {
      id: `${id}-screen-${index + 1}`,
      label: object.title || `Screen ${index + 1}`,
      detail: screenDetail(object),
      sourceType: object.sourceType,
      rawifyEligible: Boolean(object.rawifyEligible),
      trustLevel: object.trustLevel,
      sourceUrl: object.sourceUrl,
      usability: judgement.status,
      usabilityLabel: judgement.label,
      usabilityReason: judgement.reason,
      selected: judgement.status === 'recommended',
      ignored: judgement.status === 'blocked',
    };
  });
  const claims = extraction.claimCandidates.map((claim, index) => ({
    id: `${id}-claim-${index + 1}`,
    text: claim.text,
    source: claim.source || 'Imported listing',
    supported: claim.status === 'approved' || claim.status === 'suggested',
    selected: claim.selected ?? index < 3,
    confidence: claim.confidence,
  }));
  const app = {
    id,
    name: extraction.app.name,
    source: sourceLabel(extraction),
    status: 'Plan ready',
    tagline: extraction.app.summary || `Imported from ${new URL(extraction.url).hostname}. We drafted a first ad plan from the app info we found.`,
    iconUrl: extraction.app.iconUrl || extraction.assets?.find((asset) => asset.type === 'store_icon')?.url || null,
    iconTone: iconToneFor(extraction),
    entrySource,
    extraction,
    holds: extraction.reviewSummary.holds || [],
    extractionStatus: 'review',
    screens,
    claims,
    style: extraction.styleNotes.length ? extraction.styleNotes : ['Plain language', 'Show real app screens', 'No unsupported performance claims'],
    reviewSignals: reviewSignalsFromExtraction(extraction),
    angles: anglesFromExtraction(extraction),
    runs: [],
    ads: [],
    reviewDecisions: [],
    learningEvents: [],
  };
  state.apps.unshift(app);
  state.activeAppId = id;
  state.activeTab = 'understanding';
  state.infoOpen = false;
  state.building = null;
  renderAll();
  toast(`${extraction.app.name} app info is ready. Review it, then generate the pack.`);
}

function extractionStatusLine(extraction) {
  const count = extraction.reviewSummary;
  const usableCount = extraction.uiObjects.filter((object) => judgementFromUiObject(object).status === 'recommended').length;
  return `Found ${count.screenCount} screen${count.screenCount === 1 ? '' : 's'} (${usableCount} look usable) and picked features for the first pass.`;
}

function judgementFromUiObject(object) {
  if (object?.usability?.status) {
    return {
      status: object.usability.status,
      label: object.usability.label || usabilityLabelFor(object.usability.status),
      reason: object.usability.reason || 'Automatically checked from the extracted app info.',
    };
  }
  return screenJudgement({
    sourceType: object.sourceType,
    sourceUrl: object.sourceUrl,
    usability: null,
  });
}

function usabilityLabelFor(status) {
  if (status === 'recommended') return 'Looks usable';
  if (status === 'review') return 'Check it';
  return 'Not used';
}

function screenDetail(object) {
  const parts = [
    object.description,
    object.screenType ? `Type: ${object.screenType.replace(/_/g, ' ')}` : '',
    object.sourceType === 'store_art' ? 'Store listing material; edit the plan if this should not be used.' : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function sourceLabel(extraction) {
  const platform = extraction.platform === 'app_store'
    ? 'App Store'
    : extraction.platform === 'play_store'
      ? 'Play Store'
      : 'Website';
  return `${platform} · ${extraction.app.category || 'imported'}`;
}

function iconToneFor(extraction) {
  if (extraction.platform === 'app_store') return 'lime';
  if (extraction.platform === 'play_store') return 'blue';
  return 'grey';
}

function reviewSignalsFromExtraction(extraction) {
  const signals = [];
  if (extraction.reviewSummary.screenCount) {
    signals.push(`${extraction.reviewSummary.screenCount} screen candidates found for review.`);
  } else {
    signals.push('No app screens were found. Add screenshots or recordings before creating app-screen ads.');
  }
  if (extraction.reviewSummary.claimCount) {
    signals.push(`${extraction.reviewSummary.claimCount} key features extracted from ${sourceLabel(extraction)}.`);
  } else {
    signals.push('No clear features were found. Add one true product feature before generating ads.');
  }
  if (extraction.reviewSummary.rawifyCandidateCount) {
    signals.push(`${extraction.reviewSummary.rawifyCandidateCount} store screenshot${extraction.reviewSummary.rawifyCandidateCount === 1 ? '' : 's'} available as visual references.`);
  }
  return signals;
}

function anglesFromExtraction(extraction) {
  const claims = extraction.claimCandidates.slice(0, 2);
  const angles = claims.map((claim, index) => ({
    id: `angle-${index + 1}`,
    label: shortAngleLabel(claim.text, index),
    evidence: claim.source || 'Found app info',
    selected: index < 2,
  }));
  angles.push({
    id: 'clarity',
    label: 'Show the core value',
    evidence: extraction.reviewSummary.screenCount ? 'Based on reviewed app info' : 'Needs app info before generation',
    selected: !angles.length,
  });
  return angles;
}

function shortAngleLabel(text, index) {
  const cleaned = text
    .replace(/^(this app|the app|users can|you can)\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  const lower = cleaned.toLowerCase();
  if (/personalized|ai-generated|customized|tailored/.test(lower) && /workout|exercise|fitness|training/.test(lower)) {
    return 'Personalized workouts';
  }
  if (/exercise|video|walkthrough|instruction|library/.test(lower)) {
    return 'Exercise library';
  }
  if (/progress|track|sync|history|apple health|strava|fitbit|watch/.test(lower)) {
    return 'Progress tracking';
  }
  if (/map|nearby|distance|location|cafe|coffee/.test(lower)) {
    return 'Find nearby places';
  }
  if (/save|bookmark|favorite/.test(lower)) {
    return 'Save favorites';
  }
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
  return sentenceLikeTitle(words || (index === 0 ? 'Core value' : 'User benefit'));
}

function sentenceLikeTitle(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1).toLowerCase()}`;
}

function deriveName(url) {
  if (url.hostname.includes('apps.apple.com') || url.hostname.includes('play.google.com')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const candidate = parts.find((part) => !['us', 'app', 'store', 'details'].includes(part) && !part.startsWith('id')) || 'Imported App';
    return titleCase(candidate.replace(/-/g, ' '));
  }
  return titleCase(url.hostname.replace(/^www\./, '').split('.')[0].replace(/-/g, ' '));
}

function angleLabel(app, id) {
  return app.angles.find((angle) => angle.id === id)?.label || id;
}

function swatchBg(app) {
  if (app.iconTone === 'lime') return 'linear-gradient(135deg, #c6f24e, #526312)';
  if (app.iconTone === 'blue') return 'linear-gradient(135deg, #89b7ff, #152643)';
  return 'linear-gradient(135deg, #32362f, #151713)';
}

function appIconHtml(app, className = 'app-icon', alt = '') {
  return `
    <span class="${escapeHtml(className)}" style="background:${swatchBg(app)}">
      ${app.iconUrl ? `<img src="${escapeHtml(app.iconUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
    </span>
  `;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `app-${Date.now()}`;
}

function uniqueAppId(base) {
  let id = base;
  let suffix = 2;
  while (state.apps.some((app) => app.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function titleCase(value) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

let toastTimer = null;
function clearToast() {
  const host = $('#toast');
  clearTimeout(toastTimer);
  host.classList.remove('show');
  host.hidden = true;
}

function toast(message) {
  const host = $('#toast');
  host.textContent = message;
  host.hidden = false;
  requestAnimationFrame(() => host.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    host.classList.remove('show');
    host.hidden = true;
  }, 2400);
}
