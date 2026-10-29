// Documents: the cheat sheet, static HTML in web/docs/, fetched on demand.
// This module adds the behaviour — self-test, «изучено» marks, grades, the
// topic test and section scrolling. Nothing here touches study progress.

import { el, clear, plural } from './util.js';
import * as store from './store.js';
import * as ui from './ui.js';
import * as topics from './topics.js';
import { newSession, startSession } from './exam.js';
import { lastAnswerRight } from './practice.js';
import { mountWidgets } from './cheatsheet-widgets.js';
import { mountCharts } from './cheatsheet-charts.js';
import { setLang } from './i18n.js';

const DOCS = [
  {
    id: 'cheatsheet',
    tab: 'Шпаргалка',
    title: 'Шпаргалка по ключевым темам',
    lede: 'Ключевые темы Subject A: процессор и память, планирование ОС, записи и обходы, сеть, безопасность, стратегия. '
      + 'Экзамен на английском, поэтому каждое понятие дано с английским термином, а у определений — '
      + 'слова, по которым верный вариант узнаётся в тексте вопроса.',
  },
];

const cache = new Map();

function load(id) {
  if (!cache.has(id)) {
    const request = fetch(`docs/${id}.html`).then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    });
    request.catch(() => cache.delete(id));
    cache.set(id, request);
  }
  return cache.get(id);
}

export function docsScreen(root, navigate, docId, params) {
  const doc = DOCS.find((d) => d.id === docId) || DOCS[0];
  const body = el('div', { class: 'doc' }, el('div', { class: 'boot' }, 'Загрузка…'));

  clear(root).append(el('div', {},
    el('div', { class: 'hero' },
      el('div', {},
        el('span', { class: 'eyebrow' }, 'Subject A'),
        el('h1', {}, doc.title),
        el('p', {}, doc.lede))),
    // One document today; the tabs come back with a second one.
    DOCS.length > 1
      ? el('div', { class: 'tabs' },
          ...DOCS.map((d) => el('button', {
            class: d.id === doc.id ? 'is-on' : '',
            onclick: () => navigate(`#/docs/${d.id}`),
          }, d.tab)))
      : null,
    body));

  // The sheet's side menu needs the room of a wide screen.
  root.classList.toggle('screen--wide', doc.id === 'cheatsheet');

  // The cheat sheet comes in Russian or in the English of the exam:
  // docs/cheatsheet.en.html, the same blocks under the same ids.
  const lang = doc.id === 'cheatsheet' ? (params.get('lang') || store.getDocsState().lang || 'ru') : 'ru';
  setLang(lang);
  const file = lang === 'en' ? `${doc.id}.en` : doc.id;

  let alive = true;
  Promise.all([load(file), doc.id === 'cheatsheet' ? topics.load() : null]).then(([html]) => {
    if (!alive) return;
    body.innerHTML = html;
    setupCheatsheet(body, params.get('s'), navigate);
    // ?print — the page as it prints (whole walks in the widgets), for a
    // headless browser that saves it as PDF without opening a print dialog.
    if (params.has('print')) window.dispatchEvent(new Event('beforeprint'));
  }).catch((err) => {
    if (!alive) return;
    clear(body).append(el('div', { class: 'emptystate' },
      el('p', {}, 'Не удалось загрузить документ.'),
      el('p', { class: 'mono muted', style: 'font-size:.75rem' }, String(err))));
  });

  return () => {
    alive = false;
    // Widgets elsewhere (the question modal in «Слова») speak Russian.
    setLang('ru');
  };
}

/* ── Cheat sheet ──────────────────────────────────────────────────────── */

