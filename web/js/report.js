// Exports of a finished attempt: a CSV answer sheet and a PDF report with every
// question, the answer given and the Russian explanation. Both only read the
// attempt and the bank; nothing here writes to storage.
//
// The PDF is laid out in the browser by pdfmake (vendor/pdfmake), loaded on the
// first export so the app starts exactly as before and still works offline.
// pdfmake's Roboto has no arrows, circled digits or check marks, which the
// explanations use a lot (→ alone ~2 300 times); such runs are set in a DejaVu
// Sans subset (vendor/fonts) instead.

import * as bank from './bank.js';
import * as explain from './explain.js';
import { el, hms, minSec, humanDuration, formatDate, pct } from './util.js';

/* ── Shared ───────────────────────────────────────────────────────────── */

function outcome(q, attempt) {
  const picked = attempt.answers[q.id] || null;
  if (!picked) return { picked, key: 'skip', label: 'без ответа' };
  if (picked === q.answer) return { picked, key: 'ok', label: 'верно' };
  return { picked, key: 'no', label: 'неверно' };
}

/**
 * Seconds each question was on screen, in paper order, or null for attempts
 * saved before questions were timed — their reports leave timing out. A
 * question that was never opened has no entry and counts as 0 s.
 */
export function timing(attempt, result) {
  if (!attempt.timeMs || !result.questions.length) return null;
  const rows = result.questions.map((q, i) => {
    const ms = attempt.timeMs[q.id];
    return { q, n: i + 1, sec: (ms || 0) / 1000, opened: ms != null, o: outcome(q, attempt) };
  });
  const sorted = rows.map((r) => r.sec).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  // An even pace spends the whole limit evenly: 90 s a question in Subject A.
  const paceSec = attempt.limitSec / rows.length;
  return {
    rows,
    paceSec,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    slowest: rows.reduce((a, b) => (b.sec > a.sec ? b : a)),
    over: rows.filter((r) => r.sec > paceSec).length,
  };
}

