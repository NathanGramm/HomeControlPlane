# Home Control Plane — Phase 1

Skeleton, service tiles, and CPU/RAM vitals. No login logic in this app on
purpose — auth is handled one layer up, by Nginx Proxy Manager's basic auth
in front of the container. This only ever expects to be reached through NPM,
over Tailscale.

## What's here

```
server/
  index.js              Express app, static file serving
  routes/system.js       GET /api/system/cpu, GET /api/system/ram
  routes/services.js     GET /api/services (reads config/services.json)
  config/services.json   The tile list — edit this, not the code, to add/rename tiles
public/
  index.html, styles.css, app.js   The dashboard itself (no build step, no framework)
Dockerfile
docker-compose.snippet.yml
```

## Before you deploy

1. **Edit `server/config/services.json`** — the URLs in there are placeholders
   (`portainer.marshmallowmc.com`, etc.). Point each one at your actual Pi-hole
   local DNS hostnames.
2. **NPM proxy host** — create a new proxy host in Nginx Proxy Manager for
   `dash.marshmallowmc.com` → `home-control-plane:3000` (the container name and
   port from the compose snippet), with basic auth enabled on it.
3. **Pi-hole** — add a local DNS record for `dash.marshmallowmc.com` pointing
   at your server, same pattern as your other services.

## Running it

Local test, outside Docker (container memory breakdown will be empty since
there's no Docker socket to read — that's expected and handled gracefully):

```
npm install
npm start
# open http://localhost:3000
```

On your server, drop the `home-control-plane` service from
`docker-compose.snippet.yml` into whatever compose file/Portainer stack
already runs the rest of your containers, then:

```
docker compose up -d --build home-control-plane
```

## Notes on the two API routes

- **`GET /api/system/cpu`** uses the `systeminformation` package's
  `currentLoad()` — one call returns both the overall load and a `cpus`
  array with one entry per core. The frontend polls this every 5 seconds
  and expands into a bar-per-core view when you click the tile.

- **`GET /api/system/ram`** uses `systeminformation`'s `mem()` for the
  overall total/used figures (using `active` memory rather than
  total-minus-free, since the latter counts reclaimable cache as "used" and
  overstates real pressure), and `dockerode` to list containers and pull
  each one's memory stats from the same Docker stats endpoint Portainer's
  own UI reads from. If the Docker socket isn't mounted (or `dockerode`
  isn't installed), the breakdown is just omitted — the endpoint degrades
  instead of failing outright.

## A build note from this session

I wasn't able to `npm install` and run this end-to-end here — this
sandbox's network egress doesn't reach the npm registry at all, for any
package. I syntax-checked every file (`node --check`) and they're clean,
and both `systeminformation` and `dockerode`'s APIs used here
(`currentLoad()`, `mem()`, `listContainers()`, `container.stats()`) are
their long-stable, documented surfaces — but you're the first real
`npm install && npm start` this code will see. If something doesn't
behave as expected, tell me what you're seeing and we'll fix it from there.

## Next: Phase 2

Minecraft on/off + live status. The `docker-compose.snippet.yml` mounts the
Docker socket **read-only** on purpose — Phase 1 only ever reads. Starting
and stopping a container needs a writable mount (or a scoped Docker API
proxy in front of the raw socket, which is the safer option since a
writable socket mount can do a lot more than start/stop one container) —
worth deciding which approach before Phase 2 starts.