function setupCheatsheet(root, section, navigate) {
  mountWidgets(root);
  mountCharts(root);
  const quizButton = root.querySelector('[data-quiz]');
  const examplesButton = root.querySelector('[data-examples]');
  const answers = [...root.querySelectorAll('.ans')];
  const sections = [...root.querySelectorAll('section[id]')];

  const setQuiz = (on) => {
    root.classList.toggle('is-quiz', on);
    quizButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    quizButton.textContent = on ? 'Показать всё' : 'Самопроверка';
    for (const node of answers) {
      node.classList.remove('is-shown');
      if (on) {
        node.setAttribute('tabindex', '0');
        node.setAttribute('title', 'Нажми, чтобы показать');
      } else {
        node.removeAttribute('tabindex');
        node.removeAttribute('title');
      }
    }
  };

  // Worked examples fold down to their question marks: «Как спрашивают 2025S·Q8»
  // and the button that opens the question stay, the retelling and solution go.
  const setExamples = (shown) => {
    root.classList.toggle('no-examples', !shown);
    examplesButton.setAttribute('aria-pressed', shown ? 'false' : 'true');
    examplesButton.textContent = shown ? 'Скрыть разборы' : 'Показать разборы';
  };

  // «Изучено»: one mark per section. The button sits at the end of the section,
  // where you finish reading it; the heading and the nav chip only show the mark.
  const summary = el('span', { class: 'studied-summary' });
  root.querySelector('.legend')?.append(summary);
  const marks = new Map();
  for (const sec of sections) {
    const button = el('button', {
      type: 'button',
      class: 'btn btn--sm studied-btn',
      onclick: () => {
        const studied = { ...(store.getDocsState().studied || {}) };
        if (studied[sec.id]) delete studied[sec.id];
        else studied[sec.id] = Date.now();
        store.saveDocsState({ studied });
        refreshStudied();
      },
    });
    const note = el('span', { class: 'studied-note' });
    const badge = el('span', { class: 'tag tag--ok studied-badge', hidden: true });
    sec.querySelector('.sec-head h2')?.after(badge);
    sec.append(el('div', { class: 'studied-row' }, note, button));
    marks.set(sec.id, { button, note, badge });
  }

  const side = sideMenu(root, sections);

  const refreshStudied = () => {
    const studied = store.getDocsState().studied || {};
    for (const [id, { button, note, badge }] of marks) {
      const at = studied[id];
      const day = at ? new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
      button.textContent = at ? 'Снять отметку' : 'Отметить изученным';
      button.classList.toggle('btn--ghost', Boolean(at));
      note.textContent = at
        ? `✓ Раздел изучен · ${day}`
        : 'Дочитал раздел? Отметь его.';
      note.classList.toggle('is-studied', Boolean(at));
      badge.hidden = !at;
      badge.textContent = `✓ Изучено · ${day}`;
      for (const node of root.querySelectorAll(`[data-scroll="${id}"]`)) node.classList.toggle('is-studied', Boolean(at));
    }
    const count = sections.filter((s) => studied[s.id]).length;
    summary.textContent = `Изучено разделов: ${count} из ${sections.length}`;
  };
  refreshStudied();

  // How well each block and section is known, from the answers so far.
  const grades = gradeMarks(root, sections, side);
  grades.refresh();
  const refresh = () => {
    if (root.isConnected) return grades.refresh();
    window.removeEventListener('focus', refresh);
    window.removeEventListener('itpec:progress', refresh);
  };
  window.addEventListener('focus', refresh);
  window.addEventListener('itpec:progress', refresh);

  root.querySelector('[data-print]')?.addEventListener('click', () => window.print());

  quizButton.addEventListener('click', () => {
    const on = !root.classList.contains('is-quiz');
    setQuiz(on);
    store.saveDocsState({ quiz: on });
  });

  // RU ⇄ EN: the other file, opened where you are reading now.
  root.querySelector('[data-lang]')?.addEventListener('click', (e) => {
    const next = e.currentTarget.dataset.lang;
    store.saveDocsState({ lang: next });
    const here = readingAt(root);
    navigate(`#/docs/cheatsheet${here ? `?s=${here}` : ''}`, true);
  });

  examplesButton.addEventListener('click', () => {
    const shown = root.classList.contains('no-examples');
    setExamples(shown);
    store.saveDocsState({ examples: shown });
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-build-test]')) {
      testBuilder(sections, navigate);
      return;
    }
    const target = e.target.closest('[data-scroll]');
    if (target) {
      scrollToSection(root, target.dataset.scroll, true);
      // Remember the section in the address without re-rendering the screen.
      history.replaceState(null, '', `#/docs/cheatsheet?s=${target.dataset.scroll}`);
      return;
    }
    const answer = e.target.closest('.ans');
    if (answer && root.classList.contains('is-quiz')) answer.classList.toggle('is-shown');
  });

  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ans')
      && root.classList.contains('is-quiz')) {
      e.preventDefault();
      e.target.classList.toggle('is-shown');
    }
  });

  if (store.getDocsState().quiz) setQuiz(true);
  setExamples(store.getDocsState().examples !== false);
  if (section) requestAnimationFrame(() => scrollToSection(root, section, false));
}

