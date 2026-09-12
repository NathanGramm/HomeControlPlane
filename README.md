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
2. **Minecraft runs as the `gtnh-minecraft` container** (see "Minecraft now
   runs in a container" below) — `MINECRAFT_CONTAINER_NAME`/`MINECRAFT_HOST`
   already point at it by name over the shared compose network, and
   `MINECRAFT_PORT=25564` matches `server.properties`' actual `server-port`
   (not Minecraft's 25565 default). Start/stop and live status both work
   from the dashboard.
3. **NPM proxy host** — unlike a container-network setup, NPM here reaches
   every other service (Jellyfin, Tandoor, Pi-hole, homepage) at
   `<host-ip>:<published-port>`, not by container name — so
   `home-control-plane` follows the same pattern. Create a proxy host for
   `dash.marshmallowmc.com` → `<your-server-ip>:3001` (the port published in
   the compose snippet), with basic auth enabled on it.
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
- **The join-status ping is independent of container discovery on
  purpose.** `GET /api/minecraft/status` always pings the real Minecraft
  port, whether or not a matching container exists. This is what made the
  status pill accurate even before Minecraft was containerized (see
  below) — it kept working against the bare-metal server with no code
  changes needed once the container replaced it. Only start/stop need a
  container to act on; the frontend disables that button (labeled "Not
  containerized yet") when `container.found` is false, without hiding the
  real online/offline state.

## Minecraft now runs in a container

The plan is to replace `minecraft.service` with a proper container so
start/stop can go through `docker-socket-proxy` like everything else,
instead of a `screen -X stuff "stop\r"` hack. Current unit for reference:

```
[Service]
Type=simple
User=ncgramm
WorkingDirectory=/home/ncgramm/GTNHServer
ExecStart=/usr/bin/screen -DmS mc-server /home/ncgramm/GTNHServer/startserver-java9.sh
ExecStop=/usr/bin/screen -S mc-server -X stuff "stop\r"
Restart=on-failure
```

Worth noting: `Restart=on-failure` here plus `startserver-java9.sh`'s own
internal restart loop (the script relaunches the jar itself after a 12-second
countdown) are two independent restart mechanisms layered on top of each
other — normal for a script written for an interactive `screen`/`tmux`
session, redundant once systemd is supervising it. A container image with
its own clean restart/shutdown handling (e.g. `itzg/minecraft-server`,
which supports a custom server jar + JVM args and shuts down gracefully on
`docker stop` without needing a `screen` session to type commands into)
would fold both of those into one mechanism, and give the dashboard a real
programmatic stop instead of simulating a keystroke.

This is a live server with real world data — not attempting it without a
concrete plan for preserving the world/mods/config and a tested rollback.

**Confirmed:** Java 17.0.20 (matches GTNH 2.8.0's Java 17 build), server jar
is `lwjgl3ify-forgePatches.jar`, and everything — world, mods, config,
whitelist/ops/bans, `server.properties` — lives flat under
`~/GTNHServer`. The `gtnh-minecraft` service in
`docker-compose.snippet.yml` bind-mounts that directory as `/data` as-is
(no copying) and uses `TYPE=CUSTOM` with `JVM_OPTS=-Dfml.readTimeout=180
@java9args.txt` — reusing the existing args file by reference rather than
retyping its ~30 `--add-opens` flags, so it can't drift from it later.

**Both blocking values are now confirmed** and filled into
`docker-compose.snippet.yml`:

1. **`UID`/`GID`** — `id ncgramm` on the host returned `uid=1000, gid=1000`,
   matching what's set. (`server.properties` is mode `600`, owner-only —
   this is why a UID mismatch would have mattered.)
2. **The real internal port is 25564, not Minecraft's 25565 default** —
   `server.properties` already has `server-port=25564` set explicitly, the
   same port your `_minecraft._tcp` SRV record publishes externally. Both
   `gtnh-minecraft`'s port mapping and `home-control-plane`'s
   `MINECRAFT_PORT` use 25564 accordingly.

**Status: migrated and confirmed working**, joinable at both the LAN IP
(`192.168.4.20:25564`) and `marshmallowmc.com`. `minecraft.service` is
stopped and disabled; `gtnh-minecraft` is the only thing serving the port
now.

Rollback path, if it's ever needed again: `docker compose stop
gtnh-minecraft`, then `sudo systemctl enable --now minecraft.service`.
Nothing on disk was moved during the migration, only read from, so this is
safe to fall back to.

### Incident during the first boot: a month-old stuck `level.dat`

The first time the container came up, it looked stuck — the dashboard
showed "container up, world not joinable," and direct connection attempts
failed too. The actual cause turned out to be unrelated to
containerization at all: `~/GTNHServer/World/level.dat` was 0 bytes with a
timestamp from **Aug 15** (`level.dat_old`, 213KB and fully valid, was one
minute older) — the original bare-metal server had apparently crashed
mid-save on Aug 15 and never recovered. Forge's own fallback logic
correctly found and validated `level.dat_old`, but then parked at an
interactive "Run `/fml confirm` to proceed" safety prompt, waiting for a
human at a console that doesn't exist under systemd or in a container —
so it had likely been silently hung in that exact state for about a
month, both before and after this migration. Fixed by adding
`-Dfml.queryResult=confirm` to `JVM_OPTS` to auto-accept that prompt,
since headless operation can never answer it interactively anyway.
Real data loss from this: about one minute of world metadata (time,
weather, spawn) — chunk/region files are separate files and were
untouched.

**Two follow-ups worth doing, neither urgent:**
- Confirm `RCON_PASSWORD` in `docker-compose.snippet.yml` got changed from
  the placeholder before this went live.
- The automated backups in `~/GTNHServer/backups/` stop cold after Aug 10
  — five days before the crash above. Worth finding out why (a cron job
  died? a mod stopped triggering?) so there's a real safety net next time,
  rather than relying on `level.dat_old` being lucky enough to only be a
  minute stale.

Separately: `free -h` on the host showed ~1.2Gi free / ~3.7Gi "available"
out of 11Gi total, with the JVM alone already asking for 6G — that's
tight, and matches your instinct about needing more RAM. Containerizing
doesn't meaningfully change that math (bind mounts have no memory
overhead; the container adds a small fixed cost for its own runtime, not
per-GB-of-world), so it's worth treating as a separate, real constraint
either way.

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
