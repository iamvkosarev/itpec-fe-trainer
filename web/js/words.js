// Dictionary drill: the words picked out of question texts. A new word first
// shows its translation once; then the exercise climbs with its Leitner box
// (store.js) from recognising the word to producing it:
//   box 0     English → which Russian translation (four options)
//   box 1     Russian → which English word (four options)
//   box 2–3   type the English word into a Russian sentence
//   learned   any of the three
// A wrong answer drops the word back to box 0, so back to the easiest one.

import { el, clear, shuffled, plural, pick } from './util.js';
import * as bank from './bank.js';
import * as store from './store.js';
import * as ui from './ui.js';
import * as vocab from './vocab.js';
import { abbrDrill } from './abbr.js';

const TABS = [['drill', 'Тренировка'], ['list', 'Список'], ['abbr', 'Аббревиатуры']];
const FILTERS = [
  ['all', 'Все'], ['pending', 'Ждут перевода'], ['learning', 'Учу'], ['learned', 'Выучено'],
];
const LEVELS = 5;

export function wordsScreen(root, params) {
  let tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'drill';
  let filter = 'all';
  // card: { kind: 'intro'|'quiz'|'quizEn'|'type'|'wait'|'none', word, options,
  //         picked, sentence, typed, result, hint }
  const session = { shown: 0, right: 0, card: null, lastKey: null };

  const statsNode = el('div', { class: 'statstrip statstrip--hero' });
  const tabsNode = el('div', { class: 'tabs' });
  const body = el('div', {});
  const abbr = abbrDrill({ params, onChange: () => renderStats() });

  const renderAll = () => { renderStats(); renderTabs(); renderBody(); };

  const renderStats = () => {
    if (tab === 'abbr') {
      clear(statsNode).append(...abbr.stats().map(([value, label]) => cell(value, label)));
      return;
    }
    const all = vocab.entries();
    const progress = store.getVocabProgress();
    const ready = all.filter((w) => w.t);
    const learned = ready.filter((w) => status(w, progress) === 'learned').length;
    clear(statsNode).append(
      cell(String(all.length), 'слов в словаре'),
      cell(String(ready.length), 'с переводом'),
      cell(String(all.length - ready.length), 'ждут перевода'),
      cell(String(learned), 'выучено'));
  };

  const renderTabs = () => {
    clear(tabsNode).append(...TABS.map(([id, label]) => el('button', {
      class: tab === id ? 'is-on' : '',
      onclick: () => {
        tab = id;
        history.replaceState(null, '', id === 'drill' ? '#/words' : `#/words?tab=${id}`);
        renderStats();
        renderTabs();
        renderBody();
      },
    }, label)));
  };

  const renderBody = () => {
    // The abbreviations ship with the app; they need no dictionary server.
    if (tab === 'abbr') return abbr.render(body);
    if (!vocab.isOnline()) {
      clear(body).append(ui.emptyState(
        'Словарь не отвечает. Перезапустите ./start.sh: слова сохраняет новая версия сервера.'));
      return;
    }
    if (tab === 'list') renderList();
    else renderDrill();
  };

  /* ── Drill ──────────────────────────────────────────────────────────── */

  const next = (force = false) => {
    session.card = pickCard(session.lastKey, force);
    if (session.card.word) session.lastKey = session.card.word.key;
    renderDrill();
  };

  const grade = (right) => {
    store.recordVocab(session.card.word.key, right);
    session.shown++;
    if (right) session.right++;
    renderStats();
    renderDrill();
  };

  const answer = (option) => {
    const card = session.card;
    if (!card || (card.kind !== 'quiz' && card.kind !== 'quizEn') || card.picked) return;
    card.picked = option;
    grade(option === rightOption(card));
  };

  /** Typed answers: an empty one is ignored unless given up on ("Не помню"). */
  const submitTyped = (text, giveUp = false) => {
    const card = session.card;
    if (!card || card.kind !== 'type' || card.result) return;
    const result = giveUp ? 'wrong' : checkTyped(text, card);
    if (!result) return;
    card.typed = text;
    card.result = result;
    grade(result !== 'wrong');
  };

  const showHint = () => {
    if (session.card && session.card.kind === 'type' && !session.card.result) {
      session.card.hint = true;
      renderDrill();
    }
  };

  const settleIntro = () => {
    store.recordVocab(session.card.word.key, null);
    next();
  };

  const renderDrill = () => {
    const all = vocab.entries();
    if (!all.length) {
      clear(body).append(ui.emptyState(
        'Словарь пуст. Откройте «Практику» или разбор экзамена, выделите незнакомое слово в тексте вопроса и нажмите «+ В словарь».'));
      return;
    }
    if (!session.card) session.card = pickCard(session.lastKey, false);
    const card = session.card;
    const pending = all.filter((w) => !w.t).length;

    const parts = [];
    if (card.kind === 'none') {
      parts.push(ui.emptyState(`${plural(pending, 'слово ждёт', 'слова ждут', 'слов ждут')} перевода, тренироваться пока не на чем.`));
    } else if (card.kind === 'wait') {
      parts.push(el('div', { class: 'emptystate' },
        el('p', {}, `Все слова повторены. Следующее — ${untilText(card.due)}.`),
        el('button', { class: 'btn btn--ghost', onclick: () => next(true) }, 'Повторить ещё раз', ...nextKeys())));
    } else if (card.kind === 'intro') {
      parts.push(introCard(card, settleIntro));
    } else if (card.kind === 'type') {
      parts.push(typeCard(card, { onSubmit: submitTyped, onHint: showHint, onNext: () => next() }));
    } else {
      parts.push(quizCard(card, answer, () => next()));
    }
    if (pending) parts.push(pendingNote(pending, renderAll));
    if (session.shown) {
      parts.push(el('p', { class: 'muted', style: 'margin-top:14px;font-size:.8125rem' },
        `В этой сессии: ${session.right} из ${session.shown} верно.`));
    }
    clear(body).append(...parts);
  };

  /* ── List ───────────────────────────────────────────────────────────── */

  const renderList = () => {
    const progress = store.getVocabProgress();
    const all = vocab.entries();
    if (!all.length) {
      clear(body).append(ui.emptyState('Словарь пуст. Выделите слово в тексте вопроса в «Практике» или в разборе экзамена.'));
      return;
    }
    const counts = Object.fromEntries(FILTERS.map(([id]) => [id, 0]));
    for (const w of all) { counts.all++; counts[status(w, progress) === 'new' ? 'learning' : status(w, progress)]++; }
    const shown = all.filter((w) => filter === 'all' || filter === status(w, progress)
      || (filter === 'learning' && status(w, progress) === 'new'));

    const rows = el('div', { class: 'wordlist' });
    for (const w of shown) rows.append(wordRow(w, progress[w.key], renderAll));

    clear(body).append(
      el('div', { class: 'chips', style: 'margin-bottom:14px' },
        ...FILTERS.map(([id, label]) => el('button', {
          class: `chip${filter === id ? ' is-on' : ''}`,
          onclick: () => { filter = id; renderList(); },
        }, `${label} · ${counts[id]}`))),
      shown.length ? rows : ui.emptyState('Под этот фильтр слов нет.'),
      counts.pending ? pendingNote(counts.pending, renderAll) : '');
  };

  const onKey = (event) => {
    if (event.target.matches('input, select, textarea')
      || !document.getElementById('modal').hidden || event.metaKey || event.ctrlKey || event.altKey) return;
    if (tab === 'abbr') { abbr.onKey(event); return; }
    if (tab !== 'drill') return;
    const card = session.card;
    if (!card) return;
    const go = event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight';
    if (card.word && /^[sSыЫ]$/.test(event.key)) { vocab.speak(card.word.phrase); event.preventDefault(); }
    else if (card.kind === 'intro' && go) { settleIntro(); event.preventDefault(); }
    else if ((card.kind === 'quiz' || card.kind === 'quizEn') && !card.picked) {
      const digit = Number(event.key);
      if (digit >= 1 && digit <= card.options.length) { answer(card.options[digit - 1]); event.preventDefault(); }
    } else if ((card.kind === 'quiz' || card.kind === 'quizEn') && go) { next(); event.preventDefault(); }
    else if (card.kind === 'type' && card.result && go) { next(); event.preventDefault(); }
    else if (card.kind === 'wait' && go) { next(true); event.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);

  clear(root).append(el('div', {},
    el('div', { class: 'hero' },
      el('div', {},
        el('span', { class: 'eyebrow' }, 'Режим 3'),
        el('h1', {}, 'Слова из заданий'),
        el('p', {},
          'Незнакомые слова и фразы, выделенные в тексте вопросов. Перевод подбирается под смысл в задании, ',
          'а тренировка идёт лесенкой: выбрать русский перевод → выбрать английское слово → вписать его в предложение. ',
          'Во вкладке «Аббревиатуры» — все сокращения из банка вопросов.')),
      statsNode),
    el('div', {}, tabsNode, body)));

  renderAll();
  // Words may have been added in another tab or translated since the app opened.
  vocab.load().then(() => { session.card = null; renderAll(); });

  return () => document.removeEventListener('keydown', onKey);
}

/**
 * The next card: words that are due (never answered ones count as due),
 * those already met before new ones, the shakiest first. `force` serves the
 * soonest word even when nothing is due yet.
 */
function pickCard(lastKey, force) {
  const progress = store.getVocabProgress();
  const ready = vocab.entries().filter((w) => w.t);
  if (!ready.length) return { kind: 'none' };
  const now = Date.now();
  const due = force ? ready : ready.filter((w) => !progress[w.key] || progress[w.key].due <= now);
  if (!due.length) {
    return { kind: 'wait', due: Math.min(...ready.map((w) => progress[w.key].due)) };
  }
  const pool = due.length > 1 ? due.filter((w) => w.key !== lastKey) : due;
  const rank = (w) => {
    const p = progress[w.key];
    return p ? [0, p.box, p.due] : [1, 0, Date.parse(w.added) || 0];
  };
  pool.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
  const word = pool[0];
  if (!progress[word.key]) return { kind: 'intro', word };
  return exerciseFor(word, progress[word.key].box, ready);
}

/** The exercise for a word in box `box` — see the ladder at the top of the file. */
function exerciseFor(word, box, ready) {
  const kind = box === 0 ? 'quiz'
    : box === 1 ? 'quizEn'
      : box < store.VOCAB_LEARNED_BOX ? 'type'
        : pick(['quiz', 'quizEn', 'type']);
  // One of the word's example sentences, a different one each time.
  const sentence = word.t.cloze && word.t.cloze.length ? pick(word.t.cloze) : null;
  if (kind === 'quiz') return { kind, word, options: optionsFor(word, ready), picked: null };
  if (kind === 'quizEn') return { kind, word, sentence, options: optionsEnFor(word, ready), picked: null };
  return { kind, word, sentence, typed: '', result: null, hint: false };
}

function rightOption(card) {
  return card.kind === 'quiz' ? ruLabel(card.word.t.ru) : enLabel(card.word.phrase);
}

/**
 * English options all in lower case — a capital kept from where the word was
 * picked ("To encourage") would give the answer away. Acronyms stay as they are.
 */
function enLabel(text) {
  return String(text).split(' ').map((t) => (/^[A-Z0-9]{2,}s?$/.test(t) ? t : t.toLowerCase())).join(' ');
}

/** The English word and three wrong ones: its own look-alikes first, then other words. */
function optionsEnFor(word, ready) {
  const right = enLabel(word.phrase);
  const seen = new Set([right.toLowerCase()]);
  const wrong = [];
  const offer = (text) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const label = enLabel(text.trim());
    if (seen.has(label.toLowerCase()) || wrong.length >= 3) return;
    seen.add(label.toLowerCase());
    wrong.push(label);
  };
  (word.t.en_alts || []).forEach(offer);
  shuffled(ready.filter((w) => w.key !== word.key)).forEach((w) => offer(w.phrase));
  return shuffled([right, ...wrong]);
}

