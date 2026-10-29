// Questions behind each block of the cheat sheet (data/topics.json, written by
// tools/topics.py) and how well they are known. The grade only reads the
// per-question stats; nothing here is stored.

import * as bank from './bank.js';
import * as store from './store.js';

let data = null;

/** Never rejects: without the file the sheet just has no grades and no test. */
export async function load() {
  if (data) return data;
  try {
    const res = await fetch('data/topics.json', { cache: 'no-cache' });
    data = res.ok ? await res.json() : { blocks: {} };
  } catch (err) {
    console.warn('topics unavailable', err);
    data = { blocks: {} };
  }
  return data;
}

/** Question IDs (newest version of each) for the blocks, no repeats, the most repeated first. */
export function questionsFor(blockIds) {
  const seen = new Set();
  for (const id of blockIds) {
    for (const qid of data?.blocks[id] || []) seen.add(qid);
  }
  return byRepeats(bank.questions([...seen]));
}

/** Asked on more papers first; a stable sort keeps the order of topics.json among equals. */
function byRepeats(questions) {
  return questions.sort((a, b) => bank.siblings(b).length - bank.siblings(a).length);
}

/**
 * Every version of the question summed: { answered, ratio, lastRight } or null
 * if it was never answered. A blank on a timed-out exam is not an answer: it
 * neither counts as wrong nor hides the answer before it — but a blank replaces
 * the stored last pick, so then `lastRight` is null (unknown).
 */
export function knowledge(q, stats = store.getStats()) {
  let correct = 0;
  let wrong = 0;
  let latest = null;
  for (const s of bank.siblings(q)) {
    const entry = stats[s.id];
    if (!entry) continue;
    correct += entry.correct;
    wrong += entry.wrong;
    if (!latest || (entry.last || 0) > (latest.entry.last || 0)) latest = { s, entry };
  }
  if (!correct && !wrong) return null;
  let lastRight = null;
  if (latest && !('lastPicked' in latest.entry)) lastRight = latest.entry.correct > 0 && latest.entry.wrong === 0;
  else if (latest && latest.entry.lastPicked) lastRight = latest.entry.lastPicked === latest.s.answer;
  return { answered: correct + wrong, ratio: correct / (correct + wrong), lastRight };
}

// Fewer answered questions than this and a grade would be a guess.
const MIN_ANSWERED = 3;

export const LEVELS = {
  know: { label: 'Знаю', short: 'знаю' },
  partly: { label: 'Примерно понимаю', short: 'примерно' },
  weak: { label: 'Не понимаю', short: 'не понимаю' },
  none: { label: 'Мало данных', short: 'нет данных' },
};

/**
 * The block's grade: the mean over its answered questions of (share of right
 * answers + whether the latest answer was right) ÷ 2 — so a topic fixed since
 * the first mistakes climbs, and one answered right once by luck does not stay up.
 * When the latest answer is unknown (a blank after it), the share alone.
 */
export function grade(questions, stats = store.getStats()) {
  let sum = 0;
  let answered = 0;
  let lastRight = 0;
  for (const q of questions) {
    const k = knowledge(q, stats);
    if (!k) continue;
    answered += 1;
    sum += k.lastRight === null ? k.ratio : (k.ratio + (k.lastRight ? 1 : 0)) / 2;
    if (k.lastRight) lastRight += 1;
  }
  const pct = answered ? Math.round((sum / answered) * 100) : null;
  let level = 'none';
  if (answered >= MIN_ANSWERED) level = pct >= 75 ? 'know' : pct >= 50 ? 'partly' : 'weak';
  return { total: questions.length, answered, lastRight, pct, level };
}

export function blockGrade(blockId, stats) {
  return grade(questionsFor([blockId]), stats);
}

/** "Решено 14 из 23 вопросов · в среднем 61% · последний ответ верен в 9" */
export function gradeTitle(g) {
  if (!g.total) return 'Вопросов банка по этой теме не нашлось';
  if (!g.answered) return `Ни один из ${g.total} вопросов по теме ещё не решён`;
  const base = `Решено ${g.answered} из ${g.total} вопросов по теме · оценка ${g.pct}% · последний ответ верен в ${g.lastRight}`;
  return g.level === 'none' ? `${base}. Для оценки нужно хотя бы ${MIN_ANSWERED} решённых` : base;
}
