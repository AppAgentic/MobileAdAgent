const STEPS = [
  { id: 'launchpad', label: 'Launchpad', summary: 'Choose app and outputs' },
  { id: 'proof', label: 'Proof Review', summary: 'Approve supported claims' },
  { id: 'setup', label: 'Draft Pack Setup', summary: 'Confirm spend settings' },
  { id: 'review', label: 'Review Drafts', summary: 'Approve generated drafts' },
  { id: 'export', label: 'QA & Export', summary: 'Package approved assets' },
];

const state = {
  portfolio: null,
  activeAppId: null,
  currentStep: 'launchpad',
  config: createDefaultConfig(),
  pack: null,
  qa: null,
  destination: 'download_zip',
  busy: false,
};

const els = {
  header: document.querySelector('#appHeader'),
  view: document.querySelector('#viewRoot'),
  stepper: document.querySelector('#stepper'),
  inspector: document.querySelector('#inspectorRoot'),
  railNav: document.querySelector('#railNav'),
  toast: document.querySelector('#toast'),
  userName: document.querySelector('#userName'),
  userRole: document.querySelector('#userRole'),
  userAvatar: document.querySelector('#userAvatar'),
};

init();

async function init() {
  try {
    state.portfolio = await fetchJson('/api/portfolio');
    state.activeAppId = state.portfolio.apps[0]?.id || null;
    hydrateUser();
    bindEvents();
    render();
  } catch (error) {
    renderFatal(error);
  }
}

function hydrateUser() {
  const user = state.portfolio?.user || { name: 'Growth', role: 'Operator' };
  els.userName.textContent = user.name;
  els.userRole.textContent = user.role;
  els.userAvatar.textContent = initials(user.name);
}

function bindEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
}

async function onClick(event) {
  const button = event.target.closest('button');
  if (!button || state.busy) {
    return;
  }

  const { action, step, appId, claimId, proofId, draftId, destination, nav, quick } = button.dataset;

  if (nav) {
    if (nav === 'launchpad') {
      goToStep('launchpad');
    } else {
      toast(`${button.textContent.trim()} is not part of this local prototype yet.`);
    }
    return;
  }

  if (quick) {
    handleQuickAction(quick);
    return;
  }

  if (appId) {
    switchApp(appId);
    return;
  }

  if (step) {
    goToStep(step);
    return;
  }

  if (claimId && action) {
    handleClaimAction(claimId, action);
    return;
  }

  if (proofId && action) {
    handleProofAction(proofId, action);
    return;
  }

  if (draftId && action) {
    handleDraftAction(draftId, action);
    return;
  }

  if (destination) {
    state.destination = destination;
    render();
    return;
  }

  switch (action) {
    case 'continue-proof':
      goToStep('proof');
      break;
    case 'add-proof':
      addProof();
      break;
    case 'continue-setup':
      goToStep('setup');
      break;
    case 'generate-drafts':
      await generateDrafts();
      break;
    case 'approve-all':
      approveAllDrafts();
      break;
    case 'run-qa':
      await runQa();
      break;
    case 'export-pack':
      await exportPack();
      break;
    case 'reset-pack':
      resetPack();
      break;
    default:
      break;
  }
}

function onInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
    return;
  }

  const app = activeApp();
  if (!app) {
    return;
  }

  const { field, claimId } = target.dataset;
  if (field && ['name', 'storeUrl', 'audience', 'objective', 'avoidList'].includes(field)) {
    app[field] = target.value;
    invalidateGeneratedWork();
    renderHeader();
    renderInspector();
    return;
  }

  if (claimId && field === 'claimText') {
    const claim = app.claims.find((candidate) => candidate.id === claimId);
    if (claim) {
      claim.text = target.value;
      invalidateGeneratedWork();
      renderInspector();
    }
  }
}

function onChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
    return;
  }

  const { config, output } = target.dataset;

  if (output) {
    state.config.outputs[output] = target.checked;
    if (!state.config.outputs.imageAds && !state.config.outputs.ugcVideos) {
      state.config.outputs.imageAds = true;
      toast('At least one output stays selected.');
    }
    invalidateGeneratedWork();
    render();
    return;
  }

  if (!config) {
    return;
  }

  updateConfigFromControl(target, config);
  invalidateGeneratedWork();
  render();
}

