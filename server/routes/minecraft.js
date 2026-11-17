const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { spawn } = require('node:child_process');
const express = require('express');
// minecraft-server-util speaks the server-list-ping protocol — this is what
// tells us the world is actually joinable, which is a different thing from
// "the container is running" (it can take a while after container start
// before the world finishes loading and starts accepting connections).
const mcUtil = require('minecraft-server-util');
const docker = require('../docker');

const router = express.Router();

const SERVERS = {
  gtnh: {
    label: 'GTNH',
    containerName: process.env.MINECRAFT_CONTAINER_NAME || 'minecraft-server',
    host: process.env.MINECRAFT_HOST || 'localhost',
    port: Number(process.env.MINECRAFT_PORT) || 25565,
    dataDir: process.env.MINECRAFT_DATA_DIR || '/servers/gtnh',
  },
  family: {
    label: 'Family',
    containerName: process.env.FAMILY_MINECRAFT_CONTAINER_NAME || 'family-minecraft',
    host: process.env.FAMILY_MINECRAFT_HOST || 'localhost',
    port: Number(process.env.FAMILY_MINECRAFT_PORT) || 25566,
    dataDir: process.env.FAMILY_MINECRAFT_DATA_DIR || '/servers/family',
  },
};

const STOPPED_STATES = ['created', 'exited', 'dead'];

// The mc-backup containers write to <dir>/<container name>; the dashboard
// mounts that folder read-only.
const BACKUPS_DIR = process.env.MINECRAFT_BACKUPS_DIR || '/backups';

const backupDir = (server) => path.join(BACKUPS_DIR, server.containerName);

