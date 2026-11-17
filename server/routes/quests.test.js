const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const express = require('express');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quests-'));
process.env.QUESTS_FILE = path.join(dir, 'quests.json');

let server;
let base;

before(async () => {
  const app = express();
  app.use('/api/quests', require('./quests'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/quests`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = async (method, url, body) => {
  const res = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('first load seeds the board and saves it to disk', async () => {
  const { status, body } = await call('GET', '/');
  assert.strictEqual(status, 200);
  assert.ok(body.state.dailies.length > 0);
  assert.ok(fs.existsSync(process.env.QUESTS_FILE));
});

test('a plain read does not rewrite the save file', async () => {
  await call('GET', '/');
  const before = fs.statSync(process.env.QUESTS_FILE).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await call('GET', '/');
  assert.strictEqual(fs.statSync(process.env.QUESTS_FILE).mtimeMs, before);
});

test('create, edit, complete and delete a to-do', async () => {
  let r = await call('POST', '/todos', { title: 'Test task', difficulty: 'hard', questId: 'ram', checklist: ['a', 'b'] });
  assert.strictEqual(r.status, 200);
  const t = r.body.state.todos.find((x) => x.title === 'Test task');
  assert.strictEqual(t.checklist.length, 2);

  await call('POST', `/todos/${t.id}/checklist/0`);
  r = await call('PUT', `/todos/${t.id}`, { title: 'Renamed', difficulty: 'hard', questId: 'ram', checklist: ['a', 'c'] });
  const edited = r.body.state.todos.find((x) => x.id === t.id);
  assert.deepStrictEqual(edited.checklist, [{ text: 'a', done: true }, { text: 'c', done: false }]);

  r = await call('POST', `/todos/${t.id}/toggle`);
  assert.ok(r.body.events.some((e) => e.type === 'reward'));
  r = await call('DELETE', `/todos/${t.id}`);
  assert.ok(!r.body.state.todos.some((x) => x.id === t.id));
});

test('bad input is rejected with a readable message', async () => {
  for (const [url, body, msg] of [
    ['/todos', { title: '' }, /Title is required/],
    ['/todos', { title: 'x', difficulty: 'legendary' }, /Unknown difficulty/],
    ['/todos', { title: 'x', questId: 'nope' }, /Unknown quest line/],
    ['/dailies', { title: 'x', days: [] }, /Pick at least one day/],
    ['/dailies', { title: 'x', days: [7] }, /Pick at least one day/],
    ['/rewards', { title: 'x', cost: -5 }, /Cost must be/],
    ['/habits', { title: 'x', up: false, down: false }, /needs a \+ or -/],
    ['/achievements', { title: 'x' }, /Unknown list/],
  ]) {
    const r = await call('POST', url, body);
    assert.ok(r.status >= 400 && r.status < 500, url);
    assert.match(r.body.error, msg);
  }
  const r = await call('POST', '/rewards/takeout/buy');
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /Not enough gold/);
});

test('routines are validated, and a workout logs through the API', async () => {
  const routine = { rest: 60, exercises: [{ name: 'Pull-ups', sets: 2, unit: 'reps', min: 3, max: 6, steps: ['Negative', 'Full'], step: 0 }] };
  let r = await call('POST', '/dailies', { title: 'Pull day', routine });
  assert.strictEqual(r.status, 200);
  const d = r.body.state.dailies.find((x) => x.title === 'Pull day');
  const exId = d.routine.exercises[0].id;

  r = await call('PUT', `/dailies/${d.id}`, { title: 'Pull day', routine: { exercises: [{ ...routine.exercises[0], min: 9 }] } });
  assert.strictEqual(r.status, 400); // max below min
  r = await call('POST', `/dailies/${d.id}/workout`, { exercises: [{ exId: 'nope', sets: [1] }] });
  assert.strictEqual(r.status, 400);
  r = await call('POST', `/dailies/${d.id}/workout`, { exercises: [{ exId, sets: ['', null] }] });
  assert.strictEqual(r.status, 400); // nothing entered

  r = await call('POST', `/dailies/${d.id}/workout`, { exercises: [{ exId, step: 1, sets: [4, ''] }] });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.state.dailies.find((x) => x.id === d.id).done);
  assert.deepStrictEqual(r.body.state.workouts.at(-1).exercises[0].sets, [4]);
  assert.strictEqual(r.body.state.workouts.at(-1).exercises[0].step, 'Full');
});
