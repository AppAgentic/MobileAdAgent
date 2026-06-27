/* =================================================================
   Mobile Ad Agent — Variant Lab
   Plain JS: variant switching + light per-variant interactivity.
   No build step, no dependencies.
   ================================================================= */
(function () {
  "use strict";

  /* ---- Variant switcher (shared top chrome) -------------------- */
  const switchBtns = document.querySelectorAll(".variant-switch__btn");
  const stages = document.querySelectorAll(".stage");

  function selectVariant(key) {
    switchBtns.forEach((b) => {
      const on = b.dataset.variant === key;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    stages.forEach((s) => s.classList.toggle("is-active", s.dataset.variant === key));
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  switchBtns.forEach((b) =>
    b.addEventListener("click", () => selectVariant(b.dataset.variant))
  );

  // Keyboard: press A / B / C to jump between variants.
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    const k = e.key.toLowerCase();
    if (["a", "b", "c"].includes(k)) selectVariant(k);
  });

  /* ---- Variant A: source segmented control --------------------- */
  const intake = document.getElementById("aIntake");
  if (intake) {
    const opts = intake.querySelectorAll(".seg__opt");
    const urlField = document.getElementById("aUrl");
    const placeholders = {
      appstore: "https://apps.apple.com/app/focushabit/id482910337",
      play: "https://play.google.com/store/apps/details?id=com.focushabit.app",
      web: "https://focushabit.app",
    };
    opts.forEach((o) =>
      o.addEventListener("click", () => {
        opts.forEach((x) => x.classList.remove("is-active"));
        o.classList.add("is-active");
        urlField.placeholder = placeholders[o.dataset.source] || "";
      })
    );

    // Import -> reveal detected app card.
    const detected = document.getElementById("aDetected");
    intake.addEventListener("submit", (e) => {
      e.preventDefault();
      detected.classList.add("is-shown");
      detected.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    // Pre-shown so the surface never looks empty on load.
    detected.classList.add("is-shown");
  }

  /* ---- Shared: credit estimate from output steppers ------------ */
  // Computes total credits = sum(count * per-unit credit) for enabled outputs.
  function wireOutputs(rootId, creditEl, getRows, baseFloor) {
    const root = document.getElementById(rootId);
    const out = document.getElementById(creditEl);
    if (!root || !out) return;

    function recompute() {
      let total = baseFloor || 0;
      getRows(root).forEach((row) => {
        if (row.enabled) total += row.count * row.unit;
      });
      out.textContent = total;
    }

    root.querySelectorAll("[data-dir]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const counter = btn.parentElement.querySelector("[data-count], b");
        let n = parseInt(counter.textContent, 10) || 0;
        n = Math.max(0, n + parseInt(btn.dataset.dir, 10));
        counter.textContent = n;
        recompute();
      });
    });

    // Toggle enable on checkbox (variant A only).
    root.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        cb.closest("[data-out]").classList.toggle("is-on", cb.checked);
        recompute();
      });
    });

    recompute();
  }

  // Variant A rows.
  wireOutputs("aOutputs", "aCredits", (root) =>
    Array.from(root.querySelectorAll("[data-out]")).map((el) => ({
      enabled: el.querySelector('input[type="checkbox"]').checked,
      count: parseInt(el.querySelector("[data-count]").textContent, 10) || 0,
      unit: parseInt(el.dataset.credit, 10) || 0,
    }))
  );

  // Variant B rows (always enabled, no checkbox).
  wireOutputs("bOutputs", "bCredits", (root) =>
    Array.from(root.querySelectorAll("[data-out]")).map((el) => ({
      enabled: true,
      count: parseInt(el.querySelector("[data-count]").textContent, 10) || 0,
      unit: parseInt(el.dataset.credit, 10) || 0,
    }))
  );

  /* ---- Variant B: step rail selection -------------------------- */
  const bRail = document.getElementById("bRail");
  if (bRail) {
    bRail.querySelectorAll(".vrail__step").forEach((step) => {
      step.addEventListener("click", () => {
        bRail
          .querySelectorAll(".vrail__step")
          .forEach((s) => s.classList.remove("is-current"));
        step.classList.add("is-current");
      });
    });
  }

  /* ---- Variant C: draft cards data + render -------------------- */
  const drafts = [
    {
      id: "img03", type: "image", label: "IMAGE AD",
      title: "FitTrack — “Track every workout” hero",
      qa: "pass", qaText: "QA passed", proof: "3 proof sources · OCR clean",
      tint: "linear-gradient(160deg,#ff6b5b22,#ff8f5b11)",
      qaItems: [
        ["ok", "OCR text matches source copy"],
        ["ok", "Claim backed by store rating (4.6★)"],
        ["ok", "Proof fidelity 0.97 vs screenshot"],
        ["ok", "Brand color + icon verified"],
      ],
      cites: [["S1", "Workout summary screen", "screenshot 2"], ["S3", "“4.6★ rated” ", "store metadata"]],
    },
    {
      id: "img01", type: "image", label: "IMAGE AD",
      title: "FitTrack — streak milestone layout",
      qa: "hold", qaText: "Hold · claim", proof: "1 claim unsourced",
      tint: "linear-gradient(160deg,#ff7a6b22,#ffae5b11)",
      qaItems: [
        ["ok", "OCR text legible"],
        ["hold", "“Most loved fitness app” — no source"],
        ["ok", "Proof fidelity 0.94 vs screenshot"],
        ["warn", "Crop trims status bar — re-check"],
      ],
      cites: [["S1", "Streak detail screen", "screenshot 5"], ["!", "Unsourced superlative", "blocked at QA"]],
    },
    {
      id: "img02", type: "image", label: "IMAGE AD",
      title: "FitTrack — progress chart proof",
      qa: "review", qaText: "In review", proof: "2 proof sources",
      tint: "linear-gradient(160deg,#6f9bff22,#7b5bff11)",
      qaItems: [
        ["ok", "Chart matches in-app data render"],
        ["ok", "No fabricated values detected"],
        ["warn", "Awaiting human approval"],
        ["ok", "Brand color verified"],
      ],
      cites: [["S1", "Progress chart screen", "screenshot 7"], ["S2", "Icon + #FF6B5B", "asset"]],
    },
    {
      id: "img04", type: "image", label: "IMAGE AD",
      title: "FitTrack — feature grid",
      qa: "review", qaText: "In review", proof: "4 proof sources",
      tint: "linear-gradient(160deg,#3fd99a22,#2bb67311)",
      qaItems: [
        ["ok", "All 4 features traced to description"],
        ["ok", "Icons match in-app UI"],
        ["warn", "Awaiting human approval"],
        ["ok", "OCR clean"],
      ],
      cites: [["S3", "Feature list", "description"], ["S1", "Home screen", "screenshot 1"]],
    },
    {
      id: "ugc01", type: "ugc", label: "UGC VIDEO",
      title: "FitTrack — “I finally stuck with it” (0:24)",
      qa: "pass", qaText: "QA passed", proof: "4 proof cutaways",
      tint: "linear-gradient(160deg,#ff6b5b22,#6f9bff11)",
      qaItems: [
        ["ok", "Spoken claims match app cutaways"],
        ["ok", "Duration 24s within spec"],
        ["ok", "Codec / loudness pass"],
        ["ok", "No dead zones > 1.0s"],
      ],
      cites: [["S1", "Workout + streak screens", "cutaways"], ["S3", "Feature mentions", "description"]],
    },
    {
      id: "ugc02", type: "ugc", label: "UGC VIDEO",
      title: "FitTrack — “my coach in my pocket” (0:18)",
      qa: "review", qaText: "In review", proof: "3 proof cutaways",
      tint: "linear-gradient(160deg,#7b5bff22,#ff8f5b11)",
      qaItems: [
        ["ok", "Cutaways verified against screenshots"],
        ["ok", "Duration 18s within spec"],
        ["warn", "Awaiting human approval"],
        ["ok", "Caption language matches audio"],
      ],
      cites: [["S1", "Coaching screen", "screenshot 4"], ["S2", "Brand assets", "icon"]],
    },
  ];

  const cardGrid = document.getElementById("cCards");
  const detailEl = document.getElementById("cDetail");

  function qaClass(qa) {
    return qa === "pass" ? "pass" : qa === "hold" ? "hold" : "review";
  }

  function renderCards(filter) {
    if (!cardGrid) return;
    cardGrid.innerHTML = "";
    drafts
      .filter((d) => filter === "all" || d.type === filter)
      .forEach((d) => {
        const card = document.createElement("article");
        card.className = "dcard" + (d.id === selectedId ? " is-selected" : "");
        card.dataset.id = d.id;
        const media =
          d.type === "ugc"
            ? `<div class="dcard__media dcard__media--ugc" style="background:${d.tint}">
                 <span class="dcard__type">${d.label}</span>
                 <div class="dcard__phone"></div>
                 <div class="dcard__play"><span>▶</span></div>
               </div>`
            : `<div class="dcard__media" style="background:${d.tint}">
                 <span class="dcard__type">${d.label}</span>
                 <div class="dcard__phone"></div>
               </div>`;
        card.innerHTML = `
          ${media}
          <div class="dcard__body">
            <p class="dcard__title">${d.title}</p>
            <div class="dcard__row">
              <span class="qabadge qabadge--${qaClass(d.qa)}">${d.qaText}</span>
              <span class="dcard__proof">${d.proof}</span>
            </div>
          </div>`;
        card.addEventListener("click", () => {
          selectedId = d.id;
          renderCards(currentFilter);
          renderDetail(d);
        });
        cardGrid.appendChild(card);
      });
  }

  function renderDetail(d) {
    if (!detailEl) return;
    const qaItems = d.qaItems
      .map(
        ([state, text]) =>
          `<li class="${state}"><i>${state === "ok" ? "✓" : state === "hold" ? "!" : "•"}</i> ${text}</li>`
      )
      .join("");
    const cites = d.cites
      .map(
        ([k, t, e]) =>
          `<li><span class="proofcite__k">${k}</span><div><strong>${t}</strong><em>${e}</em></div></li>`
      )
      .join("");
    const canExport = d.qa === "pass";
    detailEl.innerHTML = `
      <div class="c-detail__head">
        <h3>Draft detail</h3>
        <span class="qabadge qabadge--${qaClass(d.qa)}">${d.qaText}</span>
      </div>
      <div class="c-detail__preview" style="background:${d.tint}">
        <div class="dcard__phone"></div>
      </div>
      <h4>${d.title}</h4>
      <h4 style="margin-top:18px">QA checks</h4>
      <ul class="qalist">${qaItems}</ul>
      <h4>Proof &amp; citations</h4>
      <ul class="proofcite">${cites}</ul>
      <div class="c-detail__acts">
        ${
          canExport
            ? `<button class="btn btn--solid">Approve &amp; vault</button><button class="btn btn--ghost">Download</button>`
            : `<button class="btn btn--ghost">Request repair</button><button class="btn" disabled>Locked</button>`
        }
      </div>`;
  }

  let currentFilter = "all";
  let selectedId = drafts[0].id;

  if (cardGrid) {
    renderCards(currentFilter);
    renderDetail(drafts[0]);

    document.querySelectorAll(".c-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".c-tab").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        currentFilter = tab.dataset.filter;
        renderCards(currentFilter);
      });
    });
  }
})();
