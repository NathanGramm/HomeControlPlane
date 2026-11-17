// Game rules for the quest board. Pure functions over a plain state object,
// so they can be tested without Express or the filesystem. Every action takes
// `ctx` = { today: 'YYYY-MM-DD', hour: 0-23 } and pushes UI events into `events`.

const { ACHIEVEMENTS, ITEMS, RARITY_WEIGHTS } = require('./content');

const MAX_HP = 50;
const DIFFICULTY = { trivial: 1, easy: 2, medium: 3, hard: 5 };
const DROP_CHANCE = 0.12;
const MAX_FREEZES = 3;

class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- dates (plain YYYY-MM-DD strings, already in the player's timezone) ---

const toUtc = (day) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day, n) => new Date(toUtc(day) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
const weekday = (day) => new Date(toUtc(day)).getUTCDay(); // 0 = Sunday

// --- levels: going from level n to n+1 costs 100 + 50(n-1) XP ---

function levelInfo(totalXp) {
  let level = 1;
  let rem = totalXp;
  let need = 100;
  while (rem >= need) {
    rem -= need;
    level += 1;
    need = 100 + 50 * (level - 1);
  }
  return { level, into: rem, need };
}

function xpAtLevelStart(level) {
  let xp = 0;
  for (let l = 1; l < level; l++) xp += 100 + 50 * (l - 1);
  return xp;
}

// --- helpers ---

function find(list, id, what) {
  const item = list.find((x) => x.id === id);
  if (!item) throw new GameError(404, `No such ${what}`);
  return item;
}

const isDue = (daily, day) => daily.days.includes(weekday(day));

function bump(state, key, by = 1) {
  state.stats[key] = (state.stats[key] || 0) + by;
}

function rollDrop(state, rng, events) {
  if (rng() >= DROP_CHANCE) return null;
  let roll = rng() * Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let rarity = 'common';
  for (const [r, w] of Object.entries(RARITY_WEIGHTS)) {
    if (roll < w) {
      rarity = r;
      break;
    }
    roll -= w;
  }
  const pool = ITEMS.filter((i) => i.rarity === rarity);
  const item = pool[Math.floor(rng() * pool.length)];
  state.collection[item.id] = (state.collection[item.id] || 0) + 1;
  events.push({ type: 'drop', id: item.id, name: item.name, icon: item.icon, rarity });
  return item.id;
}

// Marks today as active and advances the streak. Called on every positive action.
// On the day's first action it returns what it changed, so an undo can put it back.
function markActive(state, ctx, events) {
  const p = state.player;
  state.history[ctx.today] = (state.history[ctx.today] || 0) + 1;
  if (p.lastActiveDay === ctx.today) return null;
  const prev = { streak: p.streak, bestStreak: p.bestStreak, lastActiveDay: p.lastActiveDay, freezes: p.freezes, fullWeekend: false };
  p.streak = p.lastActiveDay === addDays(ctx.today, -1) ? p.streak + 1 : 1;
  p.lastActiveDay = ctx.today;
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  bump(state, 'activeDays');
  if (weekday(ctx.today) === 0 && state.history[addDays(ctx.today, -1)]) {
    bump(state, 'fullWeekends');
    prev.fullWeekend = true;
  }
  if (p.streak % 7 === 0 && p.freezes < MAX_FREEZES) {
    p.freezes += 1;
    events.push({ type: 'freeze-earned', freezes: p.freezes });
  }
  return prev;
}

function gain(state, difficulty, ctx, rng, events) {
  const p = state.player;
  const mult = DIFFICULTY[difficulty] || 1;
  const bonus = 1 + Math.min(p.streak, 50) / 100; // up to +50% at a 50-day streak
  const xp = Math.round(10 * mult * bonus);
  const gold = Math.round(5 * mult * bonus);
  const before = levelInfo(p.xp).level;
  const hpBefore = p.hp;
  p.xp += xp;
  p.gold += gold;
  bump(state, 'goldEarned', gold);
  if (ctx.hour < 4) bump(state, 'nightOwl');
  if (ctx.hour >= 4 && ctx.hour < 6) bump(state, 'earlyBird');
  if (p.hp <= 10) bump(state, 'clutch');
  if (p.fainted) {
    p.fainted = false;
    bump(state, 'comebacks');
  }
  events.push({ type: 'reward', xp, gold });
  const after = levelInfo(p.xp).level;
  if (after > before) {
    p.hp = MAX_HP;
    events.push({ type: 'level', level: after });
  }
  const award = { xp, gold, day: ctx.today };
  if (after > before) award.healed = MAX_HP - hpBefore;
  const prev = markActive(state, ctx, events);
  if (prev) award.prev = prev;
  award.drop = rollDrop(state, rng, events);
  return award;
}

// Reverses a completion exactly, so toggling can't farm XP, gold or items.
function refund(state, award) {
  if (!award) return;
  const p = state.player;
  p.xp = Math.max(0, p.xp - award.xp);
  p.gold = Math.max(0, p.gold - award.gold);
  bump(state, 'goldEarned', -award.gold);
  if (award.drop && state.collection[award.drop]) {
    state.collection[award.drop] -= 1;
    if (!state.collection[award.drop]) delete state.collection[award.drop];
  }
  // Take back a level-up's heal, but never faint from an undo.
  if (award.healed) p.hp = Math.max(1, p.hp - award.healed);
  // Undoing the day's only action makes the day inactive again.
  if (award.day && state.history[award.day]) {
    state.history[award.day] -= 1;
    if (!state.history[award.day]) {
      delete state.history[award.day];
      if (award.prev && p.lastActiveDay === award.day) {
        const { fullWeekend, ...was } = award.prev;
        Object.assign(p, was);
        bump(state, 'activeDays', -1);
        if (fullWeekend) bump(state, 'fullWeekends', -1);
      }
    }
  }
}

function damage(state, amount, events) {
  const p = state.player;
  p.hp -= amount;
  events.push({ type: 'damage', amount, hp: Math.max(p.hp, 0) });
  if (p.hp > 0) return;
  // Fainting: refill HP, lose progress in the current level and half your gold.
  p.hp = MAX_HP;
  p.xp = xpAtLevelStart(levelInfo(p.xp).level);
  p.gold = Math.floor(p.gold / 2);
  p.fainted = true;
  bump(state, 'faints');
  events.push({ type: 'faint' });
}

// --- day rollover ---

// Runs once per new day, before any action. Only the last played day's
// dailies are judged (like Habitica), so a week away costs one day of damage.
function cron(state, ctx, events) {
  const p = state.player;
  if (!p.lastCronDay) {
    p.lastCronDay = ctx.today;
    return;
  }
  if (p.lastCronDay >= ctx.today) return;

  const judged = p.lastCronDay;
  const due = state.dailies.filter((d) => isDue(d, judged));
  const missed = due.filter((d) => !d.done);
  if (due.length && !missed.length) {
    bump(state, 'perfectDays');
    state.stats.perfectRun = (state.stats.perfectRun || 0) + 1;
    state.stats.bestPerfectRun = Math.max(state.stats.bestPerfectRun || 0, state.stats.perfectRun);
  } else if (missed.length) {
    state.stats.perfectRun = 0;
  }
  for (const d of state.dailies) {
    if (isDue(d, judged)) d.streak = d.done ? d.streak + 1 : 0;
    d.done = false;
    d.award = null;
    for (const c of d.checklist) c.done = false;
  }
  if (missed.length) {
    const hp = missed.reduce((sum, d) => sum + 2 * (DIFFICULTY[d.difficulty] || 1), 0);
    events.push({ type: 'missed', count: missed.length, titles: missed.map((d) => d.title) });
    damage(state, hp, events);
  }

  if (p.streak > 0 && p.lastActiveDay) {
    const gap = daysBetween(p.lastActiveDay, ctx.today) - 1;
    if (gap > 0 && p.freezes >= gap) {
      p.freezes -= gap;
      p.lastActiveDay = addDays(ctx.today, -1);
      events.push({ type: 'freeze-used', count: gap, freezes: p.freezes });
    } else if (gap > 0) {
      events.push({ type: 'streak-lost', streak: p.streak });
      p.streak = 0;
    }
  }
  p.lastCronDay = ctx.today;
}

// --- actions ---

function scoreHabit(state, id, dir, ctx, events, rng = Math.random) {
  const h = find(state.habits, id, 'habit');
  if (dir === 'up' && h.up) {
    h.ups += 1;
    bump(state, 'habitUps');
    gain(state, h.difficulty, ctx, rng, events);
  } else if (dir === 'down' && h.down) {
    h.downs += 1;
    bump(state, 'habitDowns');
    damage(state, 2 * (DIFFICULTY[h.difficulty] || 1), events);
  } else {
    throw new GameError(400, 'That habit has no such button');
  }
}

function toggleDaily(state, id, ctx, events, rng = Math.random) {
  const d = find(state.dailies, id, 'daily');
  if (d.done) {
    refund(state, d.award);
    d.done = false;
    d.award = null;
    bump(state, 'dailiesDone', -1);
    bump(state, 'tasksDone', -1);
    return;
  }
  d.done = true;
  bump(state, 'dailiesDone');
  bump(state, 'tasksDone');
  d.award = gain(state, d.difficulty, ctx, rng, events);
}

function toggleTodo(state, id, ctx, events, rng = Math.random) {
  const t = find(state.todos, id, 'to-do');
  const quest = t.questId && state.quests.find((q) => q.id === t.questId);
  if (t.done) {
    refund(state, t.award);
    t.done = false;
    t.doneAt = null;
    t.award = null;
    bump(state, 'todosDone', -1);
    bump(state, 'tasksDone', -1);
    if (quest && quest.completedAt) {
      refund(state, quest.award);
      quest.completedAt = null;
      quest.award = null;
      bump(state, 'questsDone', -1);
    }
    return;
  }
  t.done = true;
  t.doneAt = ctx.today;
  bump(state, 'todosDone');
  bump(state, 'tasksDone');
  t.award = gain(state, t.difficulty, ctx, rng, events);
  if (quest && !quest.completedAt) {
    const steps = state.todos.filter((x) => x.questId === quest.id);
    if (steps.every((x) => x.done)) {
      const gold = 25 * steps.length;
      state.player.gold += gold;
      bump(state, 'goldEarned', gold);
      bump(state, 'questsDone');
      quest.completedAt = ctx.today;
      quest.award = { xp: 0, gold, drop: null };
      events.push({ type: 'quest-complete', title: quest.title, gold });
    }
  }
}

function toggleChecklist(state, kind, id, index) {
  const list = kind === 'dailies' ? state.dailies : state.todos;
  const item = find(list, id, 'task');
  const step = item.checklist[index];
  if (!step) throw new GameError(404, 'No such checklist step');
  step.done = !step.done;
}

function buyReward(state, id, events) {
  const r = find(state.rewards, id, 'reward');
  if (state.player.gold < r.cost) throw new GameError(400, `Not enough gold (need ${r.cost})`);
  state.player.gold -= r.cost;
  bump(state, 'rewardsBought');
  bump(state, 'goldSpent', r.cost);
  events.push({ type: 'bought', title: r.title, cost: r.cost });
}

// --- achievements ---

function checkAchievements(state, ctx, events) {
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id]) continue;
    if (a.test(state, ctx)) {
      state.achievements[a.id] = ctx.today;
      events.push({ type: 'achievement', id: a.id, name: a.name, icon: a.icon });
    }
  }
}

module.exports = {
  MAX_HP,
  DIFFICULTY,
  GameError,
  levelInfo,
  isDue,
  addDays,
  cron,
  scoreHabit,
  toggleDaily,
  toggleTodo,
  toggleChecklist,
  buyReward,
  checkAchievements,
};
