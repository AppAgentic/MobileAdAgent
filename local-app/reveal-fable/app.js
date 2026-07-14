/* Research Reveal — Fable set.
 * Five interaction theses over the same truthful evidence chain:
 * listing -> real screens -> written reviews -> language×fact match -> two ideas -> 14/14 split.
 * Everything rendered comes from the reviewed demo fixture; no invented metrics. */

const SCREENS = [
  {
    src: '/demo-assets/duolingo-vocabulary-choice.jpg',
    title: 'Vocabulary choice',
    note: 'A Spanish vocabulary question asks the learner to pick the right translation for “the glass”.',
    callouts: [
      { x: 46, y: 15, text: 'One clear question: “Which of these is ‘the glass’?”' },
      { x: 72, y: 82, text: 'Instant feedback the moment you answer' },
    ],
  },
  {
    src: '/demo-assets/duolingo-sentence-translation.jpg',
    title: 'Sentence translation',
    note: 'A guided exercise asks the learner to build “I want a salad” from a Spanish word bank.',
    callouts: [
      { x: 50, y: 12, text: 'Short exercise — a single sentence at a time' },
      { x: 40, y: 44, text: 'Tap-to-build word bank, no typing needed' },
    ],
  },
  {
    src: '/demo-assets/duolingo-listening-exercise.jpg',
    title: 'Listening exercise',
    note: 'A listening exercise asks the learner to type the Spanish phrase they hear.',
    callouts: [
      { x: 62, y: 27, text: 'Normal and slowed-down audio to listen again' },
      { x: 44, y: 12, text: 'A different skill: “Type what you hear”' },
    ],
  },
];

const REVIEWS = [
  { quote: 'The lessons are short enough to do on my commute.', mark: 'short enough to do on my commute', theme: 0 },
  { quote: 'Five minutes here and there actually adds up.', mark: 'Five minutes here and there', theme: 0 },
  { quote: 'It keeps me coming back every single day.', mark: 'keeps me coming back', theme: 1 },
  { quote: 'I stopped dreading practice — I just do a quick lesson.', mark: 'a quick lesson', theme: 0 },
  { quote: 'I like that it mixes listening, reading and speaking.', mark: 'mixes listening, reading and speaking', theme: 2 },
  { quote: 'The variety keeps it from feeling like homework.', mark: 'variety', theme: 2 },
];

const THEMES = [
  { name: 'Fits a real day', note: 'Users describe squeezing lessons into commutes and breaks.' },
  { name: 'Easy to keep going', note: 'Users describe coming back daily without effort.' },
  { name: 'Variety of practice', note: 'Users like switching between listening, reading and speaking.' },
];

const APP = {
  name: 'Duolingo: Language Lessons',
  category: 'Education',
  subtitle: 'Short guided language practice',
  source: 'App Store listing',
  summary: 'Short vocabulary, translation, listening, speaking, reading and writing exercises.',
};

const IDEAS = [
  {
    label: 'Idea A',
    title: 'Lessons short enough for a real day',
    line: 'Show one real lesson finishing in the time a coffee break takes.',
    screen: 1,
    language: [REVIEWS[0], REVIEWS[3]],
    fact: 'Short single-sentence exercises — seen directly in the app’s own screens.',
    count: 14,
  },
  {
    label: 'Idea B',
    title: 'One app, many ways to practice',
    line: 'Cut between vocabulary, translation and listening — all real screens, no mockups.',
    screen: 2,
    language: [REVIEWS[4], REVIEWS[5]],
    fact: 'Three distinct exercise types — each one found as a real screen.',
    count: 14,
  },
];

const STATUS_STEPS = ['App identified', '3 real screens found', '6 written reviews read', 'Two ideas drafted — 14 creatives each'];

/* ---------- shell ---------- */

const stage = document.querySelector('#stage');
const statusEl = document.querySelector('#status');
const thesisEl = document.querySelector('#thesis');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let timers = [];
let cleanups = [];

function at(ms, fn) {
  if (reduced) { fn(); return; }
  timers.push(setTimeout(fn, ms));
}
function onCleanup(fn) { cleanups.push(fn); }
function setStatus(text) { statusEl.textContent = text; }
function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function markQuote(review) {
  const safe = esc(review.quote);
  return safe.replace(esc(review.mark), `<mark>${esc(review.mark)}</mark>`);
}
function screenImg(index, className = '') {
  const screen = SCREENS[index];
  return `<img class="shot ${className}" src="${screen.src}" alt="Real app screen: ${esc(screen.title)}" loading="eager">`;
}
function appIcon(size = '') {
  return `<span class="owl ${size}" aria-label="App icon found on the store listing" role="img"><i></i><i></i><b></b></span>`;
}

