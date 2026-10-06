/**
 * Cloud Optimisation Assessment - form experience.
 *
 * Renders every step from questions.json. No question wording, option, or score
 * lives in this file: changing the assessment means changing the bank, not the UI.
 *
 * Scoring happens server-side (PRD section 11). The client validates only to keep
 * the form pleasant; the endpoint validates again because client checks are a
 * convenience, not a guarantee about what arrives.
 */
import { validate } from './vendor/scoring.js';
import { activeTheme, applyTheme, themeToggle as buildThemeToggle } from './theme.js';

const ENDPOINT = '/api/assess';

/**
 * Which assessment this page is.
 *
 * The shell pages are generated from src/services.json and each carries its
 * own slug, so this file never learns the name of any particular assessment.
 * The fallback keeps a directly-loaded app.js working; a test asserts every
 * generated shell carries the attribute, so a missing one fails the build
 * rather than silently serving the wrong bank.
 */
const SERVICE = document.body.getAttribute('data-service') || 'cost';

/* Progress is per assessment. One key for all of them would mean starting the
   DevOps assessment wiped a half-finished cloud one. */
const STORAGE_KEY = `coa.progress.v1.${SERVICE}`;
// In-browser scoring is a development convenience only. Gated on the host so
// nobody on the live site can reach a result that leaves no record.
const DEV_LOCAL = location.hostname === 'localhost' && new URLSearchParams(location.search).has('local');

const view = document.getElementById('view');

/** The shared switch, told how to build an element and how to repaint. */
const themeToggle = () => buildThemeToggle(h, render);

let bank;
let steps = [];
let state = { answers: {}, stepIndex: 0, result: null, started: false, completed: false };

/* ------------------------------------------------------------------ */
/* tiny DOM helper - builds nodes, so text is never parsed as markup   */
/* ------------------------------------------------------------------ */

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  // props is often passed as null for a node that needs no attributes. A
  // default parameter only fills in for undefined, so null has to be handled
  // here - Object.entries(null) throws, and it throws during the first render,
  // which takes the whole page down before anything appears.
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

/* ------------------------------------------------------------------ */
/* analytics - a thin shim, so no third-party script is required       */
/* ------------------------------------------------------------------ */

const SESSION_KEY = `coa.session.v1.${SERVICE}`;
const params = new URLSearchParams(location.search);

/** Random, per-tab, and never joined to a lead - it exists to measure drop-off. */
function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id); }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const queue = [];

function track(event, detail = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...detail });
  window.dispatchEvent(new CustomEvent('assessment', { detail: { event, ...detail } }));

  queue.push({
    name: event,
    question_id: detail.question_id ?? null,
    step: detail.step ?? state.stepIndex,
    source: params.get('utm_source') || null,
    campaign: params.get('utm_campaign') || null,
  });
  if (queue.length >= 8) flushEvents();
}

/**
 * Batched so a slow network never costs the user a tap. `keepalive` lets the
 * final batch survive the page going away, which is the batch that matters
 * most: it is the one that says where someone gave up.
 */
function flushEvents({ final = false } = {}) {
  if (queue.length === 0 || DEV_LOCAL) return;
  const body = JSON.stringify({ service: SERVICE, session_id: sessionId(), events: queue.splice(0, queue.length) });

  try {
    if (final && navigator.sendBeacon) {
      navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* analytics must never surface to the user */ });
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* progress persistence                                                */
/* ------------------------------------------------------------------ */

/** The ids of the contact fields - the part of the answers that is a person. */
const isLeadField = (id) => (bank?.lead_fields ?? []).some((field) => field.id === id);

/**
 * Persists the question answers, never the contact details. Resume brings
 * back the twenty answers; the name, email and company are typed again. That
 * way nothing that identifies a person sits in storage after they walk away
 * from the contact step, or survives a tab restore.
 */
function save() {
  try {
    const answers = Object.fromEntries(
      Object.entries(state.answers).filter(([id]) => !isLeadField(id)),
    );
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      answers, stepIndex: state.stepIndex, started: state.started,
      resumeIndex: state.resumeIndex ?? 0,
    }));
  } catch {
    // Private browsing or blocked storage. Losing resume is acceptable;
    // breaking the assessment is not.
  }
}

/**
 * Restores only the fields save() writes, each checked for shape. Storage is
 * same-origin, so this is not a security boundary - it is the same
 * null/undefined class that blanked the page once: a non-integer stepIndex
 * makes currentStep() undefined and the first render throws. The result and
 * the completed flag are never restored; the result lives on the server.
 */
function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;
    if (!saved.answers || typeof saved.answers !== 'object' || Array.isArray(saved.answers)) return;
    state.answers = saved.answers;
    state.stepIndex = Number.isInteger(saved.stepIndex) && saved.stepIndex >= 0 ? saved.stepIndex : 0;
    state.resumeIndex = Number.isInteger(saved.resumeIndex) && saved.resumeIndex >= 0 ? saved.resumeIndex : 0;
    state.started = saved.started === true;
  } catch { /* ignore malformed state */ }
}

function clearSaved() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* answers                                                             */
/* ------------------------------------------------------------------ */

