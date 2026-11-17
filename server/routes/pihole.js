const express = require('express');

const router = express.Router();

const PIHOLE_URL = process.env.PIHOLE_URL || 'http://pihole:80';
// A Pi-hole *app password* (Settings -> Web interface / API -> Configure app
// password), not the admin password, so it can be revoked on its own.
const PIHOLE_API_PASSWORD = process.env.PIHOLE_API_PASSWORD || '';

// Pi-hole v6 caps concurrent API sessions (16 by default), so log in once and
// reuse the session id until Pi-hole rejects it, rather than per request.
let sid = null;
let loggingIn = null;

async function login() {
  const res = await fetch(`${PIHOLE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ password: PIHOLE_API_PASSWORD }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.session?.valid) throw new Error(`login rejected (${res.status})`);
  sid = data.session.sid;
}

async function piholeFetch(path, retry = true) {
  if (!sid) {
    loggingIn ||= login().finally(() => { loggingIn = null; });
    await loggingIn;
  }
  const res = await fetch(`${PIHOLE_URL}${path}`, { headers: { 'X-FTL-SID': sid, Accept: 'application/json' } });
  if (res.status === 401 && retry) {
    sid = null; // session expired (e.g. Pi-hole restarted); log in again once
    return piholeFetch(path, false);
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const domains = (r) => (r?.domains || []).map((d) => ({ domain: d.domain, count: d.count }));

// Pi-hole lists "blocklist" and "cache" alongside real upstreams; label
// those plainly and real ones as name#port, like Pi-hole's own UI.
const upstreamLabel = (u) => (u.port > 0 ? `${u.name || u.ip}#${u.port}` : u.name || u.ip);

// Keeps the busiest clients and folds the rest into "other", so the client
// activity chart stays readable with 14+ devices.
function clientHistory(r, keep = 6) {
  if (!r?.clients || !Array.isArray(r.history)) return null;
  const top = Object.entries(r.clients)
    .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
    .slice(0, keep)
    .map(([ip, c]) => ({ ip, name: c.name || ip }));
  const ips = new Set(top.map((c) => c.ip));
  return {
    clients: [...top.map((c) => c.name), 'other'],
    buckets: r.history.map((h) => {
      const data = h.data || {};
      const other = Object.entries(data).reduce((sum, [ip, n]) => sum + (ips.has(ip) ? 0 : n), 0);
      return { t: h.timestamp, counts: [...top.map((c) => data[c.ip] || 0), other] };
    }),
  };
}

// GET /api/pihole/summary -> everything the overview card and the Pi-hole page
// show, from one batch of API calls. Optional parts come back null or empty
// if that endpoint fails, so one bad endpoint doesn't blank the page.
router.get('/summary', async (req, res) => {
  if (!PIHOLE_API_PASSWORD) return res.json({ configured: false });
  let summary;
  try {
    summary = await piholeFetch('/api/stats/summary');
  } catch (err) {
    console.warn('Pi-hole fetch failed:', err.message);
    return res.json({ configured: true, reachable: false });
  }
  const optional = (path) => piholeFetch(path).catch((err) => {
    console.warn(`Pi-hole ${path} failed:`, err.message);
    return null;
  });
  const [blocking, history, clients, types, upstreams, topAllowed, topBlocked, topClients] = await Promise.all([
    optional('/api/dns/blocking'),
    optional('/api/history'),
    optional('/api/history/clients'),
    optional('/api/stats/query_types'),
    optional('/api/stats/upstreams'),
    optional('/api/stats/top_domains?count=10'),
    optional('/api/stats/top_domains?blocked=true&count=10'),
    optional('/api/stats/top_clients?count=10'),
  ]);
  const q = summary.queries || {};
  res.json({
    configured: true,
    reachable: true,
    blocking: blocking?.blocking ?? null, // "enabled" | "disabled" | "failed" | "unknown"
    totalQueries: q.total ?? 0,
    blockedQueries: q.blocked ?? 0,
    percentBlocked: Math.round((q.percent_blocked ?? 0) * 10) / 10,
    queriesPerMinute: Math.round((q.frequency ?? 0) * 10) / 10,
    uniqueDomains: q.unique_domains ?? 0,
    activeClients: summary.clients?.active ?? 0,
    totalClients: summary.clients?.total ?? 0,
    domainsOnList: summary.gravity?.domains_being_blocked ?? 0,
    // 10-minute buckets over the last 24h; "allowed" = answered from cache or forwarded.
    history: (history?.history || []).map((h) => ({ t: h.timestamp, blocked: h.blocked || 0, allowed: Math.max(0, (h.total || 0) - (h.blocked || 0)) })),
    clientHistory: clientHistory(clients),
    queryTypes: Object.entries(types?.types || {}).filter(([, n]) => n > 0).map(([type, count]) => ({ type, count })),
    upstreams: (upstreams?.upstreams || []).filter((u) => u.count > 0).map((u) => ({ name: upstreamLabel(u), count: u.count })),
    topAllowed: domains(topAllowed),
    topBlocked: domains(topBlocked),
    topClients: (topClients?.clients || []).map((c) => ({ name: c.name || c.ip, ip: c.ip, count: c.count })),
  });
});

module.exports = router;