const VARIANTS = {
  1: { name: 'Case File', thesis: 'You control the pace — scroll to open each chapter of the research file.', render: caseFile },
  2: { name: 'Evidence Wall', thesis: 'Hover or tap any card on the wall to trace exactly where it leads.', render: evidenceWall },
  3: { name: 'Worklog', thesis: 'The work happens line by line — click any finished line to reopen what it found.', render: worklog },
  4: { name: 'Darkroom', thesis: 'One finding under the light at a time — click or press → to advance.', render: darkroom },
  5: { name: 'Receipts', thesis: 'Both ideas are written in front of you — hover any highlighted phrase for its source.', render: receipts },
};

const variant = Math.min(5, Math.max(1, Number(new URLSearchParams(location.search).get('variant')) || 1));

function render() {
  timers.forEach(clearTimeout);
  timers = [];
  cleanups.forEach((fn) => fn());
  cleanups = [];
  const config = VARIANTS[variant];
  document.body.dataset.variant = String(variant);
  document.querySelectorAll('[data-v]').forEach((link) => link.classList.toggle('active', Number(link.dataset.v) === variant));
  thesisEl.textContent = config.thesis;
  setStatus('Opening your app…');
  stage.innerHTML = '';
  stage.scrollTop = 0;
  window.scrollTo(0, 0);
  config.render();
}

document.querySelector('#replay').addEventListener('click', render);

/* =========================================================
 * 01 — CASE FILE: scroll-paced dossier with sticky exhibits
 * ======================================================= */
