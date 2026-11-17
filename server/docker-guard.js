// Inside Docker, only the reverse proxy may talk to the dashboard. The
// Minecraft servers are port-forwarded to the internet and share
// proxy-network with this app, so a hijacked server could otherwise call the
// API (console, files, restore) directly. Blocks every other container's
// address, plus each Docker network's gateway: a container that goes out to
// the host's published port (192.168.4.20:3001) arrives from the gateway.
// LAN and Tailscale clients keep their own addresses, so they pass.
// That's also why NPM must forward to home-control-plane:3000, not to :3001.

const ALLOWED = (process.env.DASHBOARD_ALLOWED_CONTAINERS || 'nginx-proxy-manager')
  .split(',').map((n) => n.trim()).filter(Boolean);

const plain = (ip) => (ip || '').replace(/^::ffff:/, '');

function blockedAddresses(containers) {
  const out = new Set();
  for (const c of containers) {
    const allowed = (c.Names || []).some((n) => ALLOWED.includes(n.replace(/^\//, '')));
    for (const net of Object.values(c.NetworkSettings?.Networks || {})) {
      for (const gw of [net.Gateway, net.IPv6Gateway]) if (gw) out.add(gw);
      if (!allowed) for (const ip of [net.IPAddress, net.GlobalIPv6Address]) if (ip) out.add(ip);
    }
  }
  return out;
}

module.exports = function dockerGuard(docker, { refreshMs = 10000 } = {}) {
  let blocked = new Set();
  let checkedAt = -Infinity;
  let refreshing = null;
  let warned = false;

  function refresh() {
    checkedAt = Date.now();
    refreshing = docker.listContainers()
      .then((list) => { blocked = blockedAddresses(list); warned = false; })
      // Keeps the last known list. With none yet (Docker never reached, as in
      // local dev) nothing is blocked; the app can't tell containers apart then.
      .catch((err) => {
        if (!warned) console.warn('Docker guard could not list containers:', err.message);
        warned = true;
      })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  return async function blockOtherContainers(req, res, next) {
    if (Date.now() - checkedAt >= refreshMs) refresh();
    if (refreshing) await refreshing;
    if (blocked.has(plain(req.socket.remoteAddress))) {
      return res.status(403).json({ error: 'Other containers may not use the dashboard' });
    }
    next();
  };
};
