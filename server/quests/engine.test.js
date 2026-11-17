const assert = require('node:assert');
const { test } = require('node:test');
const engine = require('./engine');
const { seedState, ACHIEVEMENTS, ITEMS } = require('./content');

const MON = '2026-11-16'; // a Monday
const ctx = (today, hour = 12) => ({ today, hour });
const noDrop = () => 0.99;

function fresh() {
  const s = seedState(MON);
  engine.cron(s, ctx(MON), []);
  return s;
}

test('seed content is consistent', () => {
  const s = seedState(MON);
  const ids = new Set(s.quests.map((q) => q.id));
  for (const t of s.todos) assert.ok(ids.has(t.questId), t.id);
  assert.strictEqual(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  assert.strictEqual(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
  assert.ok(ACHIEVEMENTS.length >= 80);
});

test('completing a to-do pays out, and undoing it takes everything back', () => {
  const s = fresh();
  const events = [];
  engine.toggleTodo(s, 'delete-dumps', ctx(MON), events, () => 0); // forces a drop
  assert.ok(s.player.xp > 0 && s.player.gold > 0);
  assert.strictEqual(Object.keys(s.collection).length, 1);
  assert.strictEqual(s.player.streak, 1);
  engine.checkAchievements(s, ctx(MON), events);
  assert.ok(s.achievements['tasks-1']);

  engine.toggleTodo(s, 'delete-dumps', ctx(MON), [], noDrop);
  assert.strictEqual(s.player.xp, 0);
  assert.strictEqual(s.player.gold, 0);
  assert.deepStrictEqual(s.collection, {});
  assert.strictEqual(s.stats.tasksDone, 0);
});

test('finishing every step of a quest line pays a bonus once', () => {
  const s = fresh();
  const events = [];
  for (const t of s.todos.filter((t) => t.questId === 'pihole-tile')) engine.toggleTodo(s, t.id, ctx(MON), events, noDrop);
  assert.ok(events.some((e) => e.type === 'quest-complete'));
  assert.strictEqual(s.stats.questsDone, 1);
  engine.toggleTodo(s, 'pihole-ui', ctx(MON), [], noDrop);
  assert.strictEqual(s.stats.questsDone, 0);
});

test('missed dailies cost HP at rollover and reset for the new day', () => {
  const s = fresh();
  engine.toggleDaily(s, 'walk', ctx(MON), [], noDrop);
  const events = [];
  engine.cron(s, ctx('2026-11-17'), events);
  const missed = events.find((e) => e.type === 'missed');
  assert.ok(missed && !missed.titles.includes('Walk 20+ minutes'));
  assert.ok(s.player.hp < engine.MAX_HP);
  assert.ok(s.dailies.every((d) => !d.done));
  assert.strictEqual(s.dailies.find((d) => d.id === 'walk').streak, 1);
});

test('doing every due daily counts as a perfect day', () => {
  const s = fresh();
  for (const d of s.dailies.filter((d) => engine.isDue(d, MON))) engine.toggleDaily(s, d.id, ctx(MON), [], noDrop);
  engine.cron(s, ctx('2026-11-17'), []);
  assert.strictEqual(s.stats.perfectDays, 1);
  assert.strictEqual(s.player.hp, engine.MAX_HP);
});

test('a freeze saves the streak over one missed day; no freeze breaks it', () => {
  const s = fresh();
  engine.toggleTodo(s, 'delete-dumps', ctx(MON), [], noDrop);
  assert.strictEqual(s.player.freezes, 1);
  const events = [];
  engine.cron(s, ctx('2026-11-18'), events); // skipped Tuesday
  assert.ok(events.some((e) => e.type === 'freeze-used'));
  engine.toggleTodo(s, 'gitops', ctx('2026-11-18'), [], noDrop);
  assert.strictEqual(s.player.streak, 2);

  const lost = [];
  engine.cron(s, ctx('2026-11-21'), lost); // skipped two more days, no freezes left
  assert.ok(lost.some((e) => e.type === 'streak-lost'));
  assert.strictEqual(s.player.streak, 0);
});

test('every 7th streak day earns a freeze, up to 3', () => {
  const s = fresh();
  s.player.freezes = 0;
  let day = MON;
  const ids = s.todos.map((t) => t.id);
  for (let i = 0; i < 7; i++) {
    engine.cron(s, ctx(day), []);
    engine.toggleTodo(s, ids[i], ctx(day), [], noDrop);
    day = engine.addDays(day, 1);
  }
  assert.strictEqual(s.player.streak, 7);
  assert.strictEqual(s.player.freezes, 1);
});

test('levelling up refills HP; fainting costs level progress and half the gold', () => {
  const s = fresh();
  s.player.hp = 5;
  s.player.xp = 95;
  engine.toggleTodo(s, 'ram-buy', ctx(MON), [], noDrop);
  assert.strictEqual(engine.levelInfo(s.player.xp).level, 2);
  assert.strictEqual(s.player.hp, engine.MAX_HP);

  s.player.hp = 1;
  s.player.gold = 101;
  const events = [];
  engine.scoreHabit(s, 'late', 'down', ctx(MON), events);
  assert.ok(events.some((e) => e.type === 'faint'));
  assert.strictEqual(s.player.xp, 100);
  assert.strictEqual(s.player.gold, 50);
  assert.strictEqual(s.player.hp, engine.MAX_HP);
});

test('rewards cost gold and refuse when you cannot afford them', () => {
  const s = fresh();
  assert.throws(() => engine.buyReward(s, 'movie', []), /Not enough gold/);
  s.player.gold = 100;
  engine.buyReward(s, 'movie', []);
  assert.strictEqual(s.player.gold, 20);
});

test('level curve: 100 XP to level 2, 150 more to level 3', () => {
  assert.deepStrictEqual(engine.levelInfo(0), { level: 1, into: 0, need: 100 });
  assert.deepStrictEqual(engine.levelInfo(250), { level: 3, into: 0, need: 200 });
});

test('undoing a completion takes back a level-up heal and the day it started', () => {
  const s = fresh();
  s.player.xp = 95; // 5 XP short of level 2
  s.player.hp = 5;
  const daily = s.dailies[0].id;
  engine.toggleDaily(s, daily, ctx(MON), [], noDrop);
  assert.strictEqual(s.player.hp, engine.MAX_HP);
  assert.strictEqual(s.player.streak, 1);

  engine.toggleDaily(s, daily, ctx(MON), [], noDrop);
  assert.strictEqual(s.player.hp, 5);
  assert.strictEqual(s.player.xp, 95);
  assert.strictEqual(s.player.streak, 0);
  assert.strictEqual(s.player.lastActiveDay, null);
  assert.strictEqual(s.stats.activeDays, 0);
  assert.deepStrictEqual(s.history, {});

  // With another task still done today, the day stays active.
  engine.toggleDaily(s, s.dailies[1].id, ctx(MON), [], noDrop);
  engine.toggleDaily(s, daily, ctx(MON), [], noDrop);
  engine.toggleDaily(s, daily, ctx(MON), [], noDrop);
  assert.strictEqual(s.player.streak, 1);
});