function caseFile() {
  stage.innerHTML = `
  <div class="v1">
    <nav class="v1-rail" aria-label="File chapters">
      ${['Cover', 'Listing', 'Screens', 'Reviews', 'Match', 'Ideas'].map((name, index) => `<a href="#v1ch${index}" data-rail="${index}"><b></b>${name}</a>`).join('')}
    </nav>

    <section class="v1-cover" id="v1ch0" data-ch="0">
      <p class="kicker">RESEARCH FILE · PREPARED BEFORE YOU PAY</p>
      <h1>We looked at <em>your&nbsp;app</em>,<br>not a template.</h1>
      <div class="v1-id">
        ${appIcon()}
        <div><b>${APP.name}</b><span>${APP.category} · found via your ${APP.source}</span></div>
        <em class="stamp">FILE OPENED</em>
      </div>
      <p class="v1-hint">Scroll to open the file <span>↓</span></p>
    </section>

    <section class="v1-ch" id="v1ch1" data-ch="1">
      <header><span class="chno">01</span><h2>The listing, read closely</h2></header>
      <div class="v1-listing">
        <article class="card">
          ${appIcon('sm')}
          <div>
            <b>${APP.name}</b>
            <span>${APP.subtitle}</span>
            <p>“${APP.summary}”</p>
          </div>
        </article>
        <p class="v1-note">This is the starting truth: what your own store page promises. Everything after this has to be proven, not assumed.</p>
      </div>
    </section>

    <section class="v1-ch v1-screens" id="v1ch2" data-ch="2">
      <header><span class="chno">02</span><h2>Three real screens, examined</h2></header>
      <div class="v1-split">
        <div class="v1-sticky">
          <figure class="phone"><img id="v1Phone" src="${SCREENS[0].src}" alt="Current exhibit screen"></figure>
        </div>
        <div class="v1-exhibits">
          ${SCREENS.map((screen, index) => `
            <article class="v1-exhibit" data-screen="${index}">
              <span class="exlabel">EXHIBIT ${'ABC'[index]}</span>
              <h3>${screen.title}</h3>
              <p>${screen.note}</p>
              <em class="stamp">USABLE FOR ADS</em>
            </article>`).join('')}
        </div>
      </div>
    </section>

    <section class="v1-ch" id="v1ch3" data-ch="3">
      <header><span class="chno">03</span><h2>What people wrote, in their own words</h2></header>
      <div class="v1-reviews">
        ${REVIEWS.map((review) => `<blockquote class="rev">${markQuote(review)}<cite>written store review</cite></blockquote>`).join('')}
      </div>
      <p class="v1-note center">Six written reviews, read in full. The highlighted phrases repeat across different people.</p>
    </section>

    <section class="v1-ch" id="v1ch4" data-ch="4">
      <header><span class="chno">04</span><h2>Their words, your proof</h2></header>
      <div class="v1-match">
        ${IDEAS.map((idea) => `
          <div class="v1-matchrow">
            <div class="say"><span>PEOPLE SAY</span>${idea.language.map((review) => `<q>${esc(review.mark)}</q>`).join('')}</div>
            <div class="arrow">→</div>
            <div class="prove"><span>YOUR APP SHOWS</span>${screenImg(idea.screen, 'mini')}<p>${idea.fact}</p></div>
          </div>`).join('')}
      </div>
      <p class="v1-note center">Reviews shape the message. Only screens from your actual app are allowed to prove a feature.</p>
    </section>

    <section class="v1-ch v1-final" id="v1ch5" data-ch="5">
      <header><span class="chno">05</span><h2>Two ideas this app has earned</h2></header>
      <div class="v1-ideas">
        ${IDEAS.map((idea) => `
          <article class="idea">
            <span class="idealabel">${idea.label}</span>
            <h3>${idea.title}</h3>
            <p>${idea.line}</p>
            <div class="idea-src">${screenImg(idea.screen, 'mini')}<ul>${idea.language.map((review) => `<li>“${esc(review.mark)}”</li>`).join('')}<li class="fact">${idea.fact}</li></ul></div>
            <footer>${idea.count} creatives planned on this idea</footer>
          </article>`).join('')}
      </div>
      <div class="split-bar"><i style="width:50%"></i><span>28 creatives · split 14 / 14 across the two ideas</span></div>
      <button class="ghost v1-replay" type="button">↻ Read the file again</button>
    </section>
  </div>`;

  const phone = stage.querySelector('#v1Phone');
  const chapters = [...stage.querySelectorAll('[data-ch]')];
  const railLinks = [...stage.querySelectorAll('[data-rail]')];
  const statusByChapter = ['Opening your app…', 'App identified', '3 real screens found', '6 written reviews read', 'Matching words to proof', 'Two ideas drafted — 14 creatives each'];

  const chapterObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('on');
      const ch = Number(entry.target.dataset.ch);
      railLinks.forEach((link) => link.classList.toggle('here', Number(link.dataset.rail) === ch));
      setStatus(statusByChapter[ch]);
    });
  }, { threshold: 0.3 });
  chapters.forEach((section) => chapterObserver.observe(section));

  const exhibitObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('on');
      phone.src = SCREENS[Number(entry.target.dataset.screen)].src;
    });
  }, { threshold: 0.6 });
  stage.querySelectorAll('.v1-exhibit').forEach((node) => exhibitObserver.observe(node));

  stage.querySelector('.v1-replay').addEventListener('click', render);
  onCleanup(() => { chapterObserver.disconnect(); exhibitObserver.disconnect(); });
}

/* =========================================================
 * 02 — EVIDENCE WALL: spatial pinboard with traceable threads
 * ======================================================= */
