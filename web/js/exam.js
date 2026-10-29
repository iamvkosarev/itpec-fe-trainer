// Timed exam simulator: setup, the running paper, and the results report.

import { el, clear, hms, minSec, humanDuration, shuffled, pct, plural, formatDate } from './util.js';
import * as bank from './bank.js';
import * as store from './store.js';
import * as ui from './ui.js';
import * as explain from './explain.js';
import * as report from './report.js';
import * as vocab from './vocab.js';

/* ── Setup ────────────────────────────────────────────────────────────── */

export function setupScreen(root, navigate) {
  const running = normalizeRunning(store.getRunning());
  const state = { part: 'A', source: 'paper', examId: null, minutes: null, count: null };

  const form = el('div', { class: 'card', style: 'padding:24px;display:flex;flex-direction:column;gap:22px' });

  const render = () => {
    clear(form);
    const spec = bank.PART_SPEC[state.part];
    const papers = bank.exams(state.part);
    if (!state.examId || !papers.some((p) => p.examId === state.examId)) {
      state.examId = papers[0] ? papers[0].examId : null;
    }
    const minutes = state.minutes ?? spec.minutes;
    const count = state.count ?? spec.count;
    const records = paperRecords(state.part);
    const unfinishedOf = (examId) => Boolean(running && running.sourceType === 'paper' && running.examId === examId);

    form.append(
      el('div', { class: 'field' },
        el('label', {}, 'Часть экзамена'),
        el('div', { class: 'chips' },
          ...Object.values(bank.PART_SPEC).map((p) =>
            el('button', {
              class: `chip${state.part === p.id ? ' is-on' : ''}`,
              onclick: () => { state.part = p.id; state.minutes = null; state.count = null; render(); },
            }, `${p.name} · ${p.count} вопр. / ${p.minutes} мин`))),
        el('p', { class: 'muted', style: 'font-size:.8125rem;margin:2px 0 0' }, spec.note)),

      el('div', { class: 'field' },
        el('label', {}, 'Из чего собрать вариант'),
        el('div', { class: 'chips' },
          el('button', {
            class: `chip${state.source === 'paper' ? ' is-on' : ''}`,
            onclick: () => { state.source = 'paper'; render(); },
          }, 'Реальный экзамен целиком'),
          el('button', {
            class: `chip${state.source === 'mix' ? ' is-on' : ''}`,
            onclick: () => { state.source = 'mix'; render(); },
          }, 'Случайная подборка из всех лет')),
        state.source === 'mix'
          ? el('p', { class: 'muted', style: 'font-size:.8125rem;margin:2px 0 0' },
              `Без дублей: из ${bank.partQuestions(state.part).length} вопросов уникальных ${bank.uniqueQuestions(state.part).length}.`)
          : null),

      state.source === 'paper'
        ? el('div', { class: 'field' },
            el('label', {}, 'Экзамен'),
            el('select', {
              class: 'examselect',
              onchange: (e) => { state.examId = e.target.value; render(); },
            }, ...papers.map((p) => paperOption(p, p.examId === state.examId,
              records.get(p.examId), unfinishedOf(p.examId)))),
            paperStatus(records.get(state.examId), unfinishedOf(state.examId)),
            el('p', { class: 'muted', style: 'font-size:.8125rem;margin:2px 0 0' },
              state.part === 'A' && papers.length
                ? 'До апреля 2024 в утренней части было 80 вопросов — такой вариант тоже можно решить целиком.'
                : ''))
        : el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px' },
            el('div', { class: 'field' },
              el('label', {}, 'Сколько вопросов'),
              el('input', {
                type: 'number', min: 5, max: 120, step: 5, value: count,
                onchange: (e) => { state.count = Math.max(5, Math.min(120, Number(e.target.value) || spec.count)); },
              })),
            el('div', { class: 'field' },
              el('label', {}, 'Лимит времени, минут'),
              el('input', {
                type: 'number', min: 5, max: 300, step: 5, value: minutes,
                onchange: (e) => { state.minutes = Math.max(5, Math.min(300, Number(e.target.value) || spec.minutes)); },
              }))),

      el('div', { style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
        el('button', {
          class: 'btn btn--lg',
          onclick: () => startSession(buildSession(state), navigate),
        }, 'Начать экзамен'),
        el('span', { class: 'muted', style: 'font-size:.8125rem;max-width:52ch' },
          'Таймер идёт, пока открыт экзамен, и встаёт на паузу кнопкой или клавишей P. '
          + 'Ответы и время сохраняются в браузере — незавершённую попытку можно продолжить в другой день.')),
    );
  };

  render();

  const page = el('div', {},
    el('div', { class: 'hero' },
      el('div', {},
        el('span', { class: 'eyebrow' }, 'Режим 1'),
        el('h1', {}, 'Экзамен на время'),
        el('p', {}, 'Полный прогон части экзамена с обратным отсчётом, листом ответов и разбором по категориям в конце.'))),
    running ? resumeCard(running, navigate) : null,
    form);

  clear(root).append(page);
}

/**
 * Finished attempts at each real paper of a part: how many, the best score and
 * the latest one. Random mixes are not a paper, so they are left out.
 */