function render() {
  renderRail();
  renderHeader();
  renderView();
  renderStepper();
  renderInspector();
}

function renderRail() {
  els.railNav?.querySelectorAll('[data-nav]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.nav === 'launchpad');
  });
}

function renderHeader() {
  const app = activeApp();
  const apps = state.portfolio.apps;
  els.header.innerHTML = `
    <div class="header-title">
      <p class="eyebrow">Local prototype - provider mutations 0</p>
      <h1>${escapeHtml(app?.name || 'Mobile Ad Agent')}</h1>
      <p>${escapeHtml(app?.objective || 'Choose an app and build a proof-backed ad pack.')}</p>
    </div>
    <div class="portfolio-strip" aria-label="Apps">
      ${apps.map((candidate) => appButton(candidate)).join('')}
    </div>
  `;
}

function renderView() {
  const app = activeApp();
  if (!app) {
    els.view.innerHTML = '<div class="empty-state">No apps available.</div>';
    return;
  }

  const renderers = {
    launchpad: renderLaunchpad,
    proof: renderProofReview,
    setup: renderDraftSetup,
    review: renderDraftReview,
    export: renderQaExport,
  };
  els.view.innerHTML = renderers[state.currentStep](app);
}

function renderStepper() {
  const activeIndex = stepIndex(state.currentStep);
  els.stepper.innerHTML = `
    <div class="stepper-track">
      ${STEPS.map((step, index) => `
        <button
          class="step-chip ${index < activeIndex ? 'is-complete' : ''} ${step.id === state.currentStep ? 'is-current' : ''}"
          type="button"
          data-step="${step.id}"
        >
          <span>${index + 1}</span>
          <strong>${escapeHtml(step.label)}</strong>
          <small>${escapeHtml(step.summary)}</small>
        </button>
      `).join('')}
    </div>
  `;
}

function renderInspector() {
  const app = activeApp();
  if (!app) {
    els.inspector.innerHTML = '';
    return;
  }

  const counts = appCounts(app);
  const next = nextMove(app);
  const estimate = estimateCost(app);
  const pack = state.pack;
  els.inspector.innerHTML = `
    <section class="inspector-block">
      <p class="eyebrow">Next</p>
      <h2>${escapeHtml(next.title)}</h2>
      <p>${escapeHtml(next.detail)}</p>
      <button class="primary-button full" type="button" data-action="${escapeAttr(next.action)}">${escapeHtml(next.button)}</button>
    </section>

    <section class="inspector-block">
      <div class="metric-row">
        <span>Proof readiness</span>
        <strong>${counts.readiness}%</strong>
      </div>
      <div class="progress-bar" aria-hidden="true"><span style="width:${counts.readiness}%"></span></div>
      <dl class="compact-list">
        <div><dt>Approved claims</dt><dd>${counts.approvedClaims}/${counts.claims}</dd></div>
        <div><dt>Raw proof</dt><dd>${counts.rawProof}</dd></div>
        <div><dt>Store art</dt><dd>${counts.storeArt} not proof</dd></div>
      </dl>
    </section>

    <section class="inspector-block">
      <p class="eyebrow">Pack</p>
      <dl class="compact-list">
        <div><dt>Image ads</dt><dd>${state.config.outputs.imageAds ? estimate.imageCount : 0}</dd></div>
        <div><dt>UGC videos</dt><dd>${state.config.outputs.ugcVideos ? state.config.ugcSetup.count : 0}</dd></div>
        <div><dt>Estimated credits</dt><dd>${estimate.total}</dd></div>
        <div><dt>Generated drafts</dt><dd>${pack ? pack.summary.total : 0}</dd></div>
        <div><dt>Provider mutations</dt><dd>0</dd></div>
      </dl>
    </section>
  `;
}

