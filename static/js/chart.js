// Table I grouped bar chart (inline SVG, no dependencies). Numbers from paper Table I (root.tex).
const DATA = {
  tasks: ['Box', 'Tape', 'Board', 'Lamp', 'Avg.'],
  methods: [
    { name: 'π₀.₅',                  fill: '#c7c7cc', wins: [11, 8, 10, 6],  avg: 43.8 },
    { name: 'FTP-1',                 fill: '#a1a1a6', wins: [11, 11, 12, 7], avg: 51.3 },
    { name: 'FastWAM (vision-only)', fill: '#76767b', wins: [14, 8, 8, 6],   avg: 45.0 },
    { name: 'ContactWAM (ours)',     fill: null,      wins: [19, 18, 16, 9], avg: 77.5 },
  ],
  trials: 20,
};
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const root = document.getElementById('baseline-chart');

function rate(m, i) { return i < 4 ? m.wins[i] / DATA.trials * 100 : m.avg; }
function tipText(m, i) {
  return i < 4 ? `${m.name} · ${DATA.tasks[i]} · ${m.wins[i]}/${DATA.trials} (${rate(m, i).toFixed(0)} %)`
               : `${m.name} · Avg. · ${m.avg.toFixed(1)} %`;
}
function barPath(x, y, w, h, r) { // 4px rounded data-end, flat at baseline
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function render() {
  const docEl = document.documentElement, css = getComputedStyle(docEl);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  // type tokens from style.css (rem → px; the SVG viewBox is 1 unit = 1 CSS px)
  const px = (name, fb) => { const s = v(name, ''); const n = parseFloat(s); if (!n) return fb;
    return s.endsWith('rem') ? n * parseFloat(css.fontSize) : n; };
  const deploy = v('--deploy', '#2a8c7c');
  const ink = v('--text', '#1d1d1f');
  const rule = v('--rule', '#e5e5ea');
  const fsLabel = px('--fs-label', 14), fsSmall = px('--fs-small', 16);
  const fwReg = v('--fw-regular', '400'), fwSemi = v('--fw-semi', '600');
  const fills = DATA.methods.map(m => m.fill || deploy);

  root.textContent = '';
  const W = Math.max(280, Math.floor(root.clientWidth - parseFloat(getComputedStyle(root).paddingLeft) * 2));
  const narrow = W < 480;
  const H = narrow ? 280 : 340;
  const m = { l: narrow ? 30 : Math.round(fsLabel * 3.7), r: 6, t: narrow ? Math.round(fsLabel * 2.4) : fsLabel + 10, b: fsSmall + 16 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;

  // legend (above chart)
  const lg = document.createElement('div'); lg.className = 'legend';
  DATA.methods.forEach((d, i) => {
    const s = document.createElement('span');
    const k = document.createElement('i'); k.style.background = fills[i];
    s.append(k, d.name); lg.appendChild(s);
  });
  root.appendChild(lg);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'group', 'aria-label': 'Grouped bar chart of real-robot success rate (%) per task and method' }, null);
  root.appendChild(svg);
  const y = v => m.t + ph * (1 - v / 100);
  for (const v of [0, 25, 50, 75, 100]) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: rule, 'stroke-width': v === 0 ? 1.5 : 1 }, svg);
    const t = el('text', { x: m.l - 8, y: y(v), dy: '0.35em', 'text-anchor': 'end', 'font-size': fsLabel, 'font-weight': fwReg, fill: ink, class: 'num' }, svg);
    t.textContent = v + (narrow ? '' : ' %');
  }
  if (narrow) { const t = el('text', { x: 0, y: fsLabel, 'font-size': fsLabel, 'font-weight': fwReg, fill: ink }, svg); t.textContent = 'Success rate (%)'; }

  const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; root.appendChild(tip);
  const showTip = (txt, cx, top) => {
    tip.textContent = txt; tip.hidden = false;
    const rb = root.getBoundingClientRect(), sb = svg.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = Math.min(Math.max(cx + sb.left - rb.left, half + 2), rb.width - half - 2);
    tip.style.left = x + 'px'; tip.style.top = (top + sb.top - rb.top - 6) + 'px';
  };

  const gw = pw / DATA.tasks.length, gap = 2, inner = gw * 0.78;
  const bw = (inner - gap * 3) / 4;
  DATA.tasks.forEach((task, i) => {
    const gx = m.l + gw * i + (gw - inner) / 2;
    const tx = el('text', { x: m.l + gw * i + gw / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': fsSmall, fill: ink, 'font-weight': i === 4 ? fwSemi : fwReg }, svg);
    tx.textContent = task;
    DATA.methods.forEach((d, j) => {
      const v = rate(d, i), bx = gx + j * (bw + gap), by = y(v), bh = y(0) - by;
      el('path', { d: barPath(bx, by, bw, bh, 4), fill: fills[j] }, svg);
      if (j === 3) {
        const valLabel = el('text', { x: bx + bw / 2, y: by - 6, 'text-anchor': 'middle', 'font-size': fsLabel, 'font-weight': fwSemi, fill: ink, class: 'num' }, svg);
        valLabel.textContent = Number.isInteger(v) ? v : v.toFixed(1);
      }
      const hit = el('rect', { x: bx - gap / 2, y: m.t, width: bw + gap, height: ph, fill: 'transparent', tabindex: 0, class: 'hit', 'aria-label': tipText(d, i) }, svg);
      const on = () => showTip(tipText(d, i), bx + bw / 2, by);
      hit.addEventListener('mouseenter', on); hit.addEventListener('focus', on);
      hit.addEventListener('mouseleave', () => { tip.hidden = true; }); hit.addEventListener('blur', () => { tip.hidden = true; });
    });
  });

  // table view (accessibility / exact numbers)
  const det = document.createElement('details');
  det.innerHTML = '<summary>View as table</summary>';
  const tb = document.createElement('table');
  tb.innerHTML = '<thead><tr><th>Method</th>' + DATA.tasks.map(t => `<th>${t}</th>`).join('') + '</tr></thead><tbody>' +
    DATA.methods.map(d => `<tr><td style="text-align:left">${d.name}</td>` + d.wins.map(w => `<td>${w}/${DATA.trials}</td>`).join('') + `<td>${d.avg.toFixed(1)}</td></tr>`).join('') + '</tbody>';
  det.appendChild(tb); root.appendChild(det);
}

if (root) {
  let w = 0;
  render(); w = root.clientWidth;
  new ResizeObserver(() => { if (Math.abs(root.clientWidth - w) > 1) { w = root.clientWidth; render(); } }).observe(root);
}
