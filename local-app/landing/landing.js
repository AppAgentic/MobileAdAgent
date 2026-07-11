/* =========================================================================
   Mobile Ad Agent — Landing interactions
   Fully local. No network calls, no provider mutations (providerMutations: 0).
   Progressive enhancement: the page is complete and legible without JS.
   ========================================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- mobile nav toggle ---- */
  var nav = document.getElementById('nav');
  var navToggle = document.getElementById('navToggle');
  if (nav && navToggle) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('nav--open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // close the menu after tapping a link
    nav.querySelectorAll('.nav__links a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('nav--open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---- build-log reveal ---- */
  var logLines = Array.prototype.slice.call(
    document.querySelectorAll('#buildLog .reveal')
  );

  function revealLog() {
    if (reduceMotion) {
      logLines.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    logLines.forEach(function (el, i) {
      el.classList.remove('in');
      // stagger the lines so it reads like a live agent run
      window.setTimeout(function () { el.classList.add('in'); }, 220 + i * 260);
    });
  }
  revealLog();

  /* ---- production public paths: same page, route-specific focus ---- */
  var routeFocus = {
    '/pricing': 'pricing',
    '/launch-pack': 'pricing',
  };
  var focusTarget = routeFocus[window.location.pathname.replace(/\/+$/, '') || '/'];
  if (focusTarget) {
    window.requestAnimationFrame(function () {
      var target = document.getElementById(focusTarget);
      if (target) target.scrollIntoView({ block: 'start' });
    });
  }

  /* ---- URL form: hand off to the anonymous app preview ---- */
  var urlForm = document.getElementById('urlForm');
  var urlInput = document.getElementById('urlInput');
  var goBtn = urlForm ? urlForm.querySelector('.urlbar__go') : null;
  if (urlForm && goBtn) {
    urlForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = (urlInput.value || '').trim() || (urlInput.placeholder || '').trim();
      if (!value) return;
      goBtn.textContent = 'Opening preview…';
      goBtn.disabled = true;
      // URL-first: the app shows the preview before any checkout/sign-up.
      window.location.assign('/preview?u=' + encodeURIComponent(value));
    });
    // keep the demo value if the field is emptied
    urlInput.addEventListener('blur', function () {
      if (!urlInput.value.trim()) urlInput.value = urlInput.placeholder;
    });
  }

  /* ---- product tour tabs (progressive: all panels visible without JS) ---- */
  var tourLayout = document.getElementById('tourLayout');
  if (tourLayout) {
    var tourTabs = Array.prototype.slice.call(
      tourLayout.querySelectorAll('.tourstep[role="tab"]')
    );
    var tourPanels = Array.prototype.slice.call(
      tourLayout.querySelectorAll('.tourpanel[role="tabpanel"]')
    );

    function selectTourTab(tab, focus) {
      tourTabs.forEach(function (t) {
        var active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
        t.setAttribute('tabindex', active ? '0' : '-1');
      });
      tourPanels.forEach(function (p) {
        var active = p.id === tab.getAttribute('aria-controls');
        p.classList.toggle('is-active', active);
        if (active) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
      if (focus) tab.focus();
    }

    tourTabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { selectTourTab(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var dir = 0;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') dir = 1;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') dir = -1;
        else if (e.key === 'Home') { e.preventDefault(); selectTourTab(tourTabs[0], true); return; }
        else if (e.key === 'End') { e.preventDefault(); selectTourTab(tourTabs[tourTabs.length - 1], true); return; }
        if (!dir) return;
        e.preventDefault();
        selectTourTab(tourTabs[(i + dir + tourTabs.length) % tourTabs.length], true);
      });
    });

    // collapse the stacked no-JS fallback into a single active panel
    selectTourTab(
      tourTabs.filter(function (t) { return t.classList.contains('is-active'); })[0] || tourTabs[0],
      false
    );
  }

  /* ---- review panel: Image / UGC format toggle ---- */
  var toggleBtns = Array.prototype.slice.call(
    document.querySelectorAll('.toggle [data-format]')
  );
  var draftsEl = document.getElementById('drafts');

  var DRAFTS = {
    all: [
      { tag: 'image · 9:16', cite: 'from: streak feature' },
      { tag: 'image · 1:1',  cite: 'from: review theme' },
      { tag: 'UGC ad · 0:15', cite: 'from: "no pressure" review', video: true }
    ],
    image: [
      { tag: 'image · 9:16', cite: 'from: streak feature' },
      { tag: 'image · 1:1',  cite: 'from: review theme' },
      { tag: 'image · 4:5',  cite: 'from: watch sync' }
    ],
    ugc: [
      { tag: 'UGC ad · 0:15', cite: 'from: "no pressure" review', video: true },
      { tag: 'UGC ad · 0:22', cite: 'from: streak feature',      video: true },
      { tag: 'UGC ad · 0:18', cite: 'from: audience · starters', video: true }
    ]
  };

  function renderDrafts(format) {
    if (!draftsEl) return;
    var items = DRAFTS[format] || DRAFTS.image;
    draftsEl.innerHTML = items.map(function (d) {
      return '' +
        '<div class="draftcard' + (d.video ? ' draftcard--video' : '') + '" data-kind="' + format + '">' +
          '<div class="draftcard__frame"><span class="draftcard__tag">' + d.tag + '</span></div>' +
          '<div class="draftcard__cite">' + d.cite + '</div>' +
          '<div class="draftcard__actions">' +
            '<button type="button" class="approve">Approve</button>' +
            '<button type="button" class="tweak">Tweak</button>' +
            '<button type="button" class="reject">Reject</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  toggleBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      toggleBtns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      btn.setAttribute('aria-pressed', 'true');
      renderDrafts(btn.getAttribute('data-format'));
    });
  });

  /* ---- draft approve / tweak / reject (event delegation) ---- */
  if (draftsEl) {
    draftsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.draftcard__actions button');
      if (!btn) return;
      var actions = btn.parentElement;
      Array.prototype.forEach.call(actions.children, function (b) {
        b.removeAttribute('data-state');
      });
      if (btn.classList.contains('approve')) btn.setAttribute('data-state', 'approved');
      else if (btn.classList.contains('reject')) btn.setAttribute('data-state', 'rejected');
    });
  }
})();
