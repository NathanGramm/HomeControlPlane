// Minecraft page: pick a server card, then manage it in four tabs (console,
// players, files, backups), like a hosting panel. Uses app.js's helpers and
// listens for its `mc-status` event instead of polling status itself.
(() => {
  const NAMES = { gtnh: 'GTNH server', family: 'Family server' };
  const STOPPED = ['created', 'exited', 'dead'];
  const mc = {
    sel: NAMES[localStorage.mcSel] ? localStorage.mcSel : 'gtnh',
    tab: ['console', 'players', 'files', 'backups'].includes(localStorage.mcTab) ? localStorage.mcTab : 'console',
    status: {},
    cwd: { gtnh: '', family: '' },
    editing: null, // path of the file open in the editor
  };
  const api = (rest) => `/api/minecraft/${mc.sel}${rest}`;
  const st = () => mc.status[mc.sel];
  const running = () => st()?.container.state === 'running';
  // Mirrors the server's rule: files and restores only while stopped.
  const canWrite = () => {
    const s = st();
    return !!s && !s.stopping && !s.restoring && (!s.container.found || STOPPED.includes(s.container.state));
  };
  const onPage = () => location.hash === '#minecraft' && !document.hidden;

  async function call(url, opts) {
    const res = await fetch(url, opts);
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body;
  }

  function size(b) {
    if (b < 1024) return `${b} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
    return `${b.toFixed(b < 10 ? 1 : 0)} ${u[i]}`;
  }
  const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // --- selection and tabs ---

  function select(id) {
    if (!NAMES[id]) return;
    mc.sel = localStorage.mcSel = id;
    mc.editing = null;
    for (const c of all('.mc-pick')) c.classList.toggle('selected', c.dataset.mc === id);
    $('mc-title').textContent = NAMES[id];
    openTab(mc.tab);
  }

  function openTab(tab) {
    mc.tab = localStorage.mcTab = tab;
    for (const b of all('.tabs [data-tab]')) b.setAttribute('aria-selected', b.dataset.tab === tab);
    for (const p of all('.mc-panel')) p.hidden = p.dataset.panel !== tab;
    syncConsole();
    if (tab === 'players') loadPlayers();
    if (tab === 'files') (mc.editing ? null : loadFiles());
    if (tab === 'backups') loadBackups();
    applyLocks();
  }

  document.addEventListener('click', (ev) => {
    const tab = ev.target.closest('.tabs [data-tab]');
    if (tab) return openTab(tab.dataset.tab);
    // Any click on a server card (here or on the overview) picks that server.
    const card = ev.target.closest('[data-mc]');
    if (card && !ev.target.closest('.mc-btn')) select(card.dataset.mc);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.classList?.contains('mc-pick')) select(ev.target.dataset.mc);
  });

  // Status comes from app.js every 5 s.
  document.addEventListener('mc-status', ({ detail: { id, data } }) => {
    const before = mc.status[id];
    mc.status[id] = data;
    if (id !== mc.sel) return;
    applyLocks();
    if (before && before.container.state !== data.container.state) syncConsole(true);
    if (before?.restoring && !data.restoring) {
      if (mc.tab === 'backups') loadBackups();
      if (mc.tab === 'files' && !mc.editing) loadFiles();
    }
    if (mc.tab === 'backups') showRestore();
  });

  function applyLocks() {
    const ok = canWrite();
    for (const n of all('.mc-manager [data-mc-locked]')) n.hidden = ok || !st();
    for (const el of all('.mc-manager [data-write]')) {
      el.toggleAttribute('disabled', !ok);
      el.classList.toggle('is-disabled', !ok);
    }
    $('mc-upload').disabled = !ok;
    $('mc-editor-text').readOnly = !ok;
    $('mc-cmd').disabled = !running();
    $('mc-cmd').placeholder = running() ? 'Type a command, e.g. say hi or whitelist add Steve' : 'Start the server to send commands';
  }

  // --- console ---

  let es = null;
  let esFor = null;
  let retry = null;
  const MAX_LINES = 1000;

  function closeConsole() {
    es?.close();
    es = esFor = null;
    clearTimeout(retry);
  }

  function consoleLine(text, cls) {
    const out = $('mc-console');
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
    const line = document.createElement('div');
    if (cls) line.className = cls;
    else if (/\b(ERROR|SEVERE|FATAL)\b/.test(text)) line.className = 'log-error';
    else if (/\bWARN(ING)?\b/.test(text)) line.className = 'log-warn';
    line.textContent = text;
    out.append(line);
    while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
    if (atBottom) out.scrollTop = out.scrollHeight;
  }

  // Opens the log stream when the console is showing, closes it otherwise.
  function syncConsole(restart = false) {
    const want = onPage() && mc.tab === 'console' ? mc.sel : null;
    if (!restart && want === esFor) return;
    closeConsole();
    if (!want) return;
    esFor = want;
    const src = new EventSource(api('/console'));
    es = src;
    let fresh = true;
    src.onopen = () => { fresh = true; }; // a reconnect resends the tail, so start over
    src.onmessage = (ev) => {
      if (fresh) { $('mc-console').textContent = ''; fresh = false; }
      consoleLine(ev.data);
    };
    src.addEventListener('end', () => {
      src.close();
      if (fresh) $('mc-console').textContent = '';
      consoleLine('— server stopped —', 'log-note');
      // Reconnect only if it starts again; status changes call syncConsole(true).
      es = null;
    });
    src.onerror = () => {
      if (src.readyState === EventSource.CLOSED) {
        es = null;
        if (st()?.container.found === false) {
          $('mc-console').textContent = '';
          return consoleLine('— no container for this server yet, so there is no log —', 'log-note');
        }
        if ($('mc-console').lastElementChild?.className !== 'log-note') consoleLine('— lost the log stream, retrying —', 'log-note');
        retry = setTimeout(() => { if (esFor === want) { esFor = null; syncConsole(); } }, 5000);
      }
    };
  }
  window.addEventListener('hashchange', () => syncConsole());
  document.addEventListener('visibilitychange', () => syncConsole());

  const cmdHistory = [];
  let histPos = 0;
  $('mc-cmd-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = $('mc-cmd');
    const command = input.value.trim();
    if (!command) return;
    cmdHistory.push(command);
    histPos = cmdHistory.length;
    input.value = '';
    consoleLine(`> ${command}`, 'log-cmd');
    try {
      const { output } = await call(api('/command'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }),
      });
      for (const l of (output || '(no reply)').split('\n')) consoleLine(l, 'log-reply');
    } catch (err) {
      consoleLine(err.message, 'log-error');
    }
  });
  $('mc-cmd').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    histPos = Math.max(0, Math.min(cmdHistory.length, histPos + (ev.key === 'ArrowUp' ? -1 : 1)));
    ev.target.value = cmdHistory[histPos] ?? '';
  });

  // --- players ---

  async function runCommand(command) {
    const { output } = await call(api('/command'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }),
    });
    return output;
  }

  async function loadPlayers() {
    const box = $('mc-players');
    let p;
    try {
      p = await call(api('/players'));
    } catch (err) {
      box.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
      return;
    }
    const live = running();
    const btn = (cmd, name, label) =>
      `<button class="small-btn" data-cmd="${escapeHtml(`${cmd} ${name}`)}"${live ? '' : ' disabled'}>${label}</button>`;
    const list = (names, actions, empty) => (names.length
      ? `<ul class="kv-list">${names.map((n) => `<li><span>${escapeHtml(n)}</span><span class="row-actions">${actions(n)}</span></li>`).join('')}</ul>`
      : `<p class="card-hint">${empty}</p>`);
    const ops = new Set(p.ops);
    box.innerHTML = `
      <div class="stack">
        <div><span class="card-label">Online now</span>
          ${p.online == null ? `<p class="card-hint">${live ? 'Couldn\'t ask the server. Is RCON set up?' : 'The server is stopped.'}</p>`
            : list(p.online, (n) => btn('kick', n, 'Kick') + (ops.has(n) ? btn('deop', n, 'Remove op') : btn('op', n, 'Make op')), 'Nobody is on right now.')}
        </div>
        <div><span class="card-label">Operators</span>${list(p.ops, (n) => btn('deop', n, 'Remove'), 'No operators.')}</div>
        <div><span class="card-label">Banned</span>${list(p.banned, (n) => btn('pardon', n, 'Unban'), 'Nobody is banned.')}</div>
      </div>
      <div class="stack">
        <div><span class="card-label">Whitelist</span>
          <form class="inline-form" id="mc-wl-form">
            <input id="mc-wl-name" placeholder="Minecraft username" pattern="[A-Za-z0-9_]{1,16}" required aria-label="Username to whitelist"${live ? '' : ' disabled'}>
            <button class="control-btn" type="submit"${live ? '' : ' disabled'}>Add</button>
          </form>
          ${list(p.whitelist, (n) => btn('whitelist remove', n, 'Remove'), 'Nobody is whitelisted.')}
        </div>
        ${live ? '' : '<p class="card-hint">Start the server to change these lists.</p>'}
      </div>`;
    $('mc-wl-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await playerAction(`whitelist add ${$('mc-wl-name').value.trim()}`);
    });
  }

  async function playerAction(command) {
    try {
      const out = await runCommand(command);
      consoleLine(`> ${command}`, 'log-cmd');
      if (out) consoleLine(out, 'log-reply');
    } catch (err) {
      alert(err.message);
    }
    loadPlayers();
  }
  $('mc-players').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cmd]');
    if (b) playerAction(b.dataset.cmd);
  });

  // --- files ---

  const join = (dir, name) => (dir ? `${dir}/${name}` : name);
  const q = (params) => `?${new URLSearchParams(params)}`;
  let listing = [];

  function filesMsg(text, isError) {
    const m = $('mc-files-msg');
    m.textContent = text || '';
    m.classList.toggle('error', !!isError);
  }

  async function loadFiles(dir = mc.cwd[mc.sel]) {
    let body;
    try {
      body = await call(api(`/files${q({ path: dir })}`));
    } catch (err) {
      if (dir) return loadFiles(''); // folder vanished: go back to the top
      $('mc-files').innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
      return;
    }
    mc.cwd[mc.sel] = body.path;
    listing = body.entries;
    $('mc-editor').hidden = true;
    $('mc-files-browser').hidden = false;
    const parts = body.path ? body.path.split('/') : [];
    $('mc-crumbs').innerHTML = [`<a href="#minecraft" data-dir="">${escapeHtml(NAMES[mc.sel])}</a>`,
      ...parts.map((p, i) => `<a href="#minecraft" data-dir="${escapeHtml(parts.slice(0, i + 1).join('/'))}">${escapeHtml(p)}</a>`)].join('<span>/</span>');
    $('mc-files').innerHTML = (body.path ? `<div class="file-row"><button class="file-name" data-dir="${escapeHtml(parts.slice(0, -1).join('/'))}">${icon('folder')} ..</button></div>` : '')
      + (listing.length ? listing.map((e) => {
        const p = escapeHtml(join(body.path, e.name));
        return `<div class="file-row">
          <button class="file-name" ${e.dir ? `data-dir="${p}"` : `data-open="${p}"`}>${icon(e.dir ? 'folder' : 'file')} <span class="ellipsis">${escapeHtml(e.name)}</span></button>
          <span class="file-meta">${e.dir ? '' : size(e.size)}</span>
          <span class="file-meta">${when(e.mtime)}</span>
          <span class="row-actions">
            ${e.dir ? '' : `<a class="small-btn" href="${api(`/files/download${q({ path: join(body.path, e.name) })}`)}" download>Download</a>`}
            <button class="small-btn" data-rename="${p}" data-write>Rename</button>
            <button class="small-btn danger" data-delete="${p}" data-isdir="${e.dir}" data-write>Delete</button>
          </span></div>`;
      }).join('') : '<p class="card-hint">This folder is empty. Drop files here to upload.</p>');
    applyLocks();
  }

  async function openFile(path) {
    try {
      const text = await call(api(`/files/read${q({ path })}`));
      mc.editing = path;
      $('mc-editor-name').textContent = path;
      $('mc-editor-text').value = text;
      $('mc-files-browser').hidden = true;
      $('mc-editor').hidden = false;
      applyLocks();
    } catch (err) {
      filesMsg(err.message, true);
    }
  }

  async function saveFile() {
    if (!mc.editing || !canWrite()) return;
    const btn = $('mc-editor-save');
    btn.textContent = 'Saving…';
    try {
      await call(api(`/files/write${q({ path: mc.editing })}`), { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: $('mc-editor-text').value });
      btn.textContent = 'Saved';
    } catch (err) {
      btn.textContent = 'Save';
      alert(err.message);
      return;
    }
    setTimeout(() => { btn.textContent = 'Save'; }, 1500);
  }

  async function upload(fileList) {
    if (!canWrite()) return;
    const dir = mc.cwd[mc.sel];
    const files = [...fileList];
    const clashes = files.filter((f) => listing.some((e) => e.name === f.name));
    if (clashes.length && !confirm(`Replace ${clashes.map((f) => f.name).join(', ')}?`)) return;
    for (const [i, f] of files.entries()) {
      filesMsg(`Uploading ${i + 1} of ${files.length}: ${f.name}…`);
      try {
        await call(api(`/files/upload${q({ path: dir, name: f.name })}`), { method: 'POST', body: f });
      } catch (err) {
        filesMsg(`${f.name}: ${err.message}`, true);
        return loadFiles();
      }
    }
    filesMsg(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}.`);
    loadFiles();
  }

  async function filesAction(fn) {
    try {
      await fn();
      filesMsg('');
    } catch (err) {
      filesMsg(err.message, true);
    }
    loadFiles();
  }

  $('mc-files-browser').addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-dir], [data-open], [data-rename], [data-delete], [data-files]');
    if (!t || t.disabled) return;
    if (t.dataset.dir !== undefined) {
      ev.preventDefault();
      filesMsg('');
      return loadFiles(t.dataset.dir);
    }
    if (t.dataset.open) return openFile(t.dataset.open);
    const dir = mc.cwd[mc.sel];
    if (t.dataset.rename) {
      const old = t.dataset.rename.split('/').pop();
      const name = prompt('New name', old);
      if (name && name !== old) filesAction(() => call(api(`/files/rename${q({ path: t.dataset.rename, name })}`), { method: 'POST' }));
    } else if (t.dataset.delete) {
      const what = t.dataset.delete.split('/').pop();
      if (confirm(`Delete ${what}${t.dataset.isdir === 'true' ? ' and everything in it' : ''}? This can't be undone.`)) {
        filesAction(() => call(api(`/files${q({ path: t.dataset.delete })}`), { method: 'DELETE' }));
      }
    } else if (t.dataset.files === 'new-folder') {
      const name = prompt('Folder name');
      if (name) filesAction(() => call(api(`/files/mkdir${q({ path: dir, name })}`), { method: 'POST' }));
    } else if (t.dataset.files === 'new-file') {
      const name = prompt('File name');
      if (name) filesAction(() => call(api(`/files/write${q({ path: join(dir, name) })}`), { method: 'PUT', body: '' }));
    } else if (t.dataset.files === 'refresh') {
      filesMsg('');
      loadFiles();
    }
  });
  $('mc-upload').addEventListener('change', (ev) => {
    upload(ev.target.files);
    ev.target.value = '';
  });
  const drop = $('mc-files');
  drop.addEventListener('dragover', (ev) => {
    if (!canWrite()) return;
    ev.preventDefault();
    drop.classList.add('drop');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('drop');
    if (ev.dataTransfer.files.length) upload(ev.dataTransfer.files);
  });
  $('mc-editor-save').addEventListener('click', saveFile);
  $('mc-editor-close').addEventListener('click', () => {
    mc.editing = null;
    loadFiles();
  });
  $('mc-editor-text').addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
      ev.preventDefault();
      saveFile();
    }
  });

  // --- backups ---

  function showRestore() {
    const s = st();
    const m = $('mc-restore-msg');
    const r = s?.lastRestore;
    m.hidden = !s?.restoring && !r;
    m.classList.toggle('notice-bad', !!r && !r.ok && !s.restoring);
    m.innerHTML = s?.restoring ? 'Restoring… this can take a few minutes for a big world.'
      : !r ? ''
        : r.ok ? `Restored <b>${escapeHtml(r.backup)}</b>. The world it replaced is in <code>${escapeHtml(r.aside)}</code>. Delete that folder in Files once the restored world looks right.`
          : `Restoring ${escapeHtml(r.backup)} failed: ${escapeHtml(r.error)}. Nothing was changed unless the message says so.`;
  }

  async function loadBackups() {
    showRestore();
    let backups;
    try {
      ({ backups } = await call(api('/backups')));
    } catch (err) {
      $('mc-backups').innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
      return;
    }
    $('mc-backups').innerHTML = backups.length ? backups.map((b) => `
      <div class="file-row">
        <span class="file-name">${icon('archive')} <span class="ellipsis">${when(b.mtime)}</span> <span class="card-hint">${timeAgo(b.mtime)}</span></span>
        <span class="file-meta">${size(b.size)}</span>
        <span class="file-meta ellipsis">${escapeHtml(b.name)}</span>
        <span class="row-actions">
          <a class="small-btn" href="${api(`/backups/${encodeURIComponent(b.name)}/download`)}" download>Download</a>
          <button class="small-btn" data-restore="${escapeHtml(b.name)}" data-when="${escapeHtml(when(b.mtime))}" data-write>Restore</button>
        </span></div>`).join('')
      : '<p class="card-hint">No backups yet. The first one is taken a couple of minutes after the server starts.</p>';
    applyLocks();
  }

  $('mc-backups').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-restore]');
    if (!b || b.disabled) return;
    if (!confirm(`Restore the ${NAMES[mc.sel]} world from ${b.dataset.when}?\n\nThe current world is moved into a "before-restore" folder, not deleted. Plugins, mods and settings are left as they are.`)) return;
    try {
      await call(api(`/backups/${encodeURIComponent(b.dataset.restore)}/restore`), { method: 'POST' });
      mc.status[mc.sel] = { ...st(), restoring: true };
      applyLocks();
      showRestore();
    } catch (err) {
      alert(err.message);
    }
  });

  select(mc.sel);
})();