// [{ name, size, mtime }], newest first; empty when there's no folder yet.
async function listBackups(server) {
  let names;
  try {
    names = await fs.readdir(backupDir(server));
  } catch {
    return [];
  }
  const rows = await Promise.all(names.map(async (name) => {
    const st = await fs.stat(path.join(backupDir(server), name)).catch(() => null);
    return st?.isFile() ? { name, size: st.size, mtime: st.mtime.toISOString() } : null;
  }));
  return rows.filter(Boolean).sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// Newest backup's time as ISO, or null when there's none yet.
async function lastBackup(server) {
  return (await listBackups(server))[0]?.mtime ?? null;
}

// Only one start can be between its check and its docker start at a time, so
// two clicks can't both pass the "is the other server up?" check below.
let startInProgress = false;

// Servers whose docker stop is still running.
const stopping = new Set();

// Servers with a restore in progress, and each server's last restore result.
const restoring = new Set();
const lastRestore = new Map();

router.param('server', (req, res, next, id) => {
  if (!Object.hasOwn(SERVERS, id)) {
    return res.status(404).json({ error: `Unknown server '${id}'` });
  }
  req.mcServer = SERVERS[id];
  next();
});

async function lookupContainer(server) {
  const list = await docker.listContainers({
    all: true,
    // Docker's name filter is an unanchored regex on "/<name>", so without
    // the anchors family-minecraft also matches family-minecraft-backup.
    filters: JSON.stringify({ name: [`^/${server.containerName}$`] }),
  });
  return list[0] || null;
}

async function findContainer(server) {
  try {
    return await lookupContainer(server);
  } catch (err) {
    // docker-socket-proxy unreachable (e.g. local dev outside the compose
    // stack) — degrade to "not found" rather than failing the endpoint.
    console.warn('Docker proxy unavailable, cannot look up Minecraft container:', err.message);
    return null;
  }
}

// shortcut: both servers can't fit in the host's 11 GB of RAM together, so
// only one may run at a time; delete this and its two callers after the
// upgrade. Docker lookups throw here rather than degrading like findContainer,
// so an unknown state refuses the start.
async function findRunningOtherServer(server) {
  const others = Object.values(SERVERS).filter((s) => s !== server);
  const containers = await Promise.all(others.map(lookupContainer));
  const index = containers.findIndex((c) => c && !STOPPED_STATES.includes(c.State));
  return index === -1 ? null : others[index];
}

async function pingServer(server) {
  try {
    // enableSRV off: host is a container name, so the SRV lookup can only miss,
    // and each miss went out to Pi-hole (~7k queries/day per server).
    const result = await mcUtil.status(server.host, server.port, { timeout: 2000, enableSRV: false });
    return {
      online: true,
      players: result.players.online,
      maxPlayers: result.players.max,
      playerNames: (result.players.sample || []).map((p) => p.name),
      motd: result.motd.clean,
      version: result.version.name,
    };
  } catch (err) {
    // Container up but not accepting connections yet (still loading the
    // world) is the common case here, not a real error — swallow it.
    return { online: false };
  }
}

// The image's healthcheck pings the server from inside its own container, so
// "(healthy)" in Docker's status means the world is joinable. It's the
// fallback when our own ping gets nothing, as when the family server's
// ping-hiding plugin doesn't answer this container's IP. No player count
// comes with it.
function isHealthy(containerInfo) {
  return typeof containerInfo?.Status === 'string' && containerInfo.Status.includes('(healthy)');
}

// GET /api/minecraft/:server/status -> { container: {found, state}, server: {...}, blockedBy, stopping, lastBackupAt, updatedAt }
//
// container.found tells the frontend whether start/stop can do anything.
// server.online answers "can someone join right now" by pinging the server
// (skipped while the container is stopped). blockedBy names the other server
// when it's the reason this one can't start.
router.get('/:server/status', async (req, res) => {
  try {
    const [containerInfo, blocker, lastBackupAt] = await Promise.all([
      findContainer(req.mcServer),
      findRunningOtherServer(req.mcServer).catch(() => null),
      lastBackup(req.mcServer),
    ]);
    // A stopped container's name doesn't resolve inside Docker, so pinging it
    // only sends a doomed lookup to Pi-hole every poll. Skip it.
    const stopped = containerInfo && containerInfo.State !== 'running';
    const pinged = stopped ? { online: false } : await pingServer(req.mcServer);
    const state = containerInfo ? containerInfo.State : 'not_found';
    const server = !pinged.online && isHealthy(containerInfo)
      ? { online: true, players: null, maxPlayers: null }
      : pinged;

    res.json({
      container: { found: !!containerInfo, state },
      server,
      blockedBy: blocker ? blocker.label : null,
      stopping: stopping.has(req.mcServer),
      restoring: restoring.has(req.mcServer),
      lastRestore: lastRestore.get(req.mcServer) || null,
      lastBackupAt,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/minecraft/status failed:', err.message);
    res.status(500).json({ error: 'Could not read Minecraft status' });
  }
});

// POST /api/minecraft/:server/start -> starts the configured container
router.post('/:server/start', async (req, res) => {
  if (startInProgress) {
    return res.status(409).json({ error: 'Another server is being started' });
  }
  if (restoring.has(req.mcServer)) {
    return res.status(409).json({ error: 'Wait for the restore to finish' });
  }
  startInProgress = true;
  try {
    const containerInfo = await findContainer(req.mcServer);
    if (!containerInfo) {
      return res.status(404).json({ error: `No container named '${req.mcServer.containerName}' found` });
    }
    if (containerInfo.State === 'running') {
      return res.json({ ok: true, alreadyRunning: true });
    }
    const blocker = await findRunningOtherServer(req.mcServer);
    if (blocker) {
      return res.status(409).json({ error: `Stop the ${blocker.label} server first` });
    }
    await docker.getContainer(containerInfo.Id).start();
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/minecraft/start failed:', err.message);
    res.status(500).json({ error: 'Could not start the Minecraft container' });
  } finally {
    startInProgress = false;
  }
});

// POST /api/minecraft/:server/stop -> starts stopping the configured container.
// Answers right away: GTNH can take 8 minutes to save, far past the reverse
// proxy's 60 s timeout. Status reports `stopping` until Docker is done.
router.post('/:server/stop', async (req, res) => {
  const server = req.mcServer;
  if (stopping.has(server)) return res.status(202).json({ ok: true, stopping: true });
  try {
    const containerInfo = await findContainer(server);
    if (!containerInfo) {
      return res.status(404).json({ error: `No container named '${server.containerName}' found` });
    }
    if (containerInfo.State !== 'running') {
      return res.json({ ok: true, alreadyStopped: true });
    }
    stopping.add(server);
    docker.getContainer(containerInfo.Id).stop()
      .catch((err) => console.error(`Stopping ${server.containerName} failed:`, err.message))
      .finally(() => stopping.delete(server));
    res.status(202).json({ ok: true, stopping: true });
  } catch (err) {
    console.error('POST /api/minecraft/stop failed:', err.message);
    res.status(500).json({ error: 'Could not stop the Minecraft container' });
  }
});

// --- server management: console, players, backups, files ---

const RCON_PORT = Number(process.env.RCON_PORT) || 25575;
const mcFiles = require('./minecraft-files');

// Reason the server's files can't be changed right now, or null if they can.
async function whyNotStopped(server) {
  if (restoring.has(server)) return 'A restore is in progress';
  if (stopping.has(server)) return 'The server is still stopping';
  if (startInProgress) return 'A server is starting';
  try {
    const c = await lookupContainer(server);
    return c && !STOPPED_STATES.includes(c.State) ? 'Stop the server first' : null;
  } catch {
    return 'Can\'t tell whether the server is running (Docker is unreachable)';
  }
}

async function rcon(server, command) {
  const password = process.env.RCON_PASSWORD;
  if (!password) throw Object.assign(new Error('Add RCON_PASSWORD to the dashboard stack to use the console'), { status: 503 });
  const client = new mcUtil.RCON();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await client.connect(server.host, RCON_PORT);
        await client.login(password, { timeout: 5000 });
        return client.execute(command);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('RCON timed out')), 10000); }),
    ]);
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