/** Lowercase, plain spaces, no leading article or "to": "To encourage" ≈ "encourage". */
function plain(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:a|an|the|to) /, '');
}

/** The forms that count as right: the word itself and the sentence's own form. */
function acceptedForms(card) {
  const forms = [card.word.key, card.word.phrase, ...((card.sentence && card.sentence.accept) || [])];
  return [...new Set(forms.map(plain).filter(Boolean))];
}

/** 'right', 'typo' (one letter off in a longer word), 'wrong', or null for nothing typed. */
function checkTyped(text, card) {
  const typed = plain(text);
  if (!typed) return null;
  const forms = acceptedForms(card);
  if (forms.includes(typed)) return 'right';
  if (typed.length >= 5 && forms.some((f) => f.length >= 5 && editDistance(typed, f) <= 1)) return 'typo';
  return 'wrong';
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The form the sentence wants, as it is written there: "incurred", "Procurement". */
function expectedForm(card) {
  const accept = card.sentence && card.sentence.accept;
  return accept && accept.length ? accept[0] : card.word.phrase.replace(/^(?:a|an|the|to) /i, '');
}

/** "p__________ · 11 букв"; every word of a phrase keeps its first letter. */
function hintText(card) {
  const answer = expectedForm(card);
  const mask = answer.split(' ').map((w) => w[0] + '_'.repeat(Math.max(0, w.length - 1))).join(' ');
  return `${mask} · ${plural(answer.replace(/\s/g, '').length, 'буква', 'буквы', 'букв')}`;
}

/** The right translation and three wrong ones: its own decoys first, then other words. */
function optionsFor(word, ready) {
  const right = ruLabel(word.t.ru);
  const seen = new Set([right.toLowerCase()]);
  const wrong = [];
  const offer = (text) => {
    if (typeof text !== 'string' || !text.trim()) return;
    const label = ruLabel(text);
    if (seen.has(label.toLowerCase()) || wrong.length >= 3) return;
    seen.add(label.toLowerCase());
    wrong.push(label);
  };
  (word.t.alts || []).forEach(offer);
  shuffled(ready.filter((w) => w.key !== word.key)).forEach((w) => offer(w.t.ru));
  return shuffled([right, ...wrong]);
}

/**
 * A Russian option without its glosses: the first variant, no "(…)", no
 * "— explanation". A full translation is longer than its decoys and would give
 * the answer away by length; it shows in full after answering.
 */
function ruLabel(text) {
  const bare = String(text).replace(/\s*\([^)]*\)/g, '').split(/\s+—\s+|[,;]\s*/)[0].trim();
  return bare || String(text).trim();
}