function evidenceWall() {
  const pins = [
    { id: 'app', x: 50, y: 13, cls: 'pin-id', html: `${appIcon('sm')}<div><b>${APP.name}</b><span>${APP.category} · ${APP.source}</span></div>` },
    { id: 's0', x: 15, y: 34, cls: 'pin-shot', html: `${screenImg(0)}<figcaption>${SCREENS[0].title}</figcaption>` },
    { id: 's1', x: 38, y: 40, cls: 'pin-shot', html: `${screenImg(1)}<figcaption>${SCREENS[1].title}</figcaption>` },
    { id: 's2', x: 62, y: 34, cls: 'pin-shot', html: `${screenImg(2)}<figcaption>${SCREENS[2].title}</figcaption>` },
    { id: 'r0', x: 85, y: 22, cls: 'pin-rev', html: `<p>${markQuote(REVIEWS[0])}</p><cite>written review</cite>` },
    { id: 'r3', x: 87, y: 44, cls: 'pin-rev', html: `<p>${markQuote(REVIEWS[3])}</p><cite>written review</cite>` },
    { id: 'r4', x: 84, y: 66, cls: 'pin-rev', html: `<p>${markQuote(REVIEWS[4])}</p><cite>written review</cite>` },
    { id: 'r5', x: 12, y: 62, cls: 'pin-rev', html: `<p>${markQuote(REVIEWS[5])}</p><cite>written review</cite>` },
    { id: 'ideaA', x: 30, y: 86, cls: 'pin-idea', html: `<span>${IDEAS[0].label}</span><b>${IDEAS[0].title}</b><p>${IDEAS[0].line}</p><footer>14 creatives</footer>` },
    { id: 'ideaB', x: 70, y: 86, cls: 'pin-idea', html: `<span>${IDEAS[1].label}</span><b>${IDEAS[1].title}</b><p>${IDEAS[1].line}</p><footer>14 creatives</footer>` },
  ];
  const edges = [
    ['app', 's0'], ['app', 's1'], ['app', 's2'],
    ['s1', 'ideaA'], ['r0', 'ideaA'], ['r3', 'ideaA'],
    ['s0', 'ideaB'], ['s2', 'ideaB'], ['r4', 'ideaB'], ['r5', 'ideaB'],
  ];

  stage.innerHTML = `
  <div class="v2">
    <header class="v2-head">
      <div><p class="kicker">EVIDENCE WALL</p><h1>Everything on this wall was found in your app.</h1></div>
      <p class="v2-hint" id="v2Hint">Pinning evidence…</p>
    </header>
    <div class="v2-board" id="v2Board">
      <svg class="v2-threads" id="v2Threads" aria-hidden="true"></svg>
      ${pins.map((pin, index) => `<article class="v2-pin ${pin.cls}" data-pin="${pin.id}" tabindex="0" style="--x:${pin.x};--y:${pin.y};--d:${index}">${pin.html}</article>`).join('')}
    </div>
    <div class="v2-mobile-note">On small screens the wall becomes a list — each idea keeps its evidence attached below it.</div>
  </div>`;

  const board = stage.querySelector('#v2Board');
  const svg = stage.querySelector('#v2Threads');
  const hint = stage.querySelector('#v2Hint');
  const pinEls = new Map([...stage.querySelectorAll('[data-pin]')].map((node) => [node.dataset.pin, node]));

  const connected = new Map();
  pins.forEach((pin) => connected.set(pin.id, new Set([pin.id])));
  edges.forEach(([a, b]) => { connected.get(a).add(b); connected.get(b).add(a); });
  // An idea's full chain includes the app card; tracing an idea should light everything it uses.
  ['ideaA', 'ideaB'].forEach((id) => connected.get(id).add('app'));

  function center(node) {
    const box = node.getBoundingClientRect();
    const frame = board.getBoundingClientRect();
    return [box.left - frame.left + box.width / 2, box.top - frame.top + box.height / 2];
  }

  function drawThreads() {
    if (board.clientWidth < 720) { svg.innerHTML = ''; return; }
    const frame = `0 0 ${board.clientWidth} ${board.clientHeight}`;
    svg.setAttribute('viewBox', frame);
    svg.innerHTML = edges.map(([a, b], index) => {
      const [x1, y1] = center(pinEls.get(a));
      const [x2, y2] = center(pinEls.get(b));
      const sag = 26 + (index % 3) * 14;
      return `<path data-edge="${a}:${b}" d="M${x1} ${y1} Q${(x1 + x2) / 2} ${Math.max(y1, y2) + sag} ${x2} ${y2}"/>`;
    }).join('');
  }

  pins.forEach((pin, index) => at(350 + index * 340, () => pinEls.get(pin.id).classList.add('on')));
  at(350 + pins.length * 340, () => {
    board.classList.add('threaded');
    drawThreads();
    hint.textContent = 'Hover or tap any card to trace where it leads.';
    setStatus(STATUS_STEPS[3]);
  });
  at(700, () => setStatus(STATUS_STEPS[0]));
  at(1700, () => setStatus(STATUS_STEPS[1]));
  at(2900, () => setStatus(STATUS_STEPS[2]));

  function trace(id) {
    const set = connected.get(id);
    board.classList.add('tracing');
    pinEls.forEach((node, pinId) => node.classList.toggle('lit', set.has(pinId)));
    svg.querySelectorAll('path').forEach((path) => {
      const [a, b] = path.dataset.edge.split(':');
      path.classList.toggle('lit', a === id || b === id || (set.has(a) && set.has(b) && (a === id || b === id)));
    });
  }
  function untrace() {
    board.classList.remove('tracing');
    pinEls.forEach((node) => node.classList.remove('lit'));
    svg.querySelectorAll('path').forEach((path) => path.classList.remove('lit'));
  }

  const over = (event) => { const pin = event.target.closest('[data-pin]'); if (pin) trace(pin.dataset.pin); };
  const out = (event) => { if (event.target.closest('[data-pin]')) untrace(); };
  const click = (event) => {
    const pin = event.target.closest('[data-pin]');
    if (!pin) { untrace(); return; }
    if (pin.classList.contains('lit') && board.classList.contains('tracing')) untrace();
    else trace(pin.dataset.pin);
  };
  board.addEventListener('mouseover', over);
  board.addEventListener('mouseout', out);
  board.addEventListener('click', click);
  board.addEventListener('focusin', over);
  board.addEventListener('focusout', out);
  const resize = () => drawThreads();
  window.addEventListener('resize', resize);
  onCleanup(() => window.removeEventListener('resize', resize));
}

