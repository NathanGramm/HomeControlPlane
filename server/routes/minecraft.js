const express = require('express');
const docker = require('../docker');

const router = express.Router();

// minecraft-server-util speaks the server-list-ping protocol — this is what
// tells us the world is actually joinable, which is a different thing from
// "the container is running" (it can take a while after container start
// before the world finishes loading and starts accepting connections).
let mcUtil = null;
try {
  mcUtil = require('minecraft-server-util');
} catch (err) {
  console.warn('minecraft-server-util not available, live join status disabled:', err.message);
}

const SERVERS = {
  gtnh: {
    label: 'GTNH',
    containerName: process.env.MINECRAFT_CONTAINER_NAME || 'minecraft-server',
    host: process.env.MINECRAFT_HOST || 'localhost',
    port: Number(process.env.MINECRAFT_PORT) || 25565,
  },
  family: {
    label: 'Family',
    containerName: process.env.FAMILY_MINECRAFT_CONTAINER_NAME || 'family-minecraft',
    host: process.env.FAMILY_MINECRAFT_HOST || 'localhost',
    port: Number(process.env.FAMILY_MINECRAFT_PORT) || 25566,
  },
};

const STOPPED_STATES = ['created', 'exited', 'dead'];

// Only one start can be between its check and its docker start at a time, so
// two clicks can't both pass the "is the other server up?" check below.
let startInProgress = false;

router.param('server', (req, res, next, id) => {
  if (!Object.hasOwn(SERVERS, id)) {
    return res.status(404).json({ error: `Unknown server '${id}'` });
  }
  req.mcServer = SERVERS[id];
  next();
});

async function lookupContainer(server) {
  if (!docker) return null;
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
  if (!mcUtil) return { online: false };
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

// GET /api/minecraft/:server/status -> { container: {found, state}, server: {...}, blockedBy, updatedAt }
//
// container.found tells the frontend whether start/stop can do anything.
// server.online answers "can someone join right now" by pinging the server
// (skipped while the container is stopped). blockedBy names the other server
// when it's the reason this one can't start.
router.get('/:server/status', async (req, res) => {
  try {
    const [containerInfo, blocker] = await Promise.all([
      findContainer(req.mcServer),
      findRunningOtherServer(req.mcServer).catch(() => null),
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

// POST /api/minecraft/:server/stop -> stops the configured container
router.post('/:server/stop', async (req, res) => {
  try {
    const containerInfo = await findContainer(req.mcServer);
    if (!containerInfo) {
      return res.status(404).json({ error: `No container named '${req.mcServer.containerName}' found` });
    }
    if (containerInfo.State !== 'running') {
      return res.json({ ok: true, alreadyStopped: true });
    }
    await docker.getContainer(containerInfo.Id).stop();
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/minecraft/stop failed:', err.message);
    res.status(500).json({ error: 'Could not stop the Minecraft container' });
  }
});

module.exports = router;
