// Tiny SVG charts: stacked bars over time and donuts. Bars are drawn at the
// container's real pixel width so text never stretches; app.js redraws them
// on resize and when their page becomes visible. All labels are inserted as
// HTML, so callers must escape anything that came from an API.

const PALETTE = ['#4e79a7', '#59a14f', '#e15759', '#f28e2b', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#8c8c8c'];

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= v);
}

const fmtNum = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)));

// series: [{ label, color, values: [] }] stacked bottom-up; labels: x labels per bucket.
function barChart(el, { series, labels, height = 170, axes = true }) {
  const width = el.clientWidth;
  if (!width || !labels.length) {
    el.innerHTML = labels.length ? '' : '<p class="loading">No data yet.</p>';
    return;
  }
  const n = labels.length;
  const gutter = axes ? 40 : 0;
  const bottom = axes ? 20 : 0;
  const plotW = width - gutter;
  const plotH = height - bottom - 4;
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const max = niceMax(Math.max(...totals));
  const bw = plotW / n;
  const y = (v) => 4 + plotH - (v / max) * plotH;

  let svg = '';
  if (axes) {
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k;
      svg += `<line x1="${gutter}" x2="${width}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/>`
        + `<text x="${gutter - 6}" y="${y(v) + 4}" text-anchor="end" class="chart-label">${fmtNum(v)}</text>`;
    }
    const every = Math.max(1, Math.ceil(n / Math.floor(plotW / 48)));
    labels.forEach((l, i) => {
      if (i % every === 0) svg += `<text x="${gutter + i * bw + bw / 2}" y="${height - 4}" text-anchor="middle" class="chart-label">${l}</text>`;
    });
  }
  labels.forEach((l, i) => {
    let base = 0;
    const tip = [l, ...series.map((s) => `${s.label}: ${(s.values[i] || 0).toLocaleString()}`)].join('\n');
    svg += `<g><title>${tip.replace(/</g, '&lt;')}</title>`;
    for (const s of series) {
      const v = s.values[i] || 0;
      if (v > 0) {
        svg += `<rect x="${gutter + i * bw + 0.5}" y="${y(base + v)}" width="${Math.max(bw - 1.5, 1)}" height="${y(base) - y(base + v)}" fill="${s.color}"/>`;
      }
      base += v;
    }
    svg += `<rect x="${gutter + i * bw}" y="4" width="${bw}" height="${plotH}" fill="transparent"/></g>`;
  });
  el.innerHTML = `<svg width="${width}" height="${height}" role="img" aria-label="${series.map((s) => s.label).join(', ')} over time">${svg}</svg>`
    + (axes ? `<div class="chart-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>` : '');
}

// parts: [{ label, value }]
function donut(el, parts) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) {
    el.innerHTML = '<p class="loading">No data yet.</p>';
    return;
  }
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = parts.map((p, i) => {
    const len = (p.value / total) * c;
    const arc = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="28"
      stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"><title>${p.label}: ${p.value.toLocaleString()}</title></circle>`;
    offset += len;
    return arc;
  }).join('');
  el.innerHTML = `<div class="donut"><svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="Breakdown">${arcs}</svg>
    <ul class="donut-legend">${parts.map((p, i) => `<li><i style="background:${PALETTE[i % PALETTE.length]}"></i><span>${p.label}</span>
      <b>${Math.round((p.value / total) * 1000) / 10}%</b></li>`).join('')}</ul></div>`;
}