function status(word, progress) {
  if (!word.t) return 'pending';
  const p = progress[word.key];
  if (!p) return 'new';
  return p.box >= store.VOCAB_LEARNED_BOX ? 'learned' : 'learning';
}

/* ── Cards ────────────────────────────────────────────────────────────── */

function introCard(card, onDone) {
  const { word } = card;
  return el('section', { class: 'card wordcard' },
    el('div', { class: 'wordcard__head' },
      el('span', { class: 'eyebrow' }, 'Новое слово · запомните перевод'),
      el('span', { class: 'tag' }, 'EN → RU')),
    phraseLine(word),
    el('p', { class: 'wordcard__ru' }, word.t.ru),
    word.t.note ? el('p', { class: 'wordcard__note' }, word.t.note) : null,
    contexts(word, 2),
    englishExample(card),
    el('div', { class: 'wordcard__foot' },
      el('span', { class: 'muted', style: 'font-size:.8125rem;flex:1' }, 'Скоро спрошу его среди похожих вариантов.'),
      el('button', { class: 'btn', onclick: onDone }, 'Запомнил →', ...nextKeys())));
}

/** Both directions of the four-way choice: 'quiz' (EN → RU) and 'quizEn' (RU → EN). */
function quizCard(card, onPick, onNext) {
  const { word, options, picked } = card;
  const toEnglish = card.kind === 'quizEn';
  const correct = rightOption(card);
  const p = store.getVocabProgress()[word.key];
  const opts = ui.holdHover(el('div', { class: 'wordcard__opts' }));
  options.forEach((option, i) => {
    const state = !picked ? ''
      : option === correct ? ' is-correct'
        : option === picked ? ' is-wrong' : '';
    opts.append(el('button', {
      class: `wordopt${state}`,
      disabled: Boolean(picked),
      lang: toEnglish ? 'en' : null,
      onclick: () => onPick(option),
    }, el('kbd', {}, String(i + 1)), el('span', {}, option)));
  });

  const right = picked === correct;
  return el('section', { class: 'card wordcard' },
    el('div', { class: 'wordcard__head' },
      el('span', { class: 'eyebrow' }, toEnglish ? 'Выберите английское слово' : 'Выберите перевод'),
      el('span', { style: 'display:flex;gap:10px;align-items:center' },
        el('span', { class: 'tag' }, toEnglish ? 'RU → EN' : 'EN → RU'),
        levelDots(p ? p.box : 0))),
    // RU → EN asks with the Russian side only: the English would give it away.
    toEnglish ? russianPrompt(card) : phraseLine(word),
    toEnglish ? null : contexts(word, 1),
    // "Next" sits beside the options, so it stays put however long the note is.
    el('div', { class: 'wordcard__answer' },
      opts,
      picked
        ? el('button', { class: 'btn wordcard__next', onclick: onNext }, 'Дальше →', ...nextKeys())
        : null),
    picked
      ? el('div', {},
          el('div', { class: 'wordcard__foot' },
            el('span', { class: right ? 'tag tag--ok' : 'tag tag--stamp', style: 'font-size:.8125rem;padding:5px 12px' },
              right ? '✓ Верно' : `✕ Верно: ${correct}`),
            toEnglish ? vocab.speakButton(word.phrase, { title: 'Произношение (S)' }) : null),
          // The options are trimmed to one variant; the full translation shows here.
          toEnglish ? englishExample(card) : el('p', { class: 'wordcard__ru' }, word.t.ru),
          word.t.note ? el('p', { class: 'wordcard__note' }, word.t.note) : null)
      : el('p', { class: 'muted', style: 'margin:12px 0 0;font-size:.8125rem' },
          vocab.canSpeak() && !toEnglish ? 'Клавиши 1–4 тоже работают, S — произношение.' : 'Клавиши 1–4 тоже работают.'));
}