function renderLaunchpad(app) {
  const counts = appCounts(app);
  return `
    <section class="work-surface two-column">
      <div class="flow-panel primary-panel">
        <div class="panel-heading">
          <span class="step-number">1</span>
          <div>
            <p class="eyebrow">Launchpad</p>
            <h2>Start from the app, then choose the pack.</h2>
          </div>
        </div>

        <div class="field-grid">
          ${field('App name', 'name', app.name)}
          ${field('Store URL', 'storeUrl', app.storeUrl)}
          ${textarea('Audience', 'audience', app.audience)}
          ${textarea('Objective', 'objective', app.objective)}
          ${textarea('Avoid list', 'avoidList', app.avoidList)}
        </div>
      </div>

      <div class="flow-panel">
        <div class="panel-heading">
          <span class="step-number">2</span>
          <div>
            <p class="eyebrow">Outputs</p>
            <h2>Pick only what this pack should create.</h2>
          </div>
        </div>

        <div class="choice-stack">
          ${outputChoice('imageAds', 'Image Ads', 'Static feed and story crops derived after approval.', state.config.outputs.imageAds)}
          ${outputChoice('ugcVideos', 'UGC Videos', 'Short proof-backed creator scripts and video drafts.', state.config.outputs.ugcVideos)}
        </div>

        <div class="readiness-band">
          <div>
            <span>Proof readiness</span>
            <strong>${counts.readiness}%</strong>
          </div>
          <p>${counts.rawProof ? `${counts.rawProof} raw proof assets are ready for review.` : 'Add raw app proof before generation.'}</p>
        </div>

        <div class="action-row">
          <button class="secondary-button" type="button" data-action="add-proof">Add proof</button>
          <button class="primary-button" type="button" data-action="continue-proof">Review proof</button>
        </div>
      </div>
    </section>
  `;
}

function renderProofReview(app) {
  const storeArt = app.proofAssets.filter((proof) => proof.trust === 'store_art');
  const rawProof = app.proofAssets.filter((proof) => proof.trust !== 'store_art');
  return `
    <section class="work-surface proof-layout">
      <div class="flow-panel primary-panel">
        <div class="panel-heading">
          <span class="step-number">2</span>
          <div>
            <p class="eyebrow">Proof Review</p>
            <h2>Keep only claims the app can actually prove.</h2>
          </div>
        </div>
        <div class="claim-list">
          ${app.claims.length ? app.claims.map((claim) => claimRow(app, claim)).join('') : emptyInline('No detected claims yet. Add proof to start.')}
        </div>
      </div>

      <div class="flow-panel">
        <div class="panel-heading compact-heading">
          <div>
            <p class="eyebrow">Raw proof</p>
            <h2>App evidence</h2>
          </div>
          <button class="secondary-button small" type="button" data-action="add-proof">Add</button>
        </div>
        <div class="proof-grid">
          ${rawProof.length ? rawProof.map((proof) => proofTile(proof, false)).join('') : emptyInline('No raw proof attached.')}
        </div>

        <div class="subsection">
          <p class="eyebrow">Not proof</p>
          <div class="proof-grid">
            ${storeArt.length ? storeArt.map((proof) => proofTile(proof, true)).join('') : emptyInline('Store art will appear here when separated.')}
          </div>
        </div>

        <div class="action-row">
          <button class="secondary-button" type="button" data-step="launchpad">Back</button>
          <button class="primary-button" type="button" data-action="continue-setup">Continue setup</button>
        </div>
      </div>
    </section>
  `;
}

