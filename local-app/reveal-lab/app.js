const screens = [
  '/demo-assets/duolingo-vocabulary-choice.jpg',
  '/demo-assets/duolingo-sentence-translation.jpg',
  '/demo-assets/duolingo-listening-exercise.jpg',
];

const variants = {
  1: { title: 'Signal Scan', description: 'Screens and reviews resolve around the app as they are found.', render: signalScan },
  2: { title: 'Evidence Conveyor', description: 'Every source passes through a visible scan, verify and extract sequence.', render: evidenceConveyor },
  3: { title: 'Review Pulse', description: 'Customer language becomes themes, then matches back to verified app facts.', render: reviewPulse },
  4: { title: 'Discovery Spotlight', description: 'One meaningful discovery owns the stage at a time.', render: discoverySpotlight },
  5: { title: 'Plan Loom', description: 'Product facts and customer signals visibly weave into two creative ideas.', render: planLoom },
};

const statusSteps = ['App identified', '3 screens found', '8 written reviews read', 'Two creative ideas taking shape'];
let timers = [];
let paused = false;
const variant = Math.min(5, Math.max(1, Number(new URLSearchParams(location.search).get('variant')) || 1));

const stage = document.querySelector('#stage');
const title = document.querySelector('#variantTitle');
const description = document.querySelector('#variantDescription');
const status = document.querySelector('#liveStatus');
const pauseButton = document.querySelector('#pause');

function appIcon() {
  return '<div class="app-icon" aria-label="Duolingo app icon"><i></i><b></b></div>';
}

function image(index, className = 'screen') {
  return `<img class="${className}" src="${screens[index % screens.length]}" alt="Duolingo product screen ${index + 1}">`;
}

function stageHead(label, heading, copy) {
  return `<header><span class="stage-label">${label}</span><h2 class="stage-title">${heading}</h2><p class="stage-copy">${copy}</p></header>`;
}

function signalScan() {
  return `<div class="stage-grid signal-scan">
    <section>${stageHead('LIVE APP ANALYSIS', 'Finding the strongest messages to test', 'App screens and written reviews appear only as they are found.')}
      <div class="scan-canvas">
        <span class="beam b1"></span><span class="beam b2"></span><span class="beam b3"></span>
        ${appIcon()}
        ${screens.map((_, index) => `<div class="orbit-screen orbit-${index + 1}">${image(index)}</div>`).join('')}
      </div>
    </section>
    <aside class="review-scanner"><span class="scanner-line"></span><span class="stage-label">REVIEW SIGNAL SCANNER</span><p class="stage-copy">Reading recent reviews and highlighting repeated customer language.</p>
      <div class="review-stack">
        <div class="review-card">“The lessons are <strong>short enough for my commute</strong>.”</div>
        <div class="review-card">“I like the <strong>variety of practice</strong>—listening, speaking and reading.”</div>
        <div class="review-card">“The reminders help me <strong>keep coming back</strong>.”</div>
      </div>
    </aside>
  </div>`;
}

function evidenceConveyor() {
  const rows = [
    ['Store listing', 'Duolingo · Education', 'Bite-sized lessons and guided practice', '✓ Verified app fact'],
    ['Product screens', '3 screens found', 'Lesson, listening and vocabulary flows', '✓ Verified product evidence'],
    ['Written reviews', '8 reviews read', 'Short lessons and variety recur', '↗ Recurring audience signal'],
  ];
  return `<div class="stage-grid conveyor"><section>${stageHead('EVIDENCE CONVEYOR', 'Building your creative plan', 'Raw sources move through the same visible process: scan, verify, then shape the test.')}
    <div class="conveyor-lines">${rows.map((row, index) => `<div class="conveyor-row"><div class="source-name">${row[0]}</div><div class="raw-tile">${index === 1 ? screens.map((_, i) => image(i, 'screen mini')).join('') : row[1]}</div><div class="scan-cell">${row[2]}</div><div class="verify-cell">${row[3]}</div></div>`).join('')}</div>
    </section><aside class="forming"><article><h3>Idea A forming</h3><div class="skeleton"><i></i><i></i><i></i></div></article><article><h3>Idea B forming</h3><div class="skeleton"><i></i><i></i><i></i></div></article></aside></div>`;
}