/** A seconds axis up to at least `maxSec`, in four or five round steps. */
export function secondTicks(maxSec) {
  const steps = [5, 10, 15, 20, 30, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 3600];
  const step = steps.find((s) => maxSec / s <= 4) || 3600;
  const top = Math.max(step, Math.ceil(maxSec / step) * step);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

function fileName(attempt, ext) {
  const day = new Date(attempt.finishedAt).toLocaleDateString('sv-SE'); // local YYYY-MM-DD
  return `itpec-${attempt.examId || attempt.part}-${day}.${ext}`;
}

function save(blob, name) {
  const link = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(link);
  link.click();
  link.remove();
  // Generous: Safari reads a large blob for the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(link.href), 30000);
}

/* ── CSV ──────────────────────────────────────────────────────────────── */

/** One row per question, in the order they were shown. */
export function downloadCsv(attempt, result) {
  const cell = (value) => {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const t = timing(attempt, result);
  const rows = [['№', 'ID', 'Результат', 'Ваш ответ', 'Верный ответ', 'Категория', 'Область', 'Повтор']
    .concat(t ? ['Время, с'] : [])];
  result.questions.forEach((q, i) => {
    const o = outcome(q, attempt);
    rows.push([i + 1, q.id, o.label, o.picked || '', q.answer, q.category, q.field, q.repeats ? 'да' : '']
      .concat(t ? [Math.round(t.rows[i].sec)] : []));
  });
  // The BOM makes Excel and Numbers read the Cyrillic as UTF-8.
  const csv = '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  save(new Blob([csv], { type: 'text/csv' }), fileName(attempt, 'csv'));
}

/* ── PDF ──────────────────────────────────────────────────────────────── */

// The light palette from app.css: black on white paper.
const C = {
  ink: '#000000', ink2: '#1f1f1f', ink3: '#525252',
  rule: '#c4c4c4', ruleSoft: '#e0e0e0', paper: '#ffffff', paper2: '#f2f2f2', paper3: '#e3e3e3',
  stamp: '#b3201a', stampSoft: '#fbe4e2', ok: '#17663a', okSoft: '#def1e4', warn: '#8f4f00',
};
const TONE = {
  ok: { color: C.ok, fill: C.okSoft, mark: '✓' },
  no: { color: C.stamp, fill: C.stampSoft, mark: '✗' },
  skip: { color: C.ink3, fill: C.paper2, mark: '–' },
};
const MARGIN = 40;
const CONTENT_W = 595.28 - 2 * MARGIN; // A4
// Question images are rendered from the PDFs at 2x (tools/build_bank.py), so
// half their pixel size is the size they had on the original paper.
const IMG_SCALE = 0.5;
// Must match the ranges kept in vendor/fonts/DejaVuSans-*-Symbols.ttf.
const SYMBOLS = /([\u1D00-\u1DBF\u2070-\u209F\u2150-\u218F\u2190-\u21FF\u2200-\u22FF\u2300-\u23FF\u2460-\u24FF\u2500-\u25FF\u2600-\u27BF]+)/;

let pdfMakeReady = null;

function script(src) {
  return new Promise((resolve, reject) => {
    const tag = el('script', { src });
    tag.onload = resolve;
    tag.onerror = () => reject(new Error(`не загрузился ${src}`));
    document.head.append(tag);
  });
}

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fontBase64(name) {
  const res = await fetch(`vendor/fonts/${name}`);
  if (!res.ok) throw new Error(`не загрузился шрифт ${name}`);
  return base64(new Uint8Array(await res.arrayBuffer()));
}

function loadPdfMake() {
  if (!pdfMakeReady) {
    pdfMakeReady = (async () => {
      await script('vendor/pdfmake/pdfmake.min.js');
      await script('vendor/pdfmake/vfs_fonts.js'); // registers Roboto itself
      const [regular, bold] = await Promise.all(
        ['DejaVuSans-Symbols.ttf', 'DejaVuSans-Bold-Symbols.ttf'].map(fontBase64));
      const { pdfMake } = window;
      pdfMake.addVirtualFileSystem({ 'Symbols.ttf': regular, 'Symbols-Bold.ttf': bold });
      pdfMake.addFonts({
        Symbols: { normal: 'Symbols.ttf', bold: 'Symbols-Bold.ttf', italics: 'Symbols.ttf', bolditalics: 'Symbols-Bold.ttf' },
      });
      pdfMake.setUrlAccessPolicy(() => false); // every image is inlined; nothing is fetched
      return pdfMake;
    })().catch((err) => {
      pdfMakeReady = null; // let the next click retry
      throw err;
    });
  }
  return pdfMakeReady;
}

/**
 * pdfmake reads PNG and JPEG only, and the bank is WebP, so each image goes
 * through a canvas. A canvas PNG has an alpha channel, which pdfkit splits off
 * in JavaScript (~7 s for a paper); an 8-bit grayscale PNG without alpha is
 * copied into the PDF as is, and the question images are grayscale anyway.
 */
function imageData(q) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const canvas = el('canvas', { width: img.naturalWidth, height: img.naturalHeight });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      try {
        resolve(`data:image/png;base64,${base64(await grayPng(canvas))}`);
      } catch (err) {
        resolve(canvas.toDataURL('image/png')); // no CompressionStream: slower, same result
      }
    };
    img.onerror = () => resolve(null);
    img.src = q.imgSrc;
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) crc = CRC_TABLE[(crc ^ out[i]) & 0xff] ^ (crc >>> 8);
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}

async function grayPng(canvas) {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  // Each row is stored as the difference from the row above (PNG filter "Up"):
  // white margins and ruled lines turn into long runs of zeros.
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const out = y * (width + 1);
    const row = y * width;
    raw[out] = 2;
    for (let x = 0; x < width; x++) {
      raw[out + 1 + x] = (gray[row + x] - (y ? gray[row - width + x] : 0)) & 0xff;
    }
  }
  const zlib = new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate')));
  const idat = new Uint8Array(await zlib.arrayBuffer());
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit, grayscale, deflate, standard filters, no interlace
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => { png.set(part, at); return at + part.length; }, 0);
  return png;
}

/**
 * All questions with answers and explanations. The structure is for jumping
 * around: PDF bookmarks (every question; errors and skips; each category), an
 * answer sheet whose rows link to the questions, and a link back to the sheet
 * in every footer. Each question starts a page, so a bookmark lands on it.
 */