/** Type the English word for the underlined Russian one. */
function typeCard(card, { onSubmit, onHint, onNext }) {
  const { word, result } = card;
  const p = store.getVocabProgress()[word.key];
  const input = el('input', {
    type: 'text',
    class: `wordinput${result ? ` is-${result}` : ''}`,
    lang: 'en',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: card.hint ? hintText(card) : 'по-английски…',
    readonly: Boolean(result),
    'aria-label': 'Английское слово',
  });
  input.value = card.typed;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !result) { onSubmit(input.value); event.preventDefault(); }
  });
  const nextBtn = el('button', { class: 'btn wordcard__next', onclick: onNext }, 'Дальше →', ...nextKeys());
  // Focus once the card is on the page: the input to type, then "next".
  setTimeout(() => (result ? nextBtn : input).focus(), 0);

  const verdict = {
    right: ['tag tag--ok', '✓ Верно'],
    typo: ['tag tag--warn', `≈ Почти, опечатка: ${expectedForm(card)}`],
    wrong: ['tag tag--stamp', `✕ Правильно: ${expectedForm(card)}`],
  }[result];

  return el('section', { class: 'card wordcard' },
    el('div', { class: 'wordcard__head' },
      el('span', { class: 'eyebrow' }, 'Впишите английское слово'),
      el('span', { style: 'display:flex;gap:10px;align-items:center' },
        el('span', { class: 'tag' }, 'RU → EN ✎'),
        levelDots(p ? p.box : 0))),
    russianPrompt(card),
    el('div', { class: 'wordcard__answer wordcard__typing' },
      input,
      result ? nextBtn : el('button', { class: 'btn wordcard__next', onclick: () => onSubmit(input.value) }, 'Проверить', el('kbd', {}, 'Enter'))),
    result
      ? el('div', {},
          el('div', { class: 'wordcard__foot' },
            el('span', { class: verdict[0], style: 'font-size:.8125rem;padding:5px 12px', lang: 'en' }, verdict[1]),
            vocab.speakButton(expectedForm(card), { title: 'Произношение' })),
          englishExample(card),
          word.t.note ? el('p', { class: 'wordcard__note' }, word.t.note) : null)
      : el('div', { class: 'wordcard__foot' },
          card.hint ? null : el('button', { class: 'btn btn--ghost btn--sm', onclick: onHint }, 'Подсказка: первая буква'),
          el('button', { class: 'btn btn--ghost btn--sm', onclick: () => onSubmit('', true) }, 'Не помню'),
          el('span', { class: 'muted', style: 'font-size:.8125rem' }, 'Регистр и артикли не важны.')));
}

