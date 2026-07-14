/* Analysis Flow — Fable set.
 * Five two-act concepts over the same truthful first-run sequence:
 * Act 1 — the agent visibly collects real evidence after a store URL is submitted;
 * Act 2 — the collection resolves into a plan: two directions, 28 creatives split 14/14.
 * Everything rendered comes from the reviewed demo fixture; no invented metrics. */

/* ---------- fixture ---------- */

const APP = {
  name: 'Duolingo: Language Lessons',
  category: 'Education',
  subtitle: 'Short guided language practice',
  source: 'App Store listing',
  url: 'apps.apple.com/app/duolingo',
  summary: 'Short vocabulary, translation, listening, speaking, reading and writing exercises.',
};

const SCREENS = [
  {
    src: '/demo-assets/duolingo-vocabulary-choice.jpg',
    title: 'Vocabulary choice',
    note: 'A Spanish vocabulary question asks the learner to pick the right translation for “the glass”.',
  },
  {
    src: '/demo-assets/duolingo-sentence-translation.jpg',
    title: 'Sentence translation',
    note: 'A guided exercise asks the learner to build “I want a salad” from a Spanish word bank.',
  },
  {
    src: '/demo-assets/duolingo-listening-exercise.jpg',
    title: 'Listening exercise',
    note: 'A listening exercise asks the learner to type the Spanish phrase they hear.',
  },
];

const CLAIMS = [
  { text: 'Short, guided exercises', proof: 'seen on all three screens' },
  { text: 'Vocabulary practice', proof: 'seen on the vocabulary screen' },
  { text: 'Sentence translation', proof: 'seen on the translation screen' },
  { text: 'Listening practice', proof: 'seen on the listening screen' },
];

const REVIEWS = [
  { quote: 'The lessons are short enough to do on my commute.', mark: 'short enough to do on my commute' },
  { quote: 'Five minutes here and there actually adds up.', mark: 'Five minutes here and there' },
  { quote: 'It keeps me coming back every single day.', mark: 'keeps me coming back' },
  { quote: 'I stopped dreading practice — I just do a quick lesson.', mark: 'a quick lesson' },
  { quote: 'I like that it mixes listening, reading and speaking.', mark: 'mixes listening, reading and speaking' },
  { quote: 'The variety keeps it from feeling like homework.', mark: 'variety' },
];

const IDEAS = [
  {
    label: 'Idea A',
    title: 'Lessons short enough for a real day',
    line: 'Show one real lesson finishing in the time a coffee break takes.',
    screen: 1,
    screens: [1],
    reviews: [0, 1, 3],
    fact: 'Short single-sentence exercises — seen directly in the app’s own screens.',
  },
  {
    label: 'Idea B',
    title: 'One app, many ways to practice',
    line: 'Cut between vocabulary, translation and listening — all real screens, no mockups.',
    screen: 2,
    screens: [0, 2],
    reviews: [4, 5],
    fact: 'Three distinct exercise types — each one found as a real screen.',
  },
];

const RULE = 'Reviews shape the message. Only real screens from your app prove a feature.';

const STATUS = {
  find: 'URL received — finding your listing…',
  found: 'App identified from your listing',
  desc: 'Reading the store description…',
  claims: 'Product claims noted from the description',
  screens: 'Inspecting screens…',
  screensDone: '3 usable screens found',
  reviews: 'Reading written reviews…',
  reviewsDone: '6 written reviews read',
  match: 'Matching audience language to real proof…',
  ideas: 'Two creative directions drafted',
  plan: 'Plan ready — 28 creatives, 14 per direction',
};

/* ---------- shell ---------- */

