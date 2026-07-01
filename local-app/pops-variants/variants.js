/* Mobile Ad Agent — Pops-inspired variants
   Local-only JS. No network calls. Renders mock rail content and handles
   variant switching, the import demo, and the review decision.
   All data below is illustrative mock proof — no real provider state. */

(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };

  const grad = (a, b, angle) =>
    `background:linear-gradient(${angle || 140}deg, ${a}, ${b})`;

  // ---------- Variant tab switching ----------
  const tabs = Array.from(document.querySelectorAll(".variant-tab"));
  const screens = Array.from(document.querySelectorAll(".screen"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      const target = tab.dataset.target;
      screens.forEach((s) => s.setAttribute("data-active", String(s.id === target)));
      tab.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // ---------- Variant 1 data ----------
  const apps = [
    { name: "PepMod", initials: "PM", g: ["#6d5bff", "#b45cff"], meta: "Health · logging", proofs: 12 },
    { name: "SleepLog", initials: "SL", g: ["#2b6cff", "#38e0a0"], meta: "Sleep · audio", proofs: 9 },
    { name: "GymLevels", initials: "GL", g: ["#ff7a4d", "#ffcf5c"], meta: "Fitness · ranks", proofs: 14 },
    { name: "FocusRoom", initials: "FR", g: ["#b45cff", "#ff6b9d"], meta: "Productivity", proofs: 5 },
    { name: "TrailMap", initials: "TM", g: ["#38e0a0", "#2b6cff"], meta: "Outdoor · maps", proofs: 7 },
  ];

  const outputs = [
    { kind: "Image ad", title: "Proof showcase", g: ["#5b5bff", "#b45cff"], play: false },
    { kind: "UGC video", title: "Creator selfie", g: ["#ff7a4d", "#ff6b9d"], play: true },
    { kind: "Image ad", title: "Feature spotlight", g: ["#2b6cff", "#38e0a0"], play: false },
    { kind: "UGC video", title: "Hook + demo", g: ["#b45cff", "#6d5bff"], play: true },
  ];

  const freshProof = [
    { cap: "Home — 2-tap log", sub: "Screenshot · verified", hero: true },
    { cap: "Streak counter", sub: "Screenshot · verified", hero: false },
    { cap: "Reminder toast", sub: "Recording · 0:03", hero: false },
    { cap: "Onboarding step 2", sub: "Screenshot · verified", hero: true },
  ];

  function renderLaunchpad() {
    const appsRail = $("#appsRail");
    apps.forEach((a) => {
      const tile = el("article", "app-tile");
      tile.innerHTML = `
        <div class="app-thumb" style="${grad(a.g[0], a.g[1])}">${a.initials}</div>
        <h3>${a.name}</h3>
        <p class="meta">${a.meta}</p>
        <span class="proof-chip">${a.proofs} proofs</span>`;
      appsRail.appendChild(tile);
    });

    const outputsRail = $("#outputsRail");
    outputs.forEach((o) => {
      const tile = el("article", "output-tile");
      tile.setAttribute("style", grad(o.g[0], o.g[1], 160));
      tile.innerHTML = `
        ${o.play ? '<span class="play">▶</span>' : ""}
        <span class="kind">${o.kind}</span>
        <h3>${o.title}</h3>`;
      outputsRail.appendChild(tile);
    });

    const proofRail = $("#proofRail");
    freshProof.forEach((p) => proofRail.appendChild(proofTile(p)));
  }

  function proofTile(p) {
    const tile = el("article", "proof-tile");
    tile.innerHTML = `
      <div class="proof-shot">
        <span class="verify-badge">✓ Verified</span>
        <span class="bar w70"></span>
        <span class="bar w45"></span>
        ${p.hero ? '<span class="bar hero"></span>' : '<span class="bar w70"></span>'}
        <span class="bar w45"></span>
        <span class="chipmark">app proof</span>
      </div>
      <p class="cap">${p.cap}</p>
      <p class="sub">${p.sub}</p>`;
    return tile;
  }

  // Import demo (no network — swaps the note text only)
  const importGo = $("#importGo");
  if (importGo) {
    importGo.addEventListener("click", () => {
      const val = ($("#urlInput").value || "").trim();
      const note = $("#importNote");
      if (!val) {
        note.textContent = "Paste an App Store or Play Store URL to import proof.";
        return;
      }
      note.textContent = "Imported (mock) — 12 screenshots + metadata queued for proof review. No spend touched.";
    });
  }

  // ---------- Variant 2 data ----------
  const memProof = [
    { cap: "Home — 2-tap log", sub: "Screenshot #07", hero: true },
    { cap: "Dose reminder", sub: "Recording #02", hero: false },
    { cap: "Weekly streak", sub: "Screenshot #11", hero: true },
    { cap: "Protocol library", sub: "Screenshot #04", hero: false },
    { cap: "Settings — privacy", sub: "Screenshot #09", hero: false },
  ];

  const claims = [
    { text: "Log a dose in 2 taps", status: "ok", label: "Verified", src: "Source · proof #07 (home screen)" },
    { text: "Never miss a reminder", status: "ok", label: "Verified", src: "Source · recording #02 (reminder toast)" },
    { text: "Trusted by 40k people", status: "hold", label: "Needs proof", src: "No source yet · blocked from render" },
    { text: "Doctor recommended", status: "blocked", label: "Cannot claim", src: "No evidence · excluded by proof rule" },
  ];

  const styles = [
    { name: "Signal Violet", role: "Primary accent", css: grad("#6d5bff", "#b45cff") },
    { name: "Proof Green", role: "Verified state", css: grad("#38e0a0", "#2b6cff") },
    { name: "Near Black", role: "Canvas", css: "background:linear-gradient(140deg,#0e1010,#050606)" },
    { name: "Warm Alert", role: "Hold / warn", css: grad("#ff7a4d", "#ffcf5c") },
  ];

  const tones = ["Calm", "Reassuring", "Precise", "No hype", "Plain-spoken", "Health-safe"];

  const learnings = [
    { tag: "Hook", text: "“2-tap logging” beats “track peptides” on watch-time.", delta: "+18% hold rate" },
    { tag: "Pace", text: "Captions holding <1.3s keep UGC feeling native.", delta: "caption_pace → 1200ms" },
    { tag: "Proof", text: "Ads with a visible app screen out-convert talking-head only.", delta: "+11% install rate" },
    { tag: "Avoid", text: "Medical-authority claims get blocked — no evidence path.", delta: "2 claims retired" },
  ];

  function renderMemory() {
    const mp = $("#memProofRail");
    memProof.forEach((p) => mp.appendChild(proofTile(p)));

    const cr = $("#claimsRail");
    claims.forEach((c) => {
      const card = el("article", "claim-card");
      card.innerHTML = `
        <div class="claim-text">“${c.text}”</div>
        <span class="claim-status ${c.status}">${c.label}</span>
        <div class="claim-src">${c.src}</div>`;
      cr.appendChild(card);
    });

    const sr = $("#styleRail");
    styles.forEach((s) => {
      const tile = el("article", "style-tile");
      tile.innerHTML = `
        <div class="swatch" style="${s.css}"></div>
        <div class="style-body"><b>${s.name}</b><span>${s.role}</span></div>`;
      sr.appendChild(tile);
    });

    const tr = $("#toneRow");
    tones.forEach((t) => tr.appendChild(el("span", "tone-chip", t)));

    const lr = $("#learnRail");
    learnings.forEach((l) => {
      const card = el("article", "learn-card");
      card.innerHTML = `
        <span class="tag">${l.tag}</span>
        <p>${l.text}</p>
        <div class="delta">▲ ${l.delta}</div>`;
      lr.appendChild(card);
    });
  }

  // ---------- Variant 3 data ----------
  const drafts = [
    { id: "A2", kind: "UGC 9:16", cap: "Log a dose in 2 taps", g: ["#6d5bff", "#b45cff"], state: "review", stateLabel: "In review", qa: "QA 3/4", current: true },
    { id: "A5", kind: "Image ad", cap: "Never miss a reminder", g: ["#2b6cff", "#38e0a0"], state: "review", stateLabel: "In review", qa: "QA 4/4", current: false },
    { id: "B1", kind: "UGC 9:16", cap: "Your streak, on autopilot", g: ["#ff7a4d", "#ff6b9d"], state: "review", stateLabel: "In review", qa: "QA 3/4", current: false },
    { id: "A1", kind: "Image ad", cap: "Proof showcase", g: ["#b45cff", "#6d5bff"], state: "approved", stateLabel: "Approved", qa: "QA 4/4", current: false },
    { id: "A0", kind: "UGC 9:16", cap: "Doctor recommended", g: ["#3a3d3e", "#1c1f20"], state: "rejected", stateLabel: "Rejected", qa: "Claim blocked", current: false },
  ];

  function renderReview() {
    const rail = $("#draftRail");
    drafts.forEach((d) => {
      const tile = el("article", "draft-tile");
      if (d.current) tile.setAttribute("aria-current", "true");
      tile.innerHTML = `
        <div class="draft-media" style="${grad(d.g[0], d.g[1], 160)}">
          <span class="play">▶</span>
          <span class="kind">${d.kind}</span>
          <span class="cap">${d.cap}</span>
        </div>
        <div class="draft-foot">
          <span class="state ${d.state}">${d.stateLabel}</span>
          <span class="qa">${d.qa}</span>
        </div>`;
      tile.addEventListener("click", () => {
        rail.querySelectorAll(".draft-tile").forEach((t) => t.removeAttribute("aria-current"));
        tile.setAttribute("aria-current", "true");
        $("#prTitle").textContent = `Draft #${d.id} · ${d.kind}`;
        $("#prSub").textContent = `“${d.cap}” · PepMod`;
        $("#decisionNote").textContent = "No decision yet · stays in source inventory.";
        $("#decisionNote").style.color = "";
      });
      rail.appendChild(tile);
    });

    const noteColors = { approve: "var(--proof)", tweak: "var(--accent-2)", reject: "var(--danger)" };
    const noteText = {
      approve: "Approved (mock) → writes the memory diff and moves to handoff inbox.",
      tweak: "Sent back to Creative Director (mock) with the caption-timing note.",
      reject: "Rejected (mock) → stays in source inventory, no memory write.",
    };
    document.querySelectorAll(".pr-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = btn.dataset.decision;
        const note = $("#decisionNote");
        note.textContent = noteText[d];
        note.style.color = noteColors[d];
      });
    });
  }

  // ---------- Boot ----------
  renderLaunchpad();
  renderMemory();
  renderReview();
})();