function renderDraftSetup(app) {
  const estimate = estimateCost(app);
  return `
    <section class="work-surface two-column">
      <div class="flow-panel primary-panel">
        <div class="panel-heading">
          <span class="step-number">3</span>
          <div>
            <p class="eyebrow">Draft Pack Setup</p>
            <h2>Confirm the pack before spending credits.</h2>
          </div>
        </div>

        <div class="setup-section">
          <h3>Image Ads</h3>
          <div class="option-grid">
            ${checkbox('Product proof', 'layout:product_proof', state.config.imageSetup.layouts.includes('product_proof'), state.config.outputs.imageAds)}
            ${checkbox('Lifestyle', 'layout:lifestyle', state.config.imageSetup.layouts.includes('lifestyle'), state.config.outputs.imageAds)}
            ${checkbox('Comparison', 'layout:comparison', state.config.imageSetup.layouts.includes('comparison'), state.config.outputs.imageAds)}
          </div>
          <div class="option-grid tight">
            ${checkbox('1:1', 'format:1:1', state.config.imageSetup.formats.includes('1:1'), state.config.outputs.imageAds)}
            ${checkbox('4:5', 'format:4:5', state.config.imageSetup.formats.includes('4:5'), state.config.outputs.imageAds)}
            ${checkbox('9:16', 'format:9:16', state.config.imageSetup.formats.includes('9:16'), state.config.outputs.imageAds)}
          </div>
        </div>

        <div class="setup-section ${state.config.outputs.ugcVideos ? '' : 'is-muted'}">
          <h3>UGC Videos</h3>
          <div class="control-row">
            <label>
              Style
              <select data-config="ugcStyle" ${state.config.outputs.ugcVideos ? '' : 'disabled'}>
                ${option('natural', 'Natural', state.config.ugcSetup.style)}
                ${option('energetic', 'Energetic', state.config.ugcSetup.style)}
                ${option('calm', 'Calm explainer', state.config.ugcSetup.style)}
              </select>
            </label>
            <label>
              Count
              <input type="number" min="1" max="8" data-config="ugcCount" value="${state.config.ugcSetup.count}" ${state.config.outputs.ugcVideos ? '' : 'disabled'}>
            </label>
            <label>
              Seconds
              <input type="number" min="8" max="30" data-config="ugcDuration" value="${state.config.ugcSetup.durationSeconds}" ${state.config.outputs.ugcVideos ? '' : 'disabled'}>
            </label>
          </div>
        </div>
      </div>

      <div class="flow-panel">
        <p class="eyebrow">Estimate</p>
        <div class="estimate-card">
          <strong>${estimate.total} credits</strong>
          <span>${estimate.imageCount} image drafts${state.config.outputs.ugcVideos ? `, ${state.config.ugcSetup.count} UGC videos` : ''}</span>
        </div>
        <p class="quiet-copy">Credits are only spent when drafts are generated. Story crops and thumbnails are derived later from approved assets.</p>
        <div class="action-row">
          <button class="secondary-button" type="button" data-step="proof">Back</button>
          <button class="primary-button" type="button" data-action="generate-drafts">${state.pack ? 'Regenerate drafts' : 'Generate drafts'}</button>
        </div>
      </div>
    </section>
  `;
}

function renderDraftReview() {
  const pack = state.pack;
  return `
    <section class="work-surface">
      <div class="flow-panel primary-panel">
        <div class="panel-heading">
          <span class="step-number">4</span>
          <div>
            <p class="eyebrow">Review Drafts</p>
            <h2>Approve the assets that are good enough to QA.</h2>
          </div>
        </div>
        ${pack ? draftGrid(pack) : emptyDrafts()}
      </div>
      <div class="action-row sticky-actions">
        <button class="secondary-button" type="button" data-step="setup">Back to setup</button>
        <button class="secondary-button" type="button" data-action="approve-all" ${pack ? '' : 'disabled'}>Approve all</button>
        <button class="primary-button" type="button" data-action="run-qa" ${pack ? '' : 'disabled'}>Run QA</button>
      </div>
    </section>
  `;
}

