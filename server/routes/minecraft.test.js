const assert = require('node:assert');
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.MINECRAFT_CONTAINER_NAME = 'gtnh-minecraft';
const backupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-backups-'));
process.env.MINECRAFT_BACKUPS_DIR = backupsDir;

let states;
let statuses;
let started;
let lookupsFail;
let stopGate; // resolve() to let a pending docker stop finish

const fakeDocker = {
  listContainers: async ({ filters }) => {
    if (lookupsFail) throw new Error('proxy down');
    // Like Docker: the filter is an unanchored regex matched against "/<name>".
    const pattern = new RegExp(JSON.parse(filters).name[0]);
    return Object.keys(states).filter((name) => pattern.test(`/${name}`))
      .map((name) => ({ Id: name, State: states[name], Status: statuses[name] }));
  },
  getContainer: (id) => ({
    start: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      started.push(id);
    },
    stop: () => new Promise((resolve) => { stopGate = () => { states[id] = 'exited'; resolve(); }; }),
  }),
};
require.cache[require.resolve('../docker')] = { exports: fakeDocker };

let server;
let base;

before(async () => {
  const app = express();
  app.use('/api/minecraft', require('./minecraft'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/minecraft`;
});

after(() => server.close());

beforeEach(() => {
  states = { 'gtnh-minecraft': 'exited', 'family-minecraft': 'exited' };
  statuses = {};
  started = [];
  lookupsFail = false;
});

const start = (id) => fetch(`${base}/${id}/start`, { method: 'POST' });

test('starts when the other server is stopped', async () => {
  assert.strictEqual((await start('family')).status, 200);
  assert.deepStrictEqual(started, ['family-minecraft']);
});

test('refuses to start while the other server is running', async () => {
  states['gtnh-minecraft'] = 'running';
  const res = await start('family');
  assert.strictEqual(res.status, 409);
  assert.match((await res.json()).error, /GTNH/);
  assert.deepStrictEqual(started, []);
});

test('blocks in both directions', async () => {
  states['family-minecraft'] = 'running';
  assert.strictEqual((await start('gtnh')).status, 409);
  assert.deepStrictEqual(started, []);
});

test('a server that is still shutting down or restarting blocks', async () => {
  states['gtnh-minecraft'] = 'restarting';
  assert.strictEqual((await start('family')).status, 409);
});

test('a never-created other container does not block', async () => {
  delete states['gtnh-minecraft'];
  assert.strictEqual((await start('family')).status, 200);
});

test('two simultaneous starts cannot both run', async () => {
  const results = await Promise.all([start('gtnh'), start('family')]);
  assert.deepStrictEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.strictEqual(started.length, 1);
});

test('status reports what is blocking', async () => {
  states['gtnh-minecraft'] = 'running';
  const blocked = await (await fetch(`${base}/family/status`)).json();
  const free = await (await fetch(`${base}/gtnh/status`)).json();
  assert.strictEqual(blocked.blockedBy, 'GTNH');
  assert.strictEqual(free.blockedBy, null);
});

test('unknown server ids and prototype keys are rejected', async () => {
  assert.strictEqual((await start('nope')).status, 404);
  assert.strictEqual((await start('constructor')).status, 404);
});

test('a healthy container counts as online when the ping gets nothing', async () => {
  states['family-minecraft'] = 'running';
  statuses['family-minecraft'] = 'Up 5 minutes (healthy)';
  const body = await (await fetch(`${base}/family/status`)).json();
  assert.strictEqual(body.server.online, true);
  assert.strictEqual(body.server.players, null);
});

test('an unhealthy or still-starting container is not online', async () => {
  states['family-minecraft'] = 'running';
  for (const status of ['Up 5 minutes (unhealthy)', 'Up 10 seconds (health: starting)']) {
    statuses['family-minecraft'] = status;
    const body = await (await fetch(`${base}/family/status`)).json();
    assert.strictEqual(body.server.online, false, status);
  }
});

test('a container whose name only starts with the server name is ignored', async () => {
  states = { 'family-minecraft-backup': 'running', 'family-minecraft': 'exited', 'gtnh-minecraft': 'exited' };
  const body = await (await fetch(`${base}/family/status`)).json();
  assert.strictEqual(body.container.state, 'exited');
  assert.strictEqual((await start('family')).status, 200);
  assert.deepStrictEqual(started, ['family-minecraft']);
});

test('status reports the newest backup, or null when there is none', async () => {
  const dir = path.join(backupsDir, 'family-minecraft');
  fs.mkdirSync(dir, { recursive: true });
  const older = new Date('2026-11-01T00:00:00Z');
  const newer = new Date('2026-11-17T12:00:00Z');
  fs.writeFileSync(path.join(dir, 'a.tgz'), '');
  fs.writeFileSync(path.join(dir, 'b.tgz'), '');
  fs.utimesSync(path.join(dir, 'a.tgz'), newer, newer);
  fs.utimesSync(path.join(dir, 'b.tgz'), older, older);
  const family = await (await fetch(`${base}/family/status`)).json();
  assert.strictEqual(family.lastBackupAt, newer.toISOString());
  const gtnh = await (await fetch(`${base}/gtnh/status`)).json();
  assert.strictEqual(gtnh.lastBackupAt, null);
});

test('stop answers right away and status says stopping until Docker is done', async () => {
  states['gtnh-minecraft'] = 'running';
  const res = await fetch(`${base}/gtnh/stop`, { method: 'POST' });
  assert.strictEqual(res.status, 202);
  const status = () => fetch(`${base}/gtnh/status`).then((r) => r.json());
  assert.strictEqual((await status()).stopping, true);
  // A second click while stopping doesn't send another stop.
  assert.strictEqual((await fetch(`${base}/gtnh/stop`, { method: 'POST' })).status, 202);
  stopGate();
  await new Promise((r) => setTimeout(r, 10));
  const after = await status();
  assert.strictEqual(after.stopping, false);
  assert.strictEqual(after.container.state, 'exited');
});