/** The Russian side to answer from: the example sentence with the word underlined, or the bare translation. */
function russianPrompt(card) {
  if (card.sentence) return el('p', { class: 'wordcard__prompt' }, ...cloze(card.sentence.ru, 'u'));
  return el('p', { class: 'wordcard__prompt' }, 'Как по-английски: ', el('u', {}, card.word.t.ru), '?');
}

/** The English example after answering, the word in bold, with a listen button. */
function englishExample(card) {
  const sentence = card.sentence || (card.word.t.cloze || [])[0];
  if (!sentence) return null;
  return el('div', { class: 'wordcard__example' },
    el('p', { lang: 'en' }, ...cloze(sentence.en, 'b')),
    vocab.speakButton(sentence.en.replace(/\*\*/g, ''), { small: true, title: 'Прослушать предложение' }));
}

/** "…**word**…" as text with the marked part in `tag` (u or b). */
function cloze(text, tag) {
  return String(text).split('**').map((part, i) => (i % 2 ? el(tag, { class: 'cloze' }, part) : part)).filter((x) => x !== '');
}

/** Both keys that move on: Enter and Space. */
function nextKeys() {
  return [el('kbd', {}, 'Enter'), el('kbd', {}, 'Пробел')];
}

function phraseLine(word) {
  return el('div', { class: 'wordcard__title' },
    el('h2', { class: 'wordcard__phrase', lang: 'en' }, word.phrase),
    vocab.speakButton(word.phrase, { title: 'Произношение (S)' }));
}

