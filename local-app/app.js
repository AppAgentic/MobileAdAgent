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
    <div class="top-command">
      <button class="back-link" type="button" data-step="launchpad">Back to Launchpad</button>
      <div class="top-actions">
        <div class="credit-badge"><span>Credits</span><strong>${state.portfolio.credits.toLocaleString()}</strong></div>
        <button class="icon-action" type="button" aria-label="Notifications"><span></span></button>
      </div>
    </div>
    ${app ? appSummaryBar(app) : ''}
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
        <button class="step-chip ${index < activeIndex ? 'is-complete' : ''} ${step.id === state.currentStep ? 'is-current' : ''}" type="button" data-step="${step.id}">
          <span>${index < activeIndex ? 'Done' : index + 1}</span>
          <strong>${escapeHtml(step.label)}</strong>
          <small>${escapeHtml(stepStatus(step.id, activeIndex, index))}</small>
        </button>
        ${index < STEPS.length - 1 ? '<i class="step-arrow"></i>' : ''}
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
    <section class="inspector-block hero-inspector">
      <p class="eyebrow">${escapeHtml(inspectorEyebrow())}</p>
      <h2>${escapeHtml(next.title)}</h2>
      <p>${escapeHtml(next.detail)}</p>
      <button class="primary-button full" type="button" data-action="${escapeAttr(next.action)}">${escapeHtml(next.button)}</button>
    </section>

    <section class="inspector-block">
      <p class="eyebrow">Pack includes</p>
      <div class="pack-include-row">
        <span class="include-icon image">IA</span>
        <div><strong>Image Ads</strong><small>1:1, 4:5, 9:16</small></div>
        <em>${state.config.outputs.imageAds ? estimate.imageCount : 0}</em>
      </div>
      <div class="pack-include-row">
        <span class="include-icon video">UG</span>
        <div><strong>UGC Videos</strong><small>9:16 videos</small></div>
        <em>${state.config.outputs.ugcVideos ? state.config.ugcSetup.count : 0}</em>
      </div>
      <div class="metric-row with-margin">
        <span>Proof readiness</span>
        <strong>${counts.readiness}%</strong>
      </div>
      <div class="progress-bar" aria-hidden="true"><span style="width:${counts.readiness}%"></span></div>
    </section>

    <section class="inspector-block">
      <p class="eyebrow">Status</p>
      <dl class="compact-list">
        <div><dt>Approved claims</dt><dd>${counts.approvedClaims}/${counts.claims}</dd></div>
        <div><dt>Raw proof</dt><dd>${counts.rawProof}</dd></div>
        <div><dt>Store art</dt><dd>${counts.storeArt} not proof</dd></div>
        <div><dt>Estimated credits</dt><dd>${estimate.total}</dd></div>
        <div><dt>Generated drafts</dt><dd>${pack ? pack.summary.total : 0}</dd></div>
        <div><dt>Provider mutations</dt><dd>0</dd></div>
      </dl>
    </section>
  `;
}

function renderLaunchpad(app) {
  const counts = appCounts(app);
  const estimate = estimateCost(app);
  return `
    <section class="screen-head">
      <h1>Launchpad</h1>
      <p>Pick an app and build the next ad pack.</p>
    </section>

    <section class="app-hero-card">
      <div class="app-icon-xl" style="--app-hue:${app.hue}">${escapeHtml(app.icon)}</div>
      <div class="app-hero-copy">
        <h2>${escapeHtml(app.name)}: Build Better Habits</h2>
        <p>${escapeHtml(app.category)} - iOS + Android - In-App Purchases</p>
      </div>
      ${miniStat('Proof assets', counts.rawProof)}
      ${miniStat('Claims detected', counts.claims)}
      ${miniStat('Est. credits', estimate.total)}
      <button class="secondary-button" type="button">View store</button>
      <button class="secondary-button" type="button" data-quick="import-app">Switch app</button>
    </section>

    <section class="flow-panel primary-panel launch-accordion">
      ${accordionRow(1, 'Select app', `${app.name} selected`, 'complete')}
      ${accordionRow(2, 'Check proof', `${counts.rawProof} assets - ${counts.claims} claims detected`, counts.rawProof ? 'complete' : 'warning')}
      <article class="accordion-row is-open">
        <div class="accordion-index">3</div>
        <div class="accordion-body">
          <div class="accordion-title">
            <h3>Choose outputs <span>Recommended</span></h3>
            <p>Pick the deliverables you want in this ad pack.</p>
          </div>
          <div class="choice-grid">
            ${outputChoice('imageAds', 'Image Ads', "We'll create static ads for feed and in-app placements.", state.config.outputs.imageAds, 'Est. 8-12')}
            ${outputChoice('ugcVideos', 'UGC Videos', "We'll generate short-form videos with real creators.", state.config.outputs.ugcVideos, 'Est. 3-5')}
          </div>
          <p class="info-note">You can change outputs anytime before we draft your pack.</p>
          <div class="action-row">
            <button class="secondary-button" type="button" data-action="add-proof">Add proof</button>
            <button class="primary-button" type="button" data-action="continue-proof">Review proof</button>
          </div>
        </div>
      </article>
      ${accordionRow(4, 'Draft pack', "We'll generate your first round of creatives.", state.pack ? 'complete' : 'locked')}
      ${accordionRow(5, 'Review', 'Approve winners and request changes.', state.pack ? 'available' : 'locked')}
      ${accordionRow(6, 'Export', 'Download your pack or send to ad inbox.', state.qa ? 'available' : 'locked')}
    </section>
  `;
}

function renderProofReview(app) {
  const storeArt = app.proofAssets.filter((proof) => proof.trust === 'store_art');
  const rawProof = app.proofAssets.filter((proof) => proof.trust !== 'store_art');
  return `
    <section class="screen-head">
      <h1>Review proof</h1>
      <p>Only approved claims can be used in generated ads.</p>
    </section>
    <section class="work-surface proof-layout">
      <div class="flow-panel">
        <div class="panel-heading compact-heading">
          <div>
            <p class="eyebrow">Raw proof assets</p>
            <h2>${rawProof.length} assets</h2>
          </div>
          <button class="secondary-button small" type="button" data-action="add-proof">Add</button>
        </div>
        <div class="asset-filters">
          <span>All</span>
          <span>Raw screens</span>
          <span>Store screens</span>
          <span>Imported</span>
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
      </div>

      <div class="flow-panel primary-panel">
        <div class="panel-heading compact-heading">
          <div>
            <p class="eyebrow">Detected claims</p>
            <h2>${app.claims.length} claims</h2>
          </div>
          <button class="secondary-button small" type="button" data-action="add-proof">Add custom claim</button>
        </div>
        <div class="claim-list">
          ${app.claims.length ? app.claims.map((claim) => claimRow(app, claim)).join('') : emptyInline('No detected claims yet. Add proof to start.')}
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
  const counts = appCounts(app);
  return `
    <section class="screen-head">
      <h1>Draft pack</h1>
      <p>Confirm the creative recipe before we generate drafts.</p>
    </section>
    <section class="work-surface setup-layout">
      <div class="flow-panel primary-panel">
        <div class="panel-heading">
          <span class="step-number">1</span>
          <div>
            <p class="eyebrow">Image Ads setup</p>
            <h2>Static ads for feeds. Auto-crops included.</h2>
          </div>
          <span class="toggle-pill is-on"></span>
        </div>

        <div class="setup-section">
          <h3>Approved claims (${counts.approvedClaims})</h3>
          <div class="approved-chip-row">
            ${app.claims.filter((claim) => claim.status === 'approved').map((claim) => `<span>${escapeHtml(shortText(claim.text, 36))}</span>`).join('') || '<span>No approved claims yet</span>'}
          </div>
        </div>

        <div class="setup-section">
          <h3>Layout style</h3>
          <div class="option-grid">
            ${checkbox('Product proof', 'layout:product_proof', state.config.imageSetup.layouts.includes('product_proof'), state.config.outputs.imageAds)}
            ${checkbox('Lifestyle', 'layout:lifestyle', state.config.imageSetup.layouts.includes('lifestyle'), state.config.outputs.imageAds)}
            ${checkbox('Comparison', 'layout:comparison', state.config.imageSetup.layouts.includes('comparison'), state.config.outputs.imageAds)}
          </div>
        </div>

        <div class="setup-section">
          <h3>Formats (auto-included)</h3>
          <div class="option-grid tight">
            ${checkbox('1:1', 'format:1:1', state.config.imageSetup.formats.includes('1:1'), state.config.outputs.imageAds)}
            ${checkbox('4:5', 'format:4:5', state.config.imageSetup.formats.includes('4:5'), state.config.outputs.imageAds)}
            ${checkbox('9:16', 'format:9:16', state.config.imageSetup.formats.includes('9:16'), state.config.outputs.imageAds)}
          </div>
        </div>

        <div class="setup-section ${state.config.outputs.ugcVideos ? '' : 'is-muted'}">
          <h3>Customize image layouts</h3>
          <button class="disclosure-row" type="button">Headlines, CTAs, color themes</button>
        </div>
      </div>

      <div class="flow-panel primary-panel ${state.config.outputs.ugcVideos ? '' : 'is-muted'}">
        <div class="panel-heading">
          <span class="step-number">2</span>
          <div>
            <p class="eyebrow">UGC Videos setup</p>
            <h2>Short-form videos with natural creators.</h2>
          </div>
          <span class="toggle-pill ${state.config.outputs.ugcVideos ? 'is-on' : ''}"></span>
        </div>
        <div class="control-row stacked">
          <label>Number of videos<input type="number" min="1" max="8" data-config="ugcCount" value="${state.config.ugcSetup.count}" ${state.config.outputs.ugcVideos ? '' : 'disabled'}></label>
          <label>Creator style
            <select data-config="ugcStyle" ${state.config.outputs.ugcVideos ? '' : 'disabled'}>
              ${option('natural', 'Natural & Authentic', state.config.ugcSetup.style)}
              ${option('energetic', 'Energetic', state.config.ugcSetup.style)}
              ${option('calm', 'Calm explainer', state.config.ugcSetup.style)}
            </select>
          </label>
          <label>Script length<input type="number" min="8" max="30" data-config="ugcDuration" value="${state.config.ugcSetup.durationSeconds}" ${state.config.outputs.ugcVideos ? '' : 'disabled'}></label>
        </div>
        <p class="info-note">Creators are optional. We'll use stock creators if none are added.</p>
        <button class="disclosure-row" type="button">Customize creators</button>
      </div>
    </section>
    <section class="generation-preview">
      <strong>Generation preview before spending</strong>
      ${miniStat('Image Ads', state.config.outputs.imageAds ? estimate.imageCount : 0)}
      ${miniStat('UGC Videos', state.config.outputs.ugcVideos ? state.config.ugcSetup.count : 0)}
      ${miniStat('Total deliverables', (state.config.outputs.imageAds ? estimate.imageCount : 0) + (state.config.outputs.ugcVideos ? state.config.ugcSetup.count : 0))}
      ${miniStat('Estimated credits', estimate.total)}
      <div class="action-row no-margin">
        <button class="secondary-button" type="button" data-step="proof">Back to proof review</button>
        <button class="primary-button" type="button" data-action="generate-drafts">${state.pack ? 'Regenerate drafts' : 'Generate drafts'}</button>
      </div>
      <p class="spend-note">Credits are only used when you click Generate drafts.</p>
    </section>
  `;
}

