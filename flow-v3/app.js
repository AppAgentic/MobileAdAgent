const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  step: 1,
  maxUnlocked: 1,
  app: "Lumina Habits",
  source: "App Store",
  qty: 6,
  outputs: { image: true, ugc: true },
  selectedDraft: null,
  exports: 0
};

const sourceLabels = [
  { match: "apps.apple.com", label: "App Store" },
  { match: "play.google.com", label: "Google Play" }
];

const draftCopy = {
  ready: {
    label: "Ready",
    qa: [
      ["Proof fidelity", "Pass"],
      ["Claim trace", "Pass"],
      ["Text legibility", "Pass"],
      ["Safe-area and spec", "Pass"]
    ]
  },
  qa: {
    label: "In QA",
    qa: [
      ["Proof fidelity", "Pass"],
      ["Claim trace", "Pass"],
      ["Text legibility", "Review"],
      ["Safe-area and spec", "Review"]
    ]
  },
  hold: {
    label: "Held",
    qa: [
      ["Proof fidelity", "Blocked"],
      ["Claim trace", "Missing source"],
      ["Text legibility", "Not checked"],
      ["Safe-area and spec", "Not checked"]
    ]
  }
};

const toastEl = $("[data-toast]");
let toastTimer;

function showToast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add("is-show"));
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("is-show");
    setTimeout(() => {
      toastEl.hidden = true;
    }, 240);
  }, 2400);
}

function labelSource(value) {
  const normalized = value.toLowerCase();
  const matched = sourceLabels.find((item) => normalized.includes(item.match));
  if (matched) return matched.label;
  if (!normalized.trim()) return state.source;
  return "Website";
}

function setText(selector, text) {
  $$(selector).forEach((node) => {
    node.textContent = text;
  });
}

function unlock(step) {
  state.maxUnlocked = Math.max(state.maxUnlocked, step);
}