const stripColors = (s) => s.replace(/§./g, '');

// Names from `list`. Paper: "There are 1 of a max of 20 players online: Steve";
// 1.7.10: "There are 1/20 players online:Steve".
function parsePlayerList(text) {
  const clean = stripColors(text);
  return clean.slice(clean.indexOf(':') + 1).split(/[,\s]+/).filter((n) => /^[A-Za-z0-9_]{1,16}$/.test(n));
}

// GET /:server/console -> server-sent events, one log line per message, then
// an `end` event when the container stops. Ends with the client too.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
// The server logs a pair of these for every RCON connection, so each console
// command or Players load added two lines. Still in the server's own log.
const RCON_NOISE = /Thread RCON Client .* (started|shutting down)$/;
router.get('/:server/console', async (req, res) => {
  let stream;
  let tty;
  try {
    const info = await lookupContainer(req.mcServer);
    if (!info) return res.status(404).json({ error: 'Container not found' });
    const container = docker.getContainer(info.Id);
    tty = (await container.inspect()).Config.Tty;
    stream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 300 });
  } catch (err) {
    console.error('GET /api/minecraft/console failed:', err.message);
    return res.status(503).json({ error: 'Could not read the server log' });
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  const decoder = new (require('node:string_decoder').StringDecoder)('utf8');
  let partial = '';
  const send = (chunk) => {
    const lines = (partial + decoder.write(chunk)).split('\n');
    partial = lines.pop();
    for (const raw of lines) {
      const line = raw.replace(ANSI, '').replace(/\r/g, '');
      if (!RCON_NOISE.test(line)) res.write(`data: ${line}\n\n`);
    }
  };
  if (tty) {
    stream.on('data', send);
  } else {
    // Without a TTY, Docker interleaves stdout and stderr in 8-byte-headed frames.
    const sink = new (require('node:stream').PassThrough)();
    sink.on('data', send);
    docker.modem.demuxStream(stream, sink, sink);
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 25000); // keeps NPM's 60 s timeout away
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    stream.destroy?.();
  };
  const finish = () => {
    if (closed) return;
    if (partial) send('\n');
    res.end('event: end\ndata: \n\n');
    close();
  };
  stream.on('end', finish);
  stream.on('error', finish);
  req.on('close', close);
});

// POST /:server/command { command } -> { output }
router.post('/:server/command', express.json(), async (req, res) => {
  const command = String(req.body?.command ?? '').trim().replace(/^\//, '');
  if (!command || command.length > 1000 || /[\r\n]/.test(command)) {
    return res.status(400).json({ error: 'Enter one command' });
  }
  try {
    res.json({ output: stripColors(await rcon(req.mcServer, command)) });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.status ? err.message : 'The server isn\'t taking commands. Is it running?' });
  }
});

// GET /:server/players -> { online: [names] | null, whitelist, ops, banned }
// The lists come from the server's JSON files, so they show while it's stopped.
router.get('/:server/players', async (req, res) => {
  const server = req.mcServer;
  const readNames = async (file) => {
    try {
      return JSON.parse(await fs.readFile(path.join(server.dataDir, file), 'utf8')).map((e) => e.name).filter(Boolean);
    } catch {
      return [];
    }
  };
  const [whitelist, ops, banned, container] = await Promise.all([
    readNames('whitelist.json'), readNames('ops.json'), readNames('banned-players.json'), findContainer(server),
  ]);
  let online = null;
  if (container?.State === 'running') {
    online = await rcon(server, 'list').then(parsePlayerList, () => null);
  }
  res.json({ online, whitelist, ops, banned });
});