export async function downloadPdf(attempt, result) {
  const [pdfMake, entries, images] = await Promise.all([
    loadPdfMake(),
    Promise.all(result.questions.map((q) => explain.entry(q))),
    Promise.all(result.questions.map(imageData)),
  ]);
  const blob = await pdfMake.createPdf(buildDoc(attempt, result, entries, images)).getBlob();
  save(blob, fileName(attempt, 'pdf'));
}

function buildDoc(attempt, result, entries, images) {
  const spec = bank.PART_SPEC[attempt.part];
  const t = timing(attempt, result);
  const title = `${spec.name} · ${attempt.sourceLabel}`;
  const byCategory = new Map(result.byCategory.map((row) => [row.name, row]));
  const categoryIds = new Map();
  const imageMap = {};
  const items = result.questions.map((q, i) => {
    if (images[i]) imageMap[`img-${i + 1}`] = images[i];
    const firstOfCategory = !categoryIds.has(q.category);
    if (firstOfCategory) categoryIds.set(q.category, `ol-cat-${categoryIds.size}`);
    return {
      q, n: i + 1, dest: `q-${i + 1}`, o: outcome(q, attempt), entry: entries[i],
      image: images[i] ? `img-${i + 1}` : null,
      time: t ? t.rows[i] : null,
      cat: categoryIds.get(q.category),
      catHead: firstOfCategory ? byCategory.get(q.category) : null,
    };
  });

  return {
    pageSize: 'A4',
    pageMargins: [MARGIN, MARGIN, MARGIN, 52],
    info: { title: `ITPEC FE — ${title}`, subject: 'Разбор попытки', author: 'ITPEC FE тренажёр', creator: 'ITPEC FE тренажёр' },
    language: 'ru-RU',
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25, color: C.ink },
    styles: STYLES,
    images: imageMap,
    footer: (page, pages) => footer(page, pages, title),
    // A section title left alone at the foot of a page moves to the next one.
    // pdfmake counts the footer as content of the page, hence the filter.
    pageBreakBefore: (node, nodes) => node.headlineLevel === 1
      && nodes.getFollowingNodesOnPage().every((other) => other.style === 'footer'),
    content: [
      ...summaryPage(attempt, result, title, t),
      ...answerSheet(items, Boolean(t)),
      ...items.map((it, i) => questionPage(it, i === 0 ? outlineGroups(items) : [])),
    ],
  };
}

const STYLES = {
  eyebrow: { fontSize: 8, bold: true, color: C.ink3, characterSpacing: 0.8 },
  h1: { fontSize: 22, bold: true, lineHeight: 1.1, margin: [0, 4, 0, 0] },
  h2: { fontSize: 14, bold: true, margin: [0, 18, 0, 6] },
  qtitle: { fontSize: 18, bold: true, lineHeight: 1.1 },
  section: { fontSize: 8, bold: true, color: C.ink3, characterSpacing: 0.8, margin: [0, 14, 0, 4] },
  muted: { fontSize: 9, color: C.ink2 },
  small: { fontSize: 8.5, color: C.ink2, margin: [0, 6, 0, 0] },
  th: { fontSize: 8, bold: true, color: C.ink2 },
  footer: { fontSize: 8, color: C.ink3 },
};

// Hairlines between rows only, like .bartable in the app.
const ROWS = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : i === node.table.headerRows ? 0.8 : 0.4),
  vLineWidth: () => 0,
  hLineColor: (i, node) => (i === node.table.headerRows ? C.rule : C.ruleSoft),
  paddingLeft: () => 5,
  paddingRight: () => 5,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

function box(color, width = 0.6, pad = 6) {
  return {
    hLineWidth: () => width, vLineWidth: () => width,
    hLineColor: () => color, vLineColor: () => color,
    paddingLeft: () => pad, paddingRight: () => pad, paddingTop: () => pad, paddingBottom: () => pad,
  };
}

function heading(text, style = 'section') {
  return { text, style, headlineLevel: 1 };
}

/** Plain text with "\n" and **bold**, as in explain.js; symbol runs get the fallback font. */
function rich(text, extra = {}) {
  const runs = [];
  String(text ?? '').split('**').forEach((part, i) => {
    part.split(SYMBOLS).forEach((piece, j) => {
      if (!piece) return;
      const run = { text: piece };
      if (i % 2) run.bold = true;
      if (j % 2) run.font = 'Symbols';
      runs.push(run);
    });
  });
  return { text: runs, ...extra };
}