function paperRecords(part) {
  const records = new Map();
  for (const attempt of store.attemptsFor(part)) {
    if (attempt.sourceType !== 'paper' || !attempt.examId) continue;
    const score = grade(attempt).score;
    const rec = records.get(attempt.examId) || { count: 0, best: 0, lastAt: 0 };
    rec.count += 1;
    rec.best = Math.max(rec.best, score);
    if (attempt.finishedAt > rec.lastAt) Object.assign(rec, { lastAt: attempt.finishedAt, lastId: attempt.id, lastScore: score });
    records.set(attempt.examId, rec);
  }
  return records;
}

/**
 * A paper in the list, marked if it was already taken. The words carry the
 * mark everywhere; the colour of the mark shows only where the browser lets a
 * list be styled (see .examselect in app.css).
 */
function paperOption(p, selected, rec, unfinished) {
  const tone = rec ? (rec.best >= bank.PASS_PCT ? 'pass' : 'fail') : unfinished ? 'run' : 'new';
  const notes = [];
  if (rec) notes.push(rec.count > 1 ? `пройден ${rec.count}×, лучший ${rec.best}%` : `пройден, ${rec.best}%`);
  if (unfinished) notes.push('не завершён');
  return el('option', { value: p.examId, selected, class: `examopt is-${tone}` },
    el('span', { class: 'examopt__mark', 'aria-hidden': 'true' }, rec ? '✓ ' : unfinished ? '▸ ' : ''),
    el('span', {}, `${p.session === 'October' ? 'Октябрь' : 'Апрель'} ${p.year} — ${p.count} вопросов`),
    notes.length ? el('span', { class: 'examopt__note' }, ` · ${notes.join(' · ')}`) : null);
}

function paperStatus(rec, unfinished) {
  if (!rec) {
    return el('p', { class: 'examstatus muted' },
      unfinished ? 'Этот вариант начат и не завершён — продолжить можно в карточке выше.' : 'Этот вариант ещё не решали.');
  }
  const pass = rec.best >= bank.PASS_PCT;
  return el('p', { class: 'examstatus' },
    el('span', { class: `examstatus__mark is-${pass ? 'pass' : 'fail'}`, 'aria-hidden': 'true' }, '✓'),
    `Пройден ${plural(rec.count, 'раз', 'раза', 'раз')} · лучший результат ${rec.best}%`
      + (pass ? '' : ` (ниже проходных ${bank.PASS_PCT}%)`)
      + ` · последний — ${rec.lastScore}%, ${formatDate(rec.lastAt)} · `,
    el('a', { href: `#/results/${rec.lastId}` }, 'разбор'),
    unfinished ? ' · есть незавершённая попытка' : '');
}

function resumeCard(session, navigate) {
  const spec = bank.PART_SPEC[session.part];
  const { leftSec, answered, total, paused } = runningSummary(session);
  return el('div', {
    class: 'card',
    style: 'padding:18px 20px;margin-bottom:18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap',
  },
    el('div', { style: 'flex:1;min-width:200px' },
      el('span', { class: 'eyebrow' }, paused ? 'Незавершённая попытка · на паузе' : 'Незавершённая попытка'),
      el('div', { style: 'margin-top:4px' },
        `${spec.name} · ${session.sourceLabel} · отвечено ${answered} из ${total} · `,
        el('span', { class: 'tabular' }, leftSec > 0 ? `осталось ${hms(leftSec)}` : 'время вышло'))),
    el('button', { class: 'btn', onclick: () => { resumeRunning(); navigate('#/exam/run'); } }, 'Продолжить'),
    el('button', {
      class: 'btn btn--ghost',
      onclick: async () => {
        const ok = await ui.confirmAction({
          title: 'Сбросить попытку?',
          message: 'Незавершённая попытка будет удалена без сохранения результата.',
          confirmLabel: 'Сбросить',
        });
        if (ok) { store.clearRunning(); navigate('#/exam'); }
      },
    }, 'Сбросить'));
}

function buildSession(state) {
  const spec = bank.PART_SPEC[state.part];
  let qids;
  let sourceLabel;
  let minutes = state.minutes ?? spec.minutes;

  if (state.source === 'paper') {
    const meta = bank.examMeta(state.examId);
    if (!meta) return null;
    qids = bank.partQuestions(state.part)
      .filter((q) => q.examId === state.examId)
      .sort((a, b) => a.no - b.no)
      .map((q) => q.id);
    sourceLabel = `${meta.session === 'October' ? 'Октябрь' : 'Апрель'} ${meta.year}`;
    // Pre-2024 morning papers ran 80 questions in 150 minutes.
    if (state.minutes == null) minutes = qids.length > 60 ? 150 : spec.minutes;
  } else {
    const count = state.count ?? spec.count;
    // One version per question, so a mix never asks the same thing twice.
    qids = shuffled(bank.uniqueQuestions(state.part)).slice(0, count).map((q) => q.id);
    sourceLabel = 'Случайная подборка';
  }
  if (!qids.length) return null;

  return newSession({
    part: state.part,
    sourceType: state.source,
    examId: state.source === 'paper' ? state.examId : null,
    sourceLabel,
    qids,
    minutes,
  });
}

/**
 * A fresh attempt over the given questions, in the given order. Also used by
 * the cheat sheet's own test (sourceType "topics"), which picks its questions.
 */
export function newSession({ part, sourceType, examId = null, sourceLabel, qids, minutes }) {
  return {
    id: `att_${Date.now().toString(36)}`,
    part,
    sourceType,
    examId,
    sourceLabel,
    qids,
    answers: {},
    flagged: [],
    cursor: 0,
    startedAt: Date.now(),
    limitSec: minutes * 60,
    // The exam clock; see "Exam clock" below.
    elapsedMs: 0,
    timeMs: {},
    paused: false,
    checkpointAt: Date.now(),
  };
}