const stage = document.querySelector('#stage');
const statusEl = document.querySelector('#status');
const thesisEl = document.querySelector('#thesis');
const skipBtn = document.querySelector('#skip');
const replayBtn = document.querySelector('#replay');
const toastEl = document.querySelector('#toast');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let cleanups = [];
function onCleanup(fn) { cleanups.push(fn); }
function setStatus(text) { statusEl.textContent = text; }
function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function markQuote(review) {
  return esc(review.quote).replace(esc(review.mark), `<mark>${esc(review.mark)}</mark>`);
}
function screenImg(index, className = '') {
  const screen = SCREENS[index];
  return `<img class="shot ${className}" src="${screen.src}" alt="Real app screen: ${esc(screen.title)}" loading="eager">`;
}
function appIcon(size = '') {
  return `<span class="owl ${size}" aria-label="App icon found on the store listing" role="img"><i></i><i></i><b></b></span>`;
}
function splitBar(extraClass = '') {
  return `<div class="split-bar ${extraClass}"><i style="width:50%"></i><span>28 creatives · split 14 / 14 across the two ideas</span></div>`;
}
function methodNote() {
  return `<p class="method"><b>How the match works —</b> ${RULE}</p>`;
}
function ideaCard(index, refsHtml = '') {
  const idea = IDEAS[index];
  return `<article class="idea">
    <span class="idealabel">${idea.label}</span>
    <h3>${idea.title}</h3>
    <p>${idea.line}</p>
    <div class="idea-src">${screenImg(idea.screen, 'mini')}<ul>${idea.reviews.map((r) => `<li>“${esc(REVIEWS[r].mark)}”</li>`).join('')}<li class="fact">${idea.fact}</li></ul></div>
    ${refsHtml}
    <footer>14 creatives — 12 images · 2 UGC videos</footer>
  </article>`;
}
function ctaBlock() {
  return `<div class="cta-block">
    <p class="cta-line">Both directions ship together — real results decide what gets doubled down on.</p>
    <button class="cta" type="button" data-cta>Generate My Ads</button>
    <p class="cta-sub">28 creatives · 14 per direction · each direction: 12 images + 2 UGC videos</p>
  </div>`;
}
function matchRows(extraClass = '') {
  return IDEAS.map((idea) => `
    <div class="matchrow ${extraClass}">
      <div class="say"><span>PEOPLE SAY</span>${idea.reviews.slice(0, 2).map((r) => `<q>${esc(REVIEWS[r].mark)}</q>`).join('')}</div>
      <div class="arrow">→</div>
      <div class="prove"><span>YOUR APP SHOWS</span>${screenImg(idea.screen, 'mini')}<p>${idea.fact}</p></div>
    </div>`).join('');
}

/* Deterministic two-act timeline: play() schedules the steps, finish() flushes
 * every remaining step in order so Skip / reduced-motion land on the exact
 * same final DOM the animation would have produced. */
class Timeline {
  constructor() {
    this.steps = [];
    this.timers = [];
    this.finished = false;
    this.flushing = false;
    this.finishHandlers = [];
  }
  at(ms, fn) { this.steps.push({ ms, fn, ran: false }); }
  onFinish(fn) { this.finishHandlers.push(fn); }
  play() {
    this.steps.sort((a, b) => a.ms - b.ms);
    const last = this.steps.length ? this.steps[this.steps.length - 1].ms : 0;
    this.steps.forEach((step) => {
      this.timers.push(setTimeout(() => { if (!step.ran) { step.ran = true; step.fn(); } }, step.ms));
    });
    this.timers.push(setTimeout(() => this.complete(), last + 80));
  }
  finish() {
    if (this.finished) return;
    this.timers.forEach(clearTimeout);
    this.flushing = true;
    this.steps.sort((a, b) => a.ms - b.ms).forEach((step) => {
      if (!step.ran) { step.ran = true; step.fn(); }
    });
    // Complete while still flagged as flushing so finish handlers can tell a
    // skip apart from natural completion (e.g. Route always jumps to the plan).
    this.complete();
    this.flushing = false;
  }
  complete() {
    if (this.finished) return;
    this.finished = true;
    this.finishHandlers.forEach((fn) => fn());
  }
  stop() { this.timers.forEach(clearTimeout); }
}

let tl = null;

const VARIANTS = {
  1: { name: 'Contact Sheet', thesis: 'Every frame develops from something actually found — the circled selects become the plan.', render: contactSheet },
  2: { name: 'Reading Room', thesis: 'Watch the sources being read — every note in the notebook links back to the line it came from.', render: readingRoom },
  3: { name: 'Route', thesis: 'The analysis builds the page as it travels — scroll back over the route it took.', render: route },
  4: { name: 'The Sort', thesis: 'Evidence lands first, then visibly sorts itself into the two directions it supports.', render: theSort },
  5: { name: 'Front Page', thesis: 'Findings arrive on the wire, then compose into your edition.', render: frontPage },
};

const variant = Math.min(5, Math.max(1, Number(new URLSearchParams(location.search).get('variant')) || 1));

