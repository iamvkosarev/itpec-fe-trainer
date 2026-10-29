// The dictionary: words and phrases picked out of question texts.
//
// The words live on disk in vocab/words.json, written by start.sh's
// /api/vocab endpoints, so they can be read and translated outside the
// browser. Translations come from vocab/translations.json (tools/vocab.py
// apply), keyed by the same word key. How well each word is known is browser
// progress and lives in store.js like the rest of it.
//
// word:        { key, phrase, added, contexts: [{ qid, text }] }
// translation: { ru, alts: [three wrong but plausible translations], note? }

import { el, clear } from './util.js';

const API = 'api/vocab';

let words = [];
let translations = {};
let online = false;
let pattern = null;

/** Never rejects: without the endpoint (an older start.sh) the app works as before. */
export async function load() {
  try {
    const res = await fetch(API, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    words = data.words || [];
    translations = data.translations || {};
    online = true;
  } catch (err) {
    console.warn('dictionary unavailable', err);
    online = false;
  }
  pattern = null;
  return online;
}

export function isOnline() {
  return online;
}

/** Every word with its translation (or null while it waits for one), newest first. */
export function entries() {
  return words
    .map((w) => ({ ...w, t: validTranslation(translations[w.key]) }))
    .reverse();
}

export function byKey(key) {
  const word = words.find((w) => w.key === key);
  return word ? { ...word, t: validTranslation(translations[word.key]) } : null;
}

function validTranslation(t) {
  return t && typeof t.ru === 'string' && t.ru.trim() ? t : null;
}

async function post(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function add(phrase, context, qid) {
  const { word, created } = await post('add', { phrase, context, qid });
  const at = words.findIndex((w) => w.key === word.key);
  if (at >= 0) words[at] = word;
  else words.push(word);
  pattern = null;
  return { word, created };
}

export async function remove(key) {
  await post('remove', { key });
  words = words.filter((w) => w.key !== key);
  pattern = null;
}

/* ── Question as text, for picking words ──────────────────────────────── */

function questionText(q) {
  return (q.text || '')
    .replace(/^Q\s?\d+\.?\s*/i, '')
    .replace(/[ \t]+\n/g, '\n')
    // The PDF wraps prose at its page width; rejoin those lines so the text
    // reflows. Short lines (tables, diagram labels), lines that end a sentence
    // and lines that start an answer option keep their breaks.
    .replace(/([^\n]{54,}[^\n.?!:])\n(?!\s*[a-k]\)\s)/g, '$1 ');
}

/** Whether a question can be shown as text: Subject A, with text from the PDF. */
export function hasText(q) {
  return Boolean(q && q.part === 'A' && questionText(q));
}

/**
 * The picture of a question plus, for Subject A, a button that swaps it for
 * the selectable text and back. The caller puts `button` in its header (it is
 * null when there is no text) and `body` where the picture goes.
 */
export function switchable(q, picture, { text = false, onChange = null } = {}) {
  const body = el('div', { class: 'qswitch' });
  if (!hasText(q)) { body.append(picture); return { body, button: null }; }
  let showing = text;
  const button = el('button', { class: 'btn btn--ghost btn--sm qswitch__btn', type: 'button' });
  const render = () => {
    clear(body).append(showing ? textView(q) : picture);
    button.textContent = showing ? 'Картинка' : 'Текст';
    button.title = showing
      ? 'Вернуть вопрос картинкой'
      : 'Показать вопрос текстом: выделять слова, слушать произношение, добавлять в словарь';
    button.setAttribute('aria-pressed', showing ? 'true' : 'false');
    button.classList.toggle('is-on', showing);
  };
  button.addEventListener('click', () => {
    showing = !showing;
    render();
    if (onChange) onChange(showing);
  });
  render();
  return { body, button };
}

/**
 * The question's own English text, where words can be selected to hear them
 * or send them to the dictionary. Words already in it are marked, with the
 * translation on hover once there is one. The text is what the PDF holds, so
 * diagrams come out as loose fragments — the picture stays the original.
 */
function textView(q) {
  const text = questionText(q);
  const box = el('div', { class: 'qtext' });

  const body = el('div', { class: 'qtext__body', lang: 'en' });
  const addBtn = el('button', { class: 'qtext__add btn btn--sm' }, '+ В словарь');
  const listenBtn = canSpeak()
    ? speakButton(() => (picked ? picked.phrase : ''), { solid: true, title: 'Произношение выделенного' })
    : null;
  // Floats under the selection: listen to it, put it in the dictionary.
  const tools = el('div', { class: 'qtext__tools', hidden: true }, listenBtn, online ? addBtn : null);
  let picked = null;

  const paint = () => {
    clear(body);
    const re = markPattern();
    if (!re) { body.textContent = text; return; }
    let last = 0;
    for (const match of text.matchAll(re)) {
      if (match.index > last) body.append(text.slice(last, match.index));
      const word = byKey(normalize(match[0]));
      body.append(el('mark', {
        class: `vocab-mark${word && word.t ? '' : ' is-pending'}`,
        title: word && word.t ? word.t.ru : 'в словаре · ждёт перевода',
      }, match[0]));
      last = match.index + match[0].length;
    }
    body.append(text.slice(last));
  };

  const hide = () => { tools.hidden = true; picked = null; };

  const showFor = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
    const range = sel.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return hide();
    const phrase = sel.toString().replace(/\s+/g, ' ').trim();
    if (!phrase || phrase.length > 120 || !/[A-Za-z]/.test(phrase)) return hide();

    const before = document.createRange();
    before.selectNodeContents(body);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    picked = { phrase, context: sentenceAround(text, start, start + sel.toString().length) };

    if (!tools.firstChild) return;
    const r = range.getBoundingClientRect();
    const host = box.getBoundingClientRect();
    tools.hidden = false;
    const half = tools.offsetWidth / 2;
    const x = Math.min(Math.max(r.left - host.left + r.width / 2, half + 4), host.width - half - 4);
    tools.style.left = `${x}px`;
    tools.style.top = `${r.bottom - host.top + 8}px`;
  };

  body.addEventListener('mouseup', () => setTimeout(showFor, 0));
  body.addEventListener('keyup', () => setTimeout(showFor, 0));
  body.addEventListener('touchend', () => setTimeout(showFor, 250));
  body.addEventListener('mousedown', hide);
  // Keeps the selection alive while a button is pressed.
  tools.addEventListener('mousedown', (event) => event.preventDefault());
  addBtn.addEventListener('click', async () => {
    if (!picked) return;
    const { phrase, context } = picked;
    hide();
    try {
      const { word, created } = await add(phrase, context, q.id);
      window.getSelection().removeAllRanges();
      paint();
      toast(created
        ? `«${word.phrase}» — в словаре`
        : `«${word.phrase}» уже в словаре${word.contexts.length > 1 ? ' — добавлен ещё пример' : ''}`);
    } catch (err) {
      console.warn('dictionary add failed', err);
      toast('Не сохранилось: перезапустите ./start.sh — нужна новая версия сервера', true);
    }
  });

  paint();
  box.append(
    el('p', { class: 'qtext__hint' },
      online
        ? 'Выделите слово или фразу — послушать или добавить в словарь.'
        : 'Словарь недоступен — перезапустите ./start.sh. Послушать выделенное можно и так.'),
    body,
    tools);
  return box;
}

