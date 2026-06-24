// Studio web client — no framework, no build step.
const $ = (id) => document.getElementById(id);
const STAGE_LABELS = {
  intake: 'Intake',
  proof_library: 'Proof library',
  creative_brief: 'Brief',
  script: 'Script',
  generation: 'Generation',
  timeline: 'Timeline',
  qa: 'QA',
  pack: 'Pack',
};

let lastJob = null;
let activeStage = 'qa';

function parseProofLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [label, kind, ocr, category] = line.split('|').map((s) => (s || '').trim());
      return {
        label: label || `Proof ${i + 1}`,
        kind: kind || 'raw_screenshot',
        source: `local/${(label || 'proof').toLowerCase().replace(/\s+/g, '-')}.png`,
        ocrText: ocr || '',
        dimensions: { width: 1170, height: 2532 },
        visualCategory: category || 'unknown',
        // In the UI we let any raw proof support the first product fact for the demo.
        supportsFacts: [],
      };
    });
}

function collectIntake() {
  const productFacts = $('productFacts').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const proofAssets = parseProofLines($('proofAssets').value);
  // Attach first product fact to each raw proof so claims can trace in the demo.
  for (const p of proofAssets) {
    if (p.kind !== 'store_screenshot' && productFacts.length) p.supportsFacts = [productFacts[0]];
  }
  const attrs = Number($('identityAttrs').value) || 0;
  const identityTransform = {};
  const names = ['faceShape', 'hairColorStyle', 'skinToneShade', 'age', 'eyeColor', 'tattoos'];
  for (let i = 0; i < attrs; i += 1) identityTransform[names[i]] = 'changed';

  return {
    app: {
      name: $('appName').value,
      storeUrl: $('storeUrl').value,
      audience: $('audience').value,
      tone: $('tone').value,
      productFacts,
      avoidClaims: $('avoidClaims').value.split('\n').map((s) => s.trim()).filter(Boolean),
    },
    pack: {
      formats: ['ugc_video', 'thumbnail'],
      durationSeconds: Number($('durationSeconds').value) || 18,
      aspectRatio: $('aspectRatio').value,
      costCeilingUsd: Number($('costCeilingUsd').value) || 12,
      channels: ['tiktok', 'instagram_reels'],
    },
    proofAssets,
    creatorProfile: { creatorProfileId: 'creator_ui', rightsStatus: 'approved', identityTransform },
  };
}

async function loadSample() {
  const sample = await (await fetch('/api/sample-intake')).json();
  $('appName').value = sample.app.name;
  $('storeUrl').value = sample.app.storeUrl;
  $('audience').value = sample.app.audience;
  $('tone').value = sample.app.tone;
  $('productFacts').value = sample.app.productFacts.join('\n');
  $('avoidClaims').value = sample.app.avoidClaims.join('\n');
  $('proofAssets').value = sample.proofAssets
    .map((p) => `${p.label} | ${p.kind} | ${p.ocrText} | ${p.visualCategory}`)
    .join('\n');
  $('durationSeconds').value = sample.pack.durationSeconds;
  $('aspectRatio').value = sample.pack.aspectRatio;
  $('costCeilingUsd').value = sample.pack.costCeilingUsd;
  $('identityAttrs').value = Object.values(sample.creatorProfile.identityTransform).filter(Boolean).length;
}

async function run() {
  $('statusPill').textContent = 'running…';
  $('statusPill').className = 'pill pill-idle';
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(collectIntake()),
  });
  lastJob = await res.json();
  render(lastJob);
}

function statusClass(job) {
  if (job.status === 'ready_to_export') return 'pill-ok';
  if (job.status === 'held') return 'pill-warn';
  return 'pill-hold';
}

function render(job) {
  const pill = $('statusPill');
  pill.textContent = job.status;
  pill.className = `pill ${statusClass(job)}`;

  const stages = $('stages');
  stages.innerHTML = '';
  for (const key of job.stageOrder) {
    const li = document.createElement('li');
    li.textContent = STAGE_LABELS[key] || key;
    let cls = 's-info';
    if (key === 'qa') cls = job.stages.qa.passed ? 's-ok' : 's-hold';
    else if (job.stages[key]?.blocked) cls = 's-hold';
    else cls = 's-ok';
    li.className = cls + (key === activeStage ? ' active' : '');
    li.onclick = () => { activeStage = key; render(job); };
    stages.appendChild(li);
  }
  renderDetail(job, activeStage);
}

