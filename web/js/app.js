// Router, home screen and app chrome.

import { el, clear, pct, plural, formatDate, hms } from './util.js';
import * as bank from './bank.js';
import * as store from './store.js';
import * as ui from './ui.js';
import { setupScreen, runScreen, resultsScreen, grade, runningSummary, resumeRunning } from './exam.js';
import { practiceScreen } from './practice.js';
import { historyScreen } from './history.js';
import { docsScreen } from './docs.js';
import { wordsScreen } from './words.js';
import * as explain from './explain.js';
import * as vocab from './vocab.js';

const screen = document.getElementById('screen');
let teardown = null;

/* ── Theme ────────────────────────────────────────────────────────────── */

const media = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const pref = store.getSettings().theme;
  const dark = pref === 'dark' || (pref === 'auto' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const btn = document.getElementById('themeToggle');
  btn.textContent = pref === 'auto' ? '◐' : pref === 'dark' ? '●' : '○';
  btn.title = `Тема: ${pref === 'auto' ? 'как в системе' : pref === 'dark' ? 'тёмная' : 'светлая'}`;
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(store.getSettings().theme) + 1) % order.length];
  store.saveSettings({ theme: next });
  applyTheme();
});
media.addEventListener('change', applyTheme);

/* ── Countdown ────────────────────────────────────────────────────────── */

// ITPEC holds FE twice a year, in April and October, on the same day in every
// member country. Dates as announced by ITPEC and its members (itpec.org,
// philnits.org); add the next ones here when they are published.
const EXAM_DATES = ['2026-04-26', '2026-10-25', '2027-04-25', '2027-10-17'];
const START = 'T09:30:00';
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const SEASONS = { 4: 'Апрель', 10: 'Октябрь' };

/** "2027-04-25" for a local date. */
function isoDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The sitting to count down to: a date picked on the home screen while it is
 * still ahead, else the next announced one. Past the announced list, the next
 * April or October is assumed to be on its fourth Sunday and marked `estimated`.
 */
function nextExam(now = new Date()) {
  const picked = store.getSettings().examDate;
  if (picked && new Date(`${picked}${START}`) > now) return { day: picked, picked: true };
  const known = EXAM_DATES.find((day) => new Date(`${day}${START}`) > now);
  if (known) return { day: known };
  for (let year = now.getFullYear(); ; year++) {
    for (const month of [3, 9]) {
      const first = new Date(year, month, 1);
      const sunday = new Date(year, month, 1 + ((7 - first.getDay()) % 7) + 21);
      if (new Date(`${isoDay(sunday)}${START}`) > now) return { day: isoDay(sunday), estimated: true };
    }
  }
}

function daysToExam() {
  const exam = nextExam();
  const target = new Date(`${exam.day}${START}`);
  const [year, month, day] = exam.day.split('-').map(Number);
  const label = exam.estimated
    ? `${SEASONS[month]} ${year} · дата ещё не объявлена`
    : `${day} ${MONTHS[month - 1]} ${year}${exam.picked ? ' · ваша дата' : ''}`;
  return { ...exam, days: Math.ceil((target - Date.now()) / 86400000), label };
}

function refreshCountdown() {
  const { days, estimated, picked, label } = daysToExam();
  const node = document.getElementById('brandCountdown');
  node.textContent = `${estimated ? '≈ ' : ''}${plural(days, 'день', 'дня', 'дней')} до экзамена`;
  node.title = `${picked ? 'Экзамен' : 'Ближайший экзамен ITPEC FE'}: ${label}`;
}

/* ── Home ─────────────────────────────────────────────────────────────── */

