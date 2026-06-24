const state = {
  sample: null,
  proofAssets: [],
  latestJob: null,
};

const elements = {
  appName: document.querySelector('#appName'),
  storeUrl: document.querySelector('#storeUrl'),
  audience: document.querySelector('#audience'),
  objective: document.querySelector('#objective'),
  avoidList: document.querySelector('#avoidList'),
  proofList: document.querySelector('#proofList'),
  addProofButton: document.querySelector('#addProofButton'),
  resetButton: document.querySelector('#resetButton'),
  generateButton: document.querySelector('#generateButton'),
  stageList: document.querySelector('#stageList'),
  jobStatus: document.querySelector('#jobStatus'),
  qaVerdict: document.querySelector('#qaVerdict'),
  qaChecks: document.querySelector('#qaChecks'),
  packSummary: document.querySelector('#packSummary'),
  timelineLayers: document.querySelector('#timelineLayers'),
  manifestPreview: document.querySelector('#manifestPreview'),
  downloadManifestButton: document.querySelector('#downloadManifestButton'),
  previewAppName: document.querySelector('#previewAppName'),
  proofWindowTitle: document.querySelector('#proofWindowTitle'),
  proofWindowClaim: document.querySelector('#proofWindowClaim'),
  captionStrip: document.querySelector('#captionStrip'),
  previewCta: document.querySelector('#previewCta'),
};

init();

async function init() {
  const response = await fetch('/api/sample-state');
  state.sample = await response.json();
  hydrateForm(state.sample);
  bindEvents();
  renderProofList();
  renderEmptyState();
}

function bindEvents() {
  elements.addProofButton.addEventListener('click', addProof);
  elements.resetButton.addEventListener('click', () => {
    hydrateForm(state.sample);
    renderProofList();
    renderEmptyState();
  });
  elements.generateButton.addEventListener('click', runJob);
  elements.downloadManifestButton.addEventListener('click', downloadManifest);
  [elements.appName, elements.storeUrl, elements.audience, elements.objective, elements.avoidList].forEach((field) => {
    field.addEventListener('input', () => {
      updatePreviewShell();
    });
  });
}

function hydrateForm(sample) {
  elements.appName.value = sample.appProfile.name;
  elements.storeUrl.value = sample.appProfile.storeUrl;
  elements.audience.value = sample.appProfile.audience;
  elements.objective.value = sample.appProfile.objective;
  elements.avoidList.value = sample.appProfile.avoidList;
  state.proofAssets = sample.proofAssets.map((proof) => ({ ...proof }));
  state.latestJob = null;
  elements.downloadManifestButton.disabled = true;
  updatePreviewShell();
}

function getInput() {
  return {
    appProfile: {
      name: elements.appName.value,
      storeUrl: elements.storeUrl.value,
      audience: elements.audience.value,
      channel: state.sample.appProfile.channel,
      objective: elements.objective.value,
      avoidList: elements.avoidList.value,
    },
    proofAssets: state.proofAssets,
    constraints: state.sample.constraints,
  };
}

async function runJob() {
  elements.generateButton.disabled = true;
  elements.generateButton.textContent = 'Running...';
  elements.jobStatus.textContent = 'running';
  try {
    const response = await fetch('/api/jobs/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(getInput()),
    });
    state.latestJob = await response.json();
    renderJob(state.latestJob);
  } finally {
    elements.generateButton.disabled = false;
    elements.generateButton.textContent = 'Run local job';
  }
}

function addProof() {
  const index = state.proofAssets.length + 1;
  state.proofAssets.push({
    id: `proof-local-${Date.now()}`,
    label: `New proof ${index}`,
    type: 'screen',
    trustLevel: 'raw_app_proof',
    source: 'local/browser',
    claim: 'Real app proof to verify before provider generation.',
    ocr: 'Uploaded app screen',
    visualCategory: 'screen',
  });
  renderProofList();
}

function removeProof(id) {
  state.proofAssets = state.proofAssets.filter((proof) => proof.id !== id);
  renderProofList();
}

function updateProof(id, key, value) {
  state.proofAssets = state.proofAssets.map((proof) => (
    proof.id === id ? { ...proof, [key]: value } : proof
  ));
}

