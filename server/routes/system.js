const express = require('express');
const si = require('systeminformation');
const docker = require('../docker');

const router = express.Router();

// docker is the shared client from ../docker.js (talks to the
// docker-socket-proxy). If it's unavailable, container stats are simply
// omitted rather than crashing the endpoint.

// GET /api/system/cpu -> { overallPct, cores: [pct, ...], updatedAt }
router.get('/cpu', async (req, res) => {
  try {
    const load = await si.currentLoad();
    res.json({
      overallPct: round1(load.currentLoad),
      cores: load.cpus.map((c) => round1(c.load)),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/system/cpu failed:', err.message);
    res.status(500).json({ error: 'Could not read CPU load' });
  }
});

// GET /api/system/ram -> { totalBytes, usedBytes, usedPct, containers: [...], updatedAt }
router.get('/ram', async (req, res) => {
  try {
    const mem = await si.mem();
    // si.mem().active is "actually in use" — closer to reality than total-free,
    // which counts reclaimable cache/buffers as "used".
    const usedBytes = mem.active;
    const usedPct = round1((usedBytes / mem.total) * 100);

    const containers = await getContainerMemory();

    res.json({
      totalBytes: mem.total,
      usedBytes,
      usedPct,
      containers, // sorted descending by memory use, already
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/system/ram failed:', err.message);
    res.status(500).json({ error: 'Could not read RAM usage' });
  }
});

async function getContainerMemory() {
  if (!docker) return [];

  let list;
  try {
    list = await docker.listContainers();
  } catch (err) {
    // Docker socket not reachable — degrade gracefully instead of failing the whole tile.
    console.warn('Docker socket unavailable, skipping per-container memory:', err.message);
    return [];
  }

  const stats = await Promise.all(
    list.map(async (c) => {
      try {
        const container = docker.getContainer(c.Id);
        const s = await container.stats({ stream: false });
        const memUsageBytes = s.memory_stats.usage ?? 0;
        // Docker includes page cache in `usage`; subtracting the cache figure
        // (when present) gives a number closer to what the process itself holds.
        const cache = s.memory_stats.stats?.cache ?? s.memory_stats.stats?.inactive_file ?? 0;
        const netUsage = Math.max(memUsageBytes - cache, 0);
        return {
          name: (c.Names[0] || c.Id).replace(/^\//, ''),
          memUsageBytes: netUsage,
        };
      } catch (err) {
        console.warn(`Stats failed for container ${c.Id}:`, err.message);
        return null;
      }
    })
  );

  return stats
    .filter(Boolean)
    .sort((a, b) => b.memUsageBytes - a.memUsageBytes);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = router;