function footer(page, pages, title) {
  // Every node carries the style: pageBreakBefore tells the footer apart by it.
  return {
    margin: [MARGIN, 20, MARGIN, 0],
    style: 'footer',
    columns: [
      { width: 100, style: 'footer', text: page > 1 ? rich('↑ Лист ответов').text : '', linkToDestination: page > 1 ? 'answers' : undefined, color: C.ink2 },
      { width: '*', style: 'footer', text: `ITPEC FE · ${title}`, alignment: 'center' },
      { width: 100, style: 'footer', text: `${page} / ${pages}`, alignment: 'right' },
    ],
  };
}

function summaryPage(attempt, result, title, t) {
  const tone = result.pass ? C.ok : C.stamp;
  const stat = (value, label) => ({
    stack: [{ text: value, fontSize: 14, bold: true }, { text: label, style: 'eyebrow', margin: [0, 1, 0, 0] }],
  });
  const timing = `затрачено ${hms(attempt.durationSec)} из ${humanDuration(attempt.limitSec)}`
    + (attempt.finishedEarly ? ' · завершено досрочно' : '')
    + (attempt.durationSec >= attempt.limitSec ? ' · время истекло' : '');

  return [
    { text: 'ITPEC FE · РАЗБОР ПОПЫТКИ', style: 'eyebrow' },
    { text: title, style: 'h1', id: 'summary', outline: true, outlineText: 'Итоги' },
    { text: `${formatDate(attempt.finishedAt)} · ${timing}`, style: 'muted', margin: [0, 4, 0, 18] },
    {
      columnGap: 18,
      columns: [
        {
          width: 112,
          table: {
            widths: ['*'],
            body: [[{
              stack: [
                { text: result.pass ? 'PASS' : 'FAIL', fontSize: 24, bold: true, color: tone, alignment: 'center' },
                { text: `${result.score}%`, fontSize: 15, bold: true, color: tone, alignment: 'center' },
                { text: `проходной ${bank.PASS_PCT}%`, style: 'eyebrow', alignment: 'center', margin: [0, 4, 0, 0] },
              ],
            }]],
          },
          layout: box(tone, 1.5, 10),
        },
        {
          width: '*',
          margin: [0, 6, 0, 0],
          table: {
            widths: ['*', '*', '*'],
            body: [
              [stat(`${result.correct} / ${result.total}`, 'ВЕРНО'), stat(String(result.wrong), 'ОШИБОК'), stat(String(result.skipped), 'БЕЗ ОТВЕТА')],
              [stat(hms(attempt.durationSec), 'ЗАТРАЧЕНО'), stat(humanDuration(attempt.limitSec), 'ЛИМИТ'),
                stat(`${Math.round(attempt.durationSec / Math.max(result.total, 1))} с`, 'НА ВОПРОС')],
            ],
          },
          layout: { ...box(C.ruleSoft, 0), paddingBottom: () => 10 },
        },
      ],
    },
    {
      margin: [0, 18, 0, 0],
      table: {
        widths: ['*'],
        body: [[{
          fillColor: C.paper,
          stack: [
            { text: 'КАК ПОЛЬЗОВАТЬСЯ', style: 'eyebrow', margin: [0, 0, 0, 3] },
            {
              fontSize: 9,
              color: C.ink2,
              text: 'Закладки PDF (боковая панель, в Preview — «Оглавление»): все вопросы по порядку, '
                + 'отдельно ошибки с пропусками и вопросы по категориям. Строки листа ответов — ссылки '
                + 'на вопросы, а внизу каждой страницы есть ссылка обратно к листу. '
                + 'Каждый вопрос начинается с новой страницы.',
            },
          ],
        }]],
      },
      layout: box(C.paper, 0, 10),
    },
    ...(t ? timeBlock(t) : []),
    breakdown('По областям', result.byField),
    breakdown('По категориям', result.byCategory),
  ];
}

