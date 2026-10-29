// Russian translations and worked explanations, kept apart from the bank in
// data/explain/. They are annotations keyed by question ID and are only ever
// read, never stored, so adding or regenerating them cannot touch progress.
//
// data/explain/index.json      { exams: { "2025A-A": ["2025A-A-10", ...] } }
// data/explain/<examId>.json   { "<question id>": entry }
//
// entry: { answer, question, options: {a..}, terms: [{term, full?, ru}],
//          solution, why: {a..}, memo|null, note? }
// Text fields are plain text: "\n" breaks lines, **…** is bold.

import { el, clear } from './util.js';

const DIR = 'data/explain/';
const FRESH = { cache: 'no-cache' };

let available = new Set();
// examId -> { promise, data }: data is filled once the file has arrived, so a
// re-render right after answering draws synchronously instead of flashing.
const files = new Map();

/** Never rejects: without explanations the app works exactly as before. */
export async function loadIndex() {
  try {
    const res = await fetch(`${DIR}index.json`, FRESH);
    if (!res.ok) return;
    const index = await res.json();
    available = new Set(Object.values(index.exams || {}).flat());
  } catch (err) {
    console.warn('explanations unavailable', err);
  }
}

export function has(q) {
  return Boolean(q) && available.has(q.id);
}

function file(examId) {
  let slot = files.get(examId);
  if (!slot) {
    slot = { data: null };
    slot.promise = fetch(`${DIR}${examId}.json`, FRESH)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => { slot.data = data; return data; })
      .catch((err) => {
        console.warn('explanation file failed', examId, err);
        files.delete(examId); // let the next question retry
        return {};
      });
    files.set(examId, slot);
  }
  return slot;
}

/** The raw entry for exactly this question, or null. For reports; never rejects. */
export async function entry(q) {
  if (!has(q)) return null;
  const data = await file(q.examId).promise;
  return (data && data[q.id]) || null;
}

/** Starts fetching the file in the background, so the answer reveal is instant. */
export function prefetch(q) {
  if (has(q)) file(q.examId);
}

/**
 * The translation card. Unrevealed it carries the question, the options and
 * the glossary, so it can sit beside an unanswered question without giving the
 * answer away. Revealed it marks the correct and the picked option, says what
 * every option really describes, and adds the solution and the memory hook.
 */
export function panel(q, { revealed = false, picked = null } = {}) {
  // data-qid: English picked from the explanation is filed under this question.
  const box = el('section', { class: 'explain', dataset: { qid: q.id } });
  if (!has(q)) { box.hidden = true; return box; }
  const fill = (data) => {
    const entry = data && data[q.id];
    if (!entry) { box.hidden = true; return; }
    clear(box).append(...render(entry, q, revealed, picked));
  };
  const slot = file(q.examId);
  if (slot.data) fill(slot.data);
  else {
    box.append(el('p', { class: 'muted', style: 'margin:0;font-size:.8125rem' }, 'Загрузка перевода…'));
    slot.promise.then(fill);
  }
  return box;
}

function render(entry, q, revealed, picked) {
  const out = [
    el('div', { class: 'explain__head' },
      el('span', { class: 'eyebrow' }, revealed ? 'Перевод и разбор' : 'Перевод'),
      el('span', { class: 'tag' }, 'RU')),
    rich('p', entry.question, 'explain__q'),
  ];

  const opts = el('ol', { class: 'explain__opts' });
  for (const letter of q.options) {
    const state = !revealed ? ''
      : letter === q.answer ? ' is-correct'
        : letter === picked ? ' is-wrong' : '';
    opts.append(el('li', { class: `explain__opt${state}` },
      el('b', {}, `${letter})`),
      rich('div', entry.options[letter] || '—'),
      revealed && entry.why && entry.why[letter]
        ? rich('div', entry.why[letter], 'explain__why')
        : null));
  }
  out.push(opts);

  if (revealed) {
    out.push(block('Как решать', rich('div', entry.solution)));
    if (entry.memo) out.push(block('Как запомнить', rich('div', entry.memo, 'explain__memo')));
    if (entry.note) out.push(block('Примечание', rich('div', entry.note, 'explain__note')));
  }

  if (entry.terms && entry.terms.length) {
    const list = el('dl', { class: 'explain__terms' });
    for (const t of entry.terms) {
      list.append(
        el('dt', {}, t.term, t.full ? el('small', {}, t.full) : null),
        el('dd', {}, t.ru));
    }
    out.push(block('Термины', list));
  }
  return out;
}

function block(title, ...body) {
  return el('div', { class: 'explain__block' }, el('h3', {}, title), ...body);
}

/** Plain text with "\n" line breaks and **bold**; built as DOM, never as HTML. */
function rich(tag, text, cls = '') {
  const node = el(tag, { class: `explain__text ${cls}`.trim() });
  String(text).split('**').forEach((part, i) => {
    if (!part) return;
    node.append(i % 2 ? el('b', {}, part) : document.createTextNode(part));
  });
  return node;
}