function render() {
  if (tl) tl.stop();
  cleanups.forEach((fn) => fn());
  cleanups = [];
  tl = new Timeline();

  const config = VARIANTS[variant];
  document.body.dataset.variant = String(variant);
  document.body.classList.remove('done');
  document.querySelectorAll('[data-v]').forEach((link) => link.classList.toggle('active', Number(link.dataset.v) === variant));
  thesisEl.textContent = config.thesis;
  setStatus(STATUS.find);
  stage.innerHTML = '';
  window.scrollTo(0, 0);
  skipBtn.hidden = false;

  tl.onFinish(() => {
    skipBtn.hidden = true;
    document.body.classList.add('done');
    setStatus(STATUS.plan);
  });

  config.render(tl);

  if (reduced) flushNow();
  else tl.play();
}

function flushNow() {
  stage.classList.add('instant');
  tl.finish();
  requestAnimationFrame(() => stage.classList.remove('instant'));
}

replayBtn.addEventListener('click', render);
skipBtn.addEventListener('click', flushNow);

let toastTimer = null;
stage.addEventListener('click', (event) => {
  if (!event.target.closest('[data-cta]')) return;
  toastEl.textContent = 'Prototype preview — nothing is generated or charged from here.';
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
});

/* Scrolls that should be smooth while playing but immediate when flushing. */
function goTo(node, block = 'start') {
  if (!node) return;
  node.scrollIntoView({ behavior: tl.flushing || reduced ? 'auto' : 'smooth', block });
}

/* =========================================================
 * 01 — CONTACT SHEET: frames develop, selects get circled
 * ======================================================= */
function contactSheet(t) {
  const frames = [
    { label: 'Listing', html: `<div class="f1-id">${appIcon('sm')}<b>${APP.name}</b><span>${APP.category} · ${APP.source}</span></div>` },
    { label: 'Description', html: `<div class="f1-desc"><p>“${APP.summary}”</p><div class="f1-claims">${CLAIMS.map((claim) => `<span>${claim.text}</span>`).join('')}</div></div>` },
    ...SCREENS.map((screen, index) => ({
      label: `Screen — ${screen.title}`,
      html: `<div class="f1-shot">${screenImg(index)}<em class="stamp">USABLE</em></div>`,
    })),
    ...REVIEWS.map((review) => ({
      label: 'Written review',
      html: `<blockquote class="rev f1-rev">${markQuote(review)}<cite>written store review</cite></blockquote>`,
    })),
    { label: 'Language ↔ proof', html: `<div class="f1-match"><p>“short enough” · “a quick lesson” → <b>translation screen</b></p><p>“variety” · “mixes … skills” → <b>vocabulary + listening screens</b></p><span>${RULE}</span></div>` },
  ];
  // Which frames each idea selects: F04 (screen 2) + reviews for A; screens 1 & 3 + reviews for B.
  const selects = { 3: 'A', 5: 'A', 6: 'A', 8: 'A', 2: 'B', 4: 'B', 9: 'B', 10: 'B', 11: 'A·B' };

  stage.innerHTML = `
  <div class="f1">
    <header class="f1-head">
      <p class="kicker">ANALYZING YOUR APP</p>
      <h1>The research develops <em>frame by frame</em>.</h1>
      <p class="lede">Each frame fills only when something real is found on your listing — nothing is staged in advance.</p>
    </header>
    <div class="f1-sheet" role="list">
      ${frames.map((frame, index) => `
        <figure class="f1-frame" data-f="${index}" role="listitem">
          <figcaption><b>F${String(index + 1).padStart(2, '0')}</b><span>${esc(frame.label)}</span></figcaption>
          <div class="f1-cell">${frame.html}</div>
          <i class="f1-scan" aria-hidden="true"></i>
          <span class="f1-badge" aria-hidden="true"></span>
        </figure>`).join('')}
    </div>
    <section class="f1-dossier" hidden>
      <header><p class="kicker">THE SELECTS</p><h2>Two directions, taken only from the circled frames.</h2></header>
      <div class="ideas-grid">
        ${IDEAS.map((idea, index) => ideaCard(index, `<p class="f1-refs">From frames ${index === 0 ? 'F04 · F06 · F07 · F09' : 'F03 · F05 · F10 · F11'}</p>`)).join('')}
      </div>
      ${methodNote()}
      ${splitBar()}
      ${ctaBlock()}
    </section>
  </div>`;

  const frameEls = [...stage.querySelectorAll('.f1-frame')];
  const dossier = stage.querySelector('.f1-dossier');
  const statusAt = { 0: STATUS.found, 1: STATUS.claims, 2: STATUS.screens, 4: STATUS.screensDone, 5: STATUS.reviews, 10: STATUS.reviewsDone, 11: STATUS.match };

  frames.forEach((_, index) => {
    t.at(600 + index * 520, () => {
      frameEls[index].classList.add('dev');
      if (statusAt[index]) setStatus(statusAt[index]);
    });
  });

  const afterFrames = 600 + frames.length * 520;
  t.at(afterFrames + 300, () => {
    setStatus(STATUS.ideas);
    Object.entries(selects).forEach(([index, tag], order) => {
      const frame = frameEls[Number(index)];
      frame.classList.add('select');
      frame.style.setProperty('--sd', `${order * 90}ms`);
      frame.querySelector('.f1-badge').textContent = tag;
    });
  });
  t.at(afterFrames + 1500, () => {
    dossier.hidden = false;
    goTo(dossier);
  });
}