function renderQaExport() {
  const qa = state.qa;
  const pack = state.pack;
  return `
    <section class="work-surface export-layout">
      <div class="flow-panel primary-panel">
        <div class="panel-heading">
          <span class="step-number">5</span>
          <div>
            <p class="eyebrow">QA & Export</p>
            <h2>Package the approved pack. Publishing stays separate.</h2>
          </div>
        </div>
        ${qa ? qaChecks(qa) : emptyInline('Run QA from Review Drafts to unlock export.')}
      </div>

      <div class="flow-panel">
        <p class="eyebrow">Export destination</p>
        <div class="destination-list">
          ${destinationButton('download_zip', 'Download ZIP', 'Source inventory and local manifest.')}
          ${destinationButton('ad_inbox', 'Send to ad inbox', 'Queue for a later guarded launch review.')}
          ${destinationButton('share_link', 'Copy share link', 'Shareable review packet for the team.')}
        </div>
        <div class="export-note">
          <strong>No live provider publishing</strong>
          <span>This local prototype creates handoff inventory only. Paid-network launch requires a separate approval rail.</span>
        </div>
        <div class="action-row">
          <button class="secondary-button" type="button" data-step="review">Back</button>
          <button class="primary-button" type="button" data-action="export-pack" ${qa && pack ? '' : 'disabled'}>Export pack</button>
        </div>
      </div>
    </section>
  `;
}

function appButton(app) {
  const counts = appCounts(app);
  const active = app.id === state.activeAppId;
  return `
    <button class="app-card ${active ? 'is-active' : ''}" type="button" data-app-id="${escapeAttr(app.id)}" style="--app-hue:${app.hue}">
      <span class="app-icon">${escapeHtml(app.icon)}</span>
      <span class="app-copy">
        <strong>${escapeHtml(app.name)}</strong>
        <small>${counts.readiness}% proof ready</small>
      </span>
    </button>
  `;
}

function field(label, fieldName, value) {
  return `
    <label class="field">
      ${escapeHtml(label)}
      <input data-field="${escapeAttr(fieldName)}" value="${escapeAttr(value)}">
    </label>
  `;
}

function textarea(label, fieldName, value) {
  return `
    <label class="field span-2">
      ${escapeHtml(label)}
      <textarea rows="3" data-field="${escapeAttr(fieldName)}">${escapeHtml(value)}</textarea>
    </label>
  `;
}

function outputChoice(id, title, detail, checked) {
  return `
    <label class="output-choice ${checked ? 'is-selected' : ''}">
      <input type="checkbox" data-output="${escapeAttr(id)}" ${checked ? 'checked' : ''}>
      <span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
      </span>
    </label>
  `;
}

function checkbox(label, value, checked, enabled = true) {
  return `
    <label class="check-tile ${checked ? 'is-selected' : ''} ${enabled ? '' : 'is-disabled'}">
      <input type="checkbox" data-config="${escapeAttr(value)}" ${checked ? 'checked' : ''} ${enabled ? '' : 'disabled'}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function option(value, label, selectedValue) {
  return `<option value="${escapeAttr(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function claimRow(app, claim) {
  const linkedProof = claim.supportingProofIds
    .map((id) => app.proofAssets.find((proof) => proof.id === id))
    .filter(Boolean);
  return `
    <article class="claim-row" data-status="${escapeAttr(claim.status)}">
      <div class="claim-main">
        <textarea rows="2" data-claim-id="${escapeAttr(claim.id)}" data-field="claimText">${escapeHtml(claim.text)}</textarea>
        <div class="proof-pills">
          ${linkedProof.length ? linkedProof.map((proof) => `<span>${escapeHtml(proof.label)}</span>`).join('') : '<span class="is-warning">No raw proof attached</span>'}
        </div>
      </div>
      <div class="segmented-actions" aria-label="Claim status">
        <button type="button" data-claim-id="${escapeAttr(claim.id)}" data-action="approved" class="${claim.status === 'approved' ? 'is-active' : ''}">Approve</button>
        <button type="button" data-claim-id="${escapeAttr(claim.id)}" data-action="needs_review" class="${claim.status === 'needs_review' ? 'is-active' : ''}">Review</button>
        <button type="button" data-claim-id="${escapeAttr(claim.id)}" data-action="ignored" class="${claim.status === 'ignored' ? 'is-active' : ''}">Ignore</button>
      </div>
    </article>
  `;
}

