const express = require('express');

const router = express.Router();

const JELLYFIN_URL = process.env.JELLYFIN_URL || 'http://jellyfin:8096';
// Jellyfin -> Dashboard -> API Keys. Read-only use here, but Jellyfin keys
// are full admin keys, so keep it in the stack's environment only.
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY || '';
const AUTH = { Authorization: `MediaBrowser Token="${JELLYFIN_API_KEY}"` };

async function jellyfinFetch(path) {
  const res = await fetch(`${JELLYFIN_URL}${path}`, { headers: { ...AUTH, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const pct = (pos, total) => (total ? Math.round((pos / total) * 100) : null);

// GET /api/jellyfin/summary -> { configured, reachable, counts, nowPlaying, recentlyAdded, users }
router.get('/summary', async (req, res) => {
  if (!JELLYFIN_API_KEY) return res.json({ configured: false });
  const [counts, sessions, latest, users] = await Promise.allSettled([
    jellyfinFetch('/Items/Counts'),
    jellyfinFetch('/Sessions?activeWithinSeconds=600'),
    jellyfinFetch('/Items?Recursive=true&SortBy=DateCreated&SortOrder=Descending&IncludeItemTypes=Movie,Series&Limit=12&Fields=DateCreated'),
    jellyfinFetch('/Users'),
  ]);
  if (counts.status === 'rejected' && sessions.status === 'rejected') {
    console.warn('Jellyfin fetch failed:', counts.reason.message);
    return res.json({ configured: true, reachable: false });
  }
  const c = counts.value || {};
  res.json({
    configured: true,
    reachable: true,
    counts: { movies: c.MovieCount ?? 0, shows: c.SeriesCount ?? 0, episodes: c.EpisodeCount ?? 0 },
    nowPlaying: (sessions.value || [])
      .filter((s) => s.NowPlayingItem)
      .map((s) => {
        const item = s.NowPlayingItem;
        return {
          id: item.SeriesId || item.Id || null,
          user: s.UserName || 'Someone',
          title: item.SeriesName ? `${item.SeriesName}: ${item.Name}` : item.Name,
          paused: !!s.PlayState?.IsPaused,
          progress: pct(s.PlayState?.PositionTicks || 0, item.RunTimeTicks),
          client: s.DeviceName || s.Client || '',
          transcoding: s.PlayState?.PlayMethod === 'Transcode',
        };
      }),
    recentlyAdded: (latest.value?.Items || []).map((i) => ({
      id: i.Id || null, name: i.Name, year: i.ProductionYear || null, type: i.Type, added: i.DateCreated || null,
    })),
    users: (users.value || []).map((u) => ({ name: u.Name, lastActive: u.LastActivityDate || null }))
      .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || '')),
  });
});

// GET /api/jellyfin/image/:id -> the item's poster, proxied so the API key
// never reaches the browser.
router.get('/image/:id', async (req, res) => {
  if (!JELLYFIN_API_KEY) return res.status(404).end();
  if (!/^[0-9a-f]{32}$/i.test(req.params.id)) return res.status(400).end(); // Jellyfin ids are 32 hex chars
  try {
    const upstream = await fetch(`${JELLYFIN_URL}/Items/${req.params.id}/Images/Primary?maxHeight=300&quality=85`, { headers: AUTH });
    if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).end();
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('Jellyfin image fetch failed:', err.message);
    res.status(502).end();
  }
});

module.exports = router;
