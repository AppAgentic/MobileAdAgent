const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  view: "home",
  currentApp: "Lumina Habits",
  quantity: 6,
  outputs: { image: true, ugc: true },
  learningCount: 3,
  exports: 0
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

function selectApp(button) {
  state.currentApp = button.dataset.app;
  $$(".app-pill").forEach((pill) => pill.classList.toggle("is-active", pill === button));
  setText("[data-current-app]", state.currentApp);
  setText("[data-proof-count]", button.dataset.proof);
  setText("[data-held-count]", button.dataset.held);
  showView("home");
  showToast(`${state.currentApp} memory opened.`);
}

function addLearning(message) {
  state.learningCount += 1;
  setText("[data-learning-count]", String(state.learningCount));

  const homeList = $("[data-home-learnings]");
  const homeItem = document.createElement("li");
  const homeLabel = document.createElement("span");
  const homeText = document.createElement("b");
  homeLabel.textContent = "New review signal";
  homeText.textContent = message;
  homeItem.append(homeLabel, homeText);
  homeList.prepend(homeItem);

  const events = $("[data-learning-events]");
  const item = document.createElement("li");
  const label = document.createElement("span");
  const title = document.createElement("b");
  const detail = document.createElement("em");
  label.textContent = "Just saved";
  title.textContent = message;
  detail.textContent = "Will be inherited by the next pack";
  item.append(label, title, detail);
  events.prepend(item);

  showToast("Learning saved to app memory.");
}

function init() {
  $$("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.nav));
  });

  $$("[data-show-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.showView));
  });

  $$("[data-open-pack]").forEach((button) => {
    button.addEventListener("click", openDrawer);
  });

  $("[data-close-pack]").addEventListener("click", closeDrawer);
  $("[data-pack-drawer]").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeDrawer();
  });

  $$("[data-open-empty]").forEach((button) => {
    button.addEventListener("click", () => showView("empty"));
  });

  $$(".app-pill").forEach((button) => {
    button.addEventListener("click", () => selectApp(button));
  });

  $("[data-import-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("[data-url-input]");
    const value = input.value.trim() || input.placeholder;
    const importedName = value.includes("formroom") ? "Formroom Fitness" : value.includes("nomad") ? "Nomadly Travel" : "Lumina Habits";
    state.currentApp = importedName;
    setText("[data-current-app]", importedName);
    showView("home");
    showToast("App profile and proof memory created.");
  });

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
    showView("pack");
    showToast(`${state.quantity} draft pack started from app memory.`);
  });

  $$("[data-draft]").forEach((card) => {
    card.addEventListener("click", () => {
      $$("[data-draft]").forEach((draft) => draft.classList.toggle("is-selected", draft === card));
      setText("[data-selected-draft]", card.dataset.draft);
    });
  });

  $$("[data-feedback]").forEach((button) => {
    button.addEventListener("click", () => {
      addLearning(button.dataset.feedback);
      showView("learnings");
    });
  });

  $("[data-export]").addEventListener("click", () => {
    state.exports += 1;
    addLearning("Exported draft marked as approved style reference");
    showToast(`Export ${state.exports} prepared locally.`);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("[data-pack-drawer]").hidden) closeDrawer();
  });

  updatePackSummary();
  showView("home");
}

init();