function showStep(nextStep) {
  if (nextStep > state.maxUnlocked) {
    showToast("Finish the current step first.");
    return;
  }

  state.step = nextStep;
  $$("[data-screen]").forEach((screen) => {
    const isActive = Number(screen.dataset.screen) === nextStep;
    screen.hidden = !isActive;
    screen.classList.toggle("is-active", isActive);
  });

  $$("[data-step-jump]").forEach((stepButton) => {
    const number = Number(stepButton.dataset.stepJump);
    stepButton.classList.toggle("is-current", number === nextStep);
    stepButton.classList.toggle("is-done", number < nextStep);
    stepButton.disabled = number > state.maxUnlocked;
    stepButton.setAttribute("aria-disabled", String(number > state.maxUnlocked));
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateSource(value) {
  state.source = labelSource(value);
  setText("[data-source-label]", state.source);
  setText("[data-current-source]", state.source);
}

function selectApp(button) {
  state.app = button.dataset.app;
  state.source = button.dataset.platform === "Android" ? "Google Play" : button.dataset.platform === "Web" ? "Website" : "App Store";

  $$(".app-pill").forEach((pill) => pill.classList.toggle("is-active", pill === button));
  setText("[data-current-app]", state.app);
  setText("[data-current-proof]", button.dataset.proof);
  setText("[data-source-label]", state.source);
  setText("[data-current-source]", state.source);

  const input = $("[data-url-input]");
  input.placeholder = `https://${button.dataset.src}`;
  input.value = "";
  showToast(`${state.app} selected.`);
}

function includedClaimCount() {
  return $$("[data-claim]").filter((claim) => !claim.classList.contains("is-excluded")).length;
}

function updateClaims() {
  setText("[data-approved-count]", String(includedClaimCount()));
}

function updatePackSummary() {
  const selectedOutputs = [];
  if (state.outputs.image) selectedOutputs.push("Image Ads");
  if (state.outputs.ugc) selectedOutputs.push("UGC Videos");

  setText("[data-qty-value]", String(state.qty));
  setText("[data-build-count]", String(state.qty));
  setText("[data-draft-count]", String(state.qty));
  setText("[data-build-outputs]", selectedOutputs.join(" + "));

  $$("[data-output]").forEach((button) => {
    const isSelected = state.outputs[button.dataset.output];
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function selectedAngles() {
  return $$("[data-angle]").filter((input) => input.checked).length;
}

function statusLabel(status) {
  return draftCopy[status]?.label || "Ready";
}

function cloneCreative(draft) {
  return $(".creative", draft).cloneNode(true);
}

function setPreview(targetSelector, draft) {
  const target = $(targetSelector);
  target.replaceChildren(cloneCreative(draft));
}

function updateStatusTag(node, status) {
  node.textContent = statusLabel(status);
  node.classList.remove("tag--ready", "tag--qa", "tag--hold");
  node.classList.add(`tag--${status}`);
}

function updateQaList(status) {
  const list = $("[data-qa-list]");
  const rows = draftCopy[status]?.qa || draftCopy.ready.qa;
  list.replaceChildren();
  rows.forEach(([label, result]) => {
    const item = document.createElement("li");
    const labelEl = document.createElement("span");
    const resultEl = document.createElement("b");
    labelEl.textContent = label;
    resultEl.textContent = result;
    if (result !== "Pass") resultEl.classList.add("is-warning");
    item.append(labelEl, resultEl);
    list.append(item);
  });
}

function selectDraft(draft) {
  state.selectedDraft = draft;
  $$("[data-draft]").forEach((card) => card.classList.toggle("is-selected", card === draft));

  const status = draft.dataset.status;
  updateStatusTag($("[data-detail-status]"), status);
  updateStatusTag($("[data-final-status]"), status);
  setText("[data-detail-title]", draft.dataset.title);
  setText("[data-final-title]", draft.dataset.title);
  setText("[data-detail-format]", draft.dataset.format);
  setText("[data-final-format]", draft.dataset.format);
  setPreview("[data-detail-preview]", draft);
  setPreview("[data-final-preview]", draft);
  updateQaList(status);

  const canExport = status === "ready";
  $$("[data-export]").forEach((button) => {
    button.disabled = !canExport;
  });
}

function applyDraftFilter(filter) {
  $$(".filter").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === filter);
  });

  $$("[data-draft]").forEach((draft) => {
    const isVisible = filter === "all" || draft.dataset.type === filter;
    draft.classList.toggle("is-hidden", !isVisible);
  });
}

function handleImport(event) {
  event.preventDefault();
  const input = $("[data-url-input]");
  const url = input.value.trim() || input.placeholder;
  updateSource(url);

  const button = $("[data-import-go]");
  button.disabled = true;
  button.textContent = "Pulling proof...";

  setTimeout(() => {
    button.disabled = false;
    button.textContent = "Import proof";
    unlock(2);
    showStep(2);
    showToast("Proof imported. Review claims before generation.");
  }, 520);
}

function handleProofApproval() {
  if (includedClaimCount() === 0) {
    showToast("Keep at least one approved claim before continuing.");
    return;
  }
  unlock(3);
  showStep(3);
  showToast("Proof approved. Choose output types.");
}

function handleBuildDrafts() {
  if (!state.outputs.image && !state.outputs.ugc) {
    showToast("Choose at least one output type.");
    return;
  }
  if (selectedAngles() === 0) {
    showToast("Choose at least one approved-proof angle.");
    return;
  }

  const button = $("[data-build-drafts]");
  button.disabled = true;
  button.textContent = "Generating...";

  setTimeout(() => {
    button.disabled = false;
    button.textContent = "Generate draft pack";
    unlock(4);
    showStep(4);
    selectDraft($("[data-draft].is-selected") || $("[data-draft]"));
    showToast(`${state.qty} proof-backed drafts are ready to review.`);
  }, 640);
}

function handleExport(event) {
  if (!state.selectedDraft || state.selectedDraft.dataset.status !== "ready") {
    showToast("Only ready drafts can export.");
    return;
  }
  state.exports += 1;
  setText("[data-export-count]", String(state.exports));
  showToast(`${event.currentTarget.textContent} prepared locally.`);
}

function init() {
  $$("[data-step-jump]").forEach((button) => {
    button.addEventListener("click", () => showStep(Number(button.dataset.stepJump)));
  });

  $$(".app-pill").forEach((button) => {
    button.addEventListener("click", () => selectApp(button));
  });

  $("[data-add-app]").addEventListener("click", () => {
    showStep(1);
    $("[data-url-input]").focus();
    showToast("Paste a URL to import another app.");
  });

  $$("[data-recent]").forEach((button) => {
    button.addEventListener("click", () => {
      const app = button.dataset.recent;
      const target = $(`.app-pill[data-app="${app}"]`);
      if (target) selectApp(target);
    });
  });

  $("[data-import-form]").addEventListener("submit", handleImport);
  $("[data-url-input]").addEventListener("input", (event) => updateSource(event.target.value));

  $$("[data-toggle-claim]").forEach((button) => {
    button.addEventListener("click", () => {
      const claim = button.closest("[data-claim]");
      const isIncluded = button.getAttribute("aria-pressed") === "true";
      button.setAttribute("aria-pressed", String(!isIncluded));
      button.textContent = isIncluded ? "Excluded" : "Included";
      claim.classList.toggle("is-excluded", isIncluded);
      updateClaims();
    });
  });

  $$("[data-why-held]").forEach((button) => {
    button.addEventListener("click", () => {
      const claim = button.closest(".claim");
      const existing = $(".held-note", claim);
      if (existing) {
        existing.remove();
        button.textContent = "Why held?";
        return;
      }
      const note = document.createElement("p");
      note.className = "held-note";
      note.textContent = button.dataset.reason;
      claim.append(note);
      button.textContent = "Hide";
    });
  });

  $("[data-approve-proof]").addEventListener("click", handleProofApproval);

  $$("[data-output]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.output;
      const selectedCount = Number(state.outputs.image) + Number(state.outputs.ugc);
      if (state.outputs[type] && selectedCount === 1) {
        showToast("Keep at least one output type selected.");
        return;
      }
      state.outputs[type] = !state.outputs[type];
      updatePackSummary();
    });
  });

  $$("[data-qty]").forEach((button) => {
    button.addEventListener("click", () => {
      state.qty = Math.min(12, Math.max(2, state.qty + Number(button.dataset.qty)));
      updatePackSummary();
    });
  });

  $$("[data-angle]").forEach((input) => {
    input.addEventListener("change", () => {
      if (selectedAngles() === 0) {
        input.checked = true;
        showToast("Keep at least one angle selected.");
      }
    });
  });

  $("[data-build-drafts]").addEventListener("click", handleBuildDrafts);

  $$(".filter").forEach((button) => {
    button.addEventListener("click", () => applyDraftFilter(button.dataset.filter));
  });

  $$("[data-draft]").forEach((draft) => {
    draft.addEventListener("click", () => selectDraft(draft));
  });

  $("[data-review-qa]").addEventListener("click", () => {
    if (!state.selectedDraft) selectDraft($("[data-draft]"));
    unlock(5);
    showStep(5);
    showToast("Final QA is ready.");
  });

  $$("[data-export]").forEach((button) => {
    button.addEventListener("click", handleExport);
  });

  updateClaims();
  updatePackSummary();
  selectDraft($("[data-draft].is-selected"));
  showStep(1);
}

init();