/** Opens the runner on a new session. Starting over replaces the unfinished attempt, answers and all. */
export async function startSession(session, navigate) {
  if (!session) return;
  const unfinished = store.getRunning();
  if (unfinished) {
    const ok = await ui.confirmAction({
      title: 'Начать новую попытку?',
      message: `Незавершённая попытка «${unfinished.sourceLabel}» будет удалена вместе с ответами и временем. `
        + 'Чтобы сохранить её результат, сначала продолжите и завершите её.',
      confirmLabel: 'Начать новую',
    });
    if (!ok) return;
  }
  store.saveRunning(session);
  navigate('#/exam/run');
}

/* ── Exam clock ───────────────────────────────────────────────────────── */
// Exam time runs only while the paper is on screen and not paused. A session
// stores the time counted up to its last save (`elapsedMs`, split per question
// in `timeMs`) and when that save was (`checkpointAt`); the stretch since then
// lives in the open runner and is folded in on every save, a few seconds apart.
// A session that claims to be running but has not been saved for a while was
// cut off — tab or browser closed, server stopped — and comes back paused at
// its last save rather than charging the time spent away.

const SAVE_EVERY_MS = 5000;
const STALE_MS = 15000;
// A gap this long between clock ticks means the computer slept. Hidden tabs
// still tick about once a minute under Chrome's heaviest throttling.
const SLEEP_GAP_MS = 120000;
const PING_EVERY_MS = 15000;

const PAUSE_REASONS = {
  manual: 'Время остановлено, вопрос скрыт до продолжения.',
  left: 'Вы ушли с экрана экзамена — время остановлено.',
  cut: 'Экзамен прервался: закрылась вкладка или браузер, либо остановился сервер. Время остановлено на последнем сохранении.',
  server: 'Сервер не отвечает — время остановлено. Запустите ./start.sh и нажмите «Продолжить».',
  sleep: 'Компьютер уходил в сон — это время не засчитано.',
};

/**
 * Brings a stored session up to the current shape. Sessions started before the
 * clock could pause counted wall time since the start, and did not time
 * questions, so they get no `timeMs` and their reports show no timing.
 */
export function normalizeRunning(session) {
  if (session && session.elapsedMs == null) {
    session.elapsedMs = Math.min(Math.max(0, Date.now() - session.startedAt), session.limitSec * 1000);
    session.checkpointAt = Date.now();
    session.paused = false;
  }
  return session;
}

/** Marks the stored session as running again, for "continue" buttons outside the runner. */
export function resumeRunning() {
  const session = normalizeRunning(store.getRunning());
  if (!session) return;
  session.paused = false;
  delete session.pauseReason;
  delete session.pausedAt;
  session.checkpointAt = Date.now();
  store.saveRunning(session);
}

/** What the "unfinished attempt" cards show, as of the last save. */
export function runningSummary(session) {
  normalizeRunning(session);
  return {
    leftSec: session.limitSec - session.elapsedMs / 1000,
    answered: Object.keys(session.answers).length,
    total: session.qids.length,
    paused: Boolean(session.paused) || Date.now() - session.checkpointAt > STALE_MS,
  };
}

