// Loads the generated question bank. Every exam file is fetched once at start
// (~1.3 MB of JSON in total) so that practice mode can draw across all years
// without a round trip per question. The images stay lazy.

const DATA = 'data/';

let index = null;
let byId = new Map();
let all = [];
// Questions that are the same question re-used across sessions share a
// cluster; the newest version represents it. Singletons are their own cluster.
let clusterMembers = new Map();

// The bank is rebuilt in place (new annotations, same question IDs), so the
// browser must re-validate it on every load rather than trust its cache.
const FRESH = { cache: 'no-cache' };

export async function load() {
  if (index) return { index, all };
  index = await fetch(`${DATA}index.json`, FRESH).then((r) => r.json());
  const exams = await Promise.all(index.exams.map((meta) =>
    fetch(`${DATA}${meta.examId}.json`, FRESH).then((r) => r.json())));
  all = [];
  for (const exam of exams) {
    for (const q of exam.questions) {
      q.examId = exam.examId;
      q.year = exam.year;
      q.session = exam.session;
      q.part = exam.part;
      q.imgSrc = DATA + q.img;
      all.push(q);
      byId.set(q.id, q);
    }
  }
  clusterMembers = new Map();
  for (const q of all) {
    const key = clusterKey(q);
    if (!clusterMembers.has(key)) clusterMembers.set(key, []);
    clusterMembers.get(key).push(q);
  }
  for (const members of clusterMembers.values()) members.sort(byDate);
  return { index, all };
}

/** Chronological order. Exam codes sort wrongly as strings: April 2024 is
 *  "2024S" and October 2024 is "2024A", so the session letter is mapped. */
function byDate(a, b) {
  const key = (q) => Number(q.year) * 10 + (q.session === 'October' ? 1 : 0);
  return key(a) - key(b) || a.no - b.no;
}

export function question(id) {
  return byId.get(id) || null;
}

export function questions(ids) {
  return ids.map(question).filter(Boolean);
}

export function exams(part) {
  return index.exams
    .filter((e) => !part || e.part === part)
    .slice()
    .sort((a, b) => b.code.localeCompare(a.code));
}

export function examMeta(examId) {
  return index.exams.find((e) => e.examId === examId) || null;
}

export function partQuestions(part) {
  return all.filter((q) => q.part === part);
}

export function clusterKey(q) {
  return q.cluster || q.id;
}

/** Every version of this question across sessions, oldest first (itself included). */
export function siblings(q) {
  return clusterMembers.get(clusterKey(q)) || [q];
}

/**
 * One question per cluster — the newest wording. Used wherever questions are
 * drawn at random, so the same question never turns up twice under different
 * exam labels. Real past papers are never deduplicated.
 */
export function uniqueQuestions(part) {
  return all.filter((q) => (!part || q.part === part) && clusterKey(q) === q.id);
}

/** How many distinct questions (clusters) have at least one version in `stats`. */
export function uniqueCovered(stats, part) {
  return uniqueQuestions(part).filter((q) => siblings(q).some((s) => stats[s.id])).length;
}

export function categories(part) {
  const seen = new Map();
  for (const q of all) {
    if (part && q.part !== part) continue;
    seen.set(q.category, (seen.get(q.category) || 0) + 1);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

export function fields(part) {
  const seen = new Map();
  for (const q of all) {
    if (part && q.part !== part) continue;
    seen.set(q.field, (seen.get(q.field) || 0) + 1);
  }
  return [...seen.entries()].map(([name, count]) => ({ name, count }));
}

/** Human label for a question's origin, e.g. "Октябрь 2025 · Subject A · Q12". */
export function origin(q) {
  const month = q.session === 'October' ? 'Октябрь' : 'Апрель';
  return `${month} ${q.year} · ${partLabel(q.part, q.year)} · Q${q.no}`;
}

export function partLabel(part, year) {
  if (part === 'B') return 'Subject B';
  return Number(year) >= 2024 ? 'Subject A' : 'Morning (Subject A)';
}

export const PART_SPEC = {
  A: { id: 'A', name: 'Subject A', count: 60, minutes: 90,
       note: '60 вопросов за 90 минут — действующий формат с апреля 2024.' },
  B: { id: 'B', name: 'Subject B', count: 20, minutes: 100,
       note: '20 задач за 100 минут — алгоритмы, программирование и информационная безопасность.' },
};

/** Pass mark for both parts of the FE exam. */
export const PASS_PCT = 60;
