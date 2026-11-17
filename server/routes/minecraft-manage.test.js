// Server management: files, restore, players, console. Uses a fake Docker and
// temp folders, like minecraft.test.js.
const assert = require('node:assert');
const { test, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PassThrough } = require('node:stream');
const express = require('express');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-manage-'));
const dataDir = path.join(tmp, 'family');
const backupsDir = path.join(tmp, 'backups');
process.env.FAMILY_MINECRAFT_DATA_DIR = dataDir;
process.env.MINECRAFT_BACKUPS_DIR = backupsDir;
delete process.env.RCON_PASSWORD;

let state;
let logStream;
const fakeDocker = {
  listContainers: async () => [{ Id: 'family-minecraft', State: state, Status: '' }],
  getContainer: () => ({
    inspect: async () => ({ Config: { Tty: true } }),
    logs: async () => logStream,
  }),
};
require.cache[require.resolve('../docker')] = { exports: fakeDocker };

let server;
let base;
before(async () => {
  const app = express();
  app.use('/api/minecraft', require('./minecraft'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/minecraft/family`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dataDir, rel), text);
};
const read = (rel) => fs.readFileSync(path.join(dataDir, rel), 'utf8');

beforeEach(() => {
  state = 'exited';
  fs.rmSync(dataDir, { recursive: true, force: true });
  write('server.properties', 'motd=hi\nlevel-name=world\n');
  write('world/level.dat', 'old');
  write('world_nether/DIM-1/r.mca', 'old nether');
  write('mods/a.jar', 'jar');
  write('whitelist.json', JSON.stringify([{ uuid: '1', name: 'Steve' }]));
});

const files = (q = '', opts) => fetch(`${base}/files${q}`, opts);
const q = (params) => `?${new URLSearchParams(params)}`;

test('lists a folder, folders first', async () => {
  const body = await (await files()).json();
  assert.deepStrictEqual(body.entries.map((e) => e.name),
    ['mods', 'world', 'world_nether', 'server.properties', 'whitelist.json']);
  assert.strictEqual(body.entries[0].dir, true);
});

test('paths outside the server folder are refused', async () => {
  for (const p of ['..', '../..', 'world/../../x']) {
    assert.strictEqual((await files(q({ path: p }))).status, 400, p);
  }
  // A leading slash is still inside the folder, so it's just not found.
  assert.strictEqual((await files(q({ path: '/etc' }))).status, 404);
});

test('changes are refused while the server runs, reads still work', async () => {
  state = 'running';
  const res = await files(`/write${q({ path: 'server.properties' })}`, { method: 'PUT', body: 'x' });
  assert.strictEqual(res.status, 409);
  assert.match((await res.json()).error, /Stop the server/);
  assert.strictEqual((await files(q({ path: 'world' }), { method: 'DELETE' })).status, 409);
  assert.strictEqual(await (await files(`/read${q({ path: 'server.properties' })}`)).text(), 'motd=hi\nlevel-name=world\n');
  assert.strictEqual(read('server.properties'), 'motd=hi\nlevel-name=world\n');
});

test('edit, upload, make a folder, rename and delete while stopped', async () => {
  assert.strictEqual((await files(`/write${q({ path: 'server.properties' })}`, { method: 'PUT', body: 'motd=new\n' })).status, 200);
  assert.strictEqual(read('server.properties'), 'motd=new\n');

  assert.strictEqual((await files(`/mkdir${q({ path: '', name: 'plugins' })}`, { method: 'POST' })).status, 200);
  const up = await files(`/upload${q({ path: 'plugins', name: 'p.jar' })}`, { method: 'POST', body: Buffer.from([0, 1, 2]) });
  assert.strictEqual(up.status, 200);
  assert.deepStrictEqual([...fs.readFileSync(path.join(dataDir, 'plugins/p.jar'))], [0, 1, 2]);

  assert.strictEqual((await files(`/rename${q({ path: 'plugins/p.jar', name: 'q.jar' })}`, { method: 'POST' })).status, 200);
  assert.ok(fs.existsSync(path.join(dataDir, 'plugins/q.jar')));
  assert.strictEqual((await files(`/rename${q({ path: 'plugins/q.jar', name: '../escape.jar' })}`, { method: 'POST' })).status, 400);

  assert.strictEqual((await files(q({ path: 'plugins' }), { method: 'DELETE' })).status, 200);
  assert.ok(!fs.existsSync(path.join(dataDir, 'plugins')));
  assert.strictEqual((await files(q({ path: '' }), { method: 'DELETE' })).status, 400);
});

test('binary files are not opened in the editor', async () => {
  write('mods/b.bin', '\0\0');
  assert.strictEqual((await files(`/read${q({ path: 'mods/b.bin' })}`)).status, 415);
});

test('restore swaps in only the worlds and keeps the old ones', async () => {
  // A backup like mc-backup makes: the whole folder, minus jars.
  const src = path.join(tmp, 'backup-src');
  fs.rmSync(src, { recursive: true, force: true });
  fs.mkdirSync(path.join(src, 'world'), { recursive: true });
  fs.mkdirSync(path.join(src, 'mods'));
  fs.writeFileSync(path.join(src, 'world/level.dat'), 'new');
  fs.mkdirSync(path.join(backupsDir, 'family-minecraft'), { recursive: true });
  // Relative paths: GNU tar on Windows reads "C:" as a remote host.
  execFileSync('tar', ['-czf', '../backups/family-minecraft/world-1.tgz', '.'], { cwd: src });

  state = 'running';
  assert.strictEqual((await fetch(`${base}/backups/world-1.tgz/restore`, { method: 'POST' })).status, 409);
  state = 'exited';
  assert.strictEqual((await fetch(`${base}/backups/nope.tgz/restore`, { method: 'POST' })).status, 404);
  assert.strictEqual((await fetch(`${base}/backups/world-1.tgz/restore`, { method: 'POST' })).status, 202);
  // Starting is refused until the restore is done.
  assert.strictEqual((await fetch(`${base}/start`, { method: 'POST' })).status, 409);

  let status;
  do {
    await new Promise((r) => setTimeout(r, 20));
    status = await (await fetch(`${base}/status`)).json();
  } while (status.restoring);
  assert.strictEqual(status.lastRestore.ok, true, status.lastRestore.error);
  assert.strictEqual(read('world/level.dat'), 'new');
  assert.strictEqual(read('mods/a.jar'), 'jar'); // untouched, though the backup has an empty mods/
  assert.ok(!fs.existsSync(path.join(dataDir, 'world_nether'))); // not in the backup, so moved aside
  const aside = status.lastRestore.aside;
  assert.match(aside, /^world\.before-restore-/);
  assert.strictEqual(read(`${aside}/world/level.dat`), 'old');
  assert.strictEqual(read(`${aside}/world_nether/DIM-1/r.mca`), 'old nether');
  assert.ok(!fs.readdirSync(dataDir).some((n) => n.startsWith('.restore-')));
});

test('players come from the server files while stopped', async () => {
  const body = await (await fetch(`${base}/players`)).json();
  assert.deepStrictEqual(body, { online: null, whitelist: ['Steve'], ops: [], banned: [] });
});

test('commands need RCON_PASSWORD', async () => {
  const res = await fetch(`${base}/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: '/list' }),
  });
  assert.strictEqual(res.status, 503);
  assert.match((await res.json()).error, /RCON_PASSWORD/);
});

test('the console streams log lines without colors, then ends', async () => {
  logStream = new PassThrough();
  const res = await fetch(`${base}/console`);
  assert.strictEqual(res.headers.get('content-type'), 'text/event-stream');
  logStream.write('\x1b[32mDone (5s)!\x1b[0m\r\nhal');
  logStream.end('f line\n');
  const text = await res.text();
  assert.match(text, /data: Done \(5s\)!\n\n/);
  assert.match(text, /data: half line\n\n/);
  assert.match(text, /event: end/);
});