/* ── Picking English anywhere ─────────────────────────────────────────── */
// The app is driven by clicks, so selecting text is free to mean "this word".
// Any English selected on any screen — explanations, the cheat sheet, word
// cards — gets the same "listen / add to the dictionary" buttons as the
// question text. The word is filed under the question it sits in (the closest
// [data-qid]) or, elsewhere, under the screen: "@docs/cheatsheet".

const SOURCES = [
  ['@docs', 'Документы'], ['@words', 'Слова'], ['@results', 'Разбор экзамена'],
  ['@practice', 'Практика'], ['@history', 'История'], ['@exam', 'Экзамен'],
];

/** "@docs/cheatsheet" -> "Документы"; null for a real question id. */
export function sourceLabel(id) {
  if (!id || !id.startsWith('@')) return null;
  const hit = SOURCES.find(([prefix]) => id === prefix || id.startsWith(`${prefix}/`));
  return hit ? hit[1] : 'Обзор';
}

function screenSource() {
  const path = (window.location.hash || '#/').replace(/^#\/?/, '').split('?')[0];
  return `@${path}`.slice(0, 40);
}

const BLOCKS = 'p, li, dd, dt, td, th, h1, h2, h3, h4, blockquote, figcaption, button, label, div';

export function enableGlobalPicking() {
  let picked = null;
  const addBtn = el('button', { class: 'btn btn--sm', type: 'button' }, '+ В словарь');
  const listenBtn = speakButton(() => (picked ? picked.phrase : ''), { solid: true, title: 'Произношение выделенного' });
  const tools = el('div', { class: 'qtext__tools picktools', hidden: true }, listenBtn, addBtn);
  document.body.append(tools);

  const hide = () => { tools.hidden = true; picked = null; };

  const showFor = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
    const range = sel.getRangeAt(0);
    const anchor = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    // The question text has its own buttons; form fields are for typing.
    if (!anchor || anchor.closest('.qtext, input, textarea, select, .picktools, .topbar')) return hide();
    if (!anchor.closest('#screen, #modal')) return hide();
    const phrase = sel.toString().replace(/\s+/g, ' ').trim();
    if (!phrase || phrase.length > 120 || !/[A-Za-z]/.test(phrase) || /[А-Яа-яЁё]/.test(phrase)) return hide();

    const block = anchor.closest(BLOCKS) || anchor;
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const holder = anchor.closest('[data-qid]');
    picked = {
      phrase,
      context: sentenceAround(block.textContent || '', start, start + sel.toString().length),
      qid: holder ? holder.dataset.qid : screenSource(),
    };

    addBtn.hidden = !online;
    if (!tools.querySelector('button:not([hidden])')) return;
    const r = range.getBoundingClientRect();
    tools.hidden = false;
    const half = tools.offsetWidth / 2;
    const x = Math.min(Math.max(r.left + r.width / 2, half + 8), document.documentElement.clientWidth - half - 8);
    tools.style.left = `${x + window.scrollX}px`;
    tools.style.top = `${r.bottom + window.scrollY + 8}px`;
  };

  const later = (ms) => (event) => {
    if (tools.contains(event.target)) return;
    setTimeout(showFor, ms);
  };
  document.addEventListener('mouseup', later(0));
  document.addEventListener('keyup', later(0));
  document.addEventListener('touchend', later(250));
  document.addEventListener('mousedown', (event) => { if (!tools.contains(event.target)) hide(); });
  window.addEventListener('hashchange', hide);
  // Keeps the selection alive while a button is pressed.
  tools.addEventListener('mousedown', (event) => event.preventDefault());
  addBtn.addEventListener('click', async () => {
    if (!picked) return;
    const { phrase, context, qid } = picked;
    hide();
    try {
      const { word, created } = await add(phrase, context, qid);
      window.getSelection().removeAllRanges();
      toast(created
        ? `«${word.phrase}» — в словаре`
        : `«${word.phrase}» уже в словаре${word.contexts.length > 1 ? ' — добавлен ещё пример' : ''}`);
    } catch (err) {
      console.warn('dictionary add failed', err);
      toast('Не сохранилось: перезапустите ./start.sh — нужна новая версия сервера', true);
    }
  });
}

