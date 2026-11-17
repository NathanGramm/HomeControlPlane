const assert = require('node:assert');
const { test, before, after, beforeEach } = require('node:test');
const express = require('express');

process.env.PIHOLE_URL = 'http://pihole.test';
process.env.PIHOLE_API_PASSWORD = 'app-pass';
process.env.JELLYFIN_URL = 'http://jellyfin.test';
process.env.JELLYFIN_API_KEY = 'key';

// Fake upstreams: requests to the test server go through the real fetch,
// everything else hits these handlers.
const realFetch = fetch;
let logins;
let validSid;
let jellyfinDown;
let brokenPiholePaths;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const POSTER = 'a'.repeat(32);

function fakePihole(url, opts = {}) {
  const path = url.replace('http://pihole.test', '');
  if (path === '/api/auth') {
    logins += 1;
    const ok = JSON.parse(opts.body).password === 'app-pass';
    validSid = ok ? `sid-${logins}` : null;
    return json({ session: { valid: ok, sid: validSid } }, ok ? 200 : 401);
  }
  if (opts.headers?.['X-FTL-SID'] !== validSid) return json({ error: 'unauthorized' }, 401);
  if (brokenPiholePaths.includes(path)) return json({}, 500);
  switch (path) {
    case '/api/stats/summary':
      return json({ queries: { total: 1000, blocked: 123, percent_blocked: 12.345, frequency: 24.04, unique_domains: 300 }, clients: { active: 7, total: 9 }, gravity: { domains_being_blocked: 150000 } });
    case '/api/dns/blocking': return json({ blocking: 'enabled' });
    case '/api/history': return json({ history: [{ timestamp: 1, total: 10, blocked: 3 }, { timestamp: 2, total: 5, blocked: 0 }] });
    case '/api/history/clients':
      return json({
        clients: { '10.0.0.1': { name: 'tv', total: 50 }, '10.0.0.2': { name: '', total: 40 }, '10.0.0.3': { name: 'phone', total: 1 } },
        history: [{ timestamp: 1, data: { '10.0.0.1': 4, '10.0.0.2': 2, '10.0.0.3': 1 } }],
      });
    case '/api/stats/query_types': return json({ types: { A: 60, AAAA: 30, MX: 0 } });
    case '/api/stats/upstreams':
      return json({ upstreams: [{ ip: 'blocklist', name: 'blocklist', port: -1, count: 123 }, { ip: '8.8.8.8', name: 'dns.google', port: 53, count: 400 }, { ip: '1.1.1.1', name: '', port: 53, count: 0 }] });
    case '/api/stats/top_domains?count=10': return json({ domains: [{ domain: 'github.com', count: 90 }] });
    case '/api/stats/top_domains?blocked=true&count=10': return json({ domains: [{ domain: 'ads.example', count: 50 }] });
    case '/api/stats/top_clients?count=10': return json({ clients: [{ ip: '10.0.0.1', name: 'tv', count: 50 }, { ip: '10.0.0.2', name: '', count: 40 }] });
    default: return json({}, 404);
  }
}

function fakeJellyfin(url, opts = {}) {
  if (jellyfinDown) return Promise.reject(new Error('ECONNREFUSED'));
  assert.strictEqual(opts.headers.Authorization, 'MediaBrowser Token="key"');
  const path = url.replace('http://jellyfin.test', '');
  if (path === '/Items/Counts') return json({ MovieCount: 120, SeriesCount: 15, EpisodeCount: 400 });
  if (path.startsWith('/Sessions')) {
    return json([
      {
        UserName: 'nathan', DeviceName: 'TV',
        NowPlayingItem: { Id: 'ep1', SeriesId: 'show1', Name: 'Pilot', SeriesName: 'Some Show', RunTimeTicks: 1000 },
        PlayState: { IsPaused: true, PositionTicks: 250, PlayMethod: 'Transcode' },
      },
      { UserName: 'idle' },
    ]);
  }
  if (path.startsWith('/Items?')) return json({ Items: [{ Id: 'm1', Name: 'A Movie', ProductionYear: 2024, Type: 'Movie', DateCreated: '2026-11-01' }] });
  if (path === '/Users') return json([{ Name: 'old', LastActivityDate: '2026-01-01' }, { Name: 'nathan', LastActivityDate: '2026-11-15' }]);
  if (path.startsWith(`/Items/${POSTER}/Images/Primary`)) return new Response('JPEGDATA', { headers: { 'content-type': 'image/jpeg' } });
  return json({}, 404);
}