function proofTile(proof, isStoreArt) {
  return `
    <article class="proof-tile" style="--proof-hue:${proof.hue || 160}">
      <span>${escapeHtml(proof.kind || 'screen')}</span>
      <strong>${escapeHtml(proof.label)}</strong>
      <small>${escapeHtml(proof.ocr || 'No OCR yet')}</small>
      ${isStoreArt
        ? '<em>Store art is excluded from claim proof.</em>'
        : `<button class="text-button" type="button" data-proof-id="${escapeAttr(proof.id)}" data-action="mark-store-art">Mark not proof</button>`}
    </article>
  `;
}

function draftGrid(pack) {
  if (!pack.drafts.length) {
    return emptyInline('No drafts generated for the current setup.');
  }

  return `
    <div class="draft-grid">
      ${pack.drafts.map((draft) => `
        <article class="draft-card" data-status="${escapeAttr(draft.status)}">
          <div class="draft-art" style="--draft-hue:${draft.hue || 160}">
            <span>${draft.type === 'image' ? escapeHtml(draft.format) : `${draft.durationSeconds}s`}</span>
            <strong>${escapeHtml(draft.type === 'image' ? draft.layoutLabel : draft.styleLabel)}</strong>
          </div>
          <div class="draft-body">
            <small>${escapeHtml(draft.type === 'image' ? 'Image Ad' : 'UGC Video')}</small>
            <h3>${escapeHtml(draft.headline || draft.hook)}</h3>
            <p>${escapeHtml(draft.subhead || draft.beat)}</p>
          </div>
          <div class="draft-actions">
            <button type="button" data-draft-id="${escapeAttr(draft.id)}" data-action="approved" class="${draft.status === 'approved' ? 'is-active' : ''}">Approve</button>
            <button type="button" data-draft-id="${escapeAttr(draft.id)}" data-action="changes_requested" class="${draft.status === 'changes_requested' ? 'is-active' : ''}">Changes</button>
            <button type="button" data-draft-id="${escapeAttr(draft.id)}" data-action="regenerate">Regenerate</button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function qaChecks(qa) {
  return `
    <div class="qa-summary" data-verdict="${escapeAttr(qa.verdict)}">
      <strong>${escapeHtml(qa.verdict.toUpperCase())}</strong>
      <span>${escapeHtml(qa.note)}</span>
    </div>
    <div class="qa-list">
      ${qa.checks.map((check) => `
        <article class="qa-item" data-status="${escapeAttr(check.status)}">
          <span>${escapeHtml(check.status)}</span>
          <div>
            <strong>${escapeHtml(check.label)}</strong>
            <p>${escapeHtml(check.detail)}</p>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function destinationButton(id, label, detail) {
  const active = state.destination === id;
  return `
    <button class="destination-card ${active ? 'is-active' : ''}" type="button" data-destination="${escapeAttr(id)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(detail)}</span>
    </button>
  `;
}

function emptyDrafts() {
  return `
    <div class="empty-state">
      <strong>No drafts yet.</strong>
      <span>Confirm Draft Pack Setup first. Credits are not spent until you generate drafts.</span>
      <button class="primary-button" type="button" data-step="setup">Go to setup</button>
    </div>
  `;
}

function emptyInline(text) {
  return `<div class="inline-empty">${escapeHtml(text)}</div>`;
}

function activeApp() {
  return state.portfolio?.apps.find((app) => app.id === state.activeAppId) || null;
}

function switchApp(appId) {
  if (appId === state.activeAppId) {
    return;
  }
  state.activeAppId = appId;
  state.currentStep = 'launchpad';
  state.config = createDefaultConfig();
  state.pack = null;
  state.qa = null;
  render();
}

function goToStep(step) {
  state.currentStep = step;
  render();
}

function handleQuickAction(quick) {
  if (quick === 'new-pack') {
    resetPack();
    toast('New local pack started.');
  }
  if (quick === 'import-app') {
    goToStep('launchpad');
  }
  if (quick === 'upload-proof') {
    addProof();
    goToStep('proof');
  }
}

function handleClaimAction(claimId, action) {
  const app = activeApp();
  const claim = app?.claims.find((candidate) => candidate.id === claimId);
  if (!claim) {
    return;
  }
  claim.status = action;
  invalidateGeneratedWork();
  render();
}

function handleProofAction(proofId, action) {
  const app = activeApp();
  const proof = app?.proofAssets.find((candidate) => candidate.id === proofId);
  if (!proof || action !== 'mark-store-art') {
    return;
  }
  proof.trust = 'store_art';
  proof.kind = 'store_art';
  invalidateGeneratedWork();
  render();
}

function handleDraftAction(draftId, action) {
  const draft = state.pack?.drafts.find((candidate) => candidate.id === draftId);
  if (!draft) {
    return;
  }

  if (action === 'regenerate') {
    draft.revision = (draft.revision || 0) + 1;
    draft.status = 'needs_review';
    if (draft.type === 'image') {
      draft.headline = `${draft.headline.replace(/ \(alt \d+\)$/, '')} (alt ${draft.revision})`;
    } else {
      draft.hook = `${draft.hook.replace(/ \(alt \d+\)$/, '')} (alt ${draft.revision})`;
    }
    state.qa = null;
  } else {
    draft.status = action;
    state.qa = null;
  }
  render();
}

function addProof() {
  const app = activeApp();
  if (!app) {
    return;
  }
  const number = app.proofAssets.length + 1;
  app.proofAssets.push({
    id: `${app.id}-proof-${Date.now()}`,
    label: `Uploaded proof ${number}`,
    kind: 'screen',
    trust: 'raw_app_proof',
    hue: app.hue,
    ocr: 'New app screen awaiting claim mapping',
  });
  if (!app.claims.length) {
    app.claims.push({
      id: `${app.id}-claim-${Date.now()}`,
      text: 'Add a claim supported by this raw proof.',
      status: 'needs_review',
      supportingProofIds: [app.proofAssets.at(-1).id],
      confidence: 0.5,
    });
  }
  invalidateGeneratedWork();
  toast('Proof added locally.');
  render();
}

async function generateDrafts() {
  const app = activeApp();
  if (!app) {
    return;
  }
  await withBusy(async () => {
    state.pack = await postJson('/api/generate-drafts', {
      appId: app.id,
      appOverride: app,
      config: state.config,
    });
    state.qa = null;
    state.currentStep = 'review';
    toast('Drafts generated locally. Provider mutations stayed at 0.');
  });
  render();
}

async function runQa() {
  if (!state.pack) {
    return;
  }
  await withBusy(async () => {
    state.qa = await postJson('/api/qa', {
      pack: state.pack,
      appOverride: activeApp(),
    });
    state.currentStep = 'export';
    toast('QA complete.');
  });
  render();
}

async function exportPack() {
  if (!state.pack || !state.qa) {
    return;
  }
  await withBusy(async () => {
    const manifest = await postJson('/api/manifest', {
      appId: state.activeAppId,
      pack: state.pack,
      qa: state.qa,
      destination: state.destination,
    });
    downloadJson(manifest, `${manifest.packId}-${state.destination}.json`);
    toast('Export packet downloaded. No live publishing occurred.');
  });
  render();
}

function approveAllDrafts() {
  if (!state.pack) {
    return;
  }
  state.pack.drafts = state.pack.drafts.map((draft) => ({ ...draft, status: 'approved' }));
  state.qa = null;
  render();
}

function resetPack() {
  state.config = createDefaultConfig();
  state.pack = null;
  state.qa = null;
  state.currentStep = 'launchpad';
  render();
}

function invalidateGeneratedWork() {
  state.pack = null;
  state.qa = null;
}

function updateConfigFromControl(target, config) {
  const checked = target.checked;
  if (config.startsWith('layout:')) {
    toggleArrayValue(state.config.imageSetup.layouts, config.slice(7), checked);
    ensureArrayValue(state.config.imageSetup.layouts, 'product_proof');
  }
  if (config.startsWith('format:')) {
    toggleArrayValue(state.config.imageSetup.formats, config.slice(7), checked);
    ensureArrayValue(state.config.imageSetup.formats, '1:1');
  }
  if (config === 'ugcStyle') {
    state.config.ugcSetup.style = target.value;
  }
  if (config === 'ugcCount') {
    state.config.ugcSetup.count = clamp(Number(target.value), 1, 8, 3);
  }
  if (config === 'ugcDuration') {
    state.config.ugcSetup.durationSeconds = clamp(Number(target.value), 8, 30, 15);
  }
}

function toggleArrayValue(values, value, checked) {
  const index = values.indexOf(value);
  if (checked && index === -1) {
    values.push(value);
  }
  if (!checked && index !== -1) {
    values.splice(index, 1);
  }
}

function ensureArrayValue(values, fallback) {
  if (!values.length) {
    values.push(fallback);
  }
}

function createDefaultConfig() {
  return {
    outputs: { imageAds: true, ugcVideos: false },
    imageSetup: {
      layouts: ['product_proof', 'lifestyle'],
      formats: ['1:1', '4:5', '9:16'],
      perClaim: 1,
    },
    ugcSetup: {
      style: 'natural',
      durationSeconds: 15,
      count: 3,
    },
  };
}

function appCounts(app) {
  const rawProof = app.proofAssets.filter((proof) => proof.trust !== 'store_art').length;
  const storeArt = app.proofAssets.filter((proof) => proof.trust === 'store_art').length;
  const approvedClaims = app.claims.filter((claim) => claim.status === 'approved').length;
  const activeClaims = app.claims.filter((claim) => claim.status !== 'ignored').length;
  const readiness = rawProof && activeClaims
    ? Math.min(100, Math.round(35 + (approvedClaims / activeClaims) * 45 + Math.min(rawProof / 4, 1) * 20))
    : rawProof ? 35 : 0;
  return {
    rawProof,
    storeArt,
    approvedClaims,
    claims: app.claims.length,
    activeClaims,
    readiness,
  };
}

function estimateCost(app) {
  const counts = appCounts(app);
  const claimCount = Math.max(1, counts.approvedClaims || counts.activeClaims || 1);
  const imageCount = state.config.outputs.imageAds
    ? claimCount * state.config.imageSetup.layouts.length * state.config.imageSetup.perClaim
    : 0;
  const ugcCount = state.config.outputs.ugcVideos ? state.config.ugcSetup.count : 0;
  return {
    imageCount,
    ugcCount,
    total: imageCount * 6 + ugcCount * 18,
  };
}

function nextMove(app) {
  const counts = appCounts(app);
  if (state.currentStep === 'launchpad') {
    return {
      title: 'Review proof next',
      detail: counts.rawProof ? 'The app has raw proof ready to approve.' : 'Add at least one raw proof asset before generating.',
      button: 'Review proof',
      action: 'continue-proof',
    };
  }
  if (state.currentStep === 'proof') {
    return {
      title: 'Confirm draft setup',
      detail: `${counts.approvedClaims} claims are approved for generation.`,
      button: 'Continue setup',
      action: 'continue-setup',
    };
  }
  if (state.currentStep === 'setup') {
    return {
      title: 'Generate local drafts',
      detail: 'This spends mock credits only in the local prototype.',
      button: state.pack ? 'Regenerate drafts' : 'Generate drafts',
      action: 'generate-drafts',
    };
  }
  if (state.currentStep === 'review') {
    return {
      title: 'Run QA',
      detail: state.pack ? `${state.pack.drafts.length} drafts are ready for review.` : 'Generate drafts before QA.',
      button: 'Run QA',
      action: 'run-qa',
    };
  }
  return {
    title: 'Export the packet',
    detail: 'Download or hand off the source inventory without publishing live ads.',
    button: 'Export pack',
    action: 'export-pack',
  };
}

function stepIndex(step) {
  return Math.max(0, STEPS.findIndex((candidate) => candidate.id === step));
}

async function withBusy(task) {
  state.busy = true;
  render();
  try {
    await task();
  } finally {
    state.busy = false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

function renderFatal(error) {
  els.view.innerHTML = `
    <div class="empty-state">
      <strong>Local prototype could not load.</strong>
      <span>${escapeHtml(error.message)}</span>
    </div>
  `;
}

function initials(name) {
  return String(name || 'MA')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