function renderDraftReview() {
  const pack = state.pack;
  return `
    <section class="screen-head">
      <h1>Review drafts</h1>
      <p>Approve the creatives you want in the final pack.</p>
    </section>
    <section class="review-tabs">
      <span class="is-active">Image Ads ${pack?.summary.imageCount || 0}</span>
      <span>UGC Videos ${pack?.summary.ugcCount || 0}</span>
      <button class="secondary-button small" type="button">All formats</button>
      <button class="secondary-button small" type="button">Sort by proof match</button>
    </section>
    <section class="work-surface review-layout">
      <div class="flow-panel primary-panel">
        ${pack ? draftGrid(pack) : emptyDrafts()}
      </div>
      <aside class="selected-creative-panel">
        ${pack ? selectedCreativePanel(pack.drafts[0]) : emptyInline('Generate drafts to inspect a selected creative.')}
      </aside>
    </section>
    ${pack ? ugcStrip(pack) : ''}
    <section class="action-row sticky-actions">
      <button class="secondary-button" type="button" data-step="setup">Back to setup</button>
      <button class="secondary-button" type="button" data-action="approve-all" ${pack ? '' : 'disabled'}>Approve all</button>
      <button class="primary-button" type="button" data-action="run-qa" ${pack ? '' : 'disabled'}>Run QA</button>
    </section>
  `;
}

