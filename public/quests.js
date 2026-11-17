// Quest board UI. The server owns all game rules; this file only renders the
// state it returns and sends clicks back. Every API call returns the full board.

let S = null;
const $ = (id) => document.getElementById(id);
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DIFFS = ['trivial', 'easy', 'medium', 'hard'];
const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(method, url, body) {
  try {
    const res = await fetch(`/api/quests${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Something went wrong', 'bad');
      return false;
    }
    S = data.state;
    render();
    data.events.forEach(showEvent);
    return true;
  } catch (err) {
    toast("Couldn't reach the server", 'bad');
    console.error(err);
    return false;
  }
}

// --- toasts ---

function toast(html, kind = '') {
  const el = document.createElement('div');
  el.className = `qb-toast ${kind}`;
  el.innerHTML = html;
  $('qb-toasts').append(el);
  setTimeout(() => el.remove(), kind === 'big' ? 6000 : 3500);
}

function showEvent(e) {
  switch (e.type) {
    case 'reward': return toast(`+${e.xp} XP &middot; +${e.gold} gold`, 'good');
    case 'level': return toast(`Level up! You're now level ${e.level}. HP refilled.`, 'big');
    case 'damage': return toast(`&minus;${e.amount} HP`, 'bad');
    case 'faint': return toast('You fainted. Lost this level\'s progress and half your gold.', 'big bad');
    case 'missed': return toast(`Missed yesterday: ${e.titles.map(esc).join(', ')}`, 'bad');
    case 'achievement': return toast(`${e.icon} Achievement unlocked: <b>${esc(e.name)}</b>`, 'big');
    case 'drop': return toast(`${e.icon} Found: <b>${esc(e.name)}</b> (${RARITY_LABEL[e.rarity]})`, `drop-${e.rarity}`);
    case 'quest-complete': return toast(`Quest line complete: <b>${esc(e.title)}</b> &middot; +${e.gold} gold`, 'big');
    case 'freeze-earned': return toast(`❄️ Streak freeze earned (${e.freezes}/3)`, 'good');
    case 'freeze-used': return toast(`❄️ Used ${e.count} streak freeze${e.count > 1 ? 's' : ''}. Streak saved.`);
    case 'streak-lost': return toast(`Your ${e.streak}-day streak ended. Start a new one today.`, 'bad');
    case 'bought': return toast(`Enjoy: ${esc(e.title)} (&minus;${e.cost} gold)`, 'good');
    default: return null;
  }
}

// --- rendering ---

const bar = (pct, cls) => `<div class="qb-bar"><div class="qb-bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
const diffTag = (d) => `<span class="qb-tag qb-diff-${d}">${d}</span>`;
const editBtn = (kind, id) => `<button class="qb-icon-btn" data-act="edit" data-kind="${kind}" data-id="${esc(id)}" aria-label="Edit">✎</button>`;
const checklist = (kind, item) => (item.checklist.length ? `<ul class="qb-checklist">${item.checklist.map((c, i) => `
  <li><button class="qb-check qb-check-sm ${c.done ? 'on' : ''}" data-act="step" data-kind="${kind}" data-id="${esc(item.id)}" data-i="${i}" aria-pressed="${c.done}" aria-label="Step done"></button>
  <span class="${c.done ? 'qb-done-text' : ''}">${esc(c.text)}</span></li>`).join('')}</ul>` : '');
const notes = (n) => (n ? `<p class="qb-notes">${esc(n)}</p>` : '');

function render() {
  const p = S.player;
  $('qb-today').textContent = new Date(`${S.today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('qb-player').innerHTML = `
    <div class="qb-level"><span class="qb-level-num">${S.level.level}</span><span class="qb-level-label">Level</span></div>
    <div class="qb-stats">
      <div class="qb-stat"><div class="qb-stat-head"><span>Health</span><span>${p.hp} / ${S.maxHp}</span></div>${bar((p.hp / S.maxHp) * 100, 'hp')}</div>
      <div class="qb-stat"><div class="qb-stat-head"><span>Experience</span><span>${S.level.into} / ${S.level.need}</span></div>${bar((S.level.into / S.level.need) * 100, 'xp')}</div>
      <div class="qb-counters">
        <span title="Gold">🪙 <b>${p.gold.toLocaleString()}</b></span>
        <span title="Current streak (best ${p.bestStreak})">🔥 <b>${p.streak}</b> day${p.streak === 1 ? '' : 's'}</span>
        <span title="Streak freezes: each one saves your streak for a missed day">❄️ <b>${p.freezes}</b>/3</span>
        <span title="Streak bonus on XP and gold">+${Math.min(p.streak, 50)}% bonus</span>
      </div>
    </div>
    ${heatmap()}`;

  $('qb-habits').innerHTML = S.habits.map((h) => `
    <div class="qb-card qb-habit">
      ${h.up ? `<button class="qb-habit-btn up" data-act="habit" data-dir="up" data-id="${esc(h.id)}" aria-label="Did it: ${esc(h.title)}">+</button>` : '<span class="qb-habit-spacer"></span>'}
      <div class="qb-card-body"><div class="qb-card-title">${esc(h.title)}</div>${notes(h.notes)}
        <div class="qb-meta">${diffTag(h.difficulty)}${h.up ? `<span>+${h.ups}</span>` : ''}${h.down ? `<span>&minus;${h.downs}</span>` : ''}</div></div>
      ${editBtn('habits', h.id)}
      ${h.down ? `<button class="qb-habit-btn down" data-act="habit" data-dir="down" data-id="${esc(h.id)}" aria-label="Slipped: ${esc(h.title)}">&minus;</button>` : '<span class="qb-habit-spacer"></span>'}
    </div>`).join('') || '<p class="qb-empty">Add a habit to track.</p>';

  const dailies = [...S.dailies].sort((a, b) => (b.due - a.due) || (a.done - b.done));
  $('qb-dailies').innerHTML = dailies.map((d) => `
    <div class="qb-card ${d.done ? 'is-done' : ''} ${d.due ? '' : 'not-due'}">
      <button class="qb-check ${d.done ? 'on' : ''}" data-act="daily" data-id="${esc(d.id)}" aria-pressed="${d.done}" aria-label="Done: ${esc(d.title)}"></button>
      <div class="qb-card-body">
        <div class="qb-card-title">${esc(d.title)}</div>${notes(d.notes)}
        <div class="qb-meta">${diffTag(d.difficulty)}<span>${d.days.length === 7 ? 'Every day' : d.days.map((i) => DAYS[i]).join(' ')}</span>
          ${d.streak ? `<span>🔥 ${d.streak}</span>` : ''}${d.due ? '' : '<span>Not due today</span>'}</div>
        ${checklist('dailies', d)}
      </div>
      ${editBtn('dailies', d.id)}
    </div>`).join('') || '<p class="qb-empty">Add something you do every day.</p>';

  const todoCard = (t) => `
    <div class="qb-card ${t.done ? 'is-done' : ''}">
      <button class="qb-check ${t.done ? 'on' : ''}" data-act="todo" data-id="${esc(t.id)}" aria-pressed="${t.done}" aria-label="Done: ${esc(t.title)}"></button>
      <div class="qb-card-body"><div class="qb-card-title">${esc(t.title)}</div>${notes(t.notes)}
        <div class="qb-meta">${diffTag(t.difficulty)}${t.doneAt ? `<span>Done ${esc(t.doneAt)}</span>` : ''}</div>${checklist('todos', t)}</div>
      ${editBtn('todos', t.id)}
    </div>`;
  const questBlock = (q, steps) => {
    const done = steps.filter((t) => t.done);
    const open = steps.filter((t) => !t.done);
    return `
    <div class="qb-quest ${q && q.completedAt ? 'is-complete' : ''}">
      <div class="qb-quest-head">
        <span class="qb-quest-title">${q ? esc(q.title) : 'Loose tasks'}</span>
        <span class="qb-quest-count">${done.length}/${steps.length}</span>
        ${q ? editBtn('quests', q.id) : ''}
      </div>
      ${q ? notes(q.notes) : ''}
      ${steps.length ? bar((done.length / steps.length) * 100, 'quest') : ''}
      ${open.map(todoCard).join('')}
      ${done.length ? `<details class="qb-done-list"><summary>${done.length} done</summary>${done.map(todoCard).join('')}</details>` : ''}
    </div>`;
  };
  const activeQuests = S.quests.filter((q) => !q.completedAt);
  const finished = S.quests.filter((q) => q.completedAt);
  const loose = S.todos.filter((t) => !t.questId);
  $('qb-quests').innerHTML = activeQuests.map((q) => questBlock(q, S.todos.filter((t) => t.questId === q.id))).join('')
    + (loose.length ? questBlock(null, loose) : '')
    + (finished.length ? `<details class="qb-done-list"><summary>${finished.length} completed quest line${finished.length > 1 ? 's' : ''}</summary>
        ${finished.map((q) => questBlock(q, S.todos.filter((t) => t.questId === q.id))).join('')}</details>` : '');

  const sel = $('qb-quest-select');
  const keep = sel.value;
  sel.innerHTML = '<option value="">No quest line</option>' + activeQuests.map((q) => `<option value="${esc(q.id)}">${esc(q.title)}</option>`).join('');
  sel.value = keep;

  $('qb-rewards').innerHTML = S.rewards.map((r) => `
    <div class="qb-card qb-reward">
      <div class="qb-card-body"><div class="qb-card-title">${esc(r.title)}</div>${notes(r.notes)}</div>
      ${editBtn('rewards', r.id)}
      <button class="qb-buy ${p.gold >= r.cost ? '' : 'cant'}" data-act="buy" data-id="${esc(r.id)}">🪙 ${r.cost.toLocaleString()}</button>
    </div>`).join('') || '<p class="qb-empty">Add something worth working for.</p>';

  renderAchievements();
  renderCollection();
}

function heatmap() {
  const days = [];
  const end = new Date(`${S.today}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7 * 16 + 1 - end.getUTCDay() + 6); // 16 weeks, columns end on Saturday
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const n = S.history[key] || 0;
    const lvl = n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : 3;
    days.push(`<span class="qb-heat l${lvl}" title="${key}: ${n} done"></span>`);
  }
  return `<div class="qb-heatmap" aria-label="Activity over the last 16 weeks">${days.join('')}</div>`;
}

function renderAchievements() {
  const all = S.catalogue.achievements;
  const got = all.filter((a) => S.achievements[a.id]);
  $('qb-ach-title').textContent = `Achievements ${got.length} / ${all.length}`;
  const badge = (a) => {
    const when = S.achievements[a.id];
    const hidden = a.secret && !when;
    const pct = a.goal && !when ? Math.min(100, (a.progress / a.goal) * 100) : 0;
    return `<div class="qb-badge ${when ? 'got' : 'locked'}" title="${hidden ? 'Secret achievement' : esc(a.desc)}">
      <span class="qb-badge-icon">${hidden ? '❔' : a.icon}</span>
      <span class="qb-badge-name">${hidden ? '???' : esc(a.name)}</span>
      <span class="qb-badge-desc">${hidden ? 'Secret' : when ? `Earned ${esc(when)}` : esc(a.desc)}</span>
      ${a.goal && !when && !hidden ? `${bar(pct, 'ach')}<span class="qb-badge-desc">${Math.min(a.progress, a.goal).toLocaleString()} / ${a.goal.toLocaleString()}</span>` : ''}
    </div>`;
  };
  const recent = [...got].sort((a, b) => S.achievements[b.id].localeCompare(S.achievements[a.id])).slice(0, 6);
  const next = all.filter((a) => !S.achievements[a.id] && a.goal && !a.secret)
    .sort((a, b) => b.progress / b.goal - a.progress / a.goal).slice(0, 6);
  $('qb-achievements').innerHTML = `
    ${recent.length ? `<h3 class="qb-sub">Recently earned</h3><div class="qb-badges">${recent.map(badge).join('')}</div>` : ''}
    <h3 class="qb-sub">Next up</h3><div class="qb-badges">${next.map(badge).join('')}</div>
    <details class="qb-all"><summary>All achievements</summary><div class="qb-badges">${all.map(badge).join('')}</div></details>`;
}

function renderCollection() {
  const { items, sets } = S.catalogue;
  const owned = items.filter((i) => S.collection[i.id]).length;
  $('qb-col-title').textContent = `Collection ${owned} / ${items.length}`;
  $('qb-collection').innerHTML = `<p class="qb-hint">Every completed task has a 12% chance to drop an item. Complete a set for an achievement.</p>` + sets.map((set) => {
    const its = items.filter((i) => i.set === set.id);
    const have = its.filter((i) => S.collection[i.id]).length;
    return `<div class="qb-set"><div class="qb-set-head"><span>${esc(set.name)}</span><span>${have}/${its.length}</span></div>
      <div class="qb-items">${its.map((i) => {
        const n = S.collection[i.id];
        return `<div class="qb-item r-${i.rarity} ${n ? '' : 'missing'}" title="${n ? esc(i.name) : '???'} · ${RARITY_LABEL[i.rarity]}">
          <span class="qb-item-icon">${n ? i.icon : '?'}</span>${n > 1 ? `<span class="qb-item-count">×${n}</span>` : ''}</div>`;
      }).join('')}</div></div>`;
  }).join('');
}

// --- editing ---

function openEditor(kind, id) {
  const item = S[kind].find((x) => x.id === id);
  if (!item) return;
  const f = $('qb-edit-form');
  const has = (k) => ({
    difficulty: ['habits', 'dailies', 'todos'], buttons: ['habits'], days: ['dailies'],
    checklist: ['dailies', 'todos'], quest: ['todos'], cost: ['rewards'],
  }[k].includes(kind));
  f.innerHTML = `
    <h2>Edit</h2>
    <label>Title<input name="title" required maxlength="200" value="${esc(item.title)}"></label>
    <label>Notes<textarea name="notes" rows="2" maxlength="2000">${esc(item.notes)}</textarea></label>
    ${has('difficulty') ? `<label>Difficulty<select name="difficulty">${DIFFS.map((d) => `<option ${d === item.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select></label>` : ''}
    ${has('buttons') ? `<div class="qb-row"><label class="qb-inline"><input type="checkbox" name="up" ${item.up ? 'checked' : ''}> + button (good)</label>
      <label class="qb-inline"><input type="checkbox" name="down" ${item.down ? 'checked' : ''}> &minus; button (bad)</label></div>` : ''}
    ${has('days') ? `<fieldset class="qb-days"><legend>Due on</legend>${DAYS.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${item.days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</fieldset>` : ''}
    ${has('quest') ? `<label>Quest line<select name="questId"><option value="">No quest line</option>${S.quests.map((q) => `<option value="${esc(q.id)}" ${q.id === item.questId ? 'selected' : ''}>${esc(q.title)}</option>`).join('')}</select></label>` : ''}
    ${has('checklist') ? `<label>Checklist, one step per line<textarea name="checklist" rows="6">${esc(item.checklist.map((c) => c.text).join('\n'))}</textarea></label>` : ''}
    ${has('cost') ? `<label>Cost in gold<input name="cost" type="number" min="1" required value="${item.cost}"></label>` : ''}
    <div class="qb-row qb-dialog-actions">
      <button type="button" class="qb-danger" id="qb-delete">Delete</button>
      <span class="qb-spacer"></span>
      <button value="cancel" formnovalidate>Cancel</button>
      <button value="save" class="qb-primary">Save</button>
    </div>`;

  f.onsubmit = async (ev) => {
    if (ev.submitter?.value !== 'save') return;
    ev.preventDefault();
    const fd = new FormData(f);
    const body = { title: fd.get('title'), notes: fd.get('notes') };
    if (has('difficulty')) body.difficulty = fd.get('difficulty');
    if (has('buttons')) { body.up = fd.has('up'); body.down = fd.has('down'); }
    if (has('days')) body.days = fd.getAll('day').map(Number);
    if (has('quest')) body.questId = fd.get('questId');
    if (has('checklist')) body.checklist = fd.get('checklist').split('\n').map((s) => s.trim()).filter(Boolean);
    if (has('cost')) body.cost = Number(fd.get('cost'));
    if (await api('PUT', `/${kind}/${id}`, body)) $('qb-dialog').close();
  };
  $('qb-delete').onclick = async () => {
    const what = kind === 'quests' ? 'this quest line (its steps become loose tasks)' : 'this item';
    if (confirm(`Delete ${what}?`) && (await api('DELETE', `/${kind}/${id}`))) $('qb-dialog').close();
  };
  $('qb-dialog').showModal();
}

// --- events ---

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const { act, id, kind } = b.dataset;
  if (act === 'habit') api('POST', `/habits/${id}/${b.dataset.dir}`);
  if (act === 'daily') api('POST', `/dailies/${id}/toggle`);
  if (act === 'todo') api('POST', `/todos/${id}/toggle`);
  if (act === 'step') api('POST', `/${kind}/${id}/checklist/${b.dataset.i}`);
  if (act === 'buy') {
    const r = S.rewards.find((x) => x.id === id);
    if (r && confirm(`Spend ${r.cost} gold on "${r.title}"?`)) api('POST', `/rewards/${id}/buy`);
  }
  if (act === 'edit') openEditor(kind, id);
});

document.querySelectorAll('.qb-add').forEach((form) => {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const title = fd.get('title').trim();
    if (!title) return toast('Enter a title first', 'bad');
    const body = { title };
    if (form.dataset.kind === 'todos') body.questId = fd.get('questId');
    if (form.dataset.kind === 'rewards') {
      body.cost = Number(fd.get('cost'));
      if (!body.cost) return toast('Enter a gold cost', 'bad');
    }
    if (await api('POST', `/${form.dataset.kind}`, body)) form.reset();
  });
});

// Pick up the day rollover if the tab is left open overnight.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) api('GET', '/');
});

api('GET', '/');
