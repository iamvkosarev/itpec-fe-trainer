// Endless practice: random question, answer, instant verdict, next. No timer.

import { el, clear, pick, pct, plural } from './util.js';
import * as bank from './bank.js';
import * as store from './store.js';
import * as ui from './ui.js';
import * as explain from './explain.js';

// Two independent filters: «Набор» says where questions come from (all, or the
// ones repeated between years), «Какие вопросы» which of them to serve (any,
// never met, missed).
// Filters look at every version of a question: answering the 2019 wording
// counts as having met the 2025 one.
const POOLS = [
  ['all', 'Все вопросы', () => true],
  ['repeats', 'Повторяющиеся между годами', (q) => Boolean(q.repeats)],
];

const met = (q, stats) => bank.siblings(q).some((s) => stats[s.id]);

// «Какие вопросы». In the URL as `only=unseen|wrong`; absent means any.
const STATUSES = [
  ['any', 'Все', () => true],
  ['unseen', 'Ещё не встречались', (q, stats) => !met(q, stats)],
  ['wrong', 'Где ошибался', (q, stats) => bank.siblings(q).some((s) => stats[s.id] && stats[s.id].wrong > 0)],
];

// Filters saved or linked before the split: «Набор» could itself be 'unseen'
// or 'wrong', or carry a `scope`.
const LEGACY_STATUS = { todo: 'any', unseen: 'unseen', wrong: 'wrong' };

