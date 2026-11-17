// Dashboard: one page per sidebar section (#hash routes), plus an overview
// that shows a summary of each. Every refresh stores its data in D and
// updates all elements bound to it, on whichever page they live.

const FAST_MS = 5000; // vitals and Minecraft
const SLOW_MS = 30000; // Pi-hole, Jellyfin, quest board
const FINANCE_MS = 60000; // Firefly is often stopped; each failed poll is a DNS lookup

const D = {};
const $ = (id) => document.getElementById(id);
const all = (sel) => document.querySelectorAll(sel);
const bind = (name, fn) => all(`[data-bind="${name}"]`).forEach(fn);
const setText = (name, text) => bind(name, (el) => { el.textContent = text; });
const setHtml = (name, html) => bind(name, (el) => { el.innerHTML = html; });
const showWhere = (key, on) => all(`[data-show="${key}"]`).forEach((el) => { el.hidden = !on; });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function meterColor(pct) {
  if (pct >= 90) return 'var(--bad)';
  if (pct >= 70) return 'var(--warn)';
  return 'var(--good)';
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch (err) {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!iso || Number.isNaN(ms)) return 'never';
  const min = Math.round(ms / 60000);
  if (min < 60) return min <= 1 ? 'just now' : `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

const n = (x) => (x ?? 0).toLocaleString();

function setPill(pill, text, kind) {
  pill.textContent = text;
  pill.className = pill.className.replace(/status-\w+/g, '').trim() + ` status-${kind}`;
}

// A ranked list with a relative bar, like Pi-hole's top domains table.
function rankList(rows, key, label = (r) => escapeHtml(r[key])) {
  if (!rows.length) return '<p class="loading">Nothing yet.</p>';
  const max = Math.max(...rows.map((r) => r.count));
  return `<ol class="rank">${rows.map((r) => `<li><span class="rank-name">${label(r)}</span><span class="rank-count">${n(r.count)}</span>
    <span class="rank-bar"><span style="width:${(r.count / max) * 100}%"></span></span></li>`).join('')}</ol>`;
}

const offMessage = (what, envVar) =>
  `<div class="card"><p class="card-hint">${what} isn't connected yet. Add <code>${envVar}</code> to the dashboard stack's environment variables in Portainer, then redeploy.</p></div>`;

// --- routing ---

const PAGES = [...all('.page')].map((p) => p.dataset.page);
const currentPage = () => (PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview');

function route() {
  const page = currentPage();
  for (const s of all('.page')) s.hidden = s.dataset.page !== page;
  drawCharts();
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawCharts, 150);
});
window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});

// Charts need real widths, so they're only drawn on the visible page.
function drawCharts() {
  const p = D.pihole;
  if (!p?.reachable) return;
  const hhmm = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const page = currentPage();
  const historySeries = [
    { label: 'Allowed', color: '#4e79a7', values: p.history.map((h) => h.allowed) },
    { label: 'Blocked', color: '#e15759', values: p.history.map((h) => h.blocked) },
  ];
  if (page === 'overview') barChart($('ov-pihole-chart'), { series: historySeries, labels: p.history.map((h) => hhmm(h.t)), height: 96, axes: false });
  if (page === 'pihole') {
    barChart($('ph-history'), { series: historySeries, labels: p.history.map((h) => hhmm(h.t)) });
    const ch = p.clientHistory;
    if (ch) {
      barChart($('ph-clients-chart'), {
        labels: ch.buckets.map((b) => hhmm(b.t)),
        series: ch.clients.map((name, i) => ({ label: escapeHtml(name), color: PALETTE[i % PALETTE.length], values: ch.buckets.map((b) => b.counts[i]) })),
      });
    } else {
      $('ph-clients-chart').innerHTML = '<p class="loading">Client history isn\'t available from this Pi-hole.</p>';
    }
  }
}

// --- system ---

async function refreshCpu() {
  try {
    const d = await fetchJSON('/api/system/cpu');
    setText('cpu-pct', `${d.overallPct}%`);
    bind('cpu-fill', (el) => { el.style.width = `${d.overallPct}%`; el.style.background = meterColor(d.overallPct); });
    setText('cpu-hint', `${d.cores.length} cores`);
    $('core-grid').innerHTML = d.cores.map((pct, i) => `
      <div class="core"><div class="core-meter"><div class="core-meter-fill" style="height:${pct}%; background:${meterColor(pct)};"></div></div>
      <span class="core-label">C${i} &middot; ${Math.round(pct)}%</span></div>`).join('');
  } catch (err) {
    setText('cpu-pct', 'err');
    console.error(err);
  }
}

async function refreshRam() {
  try {
    const d = await fetchJSON('/api/system/ram');
    setText('ram-pct', `${d.usedPct}%`);
    bind('ram-fill', (el) => { el.style.width = `${d.usedPct}%`; el.style.background = meterColor(d.usedPct); });
    setText('ram-hint', `${formatBytes(d.usedBytes)} of ${formatBytes(d.totalBytes)}${d.containers[0] ? ` · top: ${d.containers[0].name}` : ''}`);
    $('container-list').innerHTML = d.containers.length
      ? d.containers.map((c) => `
        <div class="container-row"><div class="container-row-head"><span class="cname">${escapeHtml(c.name)}</span><span class="csize">${formatBytes(c.memUsageBytes)}</span></div>
        <div class="container-meter"><div class="container-meter-fill" style="width:${Math.min((c.memUsageBytes / d.totalBytes) * 100, 100)}%;"></div></div></div>`).join('')
      : '<p class="container-empty">No per-container breakdown (Docker socket proxy not reachable).</p>';
  } catch (err) {
    setText('ram-pct', 'err');
    console.error(err);
  }
}

// --- minecraft (cards on the overview and the Minecraft page share state) ---

const MC_SERVERS = ['gtnh', 'family'];
const mcBusy = {};

function renderMinecraft(id, data) {
  const { container, server, blockedBy } = data;
  for (const v of all(`[data-mc="${id}"]`)) {
    const pill = v.querySelector('.mc-pill');
    const detail = v.querySelector('.mc-detail');
    const btn = v.querySelector('.mc-btn');
    const info = v.querySelector('.mc-info');
    if (server?.online) {
      setPill(pill, 'online', 'good');
      detail.textContent = `${server.players}/${server.maxPlayers} players online`;
    } else if (container.state === 'running') {
      setPill(pill, 'starting…', 'warn');
      detail.textContent = 'Container is up; the world is still loading.';
    } else {
      setPill(pill, 'offline', 'muted');
      detail.textContent = 'Stopped.';
    }
    if (info) {
      info.innerHTML = server?.online ? `
        <dt>Version</dt><dd>${escapeHtml(server.version)}</dd>
        <dt>MOTD</dt><dd>${escapeHtml(server.motd)}</dd>
        <dt>Players</dt><dd>${server.playerNames?.length ? server.playerNames.map(escapeHtml).join(', ') : 'Nobody on right now'}</dd>` : '';
    }
    btn.disabled = !container.found;
    delete btn.dataset.action;
    if (!container.found) {
      btn.textContent = 'Container not found';
    } else if (container.state === 'running') {
      btn.textContent = 'Stop server';
      btn.dataset.action = 'stop';
    } else if (blockedBy) {
      btn.disabled = true;
      btn.textContent = `Stop ${blockedBy} first`;
    } else {
      btn.textContent = 'Start server';
      btn.dataset.action = 'start';
    }
  }
}

async function refreshMinecraft(id) {
  if (mcBusy[id]) return; // don't overwrite the "starting…" state mid-action
  try {
    renderMinecraft(id, await fetchJSON(`/api/minecraft/${id}/status`));
  } catch (err) {
    for (const v of all(`[data-mc="${id}"]`)) {
      setPill(v.querySelector('.mc-pill'), 'error', 'bad');
      v.querySelector('.mc-detail').textContent = 'Could not reach the dashboard backend.';
      v.querySelector('.mc-btn').disabled = true;
    }
    console.error(err);
  }
}

document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.mc-btn');
  if (!btn || !btn.dataset.action) return;
  const id = btn.closest('[data-mc]').dataset.mc;
  const action = btn.dataset.action;
  mcBusy[id] = true;
  for (const v of all(`[data-mc="${id}"]`)) {
    v.querySelector('.mc-btn').disabled = true;
    setPill(v.querySelector('.mc-pill'), action === 'start' ? 'starting…' : 'stopping…', 'warn');
  }
  try {
    const res = await fetch(`/api/minecraft/${id}/${action}`, { method: 'POST' });
    if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
  } catch (err) {
    all(`[data-mc="${id}"] .mc-detail`).forEach((el) => { el.textContent = `Failed to ${action} the server.`; });
    console.error(err);
  } finally {
    mcBusy[id] = false;
    MC_SERVERS.forEach(refreshMinecraft);
  }
});

// --- pi-hole ---

async function refreshPihole() {
  try {
    D.pihole = await fetchJSON('/api/pihole/summary');
  } catch (err) {
    console.error(err);
    return;
  }
  const p = D.pihole;
  showWhere('pihole', p.configured && p.reachable);
  bind('pihole-off', (el) => {
    el.hidden = p.configured && p.reachable;
    el.innerHTML = !p.configured ? offMessage('Pi-hole', 'PIHOLE_API_PASSWORD')
      : '<div class="card"><p class="error">Can\'t reach Pi-hole. Check that the container is running and the app password is right.</p></div>';
  });
  all('[data-show="pihole"].ov-card').forEach((el) => { el.hidden = !p.configured; });
  if (!p.configured) return;
  if (!p.reachable) {
    bind('pihole-pill', (el) => setPill(el, 'unreachable', 'bad'));
    return;
  }
  const on = p.blocking === 'enabled';
  bind('pihole-pill', (el) => setPill(el, on ? 'blocking' : `blocking ${p.blocking || 'unknown'}`, on ? 'good' : 'warn'));
  setHtml('pihole-ov', `
    <span class="big-num">${p.percentBlocked}%</span><span class="card-hint">blocked</span>
    <p class="ov-line">${n(p.blockedQueries)} of ${n(p.totalQueries)} queries</p>
    <p class="ov-line">${p.activeClients} clients &middot; ${p.queriesPerMinute}/min</p>
    ${p.topBlocked[0] ? `<p class="ov-line card-hint">Top blocked: ${escapeHtml(p.topBlocked[0].domain)}</p>` : ''}`);

  $('ph-tiles').innerHTML = [
    ['Total queries', n(p.totalQueries), `${p.activeClients} active clients`, 'blue'],
    ['Queries blocked', n(p.blockedQueries), `${n(p.uniqueDomains)} unique domains`, 'red'],
    ['Percent blocked', `${p.percentBlocked}%`, `${p.queriesPerMinute} queries/min`, 'amber'],
    ['Domains on lists', n(p.domainsOnList), on ? 'Blocking is on' : 'Blocking is OFF', 'green'],
  ].map(([label, value, sub, color]) => `<div class="stat-tile t-${color}"><span class="stat-tile-label">${label}</span>
    <span class="stat-tile-value">${value}</span><span class="stat-tile-sub">${sub}</span></div>`).join('');
  donut($('ph-types'), p.queryTypes.map((q) => ({ label: escapeHtml(q.type), value: q.count })));
  donut($('ph-upstreams'), p.upstreams.map((u) => ({ label: escapeHtml(u.name), value: u.count })));
  $('ph-top-allowed').innerHTML = rankList(p.topAllowed, 'domain');
  $('ph-top-blocked').innerHTML = rankList(p.topBlocked, 'domain');
  $('ph-top-clients').innerHTML = rankList(p.topClients, 'name',
    (c) => `${escapeHtml(c.name)}${c.name !== c.ip ? ` <span class="card-hint">${escapeHtml(c.ip)}</span>` : ''}`);
  drawCharts();
}

// --- jellyfin ---

const poster = (id, cls = 'poster') => `<div class="${cls}">${id ? `<img src="/api/jellyfin/image/${encodeURIComponent(id)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>`;

async function refreshJellyfin() {
  try {
    D.jellyfin = await fetchJSON('/api/jellyfin/summary');
  } catch (err) {
    console.error(err);
    return;
  }
  const j = D.jellyfin;
  showWhere('jellyfin', j.configured && j.reachable);
  bind('jellyfin-off', (el) => {
    el.hidden = j.configured && j.reachable;
    el.innerHTML = !j.configured ? offMessage('Jellyfin', 'JELLYFIN_API_KEY')
      : '<div class="card"><p class="error">Can\'t reach Jellyfin. Check that the container is running and the API key is right.</p></div>';
  });
  all('[data-show="jellyfin"].ov-card').forEach((el) => { el.hidden = !j.configured; });
  if (!j.configured) return;
  if (!j.reachable) {
    bind('jellyfin-pill', (el) => setPill(el, 'unreachable', 'bad'));
    return;
  }
  const playing = j.nowPlaying.length;
  bind('jellyfin-pill', (el) => setPill(el, playing ? `${playing} playing` : 'idle', playing ? 'good' : 'muted'));
  setHtml('jellyfin-ov', `
    <p class="ov-line"><b>${n(j.counts.movies)}</b> movies &middot; <b>${n(j.counts.shows)}</b> shows &middot; <b>${n(j.counts.episodes)}</b> episodes</p>
    ${playing ? j.nowPlaying.slice(0, 2).map((p) => `<p class="ov-line">${p.paused ? '&#10074;&#10074;' : '&#9654;'} ${escapeHtml(p.title)} <span class="card-hint">${escapeHtml(p.user)}</span></p>`).join('')
    : '<p class="ov-line card-hint">Nothing playing</p>'}
    <span class="card-label sub-label">Recently added</span>
    ${j.recentlyAdded.slice(0, 3).map((r) => `<p class="ov-line ellipsis">${escapeHtml(r.name)} <span class="card-hint">${r.year || ''}</span></p>`).join('')}`);

  $('jf-tiles').innerHTML = [
    ['Movies', n(j.counts.movies), 'blue'], ['Shows', n(j.counts.shows), 'green'],
    ['Episodes', n(j.counts.episodes), 'amber'], ['Users', n(j.users.length), 'red'],
  ].map(([label, value, color]) => `<div class="stat-tile t-${color}"><span class="stat-tile-label">${label}</span><span class="stat-tile-value">${value}</span></div>`).join('');
  $('jf-playing').innerHTML = playing ? j.nowPlaying.map((p) => `
    <div class="playing">${poster(p.id, 'poster poster-sm')}
      <div class="playing-body"><b>${escapeHtml(p.title)}</b>
        <span class="card-hint">${escapeHtml(p.user)}${p.client ? ` on ${escapeHtml(p.client)}` : ''}${p.paused ? ' · paused' : ''}${p.transcoding ? ' · transcoding' : ''}</span>
        ${p.progress != null ? `<div class="meter"><div class="meter-fill" style="width:${p.progress}%"></div></div>` : ''}</div></div>`).join('')
    : '<p class="loading">Nothing playing right now.</p>';
  $('jf-recent').innerHTML = j.recentlyAdded.map((r) => `
    <div class="poster-item">${poster(r.id)}<span class="poster-title">${escapeHtml(r.name)}</span>
      <span class="card-hint">${r.year || ''}${r.type === 'Series' ? ' · show' : ''}${r.added ? ` · added ${formatDate(r.added)}` : ''}</span></div>`).join('')
    || '<p class="loading">Nothing yet.</p>';
  $('jf-users').innerHTML = j.users.length
    ? `<ul class="kv-list">${j.users.map((u) => `<li><span>${escapeHtml(u.name)}</span><span class="card-hint">${timeAgo(u.lastActive)}</span></li>`).join('')}</ul>`
    : '<p class="loading">No users.</p>';
}

// --- finance ---

async function refreshFinance() {
  let f;
  try {
    f = await fetchJSON('/api/firefly/summary');
  } catch (err) {
    console.error(err);
    return;
  }
  showWhere('finance', f.configured);
  all('[data-show="finance"].ov-card').forEach((el) => { el.hidden = !f.configured; });
  bind('finance-off', (el) => {
    el.hidden = f.configured;
    el.innerHTML = offMessage('Firefly', 'FIREFLY_API_TOKEN');
  });
  if (!f.configured) return;
  const worth = f.netWorth.length
    ? f.netWorth.map((x) => `<p class="networth-amount">${formatMoney(x.amount, x.currency)}</p>`).join('')
    : '<p class="card-hint">No data. Is Firefly running?</p>';
  setHtml('finance-ov', worth);
  $('fin-networth').innerHTML = worth;
  $('fin-transactions').innerHTML = f.recentTransactions.length ? f.recentTransactions.map((t) => {
    const sign = t.type === 'withdrawal' ? '-' : t.type === 'deposit' ? '+' : '';
    const cls = t.type === 'withdrawal' ? 'txn-out' : t.type === 'deposit' ? 'txn-in' : '';
    return `<div class="txn-row"><div class="txn-row-head"><span class="txn-desc">${escapeHtml(t.description)}</span>
      <span class="txn-amount ${cls}">${sign}${t.amount != null ? formatMoney(t.amount, t.currency || 'USD') : '?'}</span></div>
      <span class="txn-date">${formatDate(t.date)}</span></div>`;
  }).join('') : '<p class="loading">No recent transactions.</p>';
}

// --- quest board summary ---

async function refreshQuests() {
  try {
    const { state: q } = await fetchJSON('/api/quests');
    const due = q.dailies.filter((d) => d.due);
    setText('quest-level', `Lv ${q.level.level}`);
    setHtml('quest-ov', `
      <div class="mini-stat"><span>HP ${q.player.hp}/${q.maxHp}</span><div class="meter"><div class="meter-fill" style="width:${(q.player.hp / q.maxHp) * 100}%;background:var(--bad)"></div></div></div>
      <div class="mini-stat"><span>XP ${q.level.into}/${q.level.need}</span><div class="meter"><div class="meter-fill" style="width:${(q.level.into / q.level.need) * 100}%;background:var(--warn)"></div></div></div>
      <p class="ov-line">Dailies: <b>${due.filter((d) => d.done).length}/${due.length}</b> done today</p>
      <p class="ov-line">${icon('flame')} ${q.player.streak} day streak &middot; ${icon('coin')} ${n(q.player.gold)}</p>`);
  } catch (err) {
    setHtml('quest-ov', '<p class="card-hint">Couldn\'t load the quest board.</p>');
    console.error(err);
  }
}

// --- services ---

async function loadServices() {
  try {
    const services = await fetchJSON('/api/services');
    $('ov-services').innerHTML = services.map((s) => `
      <div class="chip"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a>
        ${s.directUrl ? `<a class="tile-direct" href="${escapeHtml(s.directUrl)}" target="_blank" rel="noopener" title="Direct link, bypassing the reverse proxy">direct</a>` : ''}</div>`).join('');
    $('tile-grid').innerHTML = services.map((s) => `
      <div class="tile">
        <a class="tile-link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
          <span class="tile-category">${escapeHtml(s.category || '')}</span>
          <span class="tile-name">${escapeHtml(s.name)}</span>
          ${s.note ? `<span class="tile-note">${escapeHtml(s.note)}</span>` : ''}
        </a>
        ${s.directUrl ? `<a class="tile-direct" href="${escapeHtml(s.directUrl)}" target="_blank" rel="noopener" title="Direct link, bypassing the reverse proxy">${escapeHtml(s.directUrl.replace(/^https?:\/\//, ''))}</a>` : ''}
      </div>`).join('');
  } catch (err) {
    $('tile-grid').innerHTML = '<p class="error">Could not load services.</p>';
    console.error(err);
  }
}

// --- polling ---

function fastTick() {
  refreshCpu();
  refreshRam();
  MC_SERVERS.forEach(refreshMinecraft);
  $('ov-clock').textContent = new Date().toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function slowTick() {
  refreshPihole();
  refreshJellyfin();
  refreshQuests();
}

route();
loadServices();
fastTick();
slowTick();
refreshFinance();
setInterval(fastTick, FAST_MS);
setInterval(slowTick, SLOW_MS);
setInterval(refreshFinance, FINANCE_MS);
