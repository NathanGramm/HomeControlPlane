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

const CONTAINER_NAME = process.env.MINECRAFT_CONTAINER_NAME || 'minecraft-server';
const MC_HOST = process.env.MINECRAFT_HOST || 'localhost';
const MC_PORT = Number(process.env.MINECRAFT_PORT) || 25565;

async function findContainer() {
  if (!docker) return null;
  try {
    const list = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ name: [CONTAINER_NAME] }),
    });
    return list[0] || null;
  } catch (err) {
    // docker-socket-proxy unreachable (e.g. local dev outside the compose
    // stack) — degrade to "not found" rather than failing the endpoint.
    console.warn('Docker proxy unavailable, cannot look up Minecraft container:', err.message);
    return null;
  }
}

async function pingServer() {
  if (!mcUtil) return { online: false };
  try {
    const result = await mcUtil.status(MC_HOST, MC_PORT, { timeout: 2000 });
    return {
      online: true,
      players: result.players.online,
      maxPlayers: result.players.max,
      motd: result.motd.clean,
      version: result.version.name,
    };
  } catch (err) {
    // Container up but not accepting connections yet (still loading the
    // world) is the common case here, not a real error — swallow it.
    return { online: false };
  }
}

// GET /api/minecraft/status -> { container: {found, state}, server: {...}, updatedAt }
router.get('/status', async (req, res) => {
  try {
    const containerInfo = await findContainer();
    const state = containerInfo ? containerInfo.State : 'not_found';
    const server = state === 'running' ? await pingServer() : { online: false };

    res.json({
      container: { found: !!containerInfo, state },
      server,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/minecraft/status failed:', err.message);
    res.status(500).json({ error: 'Could not read Minecraft status' });
  }
});

// POST /api/minecraft/start -> starts the configured container
router.post('/start', async (req, res) => {
  try {
    const containerInfo = await findContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: `No container named '${CONTAINER_NAME}' found` });
    }
    if (containerInfo.State === 'running') {
      return res.json({ ok: true, alreadyRunning: true });
    }
    await docker.getContainer(containerInfo.Id).start();
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/minecraft/start failed:', err.message);
    res.status(500).json({ error: 'Could not start the Minecraft container' });
  }
});

// POST /api/minecraft/stop -> stops the configured container
router.post('/stop', async (req, res) => {
  try {
    const containerInfo = await findContainer();
    if (!containerInfo) {
      return res.status(404).json({ error: `No container named '${CONTAINER_NAME}' found` });
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