function renderQaExport() {
  const qa = state.qa;
  const pack = state.pack;
  return `
    <section class="screen-head export-head">
      <div>
        <h1>Ready to export</h1>
        <p>Your pack passed the checks needed to hand off.</p>
      </div>
      <span class="qa-pass-pill">${qa ? 'All checks passed' : 'QA not run'}</span>
    </section>
    <section class="work-surface export-layout">
      <div class="flow-panel primary-panel">
        <div class="panel-heading">
          <span class="step-number">6</span>
          <div>
            <p class="eyebrow">Final QA summary</p>
            <h2>We checked everything that matters before export.</h2>
          </div>
        </div>
        ${qa ? qaChecks(qa) : emptyInline('Run QA from Review Drafts to unlock export.')}
        ${pack ? packContents(pack) : ''}
      </div>

      <div class="flow-panel export-panel">
        <h2>You're good to go.</h2>
        <p>Export your ad pack to your computer, ad inbox, or share with your team.</p>
        <button class="primary-button full export-cta" type="button" data-action="export-pack" ${qa && pack ? '' : 'disabled'}>Export pack</button>
        <span class="lock-note">No provider publishing until you choose a destination.</span>
        <div class="destination-list">
          ${destinationButton('download_zip', 'Download ZIP', 'All creatives, proofs, and docs')}
          ${destinationButton('ad_inbox', 'Send to ad inbox', 'Push to your ad inbox')}
          ${destinationButton('share_link', 'Copy share link', 'Share with team or client')}
        </div>
        <div class="action-row">
          <button class="secondary-button" type="button" data-step="review">Back to review</button>
        </div>
      </div>
    </section>
  `;
}

