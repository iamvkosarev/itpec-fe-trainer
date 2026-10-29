// Abbreviation drill: every abbreviation met in the question texts
// (data/abbr.json), asked as a four-way choice. "Аббревиатура → расшифровка"
// offers the right English expansion among three made-up ones that spell the
// same letters, so the letters alone give nothing away. "Смысл → аббревиатура"
// gives the meaning and offers neighbours from the same topic (RPO / RTO /
// MTD). Answers go into Leitner boxes like the word drill, under their own key.

import { el, clear, shuffled, plural } from './util.js';
import * as bank from './bank.js';
import * as store from './store.js';
import * as ui from './ui.js';
import { showQuestion } from './cheatsheet-widgets.js';

const MODES = [['fwd', 'Аббревиатура → расшифровка'], ['rev', 'Смысл → аббревиатура'], ['list', 'Таблица']];
const LEVELS = 5;

let data = null;
let loading = null;

function load() {
  if (!loading) {
    loading = fetch('data/abbr.json', { cache: 'no-cache' })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((json) => {
        data = json;
        data.byId = new Map(json.items.map((item) => [item.id, item]));
        data.topicName = Object.fromEntries(json.topics);
        return data;
      })
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

/**
 * The drill inside the «Слова» screen. `onChange` repaints the screen's stat
 * strip after an answer; the returned object renders the tab body, gives
 * the strip's cells and handles keys while the tab is open.
 */
export function abbrDrill({ params, onChange }) {
  let mode = MODES.some(([id]) => id === params.get('mode')) ? params.get('mode') : 'fwd';
  let topic = params.get('topic') || 'all';
  let query = '';
  const session = { shown: 0, right: 0, card: null, lastId: null };
  let body = null;
  let failed = false;

  const inTopic = () => (data ? data.items.filter((item) => topic === 'all' || item.topic === topic) : []);

  const syncUrl = () => {
    const parts = ['tab=abbr'];
    if (mode !== 'fwd') parts.push(`mode=${mode}`);
    if (topic !== 'all') parts.push(`topic=${topic}`);
    history.replaceState(null, '', `#/words?${parts.join('&')}`);
  };

  const render = (node) => {
    body = node || body;
    if (!data) {
      clear(body).append(ui.emptyState(failed
        ? 'Не загрузился список аббревиатур (data/abbr.json). Обновите страницу.'
        : 'Загружаю аббревиатуры…'));
      if (!failed) {
        load().then(() => { onChange(); render(); })
          .catch((err) => { console.warn('abbreviations unavailable', err); failed = true; render(); });
      }
      return;
    }
    if (topic !== 'all' && !data.topicName[topic]) topic = 'all';
    const parts = [controls()];
    if (mode === 'list') parts.push(listView());
    else parts.push(...drillView());
    clear(body).append(...parts);
  };

  /* ── Mode and topic ─────────────────────────────────────────────────── */

  const controls = () => {
    const counts = { all: data.items.length };
    for (const item of data.items) counts[item.topic] = (counts[item.topic] || 0) + 1;
    return el('div', { class: 'abbr-controls' },
      el('div', { class: 'chips' }, ...MODES.map(([id, label]) => el('button', {
        class: `chip${mode === id ? ' is-on' : ''}`,
        onclick: () => { mode = id; session.card = null; syncUrl(); render(); },
      }, label))),
      el('div', { class: 'chips' },
        ...[['all', 'Все темы'], ...data.topics].map(([id, label]) => el('button', {
          class: `chip chip--quiet${topic === id ? ' is-on' : ''}`,
          onclick: () => { topic = id; session.card = null; syncUrl(); onChange(); render(); },
        }, `${label} · ${counts[id] || 0}`))));
  };

  /* ── Drill ──────────────────────────────────────────────────────────── */

  const next = (force = false) => {
    session.card = pickCard(inTopic(), mode, session.lastId, force);
    if (session.card.item) session.lastId = session.card.item.id;
    render();
  };

  const answer = (option) => {
    const card = session.card;
    if (!card || card.kind !== 'quiz' || card.picked) return;
    card.picked = option;
    const right = option === card.answer;
    store.recordAbbr(card.item.id, right);
    session.shown++;
    if (right) session.right++;
    onChange();
    render();
  };

  const drillView = () => {
    if (!session.card) session.card = pickCard(inTopic(), mode, session.lastId, false);
    const card = session.card;
    const parts = [];
    if (card.kind === 'wait') {
      parts.push(el('div', { class: 'emptystate' },
        el('p', {}, `Все аббревиатуры темы повторены. Следующая — ${untilText(card.due)}.`),
        el('button', { class: 'btn btn--ghost', onclick: () => next(true) }, 'Повторить ещё раз')));
    } else {
      parts.push(quizCard(card, answer, () => next()));
    }
    if (session.shown) {
      parts.push(el('p', { class: 'muted', style: 'margin-top:14px;font-size:.8125rem' },
        `В этой сессии: ${session.right} из ${session.shown} верно.`));
    }
    return parts;
  };

  /* ── Table ──────────────────────────────────────────────────────────── */

  const listView = () => {
    const progress = store.getAbbrProgress();
    const rows = el('div', { class: 'wordlist' });
    const paint = () => {
      const q = query.trim().toLowerCase();
      const shown = inTopic().filter((item) => !q
        || `${item.abbr} ${item.full} ${item.ru}`.toLowerCase().includes(q));
      clear(rows).append(...(shown.length
        ? shown.map((item) => abbrRow(item, progress[item.id]))
        : [ui.emptyState('Ничего не нашлось.')]));
    };
    const search = el('input', {
      type: 'search',
      class: 'abbr-search',
      placeholder: 'Поиск: буквы, расшифровка или перевод',
      value: query,
      oninput: (e) => { query = e.target.value; paint(); },
    });
    paint();
    return el('div', {}, search, rows);
  };

  /* ── Strip and keys ─────────────────────────────────────────────────── */

  const stats = () => {
    if (!data) return [['…', 'аббревиатур']];
    const progress = store.getAbbrProgress();
    const items = inTopic();
    let fresh = 0;
    let learned = 0;
    for (const item of items) {
      const p = progress[item.id];
      if (!p) fresh++;
      else if (p.box >= store.VOCAB_LEARNED_BOX) learned++;
    }
    return [
      [String(items.length), topic === 'all' ? 'аббревиатур' : 'в этой теме'],
      [String(fresh), 'ещё не спрашивал'],
      [String(items.length - fresh - learned), 'в работе'],
      [String(learned), 'выучено'],
    ];
  };

  const onKey = (event) => {
    const card = session.card;
    if (mode === 'list' || !card || card.kind !== 'quiz') return;
    const go = event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight';
    if (!card.picked) {
      const digit = Number(event.key);
      if (digit >= 1 && digit <= card.options.length) { answer(card.options[digit - 1]); event.preventDefault(); }
    } else if (go) { next(); event.preventDefault(); }
  };

  return { render, stats, onKey };
}

/**
 * Due abbreviations first (the shakiest, then the longest waiting), then the
 * ones never asked, most frequent in the bank first. `force` serves the
 * soonest one even when nothing is due.
 */
function pickCard(items, mode, lastId, force) {
  const progress = store.getAbbrProgress();
  const now = Date.now();
  const seen = items.filter((item) => progress[item.id]);
  const byBox = (a, b) => progress[a.id].box - progress[b.id].box || progress[a.id].due - progress[b.id].due;
  let pool = seen.filter((item) => progress[item.id].due <= now).sort(byBox);
  if (!pool.length) pool = items.filter((item) => !progress[item.id]);
  if (!pool.length && force) pool = seen.slice().sort((a, b) => progress[a.id].due - progress[b.id].due);
  if (!pool.length) return { kind: 'wait', due: Math.min(...seen.map((item) => progress[item.id].due)) };
  if (pool.length > 1) pool = pool.filter((item) => item.id !== lastId);
  const item = pool[0];
  if (mode === 'rev') {
    const options = shuffled([item, ...neighbours(item)]);
    return { kind: 'quiz', mode, item, options, answer: item, picked: null };
  }
  return { kind: 'quiz', mode, item, options: shuffled([item.full, ...item.decoys]), answer: item.full, picked: null };
}

/**
 * Three other abbreviations to choose from when the meaning is given: from
 * the same topic, the most alike in letters first (RTO next to RPO), never
 * one spelled the same or listed as its twin (SSL and TLS mean one thing).
 */
function neighbours(item) {
  const twins = new Set(item.twins || []);
  const letters = new Set(item.abbr.toUpperCase());
  const score = (other) => {
    let s = other.abbr[0] === item.abbr[0] ? 3 : 0;
    if (other.abbr.length === item.abbr.length) s += 1;
    for (const ch of new Set(other.abbr.toUpperCase())) if (letters.has(ch)) s += 1;
    return s + Math.random() * 2;
  };
  const fits = (other) => other.abbr !== item.abbr && !twins.has(other.id) && !(other.twins || []).includes(item.id);
  const near = data.items.filter((other) => other.topic === item.topic && fits(other))
    .sort((a, b) => score(b) - score(a));
  const picked = shuffled(near.slice(0, 6)).slice(0, 3);
  // A small topic may not have three; fill up from everything else.
  for (const other of shuffled(data.items)) {
    if (picked.length >= 3) break;
    if (fits(other) && !picked.includes(other)) picked.push(other);
  }
  return picked;
}

/* ── Cards ────────────────────────────────────────────────────────────── */

function quizCard(card, onPick, onNext) {
  const { item, options, picked, mode } = card;
  const p = store.getAbbrProgress()[item.id];
  const rev = mode === 'rev';
  const opts = ui.holdHover(el('div', { class: `wordcard__opts${rev ? ' abbr-opts--rev' : ''}` }));
  options.forEach((option, i) => {
    const state = !picked ? ''
      : option === card.answer ? ' is-correct'
        : option === picked ? ' is-wrong' : '';
    opts.append(el('button', {
      class: `wordopt${state}`,
      disabled: Boolean(picked),
      onclick: () => onPick(option),
    },
    el('kbd', {}, String(i + 1)),
    rev
      ? el('span', {}, el('b', { class: 'abbr-opt__abbr' }, option.abbr),
          picked ? el('small', { class: 'abbr-opt__full', lang: 'en' }, option.full) : null)
      : el('span', { lang: 'en' }, option)));
  });

  const right = picked === card.answer;
  const prompt = rev
    ? el('p', { class: 'abbr-card__meaning' }, hideLetters(item.ru, item))
    : el('div', { class: 'wordcard__title' }, el('h2', { class: 'abbr-card__abbr', lang: 'en' }, item.abbr));

  return el('section', { class: 'card wordcard' },
    el('div', { class: 'wordcard__head' },
      el('span', { class: 'eyebrow' }, rev ? 'Какая аббревиатура подходит' : 'Что значит аббревиатура'),
      el('span', { style: 'display:flex;gap:10px;align-items:center' },
        el('span', { class: 'tag' }, data.topicName[item.topic]),
        levelDots(p ? p.box : 0))),
    prompt,
    el('p', { class: 'muted', style: 'margin:6px 0 0;font-size:.8125rem' },
      `Встречается в банке: ${plural(item.qids.length, 'вопрос', 'вопроса', 'вопросов')}`),
    opts,
    picked
      ? el('div', {},
          explanation(item),
          el('div', { class: 'wordcard__foot' },
            el('span', { class: right ? 'tag tag--ok' : 'tag tag--stamp', style: 'font-size:.8125rem;padding:5px 12px' },
              right ? '✓ Верно' : `✕ Верно: ${rev ? item.abbr : item.full}`),
            el('span', { style: 'flex:1' }),
            el('button', { class: 'btn', onclick: onNext }, 'Дальше →', el('kbd', {}, 'Enter'), el('kbd', {}, 'Пробел'))))
      : el('p', { class: 'muted', style: 'margin:12px 0 0;font-size:.8125rem' }, 'Клавиши 1–4 тоже работают.'));
}

/** The meaning without the answer in it: «SIM-карта» would give SIM away. */
function hideLetters(text, item) {
  let out = text;
  for (const s of [item.abbr, ...(item.spellings || [])]) {
    out = out.replace(new RegExp(`(?<![A-Za-z])${escapeRe(s)}(?![A-Za-z])`, 'g'), '…');
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** What the abbreviation stands for and where the exam used it. */
function explanation(item) {
  return el('div', { class: 'abbr-explain' },
    el('p', { class: 'abbr-explain__full' },
      el('b', { lang: 'en' }, item.abbr), ' = ', el('span', { lang: 'en' }, item.full)),
    el('p', { class: 'wordcard__ru', style: 'font-size:1.0625rem' }, item.ru),
    item.note ? el('p', { class: 'wordcard__note' }, item.note) : '',
    usages(item, 2));
}

/** The newest questions with the abbreviation marked, then links to the rest. */
function usages(item, withText) {
  const qs = item.qids.map((id) => bank.question(id)).filter(Boolean).reverse();
  if (!qs.length) return '';
  const box = el('div', { class: 'wordcard__ctx' });
  for (const q of qs.slice(0, withText)) {
    box.append(el('div', {},
      el('p', { lang: 'en' }, ...snippet(q.text || '', [item.abbr, ...(item.spellings || [])])),
      el('button', { class: 'linkbtn', title: 'Открыть вопрос с ответом', onclick: () => showQuestion(q) }, shortName(q))));
  }
  const rest = qs.slice(withText, withText + 12);
  if (rest.length) {
    box.append(el('div', { class: 'abbr-more' },
      el('span', { class: 'muted' }, 'Ещё в:'),
      ...rest.map((q) => el('button', { class: 'linkbtn', onclick: () => showQuestion(q) }, shortName(q))),
      qs.length > withText + rest.length ? el('span', { class: 'muted' }, `и ещё ${qs.length - withText - rest.length}`) : ''));
  }
  return box;
}

/** About two lines around the first of `spellings` found in the text, marked. */
function snippet(text, spellings) {
  const flat = text.replace(/\s+/g, ' ');
  const re = new RegExp(`(?<![A-Za-z0-9])(?:${spellings.map(escapeRe).join('|')})(?![A-Za-z0-9])`);
  const m = re.exec(flat);
  if (!m) return [flat.slice(0, 220)];
  const end = m.index + m[0].length;
  let from = Math.max(0, m.index - 130);
  let to = Math.min(flat.length, end + 130);
  if (from > 0) from = flat.indexOf(' ', from) + 1;
  if (to < flat.length) to = Math.max(end, flat.lastIndexOf(' ', to));
  return [from > 0 ? '…' : '', flat.slice(from, m.index), el('b', {}, m[0]),
    flat.slice(end, to), to < flat.length ? '…' : ''];
}

function shortName(q) {
  return `${q.examId.slice(0, 5)}${q.part === 'B' ? '·B' : ''}·Q${q.no}`;
}

function abbrRow(item, progress) {
  const detail = el('div', { class: 'wordrow__detail', hidden: true });
  let built = false;
  const toggle = () => {
    if (!built) {
      built = true;
      detail.append(
        el('p', { class: 'wordcard__ru', style: 'font-size:1rem;margin-top:4px' }, item.ru),
        item.note ? el('p', { class: 'wordcard__note' }, item.note) : '',
        usages(item, 1),
        progress ? el('p', { class: 'muted', style: 'font-size:.7812rem;margin:8px 0 0' },
          `Верно ${progress.right}, неверно ${progress.wrong}.`) : '');
    }
    detail.hidden = !detail.hidden;
  };
  return el('div', { class: 'wordrow' },
    el('button', { class: 'wordrow__main', onclick: toggle },
      el('b', { lang: 'en', class: 'mono' }, item.abbr),
      el('span', { lang: 'en' }, item.full),
      el('span', { class: 'muted mono', style: 'font-size:.75rem' },
        plural(item.qids.length, 'вопрос', 'вопроса', 'вопросов')),
      levelDots(progress ? progress.box : 0)),
    detail);
}

function levelDots(box) {
  const learned = box >= store.VOCAB_LEARNED_BOX;
  return el('span', {
    class: `dots${learned ? ' is-learned' : ''}`,
    title: learned ? 'Выучено' : `Уровень ${box} из ${LEVELS}`,
  }, ...Array.from({ length: LEVELS }, (_, i) => el('i', { class: i < box ? 'is-on' : '' })));
}

function untilText(due) {
  const min = Math.max(1, Math.round((due - Date.now()) / 60000));
  if (min < 60) return `через ${plural(min, 'минуту', 'минуты', 'минут')}`;
  const h = Math.round(min / 60);
  if (h < 24) return `через ${plural(h, 'час', 'часа', 'часов')}`;
  return `через ${plural(Math.round(h / 24), 'день', 'дня', 'дней')}`;
}
