// Small DOM and formatting helpers. No framework, no build step.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 5025 -> "1:23:45"; under an hour -> "23:45". */
export function hms(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Time on one question: 94 -> "1 мин 34 с", 7 -> "0 мин 07 с". */
export function minSec(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, '0')} с`;
}

export function humanDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Fisher–Yates on a copy. */
export function shuffled(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function pct(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

/** Русская форма числительного: plural(3, 'вопрос', 'вопроса', 'вопросов'). */
export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
}

/**
 * Builds a Google query from a question. The stem alone finds the question on
 * the forums and study sites that index ITPEC papers; the options only add noise.
 */
export function googleUrl(question) {
  const stem = (question.text || '')
    .replace(/^Q\s?\d{1,2}\s*\.?/i, '')
    .split(/\n\s*[a-k]\s*\)/)[0]
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 210);
  const query = `${stem} ITPEC FE exam answer explanation`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
