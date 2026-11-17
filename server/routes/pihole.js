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

// GET /api/pihole/summary -> { configured, reachable, blocking, totalQueries, blockedQueries,
//   percentBlocked, activeClients, domainsOnList, topBlocked: [{domain, count}] }
router.get('/summary', async (req, res) => {
  if (!PIHOLE_API_PASSWORD) return res.json({ configured: false });
  try {
    const [summary, top, blocking] = await Promise.all([
      piholeFetch('/api/stats/summary'),
      piholeFetch('/api/stats/top_domains?blocked=true&count=5').catch(() => ({ domains: [] })),
      piholeFetch('/api/dns/blocking').catch(() => ({ blocking: null })),
    ]);
    res.json({
      configured: true,
      reachable: true,
      blocking: blocking.blocking, // "enabled" | "disabled" | "failed" | "unknown"
      totalQueries: summary.queries?.total ?? 0,
      blockedQueries: summary.queries?.blocked ?? 0,
      percentBlocked: Math.round((summary.queries?.percent_blocked ?? 0) * 10) / 10,
      activeClients: summary.clients?.active ?? 0,
      domainsOnList: summary.gravity?.domains_being_blocked ?? 0,
      topBlocked: (top.domains || []).map((d) => ({ domain: d.domain, count: d.count })),
    });
  } catch (err) {
    console.warn('Pi-hole fetch failed:', err.message);
    res.json({ configured: true, reachable: false });
  }
});

module.exports = router;