export function practiceScreen(root, params = new URLSearchParams()) {
  const filters = initialFilters(params);
  const session = {
    shown: 0, correct: 0, streak: 0, bestStreak: 0, current: null, picked: null,
    // The current question is shown as selectable text instead of its picture.
    // Survives re-renders (answering, the translation toggle); a new question
    // starts as a picture again.
    textMode: false,
  };
  // Whether the Russian translation shows before answering. After answering
  // the full explanation always shows, so this only governs the unanswered state.
  let translate = Boolean(store.getSettings().translate);
  const toggleTranslate = () => {
    translate = !translate;
    store.saveSettings({ translate });
    renderStage();
  };

  const stage = el('div', {});
  const sidebar = el('aside', { class: 'card filters' });
  const counters = el('div', { style: 'display:flex;gap:22px;flex-wrap:wrap' });

  // Filters live in two places: the URL, so a reload or a bookmark reopens
  // exactly this view, and settings, so opening Practice from the menu (no
  // parameters) picks up where the last session left off.
  // «Осталось»: what the current filter still holds to get through. Under «Ещё
  // не встречались» the set itself shrinks as you answer, so the total is what
  // it held when the filter was chosen; persist() runs on every filter change.
  let baseline = null;
  const remaining = () => {
    const stats = store.getStats();
    const inPool = pool(stats);
    if (filters.status === 'unseen') {
      if (baseline === null || baseline < inPool.length) baseline = inPool.length;
      return { left: inPool.length, total: baseline, label: 'Осталось новых', what: 'ещё ни разу не встречались' };
    }
    return {
      left: inPool.filter((q) => !lastAnswerRight(q, stats)).length,
      total: inPool.length,
      label: filters.status === 'wrong' ? 'Осталось исправить' : 'Осталось решить',
      what: filters.status === 'wrong' ? 'были ошибки и последний ответ неверный' : 'ещё не решены верно',
    };
  };

  const persist = () => {
    baseline = null;
    store.saveSettings({
      practice: {
        part: filters.part, pool: filters.pool, categories: [...filters.categories],
        status: filters.status,
      },
    });
    // replaceState: no history entry per click, and no hashchange, so the
    // screen (and the session counters) are not rebuilt.
    const next = practiceHash(filters);
    if (window.location.hash !== next) history.replaceState(null, '', next);
  };

  // The questions the set, the categories and «Какие вопросы» leave; `status`
  // overrides the last one (for the counts on its chips).
  const pool = (stats = store.getStats(), status = filters.status) => {
    const test = POOLS.find((p) => p[0] === filters.pool)[2];
    const keep = STATUSES.find((s) => s[0] === status)[2];
    return bank.uniqueQuestions(filters.part).filter((q) =>
      (!filters.categories.size || filters.categories.has(q.category)) && test(q, stats, filters)
      && keep(q, stats));
  };

  const nextQuestion = () => {
    renderCounters(); // filters may have changed what «Осталось» counts
    const stats = store.getStats();
    const candidates = pool(stats);
    if (!candidates.length) {
      session.current = null;
      renderStage();
      return;
    }
    // Avoid repeating the question that is already on screen.
    let next = pick(candidates);
    if (candidates.length > 1 && session.current) {
      let guard = 0;
      while (next.id === session.current.id && guard++ < 8) next = pick(candidates);
    }
    session.current = next;
    session.picked = null;
    session.textMode = false;
    explain.prefetch(next);
    renderStage();
  };

  const answer = (letter) => {
    if (session.picked) return;
    session.picked = letter;
    const q = session.current;
    store.recordAnswer(q, letter, q.part);
    session.shown++;
    if (letter === q.answer) {
      session.correct++;
      session.streak++;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
    } else {
      session.streak = 0;
    }
    renderStage();
    renderCounters();
    renderSidebar(); // the counts on «Какие вопросы» moved
  };

  const renderCounters = () => {
    const left = remaining();
    const share = left.total ? Math.round(((left.total - left.left) / left.total) * 100) : 100;
    clear(counters).append(
      el('div', { title: `Вопросы под выбранными фильтрами, которые ${left.what}: ${left.left} из ${left.total}` },
        el('b', { style: 'display:block;font:600 1.375rem/1.1 var(--font-mono);font-variant-numeric:tabular-nums' },
          `${left.left} из ${left.total}`),
        el('span', { class: 'eyebrow' }, left.label),
        el('span', { class: 'progress', style: 'margin-top:7px;min-width:130px' },
          el('i', { style: `width:${share}%;background:var(--ok)` }))),
      counter('Решено', String(session.shown)),
      counter('Верно', `${session.correct} (${pct(session.correct, session.shown)}%)`),
      counter('Серия', String(session.streak)),
      counter('Лучшая серия', String(session.bestStreak)));
  };

  const renderStage = () => {
    const q = session.current;
    if (!q) {
      clear(stage).append(ui.emptyState(
        filters.status === 'unseen'
          ? 'В этом наборе не осталось вопросов, которые ещё не встречались: каждый уже решался хотя бы раз. Дальше — «Где ошибался» справа.'
          : filters.status === 'wrong'
            ? 'В этом наборе нет вопросов, где ты ошибался.'
            : 'Под выбранные фильтры не попал ни один вопрос. Ослабьте условия справа.'));
      return;
    }
    const revealed = Boolean(session.picked);
    const explained = explain.has(q);

    clear(stage).append(
      ui.questionSheet(q, {
        showOrigin: true,
        textToggle: true,
        textMode: session.textMode,
        onTextMode: (on) => { session.textMode = on; },
      }),
      // Native append() would print a null as the text "null".
      explained && (revealed || translate)
        ? explain.panel(q, { revealed, picked: session.picked })
        : '',
      el('div', {
        class: `qsheet qsheet--answers${revealed && explained ? ' is-explained' : ''}`,
        style: 'margin-top:14px',
      },
        el('div', { class: 'qsheet__foot' },
          ui.bubbleRow(q, {
            picked: session.picked,
            state: revealed ? 'revealed' : 'open',
            onPick: answer,
          }),
          revealed
            ? el('div', { style: 'margin-top:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
                el('span', {
                  class: session.picked === q.answer ? 'tag tag--ok' : 'tag tag--stamp',
                  style: 'font-size:.8125rem;padding:5px 12px',
                }, session.picked === q.answer ? '✓ Верно' : `✕ Неверно — правильный ${q.answer})`),
                ui.lookupButton(q),
                el('button', {
                  class: 'btn btn--ghost btn--sm',
                  onclick: () => ui.showQuestionInfo(q),
                }, 'ⓘ Где встречался'),
                el('span', { class: 'navrow__spacer', style: 'flex:1' }),
                el('button', { class: 'btn', onclick: nextQuestion }, 'Следующий →', el('kbd', {}, 'Enter'), el('kbd', {}, 'Пробел')))
            : el('div', { style: 'margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
                el('p', { class: 'muted', style: 'margin:0;font-size:.8125rem;flex:1;min-width:220px' },
                  'Выберите вариант — ответ покажется сразу. Клавиши 1–9 тоже работают.'),
                explained
                  ? el('button', {
                      class: `btn btn--ghost btn--sm${translate ? ' is-on' : ''}`,
                      title: 'Перевод вопроса и вариантов на русский (клавиша T)',
                      'aria-pressed': translate ? 'true' : 'false',
                      onclick: toggleTranslate,
                    }, translate ? 'Скрыть перевод' : 'Перевод', el('kbd', {}, 'T'))
                  : null))),
    );
  };

  // «Какие вопросы», with how many of each the set holds right now.
  const statusField = () => {
    const stats = store.getStats();
    return el('div', { class: 'field' },
      el('label', {}, 'Какие вопросы'),
      el('div', { class: 'chips' },
        ...STATUSES.map(([id, name]) => el('button', {
          class: `chip${filters.status === id ? ' is-on' : ''}`,
          onclick: () => { filters.status = id; persist(); renderSidebar(); nextQuestion(); },
        }, `${name} · ${pool(stats, id).length}`))));
  };

  const renderSidebar = () => {
    clear(sidebar).append(
      el('div', { class: 'field' },
        el('label', {}, 'Часть'),
        el('div', { class: 'chips' },
          ...Object.values(bank.PART_SPEC).map((p) => el('button', {
            class: `chip${filters.part === p.id ? ' is-on' : ''}`,
            onclick: () => {
              filters.part = p.id; filters.categories.clear();
              persist(); renderSidebar(); nextQuestion();
            },
          }, p.name)))),

      el('div', { class: 'field' },
        el('label', {}, 'Набор'),
        el('div', { class: 'chips' },
          ...POOLS.map(([id, label]) => el('button', {
            class: `chip${filters.pool === id ? ' is-on' : ''}`,
            onclick: () => { filters.pool = id; persist(); renderSidebar(); nextQuestion(); },
          }, label)))),

      statusField(),

      el('div', { class: 'field' },
        el('label', {}, 'Категории'),
        el('div', { class: 'chips' },
          ...bank.categories(filters.part).map(({ name, count }) => el('button', {
            class: `chip${filters.categories.has(name) ? ' is-on' : ''}`,
            title: `${count} вопросов`,
            onclick: () => {
              if (filters.categories.has(name)) filters.categories.delete(name);
              else filters.categories.add(name);
              persist(); renderSidebar(); nextQuestion();
            },
          }, name))),
        filters.categories.size
          ? el('button', {
              class: 'btn btn--ghost btn--sm', style: 'align-self:flex-start',
              onclick: () => { filters.categories.clear(); persist(); renderSidebar(); nextQuestion(); },
            }, 'Сбросить категории')
          : null),

      el('p', { class: 'muted', style: 'font-size:.7812rem;margin:0' },
        `В наборе ${plural(pool().length, 'уникальный вопрос', 'уникальных вопроса', 'уникальных вопросов')}. `,
        'Повторы с других экзаменов не показываются — вместо них берётся самая свежая формулировка.'),
    );
  };

  const onKey = (event) => {
    if (event.target.matches('input, select, textarea') || !document.getElementById('modal').hidden) return;
    const q = session.current;
    if (!q) return;
    if (!session.picked) {
      if (/^[tTеЕ]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && explain.has(q)) { toggleTranslate(); event.preventDefault(); return; }
      const digit = Number(event.key);
      if (digit >= 1 && digit <= q.options.length) { answer(q.options[digit - 1]); event.preventDefault(); }
    } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
      nextQuestion(); event.preventDefault();
    }
  };
  document.addEventListener('keydown', onKey);

  clear(root).append(el('div', {},
    el('div', { class: 'hero' },
      el('div', {},
        el('span', { class: 'eyebrow' }, 'Режим 2'),
        el('h1', {}, 'Практика без остановки'),
        el('p', {}, 'Случайные вопросы подряд, ответ показывается сразу после выбора. Прогресс учитывается в общей статистике.')),
      counters),
    el('div', { class: 'practice' }, stage, sidebar)));

  root.classList.add('screen--wide');
  persist();
  renderSidebar();
  renderCounters();
  nextQuestion();

  return () => { document.removeEventListener('keydown', onKey); root.classList.remove('screen--wide'); };
}

/**
 * URL parameters win when present — they describe a complete view, missing
 * ones fall back to defaults. Without any, the last saved filters are used.
 * Anything unrecognised (a stale category name, a typo) is dropped.
 */
function initialFilters(params) {
  const fromUrl = ['part', 'pool', 'cat', 'only'].some((key) => params.has(key));
  const saved = store.getSettings().practice || {};
  const source = fromUrl
    ? {
      part: params.get('part'), pool: params.get('pool'), categories: params.getAll('cat'),
      status: params.get('only'),
    }
    : saved;

  // Before the split «Ещё не встречались» and «Где ошибался» were sets of their
  // own (pool=unseen, pool=wrong) or a `scope`.
  let poolId = source.pool;
  let status = source.status || LEGACY_STATUS[source.scope] || 'any';
  if (poolId === 'unseen' || poolId === 'wrong') {
    if (status === 'any') status = poolId;
    poolId = 'all';
  }

  const part = bank.PART_SPEC[source.part] ? source.part : 'A';
  const pool = POOLS.some(([id]) => id === poolId) ? poolId : 'all';
  const known = new Set(bank.categories(part).map((c) => c.name));
  const categories = new Set((source.categories || []).filter((name) => known.has(name)));
  if (!STATUSES.some(([id]) => id === status)) status = 'any';
  return { part, pool, categories, status };
}

/** "#/practice?part=A&pool=all&only=wrong&cat=Network", "…pool=repeats&only=unseen" */
function practiceHash(filters) {
  const params = new URLSearchParams();
  params.set('part', filters.part);
  params.set('pool', filters.pool);
  if (filters.status !== 'any') params.set('only', filters.status);
  for (const name of [...filters.categories].sort()) params.append('cat', name);
  return `#/practice?${params}`;
}

/** Whether the most recent answer to any version of this question was right. */
export function lastAnswerRight(q, stats) {
  let latest = null;
  for (const version of bank.siblings(q)) {
    const entry = stats[version.id];
    if (entry && (!latest || (entry.last || 0) > (latest.entry.last || 0))) latest = { version, entry };
  }
  if (!latest) return false;
  const { version, entry } = latest;
  // An entry without lastPicked only knows its totals.
  return 'lastPicked' in entry
    ? entry.lastPicked === version.answer
    : entry.correct > 0 && entry.wrong === 0;
}

function counter(label, value) {
  return el('div', {},
    el('b', { style: 'display:block;font:600 1.375rem/1.1 var(--font-mono);font-variant-numeric:tabular-nums' }, value),
    el('span', { class: 'eyebrow' }, label));
}
