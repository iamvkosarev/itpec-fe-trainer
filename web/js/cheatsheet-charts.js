// Charts of the cheat sheet's Strategy section that need numbers worked out
// live. For now the OC curve of sampling inspection: the probability that a
// lot is accepted against its percent defective, for several sample plans,
// with the producer's and consumer's risk read off the chosen curve.

import { el, clear } from './util.js';
import { tr } from './i18n.js';

export function mountCharts(root) {
  root.querySelectorAll('[data-widget="oc"]').forEach(mountOc);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ── OC curve ─────────────────────────────────────────────────────────── */

/** L(p): probability that a sample of n holds at most c defectives (binomial). */
function accept(n, c, p) {
  let sum = 0;
  let comb = 1;
  for (let k = 0; k <= c; k++) {
    if (k > 0) comb = (comb * (n - k + 1)) / k;
    sum += comb * p ** k * (1 - p) ** (n - k);
  }
  return Math.min(1, sum);
}

// A good lot (p₁, the acceptable quality) and a bad one (p₂) to read the risks at.
const P_GOOD = 0.03;
const P_BAD = 0.15;
const P_MAX = 0.3;

const num = (x, digits = 2) => tr(x.toFixed(digits).replace('.', ','), x.toFixed(digits));
const pct = (p) => {
  const v = Math.round(p * 1000) / 10;
  return tr(`${num(v, v % 1 ? 1 : 0)} %`, `${num(v, v % 1 ? 1 : 0)}%`);
};

function mountOc(box) {
  let mode = 'c';
  let n = 20;
  let c = 1;
  let focus = 1;
  let cursor = null;
  box.classList.add('walk', 'oc');

  const chips = el('div', { class: 'pg-setup' });
  const stage = el('div', { class: 'tw' });
  const readout = el('p', { class: 'oc-readout' });
  const risks = el('p', { class: 'oc-risks' });

  // Three plans: either c changes at a fixed n (the exam's figure) or n at a fixed c.
  const plans = () => (mode === 'c'
    ? [0, 1, 2].map((k) => ({ n, c: k, label: `c = ${k}` }))
    : [10, 20, 50].map((k) => ({ n: k, c, label: `n = ${k}` })));

  const W = 620;
  const H = 300;
  const X0 = 52;
  const X1 = 600;
  const Y0 = 26;
  const Y1 = 250;
  const xOf = (p) => X0 + (p / P_MAX) * (X1 - X0);
  const yOf = (l) => Y1 - l * (Y1 - Y0);

  const chipRow = (label, values, current, onPick, fmt = String) => el('div', { class: 'chips' },
    el('span', { class: 'pg-label' }, label),
    ...values.map((v) => el('button', {
      type: 'button', class: `chip${v === current ? ' is-on' : ''}`, onclick: () => { onPick(v); render(); },
    }, fmt(v))));

  const render = () => {
    const list = plans();
    clear(chips).append(
      chipRow(tr('Сравнить:', 'Compare:'), ['c', 'n'], mode, (v) => { mode = v; focus = 1; },
        (v) => (v === 'c' ? tr('разные c при одном n', 'different c, same n') : tr('разные n при одном c', 'different n, same c'))),
      mode === 'c'
        ? chipRow(tr('Выборка n:', 'Sample n:'), [10, 20, 50], n, (v) => { n = v; })
        : chipRow(tr('Допуск c:', 'Acceptance c:'), [0, 1, 2], c, (v) => { c = v; }),
      chipRow(tr('Риски по кривой:', 'Risks on curve:'), [0, 1, 2], focus, (v) => { focus = v; }, (v) => list[v].label));

    const root = svg('svg', {
      class: 'oc-svg', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': tr('OC curve: вероятность приёмки партии в зависимости от доли брака', 'OC curve: probability of acceptance against percent defective'),
    });
    // Axes and grid.
    for (let p = 0; p <= P_MAX + 1e-9; p += 0.05) {
      root.append(svg('line', { class: 'c-grid', x1: xOf(p), y1: Y0, x2: xOf(p), y2: Y1 }),
        svg('text', { class: 'c-text c-text--axis', x: xOf(p), y: Y1 + 16, 'text-anchor': 'middle' }, pct(p)));
    }
    for (const l of [0, 0.25, 0.5, 0.75, 1]) {
      root.append(svg('line', { class: 'c-grid', x1: X0, y1: yOf(l), x2: X1, y2: yOf(l) }),
        svg('text', { class: 'c-text c-text--axis', x: X0 - 8, y: yOf(l) + 3, 'text-anchor': 'end' }, num(l)));
    }
    root.append(
      svg('line', { class: 'c-axis', x1: X0, y1: Y0, x2: X0, y2: Y1 }),
      svg('line', { class: 'c-axis', x1: X0, y1: Y1, x2: X1, y2: Y1 }),
      svg('text', { class: 'c-text c-text--axis', x: X1, y: Y1 + 32, 'text-anchor': 'end' },
        tr('p — доля брака в партии (percent defective of a lot)', 'p — percent defective of a lot')),
      svg('text', { class: 'c-text c-text--axis', x: X0 - 40, y: 12, 'text-anchor': 'start' },
        tr('L(p) — вероятность приёмки (probability of acceptance)', 'L(p) — probability of acceptance')));

    // The curves, the chosen one in front.
    const order = [0, 1, 2].filter((i) => i !== focus).concat(focus);
    for (const i of order) {
      const plan = list[i];
      const pts = [];
      for (let k = 0; k <= 150; k++) {
        const p = (k / 150) * P_MAX;
        pts.push(`${xOf(p).toFixed(1)},${yOf(accept(plan.n, plan.c, p)).toFixed(1)}`);
      }
      root.append(svg('polyline', { class: `oc-curve oc-curve--${i}${i === focus ? '' : ' is-dim'}`, points: pts.join(' ') }));
      // Label where the curve crosses one half.
      let half = 0;
      while (half < P_MAX && accept(plan.n, plan.c, half) > 0.5) half += 0.002;
      root.append(svg('text', { class: `oc-label oc-label--${i}`, x: xOf(half) + 8, y: yOf(0.5) - 6 - i * 2 }, plan.label));
    }

    // Producer's and consumer's risk on the chosen curve.
    const plan = list[focus];
    const good = accept(plan.n, plan.c, P_GOOD);
    const bad = accept(plan.n, plan.c, P_BAD);
    root.append(
      svg('line', { class: 'oc-guide', x1: xOf(P_GOOD), y1: Y1, x2: xOf(P_GOOD), y2: yOf(good) }),
      svg('line', { class: 'oc-guide', x1: X0, y1: yOf(good), x2: xOf(P_GOOD), y2: yOf(good) }),
      svg('line', { class: 'oc-guide', x1: xOf(P_BAD), y1: Y1, x2: xOf(P_BAD), y2: yOf(bad) }),
      svg('line', { class: 'oc-guide', x1: X0, y1: yOf(bad), x2: xOf(P_BAD), y2: yOf(bad) }),
      svg('circle', { class: 'c-dot c-dot--hi', cx: xOf(P_GOOD), cy: yOf(good), r: 4 }),
      svg('circle', { class: 'c-dot c-dot--hi', cx: xOf(P_BAD), cy: yOf(bad), r: 4 }),
      svg('text', { class: 'oc-risk c-text--hi', x: xOf(P_GOOD) + 8, y: yOf(good) + (good > 0.9 ? 16 : -6) }, `α = ${num(1 - good)}`),
      svg('text', { class: 'oc-risk c-text--hi', x: xOf(P_BAD) + 8, y: yOf(bad) - 6 }, `β = ${num(bad)}`),
      svg('text', { class: 'c-text c-text--b', x: xOf(P_GOOD), y: Y1 - 6, 'text-anchor': 'middle' }, 'p₁'),
      svg('text', { class: 'c-text c-text--b', x: xOf(P_BAD), y: Y1 - 6, 'text-anchor': 'middle' }, 'p₂'));

    // A cursor that reads every curve at one percent defective.
    if (cursor !== null) {
      root.append(svg('line', { class: 'oc-cursor', x1: xOf(cursor), y1: Y0, x2: xOf(cursor), y2: Y1 }));
      list.forEach((pl, i) => root.append(svg('circle', { class: `c-dot oc-dot--${i}`, cx: xOf(cursor), cy: yOf(accept(pl.n, pl.c, cursor)), r: 3.5 })));
    }
    const at = cursor ?? 0.08;
    readout.textContent = `p = ${pct(at)}: ` + list.map((pl) => `${pl.label} → ${num(accept(pl.n, pl.c, at))}`).join(' · ')
      + (cursor === null ? tr(' (наведи на график)', ' (hover the chart)') : '');

    const track = (e) => {
      const rect = root.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * W;
      const p = Math.min(P_MAX, Math.max(0, ((x - X0) / (X1 - X0)) * P_MAX));
      cursor = Math.round(p * 200) / 200;
      render();
    };
    root.addEventListener('pointermove', track);
    root.addEventListener('pointerdown', track);
    clear(stage).append(root);

    clear(risks).append(
      el('span', {}, el('b', {}, `Producer’s risk α = 1 − L(${pct(P_GOOD)}) = ${num(1 - good)}`),
        tr(` — хорошую партию (брака ${pct(P_GOOD)}) отклонят в ${Math.round((1 - good) * 100)} % случаев.`,
          ` — a good lot (${pct(P_GOOD)} defective) is rejected ${Math.round((1 - good) * 100)}% of the time.`)),
      el('span', {}, el('b', {}, `Consumer’s risk β = L(${pct(P_BAD)}) = ${num(bad)}`),
        tr(` — плохую партию (брака ${pct(P_BAD)}) примут в ${Math.round(bad * 100)} % случаев.`,
          ` — a bad lot (${pct(P_BAD)} defective) is accepted ${Math.round(bad * 100)}% of the time.`)));
  };

  box.addEventListener('pointerleave', () => { if (cursor !== null) { cursor = null; render(); } });
  box.append(chips, stage, readout, risks);
  render();
}