function homeScreen(root, navigate) {
  const stats = store.getStats();
  const attempts = store.getAttempts();
  const uniqueTotal = bank.uniqueQuestions().length;
  const uniqueSeen = bank.uniqueCovered(stats);
  const answered = Object.values(stats).reduce((s, v) => s + v.seen, 0);
  const correct = Object.values(stats).reduce((s, v) => s + v.correct, 0);
  const exam = daysToExam();
  const running = store.getRunning();

  const page = el('div', {},
    el('div', { class: 'hero' },
      el('div', {},
        el('span', { class: 'eyebrow' }, 'Fundamental IT Engineer Examination'),
        el('h1', {}, 'Банк из 1 840 официальных вопросов ITPEC'),
        el('p', {},
          `Subject A — ${bank.partQuestions('A').length} вопросов за 2015–2026, из них ${bank.uniqueQuestions('A').length} уникальных: остальное — те же вопросы, повторённые на других экзаменах. `,
          'Subject B — 100 задач за 2024–2026: в нынешнем виде эта часть существует только с апреля 2024. ',
          'Вопросы и ключи ответов взяты из официальных архивов itpec.org и отрисованы прямо из PDF — со всеми схемами, таблицами и дробями.')),
      el('div', { class: 'card', style: 'padding:16px 20px;text-align:right' },
        el('span', { class: 'eyebrow' }, 'дней до экзамена'),
        el('b', { style: 'display:block;font:600 2.125rem/1.1 var(--font-mono)' },
          `${exam.estimated ? '≈' : ''}${exam.days}`),
        el('small', { class: 'muted', style: 'display:block;font-size:.75rem' }, exam.label),
        el('input', {
          type: 'date',
          value: exam.picked ? exam.day : '',
          style: 'margin-top:8px;font-size:.75rem',
          title: 'Своя дата экзамена. Пусто — ближайший экзамен ITPEC; прошедшая дата сменится следующей сама.',
          onchange: (e) => {
            store.saveSettings({ examDate: e.target.value || null });
            refreshCountdown();
            navigate('#/', true);
          },
        }))),

    el('div', { class: 'statstrip' },
      cell(`${bank.partQuestions('A').length} + ${bank.partQuestions('B').length}`, 'вопросов: A + B'),
      cell(`${uniqueSeen} · ${pct(uniqueSeen, uniqueTotal)}%`, `охвачено из ${uniqueTotal} уникальных`),
      cell(answered ? `${pct(correct, answered)}%` : '—', 'точность'),
      cell(String(attempts.length), 'попыток экзамена')),

    running ? runningCard(running, navigate) : null,

    el('div', { class: 'modes' },
      mode('#/exam', 'Режим 1', 'Экзамен на время',
        'Реальный вариант прошлых лет или случайная подборка. Обратный отсчёт, лист ответов, досрочное завершение и полный разбор по категориям.'),
      mode('#/practice', 'Режим 2', 'Практика без остановки',
        'Случайные вопросы подряд с мгновенным показом ответа. Фильтры по частям, категориям, ошибкам и вопросам, повторявшимся между экзаменами.'),
      mode('#/history', 'Архив', 'История и статистика',
        'Все попытки и все пройденные вопросы, раздельно по Subject A и Subject B. Удаление по одной попытке или очистка целиком.')),

    recentSection(attempts, navigate),

    el('section', { class: 'section' },
      el('div', { class: 'card', style: 'padding:18px 20px' },
        el('span', { class: 'eyebrow' }, 'О данных'),
        el('p', { style: 'margin:8px 0 0;font-size:.8438rem;color:var(--ink-2)' },
          'Формат с апреля 2024: Subject A — 60 вопросов за 90 минут, Subject B — 20 задач за 100 минут; проходной балл 60% по каждой части. ',
          'В банк включены и утренние варианты 2015–2023 (по 80 вопросов) — программа та же, материал полезен. ',
          'Категории проставлены автоматически по тексту вопроса: в официальных PDF этой разметки нет, так что отдельные вопросы могут попасть в соседнюю категорию.'),
        el('p', { style: 'margin:8px 0 0;font-size:.8438rem;color:var(--ink-2)' },
          'Вопросы прошлых экзаменов © ITPEC (Information Technology Professionals Examination Council), ',
          el('a', { href: 'https://itpec.org/pastexamqa/fe.html', target: '_blank', rel: 'noopener' }, 'itpec.org'),
          '. Используются в учебных целях по условиям ITPEC; у каждого вопроса указан источник — экзамен, часть и номер. ',
          'Переводы, разборы и пересказы в шпаргалке — изменённые версии, их сделал автор проекта; верным считается официальный ключ. ',
          'Проект неофициальный и с ITPEC не связан.'))),
  );

  clear(root).append(page);
}

function runningCard(running, navigate) {
  const { leftSec, answered, total, paused } = runningSummary(running);
  return el('div', {
    class: 'card',
    style: 'padding:16px 20px;margin-bottom:18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap',
  },
    el('div', { style: 'flex:1;min-width:200px' },
      el('span', { class: 'eyebrow' }, paused ? 'Незавершённый экзамен · на паузе' : 'Экзамен идёт'),
      el('div', {},
        `${bank.PART_SPEC[running.part].name} · ${running.sourceLabel} · отвечено ${answered} из ${total} · `,
        el('span', { class: 'tabular' }, leftSec > 0 ? `осталось ${hms(leftSec)}` : 'время вышло'))),
    el('button', {
      class: 'btn',
      onclick: () => { resumeRunning(); navigate('#/exam/run'); },
    }, paused ? 'Продолжить экзамен' : 'Вернуться к экзамену'));
}