/** The timing chart of the results screen, drawn as SVG for print. */
function timeBlock(t) {
  const pace = Math.round(t.paceSec);
  const key = (color, label) => [{ text: '■ ', font: 'Symbols', color }, { text: `${label}     ` }];
  return [
    heading('Время по вопросам', 'h2'),
    {
      text: `Секунды, пока вопрос был на экране. Медиана ${Math.round(t.median)} с · дольше всего — `
        + `вопрос ${t.slowest.n}, ${minSec(t.slowest.sec)} · дольше темпа ${pace} с: ${t.over} из ${t.rows.length}.`,
      style: 'muted',
      margin: [0, 0, 0, 6],
    },
    { svg: timeSvg(t), width: CONTENT_W },
    {
      fontSize: 8,
      color: C.ink2,
      margin: [0, 4, 0, 0],
      text: [
        ...key(TONE.ok.color, 'верно'), ...key(TONE.no.color, 'неверно'), ...key(TONE.skip.color, 'без ответа'),
        { text: '— ', bold: true }, `темп: лимит ÷ число вопросов, ${pace} с`,
      ],
    },
  ];
}

function timeSvg(t) {
  const W = CONTENT_W;
  const H = 150;
  const pad = { left: 34, right: 44, top: 14, bottom: 14 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const base = pad.top + plotH;
  const { top, ticks } = secondTicks(Math.max(t.slowest.sec, t.paceSec));
  const y = (sec) => base - (Math.min(sec, top) / top) * plotH;
  const slot = plotW / t.rows.length;
  const barW = Math.min(14, Math.max(1, slot - 1.5));
  const labelled = new Set((t.rows.length <= 24 ? t.rows : t.rows.slice().sort((a, b) => b.sec - a.sec).slice(0, 5))
    .filter((r) => r.sec >= 1).map((r) => r.n));
  const xStep = t.rows.length > 30 ? 5 : 1;
  const text = (x, yy, value, anchor, fill = C.ink3) =>
    `<text x="${x.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="${anchor}" font-family="Roboto" font-size="6.5" fill="${fill}">${value}</text>`;

  const out = [];
  for (const v of ticks) {
    out.push(`<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? C.ruleSoft : C.rule}" stroke-width="${v ? 0.5 : 0.8}"/>`);
    out.push(text(pad.left - 4, y(v) + 2.3, `${v} с`, 'end'));
  }
  t.rows.forEach((r, i) => {
    const cx = pad.left + slot * (i + 0.5);
    const h = base - y(r.sec);
    if (h > 0.2) {
      // Rounded at the data end, square on the baseline.
      const x0 = cx - barW / 2;
      const rr = Math.min(2, barW / 2, h);
      out.push(`<path fill="${TONE[r.o.key].color}" d="M${x0},${base} V${base - h + rr} Q${x0},${base - h} ${x0 + rr},${base - h} `
        + `H${x0 + barW - rr} Q${x0 + barW},${base - h} ${x0 + barW},${base - h + rr} V${base} Z"/>`);
    }
    if (labelled.has(r.n)) out.push(text(cx, base - h - 2.5, Math.round(r.sec), 'middle', C.ink2));
    if (r.n === 1 || r.n % xStep === 0) out.push(text(cx, H - 3, r.n, 'middle'));
  });
  const py = y(t.paceSec);
  out.push(`<line x1="${pad.left}" x2="${W - pad.right}" y1="${py}" y2="${py}" stroke="${C.ink2}" stroke-width="0.8"/>`);
  out.push(text(W - pad.right + 4, py + 2.3, `темп ${Math.round(t.paceSec)} с`, 'start', C.ink2));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}

function breakdown(title, rows) {
  const bar = (row) => {
    const value = pct(row.correct, row.total);
    const color = value >= 60 ? C.ok : value >= 40 ? C.warn : C.stamp;
    const shapes = [{ type: 'rect', x: 0, y: 3, w: 110, h: 6, r: 3, color: C.paper3 }];
    if (value) shapes.push({ type: 'rect', x: 0, y: 3, w: 1.1 * value, h: 6, r: 3, color });
    return { canvas: shapes };
  };
  return [
    heading(title, 'h2'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 50, 116, 30],
        body: [
          [{ text: 'Раздел', style: 'th' }, { text: 'Верно', style: 'th' }, { text: '', style: 'th' }, { text: '%', style: 'th', alignment: 'right' }],
          ...rows.map((row) => [
            row.name,
            `${row.correct} / ${row.total}`,
            bar(row),
            { text: `${pct(row.correct, row.total)}%`, alignment: 'right' },
          ]),
        ],
      },
      layout: ROWS,
    },
  ];
}