/** The block (or else the section) at the top of the window right now. */
function readingAt(root) {
  const line = (root.querySelector('.cs-toc')?.getBoundingClientRect().bottom || 0) + 24;
  let at = null;
  for (const node of root.querySelectorAll('section[id], article.blk[id]')) {
    if (node.getBoundingClientRect().top <= line) at = node;
  }
  return at?.id || null;
}

/** A section (`cpu`) or a block in it (`cpu-raid`). */
function scrollToSection(root, id, smooth) {
  const target = root.querySelector(`#${CSS.escape(id)}`);
  if (!target) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'start' });
}

const blockTitle = (blk) => blk.querySelector('.bh h3')?.textContent.trim() || blk.id;
const sectionTitle = (sec) => sec.querySelector('.sec-head h2')?.firstChild.textContent.trim() || sec.id;

/* ── Cheat sheet: side menu ───────────────────────────────────────────── */

// On a wide screen every section and its blocks sit in a column on the left,
// pinned under the toolbar. The section on screen opens its blocks; the block
// at the top of the window is marked, and so are the others still in view.
function sideMenu(root, sections) {
  const items = new Map();
  const groups = new Map();
  const list = el('ol', { class: 'side-list' });
  for (const sec of sections) {
    const blocks = [...sec.querySelectorAll('article.blk[id]')];
    const head = el('button', { type: 'button', class: 'side-sec', 'data-scroll': sec.id },
      el('span', { class: 'side-sec__title' }, sectionTitle(sec)),
      el('span', { class: 'side-grade', 'data-grade': sec.id }));
    const sub = el('ol', { class: 'side-blocks' }, ...blocks.map((blk) => {
      const item = el('button', { type: 'button', class: 'side-blk', 'data-scroll': blk.id },
        el('i', { class: 'side-dot', 'data-grade-dot': blk.id }),
        el('span', {}, blockTitle(blk)));
      items.set(blk.id, item);
      return el('li', {}, item);
    }));
    const group = el('li', { class: 'side-group' }, head, sub);
    groups.set(sec.id, group);
    list.append(group);
  }

  const side = el('aside', { class: 'cs-side', 'aria-label': 'Разделы шпаргалки' },
    el('div', { class: 'side-head' },
      el('span', { class: 'eyebrow' }, 'Разделы'),
      el('button', { type: 'button', class: 'btn btn--sm', 'data-build-test': '' }, 'Свой тест')),
    list,
    el('p', { class: 'side-legend' },
      el('span', {}, el('i', { class: 'side-dot lvl-know' }), 'знаю'),
      el('span', {}, el('i', { class: 'side-dot lvl-partly' }), 'примерно'),
      el('span', {}, el('i', { class: 'side-dot lvl-weak' }), 'не понимаю'),
      el('span', {}, el('i', { class: 'side-dot' }), 'нет данных')));

  const main = el('div', { class: 'cs-main' });
  const toc = root.querySelector('.cs-toc');
  toc.after(el('div', { class: 'cs-layout' }, side, main));
  main.append(...sections);

  // Where am I: the toolbar names the section and block on a wide screen,
  // and the section chip lights up on a narrow one.
  const here = toc.querySelector('.toc-here');
  const chips = new Map([...toc.querySelectorAll('.toc-links [data-scroll]')].map((b) => [b.dataset.scroll, b]));
  const blocks = sections.flatMap((sec) => [...sec.querySelectorAll('article.blk[id]')]);
  let shown = { sec: null, blk: null };

  const spy = () => {
    if (!root.isConnected) {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      return;
    }
    const line = Math.max(toc.getBoundingClientRect().bottom, 0) + 24;
    let sec = null;
    for (const s of sections) if (s.getBoundingClientRect().top <= line) sec = s;
    sec ||= sections[0];
    let blk = null;
    let blkTop = -Infinity;
    for (const b of blocks) {
      const r = b.getBoundingClientRect();
      items.get(b.id).classList.toggle('is-visible', r.bottom > line && r.top < window.innerHeight);
      // Blocks side by side share a top: the first (left) one wins.
      if (b.closest('section') === sec && r.top <= line && r.top > blkTop + 1) { blk = b; blkTop = r.top; }
    }
    if (shown.sec === sec && shown.blk === blk) return;
    shown = { sec, blk };
    for (const [id, group] of groups) group.classList.toggle('is-current', id === sec.id);
    for (const [id, chip] of chips) chip.classList.toggle('is-current', id === sec.id);
    for (const [id, item] of items) item.classList.toggle('is-current', blk?.id === id);
    if (here) here.textContent = blk ? `${sectionTitle(sec)} › ${blockTitle(blk)}` : sectionTitle(sec);
    const active = (blk && items.get(blk.id)) || groups.get(sec.id).firstChild;
    keepInView(side, active);
  };

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; spy(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  requestAnimationFrame(spy);
  return side;
}

/** Scrolls the menu itself (never the page) so the marked item is in it. */
function keepInView(box, item) {
  if (box.scrollHeight <= box.clientHeight) return;
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < box.scrollTop + 48) box.scrollTop = Math.max(0, top - 48);
  else if (bottom > box.scrollTop + box.clientHeight - 24) box.scrollTop = bottom - box.clientHeight + 48;
}