function renderProofList() {
  elements.proofList.innerHTML = '';
  state.proofAssets.forEach((proof) => {
    const item = document.createElement('article');
    item.className = 'proof-item';
    item.innerHTML = `
      <div class="proof-line">
        <input aria-label="Proof label" value="${escapeAttribute(proof.label)}">
        <button class="small-button" type="button" title="Remove proof">x</button>
      </div>
      <textarea aria-label="Supported claim" rows="2">${escapeHtml(proof.claim)}</textarea>
      <div class="proof-meta">
        <span>${escapeHtml(proof.trustLevel)}</span>
        <span>${escapeHtml(proof.visualCategory)}</span>
      </div>
    `;
    const [labelInput, removeButton, claimInput] = [
      item.querySelector('input'),
      item.querySelector('button'),
      item.querySelector('textarea'),
    ];
    labelInput.addEventListener('input', (event) => updateProof(proof.id, 'label', event.target.value));
    claimInput.addEventListener('input', (event) => updateProof(proof.id, 'claim', event.target.value));
    removeButton.addEventListener('click', () => removeProof(proof.id));
    elements.proofList.appendChild(item);
  });
}

function renderEmptyState() {
  elements.stageList.innerHTML = '<div class="empty">Run a local job to populate agent stages.</div>';
  elements.qaChecks.innerHTML = '<div class="empty">QA checks will appear after generation.</div>';
  elements.packSummary.innerHTML = '<div class="empty">No creative pack yet.</div>';
  elements.timelineLayers.innerHTML = '';
  elements.manifestPreview.textContent = '{}';
  elements.qaVerdict.textContent = 'waiting';
  elements.jobStatus.textContent = 'not run';
}

function renderJob(job) {
  elements.jobStatus.textContent = job.status;
  elements.qaVerdict.textContent = job.qaReport.verdict;
  elements.qaVerdict.dataset.status = job.qaReport.verdict;
  elements.downloadManifestButton.disabled = false;

  elements.stageList.innerHTML = job.stages.map((stage) => `
    <button class="stage-row" type="button" data-status="${stage.status}">
      <span class="stage-order">${stage.order}</span>
      <span>
        <strong>${escapeHtml(stage.label)}</strong>
        <small>${escapeHtml(stage.output)}</small>
      </span>
      <em>${escapeHtml(stage.status)}</em>
    </button>
  `).join('');

  elements.qaChecks.innerHTML = job.qaReport.checks.map((check) => `
    <div class="qa-row" data-status="${check.status}">
      <span>${escapeHtml(check.status)}</span>
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        <p>${escapeHtml(check.detail)}</p>
      </div>
    </div>
  `).join('');

  elements.packSummary.innerHTML = `
    <dl>
      <div><dt>Pack</dt><dd>${escapeHtml(job.creativePack.packId)}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(job.creativePack.status)}</dd></div>
      <div><dt>Files</dt><dd>${job.creativePack.files.length}</dd></div>
      <div><dt>Cost</dt><dd>$${job.costLedger.actualProviderCost.toFixed(2)}</dd></div>
      <div><dt>Mutations</dt><dd>${job.providerMutations}</dd></div>
    </dl>
  `;

  elements.timelineLayers.innerHTML = job.composition.timeline.map((layer) => `
    <div class="layer-row">
      <span>${escapeHtml(layer.type)}</span>
      <strong>${escapeHtml(layer.id)}</strong>
      <small>${layer.start}s / ${layer.duration}s</small>
    </div>
  `).join('');

  updatePreviewFromJob(job);
  elements.manifestPreview.textContent = JSON.stringify(buildManifestPreview(job), null, 2);
}

function updatePreviewShell() {
  const appName = elements.appName.value || 'Mobile Ad Agent';
  elements.previewAppName.textContent = appName;
  elements.previewCta.textContent = `Try ${appName}`;
}

function updatePreviewFromJob(job) {
  const firstProof = job.proofAssets.find((proof) => proof.id === job.selectedProofIds[0]) || job.proofAssets[0];
  const hookCaption = job.script.captions.find((caption) => caption.role === 'hook');
  elements.previewAppName.textContent = job.appProfile.name;
  elements.proofWindowTitle.textContent = firstProof?.label || 'Proof asset';
  elements.proofWindowClaim.textContent = firstProof?.claim || 'Real app proof selected';
  elements.captionStrip.textContent = hookCaption?.text || 'Proof-driven creative';
  elements.previewCta.textContent = `Try ${job.appProfile.name}`;
}

function buildManifestPreview(job) {
  return {
    jobId: job.jobId,
    mode: job.mode,
    status: job.status,
    providerMutations: job.providerMutations,
    renderBackend: job.composition.backendId,
    generationBackend: job.generatedMedia.backendId,
    qaVerdict: job.qaReport.verdict,
    selectedProofIds: job.selectedProofIds,
  };
}

async function downloadManifest() {
  if (!state.latestJob) {
    return;
  }
  const response = await fetch('/api/jobs/manifest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state.latestJob),
  });
  const manifest = await response.json();
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.latestJob.jobId}-manifest.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