function reviewPulse() {
  const reviews = [
    '“The <strong>lessons are short</strong>. Perfect for a quick break.”',
    '“It keeps me <strong>coming back every day</strong>.”',
    '“It mixes reading, listening and speaking—great <strong>variety</strong>.”',
  ];
  const themes = [['Short lessons', 'Fits real life'], ['Easy to keep going', 'Builds momentum'], ['Variety of practice', 'Keeps it fresh']];
  return `<div class="stage-grid pulse-layout"><section class="pulse-col"><span class="stage-label">RECENT WRITTEN REVIEWS</span><p class="stage-copy">Reading what users care about.</p><div class="pulse-reviews">${reviews.map((review) => `<div class="review-card">${review}</div>`).join('')}</div></section>
    <section class="pulse-col themes">${themes.map(([name, note]) => `<div class="theme-pulse"><div class="pulse-ring"></div><b>${name}</b><small>${note}</small></div>`).join('')}</section>
    <section class="pulse-col"><span class="stage-label">MATCHED TO YOUR APP</span><p class="stage-copy">Reviews shape the message. Your app proves it.</p><div class="proof-matches">${themes.map(([name], index) => `<article class="proof-card">${image(index, '')}<div><b>${name}</b><small>Matched to a real product screen and App Store description.</small><span class="chip">Verified in your app</span></div></article>`).join('')}</div></section></div>`;
}

function discoverySpotlight() {
  return `<div class="stage-grid spotlight"><aside class="chapters"><div class="chapter done">01<br>App identified</div><div class="chapter active">02<br>Screens found</div><div class="chapter">03<br>Reviews being read</div><div class="chapter">04<br>Two ideas built</div></aside>
    <section class="spotlight-stage">${appIcon()}<div class="fan">${screens.map((_, i) => image(i)).join('')}<span class="aperture"></span></div><p class="stage-copy">Newest screen added to the usable set</p></section>
    <aside class="finding"><span class="stage-label">LATEST FINDING</span><h3>3 useful product screens</h3><p>These screens show lesson choice, translation and listening inside the real app.</p><small>NEXT: READING WRITTEN REVIEWS →</small></aside></div>`;
}

function planLoom() {
  return `<div class="stage-grid loom"><section class="source-stacks"><article class="source-box"><h3>Verified app facts</h3><ul><li>Bite-sized language lessons</li><li>Speaking, reading and listening</li><li>Guided chess practice</li></ul></article><article class="source-box signals"><h3>Customer language</h3><ul><li>“Easy to fit into my day”</li><li>“Keeps me coming back”</li><li>“Lots of ways to practice”</li></ul></article></section>
    <div class="loom-field"><svg viewBox="0 0 560 620" role="img" aria-label="Evidence paths connecting sources to two creative ideas"><path d="M0 120 C180 120 180 180 350 180 S450 130 560 130"/><path d="M0 180 C160 180 250 270 380 270 S470 340 560 340"/><path d="M0 245 C160 245 210 130 380 130 S470 180 560 180"/><path class="signal" d="M0 390 C190 390 210 230 390 230 S480 220 560 220"/><path class="signal" d="M0 455 C160 455 260 430 390 430 S490 390 560 390"/><path class="signal" d="M0 510 C160 510 250 330 390 330 S470 440 560 440"/><circle cx="210" cy="180" r="5"/><circle cx="390" cy="270" r="5"/><circle cx="380" cy="130" r="5"/></svg></div>
    <section class="idea-stacks"><article class="idea-box"><h3>Idea A</h3><div class="idea-proof">${image(1, '')}<p><b>Short lessons that fit real life</b><br><br>Shaped by a verified lesson screen and repeated review language.</p></div></article><article class="idea-box"><h3>Idea B</h3><div class="idea-proof">${image(2, '')}<p><b>More ways to practise</b><br><br>Shaped by verified listening proof and customer interest in variety.</p></div></article></section></div>`;
}

function clearTimers() { timers.forEach(clearTimeout); timers = []; }

function startStatusSequence() {
  clearTimers();
  statusSteps.forEach((copy, index) => {
    timers.push(setTimeout(() => {
      status.textContent = copy;
      document.querySelectorAll('[data-step]').forEach((node) => node.classList.toggle('active', Number(node.dataset.step) <= index));
    }, index * 1900));
  });
}

function render({ replay = false } = {}) {
  const config = variants[variant];
  title.textContent = config.title;
  description.textContent = config.description;
  document.querySelectorAll('[data-variant-link]').forEach((link) => link.classList.toggle('active', Number(link.dataset.variantLink) === variant));
  stage.className = 'stage';
  stage.innerHTML = config.render();
  if (replay) void stage.offsetWidth;
  paused = false;
  pauseButton.textContent = 'Ⅱ Pause';
  pauseButton.setAttribute('aria-pressed', 'false');
  document.querySelector('.timeline-fill').style.animation = 'none';
  void document.querySelector('.timeline-fill').offsetWidth;
  document.querySelector('.timeline-fill').style.animation = '';
  startStatusSequence();
}

document.querySelector('#replay').addEventListener('click', () => render({ replay: true }));
pauseButton.addEventListener('click', () => {
  paused = !paused;
  stage.classList.toggle('paused', paused);
  pauseButton.textContent = paused ? '▶ Resume' : 'Ⅱ Pause';
  pauseButton.setAttribute('aria-pressed', String(paused));
});

render();