/* =========================================================
 * 02 — READING ROOM: sources read live, notebook fills
 * ======================================================= */
function readingRoom(t) {
  stage.innerHTML = `
  <div class="f2">
    <div class="f2-panes">
      <section class="f2-source" aria-label="Source being read">
        <header><span class="kicker">SOURCE</span><span class="f2-srcname">Store listing</span></header>
        <div class="f2-srcbody"></div>
      </section>
      <section class="f2-notes" aria-label="Agent notebook">
        <header><span class="kicker">AGENT NOTEBOOK</span><span class="f2-notecount"></span></header>
        <div class="f2-group" data-g="claims"><h3>Claims to verify</h3><div class="f2-list"></div></div>
        <div class="f2-group" data-g="proof"><h3>Proof on hand</h3><div class="f2-list"></div></div>
        <div class="f2-group" data-g="lang"><h3>Audience language</h3><div class="f2-list"></div></div>
      </section>
    </div>
    <section class="f2-plan" hidden>
      <header><p class="kicker">FROM NOTES TO PLAN</p><h2>The notebook, resolved into two directions.</h2></header>
      <div class="f2-matches">${matchRows()}</div>
      ${methodNote()}
      <div class="ideas-grid">${IDEAS.map((_, index) => ideaCard(index)).join('')}</div>
      ${splitBar()}
      ${ctaBlock()}
    </section>
  </div>`;

  const srcName = stage.querySelector('.f2-srcname');
  const srcBody = stage.querySelector('.f2-srcbody');
  const noteCount = stage.querySelector('.f2-notecount');
  const plan = stage.querySelector('.f2-plan');
  const lists = {
    claims: stage.querySelector('[data-g="claims"] .f2-list'),
    proof: stage.querySelector('[data-g="proof"] .f2-list'),
    lang: stage.querySelector('[data-g="lang"] .f2-list'),
  };
  let notes = 0;
  function addNote(group, html) {
    const note = document.createElement('div');
    note.className = 'f2-note';
    note.innerHTML = html;
    lists[group].append(note);
    requestAnimationFrame(() => note.classList.add('on'));
    notes += 1;
    noteCount.textContent = `${notes} note${notes === 1 ? '' : 's'}`;
  }

  // Source 1 — the listing itself, claims highlighted in the real description.
  t.at(400, () => {
    setStatus(STATUS.found);
    srcBody.innerHTML = `
      <div class="f2-listing">
        <div class="f2-listing-id">${appIcon()}<div><b>${APP.name}</b><span>${APP.category} · ${APP.subtitle}</span></div></div>
        <p class="f2-descline">From the description:</p>
        <p class="f2-desc">“<span data-c="0">Short</span> <span data-c="1">vocabulary</span>, <span data-c="2">translation</span>, <span data-c="3">listening</span>, speaking, reading and writing exercises.”</p>
      </div>`;
  });
  t.at(1100, () => setStatus(STATUS.desc));
  CLAIMS.forEach((claim, index) => {
    t.at(1300 + index * 650, () => {
      const span = srcBody.querySelector(`[data-c="${index}"]`);
      if (span) span.classList.add('read');
      addNote('claims', `<b>${esc(claim.text)}</b><span>from your store description — still needs proof</span>`);
    });
  });
  t.at(1300 + CLAIMS.length * 650, () => setStatus(STATUS.claims));

  // Source 2 — the screens, each inspected and stamped.
  t.at(4300, () => {
    setStatus(STATUS.screens);
    srcName.textContent = 'Product screens';
    srcBody.innerHTML = `<div class="f2-shots">${SCREENS.map((screen, index) => `
      <figure class="f2-shotcard" data-s="${index}">${screenImg(index)}<figcaption>${esc(screen.title)}</figcaption><em class="stamp">USABLE</em></figure>`).join('')}</div>`;
  });
  SCREENS.forEach((screen, index) => {
    t.at(4700 + index * 750, () => {
      srcBody.querySelector(`[data-s="${index}"]`)?.classList.add('inspected');
      addNote('proof', `${screenImg(index, 'micro')}<b>${esc(screen.title)}</b><span>real screen — usable in ads</span>`);
    });
  });
  t.at(4700 + SCREENS.length * 750, () => setStatus(STATUS.screensDone));

  // Source 3 — written reviews, recurring phrases marked as they're read.
  t.at(7400, () => {
    setStatus(STATUS.reviews);
    srcName.textContent = 'Written store reviews';
    srcBody.innerHTML = `<div class="f2-revs">${REVIEWS.map((review, index) => `
      <blockquote class="rev" data-r="${index}">${esc(review.quote)}<cite>written store review</cite></blockquote>`).join('')}</div>`;
  });
  REVIEWS.forEach((review, index) => {
    t.at(7800 + index * 620, () => {
      const block = srcBody.querySelector(`[data-r="${index}"]`);
      if (block) {
        block.classList.add('reading');
        block.innerHTML = `${markQuote(review)}<cite>written store review</cite>`;
      }
      addNote('lang', `<b>“${esc(review.mark)}”</b><span>a customer’s own words — shapes the message, proves nothing</span>`);
    });
  });
  t.at(7800 + REVIEWS.length * 620, () => setStatus(STATUS.reviewsDone));

  // Act 2 — the source closes, the notebook resolves into the plan.
  t.at(12200, () => setStatus(STATUS.match));
  t.at(12800, () => {
    stage.querySelector('.f2').classList.add('closed');
    srcName.textContent = 'Sources read';
  });
  t.at(13400, () => {
    setStatus(STATUS.ideas);
    plan.hidden = false;
    goTo(plan);
  });
}