function appButton(app) {
  const counts = appCounts(app);
  const active = app.id === state.activeAppId;
  const status = counts.rawProof ? (counts.approvedClaims ? 'Ready' : 'Needs proof') : 'Needs proof';
  return `
    <button class="app-card ${active ? 'is-active' : ''}" type="button" data-app-id="${escapeAttr(app.id)}" style="--app-hue:${app.hue}">
      <span class="app-icon">${escapeHtml(app.icon)}</span>
      <span class="app-copy">
        <strong>${escapeHtml(app.name)}</strong>
        <small><b></b>${escapeHtml(status)}</small>
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

function outputChoice(id, title, detail, checked, estimate = '') {
  return `
    <label class="output-choice ${checked ? 'is-selected' : ''}">
      <input type="checkbox" data-output="${escapeAttr(id)}" ${checked ? 'checked' : ''}>
      <span class="output-icon ${id === 'imageAds' ? 'image' : 'video'}">${id === 'imageAds' ? 'IA' : 'UG'}</span>
      <span class="output-copy">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
        ${estimate ? `<em>${escapeHtml(estimate)}</em>` : ''}
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
      <div class="proof-thumb"><span>${escapeHtml(proof.kind === 'recording' ? 'REC' : 'APP')}</span><i></i><i></i><i></i></div>
      <div class="proof-meta-line"><span>${isStoreArt ? 'Store art - not proof' : 'Raw app screen'}</span></div>
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

  const imageDrafts = pack.drafts.filter((draft) => draft.type === 'image');
  return `
    <div class="draft-grid">
      ${imageDrafts.map((draft, index) => `
        <article class="draft-card" data-status="${escapeAttr(draft.status)}">
          <div class="draft-art" style="--draft-hue:${draft.hue || 160}">
            <span>${draft.type === 'image' ? escapeHtml(draft.format) : `${draft.durationSeconds}s`}</span>
            <strong>${escapeHtml(shortText(draft.headline || draft.hook, 42))}</strong>
            <i class="mock-phone one"></i>
            <i class="mock-phone two"></i>
          </div>
          <div class="draft-body">
            <small>${88 - (index % 4) * 4}% proof match</small>
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
    <div class="qa-list">
      ${qa.checks.map((check) => `
        <article class="qa-item" data-status="${escapeAttr(check.status)}">
          <span>${escapeHtml(check.status === 'pass' ? 'Pass' : check.status)}</span>
          <div>
            <strong>${escapeHtml(check.label)}</strong>
            <p>${escapeHtml(check.detail)}</p>
          </div>
          <em>${check.status === 'pass' ? '100%' : 'Review'}</em>
        </article>
      `).join('')}
    </div>
  `;
}

function destinationButton(id, label, detail) {
  const active = state.destination === id;
  return `
    <button class="destination-card ${active ? 'is-active' : ''}" type="button" data-destination="${escapeAttr(id)}">
      <span>${id === 'download_zip' ? 'ZIP' : id === 'ad_inbox' ? 'IN' : 'URL'}</span>
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(detail)}</small>
    </button>
  `;
}

function appSummaryBar(app) {
  const counts = appCounts(app);
  const estimate = estimateCost(app);
  return `
    <section class="app-summary-bar">
      <div class="summary-app">
        <span class="app-icon-large" style="--app-hue:${app.hue}">${escapeHtml(app.icon)}</span>
        <div>
          <strong>${escapeHtml(app.name)}</strong>
          <small>${escapeHtml(app.category)}</small>
        </div>
      </div>
      ${miniStat('Proof assets', counts.rawProof)}
      ${miniStat('Claims detected', counts.claims)}
      <div class="summary-stat wide"><span>Outputs selected</span><strong>${outputPills()}</strong></div>
      ${miniStat('Est. credits', estimate.total)}
      <button class="secondary-button" type="button" data-quick="import-app">Switch app</button>
    </section>
  `;
}

function miniStat(label, value) {
  return `<div class="summary-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function outputPills() {
  const pills = [];
  if (state.config.outputs.imageAds) {
    pills.push('<em class="output-pill image">Image Ads</em>');
  }
  if (state.config.outputs.ugcVideos) {
    pills.push('<em class="output-pill video">UGC Videos</em>');
  }
  return pills.join(' ');
}