function card(title, inner) {
  return `<div class="card"><h4>${title}</h4>${inner}</div>`;
}
function kv(obj) {
  return `<dl class="kv">${Object.entries(obj).map(([k, v]) => `<dt>${k}</dt><dd>${fmt(v)}</dd>`).join('')}</dl>`;
}
function fmt(v) {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length ? v.map(fmt).join('<br>') : '—';
  if (typeof v === 'object') return `<code>${escapeHtml(JSON.stringify(v))}</code>`;
  return escapeHtml(String(v));
}
function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function renderDetail(job, stage) {
  const d = $('detail');
  const s = job.stages[stage];
  let html = '';

  if (stage === 'intake') {
    html += card('App profile', kv({
      appId: s.profile.appId, name: s.profile.name, platforms: s.profile.platforms,
      audience: s.profile.audience, facts: s.profile.productFacts, avoid: s.profile.avoidClaims,
    }));
    html += card('Pack request', kv(s.packRequest));
  } else if (stage === 'proof_library') {
    html += card('Usable proof', kv({ usableProofIds: s.usableProofIds, facts: s.facts.map((f) => f.text) }));
    html += s.objects.map((o) => card(`${o.label} <small>(${o.trustLevel})</small>`, kv({
      kind: o.kind, usableAsProof: o.usableAsProof, visualCategory: o.visualCategory,
      ocr: o.ocrText, flags: o.unsafeReasons,
    }))).join('');
  } else if (stage === 'creative_brief') {
    html += card('Creative brief', kv({
      briefId: s.briefId, formatFamily: s.formatFamily, hookAngle: s.hookAngle,
      hookConcept: s.hookConcept, heroProofId: s.heroProofId, cutawayProofIds: s.cutawayProofIds,
      durationSeconds: s.targetDurationSeconds,
    }));
    html += card('Acceptance criteria', `<ul class="activity">${s.acceptanceCriteria.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`);
  } else if (stage === 'script') {
    if (s.blocked) { html += card('Script', '<p class="hint">Blocked — no hero proof.</p>'); }
    else {
      const beats = s.beats.map((b) => `<div class="beat"><span class="role">${b.role}</span><span class="t">${b.startSeconds}–${b.endSeconds}s</span><span>${escapeHtml(b.line)}</span></div>`).join('');
      html += card('Script beats', beats);
      html += card('Captions & claim trace', kv({
        hookCaption: s.hookCaption, ctaCaption: s.ctaCaption, primaryFact: s.claimTrace.primaryFact,
        avoidFlags: s.avoidFlags.map((f) => f.line),
      }));
    }
  } else if (stage === 'generation') {
    html += card('Generation plan (our pipeline — never HeyGen)', kv({
      backendId: s.backendId, taskCount: s.tasks.length, estimateUsd: s.estimateUsd,
      costCeilingUsd: s.costCeilingUsd, overCeiling: s.overCeiling,
      identityAttributesChanged: s.identityAttributesChanged, providerMutations: s.providerMutations,
    }));
    html += s.tasks.map((t) => card(`${t.kind} <small>(${t.backendId})</small>`, kv({
      status: t.status, estimatedCostUsd: t.estimatedCostUsd, idempotencyKey: t.idempotencyKey,
    }))).join('');
  } else if (stage === 'timeline') {
    if (s.blocked) { html += card('Timeline', '<p class="hint">Blocked.</p>'); }
    else {
      const c = s.composition;
      html += card('HyperFrames composition (HyperFrames-first)', kv({
        compositionId: c.compositionId, engine: c.engine, dimensions: c.dimensions,
        fps: c.fps, durationSeconds: c.durationSeconds, scenes: c.scenes.length,
        thumbnailHoldAt: c.thumbnailHold.atSeconds + 's',
      }));
      html += card('Render finishing task (RenderBackend only)', kv({
        backendId: s.renderTask.backendId, swappable: s.renderTask.swappableBackends,
        format: s.renderTask.format, estimatedCostUsd: s.renderTask.estimatedCostUsd,
        status: s.renderTask.status, providerMutations: s.renderTask.providerMutations,
      }));
      html += card('Scenes', c.scenes.map((sc) => `<div class="beat"><span class="role">${sc.role}</span><span class="t">${sc.startSeconds}–${sc.endSeconds}s</span><span>${sc.proofCutaway ? 'proof: ' + sc.proofCutaway.proofObjectId : 'creator only'}</span></div>`).join(''));
    }
  } else if (stage === 'qa') {
    const q = s;
    html += card('Verdict', kv({ verdict: q.verdict, passed: q.passed, blockers: q.blockers.length, warnings: q.warnings.length, providerMutations: q.providerMutations }));
    html += card('Checks', `<ul class="checks">${q.checks.map((c) => `<li class="c-${c.ok ? 'ok' : c.severity}">${escapeHtml(c.message)}</li>`).join('')}</ul>`);
  } else if (stage === 'pack') {
    html += card('Manifest', `<pre>${escapeHtml(JSON.stringify(job.manifest, null, 2))}</pre>`);
  }

  if (job.activity?.length) {
    html += card('Activity feed', `<ul class="activity">${job.activity.map((a) => `<li><span class="note-stage">${a.stage}</span> — ${escapeHtml(a.note)}</li>`).join('')}</ul>`);
  }
  d.innerHTML = html;
}

$('loadSample').onclick = loadSample;
$('runBtn').onclick = run;
loadSample();