let server;
let base;

before(async () => {
  global.fetch = async (url, opts) => {
    if (url.startsWith(base)) return realFetch(url, opts);
    return url.startsWith('http://pihole.test') ? fakePihole(url, opts) : fakeJellyfin(url, opts);
  };
  const app = express();
  app.use('/api/pihole', require('./pihole'));
  app.use('/api/jellyfin', require('./jellyfin'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  global.fetch = realFetch;
  server.close();
});

beforeEach(() => {
  jellyfinDown = false;
  brokenPiholePaths = [];
});

const get = async (path) => (await realFetch(base + path)).json();

test('Pi-hole: logs in once, reuses the session, and maps every stat', async () => {
  logins = 0;
  const d = await get('/api/pihole/summary');
  await get('/api/pihole/summary');
  assert.strictEqual(logins, 1);
  assert.strictEqual(d.percentBlocked, 12.3);
  assert.strictEqual(d.queriesPerMinute, 24);
  assert.strictEqual(d.blocking, 'enabled');
  assert.deepStrictEqual(d.history, [{ t: 1, blocked: 3, allowed: 7 }, { t: 2, blocked: 0, allowed: 5 }]);
  assert.deepStrictEqual(d.queryTypes, [{ type: 'A', count: 60 }, { type: 'AAAA', count: 30 }]);
  assert.deepStrictEqual(d.upstreams, [{ name: 'blocklist', count: 123 }, { name: 'dns.google#53', count: 400 }]);
  assert.deepStrictEqual(d.topAllowed, [{ domain: 'github.com', count: 90 }]);
  assert.deepStrictEqual(d.topBlocked, [{ domain: 'ads.example', count: 50 }]);
  assert.strictEqual(d.topClients[1].name, '10.0.0.2'); // unnamed clients fall back to their IP
});

test('Pi-hole: client activity keeps the busiest clients and folds the rest into "other"', async () => {
  const d = await get('/api/pihole/summary');
  assert.deepStrictEqual(d.clientHistory.clients, ['tv', '10.0.0.2', 'phone', 'other']);
  assert.deepStrictEqual(d.clientHistory.buckets, [{ t: 1, counts: [4, 2, 1, 0] }]);
});

test('Pi-hole: one failing endpoint leaves the rest of the page working', async () => {
  brokenPiholePaths = ['/api/history', '/api/stats/upstreams'];
  const d = await get('/api/pihole/summary');
  assert.strictEqual(d.reachable, true);
  assert.deepStrictEqual(d.history, []);
  assert.deepStrictEqual(d.upstreams, []);
  assert.strictEqual(d.topBlocked.length, 1);
});

test('Pi-hole: logs in again when the session expires', async () => {
  logins = 0;
  validSid = 'rotated'; // Pi-hole restarted and forgot the cached session
  const r = await get('/api/pihole/summary');
  assert.strictEqual(r.reachable, true);
  assert.strictEqual(logins, 1);
});

test('Jellyfin: counts, now playing with progress, recently added and users', async () => {
  const r = await get('/api/jellyfin/summary');
  assert.deepStrictEqual(r.counts, { movies: 120, shows: 15, episodes: 400 });
  assert.deepStrictEqual(r.nowPlaying, [{ id: 'show1', user: 'nathan', title: 'Some Show: Pilot', paused: true, progress: 25, client: 'TV', transcoding: true }]);
  assert.deepStrictEqual(r.recentlyAdded, [{ id: 'm1', name: 'A Movie', year: 2024, type: 'Movie', added: '2026-11-01' }]);
  assert.deepStrictEqual(r.users.map((u) => u.name), ['nathan', 'old']);
});

test('Jellyfin: reports unreachable instead of failing', async () => {
  jellyfinDown = true;
  assert.deepStrictEqual(await get('/api/jellyfin/summary'), { configured: true, reachable: false });
});

test('Jellyfin: posters are proxied, and only real item ids are accepted', async () => {
  const ok = await realFetch(`${base}/api/jellyfin/image/${POSTER}`);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(await ok.text(), 'JPEGDATA');
  for (const bad of ['..%2F..%2FSystem%2FInfo', 'abc', `${POSTER}x`]) {
    assert.strictEqual((await realFetch(`${base}/api/jellyfin/image/${bad}`)).status, 400, bad);
  }
});