function answerSheet(items, timed) {
  const names = ['№', 'Итог', 'Категория', 'Ответ', 'Верный', 'Повтор', 'RU', ...(timed ? ['Время'] : []), 'Стр.'];
  const head = names.map((text, i) => ({ text, style: 'th', alignment: i === names.length - 1 ? 'right' : 'left' }));
  const body = items.map(({ q, n, dest, o, entry, time }) => {
    const tone = TONE[o.key];
    const versions = bank.siblings(q).length;
    const cells = [
      { text: String(n), bold: true },
      { text: o.label, color: tone.color, bold: o.key !== 'ok' },
      { text: q.category },
      { text: o.picked ? `${o.picked})` : '—', color: o.key === 'no' ? C.stamp : C.ink },
      { text: `${q.answer})` },
      { text: versions > 1 ? `×${versions}` : '', color: C.ink2 },
      { text: entry ? 'RU' : '', color: C.ink2 },
      ...(timed ? [{ text: time.opened ? minSec(time.sec) : '—', noWrap: true }] : []),
      { pageReference: dest, alignment: 'right', color: C.ink2 },
    ];
    return cells.map((cell) => ({
      ...cell,
      linkToDestination: dest,
      ...(o.key === 'ok' ? {} : { fillColor: tone.fill }),
    }));
  });

  return [
    { text: 'Лист ответов', style: 'h2', margin: [0, 0, 0, 2], id: 'answers', outline: true, pageBreak: 'before' },
    {
      text: 'Строка — ссылка на вопрос. «Повтор ×N» — вопрос встречался на N экзаменах; '
        + '«RU» — есть перевод и разбор.' + (timed ? ' «Время» — сколько вопрос был на экране.' : ''),
      style: 'muted',
      margin: [0, 0, 0, 8],
    },
    {
      fontSize: 9,
      table: {
        headerRows: 1,
        widths: timed ? [18, 50, '*', 30, 38, 38, 20, 50, 26] : [18, 56, '*', 32, 38, 38, 20, 26],
        body: [head, ...body],
      },
      layout: ROWS,
    },
  ];
}

/**
 * Bookmark parents. pdfmake attaches a bookmark to the page its text is drawn
 * on and needs a parent drawn before its children, so the groups are invisible
 * markers on the first question page; each category's own parent sits on the
 * first question of that category, which also lists categories in paper order.
 */
function outlineGroups(items) {
  const misses = items.filter((it) => it.o.key !== 'ok').length;
  const groups = [marker(`Все вопросы (${items.length})`, null, 'ol-all')];
  if (misses) groups.push(marker(`Ошибки и пропуски (${misses})`, null, 'ol-miss'));
  groups.push(marker('По категориям', null, 'ol-cats'));
  return groups;
}

function marker(label, parentId, id) {
  return {
    text: '.', fontSize: 1, opacity: 0, absolutePosition: { x: 0, y: 0 },
    outline: true, outlineText: label, outlineParentId: parentId || undefined, id,
  };
}

function short(v) {
  return `${v.session === 'October' ? 'окт.' : 'апр.'} ${v.year} Q${v.no} — ответ ${v.answer})`;
}

