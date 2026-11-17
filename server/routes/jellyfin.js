const express = require('express');

const router = express.Router();

const JELLYFIN_URL = process.env.JELLYFIN_URL || 'http://jellyfin:8096';
// Jellyfin -> Dashboard -> API Keys. Read-only use here, but Jellyfin keys
// are full admin keys, so keep it in the stack's environment only.
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY || '';

async function jellyfinFetch(path) {
  const res = await fetch(`${JELLYFIN_URL}${path}`, {
    headers: { Authorization: `MediaBrowser Token="${JELLYFIN_API_KEY}"`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// GET /api/jellyfin/summary -> { configured, reachable, counts: {movies, shows, episodes},
//   nowPlaying: [{user, title, paused, client}], recentlyAdded: [{name, year, type}] }
router.get('/summary', async (req, res) => {
  if (!JELLYFIN_API_KEY) return res.json({ configured: false });
  const [counts, sessions, latest] = await Promise.allSettled([
    jellyfinFetch('/Items/Counts'),
    jellyfinFetch('/Sessions?activeWithinSeconds=600'),
    jellyfinFetch('/Items?Recursive=true&SortBy=DateCreated&SortOrder=Descending&IncludeItemTypes=Movie,Series&Limit=6'),
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
          user: s.UserName || 'Someone',
          title: item.SeriesName ? `${item.SeriesName}: ${item.Name}` : item.Name,
          paused: !!s.PlayState?.IsPaused,
          client: s.DeviceName || s.Client || '',
        };
      }),
    recentlyAdded: (latest.value?.Items || []).map((i) => ({ name: i.Name, year: i.ProductionYear || null, type: i.Type })),
  });
});

module.exports = router;