/* ── Pronunciation ────────────────────────────────────────────────────── */
// The browser's own speech synthesis: on a Mac it uses the system's English
// voices, offline and free. Nothing is sent anywhere.

let voice = null;

export function canSpeak() {
  return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

// macOS names its voices in the system language ("Саманта"), so both spellings.
// Short names are matched as whole words; \b knows no Cyrillic, hence \p{L}.
const GOOD_VOICES = /samantha|саманта|allison|эллисон|alex|алекс|susan|сьюзен|zoe|зоя|evan|эван|nathan|натан|daniel|дэниэл|google us english|(?<!\p{L})(?:ava|ава|tom|том)(?!\p{L})/iu;
// The novelty voices: Bubbles, Bad News, Whisper and the like.
const SILLY_VOICES = /albert|альберт|bad news|плохие|bahh|bells|колокол|boing|прыг|bubbles|пузыр|cellos|виолончел|good news|хорошие|jester|шутник|organ|орган|superstar|суперзв|trinoid|триноид|whisper|шепот|шёпот|wobble|воббл|zarvox|зарвокс|grandma|grandpa|junior|джуниор|ralph|ральф|fred|фред|kathy|кэти|(?<!\p{L})бах(?!\p{L})/iu;

/** The best English voice the system has: a real US voice, enhanced over compact. */
function pickVoice() {
  const english = window.speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
  const score = (v) => (/en[-_]US/i.test(v.lang) ? 4 : /en[-_]GB/i.test(v.lang) ? 3 : 0)
    + (/premium|enhanced|natural|улучш/i.test(v.name) ? 4 : 0)
    + (GOOD_VOICES.test(v.name) ? 3 : 0)
    - (SILLY_VOICES.test(v.name) ? 20 : 0)
    + (v.localService ? 1 : 0);
  voice = english.sort((a, b) => score(b) - score(a))[0] || null;
}

if (canSpeak()) window.speechSynthesis.addEventListener('voiceschanged', pickVoice);

/** Reads English text aloud, cutting off whatever was still being read. */
export function speak(text) {
  if (!canSpeak() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  if (!voice) pickVoice();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice ? voice.lang : 'en-US';
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9;
  synth.speak(utterance);
}

const SPEAKER = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" '
  + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'
  + '<path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

/**
 * A "listen" button. `text` is a string or a function returning one at click
 * time. Null when the browser cannot speak, so callers can drop it in place.
 */
export function speakButton(text, { solid = false, small = false, title = 'Произношение' } = {}) {
  if (!canSpeak()) return null;
  return el('button', {
    class: `speak${solid ? ' btn btn--sm' : ' icon-btn'}${small ? ' speak--sm' : ''}`,
    type: 'button',
    title,
    'aria-label': title,
    html: SPEAKER,
    onclick: (event) => {
      event.stopPropagation();
      speak(typeof text === 'function' ? text() : text);
    },
  });
}

/** The same key start.sh gives a phrase: whitespace collapsed, edges stripped, lowercase. */
export function normalize(phrase) {
  return phrase.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?()[\]{}"'«»…\-–—/]+|[\s.,;:!?()[\]{}"'«»…\-–—/]+$/g, '')
    .toLowerCase();
}

/** One regex over every known phrase, longest first, whole words only. */
function markPattern() {
  if (pattern !== null) return pattern || null;
  const keys = words.map((w) => w.key).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!keys.length) { pattern = false; return null; }
  pattern = phraseRegex(keys);
  return pattern;
}

function phraseRegex(keys) {
  const alternatives = keys.map((key) => key
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/'/g, "['’]")
    .replace(/ /g, '\\s+'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** `text` as nodes with every occurrence of the phrase `key` in bold. */
export function withMark(text, key) {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(phraseRegex([key]))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(el('b', {}, match[0]));
    last = match.index + match[0].length;
  }
  out.push(text.slice(last));
  return out;
}

// Where a sentence or an answer option ends: ". " / "? " , a line that starts
// an option "b) …", or the wide gap before an option on the same line.
const BREAKS = /[.?!](?=\s)|\n(?=\s*[a-k]\)\s)|\s{3,}(?=[a-k]\)\s)/g;

/** The sentence (or the answer option) around a selection, for the dictionary card. */
export function sentenceAround(text, start, end) {
  let from = 0;
  let to = text.length;
  for (const match of text.matchAll(BREAKS)) {
    const after = match.index + match[0].length;
    if (after <= start) from = after;
    else if (match.index >= end) { to = /[.?!]/.test(match[0]) ? after : match.index; break; }
  }
  let sentence = text.slice(from, to).replace(/\s+/g, ' ').trim();
  if (sentence.length > 400) {
    const at = Math.max(0, start - from - 180);
    sentence = `…${text.slice(from + at, from + at + 360).replace(/\s+/g, ' ').trim()}…`;
  }
  return sentence;
}

/* ── Toast ────────────────────────────────────────────────────────────── */

let toastTimer = null;

export function toast(message, bad = false) {
  let node = document.getElementById('toast');
  if (!node) {
    node = el('div', { id: 'toast', class: 'toast', role: 'status' });
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.toggle('is-bad', bad);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, bad ? 5000 : 2400);
}
