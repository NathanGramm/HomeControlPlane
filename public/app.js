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

  if (!container.found) {
    setPill(mcPill, 'not found', 'bad');
    mcDetail.textContent = `No container matching MINECRAFT_CONTAINER_NAME was found.`;
    mcBtn.disabled = true;
    mcBtn.textContent = 'Start Server';
    delete mcBtn.dataset.action;
    return;
  }

  if (container.state === 'running') {
    if (server && server.online) {
      setPill(mcPill, 'online', 'good');
      mcDetail.textContent = `${server.players}/${server.maxPlayers} players`;
    } else {
      setPill(mcPill, 'starting…', 'warn');
      mcDetail.textContent = 'Container is up, world isn’t joinable yet.';
    }
    mcBtn.textContent = 'Stop Server';
    mcBtn.dataset.action = 'stop';
  } else {
    setPill(mcPill, 'offline', 'muted');
    mcDetail.textContent = 'Container is stopped.';
    mcBtn.textContent = 'Start Server';
    mcBtn.dataset.action = 'start';
  }
  mcBtn.disabled = false;
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
}

tick();
loadServices();
setInterval(tick, POLL_MS);