/** Where the word was met: the sentence with the word marked, and the question. */
function contexts(word, limit) {
  const list = el('div', { class: 'wordcard__ctx' });
  for (const c of word.contexts.slice(0, limit)) {
    const q = bank.question(c.qid);
    // A word picked outside a question carries its screen, e.g. "@docs/cheatsheet".
    const from = q ? null : vocab.sourceLabel(c.qid);
    list.append(el('div', { dataset: q ? { qid: q.id } : {} },
      el('p', { lang: 'en' }, ...vocab.withMark(c.text || '', word.key)),
      c.text ? vocab.speakButton(c.text, { small: true, title: 'Прослушать предложение' }) : null,
      q ? el('button', {
        class: 'linkbtn',
        title: 'Показать вопрос',
        onclick: () => showQuestion(q),
      }, bank.origin(q)) : null,
      from ? el('span', { class: 'muted mono', style: 'font-size:.75rem' }, `из раздела «${from}»`) : null));
  }
  return list;
}

function showQuestion(q) {
  const view = vocab.switchable(q, el('img', { class: 'qsheet__img', src: q.imgSrc, alt: '' }));
  ui.openModal(`Q${q.no} — ${bank.origin(q)}`, el('div', {},
    view.button ? el('div', { class: 'review__switch' }, view.button) : null,
    view.body));
}

