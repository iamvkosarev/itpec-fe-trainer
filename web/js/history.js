// History: saved attempts (per exam part) and the log of every question seen.

import { el, clear, hms, pct, plural, formatDate } from './util.js';
import * as bank from './bank.js';
import * as store from './store.js';
import * as ui from './ui.js';
import { grade } from './exam.js';

export function historyScreen(root, navigate, route) {
  const state = { tab: route.tab || 'attempts', part: route.part || 'A' };
  const body = el('div', {});

  const render = () => {
    clear(body).append(
      el('div', { class: 'chips', style: 'margin-bottom:18px' },
        ...Object.values(bank.PART_SPEC).map((p) => el('button', {
          class: `chip${state.part === p.id ? ' is-on' : ''}`,
          onclick: () => { state.part = p.id; render(); },
        }, p.name))),
      state.tab === 'attempts' ? attemptsPanel(state.part, navigate, render) : questionsPanel(state.part, render));
  };

  const tabs = el('div', { class: 'tabs' },
    ...[['attempts', 'Попытки экзаменов'], ['questions', 'Пройденные вопросы']]
      .map(([id, label]) => el('button', {
        class: state.tab === id ? 'is-on' : '',
        onclick: (e) => {
          state.tab = id;
          [...tabs.children].forEach((c) => c.classList.toggle('is-on', c === e.currentTarget));
          render();
        },
      }, label)));

  clear(root).append(el('div', {},
    el('div', { class: 'hero' },
      el('div', {},
        el('span', { class: 'eyebrow' }, 'Архив'),
        el('h1', {}, 'История подготовки'),
        el('p', {}, 'Попытки и статистика хранятся в этом браузере и разделены по частям экзамена.')),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onclick: async () => {
          const ok = await ui.confirmAction({
            title: 'Полный сброс?',
            message: 'Будут удалены все попытки обеих частей и вся статистика по вопросам. Отменить это нельзя.',
            confirmLabel: 'Удалить всё',
          });
          if (ok) { store.clearAttempts(); store.clearStats(); store.clearRunning(); render(); }
        },
      }, 'Полный сброс')),
    tabs, body));

  render();
}

/* ── Attempts ─────────────────────────────────────────────────────────── */

function attemptsPanel(part, navigate, refresh) {
  const attempts = store.attemptsFor(part);
  const panel = el('div', {});

  if (!attempts.length) {
    return el('div', {}, ui.emptyState(
      'По этой части ещё нет сохранённых попыток.',
      el('a', { class: 'btn', href: '#/exam', style: 'margin-top:14px' }, 'Пройти экзамен')));
  }

  const scores = attempts.map((a) => grade(a).score);
  const best = Math.max(...scores);
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);

  panel.append(
    el('div', { class: 'statstrip' },
      cell(String(attempts.length), 'попыток'),
      cell(`${best}%`, 'лучший результат'),
      cell(`${avg}%`, 'в среднем'),
      cell(String(scores.filter((s) => s >= bank.PASS_PCT).length), `сдано (≥${bank.PASS_PCT}%)`)),
    el('div', { class: 'section__head' },
      el('h2', {}, 'Попытки'),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onclick: async () => {
          const ok = await ui.confirmAction({
            title: `Очистить историю ${bank.PART_SPEC[part].name}?`,
            message: `Будут удалены все ${plural(attempts.length, 'попытка', 'попытки', 'попыток')} по этой части. Статистика по вопросам сохранится.`,
            confirmLabel: 'Очистить',
          });
          if (ok) { store.clearAttempts(part); refresh(); }
        },
      }, 'Очистить эту часть')));

  for (const attempt of attempts) {
    const result = grade(attempt);
    panel.append(el('div', { class: 'attempt' },
      el('span', { class: `attempt__score ${result.pass ? 'is-pass' : 'is-fail'}` }, `${result.score}%`),
      el('div', {},
        el('div', {}, `${attempt.sourceLabel} · ${plural(result.total, 'вопрос', 'вопроса', 'вопросов')}`),
        el('small', { class: 'muted' },
          `${formatDate(attempt.finishedAt)} · верно ${result.correct}, ошибок ${result.wrong}, пропущено ${result.skipped}`)),
      el('span', { class: 'tabular muted', title: 'Затраченное время' }, hms(attempt.durationSec)),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onclick: () => navigate(`#/results/${attempt.id}`),
      }, 'Разбор'),
      el('button', {
        class: 'icon-btn',
        title: 'Удалить эту попытку',
        'aria-label': 'Удалить попытку',
        onclick: async () => {
          const ok = await ui.confirmAction({
            title: 'Удалить попытку?',
            message: `${attempt.sourceLabel} от ${formatDate(attempt.finishedAt)}, результат ${result.score}%. Действие необратимо.`,
          });
          if (ok) { store.deleteAttempt(attempt.id); refresh(); }
        },
      }, '✕')));
  }

  return panel;
}

