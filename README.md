# Home Control Plane — Phase 1 + 2

Skeleton, service tiles, CPU/RAM vitals, and now Minecraft on/off + live
status — the first "act, don't just link" feature. No login logic in this
app on purpose — auth is handled one layer up, by Nginx Proxy Manager's
basic auth in front of the container. This only ever expects to be reached
through NPM, over Tailscale.

## What's here

```
server/
  index.js              Express app, static file serving
  docker.js              Shared dockerode client (talks to docker-socket-proxy)
  routes/system.js       GET /api/system/cpu, GET /api/system/ram
  routes/services.js     GET /api/services (reads config/services.json)
  routes/minecraft.js    GET /api/minecraft/status, POST .../start, .../stop
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
2. **Edit the Minecraft env vars in `docker-compose.snippet.yml`** —
   `MINECRAFT_CONTAINER_NAME` must match the actual container name shown in
   Portainer, and `MINECRAFT_HOST`/`MINECRAFT_PORT` must point at where that
   container is reachable for a server-list-ping (its Pi-hole hostname or
   container name on the shared Docker network, and whatever port it exposes).
3. **NPM proxy host** — create a new proxy host in Nginx Proxy Manager for
   `dash.marshmallowmc.com` → `home-control-plane:3000` (the container name and
   port from the compose snippet), with basic auth enabled on it.
4. **Pi-hole** — add a local DNS record for `dash.marshmallowmc.com` pointing
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

## Notes on the Minecraft control (Phase 2)

- **Docker access changed shape.** Phase 1 mounted the Docker socket
  read-only, directly into this container. Phase 2 needed write access to
  start/stop a container, and a writable raw socket mount grants control
  over *every* container on the host, not just Minecraft — too much blast
  radius for a bug or an exposed endpoint. Instead, `docker-compose.snippet.yml`
  now adds a `docker-socket-proxy` container (Tecnativa's
  `docker-socket-proxy` image) that holds the real socket and exposes only
  list/inspect/start/stop over plain TCP on the internal Docker network.
  `home-control-plane` talks to that proxy via `DOCKER_HOST`
  (`server/docker.js`) and never sees the raw socket at all.
- **"Running" isn't "joinable."** `GET /api/minecraft/status` checks two
  independent things: the container's Docker state, and (only if that state
  is `running`) an actual server-list-ping via `minecraft-server-util`,
  since a Minecraft world can take a while to finish loading after the
  container itself comes up. The frontend's "starting…" pill is that gap.
- **`minecraft-server-util` is deprecated upstream** (the maintainer now
  points people at the hosted `mcstatus.io` API instead). That's a bad fit
  here on purpose — this dashboard is LAN-only and shouldn't be phoning an
  external service every 5 seconds just to check your own server. The
  server-list-ping protocol itself is old and stable, so the last published
  version is pinned and used directly instead.
- Every route degrades the same way Phase 1's did: if the Docker proxy is
  unreachable, `/api/minecraft/status` reports "not found" instead of
  throwing, and start/stop return a clear 404 rather than a 500.

## A build note from this session

Phase 1 shipped without a real `npm install` (this sandbox's network egress
didn't reach the npm registry at the time). This session's egress *did*
work, so Phase 2 was installed, syntax-checked, and exercised end-to-end
against a small local stand-in for the Docker Engine API (list/start/stop
over the same HTTP protocol `docker-socket-proxy` and `dockerode` actually
speak) — confirmed the status/start/stop cycle, the "container up but
world not joinable yet" state, and graceful fallback when the proxy is
unreachable, all through the real UI in a browser. What's *not* verified
here is the real Minecraft server-list-ping succeeding against an actual
running world, since that needs a real server — worth a quick look once
this is deployed and `MINECRAFT_HOST`/`MINECRAFT_PORT` point at the real
thing.

## Next: Phase 3

Firefly III — stand up the container (+ MariaDB), then wire in read-only
balance/transaction widgets via its REST API.
