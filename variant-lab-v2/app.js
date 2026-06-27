/* =================================================================
   Mobile Ad Agent — Variant Lab V2
   Lightweight, dependency-free interactions.
   No network calls. Provider mutations stay 0 by design.
   ================================================================= */
(function () {
  "use strict";

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- Toast ---------- */
  let toastTimer;
  const toastEl = $("[data-toast]");
  function toast(msg) {
    if (!toastEl) return;
    toastEl.innerHTML = '<span class="toast__dot"></span>' + msg;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add("is-show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("is-show");
      setTimeout(() => { toastEl.hidden = true; }, 260);
    }, 2600);
  }

  /* ---------- Variant switching ---------- */
  const variants = { a: $("#variant-a"), b: $("#variant-b"), c: $("#variant-c") };
  const switchBtns = $$(".switch__btn");

  function showVariant(key) {
    if (!variants[key]) return;
    Object.entries(variants).forEach(([k, el]) => {
      const on = k === key;
      el.classList.toggle("is-active", on);
      el.hidden = !on;
    });
    switchBtns.forEach((b) => {
      const on = b.dataset.go === key;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.documentElement.dataset.variant = key;
    if (key === "b") animateConfidence();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  switchBtns.forEach((b) => b.addEventListener("click", () => showVariant(b.dataset.go)));

  // keyboard: press A / B / C
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    const k = e.key.toLowerCase();
    if (["a", "b", "c"].includes(k)) showVariant(k);
  });

  /* =================================================================
     VARIANT A — Launchpad
     ================================================================= */

  // app selection updates context
  $$(".app").forEach((app) => {
    app.addEventListener("click", () => {
      $$(".app").forEach((a) => a.classList.remove("is-active"));
      app.classList.add("is-active");
      const name = app.dataset.app;
      const src = app.dataset.src || "";
      $$("[data-app-name]").forEach((el) => (el.textContent = name));
      const input = $("[data-url-input]", variants.a);
      if (input) input.placeholder = "https://" + src;
      detectSource(src, variants.a);
      toast("Switched workspace → <strong>" + name + "</strong>");
    });
  });

  $$("[data-add-app]").forEach((btn) =>
    btn.addEventListener("click", () => toast("Add app — paste a store or website URL to begin."))
  );

  $$(".recents__item").forEach((r) =>
    r.addEventListener("click", () => toast("Reopened recent import."))
  );

  // source auto-detection from the typed URL
  function detectSource(value, scope) {
    const v = (value || "").toLowerCase();
    let type = "web";
    if (v.includes("apps.apple.com") || v.includes("itunes")) type = "appstore";
    else if (v.includes("play.google.com")) type = "play";
    const label = { appstore: "App Store", play: "Play Store", web: "Website" }[type];
    $$("[data-src-chip]", scope || document).forEach((chip) =>
      chip.classList.toggle("is-on", chip.dataset.srcChip === type)
    );
    const hint = $("[data-import-hint]", scope || document);
    if (hint) hint.innerHTML = "Source auto-detected as <strong>" + label + "</strong>. We never post to ad networks.";
    return label;
  }

  // import forms (Variant A + Variant C)
  $$("[data-import-form]").forEach((form) => {
    const input = $("[data-url-input]", form);
    if (input) input.addEventListener("input", () => detectSource(input.value, form));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = (input && input.value.trim()) || (input && input.placeholder) || "";
      if (!val) { toast("Paste an App Store, Play Store, or website URL to start."); return; }
      const label = detectSource(val, form);
      const go = $("[data-import-go]", form);
      if (go) { go.textContent = "Pulling proof…"; go.disabled = true; }
      toast("Importing from <strong>" + label + "</strong> — pulling proof…");
      setTimeout(() => {
        if (go) { go.textContent = "Import proof"; go.disabled = false; }
        toast("Proof imported. <strong>Next: Proof Review →</strong>");
        // advance the flow strip
        const steps = $$(".flow__step");
        if (steps.length) {
          steps[0].classList.remove("is-current");
          steps[0].classList.add("is-done");
          steps[1].classList.add("is-current");
        }
        setTimeout(() => showVariant("b"), 650);
      }, 1100);
    });
  });

  /* =================================================================
     VARIANT B — Proof Room
     ================================================================= */

  // include / exclude allowed claims
  $$("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const claim = btn.closest("[data-claim]");
      const pressed = btn.getAttribute("aria-pressed") === "true";
      const next = !pressed;
      btn.setAttribute("aria-pressed", String(next));
      btn.textContent = next ? "Included" : "Excluded";
      if (claim) claim.classList.toggle("is-excluded", !next);
      updateAllowedCount();
    });
  });

  function updateAllowedCount() {
    const total = $$("[data-allowed] .claim__toggle[aria-pressed='true']").length;
    const el = $("[data-allowed-count]");
    if (el) el.textContent = String(total);
  }

  // "Why held?" disclosure
  const heldReasons = {
    0: "No snapshot in this import supports an award ranking. Add a source screenshot or App Store badge to release it.",
    1: "Third-party medical endorsements can’t be auto-verified. Held until a documented source is attached.",
  };
  $$("[data-why]").forEach((why, i) => {
    why.addEventListener("click", () => {
      const open = why.classList.toggle("is-open");
      const claim = why.closest("[data-claim-held]");
      let note = claim.querySelector(".claim__notewhy");
      if (open) {
        if (!note) {
          note = document.createElement("p");
          note.className = "claim__notewhy";
          note.style.cssText = "flex-basis:100%;margin:8px 0 0;font-size:12px;color:var(--ink-3);line-height:1.5;";
          claim.appendChild(note);
        }
        note.textContent = heldReasons[i] || "Held until a verifiable source is attached.";
        why.textContent = "Hide";
      } else {
        if (note) note.remove();
        why.textContent = "Why held?";
      }
    });
  });

  // animate the confidence ring when Variant B is shown
  let ringAnimated = false;
  function animateConfidence() {
    const fg = $(".conf__fg");
    if (!fg) return;
    const pct = parseFloat(fg.dataset.ring || "0.8");
    const len = 97.4;
    // reset then animate so it re-plays on revisit
    fg.style.strokeDashoffset = String(len);
    requestAnimationFrame(() => {
      fg.style.strokeDashoffset = String(len * (1 - pct));
    });
    ringAnimated = true;
  }

  const approveBtn = $("[data-approve-proof]");
  if (approveBtn) {
    approveBtn.addEventListener("click", () => {
      approveBtn.textContent = "Proof approved ✓";
      approveBtn.disabled = true;
      toast("Proof approved. <strong>Drafts unlocked → Creative Desk</strong>");
      setTimeout(() => showVariant("c"), 850);
    });
  }

  /* =================================================================
     VARIANT C — Creative Desk
     ================================================================= */

  // filter the queue by output type
  $$(".seg").forEach((seg) => {
    seg.addEventListener("click", () => {
      $$(".seg").forEach((s) => s.classList.remove("is-active"));
      seg.classList.add("is-active");
      const filter = seg.dataset.filter;
      $$("[data-card]").forEach((card) => {
        const show = filter === "all" || card.dataset.type === filter;
        card.classList.toggle("is-hidden", !show);
      });
    });
  });

  // app pills (visual only)
  $$(".apppill").forEach((p) =>
    p.addEventListener("click", () => {
      $$(".apppill").forEach((x) => x.classList.remove("is-active"));
      p.classList.add("is-active");
    })
  );

  // select a card -> populate detail panel
  const detail = {
    status: $("[data-detail-status]"),
    title: $("[data-detail-title]"),
    fmt: $("[data-detail-fmt]"),
    preview: $("[data-detail-preview]"),
  };
  const statusMeta = {
    ready: { cls: "tag--ready", label: "Ready" },
    qa:    { cls: "tag--qa", label: "In QA" },
    hold:  { cls: "tag--hold", label: "Held" },
  };
  const qaByStatus = {
    ready: [["Proof fidelity","pass"],["Claim trace","pass"],["Text / OCR legibility","pass"],["Safe-area & spec","pass"]],
    qa:    [["Proof fidelity","pass"],["Claim trace","pass"],["Text / OCR legibility","hold"],["Safe-area & spec","pass"]],
    hold:  [["Proof fidelity","pass"],["Claim trace","hold"],["Text / OCR legibility","pass"],["Safe-area & spec","pass"]],
  };

  function selectCard(card) {
    $$("[data-card]").forEach((c) => c.classList.remove("is-selected"));
    card.classList.add("is-selected");

    const status = card.dataset.status;
    const meta = statusMeta[status] || statusMeta.ready;
    if (detail.status) {
      detail.status.className = "tag " + meta.cls;
      detail.status.textContent = meta.label;
    }
    if (detail.title) detail.title.textContent = card.dataset.title;
    if (detail.fmt) detail.fmt.textContent = card.dataset.format;

    // clone the card's thumbnail into the preview
    if (detail.preview) {
      const thumb = card.querySelector(".thumb").cloneNode(true);
      thumb.classList.add("detail__art");
      detail.preview.innerHTML = "";
      detail.preview.appendChild(thumb);
    }

    // rebuild QA rows
    const qaList = $(".qa");
    if (qaList) {
      qaList.innerHTML = "";
      (qaByStatus[status] || qaByStatus.ready).forEach(([k, v]) => {
        const li = document.createElement("li");
        li.className = "qa__row is-" + v;
        li.innerHTML = '<span class="qa__k">' + k + '</span><span class="qa__v">' +
          (v === "pass" ? "Pass" : "Hold") + "</span>";
        qaList.appendChild(li);
      });
    }

    // toggle export availability for held/qa items
    const heldOrQa = status !== "ready";
    $$("[data-export]").forEach((btn) => {
      btn.disabled = heldOrQa;
      btn.style.opacity = heldOrQa ? ".45" : "";
      btn.style.cursor = heldOrQa ? "not-allowed" : "";
    });
  }

  $$("[data-card]").forEach((card) =>
    card.addEventListener("click", () => selectCard(card))
  );

  // export actions — local only, provider mutations stay 0
  let exports = 0;
  const exportCountEl = $("[data-export-count]");
  $$("[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      exports += 1;
      if (exportCountEl) exportCountEl.textContent = String(exports);
      toast(btn.textContent.trim() + " — local export only. <strong>Provider mutations 0</strong>");
    });
  });

  /* ---------- init ---------- */
  showVariant("a");
})();