/* ── Seen questions ───────────────────────────────────────────────────── */

function questionsPanel(part, refresh) {
  const stats = store.getStats();
  const rows = Object.entries(stats)
    .map(([id, stat]) => ({ q: bank.question(id), stat }))
    .filter((row) => row.q && row.q.part === part)
    .sort((a, b) => b.stat.last - a.stat.last);

  if (!rows.length) {
    return ui.emptyState('По этой части ещё не решён ни один вопрос.',
      el('a', { class: 'btn', href: '#/practice', style: 'margin-top:14px' }, 'Начать практику'));
  }

  const seen = rows.length;
  // Coverage counts each question once, however many sessions reused it.
  const uniqueTotal = bank.uniqueQuestions(part).length;
  const uniqueSeen = bank.uniqueCovered(stats, part);
  const answered = rows.reduce((s, r) => s + r.stat.seen, 0);
  const correct = rows.reduce((s, r) => s + r.stat.correct, 0);
  // A question is "clean" only if it was actually answered correctly every
  // time; one that was skipped in an exam has been seen but never answered.
  const shaky = rows.filter((r) => r.stat.wrong > 0);
  const clean = rows.filter((r) => r.stat.wrong === 0 && r.stat.correct > 0);
  const untouched = rows.filter((r) => r.stat.wrong === 0 && r.stat.correct === 0);

  const filters = { mode: 'all' };
  const list = el('div', { class: 'reviewlist' });

  const rebuild = () => {
    clear(list);
    const visible = rows.filter((r) => {
      if (filters.mode === 'shaky') return r.stat.wrong > 0;
      if (filters.mode === 'clean') return r.stat.wrong === 0 && r.stat.correct > 0;
      if (filters.mode === 'skipped') return r.stat.wrong === 0 && r.stat.correct === 0;
      return true;
    });
    for (const { q, stat } of visible) {
      list.append(el('div', { class: 'review' },
        el('button', {
          class: 'review__row',
          onclick: () => ui.showQuestionInfo(q),
        },
          el('span', { class: `review__mark ${markTone(stat)}` }, markGlyph(stat)),
          el('span', { class: 'mono muted', style: 'flex:none;width:110px' }, bank.origin(q).split(' · ')[0] + ` Q${q.no}`),
          el('span', { class: 'review__title' }, q.text.replace(/^Q\s?\d+\.?\s*/i, '').split('\n')[0]),
          el('span', { class: 'tag' }, q.category),
          el('span', { class: 'tag mono' }, `${stat.correct}/${stat.seen}`))));
    }
  };

  const tabs = el('div', { class: 'chips' },
    ...[['all', `Все (${seen})`], ['shaky', `С ошибками (${shaky.length})`],
        ['clean', `Только верные (${clean.length})`],
        ['skipped', `Пропускал (${untouched.length})`]]
      .map(([mode, label]) => el('button', {
        class: `chip${filters.mode === mode ? ' is-on' : ''}`,
        onclick: (e) => {
          filters.mode = mode;
          [...tabs.children].forEach((c) => c.classList.toggle('is-on', c === e.currentTarget));
          rebuild();
        },
      }, label)));

  rebuild();

  return el('div', {},
    el('div', { class: 'statstrip' },
      cell(`${uniqueSeen} / ${uniqueTotal}`, 'уникальных охвачено'),
      cell(`${pct(uniqueSeen, uniqueTotal)}%`, 'банка пройдено'),
      cell(String(answered), 'ответов дано'),
      cell(`${pct(correct, answered)}%`, 'точность')),
    el('div', { class: 'section__head' },
      el('h2', {}, 'Пройденные вопросы'),
      el('div', { style: 'display:flex;gap:10px;align-items:center' },
        tabs,
        el('button', {
          class: 'btn btn--ghost btn--sm',
          onclick: async () => {
            const ok = await ui.confirmAction({
              title: `Сбросить статистику ${bank.PART_SPEC[part].name}?`,
              message: `Прогресс по ${plural(seen, 'вопросу', 'вопросам', 'вопросам')} этой части будет забыт. Попытки экзаменов сохранятся.`,
              confirmLabel: 'Сбросить',
            });
            if (ok) { store.clearStats(part); refresh(); }
          },
        }, 'Сбросить статистику'))),
    list);
}

function markTone(stat) {
  if (!stat.correct && !stat.wrong) return 'skip';
  if (!stat.wrong) return 'ok';
  return stat.correct ? 'skip' : 'no';
}

function markGlyph(stat) {
  if (!stat.correct && !stat.wrong) return '–';
  if (!stat.wrong) return '✓';
  return stat.correct ? '~' : '✕';
}

function cell(value, label) {
  return el('div', {}, el('b', {}, value), el('span', {}, label));
}
