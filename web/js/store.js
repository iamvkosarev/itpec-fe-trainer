// Everything the app remembers lives in localStorage under one namespace, so a
// full reset is a single key sweep and nothing leaks between exam parts.

const NS = 'itpec.fe.v1';
const KEYS = {
  attempts: `${NS}.attempts`,
  stats: `${NS}.stats`,
  settings: `${NS}.settings`,
  // How well each dictionary word is known; the words themselves live on disk.
  vocab: `${NS}.vocab`,
  // The same, for the abbreviation drill; the abbreviations ship in data/abbr.json.
  abbr: `${NS}.abbr`,
};

const DEFAULT_SETTINGS = {
  theme: 'auto',
  // A date picked on the home screen; null follows the ITPEC calendar (app.js).
  examDate: null,
  practice: { part: 'A', categories: [], onlyRepeats: false, pool: 'all' },
  // Show the Russian translation before answering in practice.
  translate: false,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.warn('storage read failed', key, err);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('storage write failed', key, err);
    return false;
  }
}

/* ── Settings ─────────────────────────────────────────────────────────── */

function savedSettings() {
  return read(KEYS.settings, {});
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...savedSettings() };
}

/** Stores only what was actually set, so later default changes still apply. */
export function saveSettings(patch) {
  const next = { ...savedSettings(), ...patch };
  write(KEYS.settings, next);
  return { ...DEFAULT_SETTINGS, ...next };
}

/* ── Per-question stats ───────────────────────────────────────────────── */
// { [questionId]: { seen, correct, wrong, last, part } }

export function getStats() {
  return read(KEYS.stats, {});
}

export function statFor(questionId) {
  return getStats()[questionId] || null;
}

/** Records one answered question. `picked` of null means it was skipped. */
export function recordAnswer(question, picked, part) {
  const stats = getStats();
  const entry = stats[question.id] || { seen: 0, correct: 0, wrong: 0, last: 0, part };
  entry.seen += 1;
  entry.part = part;
  entry.last = Date.now();
  if (picked === question.answer) entry.correct += 1;
  else if (picked) entry.wrong += 1;
  entry.lastPicked = picked || null;
  stats[question.id] = entry;
  write(KEYS.stats, stats);
  progressChanged();
}

// Open screens (the cheat sheet's grades) listen for this to redraw.
function progressChanged() {
  window.dispatchEvent(new Event('itpec:progress'));
}

/**
 * Stats summed over several question IDs — the versions of one question.
 * Read-only: what is stored stays keyed by the exact question that was shown.
 */
export function statForAll(ids) {
  const stats = getStats();
  let found = false;
  const sum = { seen: 0, correct: 0, wrong: 0, last: 0 };
  for (const id of ids) {
    const entry = stats[id];
    if (!entry) continue;
    found = true;
    sum.seen += entry.seen;
    sum.correct += entry.correct;
    sum.wrong += entry.wrong;
    sum.last = Math.max(sum.last, entry.last || 0);
  }
  return found ? sum : null;
}

export function clearStats(part) {
  if (!part) return write(KEYS.stats, {});
  const stats = getStats();
  for (const [id, entry] of Object.entries(stats)) {
    if (entry.part === part) delete stats[id];
  }
  return write(KEYS.stats, stats);
}

/* ── Attempts ─────────────────────────────────────────────────────────── */

export function getAttempts() {
  return read(KEYS.attempts, []);
}

export function attemptsFor(part) {
  return getAttempts().filter((a) => a.part === part);
}

export function getAttempt(id) {
  return getAttempts().find((a) => a.id === id) || null;
}

export function saveAttempt(attempt) {
  const all = getAttempts();
  all.unshift(attempt);
  // 200 attempts is far more than a season of revision and keeps well inside
  // the localStorage quota even with 80-question answer maps.
  write(KEYS.attempts, all.slice(0, 200));
  progressChanged();
  return attempt;
}

export function deleteAttempt(id) {
  return write(KEYS.attempts, getAttempts().filter((a) => a.id !== id));
}

export function clearAttempts(part) {
  if (!part) return write(KEYS.attempts, []);
  return write(KEYS.attempts, getAttempts().filter((a) => a.part !== part));
}

/* ── Dictionary drill ─────────────────────────────────────────────────── */
// { [word key]: { box, due, right, wrong, last } } — a Leitner box per word:
// a right answer moves it up and spaces it out, a wrong one sends it back.

// Wait before a word in box N comes back, in minutes: then 10 min, 1 h, 6 h,
// a day, three days. Short enough to cycle a few times before an exam a week out.
const VOCAB_WAIT = [1, 10, 60, 360, 1440, 4320];
export const VOCAB_LEARNED_BOX = 4;

export function getVocabProgress() {
  return read(KEYS.vocab, {});
}

/** `right` of null marks a word as seen (its first card) without grading it. */
export function recordVocab(key, right) {
  return recordLeitner(KEYS.vocab, key, right);
}

export function getAbbrProgress() {
  return read(KEYS.abbr, {});
}

export function recordAbbr(id, right) {
  return recordLeitner(KEYS.abbr, id, right);
}

function recordLeitner(storeKey, key, right) {
  const all = read(storeKey, {});
  const entry = all[key] || { box: 0, due: 0, right: 0, wrong: 0, last: 0 };
  const now = Date.now();
  if (right === true) {
    entry.right += 1;
    entry.box = Math.min(entry.box + 1, VOCAB_WAIT.length - 1);
  } else if (right === false) {
    entry.wrong += 1;
    entry.box = 0;
  }
  entry.due = right === null ? now : now + VOCAB_WAIT[entry.box] * 60000;
  entry.last = now;
  all[key] = entry;
  write(storeKey, all);
  return entry;
}

export function forgetVocab(key) {
  const all = getVocabProgress();
  delete all[key];
  write(KEYS.vocab, all);
}

/* ── In-progress exam, so a reload does not lose the session ──────────── */

const RUNNING = `${NS}.running`;

export function saveRunning(state) {
  return write(RUNNING, state);
}

export function getRunning() {
  return read(RUNNING, null);
}

export function clearRunning() {
  try { localStorage.removeItem(RUNNING); } catch (err) { /* nothing to do */ }
}

/* ── Documents: the cheat sheet's switches and marks ────────────────── */
// { quiz, examples, lang, studied: { [sectionId]: time }, test }. Not part of
// KEYS: it is not study progress, so clearing the history leaves it alone.

const DOCS = `${NS}.docs`;

export function getDocsState() {
  return read(DOCS, {});
}

export function saveDocsState(patch) {
  const next = { ...getDocsState(), ...patch };
  write(DOCS, next);
  return next;
}

export function usageBytes() {
  let total = 0;
  for (const key of Object.values(KEYS).concat(RUNNING)) {
    total += (localStorage.getItem(key) || '').length;
  }
  return total;
}
