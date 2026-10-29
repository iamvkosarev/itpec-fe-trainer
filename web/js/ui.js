// Shared pieces: the question sheet, the OMR bubble row, and the (i) panel.

import { el, clear, googleUrl, openExternal, pct, plural, formatDate } from './util.js';
import * as bank from './bank.js';
import * as store from './store.js';
import * as vocab from './vocab.js';

/* ── Modal ────────────────────────────────────────────────────────────── */

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

/** `wide` gives a question picture room to be read at full size. */
export function openModal(title, body, { wide = false } = {}) {
  modalTitle.textContent = title;
  clear(modalBody).append(body);
  modal.classList.toggle('modal--wide', wide);
  modal.hidden = false;
}

export function closeModal() {
  modal.hidden = true;
  clear(modalBody);
}

modal.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal();
});

/** Yes/no gate for anything destructive. Resolves to a boolean. */
export function confirmAction({ title, message, confirmLabel = 'Удалить', danger = true }) {
  return new Promise((resolve) => {
    const finish = (value) => { closeModal(); resolve(value); };
    const body = el('div', {},
      el('p', { text: message }),
      el('div', { style: 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px' },
        el('button', { class: 'btn btn--ghost', onclick: () => finish(false) }, 'Отмена'),
        el('button', {
          class: danger ? 'btn btn--danger' : 'btn',
          onclick: () => finish(true),
        }, confirmLabel)),
    );
    openModal(title, body);
    modal.querySelector('.modal__scrim').addEventListener('click', () => resolve(false), { once: true });
  });
}

/* ── Question sheet ───────────────────────────────────────────────────── */

/**
 * Renders one question. The body is the image cropped straight out of the
 * official PDF — diagrams, tables and fraction-set options survive intact,
 * which plain text extraction cannot promise. With `textToggle` a Subject A
 * question gets a "Текст" button in its header that swaps the picture for
 * the selectable text (words for the dictionary) and back; `textMode` is the
 * starting state and `onTextMode` hears every switch.
 */
export function questionSheet(q, {
  badge = null, showOrigin = false,
  textToggle = false, textMode = false, onTextMode = null,
} = {}) {
  const img = el('img', {
    class: 'qsheet__img',
    src: q.imgSrc,
    alt: `Вопрос ${q.no}`,
    loading: 'lazy',
    decoding: 'async',
    width: q.w || undefined,
    height: q.h || undefined,
  });
  const view = textToggle
    ? vocab.switchable(q, img, { text: textMode, onChange: onTextMode })
    : { body: img, button: null };

  const head = el('div', { class: 'qsheet__head' },
    el('span', { class: 'qsheet__code' },
      showOrigin ? bank.origin(q) : (badge || `Q${q.no}`)),
    el('span', { style: 'display:flex;gap:8px;align-items:center' },
      bank.siblings(q).length > 1
        ? el('span', { class: 'tag tag--stamp', title: 'Этот вопрос встречался и на других экзаменах' },
            `был ×${bank.siblings(q).length - 1}`)
        : null,
      el('span', { class: 'tag' }, q.category),
      view.button,
      infoButton(q)),
  );

  // data-qid: English picked anywhere in the sheet is filed under this question.
  return el('div', { class: 'qsheet', dataset: { qid: q.id } }, head, el('div', { class: 'qsheet__body' }, view.body));
}

export function infoButton(q) {
  return el('button', {
    class: 'icon-btn',
    title: 'Информация о вопросе',
    'aria-label': 'Информация о вопросе',
    onclick: () => showQuestionInfo(q),
  }, 'i');
}

export function lookupButton(q, label = 'Уточнить в интернете') {
  return el('button', {
    class: 'btn btn--ghost btn--sm',
    onclick: () => openExternal(googleUrl(q)),
    title: 'Открыть поиск Google по тексту вопроса в новой вкладке',
  }, '↗ ' + label);
}

/* ── OMR bubbles ──────────────────────────────────────────────────────── */

/**
 * The answer row. `state` is 'open' (pick freely) or 'revealed' (locked, with
 * the correct option marked). Options are letters only — the option text lives
 * in the question image above, exactly as on the real answer sheet.
 */
export function bubbleRow(q, { picked, state = 'open', onPick }) {
  const row = el('div', { class: 'bubbles' });
  q.options.forEach((letter, i) => {
    const classes = ['bubble'];
    if (state === 'revealed') {
      if (letter === q.answer) classes.push('is-correct');
      else if (letter === picked) classes.push('is-wrong');
    } else if (letter === picked) {
      classes.push('is-picked');
    }
    row.append(el('button', {
      class: classes.join(' '),
      disabled: state === 'revealed',
      dataset: { letter },
      onclick: () => onPick && onPick(letter),
    },
      el('span', { class: 'bubble__dot' }),
      el('span', { class: 'bubble__letter' }, `${letter})`),
      state === 'open' && i < 9 ? el('kbd', {}, String(i + 1)) : null,
    ));
  });
  return row;
}

/* ── (i) panel ────────────────────────────────────────────────────────── */

export function showQuestionInfo(q) {
  const stat = store.statFor(q.id);
  const list = el('dl', { class: 'deflist' },
    el('dt', {}, 'Экзамен'), el('dd', {}, `${q.session === 'October' ? 'Октябрь' : 'Апрель'} ${q.year}`),
    el('dt', {}, 'Часть'), el('dd', {}, bank.partLabel(q.part, q.year)),
    el('dt', {}, 'Номер'), el('dd', { class: 'mono' }, `Q${q.no}`),
    el('dt', {}, 'Область'), el('dd', {}, q.field),
    el('dt', {}, 'Категория'), el('dd', {}, q.category),
    el('dt', {}, 'Верный ответ'), el('dd', { class: 'mono' }, `${q.answer})`),
    el('dt', {}, 'Ваша статистика'), el('dd', {}, statLine(stat)),
  );

  const versions = bank.siblings(q);
  if (versions.length > 1) {
    list.append(
      el('dt', {}, 'По всем версиям'),
      el('dd', {}, statLine(store.statForAll(versions.map((v) => v.id)))));
  }
  const body = el('div', {}, list);

  if (versions.length > 1) {
    body.append(el('h3', { style: 'margin-top:20px' },
      `Тот же вопрос: ${plural(versions.length, 'появление', 'появления', 'появлений')}`));
    body.append(el('p', { class: 'muted', style: 'font-size:.8125rem;margin:4px 0 0' },
      'Найдено сравнением формулировки и вариантов ответа. Между годами вопрос перефразируют и перемешивают варианты, поэтому буква верного ответа может меняться — суть остаётся той же.'));
    const list2 = el('div', { class: 'repeatlist' });
    for (const other of versions) {
      list2.append(el('div', {},
        el('span', { class: `tag mono${other.id === q.id ? ' tag--stamp' : ''}` }, `${other.answer})`),
        other.id === q.id
          ? el('span', { style: 'font-size:.8438rem' }, `${bank.origin(other)} — этот`)
          : el('button', {
              class: 'btn btn--ghost btn--sm',
              onclick: () => showQuestionInfo(other),
            }, bank.origin(other))));
    }
    body.append(list2);
  }

  if (q.variants && q.variants.length) {
    body.append(el('h3', { style: 'margin-top:20px' }, 'Похожие, но другие'));
    body.append(el('p', { class: 'muted', style: 'font-size:.8125rem;margin:4px 0 0' },
      'Та же тема или те же варианты, но спрашивается другое и верный ответ другой. Именно на таких легко ошибиться по памяти.'));
    const list3 = el('div', { class: 'repeatlist' });
    for (const ref of q.variants) {
      const other = bank.question(ref.id);
      if (!other) continue;
      list3.append(el('div', {},
        el('span', { class: 'tag mono' }, `${other.answer})`),
        el('button', {
          class: 'btn btn--ghost btn--sm',
          onclick: () => showQuestionInfo(other),
        }, bank.origin(other))));
    }
    body.append(list3);
  }

  body.append(el('div', { style: 'display:flex;gap:10px;margin-top:22px;flex-wrap:wrap' },
    lookupButton(q),
    el('button', {
      class: 'btn btn--ghost btn--sm',
      onclick: () => openModal(`Q${q.no} — ${bank.origin(q)}`,
        el('img', { class: 'qsheet__img', src: q.imgSrc, alt: '' })),
    }, 'Показать вопрос')));

  openModal(`Справка · ${bank.origin(q)}`, body);
}

function statLine(stat) {
  return stat
    ? `${plural(stat.seen, 'показ', 'показа', 'показов')}, верно ${stat.correct} (${pct(stat.correct, stat.seen)}%)`
    : 'ещё не встречался';
}

/* ── Options under a still pointer ───────────────────────────────────── */

// Where the mouse last was, to tell a real move from the browser re-checking
// hover after the page changed under a pointer that never moved.
let pointer = null;
document.addEventListener('mousemove', (event) => { pointer = [event.clientX, event.clientY]; },
  { capture: true, passive: true });

/**
 * Answer options of a card that has just appeared. The pointer is still where
 * the last click left it, so the option under it would light up grey as if it
 * were a hint. Its hover highlight waits until the mouse really moves.
 */
export function holdHover(node) {
  const origin = pointer;
  node.classList.add('is-still');
  const onMove = (event) => {
    if (origin && Math.abs(event.clientX - origin[0]) + Math.abs(event.clientY - origin[1]) < 3) return;
    node.classList.remove('is-still');
    node.removeEventListener('mousemove', onMove);
  };
  node.addEventListener('mousemove', onMove);
  return node;
}

/* ── Misc ─────────────────────────────────────────────────────────────── */

export function emptyState(text, action) {
  return el('div', { class: 'emptystate' }, el('p', { text }), action || null);
}

export function scoreBar(correct, total) {
  const value = pct(correct, total);
  const tone = value >= 60 ? '' : value >= 40 ? 'is-mid' : 'is-weak';
  return el('span', { class: 'bar' }, el('i', { class: tone, style: `width:${value}%` }));
}

export { formatDate };
