(function () {
  "use strict";

  const composer = document.querySelector("#urlComposer");
  const status = document.querySelector("#composerStatus");

  if (composer && status) {
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector("#appUrl");
      const value = (input && input.value ? input.value : "").trim();
      if (!value) {
        status.textContent = "Paste an App Store, Play Store, or website URL to start the proof map.";
        status.dataset.state = "warn";
        return;
      }
      status.textContent = "Proof map queued locally: store evidence, claim inventory, and MCP-readable stage state.";
      status.dataset.state = "ready";
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.dataset.visible = "true";
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
  );

  document
    .querySelectorAll(".signal-strip div, .section-copy, .memory-board, .review-console, .stage-list div, .final-cta")
    .forEach((node) => observer.observe(node));
})();