const answerOf = (id) => state.answers[id];
const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function setAnswer(id, value) {
  if (value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0)) {
    delete state.answers[id];
  } else {
    state.answers[id] = value;
  }
  save();
}

/** Multi-select toggle, honouring exclusive options and the selection cap. */
function toggleMulti(field, optionId, checked) {
  const option = field.options.find((o) => o.id === optionId);
  let current = asArray(answerOf(field.id));

  if (checked && option.exclusive) current = [optionId];
  else if (checked) {
    current = current.filter((id) => !field.options.find((o) => o.id === id)?.exclusive);
    if (!current.includes(optionId)) current = [...current, optionId];
  } else {
    current = current.filter((id) => id !== optionId);
  }
  setAnswer(field.id, current);
}

/* ------------------------------------------------------------------ */
/* steps                                                               */
/* ------------------------------------------------------------------ */

function buildSteps() {
  const built = [{ kind: 'landing' }];
  let current = null;

  // A section screen is inserted wherever the section number changes, so the
  // grouping comes from the bank rather than from a list kept in step with it.
  for (const question of bank.questions) {
    if (question.section !== current) {
      current = question.section;
      const section = bank.sections.find((entry) => entry.n === current);
      if (section) built.push({ kind: 'section', section });
    }
    built.push({ kind: 'question', question });
  }

  built.push({ kind: 'lead' }, { kind: 'result' });
  return built;
}

const currentStep = () => steps[state.stepIndex];

function goTo(index, { announce = true } = {}) {
  state.stepIndex = Math.max(0, Math.min(index, steps.length - 1));
  save();
  flushEvents();
  render();
  if (announce) focusHeading();
}

/**
 * The two values on the result screen that cannot ship as classes.
 *
 * The needle position does - it is .m0 … .m100 - but the fill width is a
 * transition target, and the number counts. Both are written through the
 * CSSOM, which the Content-Security-Policy does not block; what it blocks is
 * a style attribute in markup, and neither of these is one.
 */