/* ── Cheat sheet: how well each topic is known ────────────────────────── */

function gradeChip(g, { short = false } = {}) {
  const lvl = topics.LEVELS[g.level];
  const text = g.level === 'none'
    ? (g.answered ? `${lvl.short} · ${g.answered} из ${g.total}` : lvl.short)
    : `${short ? lvl.short : lvl.label} · ${g.pct}%`;
  return el('span', { class: `grade-chip lvl-${g.level}`, title: topics.gradeTitle(g) }, text);
}

function gradeMarks(root, sections, side) {
  const heads = new Map();
  for (const sec of sections) {
    const slot = el('span', { class: 'grade-slot' });
    sec.querySelector('.sec-head h2')?.after(slot);
    heads.set(sec.id, slot);
  }
  const bhs = new Map();
  for (const blk of root.querySelectorAll('article.blk[id]')) {
    const slot = el('span', { class: 'grade-slot grade-slot--blk' });
    blk.querySelector('.bh')?.append(slot);
    bhs.set(blk.id, slot);
  }

  const refresh = () => {
    const stats = store.getStats();
    for (const sec of sections) {
      const ids = [...sec.querySelectorAll('article.blk[id]')].map((b) => b.id);
      const g = topics.grade(topics.questionsFor(ids), stats);
      clear(heads.get(sec.id)).append(gradeChip(g));
      const sideSlot = side.querySelector(`[data-grade="${sec.id}"]`);
      sideSlot.className = `side-grade lvl-${g.level}`;
      sideSlot.textContent = g.level === 'none' ? '' : `${g.pct}%`;
      sideSlot.title = `${topics.LEVELS[g.level].label}. ${topics.gradeTitle(g)}`;
    }
    for (const [id, slot] of bhs) {
      const g = topics.blockGrade(id, stats);
      // A block with nothing answered keeps its heading clean; the menu still shows the grey dot.
      clear(slot).append(g.answered ? gradeChip(g, { short: true }) : '');
      const dot = side.querySelector(`[data-grade-dot="${id}"]`);
      dot.className = `side-dot lvl-${g.level}`;
      dot.title = `${topics.LEVELS[g.level].label}. ${topics.gradeTitle(g)}`;
    }
  };
  return { refresh };
}

