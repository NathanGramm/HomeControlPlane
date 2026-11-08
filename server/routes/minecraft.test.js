const assert = require('node:assert');
const { test, before, after, beforeEach } = require('node:test');
const express = require('express');

process.env.MINECRAFT_CONTAINER_NAME = 'gtnh-minecraft';

let states;
let statuses;
let started;
let lookupsFail;

const fakeDocker = {
  listContainers: async ({ filters }) => {
    if (lookupsFail) throw new Error('proxy down');
    const name = JSON.parse(filters).name[0];
    return name in states ? [{ Id: name, State: states[name], Status: statuses[name] }] : [];
  },
  getContainer: (id) => ({
    start: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      started.push(id);
    },
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