// GET /:server/backups -> { backups: [{ name, size, mtime }] }
router.get('/:server/backups', async (req, res) => {
  res.json({ backups: await listBackups(req.mcServer) });
});

// Only names from the folder listing, so a request can't point anywhere else.
async function findBackup(server, name) {
  return (await listBackups(server)).find((b) => b.name === name) || null;
}

router.get('/:server/backups/:name/download', async (req, res) => {
  const backup = await findBackup(req.mcServer, req.params.name);
  if (!backup) return res.status(404).json({ error: 'No such backup' });
  res.download(path.join(backupDir(req.mcServer), backup.name));
});

// Piped in, with tar working inside dest, so no path is passed to tar at all.
function untar(file, dest) {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', [file.endsWith('.tar') ? '-xf' : '-xzf', '-'], { cwd: dest, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    tar.stderr.on('data', (d) => { stderr += d; });
    tar.on('error', reject);
    tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `tar exited with ${code}`))));
    createReadStream(file).on('error', reject).pipe(tar.stdin).on('error', () => {}); // tar's own exit reports it
  });
}

const exists = (p) => fs.access(p).then(() => true, () => false);

async function levelName(server) {
  const props = await fs.readFile(path.join(server.dataDir, 'server.properties'), 'utf8').catch(() => '');
  return props.match(/^level-name=(.+)$/m)?.[1].trim() || 'world';
}

// Swaps the world folders (world, world_nether, world_the_end) for the
// backup's. Only worlds: backups skip jars, so restoring mods/ would empty it.
// The current worlds move into <level>.before-restore-<time>, never deleted.
async function restoreBackup(server, file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const level = await levelName(server);
  const tmp = path.join(server.dataDir, `.restore-${stamp}`); // same disk, so the swap is a rename
  await fs.mkdir(tmp);
  try {
    await untar(file, tmp);
    const worlds = [level, `${level}_nether`, `${level}_the_end`];
    const fromBackup = [];
    for (const w of worlds) if (await exists(path.join(tmp, w))) fromBackup.push(w);
    if (!fromBackup.length) throw new Error(`The backup has no "${level}" folder`);
    for (const w of fromBackup) await mcFiles.matchOwner(server.dataDir, path.join(tmp, w), true);
    const aside = `${level}.before-restore-${stamp}`;
    await fs.mkdir(path.join(server.dataDir, aside));
    await mcFiles.matchOwner(server.dataDir, path.join(server.dataDir, aside));
    for (const w of worlds) {
      const current = path.join(server.dataDir, w);
      if (await exists(current)) await fs.rename(current, path.join(server.dataDir, aside, w));
    }
    for (const w of fromBackup) await fs.rename(path.join(tmp, w), path.join(server.dataDir, w));
    return { worlds: fromBackup, aside };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// POST /:server/backups/:name/restore -> 202 at once; status shows the result.
router.post('/:server/backups/:name/restore', async (req, res) => {
  const server = req.mcServer;
  const backup = await findBackup(server, req.params.name);
  if (!backup) return res.status(404).json({ error: 'No such backup' });
  if (!/\.(tgz|tar\.gz|tar)$/.test(backup.name)) return res.status(400).json({ error: 'Only tar backups can be restored here' });
  const why = await whyNotStopped(server);
  // Checked again after the await, in the same tick as the add, so two clicks can't both restore.
  if (why || restoring.has(server)) return res.status(409).json({ error: why || 'A restore is in progress' });
  restoring.add(server);
  res.status(202).json({ ok: true, restoring: true });
  const startedAt = new Date().toISOString();
  restoreBackup(server, path.join(backupDir(server), backup.name))
    .then((r) => lastRestore.set(server, { ok: true, backup: backup.name, startedAt, ...r }))
    .catch((err) => {
      console.error(`Restoring ${backup.name} failed:`, err.message);
      const error = /ENOSPC|No space/.test(err.message) ? 'The disk is full' : err.message.split('\n')[0];
      lastRestore.set(server, { ok: false, backup: backup.name, startedAt, error });
    })
    .finally(() => restoring.delete(server));
});

mcFiles(router, { canWrite: whyNotStopped });

module.exports = router;