/* =========================================================
 * 03 — WORKLOG: typed session log; every line produces its artifact
 * ======================================================= */
function worklog() {
  const steps = [
    { line: 'open store listing', found: `${APP.name} — ${APP.category}`, artifact: 'listing', status: STATUS_STEPS[0] },
    { line: 'read listing description', found: 'short guided practice: vocabulary, translation, listening', artifact: 'listing' },
    { line: 'collect product screens', found: '3 screens found', artifact: 'screens', status: STATUS_STEPS[1] },
    { line: 'inspect screen 1 — vocabulary choice', found: 'usable for ads', artifact: 'screen0' },
    { line: 'inspect screen 2 — sentence translation', found: 'usable for ads', artifact: 'screen1' },
    { line: 'inspect screen 3 — listening exercise', found: 'usable for ads', artifact: 'screen2' },
    { line: 'read written reviews', found: '6 reviews read in full', artifact: 'reviews', status: STATUS_STEPS[2] },
    { line: 'highlight repeated customer language', found: '"short" · "keeps me coming back" · "variety"', artifact: 'themes' },
    { line: 'match language to app proof', found: 'reviews shape the message — screens prove the feature', artifact: 'match' },
    { line: 'draft idea A', found: IDEAS[0].title, artifact: 'ideaA' },
    { line: 'draft idea B', found: IDEAS[1].title, artifact: 'ideaB', status: STATUS_STEPS[3] },
    { line: 'plan the pack', found: '28 creatives — 14 per idea', artifact: 'split' },
  ];

  const artifacts = {
    listing: () => `<div class="v3-art-listing">${appIcon()}<h2>${APP.name}</h2><p class="dim">${APP.subtitle}</p><p class="quotebox">“${APP.summary}”</p><span class="chip">Found on your ${APP.source}</span></div>`,
    screens: () => `<div class="v3-art-screens">${SCREENS.map((_, index) => screenImg(index)).join('')}</div><p class="dim center">Three real screens pulled from the listing — nothing generated.</p>`,
    screen0: () => artifactScreen(0),
    screen1: () => artifactScreen(1),
    screen2: () => artifactScreen(2),
    reviews: () => `<div class="v3-art-reviews">${REVIEWS.map((review) => `<blockquote class="rev">${markQuote(review)}<cite>written store review</cite></blockquote>`).join('')}</div>`,
    themes: () => `<div class="v3-art-themes">${THEMES.map((theme) => `<div class="themecard"><b>${theme.name}</b><p>${theme.note}</p></div>`).join('')}</div><p class="dim center">Themes come only from the reviews above — they can shape a message, not prove a feature.</p>`,
    match: () => `<div class="v3-art-match">${IDEAS.map((idea) => `<div class="v1-matchrow"><div class="say"><span>PEOPLE SAY</span>${idea.language.map((review) => `<q>${esc(review.mark)}</q>`).join('')}</div><div class="arrow">→</div><div class="prove"><span>YOUR APP SHOWS</span>${screenImg(idea.screen, 'mini')}<p>${idea.fact}</p></div></div>`).join('')}</div>`,
    ideaA: () => artifactIdea(0),
    ideaB: () => artifactIdea(1),
    split: () => `<div class="v3-art-split"><h2>28 creatives, planned</h2><div class="split-bar big"><i style="width:50%"></i><span>14 on ${IDEAS[0].title} · 14 on ${IDEAS[1].title}</span></div><p class="dim center">Both ideas ship. Real results decide which one earns the next round.</p></div>`,
  };
  function artifactScreen(index) {
    const screen = SCREENS[index];
    return `<div class="v3-art-screen">${screenImg(index)}<div><h3>${screen.title}</h3><p>${screen.note}</p><em class="stamp">USABLE FOR ADS</em></div></div>`;
  }
  function artifactIdea(index) {
    const idea = IDEAS[index];
    return `<article class="idea big"><span class="idealabel">${idea.label}</span><h3>${idea.title}</h3><p>${idea.line}</p><div class="idea-src">${screenImg(idea.screen, 'mini')}<ul>${idea.language.map((review) => `<li>“${esc(review.mark)}”</li>`).join('')}<li class="fact">${idea.fact}</li></ul></div></article>`;
  }

  stage.innerHTML = `
  <div class="v3">
    <section class="v3-log">
      <header><span class="kicker">SESSION LOG</span><button class="ghost sm" id="v3Follow" hidden>▶ Back to live</button></header>
      <ol id="v3Lines"></ol>
    </section>
    <section class="v3-view"><div class="v3-art" id="v3Art"><p class="dim v3-wait">Session starting…</p></div></section>
  </div>`;

  const list = stage.querySelector('#v3Lines');
  const art = stage.querySelector('#v3Art');
  const follow = stage.querySelector('#v3Follow');
  let liveIndex = -1;
  let pinned = null;

  function showArtifact(key) {
    art.innerHTML = artifacts[key]();
    art.classList.remove('swap');
    void art.offsetWidth;
    art.classList.add('swap');
  }

  function selectLine(index) {
    [...list.children].forEach((node, i) => node.classList.toggle('sel', i === index));
  }

  steps.forEach((step, index) => {
    at(600 + index * (reduced ? 0 : 1500), () => {
      const item = document.createElement('li');
      item.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b><span class="cmd">${esc(step.line)}</span><span class="out">— ${esc(step.found)}</span>`;
      item.tabIndex = 0;
      item.addEventListener('click', () => {
        pinned = index;
        follow.hidden = false;
        selectLine(index);
        showArtifact(step.artifact);
      });
      list.append(item);
      requestAnimationFrame(() => item.classList.add('on'));
      list.parentElement.scrollTop = list.parentElement.scrollHeight;
      liveIndex = index;
      if (step.status) setStatus(step.status);
      if (pinned === null) { selectLine(index); showArtifact(step.artifact); }
    });
  });

  follow.addEventListener('click', () => {
    pinned = null;
    follow.hidden = true;
    if (liveIndex >= 0) { selectLine(liveIndex); showArtifact(steps[liveIndex].artifact); }
  });
}

/* =========================================================
 * 04 — DARKROOM: user-stepped spotlight examination
 * ======================================================= */
function darkroom() {
  const beats = [
    { status: STATUS_STEPS[0], html: `<div class="v4-id">${appIcon()}<h1>${APP.name}</h1><p class="dim">${APP.category} · identified from your ${APP.source}</p></div>`, caption: 'Found your app. Now the evidence.' },
    ...SCREENS.map((screen, index) => ({
      status: index === 2 ? STATUS_STEPS[1] : `Examining screen ${index + 1} of 3`,
      html: `<div class="v4-exam"><figure class="phone lg">${screenImg(index)}${screen.callouts.map((callout) => `<span class="callout" style="--cx:${callout.x};--cy:${callout.y}"><i></i>${esc(callout.text)}</span>`).join('')}</figure></div>`,
      caption: `Real screen ${index + 1} of 3 — ${screen.title}. ${screen.note}`,
    })),
    { status: STATUS_STEPS[2], html: `<div class="v4-revs">${[REVIEWS[0], REVIEWS[2], REVIEWS[4]].map((review) => `<blockquote class="rev lg">${markQuote(review)}<cite>written store review</cite></blockquote>`).join('')}</div>`, caption: 'Six written reviews read — these three carry the phrases that repeat.' },
    { status: 'Matching words to proof', html: `<div class="v4-match">${IDEAS.map((idea) => `<div class="v1-matchrow dark"><div class="say"><span>PEOPLE SAY</span>${idea.language.map((review) => `<q>${esc(review.mark)}</q>`).join('')}</div><div class="arrow">→</div><div class="prove"><span>YOUR APP SHOWS</span>${screenImg(idea.screen, 'mini')}<p>${idea.fact}</p></div></div>`).join('')}</div>`, caption: 'Reviews shape the message. Only your app’s real screens prove a feature.' },
    { status: STATUS_STEPS[3], html: `<div class="v4-final"><div class="v1-ideas">${IDEAS.map((idea) => `<article class="idea"><span class="idealabel">${idea.label}</span><h3>${idea.title}</h3><p>${idea.line}</p><div class="idea-src">${screenImg(idea.screen, 'mini')}<ul>${idea.language.map((review) => `<li>“${esc(review.mark)}”</li>`).join('')}</ul></div><footer>${idea.count} creatives planned</footer></article>`).join('')}</div><div class="split-bar"><i style="width:50%"></i><span>28 creatives · 14 / 14 across the two ideas</span></div></div>`, caption: 'Two ideas this app has earned — 14 creatives each.' },
  ];

  stage.innerHTML = `
  <div class="v4" id="v4Room" tabindex="0" aria-label="Darkroom reveal — click or press arrow keys to step through findings">
    <div class="v4-vignette" id="v4Vig"></div>
    <div class="v4-beat" id="v4Beat"></div>
    <p class="v4-caption" id="v4Cap"></p>
    <div class="v4-nav">
      <span class="v4-count" id="v4Count"></span>
      <div class="v4-dots" id="v4Dots">${beats.map((_, index) => `<button type="button" data-dot="${index}" aria-label="Go to finding ${index + 1}"></button>`).join('')}</div>
      <span class="v4-key">click · <b>→</b> next · <b>←</b> back</span>
    </div>
  </div>`;

  const room = stage.querySelector('#v4Room');
  const beat = stage.querySelector('#v4Beat');
  const caption = stage.querySelector('#v4Cap');
  const count = stage.querySelector('#v4Count');
  const dots = [...stage.querySelectorAll('[data-dot]')];
  const vignette = stage.querySelector('#v4Vig');
  let index = 0;

  function show(next) {
    index = Math.min(beats.length - 1, Math.max(0, next));
    const item = beats[index];
    beat.innerHTML = item.html;
    caption.textContent = item.caption;
    count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(beats.length).padStart(2, '0')}`;
    dots.forEach((dot, i) => dot.classList.toggle('here', i === index));
    setStatus(item.status);
    beat.classList.remove('swap');
    void beat.offsetWidth;
    beat.classList.add('swap');
  }

  const advance = (event) => {
    if (event.target.closest('[data-dot]')) return;
    show(index + 1);
  };
  room.addEventListener('click', advance);
  dots.forEach((dot) => dot.addEventListener('click', () => show(Number(dot.dataset.dot))));
  const keys = (event) => {
    if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); show(index + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
  };
  window.addEventListener('keydown', keys);
  onCleanup(() => window.removeEventListener('keydown', keys));

  if (!reduced) {
    const glow = (event) => {
      const box = room.getBoundingClientRect();
      vignette.style.setProperty('--mx', `${((event.clientX - box.left) / box.width) * 100}%`);
      vignette.style.setProperty('--my', `${((event.clientY - box.top) / box.height) * 100}%`);
    };
    room.addEventListener('pointermove', glow);
  }

  show(0);
  room.focus({ preventScroll: true });
}

/* =========================================================
 * 05 — RECEIPTS: ideas written live; every sourced phrase gets a receipt
 * ======================================================= */
function receipts() {
  const scripts = IDEAS.map((idea, ideaIndex) => ({
    idea,
    tokens: ideaIndex === 0
      ? [
        { t: 'Show one ' }, { t: 'real lesson', src: { kind: 'screen', i: 1 } }, { t: ' finishing in the time a coffee break takes. People already call it ' },
        { t: '“short enough to do on my commute”', src: { kind: 'review', i: 0 } }, { t: ' and ' }, { t: '“a quick lesson”', src: { kind: 'review', i: 3 } },
        { t: ' — the sentence-translation screen proves it in one glance.' },
      ]
      : [
        { t: 'Cut between ' }, { t: 'vocabulary', src: { kind: 'screen', i: 0 } }, { t: ', ' }, { t: 'translation', src: { kind: 'screen', i: 1 } }, { t: ' and ' },
        { t: 'listening', src: { kind: 'screen', i: 2 } }, { t: ' — all real screens. Reviewers say it ' },
        { t: '“mixes listening, reading and speaking”', src: { kind: 'review', i: 4 } }, { t: ' and that the ' }, { t: '“variety”', src: { kind: 'review', i: 5 } },
        { t: ' keeps practice from feeling like homework.' },
      ],
  }));

  stage.innerHTML = `
  <div class="v5">
    <header class="v5-tray">
      <div class="v5-tray-item">${appIcon('sm')}<span><b>${APP.name}</b><small>identified</small></span></div>
      <div class="v5-tray-item shots">${SCREENS.map((_, index) => screenImg(index, 'micro')).join('')}<span><b>3 real screens</b><small>usable for ads</small></span></div>
      <div class="v5-tray-item"><span class="chip">6 written reviews read</span></div>
    </header>
    <p class="v5-lede">Watch both ideas get written from that evidence. <b>Every highlighted phrase has a receipt.</b></p>
    <div class="v5-cards">
      ${scripts.map((script, index) => `
        <article class="v5-card" data-card="${index}">
          <header><span class="idealabel">${script.idea.label}</span><h3>${script.idea.title}</h3></header>
          <p class="v5-text" data-text="${index}"><span class="caret"></span></p>
          <footer class="v5-dock" data-dock="${index}"><span class="docklabel">RECEIPTS</span></footer>
        </article>`).join('')}
    </div>
    <div class="split-bar v5-split"><i style="width:50%"></i><span>28 creatives · 14 / 14 across the two ideas</span></div>
    <div class="v5-tip" id="v5Tip" hidden></div>
  </div>`;

  const tip = stage.querySelector('#v5Tip');

  function receiptHtml(src) {
    if (src.kind === 'screen') {
      return `${screenImg(src.i, 'micro')}<span>${esc(SCREENS[src.i].title)}<small>real app screen</small></span>`;
    }
    return `<span class="q">“${esc(REVIEWS[src.i].mark)}”</span><span>written review<small>store listing</small></span>`;
  }
  function tipHtml(src) {
    if (src.kind === 'screen') {
      return `${screenImg(src.i, 'mini')}<div><b>${esc(SCREENS[src.i].title)}</b><p>${esc(SCREENS[src.i].note)}</p><em>Real screen from your app — this is what proves the phrase.</em></div>`;
    }
    return `<div><b>Written store review</b><p>“${esc(REVIEWS[src.i].quote)}”</p><em>Customer language — it shapes the message, the screens prove the feature.</em></div>`;
  }

  let delay = 900;
  scripts.forEach((script, cardIndex) => {
    const text = stage.querySelector(`[data-text="${cardIndex}"]`);
    const dock = stage.querySelector(`[data-dock="${cardIndex}"]`);
    const caret = text.querySelector('.caret');
    at(delay - 200, () => stage.querySelector(`[data-card="${cardIndex}"]`).classList.add('writing'));
    script.tokens.forEach((token) => {
      const words = token.t.split(/(?<=\s)/);
      let span = null;
      words.forEach((word) => {
        at(delay, () => {
          if (!span) {
            span = document.createElement(token.src ? 'mark' : 'span');
            if (token.src) {
              span.className = 'receipt-mark';
              span.dataset.kind = token.src.kind;
              span.dataset.i = String(token.src.i);
              span.tabIndex = 0;
            }
            text.insertBefore(span, caret);
          }
          span.textContent += word;
        });
        delay += reduced ? 0 : 90;
      });
      if (token.src) {
        const src = token.src;
        at(delay + 60, () => {
          span.classList.add('lit');
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'receipt-chip';
          chip.dataset.kind = src.kind;
          chip.dataset.i = String(src.i);
          chip.innerHTML = receiptHtml(src);
          dock.append(chip);
          setTimeout(() => span.classList.remove('lit'), 900);
        });
        delay += reduced ? 0 : 240;
      }
    });
    at(delay, () => stage.querySelector(`[data-card="${cardIndex}"]`).classList.remove('writing'));
    delay += reduced ? 0 : 500;
  });
  at(200, () => setStatus(STATUS_STEPS[1]));
  at(900, () => setStatus('Writing idea A from the evidence…'));
  scripts.length && at(delay - 400, () => setStatus(STATUS_STEPS[3]));

  const wrap = stage.querySelector('.v5');
  function showTip(target) {
    tip.innerHTML = tipHtml({ kind: target.dataset.kind, i: Number(target.dataset.i) });
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    const frame = wrap.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(12, box.left - frame.left), Math.max(12, frame.width - 332))}px`;
    tip.style.top = `${box.bottom - frame.top + 10}px`;
  }
  const over = (event) => { const target = event.target.closest('.receipt-mark, .receipt-chip'); if (target) showTip(target); };
  const out = (event) => { if (event.target.closest('.receipt-mark, .receipt-chip')) tip.hidden = true; };
  stage.addEventListener('mouseover', over);
  stage.addEventListener('mouseout', out);
  stage.addEventListener('focusin', over);
  stage.addEventListener('focusout', out);
  stage.addEventListener('click', (event) => {
    const target = event.target.closest('.receipt-mark, .receipt-chip');
    if (target) showTip(target); else tip.hidden = true;
  });
}

render();
