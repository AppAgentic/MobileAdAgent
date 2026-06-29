const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  view: "home",
  currentApp: "Lumina Habits",
  memTab: "proof",
  importStep: 1,
  quantity: 6,
  outputs: { image: true, ugc: true },
  learningCount: 3,
  exports: 0,
  checklist: { import: true, proof: false, pack: false, review: false, export: false }
};

const CHECK_ORDER = ["import", "proof", "pack", "review", "export"];

const REASONS = {
  tweak: { label: "What should change?", chips: ["Tighten copy", "Swap proof asset", "Try a new hook"] },
  reject: { label: "Why reject?", chips: ["Too generic", "Unsupported claim", "Off-brand style"] }
};

const toastEl = $("[data-toast]");
let toastTimer;

function setText(selector, value) {
  $$(selector).forEach((node) => {
    node.textContent = value;
  });
}

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
  }, 2300);
}

function showView(view) {
  state.view = view;
  $$("[data-view]").forEach((screen) => {
    const active = screen.dataset.view === view;
    screen.hidden = !active;
    screen.classList.toggle("is-active", active);
  });

  $$("[data-nav]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.nav === view);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- App Memory tabs ---------- */
function setMemTab(tab) {
  state.memTab = tab;
  $$("[data-mem-tab]").forEach((button) => {
    const active = button.dataset.memTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$("[data-mem-panel]").forEach((panel) => {
    const active = panel.dataset.memPanel === tab;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
}

/* ---------- Readiness checklist ---------- */
function completeStep(step) {
  if (!(step in state.checklist)) return;
  state.checklist[step] = true;
  renderChecklist();
}

function renderChecklist() {
  const done = CHECK_ORDER.filter((step) => state.checklist[step]).length;
  const current = CHECK_ORDER.find((step) => !state.checklist[step]);

  $$("[data-step]").forEach((row) => {
    const step = row.dataset.step;
    const isDone = state.checklist[step];
    row.classList.toggle("is-done", isDone);
    row.classList.toggle("is-current", step === current);
  });

  setText("[data-ready-count]", `${done} / ${CHECK_ORDER.length} done`);
}

/* ---------- Drawer ---------- */
function openDrawer() {
  $("[data-pack-drawer]").hidden = false;
  $("[data-pack-goal]").focus();
}

function closeDrawer() {
  $("[data-pack-drawer]").hidden = true;
}

function updatePackSummary() {
  const selected = [];
  if (state.outputs.image) selected.push("Image Ads");
  if (state.outputs.ugc) selected.push("UGC Videos");
  const label = selected.join(" + ");

  setText("[data-qty-value]", String(state.quantity));
  setText("[data-pack-summary]", `${state.quantity} drafts from ${label}`);

  $$("[data-output]").forEach((button) => {
    const active = state.outputs[button.dataset.output];
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

/* ---------- App switching ---------- */
function selectApp(button) {
  state.currentApp = button.dataset.app;
  $$(".app-pill").forEach((pill) => pill.classList.toggle("is-active", pill === button));
  setText("[data-current-app]", state.currentApp);
  setText("[data-proof-count]", button.dataset.proof);
  setText("[data-held-count]", button.dataset.held);
  showView("home");
  showToast(`${state.currentApp} memory opened.`);
}

function syncActiveAppPill(appName) {
  let activePill = null;
  $$(".app-pill").forEach((pill) => {
    const active = pill.dataset.app === appName;
    pill.classList.toggle("is-active", active);
    if (active) activePill = pill;
  });
  activePill?.scrollIntoView({ block: "nearest", inline: "center" });
}

/* ---------- Import stepper ---------- */
function setImportStep(step) {
  state.importStep = step;
  $$("[data-import-step]").forEach((node) => {
    const index = Number(node.dataset.importStep);
    const locked = index > step;
    node.hidden = false;
    node.toggleAttribute("inert", locked);
    node.setAttribute("aria-disabled", String(locked));
    $$("button, input", node).forEach((control) => {
      control.disabled = locked;
    });
    node.classList.toggle("is-current", index === step);
    node.classList.toggle("is-done", index < step);
  });
}

/* ---------- Memory diff + learnings ---------- */
function addMemoryDiff(kind, text) {
  const list = $("[data-memory-diff]");
  if (!list) return;
  const item = document.createElement("li");
  const label = document.createElement("span");
  const body = document.createElement("b");
  const map = {
    add: { cls: "diff-add", tag: "+ added" },
    block: { cls: "diff-block", tag: "- blocked" },
    style: { cls: "diff-style", tag: "~ style" }
  };
  const meta = map[kind] || map.add;
  item.className = meta.cls;
  label.textContent = meta.tag;
  body.textContent = text;
  item.append(label, body);
  list.prepend(item);
}

function appendReviewDiff(text, isBlock) {
  const panel = $("[data-review-diff]");
  const list = $("[data-review-diff-list]");
  if (!panel || !list) return;
  panel.hidden = false;
  const item = document.createElement("li");
  if (isBlock) item.classList.add("is-block");
  item.textContent = text;
  list.prepend(item);
}

function addLearning(label, message) {
  state.learningCount += 1;
  setText("[data-learning-count]", String(state.learningCount));
  setText("[data-learning-count-mirror]", String(state.learningCount));

  const homeList = $("[data-home-learnings]");
  if (homeList) {
    const homeItem = document.createElement("li");
    const homeLabel = document.createElement("span");
    const homeText = document.createElement("b");
    homeLabel.textContent = label;
    homeText.textContent = message;
    homeItem.append(homeLabel, homeText);
    homeList.prepend(homeItem);
  }

  const events = $("[data-learning-events]");
  if (events) {
    const item = document.createElement("li");
    const eventLabel = document.createElement("span");
    const title = document.createElement("b");
    const detail = document.createElement("em");
    eventLabel.textContent = label;
    title.textContent = message;
    detail.textContent = "Will be inherited by the next pack";
    item.append(eventLabel, title, detail);
    events.prepend(item);
  }
}

/* ---------- Draft review ---------- */
function selectDraft(card) {
  $$("[data-draft]").forEach((draft) => draft.classList.toggle("is-selected", draft === card));

  const statusEl = card.querySelector(".draft-meta em");
  const status = statusEl ? statusEl.textContent : "Ready";

  setText("[data-selected-draft]", card.dataset.draft);
  setText("[data-review-why]", card.dataset.why || "");
  setText("[data-review-proof]", card.dataset.proof || "");
  setText("[data-review-kind]", card.dataset.kind || "");
  setText("[data-review-status]", status);

  resetReasonBlock();
}

function resetReasonBlock() {
  const block = $("[data-reason-block]");
  if (block) block.hidden = true;
  $$(".rev-btn").forEach((btn) => btn.classList.remove("is-chosen"));
}

function finalizeReview(verb, detail, kind, isBlock) {
  const draft = $("[data-selected-draft]").textContent;
  const message = `${verb}: ${draft}${detail ? ` (${detail})` : ""}`;
  addLearning(verb, message);
  addMemoryDiff(kind, message);
  appendReviewDiff(message, isBlock);
  completeStep("review");
  resetReasonBlock();
  showToast("App Memory updated from your review.");
}

function openReasonBlock(action, triggerBtn) {
  const config = REASONS[action];
  const block = $("[data-reason-block]");
  const chipWrap = $("[data-reason-chips]");
  if (!config || !block || !chipWrap) return;

  $$(".rev-btn").forEach((btn) => btn.classList.toggle("is-chosen", btn === triggerBtn));
  setText("[data-reason-label]", config.label);

  chipWrap.textContent = "";
  config.chips.forEach((chip) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = chip;
    button.addEventListener("click", () => {
      if (action === "tweak") {
        finalizeReview("Tweak", chip, "style", false);
      } else {
        finalizeReview("Reject", chip, "block", true);
      }
    });
    chipWrap.append(button);
  });

  block.hidden = false;
}

function handleReviewAction(button) {
  const action = button.dataset.reviewAction;
  if (action === "approve") {
    $$(".rev-btn").forEach((btn) => btn.classList.toggle("is-chosen", btn === button));
    finalizeReview("Approved as winner", "", "add", false);
    return;
  }
  openReasonBlock(action, button);
}

/* ---------- Init ---------- */
function init() {
  $$("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.nav));
  });

  $$("[data-show-view]").forEach((button) => {
    button.addEventListener("click", () => {
      showView(button.dataset.showView);
      if (button.dataset.memTarget) setMemTab(button.dataset.memTarget);
    });
  });

  $$("[data-mem-tab]").forEach((button) => {
    button.addEventListener("click", () => setMemTab(button.dataset.memTab));
  });

  $$("[data-open-pack]").forEach((button) => {
    button.addEventListener("click", openDrawer);
  });

  $("[data-close-pack]").addEventListener("click", closeDrawer);
  $("[data-pack-drawer]").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeDrawer();
  });

  $$("[data-open-empty]").forEach((button) => {
    button.addEventListener("click", () => {
      setImportStep(1);
      showView("empty");
    });
  });

  $$("[data-do-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const step = button.dataset.doStep;
      if (step === "proof") {
        completeStep("proof");
        showView("memory");
        setMemTab("proof");
        showToast("Proof confirmed. Memory is ready for packs.");
      }
    });
  });

  $$(".app-pill").forEach((button) => {
    button.addEventListener("click", () => selectApp(button));
  });

  /* Import: 3-step truth flow */
  $("[data-import-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("[data-url-input]");
    const value = (input.value.trim() || input.placeholder).toLowerCase();
    const importedName = value.includes("formroom")
      ? "Formroom Fitness"
      : value.includes("nomad")
        ? "Nomadly Travel"
        : "Lumina Habits";
    setText("[data-extract-name]", importedName);
    state.pendingApp = importedName;
    setImportStep(2);
    showToast("Extracted listing, screenshots, and reviews. Nothing saved yet.");
  });

  $$("[data-goto-step]").forEach((button) => {
    button.addEventListener("click", () => setImportStep(Number(button.dataset.gotoStep)));
  });

  $$("[data-truth] .truth-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const row = toggle.closest("[data-truth]");
      const on = row.classList.toggle("is-on");
      toggle.setAttribute("aria-pressed", String(on));
      toggle.textContent = on ? "Confirmed" : "Hold";
    });
  });

  $("[data-confirm-truth]").addEventListener("click", () => {
    const name = state.pendingApp || state.currentApp;
    state.currentApp = name;
    setText("[data-current-app]", name);
    syncActiveAppPill(name);
    completeStep("import");
    completeStep("proof");
    showView("home");
    showToast("Confirmed truth saved as App Memory.");
  });

  /* Pack drawer controls */
  $$("[data-output]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.output;
      const selectedCount = Number(state.outputs.image) + Number(state.outputs.ugc);
      if (state.outputs[type] && selectedCount === 1) {
        showToast("Keep at least one output selected.");
        return;
      }
      state.outputs[type] = !state.outputs[type];
      updatePackSummary();
    });
  });

  $$("[data-qty]").forEach((button) => {
    button.addEventListener("click", () => {
      state.quantity = Math.min(12, Math.max(2, state.quantity + Number(button.dataset.qty)));
      updatePackSummary();
    });
  });

  $("[data-start-pack]").addEventListener("click", () => {
    closeDrawer();
    completeStep("pack");
    showView("pack");
    showToast(`${state.quantity} draft pack started from app memory.`);
  });

  /* Review console */
  $$("[data-draft]").forEach((card) => {
    card.addEventListener("click", () => selectDraft(card));
  });

  $$("[data-review-action]").forEach((button) => {
    button.addEventListener("click", () => handleReviewAction(button));
  });

  $("[data-export]").addEventListener("click", () => {
    state.exports += 1;
    completeStep("export");
    addLearning("Export", "Approved draft saved as a style reference");
    addMemoryDiff("add", "Export saved as a style reference");
    showToast(`Export ${state.exports} prepared locally.`);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("[data-pack-drawer]").hidden) closeDrawer();
  });

  updatePackSummary();
  renderChecklist();
  setMemTab("proof");
  setImportStep(1);
  showView("home");
}

init();