/** Any answer at all means the server is up; only a network failure or a hang does not. */
async function serverAlive() {
  try {
    await fetch('index.html', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return true;
  } catch (err) {
    return false;
  }
}

/* ── Runner ───────────────────────────────────────────────────────────── */

export function runScreen(root, navigate) {
  const session = normalizeRunning(store.getRunning());
  if (!session) { navigate('#/exam'); return; }

  const questions = bank.questions(session.qids);
  let ticker = null;
  let pinger = null;
  let done = false;
  let pinging = false;
  let resuming = false;
  // Start of the stretch not yet folded into the session; null while paused.
  let segStart = null;
  let lastTick = Date.now();

  if (!session.paused && Date.now() - session.checkpointAt > STALE_MS) {
    Object.assign(session, { paused: true, pauseReason: 'cut', pausedAt: session.checkpointAt });
    store.saveRunning(session);
  }
  if (!session.paused) segStart = Date.now();

  const clockEl = el('span', { class: 'clock tabular' }, '—');
  const progressEl = el('span', { class: 'progress' }, el('i', { style: 'width:0%' }));
  const answeredEl = el('span', { class: 'eyebrow' }, '');
  const sheetCells = el('div', { class: 'sheetgrid__cells' });
  const stage = el('div', {});
  const body = el('div', {});
  const pauseBtn = el('button', {
    class: 'btn btn--ghost btn--sm',
    onclick: () => (session.paused ? resume() : pause('manual')),
  });

  // Even pace: the whole limit spread over the questions (90 s in Subject A).
  const paceSec = session.limitSec / session.qids.length;
  const qtimeLabel = el('span', { class: 'eyebrow' });
  const qtimeValue = el('b', { class: 'qtime__value' }, '—');
  const qtimeMeter = el('span', { class: 'qtime__meter' }, el('i', {}));
  // Sessions started before questions were timed have nothing to show here.
  const qtime = session.timeMs ? el('div', {
    class: 'qtime',
    title: 'Сколько этот вопрос на экране, вместе с прошлыми заходами на него. '
      + `Полоска заполняется к ровному темпу — ${minSec(paceSec)} на вопрос; дальше время выделяется цветом.`,
  }, qtimeLabel, qtimeValue, qtimeMeter) : null;

  /** Charges the time since the last fold to the exam and to the question on screen. */
  const fold = (until = Date.now()) => {
    if (segStart === null) return;
    const room = session.limitSec * 1000 - session.elapsedMs;
    const delta = Math.max(0, Math.min(until - segStart, room));
    session.elapsedMs += delta;
    if (session.timeMs) {
      const qid = session.qids[session.cursor];
      session.timeMs[qid] = (session.timeMs[qid] || 0) + delta;
    }
    segStart = Math.max(segStart, until);
  };

  const persist = () => {
    fold();
    session.checkpointAt = Date.now();
    store.saveRunning(session);
  };

  // The open stretch, never negative should the system clock be set back.
  const openMs = () => (segStart === null ? 0 : Math.max(0, Date.now() - segStart));

  const elapsedMs = () => Math.min(session.elapsedMs + openMs(), session.limitSec * 1000);

  /** Seconds on question `i` so far, the stretch not yet folded in included. */
  const questionSec = (i) => ((session.timeMs[session.qids[i]] || 0) + (i === session.cursor ? openMs() : 0)) / 1000;

  const showQuestionTime = () => {
    if (!qtime) return;
    const sec = questionSec(session.cursor);
    const long = sec > 2 * paceSec;
    qtimeValue.textContent = minSec(sec);
    qtimeMeter.firstChild.style.width = `${Math.min(sec / paceSec, 1) * 100}%`;
    qtimeLabel.textContent = long ? 'больше 2× темпа · F — отметить и дальше' : `на вопросе · темп ${minSec(paceSec)}`;
    qtime.classList.toggle('is-over', sec > paceSec && !long);
    qtime.classList.toggle('is-long', long);
    const cell = sheetCells.children[session.cursor];
    if (cell) cell.classList.toggle('is-slow', sec > paceSec);
  };

  const stopTimers = () => {
    clearInterval(ticker);
    clearInterval(pinger);
    ticker = null;
    pinger = null;
  };

  const finish = async (early) => {
    if (early) {
      const unanswered = session.qids.length - Object.keys(session.answers).length;
      const ok = await ui.confirmAction({
        title: 'Завершить экзамен?',
        message: unanswered
          ? `Без ответа ${plural(unanswered, 'вопрос', 'вопроса', 'вопросов')}. Они будут засчитаны как неверные.`
          : 'Все вопросы отвечены. Показать результат?',
        confirmLabel: 'Завершить',
        danger: false,
      });
      if (!ok) return;
    }
    if (done) return;
    done = true;
    stopTimers();
    fold();
    const attempt = finalize(session, early);
    navigate(`#/results/${attempt.id}`);
  };

  /** Stops the clock at `at` (earlier than now when the time since was not exam time). */
  const pause = (reason, at = Date.now(), { quiet = false } = {}) => {
    if (session.paused || done) return;
    fold(at);
    segStart = null;
    Object.assign(session, { paused: true, pauseReason: reason, pausedAt: at });
    persist();
    if (!quiet) render();
  };

  const resume = async () => {
    if (!session.paused || resuming || done) return;
    resuming = true;
    const alive = await serverAlive();
    resuming = false;
    if (!alive) {
      // Without the server the question images cannot load; keep waiting.
      session.pauseReason = 'server';
      persist();
      render();
      return;
    }
    session.paused = false;
    delete session.pauseReason;
    delete session.pausedAt;
    segStart = Date.now();
    lastTick = segStart;
    persist();
    render();
  };

  /** A stopped server pauses the exam, so its downtime is not charged. */
  const ping = async () => {
    if (session.paused || pinging || done) return;
    pinging = true;
    const alive = await serverAlive();
    pinging = false;
    if (!alive) pause('server');
  };

  const tick = () => {
    const now = Date.now();
    if (!session.paused && now - lastTick > SLEEP_GAP_MS) pause('sleep', lastTick);
    lastTick = now;
    const left = session.limitSec - elapsedMs() / 1000;
    clockEl.textContent = left > 0 ? hms(left) : '0:00';
    clockEl.classList.toggle('is-low', left <= 300);
    clockEl.classList.toggle('is-paused', Boolean(session.paused));
    showQuestionTime();
    if (session.paused || done) return;
    if (left <= 0) { finish(false); return; }
    if (now - session.checkpointAt >= SAVE_EVERY_MS) persist();
  };

  const goTo = (i) => {
    if (i < 0 || i >= session.qids.length || i === session.cursor) return;
    fold(); // the time so far belongs to the question being left
    session.cursor = i;
    persist(); refreshSheet(); renderStage();
  };

  const toggleFlag = (q) => {
    const i = session.flagged.indexOf(q.id);
    if (i >= 0) session.flagged.splice(i, 1); else session.flagged.push(q.id);
    persist(); refreshSheet(); renderStage();
  };

  const refreshSheet = () => {
    clear(sheetCells);
    session.qids.forEach((qid, i) => {
      const classes = ['cell'];
      if (session.answers[qid]) classes.push('is-answered');
      if (i === session.cursor) classes.push('is-current');
      if (session.flagged.includes(qid)) classes.push('is-flagged');
      const sec = session.timeMs ? questionSec(i) : null;
      if (sec > paceSec) classes.push('is-slow');
      sheetCells.append(el('button', {
        class: classes.join(' '),
        title: sec === null ? `Вопрос ${i + 1}` : `Вопрос ${i + 1} · ${minSec(sec)}`,
        onclick: () => goTo(i),
      }, i + 1));
    });
    showQuestionTime();
    const answered = Object.keys(session.answers).length;
    progressEl.firstChild.style.width = `${pct(answered, session.qids.length)}%`;
    answeredEl.textContent = `отвечено ${answered} / ${session.qids.length}`;
  };

  const renderStage = () => {
    const q = questions[session.cursor];
    if (!q) return;
    const flagged = session.flagged.includes(q.id);

    clear(stage).append(
      ui.questionSheet(q, { badge: `Вопрос ${session.cursor + 1} из ${session.qids.length}` }),
      el('div', { class: 'qsheet qsheet--answers', style: 'margin-top:14px' },
        el('div', { class: 'qsheet__foot' },
          ui.bubbleRow(q, {
            picked: session.answers[q.id],
            state: 'open',
            onPick: (letter) => {
              if (session.answers[q.id] === letter) delete session.answers[q.id];
              else session.answers[q.id] = letter;
              persist();
              refreshSheet();
              renderStage();
            },
          }))),
      el('div', { class: 'navrow' },
        el('button', {
          class: 'btn btn--ghost', disabled: session.cursor === 0,
          onclick: () => goTo(session.cursor - 1),
        }, '← Назад'),
        el('button', {
          class: `btn btn--ghost${flagged ? ' is-on' : ''}`,
          style: flagged ? 'border-color:var(--warn);color:var(--warn)' : '',
          onclick: () => toggleFlag(q),
        }, flagged ? '⚑ Снять отметку' : '⚐ Отметить'),
        el('span', { class: 'navrow__spacer' }),
        el('button', {
          class: 'btn', disabled: session.cursor === session.qids.length - 1,
          onclick: () => goTo(session.cursor + 1),
        }, 'Далее →')),
    );
    // A question image that fails to load is the first sign of a stopped server.
    const img = stage.querySelector('.qsheet__img');
    if (img) img.addEventListener('error', ping, { once: true });
  };

  const runner = el('div', { class: 'runner' },
    stage,
    el('aside', { class: 'sheetgrid' },
      el('h3', {}, 'Лист ответов'),
      sheetCells,
      el('div', { class: 'sheetgrid__legend' },
        el('span', {}, '1–9 — выбрать вариант'),
        el('span', {}, '← → — переход между вопросами'),
        el('span', {}, 'F — отметить для возврата'),
        el('span', {}, 'P — пауза'),
        session.timeMs ? el('span', { class: 'sheetgrid__slow' }, `черта — дольше темпа ${minSec(paceSec)}`) : null)));

  const pausePanel = () => {
    const elapsed = session.elapsedMs / 1000;
    return el('div', { class: 'card pausecard' },
      el('span', { class: 'eyebrow' }, 'Пауза'),
      el('h2', {}, 'Экзамен остановлен'),
      el('p', { class: 'pausecard__why' },
        PAUSE_REASONS[session.pauseReason] || PAUSE_REASONS.manual,
        session.pausedAt ? ` На паузе с ${formatDate(session.pausedAt)}.` : ''),
      el('div', { class: 'scoregrid pausecard__stats' },
        stat('Прошло', hms(elapsed)),
        stat('Осталось', hms(session.limitSec - elapsed)),
        stat('Отвечено', `${Object.keys(session.answers).length} / ${session.qids.length}`),
        stat('Отмечено', String(session.flagged.length))),
      el('button', { class: 'btn btn--lg', onclick: resume }, 'Продолжить', el('kbd', {}, 'P')),
      el('p', { class: 'muted pausecard__note' },
        'Ответы и время сохранены в этом браузере. Можно закрыть вкладку или остановить сервер: '
        + 'попытка останется в разделе «Экзамен», и отсчёт продолжится с этого места.'));
  };

  const render = () => {
    pauseBtn.replaceChildren(session.paused ? 'Продолжить' : 'Пауза', ' ', el('kbd', {}, 'P'));
    pauseBtn.classList.toggle('is-on', Boolean(session.paused));
    clear(body).append(session.paused ? pausePanel() : runner);
    if (!session.paused) { refreshSheet(); renderStage(); }
    tick();
  };

  const onKey = (event) => {
    if (event.target.matches('input, select, textarea') || !document.getElementById('modal').hidden) return;
    // By key position, so it works on the Russian layout too; Cmd+P stays print.
    if (event.code === 'KeyP' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (session.paused) resume(); else pause('manual');
      return;
    }
    if (session.paused) return;
    const q = questions[session.cursor];
    if (!q) return;
    const digit = Number(event.key);
    if (digit >= 1 && digit <= q.options.length) {
      session.answers[q.id] = q.options[digit - 1];
      persist(); refreshSheet(); renderStage();
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      goTo(session.cursor + 1);
    } else if (event.key === 'ArrowLeft') {
      goTo(session.cursor - 1);
    } else if (event.key.toLowerCase() === 'f') {
      toggleFlag(q);
    }
  };
  // Closing the tab or switching away saves the clock, so little is lost if
  // the page never comes back.
  const onHide = () => { if (!session.paused && !done) persist(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden') onHide(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);

  const page = el('div', {},
    el('div', { class: 'exambar' },
      clockEl,
      el('div', { class: 'exambar__meta' },
        el('span', { class: 'eyebrow' }, `${bank.PART_SPEC[session.part].name} · ${session.sourceLabel}`),
        answeredEl),
      qtime,
      el('span', { class: 'exambar__spacer' }),
      progressEl,
      pauseBtn,
      el('button', { class: 'btn btn--ghost btn--sm', onclick: () => finish(true) }, 'Завершить досрочно')),
    body,
  );

  clear(root).append(page);
  root.classList.add('screen--wide');
  refreshSheet();
  render();
  ticker = setInterval(tick, 250);
  pinger = setInterval(ping, PING_EVERY_MS);

  return () => {
    // Leaving the exam screen stops the clock until the exam is reopened.
    if (!done) pause('left', Date.now(), { quiet: true });
    stopTimers();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onHide);
    root.classList.remove('screen--wide');
  };
}

function finalize(session, early) {
  const finishedAt = Date.now();
  const elapsed = Math.min(session.elapsedMs / 1000, session.limitSec);
  const attempt = {
    id: session.id,
    mode: 'exam',
    part: session.part,
    sourceType: session.sourceType,
    examId: session.examId,
    sourceLabel: session.sourceLabel,
    qids: session.qids,
    answers: session.answers,
    flagged: session.flagged,
    startedAt: session.startedAt,
    finishedAt,
    durationSec: Math.round(elapsed),
    limitSec: session.limitSec,
    finishedEarly: Boolean(early),
  };
  if (session.timeMs) {
    // Milliseconds each question was on screen; together they make up the duration.
    attempt.timeMs = Object.fromEntries(
      Object.entries(session.timeMs).map(([id, ms]) => [id, Math.round(ms)]));
  }
  for (const q of bank.questions(session.qids)) {
    store.recordAnswer(q, session.answers[q.id] || null, session.part);
  }
  store.saveAttempt(attempt);
  store.clearRunning();
  return attempt;
}

/* ── Results ──────────────────────────────────────────────────────────── */

export function grade(attempt) {
  const questions = bank.questions(attempt.qids);
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  const byCategory = new Map();
  const byField = new Map();

  for (const q of questions) {
    const picked = attempt.answers[q.id];
    const isCorrect = picked === q.answer;
    if (!picked) skipped++;
    else if (isCorrect) correct++;
    else wrong++;

    for (const [map, key] of [[byCategory, q.category], [byField, q.field]]) {
      const row = map.get(key) || { name: key, total: 0, correct: 0 };
      row.total++;
      if (isCorrect) row.correct++;
      map.set(key, row);
    }
  }

  const total = questions.length;
  const score = pct(correct, total);
  return {
    questions, correct, wrong, skipped, total, score,
    pass: score >= bank.PASS_PCT,
    byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
    byField: [...byField.values()].sort((a, b) => b.total - a.total),
  };
}

export function resultsScreen(root, navigate, attemptId) {
  const attempt = store.getAttempt(attemptId);
  if (!attempt) {
    clear(root).append(ui.emptyState('Попытка не найдена — возможно, она была удалена.',
      el('a', { class: 'btn', href: '#/history' }, 'К истории')));
    return;
  }
  const result = grade(attempt);
  const spec = bank.PART_SPEC[attempt.part];
  // Attempts saved before questions were timed have no timing to show.
  const timing = report.timing(attempt, result);
  const review = reviewSection(attempt, result, timing);

  const verdict = el('div', { class: 'card verdict' },
    el('div', { class: 'verdict__stamp' },
      el('div', { class: `stamp${result.pass ? ' is-pass' : ''}` },
        el('b', {}, result.pass ? 'PASS' : 'FAIL'),
        el('em', {}, `${result.score}%`)),
      el('span', { class: 'eyebrow' }, `проходной балл ${bank.PASS_PCT}%`)),
    el('div', { class: 'scoregrid' },
      stat('Верно', `${result.correct} / ${result.total}`),
      stat('Ошибок', String(result.wrong)),
      stat('Без ответа', String(result.skipped)),
      stat('Затрачено', hms(attempt.durationSec)),
      stat('Лимит', humanDuration(attempt.limitSec)),
      stat('В среднем', `${Math.round(attempt.durationSec / result.total)} с/вопрос`)));

  const meta = el('p', { class: 'muted', style: 'font-size:.8438rem' },
    `${spec.name} · ${attempt.sourceLabel} · ${formatDate(attempt.finishedAt)}`,
    attempt.finishedEarly ? ' · завершено досрочно' : '',
    attempt.durationSec >= attempt.limitSec ? ' · время истекло' : '');

  const page = el('div', {},
    el('div', { class: 'hero' },
      el('div', {}, el('span', { class: 'eyebrow' }, 'Результат'), el('h1', {}, 'Разбор попытки'), meta),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        el('button', { class: 'btn btn--ghost', onclick: () => report.downloadCsv(attempt, result) }, 'Скачать CSV'),
        pdfButton(attempt, result),
        el('a', { class: 'btn btn--ghost', href: '#/history' }, 'История'),
        el('a', { class: 'btn', href: '#/exam' }, 'Ещё попытка'))),
    verdict,
    timing ? timeSection(timing, review.open) : null,
    breakdown('По областям', result.byField),
    breakdown('По категориям', result.byCategory),
    review.node);

  clear(root).append(page);
}

/** Building the PDF takes a few seconds (images, fonts), so the button says so. */
function pdfButton(attempt, result) {
  const label = 'Скачать PDF';
  const button = el('button', {
    class: 'btn btn--ghost',
    title: 'Все вопросы с ответами и разбором; закладки для навигации',
    onclick: async () => {
      button.disabled = true;
      button.textContent = 'Готовлю PDF…';
      try {
        await report.downloadPdf(attempt, result);
        button.textContent = label;
      } catch (err) {
        console.error('PDF export failed', err);
        button.textContent = 'PDF не получился — ещё раз';
      } finally {
        button.disabled = false;
      }
    },
  }, label);
  return button;
}

function stat(label, value) {
  return el('div', {}, el('b', {}, value), el('span', {}, label));
}

function breakdown(title, rows) {
  const table = el('table', { class: 'bartable' },
    el('thead', {}, el('tr', {},
      el('th', {}, title), el('th', {}, 'Верно'), el('th', { style: 'width:34%' }, ''), el('th', {}, '%'))),
    el('tbody', {}, ...rows.map((row) => el('tr', {},
      el('td', {}, row.name),
      el('td', { class: 'tabular' }, `${row.correct} / ${row.total}`),
      el('td', {}, ui.scoreBar(row.correct, row.total)),
      el('td', { class: 'tabular' }, `${pct(row.correct, row.total)}%`)))));
  return el('section', { class: 'section' },
    el('div', { class: 'card', style: 'padding:6px 10px' }, table));
}

/**
 * Seconds on each question as columns in paper order, coloured by outcome,
 * against the even pace (time limit / questions). A column opens its question.
 */
function timeSection(timing, openQuestion) {
  const { rows, paceSec, slowest } = timing;
  const { top, ticks } = report.secondTicks(Math.max(slowest.sec, paceSec));
  const at = (sec) => `${(Math.min(sec, top) / top) * 100}%`;
  // Values sit on the columns while they fit side by side (Subject B's 20);
  // a 60–80 question paper labels only its five slowest, the rest is in the tooltip.
  const labelled = new Set((rows.length <= 24 ? rows : rows.slice().sort((a, b) => b.sec - a.sec).slice(0, 5))
    .filter((r) => r.sec >= 1).map((r) => r.n));
  const xStep = rows.length > 30 ? 5 : 1;

  const tip = el('div', { class: 'tchart__tip', hidden: true });
  const chart = el('div', { class: 'tchart' });
  const showTip = (r, col) => {
    tip.replaceChildren(
      el('b', {}, `${Math.round(r.sec)} с`),
      el('span', {}, `Вопрос ${r.n} · ${r.opened ? minSec(r.sec) : 'не открывался'}`),
      el('span', {}, `${r.o.label} · ${r.q.category}`));
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    const bar = col.firstChild.getBoundingClientRect();
    const half = tip.offsetWidth / 2 + 4;
    const x = Math.min(Math.max(bar.left + bar.width / 2 - box.left, half), box.width - half);
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.min(bar.top, col.getBoundingClientRect().bottom - 4) - box.top - 8}px`;
  };
  const hideTip = () => { tip.hidden = true; };

  const cols = rows.map((r) => {
    const col = el('button', {
      class: 'tchart__col',
      type: 'button',
      'aria-label': `Вопрос ${r.n}: ${Math.round(r.sec)} с, ${r.o.label}`,
      onclick: () => openQuestion(r.n),
      onpointerenter: () => showTip(r, col),
      onpointerleave: hideTip,
      onfocus: () => showTip(r, col),
      onblur: hideTip,
    },
      el('i', { class: `tchart__bar is-${r.o.key}${r.sec > 0 ? ' has-time' : ''}`, style: `height:${at(r.sec)}` }),
      labelled.has(r.n) ? el('span', { class: 'tchart__val', style: `bottom:${at(r.sec)}` }, String(Math.round(r.sec))) : null);
    return col;
  });

  chart.append(
    el('div', { class: 'tchart__scroll' },
      el('div', { class: 'tchart__inner', style: `min-width:${rows.length * 9 + 48}px` },
        el('div', { class: 'tchart__plot' },
          ...ticks.map((v) => el('div', { class: 'tchart__grid', style: `bottom:${at(v)}` }, el('span', {}, `${v} с`))),
          el('div', { class: 'tchart__pace', style: `bottom:${at(paceSec)}` }, el('span', {}, `темп ${Math.round(paceSec)} с`)),
          el('div', { class: 'tchart__cols' }, ...cols)),
        el('div', { class: 'tchart__x', 'aria-hidden': 'true' },
          ...rows.map((r) => el('span', {}, r.n === 1 || r.n % xStep === 0 ? String(r.n) : ''))))),
    tip);

  const count = (key) => rows.filter((r) => r.o.key === key).length;
  const legend = el('div', { class: 'tchart__legend' },
    ...[['ok', '✓ верно'], ['no', '✕ неверно'], ['skip', '– без ответа']]
      .filter(([key]) => count(key))
      .map(([key, label]) => el('span', {}, el('i', { class: `tchart__key is-${key}` }), `${label} · ${count(key)}`)),
    el('span', {}, el('i', { class: 'tchart__key is-pace' }),
      `темп — лимит ÷ число вопросов, ${Math.round(paceSec)} с`));

  return el('section', { class: 'section' },
    el('div', { class: 'section__head' },
      el('h2', {}, 'Время по вопросам'),
      el('span', { class: 'muted', style: 'font-size:.8125rem' }, 'секунды на экране · столбец открывает вопрос')),
    el('div', { class: 'card', style: 'padding:16px 20px 14px' },
      el('div', { class: 'scoregrid', style: 'margin-bottom:18px' },
        stat('Медиана', `${Math.round(timing.median)} с`),
        stat('Дольше всего', `${Math.round(slowest.sec)} с · №${slowest.n}`),
        stat(`Дольше темпа ${Math.round(paceSec)} с`, `${timing.over} из ${rows.length}`)),
      chart,
      legend));
}

function reviewSection(attempt, result, timing) {
  const list = el('div', { class: 'reviewlist' });
  const filters = { mode: 'all', sort: 'paper' };
  let shown = new Map(); // position -> row on screen

  const rebuild = () => {
    clear(list);
    shown = new Map();
    const rows = result.questions.map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => {
      const picked = attempt.answers[q.id];
      if (filters.mode === 'wrong') return picked && picked !== q.answer;
      if (filters.mode === 'skipped') return !picked;
      if (filters.mode === 'correct') return picked === q.answer;
      return true;
    });
    if (filters.sort === 'time') rows.sort((a, b) => timing.rows[b.n - 1].sec - timing.rows[a.n - 1].sec);
    if (!rows.length) { list.append(ui.emptyState('Ничего не подходит под фильтр.')); return; }
    for (const { q, n } of rows) {
      const row = reviewRow(q, attempt, n, timing);
      shown.set(n, row);
      list.append(row.node);
    }
  };

  const chipGroup = (options, key) => {
    const group = el('div', { class: 'chips' },
      ...options.map(([value, label]) => el('button', {
        class: `chip${filters[key] === value ? ' is-on' : ''}`,
        dataset: { value },
        onclick: () => { filters[key] = value; mark(group, value); rebuild(); },
      }, label)));
    return group;
  };
  const mark = (group, value) => {
    [...group.children].forEach((c) => c.classList.toggle('is-on', c.dataset.value === value));
  };

  const tabs = chipGroup([['all', 'Все'], ['wrong', `Ошибки (${result.wrong})`],
    ['skipped', `Без ответа (${result.skipped})`], ['correct', `Верные (${result.correct})`]], 'mode');
  const sorts = timing ? chipGroup([['paper', 'По порядку'], ['time', 'Сначала долгие']], 'sort') : null;

  /** Expands question `n` and scrolls to it, clearing a filter that hides it. */
  const open = (n) => {
    if (!shown.has(n)) { filters.mode = 'all'; mark(tabs, 'all'); rebuild(); }
    const row = shown.get(n);
    row.expand();
    row.node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  rebuild();
  const node = el('section', { class: 'section' },
    el('div', { class: 'section__head' },
      el('h2', {}, 'Вопросы'),
      el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end' }, tabs, sorts)),
    list);
  return { node, open };
}

function reviewRow(q, attempt, position, timing) {
  const picked = attempt.answers[q.id];
  const isCorrect = picked === q.answer;
  const markClass = !picked ? 'skip' : isCorrect ? 'ok' : 'no';
  const time = timing ? timing.rows[position - 1] : null;
  // data-qid: English picked anywhere in the expanded question is filed under it.
  const detail = el('div', { class: 'review__detail', hidden: true, dataset: { qid: q.id } });
  let built = false;

  const build = () => {
    built = true;
    // Subject A can be flipped to its text to pick words for the dictionary.
    const view = vocab.switchable(q, el('img', { class: 'qsheet__img', src: q.imgSrc, alt: '', loading: 'lazy' }));
    // Native append() would print a null as the text "null".
    detail.append(
      view.button ? el('div', { class: 'review__switch' }, view.button) : '',
      view.body,
      el('div', { style: 'margin-top:14px' },
        ui.bubbleRow(q, { picked, state: 'revealed' })),
      el('p', { class: 'muted', style: 'margin-top:12px;font-size:.8438rem' },
        picked
          ? `Ваш ответ: ${picked}) · верный: ${q.answer})`
          : `Вопрос пропущен · верный ответ: ${q.answer})`,
        time ? ` · на вопросе ${time.opened ? minSec(time.sec) : '— не открывался'}` : ''),
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        ui.lookupButton(q),
        el('button', { class: 'btn btn--ghost btn--sm', onclick: () => ui.showQuestionInfo(q) },
          'ⓘ Где встречался')),
      explain.has(q) ? explain.panel(q, { revealed: true, picked }) : '');
  };
  const toggle = (show = detail.hidden) => {
    if (show && !built) build();
    detail.hidden = !show;
  };

  const row = el('button', { class: 'review__row', onclick: () => toggle() },
    el('span', { class: `review__mark ${markClass}` }, !picked ? '–' : isCorrect ? '✓' : '✕'),
    el('span', { class: 'mono muted', style: 'flex:none;width:34px' }, String(position)),
    el('span', { class: 'review__title' }, q.text.replace(/^Q\s?\d+\.?\s*/i, '').split('\n')[0]),
    q.repeats ? el('span', { class: 'tag tag--stamp' }, 'повтор') : null,
    explain.has(q) ? el('span', { class: 'tag', title: 'Есть перевод и разбор' }, 'RU') : null,
    el('span', { class: 'tag' }, q.category),
    time ? el('span', {
      class: `tag mono review__time${time.sec > timing.paceSec ? ' is-slow' : ''}`,
      title: time.sec > timing.paceSec
        ? `Время на вопросе — дольше темпа ${Math.round(timing.paceSec)} с`
        : 'Время на вопросе',
    }, time.opened ? minSec(time.sec) : 'не открыт') : null);

  return { node: el('div', { class: 'review' }, row, detail), expand: () => toggle(true) };
}