/* =========================================================
 * 03 — ROUTE: the analysis builds the scrollable page
 * ======================================================= */
function route(t) {
  const stations = [
    {
      title: 'Listing found', status: STATUS.found,
      html: `<div class="f3-id">${appIcon('sm')}<div><b>${APP.name}</b><span>${APP.category} · found via your ${APP.source}</span></div></div>`,
    },
    {
      title: 'Description read', status: STATUS.claims,
      html: `<p class="quotebox">“${APP.summary}”</p><div class="f3-claims">${CLAIMS.map((claim) => `<span class="chip">${claim.text}</span>`).join('')}</div><p class="dim f3-note">Four claims noted. Each one still has to be proven by a real screen.</p>`,
    },
    {
      title: 'Screens inspected', status: STATUS.screensDone,
      html: `<div class="f3-shots">${SCREENS.map((screen, index) => `<figure class="f3-shot">${screenImg(index)}<figcaption>${esc(screen.title)}</figcaption><em class="stamp">USABLE</em></figure>`).join('')}</div><p class="dim f3-note">Three real screens pulled from the listing — nothing generated, nothing mocked up.</p>`,
    },
    {
      title: 'Reviews read', status: STATUS.reviewsDone,
      html: `<div class="f3-revs">${REVIEWS.map((review) => `<blockquote class="rev">${markQuote(review)}<cite>written store review</cite></blockquote>`).join('')}</div><p class="dim f3-note">Six written reviews, read in full. The highlighted phrases repeat across different people.</p>`,
    },
    {
      title: 'Language matched to proof', status: STATUS.match,
      html: `<div class="f3-matches">${matchRows()}</div>${methodNote()}`,
    },
    {
      title: 'Two directions drafted', status: STATUS.ideas,
      html: `<div class="ideas-grid">${IDEAS.map((_, index) => ideaCard(index)).join('')}</div>`,
    },
    {
      title: 'The plan', status: STATUS.plan,
      html: `${splitBar()}${ctaBlock()}<p class="dim f3-note center">Scroll back up any time — the whole route stays on the page.</p>`,
    },
  ];

  stage.innerHTML = `
  <div class="f3">
    <header class="f3-head">
      <p class="kicker">ANALYZING YOUR APP</p>
      <h1>Follow the route the <em>research takes</em>.</h1>
    </header>
    <ol class="f3-route">
      ${stations.map((station, index) => `
        <li class="f3-station" data-st="${index}">
          <span class="f3-node" aria-hidden="true"></span>
          <div class="f3-card">
            <h2><b>${String(index + 1).padStart(2, '0')}</b>${esc(station.title)}</h2>
            <div class="f3-body">${station.html}</div>
          </div>
        </li>`).join('')}
    </ol>
    <button class="ghost f3-follow" type="button" hidden>▾ Resume following</button>
  </div>`;

  const stationEls = [...stage.querySelectorAll('.f3-station')];
  const followBtn = stage.querySelector('.f3-follow');
  let follow = true;
  let latest = 0;
  let autoScrolling = false;

  const userScrolled = () => {
    if (autoScrolling || tl.finished) return;
    follow = false;
    followBtn.hidden = false;
  };
  window.addEventListener('wheel', userScrolled, { passive: true });
  window.addEventListener('touchmove', userScrolled, { passive: true });
  onCleanup(() => {
    window.removeEventListener('wheel', userScrolled);
    window.removeEventListener('touchmove', userScrolled);
  });
  followBtn.addEventListener('click', () => {
    follow = true;
    followBtn.hidden = true;
    goTo(stationEls[latest], 'center');
  });

  stations.forEach((station, index) => {
    t.at(700 + index * 1750, () => {
      stationEls[index].classList.add('on');
      latest = index;
      setStatus(station.status);
      if (follow && !tl.flushing) {
        autoScrolling = true;
        goTo(stationEls[index], index === stations.length - 1 ? 'start' : 'center');
        setTimeout(() => { autoScrolling = false; }, 900);
      }
    });
  });
  t.onFinish(() => {
    followBtn.hidden = true;
    if (tl.flushing || follow) goTo(stationEls[stationEls.length - 1], 'start');
  });
}