function questionPage(it, groups) {
  const { q, n, dest, o, entry, image, time } = it;
  const tone = TONE[o.key];
  const stack = [
    ...groups,
    ...(it.catHead ? [marker(`${it.catHead.name} — ${it.catHead.correct} из ${it.catHead.total}`, 'ol-cats', it.cat)] : []),
    // A question sits in three bookmark lists; the visible title is the first.
    ...(o.key === 'ok' ? [] : [marker(`${tone.mark} ${n} · ${q.category}`, 'ol-miss')]),
    marker(`${tone.mark} ${n} · ${o.label}`, it.cat),
    {
      text: `Вопрос ${n}`, style: 'qtitle', id: dest,
      outline: true, outlineParentId: 'ol-all', outlineText: `${tone.mark} ${n} · ${q.category}`,
    },
    {
      margin: [0, 4, 0, 0],
      fontSize: 9,
      text: [
        { text: `  ${o.label.toUpperCase()}  `, bold: true, color: tone.color, background: tone.fill },
        { text: `   ${q.category} · ${q.field} · ${bank.origin(q)}`, color: C.ink2 },
      ],
    },
    {
      margin: [0, 6, 0, 10],
      text: [
        o.picked
          ? { text: `Ваш ответ: ${o.picked})`, bold: true, color: o.key === 'ok' ? C.ok : C.stamp }
          : { text: 'Ответа нет', bold: true, color: C.ink3 },
        '      ',
        { text: `Верный ответ: ${q.answer})`, bold: true, color: C.ok },
        ...(time ? ['      ', { text: `На вопросе: ${time.opened ? minSec(time.sec) : 'не открывался'}`, color: C.ink2 }] : []),
      ],
    },
    image
      ? {
          table: {
            widths: ['*'],
            body: [[{ image, fit: [Math.min(q.w * IMG_SCALE, CONTENT_W - 12), 560], alignment: 'center' }]],
          },
          layout: box(C.rule),
        }
      : { text: q.text || '', style: 'muted' },
  ];

  const others = bank.siblings(q).filter((v) => v.id !== q.id);
  if (others.length) {
    stack.push({ style: 'small', text: [{ text: 'Этот же вопрос был: ', bold: true }, others.map(short).join(' · ')] });
  }
  const variants = (q.variants || []).map((ref) => bank.question(ref.id)).filter(Boolean);
  if (variants.length) {
    stack.push({ style: 'small', text: [{ text: 'Похожие, но другие: ', bold: true }, variants.map(short).join(' · ')] });
  }

  if (entry) stack.push(...explanation(entry, q, o));
  else stack.push({ text: 'Разбора на русском для этого вопроса пока нет.', style: 'muted', italics: true, margin: [0, 14, 0, 0] });

  return { stack, pageBreak: 'before' };
}

function explanation(entry, q, o) {
  const out = [
    heading('ПЕРЕВОД'),
    rich(entry.question),
  ];

  const body = q.options.map((letter) => {
    const isAnswer = letter === q.answer;
    const isPicked = letter === o.picked;
    const fill = isAnswer ? C.okSoft : isPicked ? C.stampSoft : undefined;
    const tag = isAnswer ? (isPicked ? 'ВЕРНЫЙ · ВАШ ОТВЕТ' : 'ВЕРНЫЙ ОТВЕТ') : isPicked ? 'ВАШ ОТВЕТ' : null;
    const cell = [rich(entry.options[letter] || '—', { bold: isAnswer })];
    if (tag) cell.push({ text: tag, fontSize: 7, bold: true, characterSpacing: 0.6, color: isAnswer ? C.ok : C.stamp, margin: [0, 2, 0, 0] });
    if (entry.why && entry.why[letter]) cell.push(rich(entry.why[letter], { fontSize: 9, color: C.ink2, margin: [0, 3, 0, 0] }));
    return [
      { text: `${letter})`, bold: true, fillColor: fill },
      { stack: cell, fillColor: fill },
    ];
  });
  out.push(
    heading('ВАРИАНТЫ'),
    { table: { widths: [16, '*'], body }, layout: { ...ROWS, paddingTop: () => 5, paddingBottom: () => 5 } },
    heading('КАК РЕШАТЬ'),
    rich(entry.solution),
  );

  if (entry.memo) {
    out.push(
      heading('КАК ЗАПОМНИТЬ'),
      { table: { widths: ['*'], body: [[{ ...rich(entry.memo), fillColor: C.paper }]] }, layout: box(C.paper, 0, 8) },
    );
  }
  if (entry.note) {
    out.push(heading('ПРИМЕЧАНИЕ'), rich(entry.note, { color: C.warn }));
  }
  if (entry.terms && entry.terms.length) {
    out.push(
      heading('ТЕРМИНЫ'),
      {
        fontSize: 9,
        table: {
          widths: [150, '*'],
          body: entry.terms.map((t) => [
            { stack: [rich(t.term, { bold: true }), ...(t.full ? [rich(t.full, { fontSize: 8, color: C.ink3 })] : [])] },
            rich(t.ru),
          ]),
        },
        layout: ROWS,
      },
    );
  }
  return out;
}
