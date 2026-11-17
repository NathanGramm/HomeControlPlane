const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const engine = require('../quests/engine');
const { ACHIEVEMENTS, ITEMS, SETS, metric, seedState, upgradeState } = require('../quests/content');

const { GameError } = engine;
const FILE = process.env.QUESTS_FILE || path.join(__dirname, '..', '..', 'data', 'quests.json');
const TZ = process.env.TZ || 'America/New_York';

// shortcut: whole board is one JSON file rewritten on every change. Fine for
// one player and a few thousand items; move to SQLite if it grows past that.
let state = null;

function load() {
  if (state) return state;
  if (fs.existsSync(FILE)) {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (upgradeState(state)) save();
  } else {
    state = seedState(clock().today);
    save();
  }
  return state;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE); // atomic swap, so a crash mid-write can't corrupt the board
}

// One dated copy per day in a second folder (the 4 TB disk in production),
// so a lost volume or root disk costs at most a day. Keeps the last 30.
const BACKUP_DIR = process.env.QUESTS_BACKUP_DIR || '';
const KEEP_BACKUPS = 30;
let backedUpDay = null;

function backup(today) {
  if (!BACKUP_DIR || backedUpDay === today || !fs.existsSync(FILE)) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(FILE, path.join(BACKUP_DIR, `quests-${today}.json`));
    const old = fs.readdirSync(BACKUP_DIR).filter((n) => /^quests-\d{4}-\d\d-\d\d\.json$/.test(n)).sort().slice(0, -KEEP_BACKUPS);
    for (const n of old) fs.unlinkSync(path.join(BACKUP_DIR, n));
    backedUpDay = today;
  } catch (err) {
    console.error('Quest board backup failed:', err.message); // the board itself still works; retried next request
  }
}

function clock() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { today: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function view(s, ctx) {
  return {
    ...s,
    today: ctx.today,
    level: engine.levelInfo(s.player.xp),
    maxHp: engine.MAX_HP,
    dailies: s.dailies.map((d) => ({
      ...d, due: engine.isDue(d, ctx.today), advice: d.routine ? engine.workoutAdvice(s, d, ctx.today) : undefined,
    })),
    catalogue: {
      achievements: ACHIEVEMENTS.map((a) => ({
        id: a.id, name: a.name, icon: a.icon, desc: a.desc, secret: !!a.secret, goal: a.goal || null, progress: a.stat ? metric(s, ctx, a.stat) : null,
      })),
      items: ITEMS,
      sets: SETS.map((set) => ({ id: set.id, name: set.name })),
    },
  };
}

// --- input validation (everything from the browser goes through here) ---

const KINDS = ['habits', 'dailies', 'todos', 'rewards', 'quests'];

function str(v, max, field, required = false) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new GameError(400, `${field} is required`);
    return '';
  }
  if (typeof v !== 'string' || v.length > max) throw new GameError(400, `${field} must be text up to ${max} characters`);
  return v.trim();
}

const int = (v, lo, hi, field) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new GameError(400, `${field} must be a whole number from ${lo} to ${hi}`);
  return v;
};

// A daily's workout routine, or null to remove it. Exercise ids are kept
// when given, so history still lines up after an edit.
function parseRoutine(r) {
  if (r === undefined || r === null) return null;
  if (typeof r !== 'object' || !Array.isArray(r.exercises) || !r.exercises.length || r.exercises.length > 20) {
    throw new GameError(400, 'A routine needs 1 to 20 exercises');
  }
  const ids = new Set();
  const exercises = r.exercises.map((e, i) => {
    const at = `Exercise ${i + 1}`;
    const name = str(e?.name, 100, `${at} name`, true);
    if (!name) throw new GameError(400, `${at} needs a name`);
    let id = typeof e.id === 'string' && /^[\w-]{1,40}$/.test(e.id) ? e.id : crypto.randomUUID().slice(0, 8);
    if (ids.has(id)) id = crypto.randomUUID().slice(0, 8);
    ids.add(id);
    if (!['reps', 'secs'].includes(e.unit)) throw new GameError(400, `${at}: count reps or seconds`);
    const min = int(e.min, 1, 999, `${at} minimum`);
    const max = int(e.max, min, 999, `${at} maximum`);
    if (!Array.isArray(e.steps) || e.steps.length > 10) throw new GameError(400, `${at} can have up to 10 steps`);
    const steps = e.steps.map((t, j) => str(t, 60, `${at} step ${j + 1}`)).filter(Boolean);
    const step = steps.length ? int(e.step ?? 0, 0, steps.length - 1, `${at} current step`) : 0;
    return { id, name, sets: int(e.sets, 1, 10, `${at} sets`), unit: e.unit, min, max, steps, step };
  });
  return { rest: int(r.rest ?? 90, 0, 600, 'Rest'), exercises };
}

