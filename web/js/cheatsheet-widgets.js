// Interactive parts of the cheat sheet (web/docs/cheatsheet.html): the full
// question behind every source mark, step-by-step tree and graph traversals,
// a subnet calculator, sorting and page replacement step by step, RAID levels
// with a disk to break, the OSI/TCP-IP layer map and a packet's trip. docs.js
// mounts them once the sheet is loaded; the sheet marks their places with
// data-widget="…".

import { el, clear, plural } from './util.js';
import { tr } from './i18n.js';
import * as bank from './bank.js';
import * as ui from './ui.js';
import * as explain from './explain.js';

/**
 * Text from one of the tables below, picked as the widget draws: a { ru, en }
 * pair in the current language, or a plain string that is the same in both.
 */
const loc = (text) => (typeof text === 'string' ? text : tr(text.ru, text.en));

export function mountWidgets(root) {
  mountQuestionLinks(root);
  root.querySelectorAll('[data-widget="tree"]').forEach(mountTree);
  root.querySelectorAll('[data-widget="graph"]').forEach(mountGraph);
  root.querySelectorAll('[data-widget="subnet"]').forEach(mountSubnet);
  root.querySelectorAll('[data-widget="sort"]').forEach(mountSort);
  root.querySelectorAll('[data-widget="paging"]').forEach(mountPaging);
  root.querySelectorAll('[data-widget="raid"]').forEach(mountRaid);
  root.querySelectorAll('[data-widget="osi"]').forEach(mountOsi);
  root.querySelectorAll('[data-widget="hops"]').forEach(mountHops);
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

/** Colour of the n-th step of a walk: blue at the start, red at the end. */
function stepColor(i, total) {
  const hue = 250 - (total > 1 ? (i / (total - 1)) * 225 : 0);
  return `oklch(0.62 0.17 ${hue.toFixed(0)})`;
}

/** An arrow from a to b that stops at the node circles and bends a little. */
function arrow(a, b, color, { radius = 18, bend = 16, width = 2.4 } = {}) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = x1 + ux * radius;
  const sy = y1 + uy * radius;
  const ex = x2 - ux * (radius + 2);
  const ey = y2 - uy * (radius + 2);
  // Control point off to one side, so a walk that goes back and forth over the
  // same pair of nodes does not draw both arrows on top of each other.
  const cx = (sx + ex) / 2 - uy * bend;
  const cy = (sy + ey) / 2 + ux * bend;
  const angle = Math.atan2(ey - cy, ex - cx);
  const head = 9;
  const tip = `${ex},${ey}`;
  const left = `${ex - head * Math.cos(angle - 0.42)},${ey - head * Math.sin(angle - 0.42)}`;
  const right = `${ex - head * Math.cos(angle + 0.42)},${ey - head * Math.sin(angle + 0.42)}`;
  return svg('g', { class: 'walk-arrow' },
    svg('path', { d: `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round' }),
    svg('polygon', { points: `${tip} ${left} ${right}`, fill: color }));
}

/** Prev / next / whole walk / reset, and ← → while the widget has focus. */
function stepper(box, { onStep, printAt = 'end' }) {
  const prev = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => onStep(-1) }, tr('← Шаг', '← Step'));
  const next = el('button', { type: 'button', class: 'btn btn--sm', onclick: () => onStep(1) }, tr('Шаг →', 'Step →'));
  const all = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => onStep('end') }, tr('Весь путь', 'All steps'));
  const reset = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => onStep('reset') }, tr('Сброс', 'Reset'));
  box.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
  });
  // Paper cannot be stepped through: a printout shows the whole walk instead.
  if (printAt) {
    const onPrint = () => {
      if (!box.isConnected) window.removeEventListener('beforeprint', onPrint);
      else onStep(printAt);
    };
    window.addEventListener('beforeprint', onPrint);
  }
  return { node: el('div', { class: 'walk-controls' }, prev, next, all, reset), prev, next };
}

function modeChips(modes, current, onPick) {
  return el('div', { class: 'chips walk-modes' },
    ...modes.map(([id, label]) => el('button', {
      type: 'button',
      class: `chip${id === current ? ' is-on' : ''}`,
      onclick: () => onPick(id),
    }, loc(label))));
}

/* ── Full question behind a source mark ───────────────────────────────── */

/** "2025S·Q8" → that question. */
function questionFor(text) {
  const m = text.match(/(\d{4}[AS])·Q(\d+)/);
  return m ? bank.question(`${m[1]}-A-${m[2].padStart(2, '0')}`) : null;
}

/** The question with its right answer and explanation, in a wide modal. */
export function showQuestion(q) {
  ui.openModal(tr('Вопрос целиком', 'Full question'), el('div', { class: 'qview' },
    ui.questionSheet(q, { showOrigin: true }),
    el('div', { class: 'qview__answer' },
      el('span', { class: 'eyebrow' }, tr('Верный ответ', 'Correct answer')),
      ui.bubbleRow(q, { state: 'revealed', picked: null })),
    explain.panel(q, { revealed: true })), { wide: true });
}

function mountQuestionLinks(root) {
  for (const tag of root.querySelectorAll('.src')) {
    if (tag.closest('.legend')) continue;
    const q = questionFor(tag.textContent);
    if (!q) continue;
    tag.classList.add('is-link');
    tag.setAttribute('role', 'button');
    tag.setAttribute('tabindex', '0');
    tag.setAttribute('title', tr('Открыть вопрос целиком', 'Open the full question'));
    const open = (e) => { e.preventDefault(); e.stopPropagation(); showQuestion(q); };
    tag.addEventListener('click', open);
    tag.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }

  // Each exam example gets a plain button too: its paraphrase is short on purpose.
  for (const task of root.querySelectorAll('.task')) {
    const tag = task.querySelector('.lbl .src');
    const q = tag && questionFor(tag.textContent);
    if (!q) continue;
    const anchor = task.querySelector('.q') || task.querySelector('.lbl');
    anchor.after(el('div', { class: 'task-open' },
      el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => showQuestion(q) },
        tr('Открыть вопрос целиком — с ответом и разбором', 'Open the full question — with the answer and explanation'))));
  }
}

/* ── Binary tree traversal ────────────────────────────────────────────── */

// Every traversal of this tree gives a different order, so the four can be
// told apart by eye. Nodes sit left to right in in-order (A…I), so reading
// the picture across is the in-order walk.
const TREE = {
  root: 'F',
  pos: {
    F: [250, 34], B: [95, 96], G: [310, 96], A: [40, 160], D: [180, 160],
    I: [385, 160], C: [135, 222], E: [225, 222], H: [345, 222],
  },
  kids: { F: ['B', 'G'], B: ['A', 'D'], D: ['C', 'E'], G: [null, 'I'], I: ['H', null] },
};

const TREE_MODES = [
  ['pre', 'Pre-order'],
  ['in', 'In-order'],
  ['post', 'Post-order'],
  ['bfs', { ru: 'В ширину', en: 'Breadth-first' }],
];

function treeWalk(mode) {
  const kids = (n) => TREE.kids[n] || [null, null];
  const out = [];
  const name = (n) => n || tr('пусто', 'none');
  const visit = (n) => {
    if (!n) return;
    const [l, r] = kids(n);
    if (mode === 'pre') out.push({ node: n, why: tr(`${n}: пришли в узел — записываем сразу, потом левое (${name(l)}) и правое (${name(r)}) поддерево.`, `${n}: first visit — write the node at once, then its left (${name(l)}) and right (${name(r)}) subtrees.`) });
    visit(l);
    if (mode === 'in') out.push({ node: n, why: tr(`${n}: левое поддерево (${name(l)}) пройдено — записываем узел, дальше правое (${name(r)}).`, `${n}: left subtree (${name(l)}) done — write the node, then the right one (${name(r)}).`) });
    visit(r);
    if (mode === 'post') out.push({ node: n, why: tr(`${n}: левое (${name(l)}) и правое (${name(r)}) поддеревья пройдены — узел записываем последним.`, `${n}: left (${name(l)}) and right (${name(r)}) subtrees done — the node is written last.`) });
  };
  if (mode === 'bfs') {
    const queue = [[TREE.root, 1]];
    while (queue.length) {
      const [n, depth] = queue.shift();
      out.push({ node: n, why: tr(`${n}: уровень ${depth}, слева направо. Его потомков (${kids(n).filter(Boolean).join(', ') || 'нет'}) — в конец очереди.`, `${n}: level ${depth}, left to right. Its children (${kids(n).filter(Boolean).join(', ') || 'none'}) go to the back of the queue.`) });
      for (const k of kids(n)) if (k) queue.push([k, depth + 1]);
    }
  } else {
    visit(TREE.root);
  }
  return out;
}

// The contour trick: walk a line around the tree, down its left side first.
// Every node is passed three times — on its left, under it, on its right —
// and pre-, in- and post-order write the node at the first, second and third
// pass. The flags mark that pass for the chosen traversal.
const FLAG_OFFSET = 27;

function contourPoints() {
  const pts = [];
  const walk = (n) => {
    const [x, y] = TREE.pos[n];
    const [l, r] = TREE.kids[n] || [null, null];
    pts.push([x - FLAG_OFFSET, y]);
    if (l) walk(l);
    pts.push([x, y + FLAG_OFFSET]);
    if (r) walk(r);
    pts.push([x + FLAG_OFFSET, y]);
  };
  walk(TREE.root);
  return pts;
}

function flagFor(mode, [x, y]) {
  if (mode === 'pre') return [x - 17, y, x - FLAG_OFFSET, y];
  if (mode === 'in') return [x, y + 17, x, y + FLAG_OFFSET];
  if (mode === 'post') return [x + 17, y, x + FLAG_OFFSET, y];
  return null;
}

function mountTree(box) {
  let mode = 'pre';
  let step = 0;
  box.classList.add('walk');
  box.setAttribute('tabindex', '0');

  const modesSlot = el('div', {});
  const pic = svg('svg', { class: 'walk-svg', viewBox: '0 0 420 250', role: 'img', 'aria-label': tr('Двоичное дерево с корнем F', 'Binary tree with root F') });
  const seq = el('div', { class: 'walk-seq' });
  const why = el('p', { class: 'walk-why' });
  const controls = stepper(box, {
    onStep: (d) => {
      const walk = treeWalk(mode);
      if (d === 'reset') step = 0;
      else if (d === 'end') step = walk.length;
      else step = Math.min(walk.length, Math.max(0, step + d));
      render();
    },
  });

  const render = () => {
    const walk = treeWalk(mode);
    const order = walk.map((s) => s.node);
    const visited = new Map(order.slice(0, step).map((n, i) => [n, i]));
    clear(modesSlot).append(modeChips(TREE_MODES, mode, (m) => { mode = m; step = 0; render(); }));

    clear(pic);
    if (mode !== 'bfs') {
      pic.append(svg('path', { class: 'walk-contour', d: `M${contourPoints().map((p) => p.join(',')).join(' L')}` }));
    }
    for (const [parent, pair] of Object.entries(TREE.kids)) {
      for (const child of pair) {
        if (child) pic.append(svg('line', { class: 'walk-edge', x1: TREE.pos[parent][0], y1: TREE.pos[parent][1], x2: TREE.pos[child][0], y2: TREE.pos[child][1] }));
      }
    }
    for (const n of Object.keys(TREE.pos)) {
      const flag = flagFor(mode, TREE.pos[n]);
      if (flag) {
        pic.append(svg('g', { class: 'walk-flag' },
          svg('line', { x1: flag[0], y1: flag[1], x2: flag[2], y2: flag[3] }),
          svg('circle', { cx: flag[2], cy: flag[3], r: 3.5 })));
      }
    }
    for (let i = 1; i < step; i++) {
      pic.append(arrow(TREE.pos[order[i - 1]], TREE.pos[order[i]], stepColor(i, order.length), { width: i === step - 1 ? 3.4 : 2.2 }));
    }
    for (const [n, [x, y]] of Object.entries(TREE.pos)) {
      const at = visited.get(n);
      const current = step > 0 && order[step - 1] === n;
      pic.append(svg('g', { class: `walk-node${at !== undefined ? ' is-visited' : ''}${current ? ' is-current' : ''}` },
        svg('circle', { cx: x, cy: y, r: 17, style: at !== undefined ? `--step:${stepColor(at, order.length)}` : null }),
        svg('text', { x, y }, n),
        at !== undefined ? svg('g', { class: 'walk-badge' },
          svg('circle', { cx: x + 15, cy: y - 14, r: 9, fill: stepColor(at, order.length) }),
          svg('text', { x: x + 15, y: y - 14 }, at + 1)) : null));
    }

    clear(seq).append(...order.map((n, i) => el('span', {
      class: `walk-chip${i < step ? ' is-done' : ''}${i === step - 1 ? ' is-current' : ''}`,
      style: i < step ? `--step:${stepColor(i, order.length)}` : null,
    }, n)));
    const hint = {
      pre: tr('Флажок слева: обводи дерево пунктиром против часовой, начиная слева от корня, и записывай узел, когда проходишь его флажок — при первой встрече.',
        'Flag on the left: trace the dotted contour counter-clockwise, starting left of the root, and write a node down when you pass its flag — on the first visit.'),
      in: tr('Флажок снизу: узел записываешь, когда пунктир проходит под ним. Проще: читай узлы слева направо по горизонтали.',
        'Flag below: write a node down when the contour passes under it. Simpler: read the nodes from left to right across the picture.'),
      post: tr('Флажок справа: узел записываешь, когда пунктир уходит от него вправо-вверх — при последней встрече.',
        'Flag on the right: write a node down when the contour leaves it to the upper right — on the last visit.'),
      bfs: tr('Читай по строкам: уровень за уровнем, каждый слева направо.', 'Read row by row: level by level, each from left to right.'),
    }[mode];
    why.textContent = step === 0
      ? tr(`${hint} Нажми «Шаг →» или стрелку вправо, чтобы пройти по шагам.`, `${hint} Press “Step →” or the right arrow key to go step by step.`)
      : tr(`Шаг ${step} из ${order.length}. ${walk[step - 1].why}`, `Step ${step} of ${order.length}. ${walk[step - 1].why}`);
    controls.prev.disabled = step === 0;
    controls.next.disabled = step === order.length;
  };

  clear(box).append(modesSlot, pic, seq, why, controls.node);
  render();
}

/* ── Graph traversal: DFS and BFS ─────────────────────────────────────── */

const GRAPHS = {
  exam: {
    label: { ru: 'Граф из 2025S·Q6', en: 'Graph from 2025S·Q6' },
    // Laid out as in the question's figure.
    pos: { A: [70, 50], D: [220, 50], E: [350, 50], B: [70, 165], C: [180, 165], F: [300, 165] },
    edges: [['A', 'B'], ['B', 'C'], ['B', 'D'], ['C', 'F'], ['D', 'E'], ['D', 'F']],
  },
  big: {
    label: { ru: 'Граф побольше', en: 'Larger graph' },
    pos: { A: [50, 110], B: [150, 45], C: [150, 175], D: [260, 30], E: [260, 110], F: [260, 190], G: [370, 60], H: [370, 165] },
    edges: [['A', 'B'], ['A', 'C'], ['B', 'D'], ['B', 'E'], ['C', 'E'], ['C', 'F'], ['D', 'G'], ['E', 'G'], ['E', 'H'], ['F', 'H']],
  },
};

const GRAPH_MODES = [
  ['stack', { ru: 'DFS · стек (как в ключе ITPEC)', en: 'DFS · stack (as in the ITPEC key)' }],
  ['rec', { ru: 'DFS · рекурсия', en: 'DFS · recursion' }],
  ['bfs', { ru: 'BFS · очередь', en: 'BFS · queue' }],
];

function neighbours(graph, n) {
  return graph.edges.flatMap(([a, b]) => (a === n ? [b] : b === n ? [a] : [])).sort();
}

/**
 * The walk as states: [0] before the first visit, then one per visited node —
 * which node, where it came from, what the stack or queue holds now and what
 * was just added to it.
 */
function graphWalk(graph, mode, start = 'A') {
  const states = [];
  if (mode === 'rec') {
    const seen = new Set();
    const path = [];
    states.push({ container: [], added: [], note: tr(`Начинаем с ${start}: вызов visit(${start}).`, `Start at ${start}: call visit(${start}).`) });
    const visit = (n, from) => {
      seen.add(n);
      path.push(n);
      const next = neighbours(graph, n).filter((m) => !seen.has(m));
      states.push({
        visit: n, from, container: [...path], added: [n],
        note: tr(`Пришли в ${n}${from ? ` из ${from}` : ''} и записали. `, `Visited ${n}${from ? ` from ${from}` : ''} and wrote it down. `)
          + (next.length
            ? tr(`Дальше — первый по алфавиту непосещённый сосед: ${next[0]}.`, `Next: the first unvisited neighbour in alphabetical order, ${next[0]}.`)
            : tr('Непосещённых соседей нет — возвращаемся назад по стеку вызовов.', 'No unvisited neighbours — return back along the call stack.')),
      });
      for (const m of neighbours(graph, n)) if (!seen.has(m)) visit(m, n);
      path.pop();
    };
    visit(start, null);
    return states;
  }

  // Stack and queue walks mark a node when it is put in, as the ITPEC key does.
  const container = [start];
  const marked = new Set([start]);
  const from = {};
  states.push({ container: [...container], added: [start], note: tr(`Начало: кладём ${start} ${mode === 'bfs' ? 'в очередь' : 'в стек'} и отмечаем.`, `Start: ${mode === 'bfs' ? `enqueue ${start}` : `push ${start} onto the stack`} and mark it.`) });
  while (container.length) {
    const n = mode === 'bfs' ? container.shift() : container.pop();
    const added = [];
    for (const m of neighbours(graph, n)) {
      if (marked.has(m)) continue;
      marked.add(m);
      from[m] = n;
      container.push(m);
      added.push(m);
    }
    const take = mode === 'bfs'
      ? tr(`Взяли ${n} из начала очереди и записали.`, `Dequeued ${n} from the front of the queue and wrote it down.`)
      : tr(`Сняли ${n} с вершины стека и записали.`, `Popped ${n} off the top of the stack and wrote it down.`);
    const put = !added.length ? tr(' Новых соседей нет.', ' No new neighbours.')
      : mode === 'bfs' ? tr(` Поставили в конец очереди: ${added.join(', ')}.`, ` Enqueued at the back: ${added.join(', ')}.`)
        : tr(` Положили соседей по алфавиту: ${added.join(', ')} — наверху оказался ${added[added.length - 1]}.`,
          ` Pushed the neighbours in alphabetical order: ${added.join(', ')} — ${added[added.length - 1]} is now on top.`);
    states.push({ visit: n, from: from[n] || null, container: [...container], added, note: take + put });
  }
  return states;
}

function mountGraph(box) {
  let graphId = 'exam';
  let mode = 'stack';
  let step = 0;
  box.classList.add('walk');
  box.setAttribute('tabindex', '0');

  const graphSlot = el('div', {});
  const modesSlot = el('div', {});
  const pic = svg('svg', { class: 'walk-svg', viewBox: '0 0 420 220', role: 'img', 'aria-label': tr('Неориентированный граф', 'Undirected graph') });
  const store = el('div', { class: 'walk-store' });
  const seq = el('div', { class: 'walk-seq' });
  const why = el('p', { class: 'walk-why' });
  const controls = stepper(box, {
    onStep: (d) => {
      const states = graphWalk(GRAPHS[graphId], mode);
      const last = states.length - 1;
      if (d === 'reset') step = 0;
      else if (d === 'end') step = last;
      else step = Math.min(last, Math.max(0, step + d));
      render();
    },
  });

  const render = () => {
    const graph = GRAPHS[graphId];
    const states = graphWalk(graph, mode);
    const visits = states.slice(1).map((s) => s.visit);
    const total = visits.length;
    const state = states[step];
    const shown = states.slice(1, step + 1);
    const order = new Map(shown.map((s, i) => [s.visit, i]));

    clear(graphSlot).append(modeChips(Object.entries(GRAPHS).map(([id, g]) => [id, loc(g.label)]), graphId,
      (id) => { graphId = id; step = 0; render(); }));
    clear(modesSlot).append(modeChips(GRAPH_MODES, mode, (m) => { mode = m; step = 0; render(); }));

    clear(pic);
    for (const [a, b] of graph.edges) {
      pic.append(svg('line', { class: 'walk-edge', x1: graph.pos[a][0], y1: graph.pos[a][1], x2: graph.pos[b][0], y2: graph.pos[b][1] }));
    }
    shown.forEach((s, i) => {
      if (s.from) pic.append(arrow(graph.pos[s.from], graph.pos[s.visit], stepColor(i, total), { bend: 0, width: i === step - 1 ? 3.4 : 2.4 }));
    });
    for (const [n, [x, y]] of Object.entries(graph.pos)) {
      const at = order.get(n);
      const current = state.visit === n;
      const waiting = state.container.includes(n) && at === undefined;
      pic.append(svg('g', { class: `walk-node${at !== undefined ? ' is-visited' : ''}${current ? ' is-current' : ''}${waiting ? ' is-waiting' : ''}` },
        svg('circle', { cx: x, cy: y, r: 17, style: at !== undefined ? `--step:${stepColor(at, total)}` : null }),
        svg('text', { x, y }, n),
        at !== undefined ? svg('g', { class: 'walk-badge' },
          svg('circle', { cx: x + 15, cy: y - 14, r: 9, fill: stepColor(at, total) }),
          svg('text', { x: x + 15, y: y - 14 }, at + 1)) : null));
    }

    const title = mode === 'bfs' ? tr('Очередь', 'Queue') : mode === 'rec' ? tr('Стек вызовов', 'Call stack') : tr('Стек', 'Stack');
    const items = mode === 'bfs' ? state.container : [...state.container].reverse();
    clear(store).append(
      el('div', { class: 'walk-store__head' },
        el('span', { class: 'eyebrow' }, title),
        el('span', { class: 'walk-store__hint' },
          mode === 'bfs' ? tr('начало ← … ← конец', 'front ← … ← back') : tr('верх ↑', 'top ↑'))),
      el('div', { class: `walk-store__items${mode === 'bfs' ? ' is-row' : ''}` },
        ...(items.length
          ? items.map((n) => el('span', { class: `walk-item${state.added.includes(n) ? ' is-new' : ''}` }, n))
          : [el('span', { class: 'walk-store__empty' }, tr('пусто', 'empty'))])));

    clear(seq).append(...visits.map((n, i) => el('span', {
      class: `walk-chip${i < step ? ' is-done' : ''}${i === step - 1 ? ' is-current' : ''}`,
      style: i < step ? `--step:${stepColor(i, total)}` : null,
    }, n)));
    why.textContent = `${step ? tr(`Шаг ${step} из ${total}. `, `Step ${step} of ${total}. `) : ''}${state.note}`;
    controls.prev.disabled = step === 0;
    controls.next.disabled = step === states.length - 1;
  };

  clear(box).append(graphSlot, modesSlot,
    el('div', { class: 'walk-split' }, pic, store),
    seq, why, controls.node);
  render();
}

/* ── Subnet calculator ────────────────────────────────────────────────── */

const SUBNET_EXAMPLES = [
  ['192.168.128.0/22', 'broadcast', '2024A·Q24'],
  ['192.168.57.123/22', 'broadcast', '2020A·Q33'],
  ['192.168.10.0/23', 'broadcast', '2024S·Q24'],
  ['192.168.128.0/26', 'broadcast', '2022S·Q34'],
  ['172.16.64.0/23', { ru: 'сколько узлов', en: 'how many hosts' }, '2022S·Q33'],
  ['192.168.10.0/26', { ru: 'сколько узлов', en: 'how many hosts' }, '2023S·Q33'],
  ['10.170.70.19 255.255.255.240', { ru: 'адрес сети', en: 'network address' }, '2020S·Q34'],
  ['192.168.22.31/27', { ru: 'маска', en: 'subnet mask' }, '2022A·Q32'],
  ['192.168.1.17/28', { ru: 'та же подсеть, что .29?', en: 'same subnet as .29?' }, '2018S·Q33'],
];

function parseAddress(text) {
  const m = text.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*(?:\/\s*(\d{1,2})|\s+(\d{1,3}(?:\.\d{1,3}){3}))?$/);
  if (!m) return null;
  const toInt = (s) => s.split('.').map(Number).reduce((acc, o) => (o > 255 ? NaN : acc * 256 + o), 0);
  const ip = toInt(m[1]);
  let prefix = m[2] !== undefined ? Number(m[2]) : null;
  if (m[3]) {
    const mask = toInt(m[3]);
    const bits = mask.toString(2).padStart(32, '0');
    if (!/^1*0*$/.test(bits)) return { error: tr('Маска должна быть единицами слева: 255.255.252.0, а не 255.0.255.0.', 'The subnet mask must be all ones on the left: 255.255.252.0, not 255.0.255.0.') };
    prefix = bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
  }
  if (Number.isNaN(ip)) return { error: tr('Каждая часть адреса — от 0 до 255.', 'Each part of the address is from 0 to 255.') };
  if (prefix === null) return { error: tr('Добавь префикс (/22) или маску через пробел.', 'Add a prefix (/22) or a subnet mask after a space.') };
  if (prefix < 1 || prefix > 30) return { error: tr('Префикс от /1 до /30.', 'The prefix is from /1 to /30.') };
  return { ip, prefix };
}

const dotted = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

function binary(n, prefix) {
  const bits = (n >>> 0).toString(2).padStart(32, '0');
  const parts = [];
  for (let i = 0; i < 32; i++) {
    if (i && i % 8 === 0) parts.push(el('span', { class: 'sn-dot' }, '.'));
    parts.push(el('span', { class: i < prefix ? 'sn-net' : 'sn-host' }, bits[i]));
  }
  return el('span', { class: 'sn-bin' }, ...parts);
}

function mountSubnet(box) {
  box.classList.add('subnet');
  const input = el('input', { type: 'text', class: 'sn-input', value: '192.168.130.77/22', 'aria-label': tr('IP-адрес с префиксом или маской', 'IP address with a prefix or subnet mask'), spellcheck: 'false' });
  const other = el('input', { type: 'text', class: 'sn-input sn-input--short', placeholder: tr('например 192.168.131.200', 'e.g. 192.168.131.200'), 'aria-label': tr('Второй адрес для сравнения', 'Second address to compare'), spellcheck: 'false' });
  const out = el('div', { class: 'sn-out' });

  const render = () => {
    const parsed = parseAddress(input.value);
    if (!parsed || parsed.error) {
      clear(out).append(el('p', { class: 'sn-error' }, parsed ? parsed.error : tr('Формат: 192.168.130.77/22 или 10.170.70.19 255.255.255.240', 'Format: 192.168.130.77/22 or 10.170.70.19 255.255.255.240')));
      return;
    }
    const { ip, prefix } = parsed;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (ip & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    const hostBits = 32 - prefix;
    const octet = Math.floor((prefix - 1) / 8);
    const block = 256 - ((mask >>> (24 - octet * 8)) & 255);
    const row = (label, value, note, bin) => el('tr', {},
      el('th', {}, label), el('td', {}, el('b', { class: 'mono' }, value), bin ? el('div', {}, bin) : null), el('td', { class: 'sn-note' }, note));

    const rows = [
      row(tr('Адрес', 'IP address'), dotted(ip),
        tr(`первые ${plural(prefix, 'бит', 'бита', 'бит')} — сеть, остальные ${hostBits} — узел`, `first ${prefix} bit${prefix === 1 ? '' : 's'} — network, other ${hostBits} — host`),
        binary(ip, prefix)),
      row(tr(`Маска /${prefix}`, `Subnet mask /${prefix}`), dotted(mask),
        tr(`${plural(prefix, 'единица', 'единицы', 'единиц')} подряд, потом нули`, `${prefix} one${prefix === 1 ? '' : 's'} in a row, then zeros`),
        binary(mask, prefix)),
      row(tr('Адрес сети', 'Network address'), dotted(network), tr('все биты узла = 0', 'all host bits = 0'), binary(network, prefix)),
      row(tr('Broadcast', 'Broadcast address'), dotted(broadcast), tr('все биты узла = 1', 'all host bits = 1'), binary(broadcast, prefix)),
      row(tr('Узлы', 'Host range'), `${dotted(network + 1)} – ${dotted(broadcast - 1)}`, tr('от «сеть + 1» до «broadcast − 1»', 'from “network + 1” to “broadcast − 1”')),
      row(tr('Сколько узлов', 'Number of hosts'), `${2 ** hostBits - 2}`, tr(`2^${hostBits} − 2 (без адреса сети и broadcast)`, `2^${hostBits} − 2 (minus the network and broadcast addresses)`)),
      row(tr('Блок', 'Block size'), tr(`${block} в ${octet + 1}-м октете`, `${block} in octet ${octet + 1}`),
        tr(`сети идут шагом ${block}: ${dotted(network)} … ${dotted(broadcast)}`, `networks go in steps of ${block}: ${dotted(network)} … ${dotted(broadcast)}`)),
    ];
    const second = other.value.trim() ? parseAddress(`${other.value.trim()}/${prefix}`) : null;
    if (second && !second.error) {
      const same = ((second.ip & mask) >>> 0) === network;
      rows.push(row(tr('Второй адрес', 'Second address'), dotted(second.ip),
        same ? tr('та же подсеть', 'same subnet') : tr(`другая подсеть: ${dotted((second.ip & mask) >>> 0)}`, `different subnet: ${dotted((second.ip & mask) >>> 0)}`),
        binary(second.ip, prefix)));
    }
    clear(out).append(el('div', { class: 'tw' }, el('table', { class: 'sn-table' }, ...rows)));
  };

  input.addEventListener('input', render);
  other.addEventListener('input', render);
  box.append(
    el('div', { class: 'sn-form' },
      el('label', {}, el('span', { class: 'lbl' }, tr('Адрес / префикс или маска', 'Address / prefix or subnet mask')), input),
      el('label', {}, el('span', { class: 'lbl' }, tr('Сравнить с адресом (та же подсеть?)', 'Compare with an address (same subnet?)')), other)),
    el('div', { class: 'sn-examples' },
      el('span', { class: 'lbl' }, tr('Задачи из банка — нажми, чтобы подставить', 'Questions from the bank — click one to fill it in')),
      el('div', { class: 'chips' }, ...SUBNET_EXAMPLES.map(([value, what, src]) => el('button', {
        type: 'button', class: 'chip',
        onclick: () => {
          input.value = value;
          other.value = src === '2018S·Q33' ? '192.168.1.29' : '';
          render();
        },
      }, `${value} · ${loc(what)}`)))),
    out);
  render();
}

/* ── Sorting algorithms, step by step ─────────────────────────────────── */

const SORTS = [
  ['bubble', { ru: 'Пузырьком', en: 'Bubble sort' }],
  ['selection', { ru: 'Выбором', en: 'Selection sort' }],
  ['insertion', { ru: 'Вставками', en: 'Insertion sort' }],
  ['quick', { ru: 'Быстрая', en: 'Quick sort' }],
  ['merge', { ru: 'Слиянием', en: 'Merge sort' }],
  ['heap', { ru: 'Пирамидальная', en: 'Heap sort' }],
];

const SORT_START = [6, 3, 8, 1, 7, 2, 5];

/**
 * A sort as a list of states: the array after the step, a role per index
 * (compare, moved, special — the pivot, key or current maximum), the indices
 * already in their final place, the part of the array being worked on, the
 * moves of this step as [from, to] index pairs, and what happened.
 */
function sortSteps(kind, start) {
  const a = [...start];
  const n = a.length;
  const steps = [];
  const sorted = new Set();
  let range = null;
  const snap = (roles, note, moves = []) => steps.push({
    arr: [...a], roles, sorted: new Set(sorted), range, moves, note,
  });
  const swap = (i, j) => { [a[i], a[j]] = [a[j], a[i]]; };
  const all = () => { for (let k = 0; k < n; k++) sorted.add(k); range = null; };

  if (kind === 'bubble') {
    snap({}, tr('Пузырёк сравнивает соседей и меняет их местами, если левый больше. За проход наибольший «всплывает» в конец.',
      'Bubble sort compares neighbours and swaps them if the left one is larger. Each pass, the largest “bubbles up” to the end.'));
    for (let p = 0; p < n - 1; p++) {
      let swapped = false;
      range = [0, n - 1 - p];
      for (let j = 0; j < n - 1 - p; j++) {
        if (a[j] > a[j + 1]) {
          const was = `${a[j]} > ${a[j + 1]}`;
          swap(j, j + 1);
          swapped = true;
          snap({ [j]: 'moved', [j + 1]: 'moved' }, tr(`Соседи ${was} — меняем местами.`, `Neighbours ${was} — swap them.`), [[j, j + 1], [j + 1, j]]);
        } else {
          snap({ [j]: 'compare', [j + 1]: 'compare' }, tr(`Соседи ${a[j]} ≤ ${a[j + 1]} — оставляем.`, `Neighbours ${a[j]} ≤ ${a[j + 1]} — leave them.`));
        }
      }
      sorted.add(n - 1 - p);
      snap({}, tr(`Проход ${p + 1} закончен: ${a[n - 1 - p]} — наибольший из оставшихся — встал на место.`,
        `Pass ${p + 1} done: ${a[n - 1 - p]}, the largest of those left, is in its final place.`));
      if (!swapped) {
        all();
        snap({}, tr('За весь проход не было ни одного обмена — массив отсортирован.', 'Not a single swap in the whole pass — the array is sorted.'));
        return steps;
      }
    }
    all();
    snap({}, tr('Готово. Сравнений в худшем случае ≈ n²/2 — O(n²).', 'Done. Worst case ≈ n²/2 comparisons — O(n²).'));
    return steps;
  }

  if (kind === 'selection') {
    snap({}, tr('Выбором: находим наибольший в неотсортированной части и одним обменом ставим его в её конец. Так в ключе ITPEC (2024A·Q7).',
      'Selection sort: find the largest element of the unsorted part and move it to that part’s end with one swap. This is how the ITPEC key does it (2024A·Q7).'));
    for (let end = n - 1; end > 0; end--) {
      range = [0, end];
      let m = 0;
      snap({ 0: 'special' }, tr(`Ищем наибольший среди позиций 0–${end}. Пока наибольший — ${a[0]}.`, `Find the largest among positions 0–${end}. Largest so far: ${a[0]}.`));
      for (let k = 1; k <= end; k++) {
        if (a[k] > a[m]) {
          m = k;
          snap({ [m]: 'special' }, tr(`${a[k]} больше — теперь наибольший ${a[k]}.`, `${a[k]} is larger — now the largest is ${a[k]}.`));
        } else {
          snap({ [m]: 'special', [k]: 'compare' }, tr(`${a[k]} не больше ${a[m]} — наибольший прежний.`, `${a[k]} is not larger than ${a[m]} — the largest stays the same.`));
        }
      }
      if (m !== end) {
        swap(m, end);
        snap({ [end]: 'moved', [m]: 'moved' }, tr(`Меняем наибольший ${a[end]} с последним элементом отрезка (${a[m]}).`,
          `Swap the largest, ${a[end]}, with the last element of the range (${a[m]}).`), [[m, end], [end, m]]);
      } else {
        snap({ [end]: 'special' }, tr(`Наибольший ${a[end]} уже последний — обмен не нужен.`, `The largest, ${a[end]}, is already last — no swap needed.`));
      }
      sorted.add(end);
    }
    all();
    snap({}, tr('Готово. Обменов не больше n − 1, но сравнений всё равно ≈ n²/2 — O(n²).', 'Done. At most n − 1 swaps, but still ≈ n²/2 comparisons — O(n²).'));
    return steps;
  }

  if (kind === 'insertion') {
    // The left part is sorted among itself but not final yet: its own colour.
    let partEnd = 0;
    const part = (roles) => {
      const out = { ...roles };
      for (let k = 0; k <= partEnd; k++) if (!out[k]) out[k] = 'part';
      return out;
    };
    snap(part({}), tr('Вставками: слева растёт отсортированная часть. Очередной элемент (ключ) сдвигаем влево, пока слева от него больший.',
      'Insertion sort: a sorted part grows on the left. The next element (the key) moves left while the element to its left is larger.'));
    for (let i = 1; i < n; i++) {
      range = [0, i];
      const key = a[i];
      snap(part({ [i]: 'special' }), tr(`Берём ключ ${key} и вставляем его в отсортированную часть 0–${i - 1}.`, `Take the key ${key} and insert it into the sorted part 0–${i - 1}.`));
      let j = i;
      while (j > 0 && a[j - 1] > a[j]) {
        const bigger = a[j - 1];
        swap(j - 1, j);
        snap(part({ [j - 1]: 'special', [j]: 'moved' }), tr(`${bigger} > ${key} — ${bigger} сдвигается вправо, ключ — на шаг влево.`,
          `${bigger} > ${key} — ${bigger} shifts right, the key moves one place left.`), [[j - 1, j], [j, j - 1]]);
        j--;
      }
      partEnd = i;
      snap(part({ [j]: 'special' }), j === i
        ? tr(`Слева от ${key} меньший элемент — ключ остаётся на месте.`, `The element left of ${key} is smaller — the key stays where it is.`)
        : tr(`Ключ ${key} встал на место: ${j ? `слева ${a[j - 1]} меньше` : 'это начало массива'}.`,
          `The key ${key} is in place: ${j ? `${a[j - 1]} on its left is smaller` : 'it is the start of the array'}.`));
    }
    all();
    snap({}, tr('Готово. В худшем случае O(n²), но на почти отсортированных данных очень быстро.', 'Done. O(n²) in the worst case, but very fast on nearly sorted data.'));
    return steps;
  }

  if (kind === 'quick') {
    snap({}, tr('Быстрая: выбираем опорный элемент (pivot), меньшие собираем слева, большие справа, pivot встаёт между ними. Потом то же для каждой части.',
      'Quick sort: pick a pivot, gather the smaller elements on the left and the larger on the right; the pivot goes between them. Then the same for each part.'));
    const quick = (lo, hi) => {
      if (lo > hi) return;
      range = [lo, hi];
      if (lo === hi) {
        sorted.add(lo);
        snap({}, tr(`Отрезок из одного элемента (${a[lo]}) — он уже на месте.`, `A range of one element (${a[lo]}) — it is already in place.`));
        return;
      }
      const pivot = a[hi];
      snap({ [hi]: 'special' }, tr(`Отрезок ${lo}–${hi}: pivot — последний элемент, ${pivot}. Меньшие ${pivot} соберём слева.`,
        `Range ${lo}–${hi}: the pivot is the last element, ${pivot}. Elements smaller than ${pivot} go to the left.`));
      let i = lo;
      for (let j = lo; j < hi; j++) {
        if (a[j] < pivot) {
          if (i !== j) {
            swap(i, j);
            snap({ [i]: 'moved', [j]: 'moved', [hi]: 'special' }, tr(`${a[i]} < ${pivot} — переносим в левую группу (обмен с позицией ${i}).`,
              `${a[i]} < ${pivot} — move it to the left group (swap with position ${i}).`), [[j, i], [i, j]]);
          } else {
            snap({ [j]: 'compare', [hi]: 'special' }, tr(`${a[j]} < ${pivot} — уже в левой группе.`, `${a[j]} < ${pivot} — already in the left group.`));
          }
          i++;
        } else {
          snap({ [j]: 'compare', [hi]: 'special' }, tr(`${a[j]} ≥ ${pivot} — остаётся справа.`, `${a[j]} ≥ ${pivot} — stays on the right.`));
        }
      }
      if (i !== hi) {
        swap(i, hi);
        sorted.add(i);
        snap({ [i]: 'moved', [hi]: 'moved' }, tr(`Ставим pivot ${pivot} между группами, на позицию ${i}: он на своём месте.`,
          `Put the pivot ${pivot} between the groups, at position ${i}: it is in its final place.`), [[hi, i], [i, hi]]);
      } else {
        sorted.add(i);
        snap({ [i]: 'special' }, tr(`Все меньше pivot ${pivot} — он остаётся последним и уже на месте.`, `All are smaller than the pivot ${pivot} — it stays last and is already in place.`));
      }
      quick(lo, i - 1);
      quick(i + 1, hi);
    };
    quick(0, n - 1);
    all();
    snap({}, tr('Готово. В среднем O(n log n), в худшем (неудачный pivot) — O(n²).', 'Done. O(n log n) on average, O(n²) in the worst case (a bad pivot).'));
    return steps;
  }

  if (kind === 'merge') {
    snap({}, tr('Слиянием: делим массив пополам, пока не останутся куски по одному, потом сливаем пары кусков, каждый раз беря меньший из двух первых.',
      'Merge sort: split the array in halves until the pieces are single elements, then merge pairs of pieces, each time taking the smaller of the two front elements.'));
    const ms = (lo, hi) => {
      if (lo >= hi) return;
      const mid = Math.floor((lo + hi) / 2);
      range = [lo, hi];
      snap({}, tr(`Делим отрезок ${lo}–${hi} пополам: ${lo}–${mid} и ${mid + 1}–${hi}.`, `Split the range ${lo}–${hi} in half: ${lo}–${mid} and ${mid + 1}–${hi}.`));
      ms(lo, mid);
      ms(mid + 1, hi);
      const left = [];
      const right = [];
      for (let k = lo; k <= mid; k++) left.push({ v: a[k], from: k });
      for (let k = mid + 1; k <= hi; k++) right.push({ v: a[k], from: k });
      const merged = [];
      let l = 0;
      let r = 0;
      while (l < left.length || r < right.length) {
        if (r >= right.length || (l < left.length && left[l].v <= right[r].v)) merged.push(left[l++]);
        else merged.push(right[r++]);
      }
      merged.forEach((m, k) => { a[lo + k] = m.v; });
      range = [lo, hi];
      const roles = {};
      for (let k = lo; k <= hi; k++) roles[k] = 'moved';
      if (lo === 0 && hi === n - 1) all();
      snap(roles,
        tr(`Сливаем [${left.map((x) => x.v).join(', ')}] и [${right.map((x) => x.v).join(', ')}] → [${merged.map((x) => x.v).join(', ')}].`,
          `Merge [${left.map((x) => x.v).join(', ')}] and [${right.map((x) => x.v).join(', ')}] → [${merged.map((x) => x.v).join(', ')}].`),
        merged.map((m, k) => [m.from, lo + k]).filter(([f, t]) => f !== t));
    };
    ms(0, n - 1);
    all();
    snap({}, tr('Готово. Всегда O(n log n), но нужна дополнительная память под слияние.', 'Done. Always O(n log n), but merging needs extra memory.'));
    return steps;
  }

  // Heap sort: the array is a tree — children of i at 2i + 1 and 2i + 2.
  snap({}, tr('Пирамидальная: массив — это дерево (дети i — на 2i+1 и 2i+2). Строим кучу, где родитель больше детей, потом корень — максимум — уносим в конец.',
    'Heap sort: the array is a tree (the children of i are at 2i+1 and 2i+2). Build a heap where every parent is larger than its children, then move the root — the maximum — to the end.'));
  const sift = (root, end) => {
    let r = root;
    while (2 * r + 1 <= end) {
      let c = 2 * r + 1;
      if (c + 1 <= end && a[c] < a[c + 1]) c++;
      if (a[r] >= a[c]) {
        snap({ [r]: 'compare', [c]: 'compare' }, tr(`${a[r]} не меньше большего ребёнка ${a[c]} — просеивание закончено.`, `${a[r]} is not smaller than its larger child ${a[c]} — sift-down done.`));
        return;
      }
      const parent = a[r];
      swap(r, c);
      snap({ [r]: 'moved', [c]: 'moved' }, tr(`Родитель ${parent} меньше большего ребёнка ${a[r]} — меняем, ${parent} опускается.`,
        `Parent ${parent} is smaller than its larger child ${a[r]} — swap; ${parent} moves down.`), [[r, c], [c, r]]);
      r = c;
    }
  };
  range = [0, n - 1];
  for (let s = Math.floor((n - 2) / 2); s >= 0; s--) {
    snap({ [s]: 'special' }, tr(`Строим кучу: просеиваем ${a[s]} (позиция ${s}, дети на ${2 * s + 1}${2 * s + 2 < n ? ` и ${2 * s + 2}` : ''}).`,
      `Build the heap: sift down ${a[s]} (position ${s}, children at ${2 * s + 1}${2 * s + 2 < n ? ` and ${2 * s + 2}` : ''}).`));
    sift(s, n - 1);
  }
  snap({ 0: 'special' }, tr(`Куча готова: наибольший, ${a[0]}, в корне (позиция 0).`, `The heap is built: the largest, ${a[0]}, is at the root (position 0).`));
  for (let end = n - 1; end > 0; end--) {
    range = [0, end];
    swap(0, end);
    sorted.add(end);
    snap({ 0: 'moved', [end]: 'moved' }, tr(`Корень ${a[end]} — наибольший в куче — меняем с последним (позиция ${end}): он на месте.`,
      `The root ${a[end]}, the largest in the heap, is swapped with the last element (position ${end}): it is in its final place.`), [[0, end], [end, 0]]);
    range = [0, end - 1];
    if (end > 1) sift(0, end - 1);
  }
  all();
  snap({}, tr('Готово. Всегда O(n log n) и без дополнительной памяти.', 'Done. Always O(n log n), with no extra memory.'));
  return steps;
}

function mountSort(box) {
  let kind = 'bubble';
  let data = [...SORT_START];
  let step = 0;
  box.classList.add('walk');
  box.setAttribute('tabindex', '0');

  const modesSlot = el('div', {});
  const pic = svg('svg', { class: 'sort-svg', role: 'img', 'aria-label': tr('Массив, который сортируется по шагам', 'Array being sorted step by step') });
  const counter = el('span', { class: 'sort-counter' });
  const why = el('p', { class: 'walk-why' });
  const shuffle = el('button', {
    type: 'button', class: 'btn btn--ghost btn--sm',
    onclick: () => {
      const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      data = pool.slice(0, SORT_START.length);
      step = 0;
      render();
    },
  }, tr('Другой массив', 'New array'));
  // Printed, a sort is best left at its starting array and description.
  const controls = stepper(box, {
    printAt: null,
    onStep: (d) => {
      const steps = sortSteps(kind, data);
      if (d === 'reset') step = 0;
      else if (d === 'end') step = steps.length - 1;
      else step = Math.min(steps.length - 1, Math.max(0, step + d));
      render();
    },
  });
  controls.node.append(shuffle);

  const W = 52;
  const PAD = 10;
  const render = () => {
    const steps = sortSteps(kind, data);
    const s = steps[step];
    const max = Math.max(...s.arr);
    const width = PAD * 2 + s.arr.length * W;
    pic.setAttribute('viewBox', `0 0 ${width} 205`);
    clear(modesSlot).append(modeChips(SORTS, kind, (k) => { kind = k; step = 0; render(); }));

    clear(pic);
    s.arr.forEach((v, i) => {
      const x = PAD + i * W;
      const role = s.sorted.has(i) ? 'sorted' : (s.roles[i] || '');
      const out = s.range && (i < s.range[0] || i > s.range[1]) && !s.sorted.has(i);
      const h = Math.max(8, Math.round((v / max) * 62));
      pic.append(svg('g', { class: `sort-cell${role ? ` is-${role}` : ''}${out ? ' is-out' : ''}` },
        svg('text', { class: 'sort-index', x: x + 22, y: 10 }, i),
        svg('rect', { class: 'sort-bar', x: x + 8, y: 80 - h, width: 28, height: h, rx: 2 }),
        svg('rect', { class: 'sort-box', x, y: 86, width: 44, height: 40, rx: 4 }),
        svg('text', { class: 'sort-value', x: x + 22, y: 106 }, v)));
    });
    // What moved where: an arc under the boxes from the old place to the new one.
    for (const [from, to] of s.moves) {
      const x1 = PAD + from * W + 22;
      const x2 = PAD + to * W + 22;
      const depth = Math.min(70, 18 + Math.abs(to - from) * 9) + (from > to ? 6 : 0);
      const y = 130;
      pic.append(svg('g', { class: 'sort-move' },
        svg('path', { d: `M${x1},${y} C${x1},${y + depth} ${x2},${y + depth} ${x2},${y + 4}` }),
        svg('polygon', { points: `${x2},${y} ${x2 - 5},${y + 9} ${x2 + 5},${y + 9}` })));
    }

    counter.textContent = tr(`Шаг ${step} из ${steps.length - 1}`, `Step ${step} of ${steps.length - 1}`);
    why.textContent = s.note;
    controls.prev.disabled = step === 0;
    controls.next.disabled = step === steps.length - 1;
  };

  clear(box).append(
    modesSlot,
    el('div', { class: 'tw' }, pic),
    el('div', { class: 'sort-legend' },
      el('span', { class: 'sort-key is-compare' }, tr('сравниваем', 'compared')),
      el('span', { class: 'sort-key is-moved' }, tr('переставили', 'moved')),
      el('span', { class: 'sort-key is-special' }, tr('pivot · ключ · наибольший', 'pivot · key · largest')),
      el('span', { class: 'sort-key is-sorted' }, tr('на своём месте', 'in final place')),
      el('span', { class: 'sort-key is-part' }, tr('отсортированная часть (вставки)', 'sorted part (insertion sort)')),
      el('span', { class: 'sort-key is-out' }, tr('вне текущего отрезка', 'outside the current range')),
      counter),
    why, controls.node);
  render();
}

/* ── Page replacement ─────────────────────────────────────────────────── */

const PAGING_METHODS = [['fifo', 'FIFO'], ['lru', 'LRU'], ['lfu', 'LFU'], ['opt', 'OPT']];

// The first one is where the methods part ways most: FIFO 6, LRU 9, LFU 9, OPT 6.
const PAGING_EXAMPLES = [
  { refs: [1, 3, 2, 1, 4, 5, 2, 3, 4, 5], frames: 3, src: '2019S·Q19, 2022A·Q17' },
  { refs: [1, 2, 3, 2, 1, 4, 5], frames: 3, src: '2025A·Q15' },
  { refs: [1, 2, 3, 4, 5, 2, 1, 3, 2, 6], frames: 4, src: '2015A·Q17' },
  { refs: [2, 4, 1, 1, 2, 7, 3, 4, 6, 5, 5, 1, 2], frames: 3, src: '2020S·Q18' },
];

// The panel title and the unit of the number each method judges by. In English
// the LFU count is written as "3×".
const PAGING_STORE = {
  fifo: [{ ru: 'Очередь загрузки', en: 'Load order' }, { ru: 'шаг загрузки', en: 'loaded at step' }],
  lru: [{ ru: 'Последнее обращение', en: 'Last reference' }, { ru: 'шаг обращения', en: 'used at step' }],
  lfu: [{ ru: 'Обращений с загрузки', en: 'References since load' }, { ru: 'раз', en: '×' }],
  opt: [{ ru: 'Следующее обращение', en: 'Next reference' }, { ru: 'шаг', en: 'step' }],
};

/**
 * One state per reference (plus the empty start): the frames after it, what
 * happened (hit / fill / replace), the evicted page, and the pages in memory
 * ordered by who goes next, each with the number the method judges by.
 * LFU counts references since the page was loaded and breaks ties by load
 * time — the reading that matches 2022A·Q17's key (FIFO 6, LFU 9).
 */
function pagingSteps(method, refs, size) {
  const frames = Array(size).fill(null);
  const loaded = new Map();
  const used = new Map();
  const count = new Map();
  let faults = 0;
  let replaced = 0;
  const nextUse = (page, t) => {
    const k = refs.indexOf(page, t + 1);
    return k < 0 ? Infinity : k + 1;
  };
  const metric = (page, t) => ({
    fifo: loaded.get(page), lru: used.get(page), lfu: count.get(page), opt: nextUse(page, t),
  })[method];
  // Pages in memory, the next victim first.
  const ranked = (t) => frames.filter((p) => p !== null).sort((a, b) => {
    const d = method === 'opt' ? metric(b, t) - metric(a, t) : metric(a, t) - metric(b, t);
    return d || loaded.get(a) - loaded.get(b);
  });
  const queue = (t) => ranked(t).map((page) => ({ page, value: metric(page, t) }));

  const steps = [{
    frames: [...frames], ref: null, kind: null, victim: null, slot: -1, faults, replaced, queue: [],
    note: tr(`Память на ${plural(size, 'кадр', 'кадра', 'кадров')} пуста. Нажмите «Шаг →»: страницы обращаются по очереди слева направо.`,
      `Memory of ${size} page frame${size === 1 ? '' : 's'} is empty. Press “Step →”: the pages are referenced one by one, from left to right.`),
  }];
  refs.forEach((page, t) => {
    const s = t + 1;
    let slot = frames.indexOf(page);
    let kind = 'hit';
    let victim = null;
    let note;
    if (slot >= 0) {
      note = tr(`Страница ${page} уже в памяти — попадание (hit), ничего не выгружаем.`, `Page ${page} is already in memory — a hit; nothing is evicted.`) + {
        fifo: tr(' FIFO на попадания не смотрит: очередь загрузки не меняется.', ' FIFO ignores hits: the load order does not change.'),
        lru: tr(` Для LRU ${page} теперь самая свежая.`, ` For LRU, ${page} is now the most recently used.`),
        lfu: tr(` Счётчик ${page} растёт до ${count.get(page) + 1}.`, ` The reference count of ${page} goes up to ${count.get(page) + 1}.`),
        opt: tr(' OPT смотрит только вперёд, прошлые обращения ему не важны.', ' OPT only looks ahead; past references do not matter to it.'),
      }[method];
    } else {
      faults++;
      slot = frames.indexOf(null);
      if (slot >= 0) {
        kind = 'fill';
        note = tr(`Страницы ${page} нет в памяти — page fault. Свободный кадр есть: просто загружаем, это ещё не замещение.`,
          `Page ${page} is not in memory — a page fault. There is a free frame: just load it; this is not a replacement yet.`);
      } else {
        kind = 'replace';
        replaced++;
        const order = ranked(t);
        victim = order[0];
        const tie = order.length > 1 && metric(order[1], t) === metric(victim, t);
        const v = metric(victim, t);
        note = tr(`Страницы ${page} нет в памяти — page fault, свободных кадров нет — замещение. `,
          `Page ${page} is not in memory — a page fault, and no frame is free — a page replacement. `) + {
          fifo: tr(`FIFO выгружает ту, что загружена раньше всех: ${victim} (загружена на шаге ${v}).`,
            `FIFO evicts the page loaded first: ${victim} (loaded at step ${v}).`),
          lru: tr(`LRU выгружает ту, к которой дольше всех не обращались: ${victim} (последнее обращение — шаг ${v}).`,
            `LRU evicts the least recently used page: ${victim} (last referenced at step ${v}).`),
          lfu: tr(`LFU выгружает ту, к которой обращались реже всех с момента загрузки: ${victim} (${plural(v, 'раз', 'раза', 'раз')})${tie ? '; при равенстве — загруженную раньше' : ''}.`,
            `LFU evicts the page referenced least often since it was loaded: ${victim} (${v} time${v === 1 ? '' : 's'})${tie ? '; on a tie, the one loaded earlier' : ''}.`),
          opt: v === Infinity
            ? tr(`OPT выгружает ту, что понадобится позже всех: ${victim} больше не встретится${tie ? ' (таких несколько — берём загруженную раньше)' : ''}.`,
              `OPT evicts the page that will be needed latest: ${victim} is never referenced again${tie ? ' (several such pages — take the one loaded earlier)' : ''}.`)
            : tr(`OPT выгружает ту, что понадобится позже всех: ${victim} (следующее обращение — шаг ${v}).`,
              `OPT evicts the page that will be needed latest: ${victim} (next referenced at step ${v}).`),
        }[method];
        slot = frames.indexOf(victim);
        loaded.delete(victim);
        used.delete(victim);
        count.delete(victim);
      }
      frames[slot] = page;
      loaded.set(page, s);
      count.set(page, 0);
    }
    used.set(page, s);
    count.set(page, count.get(page) + 1);
    steps.push({ frames: [...frames], ref: page, kind, victim, slot, faults, replaced, queue: queue(t), note });
  });
  return steps;
}

function mountPaging(box) {
  let method = 'fifo';
  let refs = [...PAGING_EXAMPLES[0].refs];
  let size = PAGING_EXAMPLES[0].frames;
  let step = 0;
  box.classList.add('walk');
  box.setAttribute('tabindex', '0');

  const examplesSlot = el('div', { class: 'chips' });
  const sizeSlot = el('div', { class: 'chips' });
  const modesSlot = el('div', {});
  const table = el('table', { class: 'pg-table' });
  const store = el('div', { class: 'walk-store' });
  const counter = el('span', { class: 'sort-counter' });
  const compare = el('p', { class: 'pg-compare' });
  const why = el('p', { class: 'walk-why' });
  const error = el('p', { class: 'sn-error', hidden: true });
  const printAll = el('div', { class: 'pg-print-only' });
  const input = el('input', {
    class: 'sn-input', type: 'text', inputmode: 'numeric', spellcheck: 'false',
    'aria-label': tr('Строка обращений к страницам', 'Page reference string'),
    value: refs.join(' '),
    oninput: () => {
      const parts = input.value.split(/[\s,;]+/).filter(Boolean);
      const ok = parts.length >= 1 && parts.length <= 24 && parts.every((p) => /^\d{1,2}$/.test(p));
      error.hidden = ok;
      if (!ok) {
        error.textContent = tr('Нужны номера страниц (0–99) через пробел или запятую, не больше 24.', 'Enter page numbers (0–99) separated by spaces or commas, at most 24.');
        return;
      }
      refs = parts.map(Number);
      step = 0;
      render();
    },
  });
  const controls = stepper(box, {
    onStep: (d) => {
      if (d === 'reset') step = 0;
      else if (d === 'end') step = refs.length;
      else step = Math.min(refs.length, Math.max(0, step + d));
      render();
    },
  });
  controls.node.append(el('button', {
    type: 'button', class: 'btn btn--ghost btn--sm',
    onclick: () => {
      const pages = 5 + Math.floor(Math.random() * 3);
      refs = Array.from({ length: 12 }, () => 1 + Math.floor(Math.random() * pages));
      input.value = refs.join(' ');
      error.hidden = true;
      step = 0;
      render();
    },
  }, tr('Другая строка', 'New reference string')));

  const render = () => {
    const steps = pagingSteps(method, refs, size);
    const state = steps[step];

    clear(examplesSlot).append(...PAGING_EXAMPLES.map((ex) => el('button', {
      type: 'button',
      class: `chip${ex.refs.join() === refs.join() && ex.frames === size ? ' is-on' : ''}`,
      onclick: () => { refs = [...ex.refs]; size = ex.frames; input.value = refs.join(' '); error.hidden = true; step = 0; render(); },
    }, tr(`${ex.refs.join(' ')} · ${ex.frames} кадра · ${ex.src}`, `${ex.refs.join(' ')} · ${ex.frames} frames · ${ex.src}`))));
    clear(sizeSlot).append(el('span', { class: 'pg-label' }, tr('Кадров в памяти:', 'Page frames:')),
      ...[2, 3, 4, 5].map((n) => el('button', {
        type: 'button', class: `chip${n === size ? ' is-on' : ''}`,
        onclick: () => { size = n; step = 0; render(); },
      }, String(n))));
    clear(modesSlot).append(modeChips(PAGING_METHODS, method, (m) => { method = m; render(); }));

    clear(table).append(...pagingRows(steps, refs, size, step));
    // On a narrow screen the table scrolls sideways: keep the current step in sight.
    const wrap = table.parentElement;
    const current = table.querySelector('.pg-ref.is-current');
    if (wrap && current && wrap.scrollWidth > wrap.clientWidth) {
      const left = current.offsetLeft - wrap.clientWidth / 2;
      wrap.scrollLeft = Math.max(0, left);
    }

    const [title, unit] = PAGING_STORE[method];
    const label = (item) => (method === 'opt' && item.value === Infinity ? tr('больше нет', 'not used again')
      : method === 'lfu' ? tr(`${item.value} ${unit.ru}`, `${item.value}${unit.en}`) : `${loc(unit)} ${item.value}`);
    clear(store).append(
      el('div', { class: 'walk-store__head' },
        el('span', { class: 'eyebrow' }, loc(title)),
        el('span', { class: 'walk-store__hint' }, tr('выйдет первой ↑', 'evicted first ↑'))),
      el('div', { class: 'walk-store__items' },
        ...(state.queue.length
          ? state.queue.map((item, i) => el('span', { class: `walk-item pg-item${i === 0 && state.queue.length === size ? ' is-next' : ''}` },
              el('b', {}, item.page), el('small', {}, label(item))))
          : [el('span', { class: 'walk-store__empty' }, tr('пусто', 'empty'))])));

    const totals = PAGING_METHODS.map(([id, name]) => {
      const all = pagingSteps(id, refs, size);
      const out = all.filter((s) => s.victim !== null).map((s) => s.victim);
      return el('span', { class: `pg-total${id === method ? ' is-on' : ''}` },
        el('b', {}, name), ` ${all.at(-1).faults} / ${all.at(-1).replaced}`,
        out.length ? el('small', {}, tr(` · выгружены ${out.join(', ')}`, ` · evicted ${out.join(', ')}`)) : null);
    });
    clear(compare).append(el('span', { class: 'muted' }, tr('Вся строка — промахов / из них замещений:', 'Whole string — page faults / replacements among them:')), ...totals);
    // Paper cannot switch methods, so a printout carries the other three tables too.
    clear(printAll).append(...PAGING_METHODS.filter(([id]) => id !== method).map(([id, name]) => {
      const all = pagingSteps(id, refs, size);
      return el('div', { class: 'pg-print-method' },
        el('p', {}, el('b', {}, name), tr(` — промахов ${all.at(-1).faults}, замещений ${all.at(-1).replaced}`,
          ` — page faults ${all.at(-1).faults}, replacements ${all.at(-1).replaced}`)),
        el('div', { class: 'tw' }, el('table', { class: 'pg-table' }, ...pagingRows(all, refs, size, refs.length))));
    }));

    counter.textContent = tr(`Шаг ${step} из ${refs.length} · промахов ${state.faults} · замещений ${state.replaced}`,
      `Step ${step} of ${refs.length} · page faults ${state.faults} · replacements ${state.replaced}`);
    why.textContent = state.note;
    controls.prev.disabled = step === 0;
    controls.next.disabled = step === refs.length;
  };

  clear(box).append(
    el('div', { class: 'pg-setup' },
      el('label', { class: 'pg-label' }, tr('Обращения к страницам', 'Page references'), input),
      sizeSlot),
    error,
    examplesSlot,
    modesSlot,
    el('div', { class: 'walk-split pg-split' }, el('div', { class: 'tw' }, table), store),
    el('div', { class: 'sort-legend' },
      el('span', { class: 'sort-key pg-key is-fill' }, tr('загрузили в свободный кадр', 'loaded into a free frame')),
      el('span', { class: 'sort-key pg-key is-new' }, tr('загрузили вместо выгруженной', 'loaded in place of the evicted page')),
      el('span', { class: 'sort-key pg-key is-hit' }, tr('попадание', 'hit')),
      counter),
    why, compare, printAll, controls.node);
  render();
}

/** The rows of one method's table: steps, references, frames, evicted page, faults. */
function pagingRows(steps, refs, size, step) {
  const cols = refs.map((_, i) => i + 1);
  const cls = (i) => `${i === step ? ' is-current' : ''}${i > step ? ' is-future' : ''}`;
  const rows = [
    el('tr', {}, el('th', {}, tr('Шаг', 'Step')), ...cols.map((i) => el('td', { class: `pg-step${cls(i)}` }, i))),
    el('tr', {}, el('th', {}, tr('Обращение', 'Reference')), ...cols.map((i) => el('td', { class: `pg-ref${cls(i)}` }, refs[i - 1]))),
  ];
  for (let f = 0; f < size; f++) {
    rows.push(el('tr', {}, el('th', {}, tr(`Кадр ${f + 1}`, `Frame ${f + 1}`)), ...cols.map((i) => {
      if (i > step) return el('td', { class: `pg-frame${cls(i)}` }, '');
      const s = steps[i];
      const page = s.frames[f];
      const role = s.slot === f ? (s.kind === 'hit' ? ' is-hit' : s.kind === 'fill' ? ' is-fill' : ' is-new') : '';
      return el('td', { class: `pg-frame${role}${cls(i)}` }, page === null ? '' : page);
    })));
  }
  rows.push(el('tr', {}, el('th', {}, tr('Выгружена', 'Evicted')), ...cols.map((i) => el('td', { class: `pg-victim${cls(i)}` },
    i <= step && steps[i].victim !== null ? steps[i].victim : ''))));
  rows.push(el('tr', {}, el('th', {}, 'Page fault'), ...cols.map((i) => {
    if (i > step) return el('td', { class: `pg-mark${cls(i)}` }, '');
    const k = steps[i].kind;
    const title = {
      hit: tr('попадание', 'hit'),
      fill: tr('промах, загрузка в свободный кадр', 'page fault, loaded into a free frame'),
      replace: tr('промах с замещением', 'page fault with page replacement'),
    }[k];
    return el('td', { class: `pg-mark is-${k}${cls(i)}`, title },
      k === 'hit' ? '·' : 'F');
  })));
  return rows;
}

/* ── RAID: every level at a glance, and a disk you can break ──────────── */

// A stripe per row (A–D); what each disk holds in it. RAID 3 cuts one block
// into bytes (a₁ a₂ a₃), RAID 4 and 5 keep whole blocks (A1 A2 A3); parity is P
// (and Q for RAID 6), a mirror copy repeats the block.
const RAID_ROWS = ['A', 'B', 'C', 'D'];
const SUB = ['₁', '₂', '₃', '₄', '₅', '₆', '₇'];
// `survives` is '1' (any one disk) or a { ru, en } pair; RAID 0 survives none.
const RAID_LEVELS = [
  { id: '0', name: 'RAID 0', min: 2, start: 4, words: 'striping', usable: (n) => n, survives: { ru: 'ни одного', en: 'none' },
    how: { ru: 'Блоки полосы лежат на разных дисках и читаются одновременно — быстро. Копий нет.',
      en: 'The blocks of a stripe sit on different disks and are read at the same time — fast. No redundancy.' } },
  { id: '1', name: 'RAID 1', min: 2, start: 2, words: 'mirroring', usable: () => 1, survives: { ru: 'все, кроме одного', en: 'all but one' },
    how: { ru: 'Каждый диск хранит одно и то же. Объём — как у одного диска.',
      en: 'Every disk holds the same data. The capacity is that of one disk.' } },
  { id: '3', name: 'RAID 3', min: 3, start: 4, words: 'byte-level striping, dedicated parity disk', usable: (n) => n - 1, survives: '1',
    how: { ru: 'Один блок режется на байты по всем дискам данных; чётность — на отдельном диске.',
      en: 'One block is split into bytes across all the data disks; the parity is on a dedicated disk.' } },
  { id: '4', name: 'RAID 4', min: 3, start: 4, words: 'block-level striping, dedicated parity disk', usable: (n) => n - 1, survives: '1',
    how: { ru: 'Целые блоки по дискам, чётность — всегда на одном отдельном диске (он и тормозит запись).',
      en: 'Whole blocks across the disks; the parity is always on one dedicated disk (which is what slows writes down).' } },
  { id: '5', name: 'RAID 5', min: 3, start: 4, words: 'block-level striping with distributed parity', usable: (n) => n - 1, survives: '1',
    how: { ru: 'Как RAID 4, но чётность каждой полосы на другом диске — по диагонали.',
      en: 'Like RAID 4, but the parity of each stripe is on a different disk — diagonally.' } },
  { id: '6', name: 'RAID 6', min: 4, start: 5, words: 'two parity records on different disks', usable: (n) => n - 2, survives: { ru: '2 одновременно', en: '2 at once' },
    how: { ru: 'Две независимые чётности P и Q в каждой полосе: переживает отказ двух дисков.',
      en: 'Two independent parities, P and Q, in every stripe: survives the failure of two disks.' } },
  { id: '10', name: 'RAID 1+0', min: 4, start: 4, even: true, words: 'striping of mirrors', usable: (n) => n / 2, survives: { ru: 'по одному в каждой паре', en: 'one in each pair' },
    how: { ru: 'Диски попарно зеркалятся, а пары объединены striping — скорость RAID 0 и надёжность RAID 1.',
      en: 'The disks are mirrored in pairs, and the pairs are striped — the speed of RAID 0 with the reliability of RAID 1.' } },
];

function raidLayout(level, n) {
  return RAID_ROWS.map((row, r) => {
    const cells = Array.from({ length: n }, () => null);
    if (level === '0') cells.forEach((_, i) => { cells[i] = { kind: 'data', label: `${row}${i + 1}` }; });
    if (level === '1') cells.forEach((_, i) => { cells[i] = { kind: i ? 'copy' : 'data', label: row }; });
    if (level === '10') {
      cells.forEach((_, i) => { cells[i] = { kind: i % 2 ? 'copy' : 'data', label: `${row}${Math.floor(i / 2) + 1}` }; });
    }
    if (['3', '4', '5', '6'].includes(level)) {
      const p = level === '3' || level === '4' ? n - 1 : (((n - 1 - r) % n) + n) % n;
      const q = level === '6' ? (((n - 2 - r) % n) + n) % n : -1;
      let k = 0;
      cells.forEach((_, i) => {
        if (i === p) cells[i] = { kind: 'parity', label: `${row}p` };
        else if (i === q) cells[i] = { kind: 'q', label: `${row}q` };
        else {
          k += 1;
          cells[i] = { kind: 'data', label: level === '3' ? `${row.toLowerCase()}${SUB[k - 1]}` : `${row}${k}` };
        }
      });
    }
    return cells;
  });
}

/** null while the data is safe, else why it is gone. */
function raidLost(level, n, failed) {
  const f = failed.size;
  if (!f) return null;
  if (level === '0') return tr('RAID 0 без избыточности: каждый файл разрезан по всем дискам, и отказ любого из них — потеря всех данных.',
    'RAID 0 has no redundancy: every file is striped across all the disks, so the failure of any one of them loses all the data.');
  if (level === '1') return f === n ? tr('Отказали все копии — данных больше нет нигде.', 'Every copy has failed — the data is gone.') : null;
  if (level === '6') return f > 2 ? tr('Третий отказ: двух чётностей хватает только на два потерянных блока полосы.', 'A third failure: two parities can rebuild only two lost blocks of a stripe.') : null;
  if (level === '10') {
    for (let i = 0; i < n; i += 2) {
      if (failed.has(i) && failed.has(i + 1)) {
        return tr(`Отказали оба диска зеркальной пары ${i / 2 + 1} — её половина каждой полосы потеряна.`,
          `Both disks of mirror pair ${i / 2 + 1} have failed — its half of every stripe is lost.`);
      }
    }
    return null;
  }
  const name = RAID_LEVELS.find((l) => l.id === level).name;
  return f > 1 ? tr(`Два отказа: одной чётности хватает, чтобы восстановить только один блок полосы — ${name} переживает один отказ.`,
    `Two failures: one parity can rebuild only one block of a stripe — ${name} survives a single disk failure.`) : null;
}

function raidSaved(level, n, failed, rows) {
  const [d] = [...failed];
  if (level === '1') {
    const list = [...failed].map((i) => i + 1).join(', ');
    return tr(`Отказ${failed.size > 1 ? 'али диски' : ' диска'} ${list} — копии есть на остальных: массив работает, пока жив хотя бы один диск.`,
      `Disk${failed.size > 1 ? 's' : ''} ${list} failed — the other disks hold copies: the array works while at least one disk is alive.`);
  }
  if (level === '10') {
    const pair = d % 2 ? d - 1 : d + 1;
    return tr(`У диска ${d + 1} есть зеркало в паре — диск ${pair + 1}. Пока в каждой паре жив один диск, данные целы.`,
      `Disk ${d + 1} has a mirror in its pair — disk ${pair + 1}. While one disk in every pair is alive, the data is safe.`);
  }
  if (level === '6' && failed.size === 2) {
    return tr('Две независимые чётности P и Q позволяют пересчитать сразу два потерянных блока каждой полосы.',
      'Two independent parities, P and Q, can recompute two lost blocks of every stripe at once.');
  }
  const row = rows[0];
  const lost = row[d];
  const rest = row.filter((_, i) => i !== d && !failed.has(i) && row[i].kind !== 'q').map((c) => c.label);
  if (lost.kind === 'parity') {
    return tr(`На диске ${d + 1} в полосе A была чётность — данные целы, а чётность пересчитают заново из блоков полосы.`,
      `Disk ${d + 1} held the parity of stripe A — the data is intact, and the parity is recomputed from the stripe’s blocks.`);
  }
  return tr(`Блоки диска ${d + 1} восстанавливаются из остальных: ${lost.label} = ${rest.join(' ⊕ ')} (XOR блоков полосы и её чётности). Так же для каждой полосы.`,
    `The blocks of disk ${d + 1} are rebuilt from the others: ${lost.label} = ${rest.join(' ⊕ ')} (XOR of the stripe’s blocks and its parity). The same for every stripe.`);
}

/** Disks side by side, a stripe per row. `mini` drops the labels for the overview. */
function raidSvg(level, n, { failed = new Set(), lost = false, mini = false, onDisk = null } = {}) {
  const rows = raidLayout(level, n);
  const w = mini ? 22 : 66;
  const gap = mini ? 6 : 14;
  const cellH = mini ? 9 : 26;
  const pad = mini ? 3 : 6;
  const top = level === '10' ? (mini ? 10 : 22) : 2;
  const bodyH = pad * 2 + rows.length * (cellH + 3) - 3;
  const width = n * (w + gap) - gap + 2;
  const height = top + bodyH + (mini ? 2 : 24);
  const root = svg('svg', {
    class: `raid-svg${mini ? ' raid-svg--mini' : ''}`, viewBox: `0 0 ${width} ${height}`,
    // Natural size: four disks should not blow up to the width of the page.
    width: mini ? null : Math.round(width * 1.3), height: mini ? null : Math.round(height * 1.3),
    role: mini ? 'img' : 'group',
    'aria-label': tr(`${RAID_LEVELS.find((l) => l.id === level).name}, ${n} дисков`, `${RAID_LEVELS.find((l) => l.id === level).name}, ${n} disks`),
  });
  if (level === '10') {
    for (let i = 0; i < n; i += 2) {
      const x1 = 1 + i * (w + gap);
      const x2 = x1 + 2 * w + gap;
      root.append(svg('path', { class: 'raid-pair', d: `M${x1},${top - 3} V${top - (mini ? 7 : 10)} H${x2} V${top - 3}` }));
      if (!mini) root.append(svg('text', { class: 'raid-pair-text', x: (x1 + x2) / 2, y: top - 13 }, tr(`зеркало ${i / 2 + 1}`, `mirror ${i / 2 + 1}`)));
    }
  }
  for (let i = 0; i < n; i++) {
    const x = 1 + i * (w + gap);
    const down = failed.has(i);
    const disk = svg('g', {
      class: `raid-disk${down ? ' is-failed' : ''}${onDisk ? ' is-clickable' : ''}`,
      ...(onDisk ? { role: 'button', tabindex: '0', 'aria-pressed': down ? 'true' : 'false',
        'aria-label': tr(`Диск ${i + 1}: ${down ? 'отказал, вернуть' : 'сломать'}`, `Disk ${i + 1}: ${down ? 'failed, restore it' : 'make it fail'}`) } : {}),
    }, svg('rect', { class: 'raid-body', x, y: top, width: w, height: bodyH, rx: mini ? 3 : 7 }));
    rows.forEach((row, r) => {
      const cell = row[i];
      const y = top + pad + r * (cellH + 3);
      disk.append(svg('rect', {
        class: `raid-cell raid-cell--${cell.kind}${down ? (lost ? ' is-lost' : ' is-rebuilt') : ''}`,
        x: x + pad, y, width: w - pad * 2, height: cellH, rx: 2,
      }));
      if (!mini) {
        disk.append(svg('text', { class: 'raid-label', x: x + w / 2, y: y + cellH / 2 }, down && lost ? '✕' : cell.label));
      }
    });
    if (!mini) disk.append(svg('text', { class: 'raid-name', x: x + w / 2, y: top + bodyH + 15 }, down ? tr(`диск ${i + 1} ✕`, `disk ${i + 1} ✕`) : tr(`диск ${i + 1}`, `disk ${i + 1}`)));
    if (onDisk) {
      disk.addEventListener('click', () => onDisk(i));
      disk.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDisk(i); } });
    }
    root.append(disk);
  }
  return root;
}

function mountRaid(box) {
  let level = '5';
  let n = 4;
  let failed = new Set();
  box.classList.add('walk', 'raid');

  const gallery = el('div', { class: 'raid-gallery' });
  const head = el('div', { class: 'raid-head' });
  const stage = el('div', { class: 'raid-stage' });
  const status = el('p', { class: 'walk-why raid-status' });
  const capacity = el('div', { class: 'raid-cap' });
  const compare = el('table', { class: 'raid-compare' });
  const count = el('div', { class: 'chips raid-n' });

  const pick = (id) => {
    level = id;
    const spec = RAID_LEVELS.find((l) => l.id === id);
    n = Math.max(spec.min, spec.start);
    failed = new Set();
    render();
  };

  const render = () => {
    const spec = RAID_LEVELS.find((l) => l.id === level);
    const rows = raidLayout(level, n);
    const lostWhy = raidLost(level, n, failed);

    clear(gallery).append(...RAID_LEVELS.map((l) => el('button', {
      type: 'button', class: `raid-card${l.id === level ? ' is-on' : ''}`, onclick: () => pick(l.id),
      title: `${l.name}: ${l.words}`,
    },
      el('b', {}, l.name),
      raidSvg(l.id, l.id === '1' ? 2 : l.id === '6' ? 5 : 4, { mini: true }),
      el('span', { class: 'raid-card__note' },
        `${formula(l)} · ${l.id === '0' ? tr('0 отказов', '0 failures') : l.survives === '1' ? tr('1 отказ', '1 failure') : loc(l.survives)}`))));

    clear(head).append(
      el('div', {},
        el('b', {}, spec.name), ' — ', el('i', { lang: 'en' }, spec.words),
        el('p', { class: 'raid-how' }, loc(spec.how))),
      count);
    const options = [];
    for (let k = spec.min; k <= 8; k += spec.even ? 2 : 1) options.push(k);
    clear(count).append(el('span', { class: 'pg-label' }, tr('Дисков:', 'Disks:')), ...options.map((k) => el('button', {
      type: 'button', class: `chip${k === n ? ' is-on' : ''}`,
      onclick: () => { n = k; failed = new Set(); render(); },
    }, String(k))));

    clear(stage).append(raidSvg(level, n, {
      failed, lost: Boolean(lostWhy),
      onDisk: (i) => { failed.has(i) ? failed.delete(i) : failed.add(i); render(); },
    }));
    status.classList.toggle('is-lost', Boolean(lostWhy));
    status.classList.toggle('is-saved', failed.size > 0 && !lostWhy);
    status.textContent = !failed.size
      ? tr('Нажми на диск, чтобы он «отказал», — увидишь, переживёт ли массив и как восстанавливаются данные.',
        'Click a disk to make it “fail” — you will see whether the array survives and how the data is rebuilt.')
      : lostWhy || raidSaved(level, n, failed, rows);

    const usable = spec.usable(n);
    const share = Math.round((usable / n) * 100);
    clear(capacity).append(
      el('div', { class: 'raid-bar' },
        el('span', { class: 'raid-bar__data', style: `flex:${usable}` }, tr(`данные ${usable} ТБ`, `data ${usable} TB`)),
        n - usable ? el('span', { class: 'raid-bar__extra', style: `flex:${n - usable}` },
          tr(`${level === '1' || level === '10' ? 'копии' : 'чётность'} ${n - usable} ТБ`, `${level === '1' || level === '10' ? 'copies' : 'parity'} ${n - usable} TB`)) : null),
      el('p', { class: 'raid-cap__text' },
        tr(`${n} дисков по 1 ТБ → полезный объём ${formula(spec)} = `, `${n} disks of 1 TB → usable capacity ${formula(spec)} = `),
        el('b', {}, tr(`${usable} ТБ`, `${usable} TB`)),
        tr(` (${share}%). Переживёт отказ: ${spec.survives === '1' ? 'одного любого диска' : spec.survives.ru}.`,
          ` (${share}%). Disk failures survived: ${spec.survives === '1' ? 'any one disk' : spec.survives.en}.`)));

    clear(compare).append(
      el('tr', {}, el('th', {}, tr('Уровень', 'Level')), el('th', {}, tr(`Полезный объём из ${n} × 1 ТБ`, `Usable capacity of ${n} × 1 TB`)), el('th', {}, tr('Отказов', 'Failures survived'))),
      ...RAID_LEVELS.map((l) => {
        const ok = n >= l.min && (!l.even || n % 2 === 0);
        const u = ok ? l.usable(n) : 0;
        return el('tr', { class: l.id === level ? 'is-on' : '' },
          el('td', {}, l.name),
          el('td', {}, ok
            ? el('span', { class: 'raid-mini-bar' },
              el('span', { class: 'raid-track' }, el('i', { style: `width:${(u / n) * 100}%` })), el('span', {}, tr(`${u} ТБ`, `${u} TB`)))
            : el('span', { class: 'muted' }, l.even && n >= l.min
              ? tr('нужно чётное число дисков', 'needs an even number of disks')
              : tr(`нужно от ${l.min} дисков`, `needs at least ${l.min} disks`))),
          el('td', {}, loc(l.survives)));
      }));
  };

  box.append(
    el('p', { class: 'raid-lede' }, tr('Все уровни на одной картинке: столбик — диск, строка — полоса (stripe) A–D. Нажми на уровень, чтобы разобрать его ниже.',
      'Every level in one picture: a column is a disk, a row is a stripe A–D. Click a level to take it apart below.')),
    gallery,
    el('div', { class: 'raid-legend sort-legend' },
      el('span', { class: 'sort-key raid-key--data' }, tr('данные', 'data')),
      el('span', { class: 'sort-key raid-key--copy' }, tr('копия (зеркало)', 'copy (mirror)')),
      el('span', { class: 'sort-key raid-key--parity' }, tr('чётность P', 'parity P')),
      el('span', { class: 'sort-key raid-key--q' }, tr('вторая чётность Q', 'second parity Q'))),
    el('div', { class: 'raid-sim' }, head, el('div', { class: 'raid-stage-wrap' }, stage), status, capacity),
    el('div', { class: 'tw' }, compare));
  render();
}

function formula(l) {
  return { 0: 'n × S', 1: 'S', 3: '(n − 1) × S', 4: '(n − 1) × S', 5: '(n − 1) × S', 6: '(n − 2) × S', 10: 'n × S ÷ 2' }[l.id];
}

/* ── OSI and TCP/IP: the layer map ────────────────────────────────────── */

// `en` and `ru` are the layer's names; under the English name the map shows the
// Russian one, or in English the layer's job (`role`).
const OSI = [
  { n: 7, en: 'Application', ru: 'прикладной', role: 'user services', pdu: { ru: 'данные', en: 'data' }, tcp: 0,
    does: { ru: 'Сервисы для программ пользователя: веб, почта, файлы, имена, адреса.',
      en: 'Services for user programs: web, e-mail, file transfer, names, addresses.' },
    cue: 'application protocols · services for user programs',
    protocols: ['HTTP', 'HTTPS', 'SMTP', 'POP3', 'IMAP', 'FTP', 'DNS', 'DHCP', 'SNMP', 'SSH', 'Telnet', 'NTP'] },
  { n: 6, en: 'Presentation', ru: 'представления', role: 'data format', pdu: { ru: 'данные', en: 'data' }, tcp: 0,
    does: { ru: 'Формат данных: кодировки символов, сжатие, шифрование.',
      en: 'Data format: character codes, compression, encryption.' },
    cue: 'data format · character code · compression · encryption', protocols: [] },
  { n: 5, en: 'Session', ru: 'сеансовый', role: 'dialogue control', pdu: { ru: 'данные', en: 'data' }, tcp: 0,
    does: { ru: 'Начать, вести и закончить сеанс связи между программами.',
      en: 'Establishes, maintains and terminates the session between programs.' },
    cue: 'establishing, maintaining and terminating sessions', protocols: [] },
  { n: 4, en: 'Transport', ru: 'транспортный', role: 'end-to-end delivery', pdu: { ru: 'сегмент', en: 'segment' }, addr: { ru: 'порт', en: 'port' }, tcp: 1,
    does: { ru: 'Доставка между программами по номеру порта. TCP — с соединением, надёжно и по порядку; UDP — без соединения, быстро, без гарантий.',
      en: 'Delivery between programs by port number. TCP is connection-oriented, reliable and in order; UDP is connectionless, fast, with no guarantees.' },
    cue: 'end-to-end delivery · port number · reliability, order', protocols: ['TCP', 'UDP'] },
  { n: 3, en: 'Network', ru: 'сетевой', role: 'routing', pdu: { ru: 'пакет', en: 'packet' }, addr: { ru: 'IP-адрес', en: 'IP address' }, tcp: 2,
    does: { ru: 'Выбор пути и пересылка пакетов между сетями через маршрутизаторы — по IP-адресу получателя.',
      en: 'Path selection and packet relay between networks through routers, by the destination IP address.' },
    cue: 'path selection and packet relay · routing · IP address', protocols: ['IP', 'ICMP (ping)'] },
  { n: 2, en: 'Data link', ru: 'канальный', role: 'adjacent nodes', pdu: { ru: 'кадр', en: 'frame' }, addr: { ru: 'MAC-адрес', en: 'MAC address' }, tcp: 3,
    does: { ru: 'Кадры между соседними узлами одной сети по MAC-адресу; обнаружение ошибок (FCS), управление потоком.',
      en: 'Frames between adjacent nodes of one network by MAC address; error detection (FCS), flow control.' },
    cue: 'frames · MAC address · error detection · flow control', protocols: ['Ethernet', 'PPP', 'Wi-Fi 802.11'] },
  { n: 1, en: 'Physical', ru: 'физический', role: 'signals', pdu: { ru: 'биты', en: 'bits' }, tcp: 3,
    does: { ru: 'Только сигнал: биты по кабелю, оптике или радио; разъёмы, напряжения.',
      en: 'Signals only: bits over copper cable, optical fibre or radio; connectors, voltages.' },
    cue: 'electrical signals · cables, connectors · bits', protocols: [] },
];
// Under each TCP/IP layer: its Russian name, or in English its main protocols.
const TCPIP = [
  { name: 'Application', sub: { ru: 'прикладной', en: 'HTTP, SMTP, DNS…' }, layers: [7, 6, 5] },
  { name: 'Transport', sub: { ru: 'транспортный', en: 'TCP, UDP' }, layers: [4] },
  { name: 'Internet', sub: { ru: 'межсетевой', en: 'IP, ICMP' }, layers: [3] },
  { name: 'Network interface', sub: { ru: 'сетевой доступ (Link)', en: 'Link · Ethernet' }, layers: [2, 1] },
];
const OSI_DEVICES = [
  { name: { ru: 'Gateway (шлюз)', en: 'Gateway' }, sub: { ru: 'переводит протоколы — уровни 4–7', en: 'converts protocols — layers 4–7' }, layers: [7, 6, 5, 4] },
  { name: 'Router · L3 switch', sub: { ru: 'маршрутизирует по IP', en: 'routes by IP address' }, layers: [3] },
  { name: 'Bridge · L2 switch', sub: { ru: 'switching hub, access point — по MAC', en: 'switching hub, access point — by MAC' }, layers: [2] },
  { name: 'Repeater · hub', sub: { ru: 'усиливает сигнал, шлёт во все порты', en: 'amplifies the signal, sends to all ports' }, layers: [1] },
];

function mountOsi(box) {
  let picked = 3;
  box.classList.add('walk', 'osi');
  const map = el('div', { class: 'osi-map-wrap' });
  const detail = el('div', { class: 'osi-detail' });
  const wrap = el('div', { class: 'osi-encap' });

  const rowH = 40;
  const gapY = 4;
  const y0 = 26;
  const yOf = (layer) => y0 + (7 - layer) * (rowH + gapY);
  const spanY = (layers) => {
    const topY = yOf(Math.max(...layers));
    return { y: topY, h: yOf(Math.min(...layers)) + rowH - topY };
  };
  const cols = { osi: [0, 300], tcp: [314, 166], addr: [494, 86], dev: [594, 246] };
  const W = 840;
  const H = yOf(1) + rowH + 2;

  const render = () => {
    const sel = OSI.find((l) => l.n === picked);
    const root = svg('svg', { class: 'osi-svg', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': tr('Уровни OSI и TCP/IP', 'OSI and TCP/IP layers') });
    const heads = [
      ['osi', tr('OSI · 7 уровней · единица данных', 'OSI · 7 layers · data unit (PDU)')],
      ['tcp', tr('TCP/IP · 4 уровня', 'TCP/IP · 4 layers')],
      ['addr', tr('Адрес', 'Address')],
      ['dev', tr('Устройство', 'Device')],
    ];
    for (const [key, text] of heads) root.append(svg('text', { class: 'osi-colhead', x: cols[key][0] + 2, y: 14 }, text));

    for (const layer of OSI) {
      const y = yOf(layer.n);
      const on = layer.n === picked;
      const row = svg('g', {
        class: `osi-row${on ? ' is-on' : ''}${layer.n <= 4 ? ' is-core' : ''}`, role: 'button', tabindex: '0',
        'aria-pressed': on ? 'true' : 'false', 'aria-label': tr(`Уровень ${layer.n}: ${layer.en}`, `Layer ${layer.n}: ${layer.en}`),
      },
        svg('rect', { class: 'osi-bar', x: cols.osi[0], y, width: cols.osi[1], height: rowH, rx: 4 }),
        svg('circle', { class: 'osi-num', cx: 22, cy: y + rowH / 2, r: 13 }),
        svg('text', { class: 'osi-num-text', x: 22, y: y + rowH / 2 }, String(layer.n)),
        svg('text', { class: 'osi-en', x: 44, y: y + 17 }, layer.en),
        svg('text', { class: 'osi-ru', x: 44, y: y + 32 }, tr(layer.ru, layer.role)),
        svg('text', { class: 'osi-pdu', x: cols.osi[1] - 12, y: y + rowH / 2 }, loc(layer.pdu)));
      row.addEventListener('click', () => { picked = layer.n; render(); });
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picked = layer.n; render(); } });
      root.append(row);
      if (layer.addr) {
        root.append(svg('g', { class: `osi-addr${on ? ' is-on' : ''}` },
          svg('rect', { x: cols.addr[0], y: y + 8, width: cols.addr[1], height: rowH - 16, rx: (rowH - 16) / 2 }),
          svg('text', { x: cols.addr[0] + cols.addr[1] / 2, y: y + rowH / 2 }, loc(layer.addr))));
      }
    }
    TCPIP.forEach((t) => {
      const { y, h } = spanY(t.layers);
      const on = t.layers.includes(picked);
      root.append(svg('g', { class: `osi-tcp${on ? ' is-on' : ''}` },
        svg('rect', { x: cols.tcp[0], y, width: cols.tcp[1], height: h, rx: 4 }),
        svg('text', { class: 'osi-en', x: cols.tcp[0] + cols.tcp[1] / 2, y: y + h / 2 - (t.sub ? 7 : 0) }, t.name),
        svg('text', { class: 'osi-ru', x: cols.tcp[0] + cols.tcp[1] / 2, y: y + h / 2 + 9 }, loc(t.sub))));
    });
    for (const d of OSI_DEVICES) {
      const { y, h } = spanY(d.layers);
      const on = d.layers.includes(picked);
      root.append(svg('g', { class: `osi-dev${on ? ' is-on' : ''}` },
        svg('rect', { x: cols.dev[0], y, width: cols.dev[1], height: h, rx: 4 }),
        svg('text', { class: 'osi-en', x: cols.dev[0] + 12, y: y + h / 2 - 7 }, loc(d.name)),
        svg('text', { class: 'osi-ru', x: cols.dev[0] + 12, y: y + h / 2 + 9 }, loc(d.sub))));
    }
    clear(map).append(root);

    const tcp = TCPIP.find((t) => t.layers.includes(picked));
    const dev = OSI_DEVICES.find((d) => d.layers.includes(picked));
    clear(detail).append(
      el('p', { class: 'osi-detail__title' }, el('b', {}, `${sel.n} · ${sel.en} layer`),
        tr(` — ${sel.ru} уровень · в TCP/IP: ${tcp.name}`, ` — in TCP/IP: ${tcp.name} layer`)),
      el('p', {}, loc(sel.does)),
      el('p', { class: 'cue' }, tr('Ищи в варианте: ', 'Look for in the options: '), el('i', { lang: 'en' }, sel.cue)),
      el('p', { class: 'osi-detail__row' },
        el('span', {}, tr(`Единица: ${sel.pdu.ru}`, `PDU: ${sel.pdu.en}`)),
        sel.addr ? el('span', {}, tr(`Адрес: ${sel.addr.ru}`, `Address: ${sel.addr.en}`)) : null,
        el('span', {}, tr(`Устройство: ${loc(dev.name)}`, `Device: ${loc(dev.name)}`))),
      // Native append() would print a null as the text "null".
      ...(sel.protocols.length ? [el('div', { class: 'osi-protos' }, ...sel.protocols.map((p) => el('span', { class: 'tag' }, p)))] : []));

    clear(wrap).append(...encapsulation(picked));
  };

  box.append(
    el('div', { class: 'tw' }, map),
    detail,
    el('p', { class: 'osi-mnemo' },
      el('b', {}, tr('Запомнить порядок 7 → 1: ', 'Order 7 → 1: ')), el('i', { lang: 'en' }, 'All People Seem To Need Data Processing'),
      ' — Application, Presentation, Session, Transport, Network, Data link, Physical.'),
    el('p', { class: 'raid-lede' }, el('b', {}, tr('Инкапсуляция. ', 'Encapsulation. ')),
      tr('Отправитель передаёт данные сверху вниз, и каждый уровень дописывает свой заголовок; получатель снимает их в обратном порядке. Нажми на уровень в схеме — подсветится его строка.',
        'The sender passes the data down the layers, and each layer adds its own header; the receiver removes them in reverse order. Click a layer in the map to highlight its row.')),
    wrap);
  render();
}

function encapsulation(picked) {
  const part = (cls, text, title) => el('span', { class: `enc-part enc-part--${cls}`, title }, text);
  const data = tr('данные', 'data');
  const rows = [
    { layers: [7, 6, 5], name: 'Application', unit: data, parts: [part('data', data, tr('например, HTTP-запрос', 'e.g. an HTTP request'))] },
    { layers: [4], name: 'Transport', unit: tr('сегмент', 'segment'),
      parts: [part('tcp', tr('TCP: порт 49152 → 80', 'TCP: port 49152 → 80'), tr('порты отправителя и получателя', 'source and destination ports')), part('data', data)] },
    { layers: [3], name: 'Internet', unit: tr('пакет', 'packet'),
      parts: [part('ip', 'IP: 192.168.1.31 → 192.168.2.31', tr('IP-адреса — от отправителя до конечного получателя', 'IP addresses — from the sender to the final destination')),
        part('tcp', 'TCP'), part('data', data)] },
    { layers: [2], name: 'Link', unit: tr('кадр', 'frame'),
      parts: [part('mac', 'MAC: aa… → cc…', tr('MAC-адреса — только до соседнего узла', 'MAC addresses — only as far as the next node')),
        part('ip', 'IP'), part('tcp', 'TCP'), part('data', data), part('fcs', 'FCS', tr('контрольная сумма кадра', 'frame check sequence'))] },
    { layers: [1], name: 'Physical', unit: tr('биты', 'bits'), parts: [part('bits', '0110 1001 1100 0101 …')] },
  ];
  return rows.map((r) => el('div', { class: `enc-row${r.layers.includes(picked) ? ' is-on' : ''}` },
    el('span', { class: 'enc-name' }, el('b', {}, r.name), el('small', {}, r.unit)),
    el('span', { class: 'enc-parts' }, ...r.parts)));
}

/* ── A packet's trip: which device reads which address ────────────────── */

// The network of the №369 question: PC01 → Switch1 → router → Switch2 → PC03.
// The router's second port (192.168.2.11, dd…) is added for the second hop.
const HOP_NODES = [
  { name: 'PC01', sub: '192.168.1.31 · aa…', top: 7, x: 70 },
  { name: 'Switch1', sub: 'L2 switch', top: 2, x: 235 },
  { name: 'Router', sub: '.1.11 cc… | .2.11 dd…', top: 3, x: 420 },
  { name: 'Switch2', sub: 'L2 switch', top: 2, x: 605 },
  { name: 'PC03', sub: '192.168.2.31 · ee…', top: 7, x: 770 },
];
const HOP_STEPS = [
  { at: 0, frame: { dmac: 'cc…', smac: 'aa…', sip: '192.168.1.31', dip: '192.168.2.31' }, changed: [],
    why: { ru: 'PC01 спускает данные вниз по стеку: порт (4), IP-адреса (3), MAC (2). PC03 в другой сети, поэтому кадр адресован маршрутизатору — его MAC cc… PC01 узнал через ARP.',
      en: 'PC01 passes the data down its stack: port (4), IP addresses (3), MAC (2). PC03 is on another network, so the frame is addressed to the router — PC01 learned its MAC cc… through ARP.' } },
  { at: 1, frame: { dmac: 'cc…', smac: 'aa…', sip: '192.168.1.31', dip: '192.168.2.31' }, changed: [],
    why: { ru: 'Switch1 работает на уровне 2: смотрит только MAC получателя cc… и отправляет кадр в порт маршрутизатора. Ничего не меняет.',
      en: 'Switch1 works at layer 2: it reads only the destination MAC cc… and forwards the frame to the router’s port. It changes nothing.' } },
  { at: 2, frame: { dmac: 'ee…', smac: 'dd…', sip: '192.168.1.31', dip: '192.168.2.31' }, changed: ['dmac', 'smac'],
    why: { ru: 'Маршрутизатор поднимает данные до уровня 3: IP получателя 192.168.2.31 — сеть за портом 2. Он собирает новый кадр: MAC источника — свой порт dd…, MAC получателя — PC03 ee… IP-адреса не меняются.',
      en: 'The router takes the data up to layer 3: the destination IP 192.168.2.31 is on the network behind port 2. It builds a new frame: source MAC — its own port dd…, destination MAC — PC03’s ee… The IP addresses do not change.' } },
  { at: 3, frame: { dmac: 'ee…', smac: 'dd…', sip: '192.168.1.31', dip: '192.168.2.31' }, changed: [],
    why: { ru: 'Switch2 так же смотрит только MAC получателя ee… и отдаёт кадр в порт PC03.',
      en: 'Switch2 likewise reads only the destination MAC ee… and forwards the frame to PC03’s port.' } },
  { at: 4, frame: { dmac: 'ee…', smac: 'dd…', sip: '192.168.1.31', dip: '192.168.2.31' }, changed: [],
    why: { ru: 'PC03 поднимает данные вверх: кадр → пакет → сегмент → данные. Порт 80 в сегменте говорит, какой программе их отдать.',
      en: 'PC03 passes the data up: frame → packet → segment → data. Port 80 in the segment tells which program gets it.' } },
];

function mountHops(box) {
  let step = 0;
  box.classList.add('walk', 'hops');
  box.setAttribute('tabindex', '0');
  const scene = el('div', { class: 'hops-scene' });
  const frame = el('table', { class: 'hops-frame' });
  const why = el('p', { class: 'walk-why' });
  const controls = stepper(box, {
    onStep: (d) => {
      if (d === 'reset') step = 0;
      else if (d === 'end') step = HOP_STEPS.length - 1;
      else step = Math.min(HOP_STEPS.length - 1, Math.max(0, step + d));
      render();
    },
  });

  const layerY = (n) => 40 + (7 - n) * 22;
  const render = () => {
    const s = HOP_STEPS[step];
    const root = svg('svg', { class: 'hops-svg', viewBox: '0 0 840 250', role: 'img', 'aria-label': tr('Путь пакета через коммутаторы и маршрутизатор', 'A packet’s path through switches and a router') });
    // Each device's own stack: as high as the layer it reads.
    for (const [i, node] of HOP_NODES.entries()) {
      const on = i === s.at;
      const g = svg('g', { class: `hops-node${on ? ' is-on' : ''}${i < s.at ? ' is-done' : ''}` });
      for (let n = 1; n <= 7; n++) {
        g.append(svg('rect', { class: `hops-layer${n <= node.top ? ' is-used' : ''}`, x: node.x - 34, y: layerY(n) - 9, width: 68, height: 18, rx: 3 }),
          // The number sits at the left edge, clear of the packet's line.
          svg('text', { class: 'hops-layer-text', x: node.x - 24, y: layerY(n) }, n <= node.top ? `${n}` : ''));
      }
      g.append(svg('text', { class: 'hops-name', x: node.x, y: 20 }, node.name),
        svg('text', { class: 'hops-sub', x: node.x, y: 222 }, node.sub));
      root.append(g);
    }
    // The packet's path: down the sender, along the wire, up to each device's top layer and down again.
    const points = [];
    HOP_NODES.forEach((node, i) => {
      if (i === 0) points.push([node.x, layerY(7)], [node.x, layerY(1) + 16]);
      else if (i === HOP_NODES.length - 1) points.push([node.x, layerY(1) + 16], [node.x, layerY(7)]);
      else points.push([node.x - 12, layerY(1) + 16], [node.x - 12, layerY(node.top)], [node.x + 12, layerY(node.top)], [node.x + 12, layerY(1) + 16]);
    });
    // Points reached by this step: everything up to (and through) the current device.
    const upto = [2, 6, 10, 14, 16][s.at];
    const path = (pts, cls) => svg('polyline', { class: cls, points: pts.map((p) => p.join(',')).join(' ') });
    root.append(path(points, 'hops-path'), path(points.slice(0, upto), 'hops-path is-done'));
    const [hx, hy] = points[upto - 1];
    root.append(svg('circle', { class: 'hops-packet', cx: hx, cy: hy, r: 7 }));
    clear(scene).append(root);

    const field = (key, label) => el('tr', { class: s.changed.includes(key) ? 'is-changed' : '' },
      el('th', {}, label), el('td', {}, s.frame[key]));
    clear(frame).append(
      el('caption', {}, step === 2 ? tr('Кадр после маршрутизатора', 'Frame after the router')
        : step > 2 ? tr('Кадр на втором участке', 'Frame on the second link') : tr('Кадр на первом участке', 'Frame on the first link')),
      field('dmac', tr('MAC получателя', 'Destination MAC')), field('smac', tr('MAC источника', 'Source MAC')),
      field('dip', tr('IP получателя', 'Destination IP')), field('sip', tr('IP источника', 'Source IP')));
    why.textContent = tr(`${step + 1} из ${HOP_STEPS.length}. ${s.why.ru}`, `${step + 1} of ${HOP_STEPS.length}. ${s.why.en}`);
    controls.prev.disabled = step === 0;
    controls.next.disabled = step === HOP_STEPS.length - 1;
  };

  box.append(
    el('p', { class: 'raid-lede' }, el('b', {}, tr('Путь пакета. ', 'A packet’s trip. ')),
      tr('Каждое устройство поднимает данные только до своего уровня: коммутатор — до 2 (MAC), маршрутизатор — до 3 (IP). Поэтому MAC меняется на каждом участке, а IP — нет.',
        'Each device takes the data up only to its own layer: a switch to layer 2 (MAC), a router to layer 3 (IP). That is why the MAC addresses change on every link but the IP addresses do not.')),
    el('div', { class: 'tw' }, scene),
    el('div', { class: 'walk-split hops-split' }, why, frame),
    controls.node);
  render();
}