function paintScore(score) {
  const clamped = Math.max(0, Math.min(100, score));
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fill = view.querySelector('.scale__fill');
  if (fill) requestAnimationFrame(() => { fill.style.width = `${clamped}%`; });

  const number = view.querySelector('[data-count]');
  if (!number) return;
  if (still) { number.textContent = String(clamped); return; }

  // Counts in step with the needle sweep rather than on its own clock, so the
  // two land together instead of racing.
  const DURATION = 900;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / DURATION);
    const eased = 1 - Math.pow(1 - t, 3);
    number.textContent = String(Math.round(clamped * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  number.textContent = '0';
  requestAnimationFrame(tick);
}

function startAssessment() {
  if (!state.started) { state.started = true; track('assessment_start'); }
  goTo(state.stepIndex + 1);
}

/* ------------------------------------------------------------------ */
/* home                                                                */
/* ------------------------------------------------------------------ */

const answeredCount = () =>
  Object.keys(state.answers).filter((key) => !key.startsWith('__')).length;

/**
 * Home is the hub, not this assessment's first screen.
 *
 * Progress is saved on the way out, so coming back to this assessment offers
 * to resume from the exact question rather than starting again.
 */
function goHome() {
  const step = currentStep();
  if (step?.kind !== 'landing' && step?.kind !== 'result') state.resumeIndex = state.stepIndex;
  save();
  flushEvents({ final: true });
  // The hub lives at /assessments/ since the marketing site took the root.
  location.href = '/assessments/';
}


function startOver() {
  state = { answers: {}, stepIndex: 0, result: null, started: false, completed: false };
  clearSaved();
  render();
}

/**
 * The way out of every screen.
 *
 * Twenty questions is long enough that someone will want to look at something
 * else and come back, and without a way out the only one the browser offers is
 * closing the tab. Pressing it keeps every answer - the landing screen then
 * offers to resume from the exact question they left.
 */
function homeButton() {
  return h('button', {
    class: 'homebtn',
    type: 'button',
    'aria-label': 'All assessments',
    title: 'All assessments',
    onClick: goHome,
  }, h('span', { class: 'brandmark' }, 'Cloudboosta'));
}

function focusHeading() {
  const target = view.querySelector('[data-focus]');
  if (target) target.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ------------------------------------------------------------------ */
/* validation for the current step                                     */
/* ------------------------------------------------------------------ */

/** Runs the shared validator, then keeps only errors about this step's fields. */
function errorsFor(fieldIds) {
  const relevant = new Set(fieldIds);
  return validate(state.answers, bank).filter((error) => relevant.has(error.field));
}

function showErrors(errors) {
  const region = view.querySelector('[data-errors]');
  if (!region) return errors.length === 0;
  region.textContent = '';
  for (const error of errors) region.append(h('p', { text: error.message }));
  for (const field of view.querySelectorAll('[data-field]')) {
    const failed = errors.some((e) => e.field === field.dataset.field);
    field.toggleAttribute('aria-invalid', failed);
  }
  return errors.length === 0;
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

function render() {
  const step = currentStep();
  view.textContent = '';

  if (step.kind === 'landing') view.append(renderLanding());
  else if (step.kind === 'section') view.append(renderSection(step.section));
  else if (step.kind === 'question') view.append(renderQuestion(step.question));
  else if (step.kind === 'lead') view.append(renderLead());
  else if (step.kind === 'result') {
    view.append(renderResult());
    if (state.result) paintScore(state.result.score);
  }
}

/** Which chapter the screen belongs to. Used for the gutter, not for colour. */
function sectionNumberFor(step) {
  if (step?.kind === 'section') return step.section.n;
  if (step?.kind === 'question') return step.question.section;
  return 1;
}

/**
 * The centre line.
 *
 * Every screen except the chapter opening is a centred measure with two
 * hairlines running its full height, a mono label gutter inside the left one,
 * and the content between them. The gutter is never decorative - each screen
 * passes the two or three facts that matter where it is.
 */
function measure(gutterRows, ...content) {
  return h('div', { class: 'field-area' },
    h('div', { class: 'measure' },
      h('aside', { class: 'gutter' }, gutterRows),
      h('div', { class: 'body' }, content),
    ),
  );
}

/** One label/value pair in the gutter. `value` may be a node or a string. */
function gutterRow(label, value) {
  return h('div', null,
    label ? h('p', { class: 'gutter__lab', text: label }) : null,
    typeof value === 'string' ? h('p', { class: 'gutter__val', text: value }) : value,
  );
}

const gutterSpacer = () => h('span', { class: 'gutter__spacer' });

/* ------------------------------------------------------------------ */
/* the rail: six chapters, width proportional to questions            */
/* ------------------------------------------------------------------ */

/**
 * Progress is six chapters, not a percentage. Twenty-with-a-percentage is the
 * number that makes people leave; six visibly unequal segments is the same
 * honesty at a scale nobody flinches at.
 */
function renderRail() {
  const step = currentStep();
  const questionSteps = steps.filter((entry) => entry.kind === 'question');
  const answeredUpTo = step.kind === 'result' || step.kind === 'lead'
    ? questionSteps.length
    : Math.max(0, questionSteps.indexOf(step));

  const current = sectionNumberFor(step);
  const past = step.kind === 'lead' || step.kind === 'result';

  const rail = h('div', { class: 'rail', 'aria-hidden': 'true' });

  for (const section of bank.sections) {
    const inSection = questionSteps.filter((entry) => entry.question.section === section.n);
    const startIndex = questionSteps.indexOf(inSection[0]);
    const answeredHere = Math.max(0, Math.min(inSection.length, answeredUpTo - startIndex));

    let fill = 0;
    let mark = '';
    if (past || section.n < current) { fill = 100; mark = ' is-done'; }
    else if (section.n === current) {
      // A section screen has answered nothing yet, so the segment starts empty.
      fill = step.kind === 'section' ? 0 : Math.round((answeredHere / inSection.length) * 100);
      mark = ' is-now';
    }

    rail.append(h('span', {
      class: `rail__seg w${section.question_count} f-${fill}${mark}`,
    }, h('i')));
  }

  return rail;
}

/** The single hairline row under the rail. No percentage, no countdown. */
function renderChrome(step) {
  const left = h('div', { class: 'chrome__l' });
  const right = h('div', { class: 'chrome__r' });

  // Never on the landing screen itself - a way back to where you already are
  // is just noise.
  if (step.kind !== 'landing') left.append(homeButton());

  if (step.kind === 'question') {
    const section = bank.sections.find((entry) => entry.n === step.question.section);
    const questionSteps = steps.filter((entry) => entry.kind === 'question');
    left.append(
      h('span', { class: 'chrome__n', text: String(section.n).padStart(2, '0') }),
      h('span', { class: 'chrome__name', text: section.title }),
    );
    right.append(h('span', {
      text: `${String(questionSteps.indexOf(step) + 1).padStart(2, '0')} / ${questionSteps.length}`,
    }));
  } else if (step.kind === 'landing') {
    left.append(h('span', { class: 'brandmark' }, 'Cloudboosta'));
    right.append(h('span', { class: 'chrome__name',
      text: 'Cloud, done properly.',
    }));
  } else {
    right.append(h('span', { class: 'chrome__name',
      text: step.kind === 'result' ? 'Cloud Optimisation Readiness' : 'Cloud, done properly.',
    }));
  }

  right.append(themeToggle());

  return h('div', { class: 'chrome' }, left, right);
}

/* ------------------------------------------------------------------ */
/* screens                                                             */
/* ------------------------------------------------------------------ */

function renderLanding() {
  const copy = bank.copy.landing;

  const questionCount = bank.questions.length;
  const answered = answeredCount();
  const resumable = state.started && answered > 0;

  return h('div', null,
    renderRail(),
    renderChrome(currentStep()),
    measure(
      [
        resumable
          ? gutterRow('In progress', `${answered} of ${questionCount}\nanswered`)
          : gutterRow('Length', `${questionCount} questions\n4–6 minutes`),
        gutterRow('Needs', 'Nothing from\nyour cloud'),
        gutterSpacer(),
        gutterRow('Returns', 'Score\nFindings\n3 next steps'),
      ],
      h('p', { class: 'eyebrow', text: copy.eyebrow }),
      h('h1', { class: 'land__title', text: copy.title, tabindex: '-1', 'data-focus': true }),
      h('p', { class: 'land__body', text: copy.body }),
      h('ul', { class: 'land__meta' }, copy.meta.map((item) => h('li', { text: item }))),

      // The five bands, shown before a single question is asked. Seeing the
      // whole scale up front is what makes the score at the end mean anything.
      h('div', null,
        h('p', { class: 'side__label', text: 'The five bands' }),
        h('ul', { class: 'ladder' }, bank.scoring.bands.map((band) =>
          h('li', null,
            h('span', { class: 'ladder__range', text: `${band.min}–${band.max}` }),
            h('b', { text: band.label }),
          ))),
      ),

      // Coming home from question fifteen must not mean starting again. If
      // there is work to come back to, the primary action says so, and
      // starting over becomes the deliberate second choice.
      resumable
        ? h('div', { class: 'land__cta' },
            h('button', {
              class: 'btn btn--primary btn--lg', type: 'button',
              onClick: () => goTo(state.resumeIndex || 1),
            }, 'Resume the assessment', h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→')),
            h('button', {
              class: 'btn btn--quiet', type: 'button', onClick: startOver,
            }, 'Start again'),
            h('span', { class: 'kbd', text: `${answered} of ${bank.questions.length} answered` }),
          )
        : h('div', { class: 'land__cta' },
            h('button', {
              class: 'btn btn--primary btn--lg', type: 'button',
              onClick: startAssessment,
            }, copy.start, h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→')),
            h('span', { class: 'kbd' }, 'or press ', h('kbd', { text: 'Enter' })),
          ),
    ),
  );
}

/**
 * The chapter title page. It exists to answer "why am I being asked this?"
 * before the asking starts, and to hand the reader the colour they will carry
 * through the next few questions.
 */
function renderSection(section) {
  track('section_view', { section: section.n });

  const scored = section.points > 0;

  // Every chapter opening wears the same ground: a photograph under a scrim
  // that runs to page-black. Six identical screens turn the transition into a
  // rhythm - a reader learns once that the photograph means "new chapter",
  // and it holds for the rest of the run.
  return h('div', { class: 'chapter' },
    renderRail(),
    h('div', { class: 'chapter__top' },
      h('span', { class: 'chrome__l' },
        homeButton(),
        h('span', { text: `Chapter ${section.n} of ${bank.sections.length}` })),
      h('span', { class: 'chrome__r' }, themeToggle()),
    ),
    h('div', { class: 'chapter__area' },
      h('div', { class: 'chapter__measure' },
        h('div', { class: 'chapter__gutter' },
          h('p', { class: 'chapter__num', 'aria-hidden': 'true',
            text: String(section.n).padStart(2, '0') }),
          h('p', { class: 'chapter__focus', text: section.focus }),
        ),
        h('div', { class: 'chapter__body' },
          h('p', { class: 'chapter__kicker', text: section.kicker }),
          h('h1', { class: 'chapter__title', text: section.title, tabindex: '-1', 'data-focus': true }),
          h('p', { class: 'chapter__text', text: section.body }),
          h('ul', { class: 'chapter__facts' },
            h('li', { text: `${section.question_count} question${section.question_count === 1 ? '' : 's'}` }),
            h('li', { class: scored ? null : 'chip-ns', text: scored ? `${section.points} points` : 'Not scored' }),
          ),
          h('div', { class: 'chapter__foot' },
            h('button', {
              class: 'btn btn--onground btn--lg', type: 'button',
              onClick: () => goTo(state.stepIndex + 1),
            }, `Begin chapter ${section.n}`, h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→')),
            h('button', {
              class: 'btn btn--quiet', type: 'button',
              onClick: () => goTo(state.stepIndex - 1),
            }, 'Back'),
          ),
        ),
      ),
    ),
  );
}

/** A–Z, so the key chip beside each answer is also the key that picks it. */
const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function renderQuestion(question) {
  track('question_view', { question_id: question.id, section: question.section });

  const isMulti = question.type === 'multi';
  const selected = asArray(answerOf(question.id));
  const wide = question.options.length > 7;

  const options = question.options.map((option, index) => {
    const input = h('input', {
      class: 'opt__mark',
      type: isMulti ? 'checkbox' : 'radio',
      name: question.id,
      value: option.id,
      checked: selected.includes(option.id),
      onChange: (event) => {
        if (isMulti) toggleMulti(question, option.id, event.target.checked);
        else setAnswer(question.id, option.id);
        showErrors(errorsFor([question.id]));
        if (!isMulti) confirmAndAdvance(event.target.closest('.opt'), question.id);
      },
    });

    return h('label', { class: 'opt' },
      h('span', { class: 'opt__key', 'aria-hidden': 'true', text: KEYS[index] ?? '' }),
      h('span', { class: 'opt__label', text: option.label }),
      input,
    );
  });

  const lastKey = KEYS[question.options.length - 1] ?? 'A';

  const section = bank.sections.find((entry) => entry.n === question.section);
  const questionSteps = steps.filter((entry) => entry.kind === 'question');
  const inSection = questionSteps.filter((entry) => entry.question.section === section.n);
  const positionHere = inSection.findIndex((entry) => entry.question.id === question.id);
  const overall = questionSteps.findIndex((entry) => entry.question.id === question.id) + 1;

  // Position inside the chapter, as ticks rather than another number. Four of
  // them is a glance; "question 2 of 4" is a sentence.
  const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' },
    inSection.map((entry, index) => h('i', {
      class: index === positionHere ? 'on' : (index < positionHere ? 'was' : null),
    })));

  return h('div', null,
    renderRail(),
    renderChrome(currentStep()),
    measure(
      [
        h('div', null,
          h('p', { class: 'gutter__n', text: String(section.n).padStart(2, '0') }),
          h('p', { class: 'gutter__val', text: section.title }),
        ),
        gutterSpacer(),
        h('div', null,
          h('p', { class: 'gutter__lab', text: 'In chapter' }),
          ticks,
          h('p', { class: 'gutter__val', text: `${positionHere + 1} of ${inSection.length}` }),
        ),
        gutterRow(section.points > 0 ? 'Overall' : 'Scoring',
          section.points > 0 ? `${overall} / ${questionSteps.length}` : 'Context only'),
      ],
      h('h1', {
        class: wide ? 'q q--wide' : 'q',
        text: question.text,
        tabindex: '-1',
        'data-focus': true,
      }),
      question.help ? h('p', { class: 'help', text: question.help }) : null,
      isMulti && question.max_selections
        ? h('p', { class: 'help', text: `Choose up to ${question.max_selections}.` })
        : null,
      h('div', { class: 'error', role: 'alert', 'data-errors': true }),
      h('fieldset', { class: wide ? 'opts opts--two' : 'opts', 'data-field': question.id },
        h('legend', { class: 'sr-only', text: question.text }),
        options,
      ),

      // The foot sits inside the measure, so the hairlines bound it too. A
      // full-width bar under a bounded column is the exact thing this design
      // exists to stop.
      h('div', { class: 'footbar' },
        h('span', { class: 'kbd' },
          h('kbd', { text: 'A' }), '–', h('kbd', { text: lastKey }), ' to answer · ',
          h('kbd', { text: '↵' }), isMulti ? ' to continue · ' : ' to skip ahead · ',
          h('kbd', { text: '⌫' }), ' to go back'),
        h('div', { class: 'footbar__actions' },
          isMulti
            ? h('button', {
                class: 'btn btn--accent', type: 'button',
                onClick: () => advance([question.id]),
              }, 'Continue', h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→'))
            : null,
          h('button', {
            class: 'btn btn--quiet', type: 'button',
            onClick: () => goTo(state.stepIndex - 1),
          }, 'Back'),
        ),
      ),
    ),
  );
}

/**
 * The 180ms between answering and the next question.
 *
 * Designed rather than tolerated: the row tints and a line sweeps its width,
 * so the advance reads as a consequence of the answer instead of the page
 * jumping. Anyone who has asked for reduced motion just moves.
 */
function confirmAndAdvance(row, fieldId) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (row && !still) row.classList.add('opt--advancing');
  window.setTimeout(() => advance([fieldId]), still ? 0 : 320);
}

function renderLead() {
  // Without this the contact step - the likeliest place to lose someone -
  // produced no event at all, so drop-off there was invisible.
  track('lead_view');

  const fields = bank.lead_fields;
  const field = (id) => fields.find((f) => f.id === id);
  const consent = field('L06');

  // The banks offer one channel, email, so the contact step asks for an
  // address and nothing else. The picker survives only for a bank that ever
  // declares a second channel; with one, the choice is stated, not asked.
  const channels = field('L02').channels;
  const single = channels.length === 1;
  const channelId = single ? channels[0].id : (state.answers.__channel || channels[0].id);
  if (single) state.answers.__channel = channelId;

  const contactInput = h('input', {
    class: 'input',
    type: channelId === 'email' ? 'email' : 'tel',
    id: 'L02', name: 'L02',
    inputmode: channelId === 'email' ? 'email' : 'tel',
    autocomplete: channelId === 'email' ? 'email' : 'tel',
    placeholder: channelId === 'email' ? 'you@company.com' : '+234…',
    value: answerOf('L02') || '',
    onInput: (e) => setAnswer('L02', e.target.value.trim()),
  });

  const questionCount = bank.questions.length;

  return h('div', null,
    renderRail(),
    renderChrome(currentStep()),
    measure(
      [
        gutterRow('Status', `Complete\n${questionCount} of ${questionCount}`),
        gutterRow('Next', 'Score on screen\nReport by email'),
        gutterSpacer(),
        gutterRow('Never asked', 'Cloud\ncredentials'),
      ],
      h('h1', { class: 'q q--sm', text: 'Almost done', tabindex: '-1', 'data-focus': true }),
      h('p', { class: 'help', text: 'We use these to send your result and prepare your strategy session.' }),
      h('div', { class: 'error', role: 'alert', 'data-errors': true }),

      h('div', { class: 'form' },
        textField(field('L01'), { autocomplete: 'name' }),
        textField(field('L05'), { autocomplete: 'organization' }),

        h('div', { class: 'field', 'data-field': 'L02' },
          h('label', { class: 'lbl', for: 'L02', text: field('L02').text }),
          single ? null : h('div', { class: 'segmented' }, channels.map((channel) =>
            h('label', { class: 'seg' },
              h('input', {
                type: 'radio', name: '__channel', value: channel.id,
                checked: channel.id === channelId,
                onChange: () => { state.answers.__channel = channel.id; save(); render(); },
              }),
              h('span', { text: channel.label }),
            ))),
          contactInput,
        ),

        selectField(field('L03')),
        multiField(field('L04')),
        selectField(field('L07'), { optional: true }),

        h('div', { class: 'consent' },
          h('p', { class: 'consent__note', text: bank.copy.consent_note }),
          h('label', { class: 'consent__box' },
            h('input', {
              type: 'checkbox', name: 'L06',
              checked: answerOf('L06') === true,
              onChange: (e) => setAnswer('L06', e.target.checked),
            }),
            h('span', { text: consent.text }),
          ),
        ),

        // The honeypot. Off-canvas, not hidden, so a bot that skips hidden
        // inputs still fills it; the endpoint treats a non-empty value as a
        // bot. It is never part of the answers, so it is never saved.
        h('p', { class: 'hp' },
          h('label', null, 'Leave this empty ',
            h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' }))),

        h('p', { class: 'privacy' },
          'We never ask for cloud credentials. ',
          // Absolute: the assessments live at /cost/, /devops-as-a-service/
          // and so on, and a relative link 404s from every one of them.
          h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' },
            'How we handle your data'),
          '.'),
      ),

      h('div', { class: 'footbar' },
        h('span', { class: 'kbd' }, 'Nothing here is shared outside Cloudboosta.'),
        h('div', { class: 'footbar__actions' },
          h('button', { class: 'btn btn--primary', type: 'button', onClick: submit },
            'See my result', h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→')),
          h('button', {
            class: 'btn btn--quiet', type: 'button',
            onClick: () => goTo(state.stepIndex - 1),
          }, 'Back'),
        ),
      ),
    ),
  );
}

function textField(field, extra = {}) {
  return h('div', { class: 'field', 'data-field': field.id },
    h('label', { class: 'lbl', for: field.id, text: field.text }),
    h('input', {
      class: 'input',
      type: 'text', id: field.id, name: field.id,
      maxlength: field.max_length, value: answerOf(field.id) || '',
      ...extra,
      onInput: (e) => setAnswer(field.id, e.target.value.trim()),
    }),
  );
}

function selectField(field, { optional = false } = {}) {
  const select = h('select', {
    class: 'select',
    id: field.id, name: field.id,
    onChange: (e) => setAnswer(field.id, e.target.value),
  }, h('option', { value: '', text: optional ? 'Prefer not to say' : 'Choose one' }));

  for (const option of field.options || []) {
    select.append(h('option', {
      value: option.id, text: option.label,
      selected: asArray(answerOf(field.id)).includes(option.id),
    }));
  }
  // L07 has no option list in the bank - countries come from the runtime.
  if (!field.options) {
    for (const [code, label] of COUNTRIES) {
      select.append(h('option', { value: code, text: label, selected: answerOf(field.id) === code }));
    }
  }
  return h('div', { class: 'field', 'data-field': field.id },
    h('label', { class: 'lbl', for: field.id, text: field.text }),
    h('div', { class: 'opt-tag' }, optional ? h('span', { text: 'Optional' }) : null),
    select);
}

/** Multi-select as chips: eight options should not become eight full rows. */
function multiField(field) {
  const selected = asArray(answerOf(field.id));
  return h('div', { class: 'field', 'data-field': field.id },
    h('label', { class: 'lbl', text: field.text }),
    field.help ? h('p', { class: 'help', text: field.help }) : null,
    h('div', { class: 'chips' }, field.options.map((option) =>
      h('label', { class: 'chip' },
        h('input', {
          type: 'checkbox', name: field.id, value: option.id,
          checked: selected.includes(option.id),
          onChange: (e) => {
            toggleMulti(field, option.id, e.target.checked);
            showErrors(errorsFor([field.id]));
          },
        }),
        h('span', { text: option.label }),
      ))),
  );
}

const COUNTRIES = [
  ['NG', 'Nigeria'], ['GH', 'Ghana'], ['KE', 'Kenya'], ['ZA', 'South Africa'],
  ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'],
  ['AE', 'United Arab Emirates'], ['IN', 'India'], ['OTHER', 'Somewhere else'],
];

/* ------------------------------------------------------------------ */
/* navigation and submission                                           */
/* ------------------------------------------------------------------ */

function advance(fieldIds) {
  if (!showErrors(errorsFor(fieldIds))) {
    view.querySelector('[data-errors]')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  goTo(state.stepIndex + 1);
}

async function submit(event) {
  const button = event.currentTarget;
  const leadIds = bank.lead_fields.map((f) => f.id);
  if (!showErrors(errorsFor(leadIds))) return;

  // Catch anything skipped earlier - a stale saved session, or a browser that
  // restored a partial form.
  const outstanding = validate(state.answers, bank);
  if (outstanding.length > 0) {
    const first = steps.findIndex((s) => s.kind === 'question' && s.question.id === outstanding[0].field);
    if (first >= 0) { goTo(first); showErrors(outstanding.filter((e) => e.field === outstanding[0].field)); return; }
  }

  button.disabled = true;
  button.textContent = 'Calculating…';

  try {
    state.result = await score();
    state.completed = true;
    track('assessment_complete', { score: state.result.score, primary: state.result.primary_finding });
    clearSaved();
    goTo(steps.length - 1);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'See my result';
    showErrors([{ field: 'L01', message: 'We could not calculate your result just now. Please try again.' }]);
    // Nothing identifying stays in storage after a failed submit. The answers
    // are still in memory, so retrying costs nothing.
    clearSaved();
    console.error(error);
  }
}

async function score() {
  const payload = {
    service: SERVICE,
    answers: Object.fromEntries(Object.entries(state.answers).filter(([k]) => !k.startsWith('__'))),
    contact_channel: state.answers.__channel || 'email',
    // The honeypot, read from the DOM rather than the answers so it can never
    // be saved or restored. Empty for a person; the server drops anything else.
    website: view.querySelector('[name="website"]')?.value ?? '',
  };

  if (DEV_LOCAL) {
    // Development preview only. Production always scores server-side so the
    // result cannot be manufactured by editing the request.
    const { buildPayload } = await import('/vendor/scoring.js');
    return buildPayload(payload.answers, bank, {
      completed_at: new Date().toISOString(),
      contact_channel: payload.contact_channel,
    });
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Scoring failed: ${response.status}`);
  return response.json();
}

/* ------------------------------------------------------------------ */
/* result                                                              */
/* ------------------------------------------------------------------ */

/**
 * The portfolio strategy direction. Renders nothing for a bank that declares
 * no directions, which is how one result screen serves an assessment that
 * recommends one and two that do not.
 */
function renderDirection(result) {
  const spec = bank.strategy_directions;
  const copy = bank.copy.directions ?? {};
  const chosen = result.migration_direction;
  if (!spec || !chosen || !copy[chosen]) return null;

  const held = chosen === spec.hold?.id;

  return h('div', { class: 'block' },
    h('p', { class: 'block__label', text: bank.copy.result.direction_heading }),
    h('ul', { class: 'seven' }, (spec.options ?? []).map((option) =>
      h('li', { class: option.id === chosen ? 'on' : null },
        h('b', { text: copy[option.id]?.title ?? option.label }),
        h('span', { text: copy[option.id]?.short ?? '' }),
      ))),
    h('h2', { class: 'block__title', text: copy[chosen].title }),
    h('p', { class: 'block__text', text: copy[chosen].body }),
    // The qualification is the point, not a footnote: a direction chosen from
    // 26 questions is a starting position for the session, and saying so is
    // what keeps it honest.
    held ? null : h('p', { class: 'hint', text: bank.copy.result.direction_note }),
  );
}

function renderResult() {
  const result = state.result;
  if (!result) return h('div', { class: 'body' }, h('p', { text: 'No result yet.' }));

  const copy = bank.copy.result;
  const finding = (id) => bank.copy.findings[id];
  const primary = finding(result.primary_finding);
  track('result_view', { score: result.score, primary: result.primary_finding });

  const secondaries = result.secondary_findings.map(finding).filter(Boolean);
  const bands = bank.scoring.bands;
  const landed = bands.findIndex((band) => band.label === result.score_band);

  // The full breakdown - the three actions, the secondary bodies, the
  // managed-optimisation note - travels by email. This screen keeps the score,
  // the headline finding, and the one thing we want them to do next.
  const contact = state.answers.L02 || '';
  const [before, after] = String(copy.email_body_email).split('{contact}');
  const failed = result.notified?.result_email === false;
  // The server does not re-send a report to the same address for the same
  // assessment within a day (a retry storm or a replay would otherwise mail
  // the prospect N times). Say so, rather than "not sent".
  const duplicate = result.duplicate === true;
  // The booking link comes from the server. Trusted, but only an https URL is
  // ever placed in an href; anything else falls back to the contact page.
  const bookingHref = /^https:\/\//.test(result.booking_url ?? '') ? result.booking_url : '/book-a-call/';

  return h('div', null,
    renderRail(),
    renderChrome(currentStep()),

    measure(
      [
        gutterRow('Weakest', primary.title),
        secondaries.length ? gutterRow('Also', secondaries.map((e) => e.title).join('\n')) : null,
        gutterSpacer(),
        gutterRow('Report', duplicate ? 'Already sent\ntoday' : failed ? 'Not sent\nRetrying' : `Sent to\n${contact}`),
      ],

      // The roadmap, carried over from direction A, "The Calibration Bench".
      // The number is stated plainly - an 18 and a 92 are typeset identically,
      // because the instrument does not editorialise. The judgement lives in
      // the strip below, where only the band you landed in lights, and all
      // five stay visible so the distance to "Optimised" is legible rather
      // than implied. That distance is the product.
      h('div', { class: 'res__score' },
        h('p', { class: 'side__label', text: 'Your readiness score' }),
        h('h1', { class: 'score__num', tabindex: '-1', 'data-focus': true },
          h('span', { 'data-count': true, text: String(result.score) }),
          h('span', { class: 'score__den', text: '/ 100' })),
        h('p', { class: 'score__band', text: result.score_band }),
        h('p', { class: 'score__interp', text: result.score_interpretation }),
        // A band the engine held back, and the reason. Saying "Early-stage"
        // above a 78 without explaining it reads as a bug rather than a limit.
        result.band_cap
          ? h('p', { class: 'score__cap' },
              h('b', { text: `Capped from ${result.band_cap.from}. ` }), result.band_cap.note)
          : null,
      ),

      h('div', { class: 'scale' },
        h('div', { class: 'scale__track' },
          h('div', { class: 'scale__ticks', 'aria-hidden': 'true' }),
          h('div', { class: 'scale__fill' }),
          h('div', { class: `scale__needle m${result.score}` },
            h('span', { class: 'scale__flag', text: String(result.score) })),
        ),
        h('ol', { class: 'scale__bands' }, bands.map((band, index) =>
          h('li', { class: `b${band.max - band.min + 1}${index === landed ? ' on' : ''}` },
            h('span', { text: `${band.min}–${band.max}` }),
            band.label,
          ))),
      ),

      h('div', { class: 'res__main' },
        h('p', { class: 'res__intro', text: copy.intro }),

        h('div', { class: 'block' },
          h('p', { class: 'block__label', text: copy.primary_heading }),
          h('h2', { class: 'block__title', text: primary.title }),
          h('p', { class: 'block__text', text: primary.body }),
        ),

        secondaries.length
          ? h('div', { class: 'block' },
              h('p', { class: 'block__label', text: copy.secondary_heading }),
              h('ul', { class: 'pills' }, secondaries.map((entry) => h('li', { text: entry.title }))),
            )
          : null,

        // The portfolio direction, for the assessments that recommend one.
        // All seven treatments stay visible with one marked, for the same
        // reason all five bands stay visible above it: the ones you did not
        // get are the information. Nothing lights when the answer is
        // "discovery first", because at that point none of them is a choice.
        renderDirection(result),

        // The endpoint reports whether the send actually succeeded. Telling
        // someone to check an inbox nothing was sent to wastes their time.
        failed
          ? h('div', { class: 'panel panel--warn' },
              h('div', null,
                h('h4', { text: copy.email_failed_heading }),
                h('p', { text: copy.email_failed_body }),
              ))
          : h('div', { class: 'panel panel--ok' },
              h('div', null,
                h('h4', { text: copy.email_heading }),
                h('p', null, before, h('b', { text: contact }), after),
                h('p', { class: 'hint', text: copy.email_hint }),
              )),

        h('a', {
          class: 'cta',
          href: bookingHref,
          onClick: () => track('cta_click', { score: result.score, primary: result.primary_finding }),
        }, copy.cta, h('span', { class: 'btn__arrow', 'aria-hidden': 'true' }, '→')),
        h('p', { class: 'cta__support', text: copy.cta_support }),

        h('p', { class: 'disclaimer', text: copy.disclaimer }),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* keyboard                                                            */
/* ------------------------------------------------------------------ */

/**
 * The key chip beside each answer is also the key that picks it. Native
 * radio and checkbox behaviour is left completely intact underneath - arrow
 * keys, space and tab all still work; this is an addition, not a replacement.
 */
function onKeydown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
  const step = currentStep();
  if (!step) return;

  if (event.key === 'Enter' && !typing) {
    const primary = view.querySelector('.btn--primary, .btn--accent, .btn--onground');
    if (primary) { event.preventDefault(); primary.click(); }
    return;
  }

  if (event.key === 'Backspace' && !typing && state.stepIndex > 0) {
    event.preventDefault();
    goTo(state.stepIndex - 1);
    return;
  }

  if (typing || step.kind !== 'question') return;

  const index = KEYS.indexOf(event.key.toUpperCase());
  if (index === -1) return;

  const inputs = view.querySelectorAll('.opts .opt__mark');
  const target = inputs[index];
  if (!target) return;

  event.preventDefault();
  if (target.type === 'checkbox') target.checked = !target.checked;
  else target.checked = true;
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

/**
 * Records the abandon at most once, then flushes.
 *
 * This used to hang off beforeunload alone, which mobile browsers frequently
 * never fire - so abandons were under-reported by exactly the population most
 * likely to abandon a twenty-question form.
 */
let abandonRecorded = false;

function leaving() {
  if (state.started && !state.completed && !abandonRecorded) {
    abandonRecorded = true;
    track('assessment_abandon', { step: state.stepIndex, answered: Object.keys(state.answers).length });
  }
  flushEvents({ final: true });
}

document.addEventListener('keydown', onKeydown);

window.addEventListener('beforeunload', leaving);
window.addEventListener('pagehide', leaving);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') leaving();
});

(async function boot() {
  // Stamped before anything renders. There is no flash of the wrong theme to
  // avoid here - the whole UI is built by this script, so nothing has been
  // painted yet - but the attribute has to exist before the first render so
  // the toggle reports the right state.
  applyTheme(activeTheme());

  try {
    bank = await (await fetch(`/vendor/${SERVICE}.json`)).json();
  } catch {
    view.append(h('div', { class: 'notice' },
      h('p', { text: 'The assessment could not load. Please refresh, or contact us and we will send it to you.' })));
    return;
  }

  steps = buildSteps();
  restore();
  track('landing_view');
  // A restored session must never land on the result step - the result lives
  // on the server and was not saved.
  if (currentStep()?.kind === 'result') state.stepIndex = steps.length - 2;
  render();
})();