// A logged session: [{ exId, step, sets }] for exercises in this daily's routine.
function parseWorkout(body, daily) {
  if (!daily) throw new GameError(404, 'No such daily');
  if (!daily.routine) throw new GameError(400, 'This daily has no routine');
  const byId = new Map(daily.routine.exercises.map((e) => [e.id, e]));
  const list = body.exercises;
  if (!Array.isArray(list) || list.length > 20) throw new GameError(400, 'Bad workout');
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const ex = byId.get(e?.exId);
    if (!ex || seen.has(e.exId)) throw new GameError(400, 'Unknown exercise in workout');
    seen.add(e.exId);
    if (!Array.isArray(e.sets) || e.sets.length > 10) throw new GameError(400, `${ex.name}: up to 10 sets`);
    // Empty boxes at the end are sets not done; one in the middle would shift
    // every later set into the wrong slot, so it's refused.
    const empty = (v) => v === null || v === '';
    const filled = e.sets.slice(0, e.sets.findLastIndex((v) => !empty(v)) + 1);
    if (filled.some(empty)) throw new GameError(400, `${ex.name}: fill in every set before the last one, or clear the later ones`);
    const sets = filled.map((v) => int(v, 0, 9999, `${ex.name} set`));
    if (!sets.length) continue; // skipped exercise
    const step = ex.steps.length ? int(e.step ?? ex.step, 0, ex.steps.length - 1, `${ex.name} step`) : 0;
    out.push({ exId: e.exId, step, sets });
  }
  if (!out.length) throw new GameError(400, 'Enter at least one set');
  return out;
}

function parseFields(kind, body, s) {
  const out = { title: str(body.title, 200, 'Title', true), notes: str(body.notes, 2000, 'Notes') };
  if (!out.title) throw new GameError(400, 'Title is required');
  if (['habits', 'dailies', 'todos'].includes(kind)) {
    out.difficulty = body.difficulty ?? 'easy';
    if (!(out.difficulty in engine.DIFFICULTY)) throw new GameError(400, 'Unknown difficulty');
  }
  if (kind === 'habits') {
    out.up = body.up !== false;
    out.down = body.down === true;
    if (!out.up && !out.down) throw new GameError(400, 'A habit needs a + or - button');
  }
  if (kind === 'dailies') {
    const days = body.days ?? [0, 1, 2, 3, 4, 5, 6];
    if (!Array.isArray(days) || !days.length || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      throw new GameError(400, 'Pick at least one day');
    }
    out.days = [...new Set(days)].sort();
    if ('routine' in body) out.routine = parseRoutine(body.routine);
  }
  if (kind === 'dailies' || kind === 'todos') {
    const list = body.checklist ?? [];
    if (!Array.isArray(list) || list.length > 30) throw new GameError(400, 'Checklist can have up to 30 steps');
    out.checklist = list.map((t, i) => str(t, 200, `Step ${i + 1}`)).filter(Boolean);
  }
  if (kind === 'todos') {
    out.questId = body.questId || null;
    if (out.questId && !s.quests.some((q) => q.id === out.questId)) throw new GameError(400, 'Unknown quest line');
  }
  if (kind === 'rewards') {
    out.cost = Number(body.cost);
    if (!Number.isInteger(out.cost) || out.cost < 1 || out.cost > 1000000) throw new GameError(400, 'Cost must be a whole number from 1 to 1,000,000');
  }
  return out;
}