/* =========================================================
 * 04 — THE SORT: evidence lands, then sorts into directions
 * ======================================================= */
function theSort(t) {
  const items = [
    ...SCREENS.map((screen, index) => ({
      id: `s${index}`, dest: [1].includes(index) ? 'A' : 'B',
      cls: 'f4-shotitem',
      html: `${screenImg(index)}<span>${esc(screen.title)}</span><em class="stamp">USABLE</em>`,
      status: index === 0 ? STATUS.screens : index === 2 ? STATUS.screensDone : null,
    })),
    ...REVIEWS.map((review, index) => ({
      id: `r${index}`, dest: [0, 1, 3].includes(index) ? 'A' : [4, 5].includes(index) ? 'B' : 'note',
      cls: 'f4-revitem',
      html: `<blockquote class="rev">${markQuote(review)}<cite>written store review</cite></blockquote>`,
      status: index === 0 ? STATUS.reviews : index === 5 ? STATUS.reviewsDone : null,
    })),
  ];

  stage.innerHTML = `
  <div class="f4">
    <header class="f4-head">
      <p class="kicker">ANALYZING YOUR APP</p>
      <h1>Everything lands on the desk <em>before it’s sorted</em>.</h1>
      <div class="f4-idrow" hidden>
        ${appIcon('sm')}
        <div><b>${APP.name}</b><span>${APP.category} · ${APP.source}</span></div>
        <div class="f4-claimchips">${CLAIMS.map((claim) => `<span class="chip">${claim.text}</span>`).join('')}</div>
      </div>
    </header>
    <p class="f4-phase" role="presentation">Collecting evidence…</p>
    <div class="f4-desk">
      <div class="f4-tray"></div>
      <div class="f4-cols" hidden>
        <section class="f4-col" data-col="A">
          <header><span class="idealabel">${IDEAS[0].label}</span><h3>${IDEAS[0].title}</h3><p>${IDEAS[0].line}</p></header>
          <div class="f4-slot"></div>
          <footer>14 creatives — 12 images · 2 UGC videos</footer>
        </section>
        <section class="f4-col" data-col="B">
          <header><span class="idealabel">${IDEAS[1].label}</span><h3>${IDEAS[1].title}</h3><p>${IDEAS[1].line}</p></header>
          <div class="f4-slot"></div>
          <footer>14 creatives — 12 images · 2 UGC videos</footer>
        </section>
        <aside class="f4-col f4-aside" data-col="note">
          <header><h3>Noted for tone</h3><p>True customer language, kept for copy — it doesn’t prove a feature on its own.</p></header>
          <div class="f4-slot"></div>
        </aside>
      </div>
    </div>
    <section class="f4-plan" hidden>
      ${methodNote()}
      ${splitBar()}
      ${ctaBlock()}
    </section>
  </div>`;

  const tray = stage.querySelector('.f4-tray');
  const cols = stage.querySelector('.f4-cols');
  const phase = stage.querySelector('.f4-phase');
  const idRow = stage.querySelector('.f4-idrow');
  const plan = stage.querySelector('.f4-plan');
  const nodes = new Map();

  t.at(400, () => {
    idRow.hidden = false;
    setStatus(STATUS.found);
  });
  t.at(1100, () => setStatus(STATUS.claims));

  items.forEach((item, index) => {
    t.at(1500 + index * 480, () => {
      const node = document.createElement('div');
      node.className = `f4-item ${item.cls}`;
      node.style.setProperty('--d', String(index));
      node.innerHTML = item.html;
      tray.append(node);
      nodes.set(item.id, node);
      requestAnimationFrame(() => node.classList.add('on'));
      if (item.status) setStatus(item.status);
    });
  });

  const afterCollect = 1500 + items.length * 480;
  t.at(afterCollect + 400, () => {
    setStatus(STATUS.match);
    phase.textContent = 'Sorting evidence into the directions it supports…';
  });
  t.at(afterCollect + 1200, () => {
    setStatus(STATUS.ideas);
    // FLIP: measure, re-parent into columns, then animate from old positions.
    const flushing = tl.flushing;
    const firsts = new Map();
    if (!flushing) nodes.forEach((node, id) => firsts.set(id, node.getBoundingClientRect()));
    cols.hidden = false;
    items.forEach((item) => {
      const slot = cols.querySelector(`[data-col="${item.dest}"] .f4-slot`);
      slot.append(nodes.get(item.id));
    });
    stage.querySelector('.f4').classList.add('sorted');
    if (!flushing) {
      items.forEach((item, index) => {
        const node = nodes.get(item.id);
        const first = firsts.get(item.id);
        const last = node.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        node.style.transition = 'none';
        node.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          node.style.transition = `transform .7s cubic-bezier(.22,.9,.26,1) ${index * 55}ms`;
          node.style.transform = '';
        }));
      });
    }
    phase.textContent = 'Sorted. Every item sits under the direction it supports.';
  });
  t.at(afterCollect + 2400, () => {
    plan.hidden = false;
    goTo(plan, 'center');
  });
}

