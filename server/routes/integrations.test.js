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
let calls;
let logins;
let validSid;
let jellyfinDown;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fakePihole(url, opts = {}) {
  const path = url.replace('http://pihole.test', '');
  if (path === '/api/auth') {
    logins += 1;
    const ok = JSON.parse(opts.body).password === 'app-pass';
    validSid = ok ? `sid-${logins}` : null;
    return json({ session: { valid: ok, sid: validSid } }, ok ? 200 : 401);
  }
  if (opts.headers?.['X-FTL-SID'] !== validSid) return json({ error: 'unauthorized' }, 401);
  if (path === '/api/stats/summary') {
    return json({ queries: { total: 1000, blocked: 123, percent_blocked: 12.345 }, clients: { active: 7 }, gravity: { domains_being_blocked: 150000 } });
  }
  if (path.startsWith('/api/stats/top_domains')) return json({ domains: [{ domain: 'ads.example', count: 50 }] });
  if (path === '/api/dns/blocking') return json({ blocking: 'enabled' });
  return json({}, 404);
}

function fakeJellyfin(url, opts = {}) {
  if (jellyfinDown) return Promise.reject(new Error('ECONNREFUSED'));
  assert.strictEqual(opts.headers.Authorization, 'MediaBrowser Token="key"');
  const path = url.replace('http://jellyfin.test', '');
  if (path === '/Items/Counts') return json({ MovieCount: 120, SeriesCount: 15, EpisodeCount: 400 });
  if (path.startsWith('/Sessions')) {
    return json([
      { UserName: 'nathan', DeviceName: 'TV', NowPlayingItem: { Name: 'Pilot', SeriesName: 'Some Show' }, PlayState: { IsPaused: true } },
      { UserName: 'idle' },
    ]);
  }
  if (path.startsWith('/Items?')) return json({ Items: [{ Name: 'A Movie', ProductionYear: 2024, Type: 'Movie' }] });
  return json({}, 404);
}

let server;
let base;

before(async () => {
  global.fetch = async (url, opts) => {
    if (url.startsWith(base)) return realFetch(url, opts);
    calls.push(url);
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
  calls = [];
  jellyfinDown = false;
});

const get = async (path) => (await realFetch(base + path)).json();

test('Pi-hole: logs in once, reuses the session, and maps the stats', async () => {
  logins = 0;
  const first = await get('/api/pihole/summary');
  await get('/api/pihole/summary');
  assert.strictEqual(logins, 1);
  assert.deepStrictEqual(first, {
    configured: true, reachable: true, blocking: 'enabled', totalQueries: 1000, blockedQueries: 123,
    percentBlocked: 12.3, activeClients: 7, domainsOnList: 150000, topBlocked: [{ domain: 'ads.example', count: 50 }],
  });
});

test('Pi-hole: logs in again when the session expires', async () => {
  logins = 0;
  validSid = 'rotated'; // Pi-hole restarted and forgot the cached session
  const r = await get('/api/pihole/summary');
  assert.strictEqual(r.reachable, true);
  assert.strictEqual(logins, 1);
});

test('Jellyfin: counts, now playing and recently added', async () => {
  const r = await get('/api/jellyfin/summary');
  assert.deepStrictEqual(r, {
    configured: true, reachable: true,
    counts: { movies: 120, shows: 15, episodes: 400 },
    nowPlaying: [{ user: 'nathan', title: 'Some Show: Pilot', paused: true, client: 'TV' }],
    recentlyAdded: [{ name: 'A Movie', year: 2024, type: 'Movie' }],
  });
});

test('Jellyfin: reports unreachable instead of failing', async () => {
  jellyfinDown = true;
  assert.deepStrictEqual(await get('/api/jellyfin/summary'), { configured: true, reachable: false });
});