function create(kind, f) {
  const id = crypto.randomUUID().slice(0, 8);
  const steps = (f.checklist || []).map((text) => ({ text, done: false }));
  switch (kind) {
    case 'habits': return { id, ...f, ups: 0, downs: 0 };
    case 'dailies': return { id, ...f, checklist: steps, done: false, streak: 0, award: null };
    case 'todos': return { id, ...f, checklist: steps, done: false, doneAt: null, award: null };
    case 'rewards': return { id, ...f };
    default: return { id, ...f, completedAt: null, award: null };
  }
}

// --- routes ---

const router = express.Router();
router.use(express.json({ limit: '50kb' }));

// Every request runs the day rollover first, then the action, then
// achievement checks, then saves and returns the whole board plus events.
// A plain read only saves when the rollover or an achievement changed something,
// so polling the board doesn't rewrite the file every 30 seconds.
const act = (fn) => (req, res) => {
  try {
    const s = load();
    const ctx = clock();
    const events = [];
    const cronDay = s.player.lastCronDay;
    engine.cron(s, ctx, events);
    fn(s, req, ctx, events);
    engine.checkAchievements(s, ctx, events);
    if (req.method !== 'GET' || events.length || s.player.lastCronDay !== cronDay) save();
    backup(ctx.today);
    res.json({ state: view(s, ctx), events });
  } catch (err) {
    if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

const kindOf = (req) => {
  if (!KINDS.includes(req.params.kind)) throw new GameError(404, 'Unknown list');
  return req.params.kind;
};

router.get('/', act(() => {}));
router.post('/habits/:id/:dir', act((s, req, ctx, ev) => engine.scoreHabit(s, req.params.id, req.params.dir, ctx, ev)));
router.post('/dailies/:id/toggle', act((s, req, ctx, ev) => engine.toggleDaily(s, req.params.id, ctx, ev)));
router.post('/todos/:id/toggle', act((s, req, ctx, ev) => engine.toggleTodo(s, req.params.id, ctx, ev)));
router.post('/:kind/:id/checklist/:index', act((s, req) => {
  if (!['dailies', 'todos'].includes(req.params.kind)) throw new GameError(404, 'Unknown list');
  engine.toggleChecklist(s, req.params.kind, req.params.id, Number(req.params.index));
}));
router.post('/dailies/:id/workout', act((s, req, ctx, ev) => {
  const entries = parseWorkout(req.body || {}, s.dailies.find((d) => d.id === req.params.id));
  engine.logWorkout(s, req.params.id, entries, ctx, ev);
}));
router.post('/rewards/:id/buy', act((s, req, ctx, ev) => engine.buyReward(s, req.params.id, ev)));

router.post('/:kind', act((s, req) => {
  const kind = kindOf(req);
  s[kind].push(create(kind, parseFields(kind, req.body || {}, s)));
}));

router.put('/:kind/:id', act((s, req) => {
  const kind = kindOf(req);
  const item = s[kind].find((x) => x.id === req.params.id);
  if (!item) throw new GameError(404, 'Not found');
  const f = parseFields(kind, req.body || {}, s);
  if (f.checklist) {
    // Keep ticks on steps whose text didn't change.
    const was = new Map(item.checklist.map((c) => [c.text, c.done]));
    f.checklist = f.checklist.map((text) => ({ text, done: was.get(text) || false }));
  }
  Object.assign(item, f);
}));

router.delete('/:kind/:id', act((s, req) => {
  const kind = kindOf(req);
  const before = s[kind].length;
  s[kind] = s[kind].filter((x) => x.id !== req.params.id);
  if (s[kind].length === before) throw new GameError(404, 'Not found');
  if (kind === 'quests') for (const t of s.todos) if (t.questId === req.params.id) t.questId = null;
}));

module.exports = router;