/* =========================================================
 * 05 — FRONT PAGE: wire dispatches compose into an edition
 * ======================================================= */
function frontPage(t) {
  const dispatches = [
    { tag: 'LISTING', html: `${appIcon('sm')}<p>Listing located — <b>${APP.name}</b>, ${APP.category}.</p>`, status: STATUS.found },
    { tag: 'DESCRIPTION', html: `<p>Description read. Claims noted: <b>${CLAIMS.map((claim) => claim.text.toLowerCase()).join(' · ')}</b>.</p>`, status: STATUS.claims },
    ...SCREENS.map((screen, index) => ({
      tag: 'SCREEN', html: `${screenImg(index, 'micro')}<p>Screen inspected — <b>${esc(screen.title)}</b>. Usable in ads.</p>`,
      status: index === 0 ? STATUS.screens : index === 2 ? STATUS.screensDone : null,
    })),
    { tag: 'REVIEWS', html: `<p>Six written reviews read in full — recurring phrases marked.</p>`, status: STATUS.reviews },
    { tag: 'PHRASE', html: `<p>“<b>${esc(REVIEWS[0].mark)}</b>” — repeats across reviewers.</p>` },
    { tag: 'PHRASE', html: `<p>“<b>${esc(REVIEWS[5].mark)}</b>” — repeats across reviewers.</p>`, status: STATUS.reviewsDone },
    { tag: 'MATCH', html: `<p>Language matched to screens. ${RULE}</p>`, status: STATUS.match },
    { tag: 'DIRECTION', html: `<p>Direction drafted — <b>${IDEAS[0].title}</b>.</p>` },
    { tag: 'DIRECTION', html: `<p>Direction drafted — <b>${IDEAS[1].title}</b>.</p>`, status: STATUS.ideas },
    { tag: 'PLAN', html: `<p>Allocation set — <b>28 creatives · 14 + 14</b>, each direction 12 images + 2 UGC videos.</p>` },
  ];

  stage.innerHTML = `
  <div class="f5">
    <section class="f5-wire">
      <header><span class="kicker">RESEARCH WIRE</span><span class="dim">incoming from ${APP.url}</span></header>
      <ol class="f5-feed"></ol>
      <p class="f5-press" hidden>Going to press…</p>
    </section>
    <section class="f5-page" hidden>
      <header class="f5-masthead">
        <p class="f5-mastline">MOBILE AD AGENT · CREATIVE BRIEF</p>
        <h1>The ${APP.name.split(':')[0]} Edition</h1>
        <p class="f5-dateline">Prepared from your ${APP.source} · first edition · everything below was found, not assumed</p>
      </header>
      <div class="f5-grid">
        <article class="f5-lead">
          <span class="idealabel">${IDEAS[0].label} — LEAD STORY</span>
          <h2>${IDEAS[0].title}</h2>
          <p class="f5-deck">${IDEAS[0].line}</p>
          <div class="f5-leadbody">
            <figure class="phone">${screenImg(IDEAS[0].screen)}<figcaption>Real screen: ${esc(SCREENS[IDEAS[0].screen].title)}</figcaption></figure>
            <div>
              ${IDEAS[0].reviews.map((r) => `<p class="f5-pull">“${esc(REVIEWS[r].mark)}”</p>`).join('')}
              <p class="f5-fact">✓ ${IDEAS[0].fact}</p>
              <p class="f5-count">14 creatives — 12 images · 2 UGC videos</p>
            </div>
          </div>
        </article>
        <article class="f5-second">
          <span class="idealabel">${IDEAS[1].label} — SECOND FEATURE</span>
          <h2>${IDEAS[1].title}</h2>
          <p class="f5-deck">${IDEAS[1].line}</p>
          <div class="f5-secondshots">${IDEAS[1].screens.map((s) => screenImg(s, 'mini')).join('')}</div>
          ${IDEAS[1].reviews.map((r) => `<p class="f5-pull">“${esc(REVIEWS[r].mark)}”</p>`).join('')}
          <p class="f5-fact">✓ ${IDEAS[1].fact}</p>
          <p class="f5-count">14 creatives — 12 images · 2 UGC videos</p>
        </article>
        <aside class="f5-words">
          <h3>In their own words</h3>
          ${REVIEWS.map((review) => `<blockquote class="rev">${markQuote(review)}<cite>written store review</cite></blockquote>`).join('')}
        </aside>
        <aside class="f5-method">
          <h3>Method</h3>
          <p>${RULE}</p>
          <p>Three usable screens and six written reviews sit behind every line above.</p>
        </aside>
      </div>
      ${splitBar()}
      ${ctaBlock()}
    </section>
  </div>`;

  const feed = stage.querySelector('.f5-feed');
  const wire = stage.querySelector('.f5-wire');
  const press = stage.querySelector('.f5-press');
  const page = stage.querySelector('.f5-page');

  dispatches.forEach((dispatch, index) => {
    t.at(500 + index * 620, () => {
      const item = document.createElement('li');
      item.innerHTML = `<b>${String(index + 1).padStart(2, '0')} · ${dispatch.tag}</b><div class="f5-dispatch">${dispatch.html}</div>`;
      feed.append(item);
      requestAnimationFrame(() => item.classList.add('on'));
      feed.scrollTop = feed.scrollHeight;
      if (dispatch.status) setStatus(dispatch.status);
    });
  });

  const afterWire = 500 + dispatches.length * 620;
  t.at(afterWire + 300, () => { press.hidden = false; });
  t.at(afterWire + 1300, () => {
    wire.classList.add('filed');
    page.hidden = false;
    goTo(page);
  });
}

render();