function accordionRow(number, title, summary, stateName) {
  return `
    <article class="accordion-row is-${escapeAttr(stateName)}">
      <div class="accordion-index">${stateName === 'complete' ? 'Done' : number}</div>
      <div class="accordion-body">
        <div class="accordion-title collapsed">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(summary)}</p>
        </div>
      </div>
    </article>
  `;
}

function selectedCreativePanel(draft) {
  if (!draft) {
    return emptyInline('No selected creative.');
  }
  return `
    <div class="selected-head">
      <strong>Selected creative</strong>
      <span>${escapeHtml(draft.type === 'image' ? `${draft.format} Image Ad` : 'UGC Video')}</span>
    </div>
    <div class="selected-preview" style="--draft-hue:${draft.hue || 160}">
      <strong>${escapeHtml(shortText(draft.headline || draft.hook, 44))}</strong>
      <i></i>
    </div>
    <dl class="creative-detail-list">
      <div><dt>Headline</dt><dd>${escapeHtml(draft.headline || draft.hook)}</dd></div>
      <div><dt>Proof match</dt><dd>88%</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(draft.status)}</dd></div>
    </dl>
    <div class="qa-mini-list">
      <strong>Quality checks</strong>
      <span>Text readability <em>Good</em></span>
      <span>Brand fit <em>Good</em></span>
      <span>Claim accuracy <em>Good</em></span>
      <span>Visual quality <em>Good</em></span>
    </div>
    <button class="primary-button full" type="button" data-draft-id="${escapeAttr(draft.id)}" data-action="approved">Approve selected</button>
    <button class="secondary-button full" type="button" data-draft-id="${escapeAttr(draft.id)}" data-action="changes_requested">Request change</button>
  `;
}

function ugcStrip(pack) {
  const ugcDrafts = pack.drafts.filter((draft) => draft.type === 'ugc');
  if (!ugcDrafts.length) {
    return '';
  }
  return `
    <section class="ugc-strip">
      <div class="section-line"><strong>UGC Videos (${ugcDrafts.length})</strong><button class="text-button" type="button">View all videos</button></div>
      <div class="ugc-list">
        ${ugcDrafts.map((draft) => `
          <article class="ugc-card" style="--draft-hue:${draft.hue || 160}">
            <div class="ugc-thumb"><span>Play</span></div>
            <strong>${escapeHtml(shortText(draft.hook, 42))}</strong>
            <small>${draft.durationSeconds}s - ${escapeHtml(draft.status)}</small>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function packContents(pack) {
  return `
    <section class="pack-contents">
      <div class="section-line"><strong>Pack contents (${pack.summary.total} creatives)</strong></div>
      <div class="contents-grid">
        ${contentTile('Image Ads', pack.summary.imageCount, '1:1 - 4:5', 'image')}
        ${contentTile('UGC Videos', pack.summary.ugcCount, '9:16', 'video')}
        ${contentTile('QA Report', 1, 'PDF', 'report')}
        ${contentTile('Source Proof', pack.summary.derivedAssets, 'Raw screenshots', 'proof')}
        ${contentTile('Captions & Scripts', pack.summary.total, 'Ready to use', 'script')}
      </div>
    </section>
  `;
}

function contentTile(label, count, detail, type) {
  return `
    <article class="content-tile is-${escapeAttr(type)}">
      <span>${escapeHtml(type.toUpperCase().slice(0, 2))}</span>
      <strong>${escapeHtml(count)}</strong>
      <b>${escapeHtml(label)}</b>
      <small>${escapeHtml(detail)}</small>
    </article>
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

function stepStatus(step, activeIndex, index) {
  if (index < activeIndex) {
    return 'Completed';
  }
  if (index === activeIndex) {
    return step === 'setup' ? 'Setup in progress' : step === 'review' ? 'In progress' : step === 'export' ? 'Ready to export' : 'In progress';
  }
  return 'Not started';
}

function inspectorEyebrow() {
  if (state.currentStep === 'export') {
    return 'Ready to hand off';
  }
  if (state.currentStep === 'review') {
    return 'Selected next move';
  }
  return 'Recommended next move';
}

function shortText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
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