function wordRow(word, progress, onChange) {
  const detail = el('div', { class: 'wordrow__detail', hidden: true });
  let built = false;
  const toggle = () => {
    if (!built) {
      built = true;
      // Native append() would print a null as the text "null".
      detail.append(
        word.t && word.t.note ? el('p', { class: 'wordcard__note' }, word.t.note) : '',
        contexts(word, 20),
        progress ? el('p', { class: 'muted', style: 'font-size:.7812rem;margin:8px 0 0' },
          `Верно ${progress.right}, неверно ${progress.wrong}.`) : '',
        el('div', { style: 'margin-top:10px;display:flex;gap:8px;align-items:center' },
          vocab.speakButton(word.phrase),
          el('button', {
            class: 'btn btn--ghost btn--sm',
            onclick: async () => {
              const ok = await ui.confirmAction({
                title: 'Удалить слово',
                message: `«${word.phrase}» пропадёт из словаря вместе с прогрессом заучивания.`,
              });
              if (!ok) return;
              try {
                await vocab.remove(word.key);
                store.forgetVocab(word.key);
                onChange();
              } catch (err) {
                console.warn('dictionary remove failed', err);
                vocab.toast('Не удалилось: словарь не отвечает', true);
              }
            },
          }, 'Удалить из словаря')));
    }
    detail.hidden = !detail.hidden;
  };
  return el('div', { class: 'wordrow' },
    el('button', { class: 'wordrow__main', onclick: toggle },
      el('b', { lang: 'en' }, word.phrase),
      word.t ? el('span', {}, word.t.ru) : el('span', { class: 'tag' }, 'ждёт перевода'),
      el('span', { class: 'muted mono', style: 'font-size:.75rem' },
        plural(word.contexts.length, 'пример', 'примера', 'примеров')),
      word.t ? levelDots(progress ? progress.box : 0) : el('span', {})),
    detail);
}

function levelDots(box) {
  const learned = box >= store.VOCAB_LEARNED_BOX;
  return el('span', {
    class: `dots${learned ? ' is-learned' : ''}`,
    title: learned ? 'Выучено' : `Уровень ${box} из ${LEVELS}`,
  }, ...Array.from({ length: LEVELS }, (_, i) => el('i', { class: i < box ? 'is-on' : '' })));
}

function pendingNote(count, onReload) {
  return el('div', { class: 'card', style: 'margin-top:16px;padding:14px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap' },
    el('p', { style: 'margin:0;flex:1;min-width:240px;font-size:.8438rem;color:var(--ink-2)' },
      `${plural(count, 'слово ждёт', 'слова ждут', 'слов ждут')} перевода. Напишите Claude в этом проекте `,
      el('b', {}, '«переведи слова»'),
      ' — он подберёт перевод под смысл в задании и неверные варианты для тренировки.'),
    el('button', {
      class: 'btn btn--ghost btn--sm',
      onclick: async () => { await vocab.load(); onReload(); },
    }, 'Обновить'));
}

function untilText(due) {
  const min = Math.max(1, Math.round((due - Date.now()) / 60000));
  if (min < 60) return `через ${plural(min, 'минуту', 'минуты', 'минут')}`;
  const h = Math.round(min / 60);
  if (h < 24) return `через ${plural(h, 'час', 'часа', 'часов')}`;
  return `через ${plural(Math.round(h / 24), 'день', 'дня', 'дней')}`;
}

function cell(value, label) {
  return el('div', {}, el('b', {}, value), el('span', {}, label));
}