function mode(href, eyebrow, title, text) {
  return el('a', { class: 'mode', href },
    el('span', { class: 'eyebrow' }, eyebrow),
    el('h3', {}, title),
    el('p', {}, text));
}

function cell(value, label) {
  return el('div', {}, el('b', {}, value), el('span', {}, label));
}

function recentSection(attempts, navigate) {
  if (!attempts.length) return null;
  const rows = attempts.slice(0, 4).map((attempt) => {
    const result = grade(attempt);
    return el('div', { class: 'attempt' },
      el('span', { class: `attempt__score ${result.pass ? 'is-pass' : 'is-fail'}` }, `${result.score}%`),
      el('div', {},
        el('div', {}, `${bank.PART_SPEC[attempt.part].name} · ${attempt.sourceLabel}`),
        el('small', { class: 'muted' }, formatDate(attempt.finishedAt))),
      el('span', { class: 'tabular muted' }, hms(attempt.durationSec)),
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => navigate(`#/results/${attempt.id}`) }, 'Разбор'),
      el('span', {}));
  });
  return el('section', { class: 'section' },
    el('div', { class: 'section__head' },
      el('h2', {}, 'Последние попытки'),
      el('a', { href: '#/history', style: 'font-size:.8438rem;color:var(--ink-3)' }, 'вся история →')),
    ...rows);
}

/* ── Sticky chrome ────────────────────────────────────────────────────── */

// Screens pin their own bars (exam bar, filters, the cheat sheet's section
// nav) right under the sticky top bar, whose height grows when the nav wraps
// onto a second row in a narrow window.
const topbar = document.querySelector('.topbar');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
}).observe(topbar);

// "Back to top" on long screens. Not on the question-by-question screens:
// there the answer row is pinned to the bottom of the window.
const toTop = document.getElementById('toTop');
let toTopAllowed = true;

function refreshToTop() {
  toTop.hidden = !toTopAllowed || window.scrollY < 600;
}

window.addEventListener('scroll', refreshToTop, { passive: true });
toTop.addEventListener('click', () => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  toTop.blur();
});

/* ── Router ───────────────────────────────────────────────────────────── */

function navigate(hash, replace = false) {
  if (replace) history.replaceState(null, '', hash);
  else window.location.hash = hash;
  if (replace) route();
}

function route() {
  if (teardown) { teardown(); teardown = null; }
  ui.closeModal();
  screen.classList.remove('screen--wide');
  window.scrollTo(0, 0);

  const hash = window.location.hash || '#/';
  // A screen may keep its state in a query after the path: "#/practice?part=B".
  const [path, query = ''] = hash.replace(/^#\//, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);

  for (const link of document.querySelectorAll('.topnav a')) {
    const target = link.getAttribute('href').replace(/^#\//, '').split('/')[0];
    link.classList.toggle('is-active', (parts[0] || '') === target);
  }

  if (parts[0] === 'exam' && parts[1] === 'run') teardown = runScreen(screen, navigate);
  else if (parts[0] === 'exam') setupScreen(screen, navigate);
  else if (parts[0] === 'practice') teardown = practiceScreen(screen, params);
  else if (parts[0] === 'history') historyScreen(screen, navigate, {});
  else if (parts[0] === 'words') teardown = wordsScreen(screen, params);
  else if (parts[0] === 'docs') teardown = docsScreen(screen, navigate, parts[1], params);
  else if (parts[0] === 'results') resultsScreen(screen, navigate, parts[1]);
  else homeScreen(screen, navigate);

  toTopAllowed = parts[0] !== 'practice' && !(parts[0] === 'exam' && parts[1] === 'run');
  refreshToTop();
  refreshCountdown();
}

window.addEventListener('hashchange', route);

/* ── Boot ─────────────────────────────────────────────────────────────── */

applyTheme();

// Select English text anywhere to hear it or put it in the dictionary.
vocab.enableGlobalPicking();

Promise.all([bank.load(), explain.loadIndex(), vocab.load()]).then(() => {
  route();
}).catch((err) => {
  console.error(err);
  clear(screen).append(el('div', { class: 'emptystate' },
    el('h2', {}, 'Не удалось загрузить банк вопросов'),
    el('p', { style: 'margin-top:10px' },
      'Страница должна открываться через локальный веб-сервер, а не как файл. Запустите ./start.sh в папке проекта.'),
    el('p', { class: 'mono muted', style: 'font-size:.75rem' }, String(err))));
});