/* ── Cheat sheet: a test from the picked blocks ───────────────────────── */

const TEST_COUNTS = [20, 30, 60, 0];
// The exam's own pace: 90 minutes for 60 questions.
const MINUTES_PER_QUESTION = 1.5;

function testBuilder(sections, navigate) {
  const saved = store.getDocsState().test || {};
  const pick = new Set(saved.blocks || []);
  const opts = { only: saved.only || 'all', count: saved.count ?? 30 };
  const stats = store.getStats();
  const tree = sections.map((sec) => ({
    id: sec.id,
    title: sectionTitle(sec),
    blocks: [...sec.querySelectorAll('article.blk[id]')].map((blk) => ({
      id: blk.id, title: blockTitle(blk), grade: topics.blockGrade(blk.id, stats),
    })),
  }));
  const allBlocks = tree.flatMap((s) => s.blocks);

  const list = el('div', { class: 'tb-list' });
  const summary = el('p', { class: 'tb-summary' });
  const start = el('button', { type: 'button', class: 'btn btn--lg' }, 'Начать тест');
  const optionsBox = el('div', { class: 'tb-options' });

  const chosen = () => {
    let qs = topics.questionsFor([...pick]);
    const pool = qs.length;
    // The same test as practice's «Где ошибался»: a blank counts as not solved.
    if (opts.only === 'open') qs = qs.filter((q) => !lastAnswerRight(q, stats));
    const open = qs.length;
    if (opts.count) qs = qs.slice(0, opts.count);
    return { qs, pool, open };
  };

  const render = () => {
    clear(list).append(...tree.map((sec) => {
      const on = sec.blocks.filter((b) => pick.has(b.id)).length;
      const secBox = el('input', {
        type: 'checkbox',
        checked: on === sec.blocks.length,
        onchange: (e) => { for (const b of sec.blocks) e.target.checked ? pick.add(b.id) : pick.delete(b.id); render(); },
      });
      secBox.indeterminate = on > 0 && on < sec.blocks.length;
      const secQs = topics.questionsFor(sec.blocks.map((b) => b.id));
      return el('div', { class: 'tb-sec' },
        el('div', { class: 'tb-sec__head' },
          el('label', {}, secBox, el('b', {}, sec.title)),
          el('span', { class: 'tb-count' }, `${secQs.length} вопр.`)),
        el('div', { class: 'tb-sec__grade' }, gradeChip(topics.grade(secQs, stats))),
        el('div', { class: 'tb-blocks' }, ...sec.blocks.map((b) => {
          const n = topics.questionsFor([b.id]).length;
          return el('label', { class: `tb-blk${n ? '' : ' is-empty'}` },
            el('input', {
              type: 'checkbox',
              checked: pick.has(b.id),
              disabled: !n,
              onchange: (e) => { e.target.checked ? pick.add(b.id) : pick.delete(b.id); render(); },
            }),
            el('span', { class: 'tb-blk__title' }, b.title),
            el('span', { class: 'tb-count' }, n ? String(n) : '—'),
            el('i', { class: `side-dot lvl-${b.grade.level}`, title: `${topics.LEVELS[b.grade.level].label}. ${topics.gradeTitle(b.grade)}` }));
        })));
    }));

    clear(optionsBox).append(
      el('div', { class: 'field' },
        el('label', {}, 'Какие вопросы'),
        el('div', { class: 'chips' },
          ...[['all', 'Все по темам'], ['open', 'Ещё не решал или ошибался']].map(([id, label]) => el('button', {
            type: 'button',
            class: `chip${opts.only === id ? ' is-on' : ''}`,
            onclick: () => { opts.only = id; render(); },
          }, label)))),
      el('div', { class: 'field' },
        el('label', {}, 'Сколько'),
        el('div', { class: 'chips' },
          ...TEST_COUNTS.map((n) => el('button', {
            type: 'button',
            class: `chip${opts.count === n ? ' is-on' : ''}`,
            onclick: () => { opts.count = n; render(); },
          }, n ? String(n) : 'Все')))));

    const { qs, pool, open } = chosen();
    const minutes = Math.max(5, Math.ceil(qs.length * MINUTES_PER_QUESTION));
    clear(summary).append(...(pick.size
      ? [
        el('b', {}, plural(qs.length, 'вопрос', 'вопроса', 'вопросов')),
        ` из ${pool} по ${pick.size} ${pick.size === 1 ? 'теме' : 'темам'}`,
        opts.only === 'open' ? ` (не решено или с ошибкой — ${open})` : '',
        ` · ${minutes} мин. Без повторов: каждый вопрос в самой свежей версии. Сначала — те, что встречались на экзаменах чаще.`,
      ]
      : ['Отметь темы — вопросы банка по ним соберутся в тест.']));
    start.disabled = !qs.length;
  };

  start.addEventListener('click', () => {
    const { qs } = chosen();
    if (!qs.length) return;
    store.saveDocsState({ test: { blocks: [...pick], only: opts.only, count: opts.count } });
    const session = newSession({
      part: 'A',
      sourceType: 'topics',
      sourceLabel: testLabel(tree, pick),
      qids: qs.map((q) => q.id),
      minutes: Math.max(5, Math.ceil(qs.length * MINUTES_PER_QUESTION)),
    });
    ui.closeModal();
    startSession(session, navigate);
  });

  const quick = (label, title, fn) => el('button', {
    type: 'button', class: 'chip', title, onclick: () => { fn(); render(); },
  }, label);

  render();
  ui.openModal('Свой тест по шпаргалке', el('div', { class: 'tb' },
    el('p', { class: 'muted tb-lede' },
      'Отметь темы — в тест войдут вопросы банка именно по ним, сначала те, что чаще повторялись между экзаменами. ',
      'Число у темы — сколько разных вопросов нашлось, точка — как ты их решал.'),
    el('div', { class: 'chips tb-quick' },
      quick('Слабые темы', '«Не понимаю» и «Примерно понимаю»', () => {
        pick.clear();
        for (const b of allBlocks) if (b.grade.level === 'weak' || b.grade.level === 'partly') pick.add(b.id);
      }),
      quick('Ещё не решал', 'Темы, где не решён ни один вопрос', () => {
        pick.clear();
        for (const b of allBlocks) if (!b.grade.answered && topics.questionsFor([b.id]).length) pick.add(b.id);
      }),
      quick('Все темы', null, () => { for (const b of allBlocks) pick.add(b.id); }),
      quick('Снять всё', null, () => pick.clear())),
    list,
    optionsBox,
    el('div', { class: 'tb-foot' }, summary, start)), { wide: true });
}

/** "Свой тест · Сеть, RAID +2": whole sections by name, the rest by block. */
function testLabel(tree, pick) {
  const names = [];
  for (const sec of tree) {
    const on = sec.blocks.filter((b) => pick.has(b.id));
    if (on.length === sec.blocks.length) names.push(sec.title);
    else names.push(...on.map((b) => b.title));
  }
  const shown = names.slice(0, 2).join(', ');
  return `Свой тест · ${shown}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
}
