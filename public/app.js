const POLL_MS = 5000;

const cpuCard = document.getElementById('cpu-card');
const cpuPct = document.getElementById('cpu-pct');
const cpuFill = document.getElementById('cpu-fill');
const coreGrid = document.getElementById('core-grid');

const ramCard = document.getElementById('ram-card');
const ramPct = document.getElementById('ram-pct');
const ramFill = document.getElementById('ram-fill');
const ramHint = document.getElementById('ram-hint');
const containerList = document.getElementById('container-list');

const tileGrid = document.getElementById('tile-grid');

const mcPill = document.getElementById('mc-status-pill');
const mcDetail = document.getElementById('mc-detail');
const mcBtn = document.getElementById('mc-toggle-btn');
let mcActionInFlight = false;

const financeSection = document.getElementById('finance-section');
const financeNetWorth = document.getElementById('finance-networth');
const financeTransactions = document.getElementById('finance-transactions');

function meterColor(pct) {
  if (pct >= 90) return 'var(--bad)';
  if (pct >= 70) return 'var(--warn)';
  return 'var(--good)';
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function refreshCpu() {
  try {
    const data = await fetchJSON('/api/system/cpu');
    cpuPct.textContent = `${data.overallPct}%`;
    cpuFill.style.width = `${data.overallPct}%`;
    cpuFill.style.background = meterColor(data.overallPct);

    coreGrid.innerHTML = data.cores
      .map(
        (pct, i) => `
        <div class="core">
          <div class="core-meter">
            <div class="core-meter-fill" style="height:${pct}%; background:${meterColor(pct)};"></div>
          </div>
          <span class="core-label">C${i} &middot; ${Math.round(pct)}%</span>
        </div>`
      )
      .join('');
  } catch (err) {
    cpuPct.textContent = 'err';
    console.error(err);
  }
}

async function refreshRam() {
  try {
    const data = await fetchJSON('/api/system/ram');
    ramPct.textContent = `${data.usedPct}%`;
    ramFill.style.width = `${data.usedPct}%`;
    ramFill.style.background = meterColor(data.usedPct);
    ramHint.textContent = `${formatBytes(data.usedBytes)} / ${formatBytes(data.totalBytes)} &mdash; click for breakdown`
      .replace('&mdash;', '—');

    if (!data.containers.length) {
      containerList.innerHTML =
        '<p class="container-empty">No per-container breakdown available (Docker socket not reachable).</p>';
      return;
    }

    const top = data.containers.slice(0, 8);
    containerList.innerHTML = top
      .map((c) => {
        const pct = data.totalBytes ? (c.memUsageBytes / data.totalBytes) * 100 : 0;
        return `
        <div class="container-row">
          <div class="container-row-head">
            <span class="cname">${escapeHtml(c.name)}</span>
            <span class="csize">${formatBytes(c.memUsageBytes)}</span>
          </div>
          <div class="container-meter">
            <div class="container-meter-fill" style="width:${Math.min(pct, 100)}%;"></div>
          </div>
        </div>`;
      })
      .join('');
  } catch (err) {
    ramPct.textContent = 'err';
    console.error(err);
  }
}

function setPill(el, text, kind) {
  el.textContent = text;
  el.className = `status-pill status-${kind}`;
}

function renderMinecraft(data) {
  const { container, server } = data;

  // The join-status ping is independent of container discovery, so this
  // reflects reality even before Minecraft is containerized (today: a
  // bare-metal process under systemd, which this dashboard can see but
  // not yet control).
  if (server && server.online) {
    setPill(mcPill, 'online', 'good');
    mcDetail.textContent = `${server.players}/${server.maxPlayers} players`;
  } else if (container.state === 'running') {
    setPill(mcPill, 'starting…', 'warn');
    mcDetail.textContent = 'Container is up, world isn’t joinable yet.';
  } else {
    setPill(mcPill, 'offline', 'muted');
    mcDetail.textContent = 'Not accepting connections right now.';
  }

  if (!container.found) {
    mcBtn.disabled = true;
    mcBtn.textContent = 'Not containerized yet';
    mcDetail.textContent += ' — start/stop needs Minecraft running as a container.';
    delete mcBtn.dataset.action;
    return;
  }

  mcBtn.disabled = false;
  if (container.state === 'running') {
    mcBtn.textContent = 'Stop Server';
    mcBtn.dataset.action = 'stop';
  } else {
    mcBtn.textContent = 'Start Server';
    mcBtn.dataset.action = 'start';
  }
}

async function refreshMinecraft() {
  if (mcActionInFlight) return; // don't clobber the optimistic UI mid-action
  try {
    const data = await fetchJSON('/api/minecraft/status');
    renderMinecraft(data);
  } catch (err) {
    setPill(mcPill, 'error', 'bad');
    mcDetail.textContent = 'Could not reach the dashboard backend.';
    mcBtn.disabled = true;
    console.error(err);
  }
}

async function handleMinecraftClick() {
  const action = mcBtn.dataset.action;
  if (!action) return;

  mcActionInFlight = true;
  mcBtn.disabled = true;
  setPill(mcPill, action === 'start' ? 'starting…' : 'stopping…', 'warn');
  mcDetail.textContent = '';

  try {
    const res = await fetch(`/api/minecraft/${action}`, { method: 'POST' });
    if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
  } catch (err) {
    mcDetail.textContent = `Failed to ${action} the server.`;
    console.error(err);
  } finally {
    mcActionInFlight = false;
    refreshMinecraft();
  }
}

mcBtn.addEventListener('click', handleMinecraftClick);

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch (err) {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderFinance(data) {
  if (!data.configured) {
    financeSection.hidden = true;
    return;
  }
  financeSection.hidden = false;

  if (!data.netWorth.length) {
    financeNetWorth.innerHTML = '<p class="loading">No asset accounts found.</p>';
  } else {
    financeNetWorth.innerHTML = data.netWorth
      .map((n) => `<p class="networth-amount">${formatMoney(n.amount, n.currency)}</p>`)
      .join('');
  }

  if (!data.recentTransactions.length) {
    financeTransactions.innerHTML = '<p class="loading">No recent transactions.</p>';
  } else {
    financeTransactions.innerHTML = data.recentTransactions
      .map((t) => {
        const sign = t.type === 'withdrawal' ? '-' : t.type === 'deposit' ? '+' : '';
        const cls = t.type === 'withdrawal' ? 'txn-out' : t.type === 'deposit' ? 'txn-in' : '';
        return `
        <div class="txn-row">
          <div class="txn-row-head">
            <span class="txn-desc">${escapeHtml(t.description)}</span>
            <span class="txn-amount ${cls}">${sign}${t.amount != null ? formatMoney(t.amount, t.currency || 'USD') : '?'}</span>
          </div>
          <span class="txn-date">${formatDate(t.date)}</span>
        </div>`;
      })
      .join('');
  }
}

async function refreshFinance() {
  try {
    const data = await fetchJSON('/api/firefly/summary');
    renderFinance(data);
  } catch (err) {
    console.error(err);
  }
}

async function loadServices() {
  try {
    const services = await fetchJSON('/api/services');
    if (!services.length) {
      tileGrid.innerHTML = '<p class="loading">No services configured yet &mdash; edit server/config/services.json.</p>';
      return;
    }
    tileGrid.innerHTML = services
      .map(
        (s) => `
      <a class="tile" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
        <span class="tile-category">${escapeHtml(s.category || '')}</span>
        <span class="tile-name">${escapeHtml(s.name)}</span>
        ${s.note ? `<span class="tile-note">${escapeHtml(s.note)}</span>` : ''}
      </a>`
      )
      .join('');
  } catch (err) {
    tileGrid.innerHTML = '<p class="error">Could not load services.</p>';
    console.error(err);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function toggleExpand(card, panel) {
  const expanded = card.getAttribute('aria-expanded') === 'true';
  card.setAttribute('aria-expanded', String(!expanded));
  panel.hidden = expanded;
}

cpuCard.addEventListener('click', () => toggleExpand(cpuCard, coreGrid));
ramCard.addEventListener('click', () => toggleExpand(ramCard, containerList));

function tick() {
  refreshCpu();
  refreshRam();
  refreshMinecraft();
  refreshFinance();
}

tick();
loadServices();
setInterval(tick, POLL_MS);
