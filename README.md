# Home Control Plane — Phase 1 + 2 + 3

Skeleton, service tiles, CPU/RAM vitals, Minecraft on/off + live status,
and now Firefly III net worth / recent transactions — all "act, don't
just link" features on top of what started as a links page. No login
logic in this app on purpose — auth is handled one layer up, by Nginx
Proxy Manager's basic auth in front of the container. This only ever
expects to be reached through NPM, over Tailscale.

## What's here

```
server/
  index.js              Express app, static file serving
  docker.js              Shared dockerode client (talks to docker-socket-proxy)
  routes/system.js       GET /api/system/cpu, GET /api/system/ram
  routes/services.js     GET /api/services (reads config/services.json)
  routes/minecraft.js    GET /api/minecraft/status, POST .../start, .../stop
  routes/firefly.js      GET /api/firefly/summary
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
5. **Firefly III setup is two steps, in order** — see "Firefly III" below
   before deploying. The short version: fill in the `CHANGE_ME_*`
   placeholders in `docker-compose.snippet.yml` and deploy the
   `firefly-*` services first; only *after* that's up and you've logged in
   once can you generate the API token the dashboard needs, since Firefly
   has no user account to attach a token to before then. Leaving
   `FIREFLY_API_TOKEN` blank is fine in the meantime — the Finances
   section just stays hidden until it's set.

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
- The automated backups in `~/GTNHServer/backups/` stop cold after Aug 10
  — five days before the crash above. Worth finding out why (a cron job
  died? a mod stopped triggering?) so there's a real safety net next time,
  rather than relying on `level.dat_old` being lucky enough to only be a
  minute stale.
- ~~Confirm `RCON_PASSWORD` got changed from the placeholder~~ — moot until
  the incident below is resolved, since RCON isn't actually reachable yet
  regardless of that value.

### Incident 2: Stop Server force-killed the process after timing out

First real Stop Server attempt from the dashboard failed in two
compounding ways, caught from the container logs:

1. **`docker-socket-proxy` was rejecting the stop request outright.**
   `POST=0` was meant to keep the blanket "allow any write" gate closed
   while `ALLOW_START`/`ALLOW_STOP` opened just those two actions — but
   checking the proxy's actual `haproxy.cfg` rules showed the blanket
   `POST` check runs *before* the action-specific `ALLOW_*` checks and
   denies immediately if `POST` is false, so those two flags were dead
   configuration. Fixed: `POST=1` (confirmed safe — every other write
   action still has no matching `ALLOW_*` flag, so it's still denied by
   the proxy's own catch-all rule).
2. **With that fixed, the stop request reached the container, but then
   timed out and got force-killed.** Logs showed `rcon-cli` failing
   immediately (`exit status 1`) — `ENABLE_RCON=true`/`RCON_PASSWORD` in
   the compose file don't actually do anything while
   `OVERRIDE_SERVER_PROPERTIES=false`, since that's also what stops the
   image from writing RCON settings into `server.properties`. The
   original bare-metal setup never used RCON, so the file still has it
   off. Without RCON, `mc-server-runner` fell back to typing `stop` into
   the console — which is slower, and on this world didn't finish inside
   `STOP_DURATION=120s`, so `mc-server-runner` force-killed the process at
   the 2-minute mark. **Checked immediately after: no corruption this
   time** (`level.dat` was fully written, its timestamp landing right at
   the moment of the kill — the risky part of the save had already
   completed). Fixed: `STOP_DURATION` raised to 480s / `stop_grace_period`
   to 600s, and `server.properties` needs a one-time manual edit (can't be
   done via env vars while `OVERRIDE_SERVER_PROPERTIES=false`) to actually
   turn RCON on:
   ```
   enable-rcon=true
   rcon.port=25575
   rcon.password=<same value as RCON_PASSWORD in docker-compose.snippet.yml>
   ```
   Once that's live, `docker-socket-proxy` stop→RCON stop should be fast
   and reliable, with the longer `STOP_DURATION` as a safety margin rather
   than the primary mechanism.

**Resolved.** One more wrinkle surfaced while fixing this: the RCON
password originally chosen contained a `$` (`***REMOVED***`), which
Compose's own variable-interpolation pass silently swallowed as a
reference to an undefined variable, truncating the value the container
actually received — a classic Compose footgun, unrelated to RCON itself.
Replaced with a plain alphanumeric password in both `server.properties`
and the deploy environment (RCON is internal-only, never published, so
there's no security cost to keeping it simple). **Confirmed working
end-to-end**: Stop Server and Start Server both work cleanly from the
dashboard via RCON, no more force-kills.

Separately: `free -h` on the host showed ~1.2Gi free / ~3.7Gi "available"
out of 11Gi total, with the JVM alone already asking for 6G — that's
tight, and matches your instinct about needing more RAM. Containerizing
doesn't meaningfully change that math (bind mounts have no memory
overhead; the container adds a small fixed cost for its own runtime, not
per-GB-of-world), so it's worth treating as a separate, real constraint
either way.

## Firefly III (Phase 3)

Brand-new instance — its own dedicated MariaDB (`firefly-db`), same
pairing pattern as Tandoor's dedicated postgres container in your stack.
`firefly-app` is the official `fireflyiii/core` image; `firefly-cron` is
the officially-recommended companion container that hits Firefly's own
cron endpoint daily for recurring transactions and exchange rate updates
— Firefly runs fine without it, but those scheduled features silently
never fire without it.

### Setup is two steps, in that order

**Step 1 — get Firefly itself running:**

1. Fill in every `CHANGE_ME_*` placeholder in `docker-compose.snippet.yml`
   under `firefly-db`, `firefly-app`, and `firefly-cron`:
   - `MYSQL_PASSWORD` / `DB_PASSWORD` — must match each other exactly (two
     different env vars for the same credential, one per container).
   - `APP_KEY` — exactly 32 characters, no `=` or `#`. Generate with:
     ```bash
     tr -dc 'A-Za-z0-9' </dev/urandom | head -c32; echo
     ```
   - `STATIC_CRON_TOKEN` — same 32-character rule, generate the same way,
     but use a **different** value than `APP_KEY`.
2. `docker compose up -d firefly-db firefly-app firefly-cron`
3. Create an NPM proxy host for `finance.marshmallowmc.com` →
   `<your-server-ip>:8080`, and a Pi-hole DNS record, matching the pattern
   used for `dash.marshmallowmc.com` in Phase 1.
4. Visit `https://finance.marshmallowmc.com` and create your account —
   this is a fresh instance, so the first account you register becomes
   the admin.

**Step 2 — let the dashboard read it:**

5. Once logged in: **Options → Profile → OAuth → Personal Access
   Tokens** → create a new token. (Firefly has no account to attach a
   token to before step 4, which is why this can't be provisioned ahead
   of time via env vars the way everything else in this repo is.)
6. Set `FIREFLY_API_TOKEN` on `home-control-plane` to that token's value,
   then `docker compose up -d --force-recreate home-control-plane`.
7. The dashboard's Finances section should appear (it stays hidden
   whenever `FIREFLY_API_TOKEN` is unset) showing net worth and your 5
   most recent transactions.

### Notes on the API integration

- **Net worth is computed by summing asset account balances**
  (`GET /api/v1/accounts?type=asset`), not via Firefly's own
  `/api/v1/summary/basic` endpoint — that endpoint has a long-standing
  open upstream bug rejecting valid `start`/`end` query parameters
  ([firefly-iii/firefly-iii#12059](https://github.com/firefly-iii/firefly-iii/issues/12059)).
  Summing asset accounts directly is a plainer, more stable endpoint and
  produces the same number for a normal single-currency household setup.
  If you use multiple currencies, each shows as its own line rather than
  being converted/combined.
- Every Firefly call degrades the same way the rest of this app does: a
  failed or unauthenticated request logs a warning server-side and
  returns an empty result, rather than a 500 or a broken widget.
- **Confirmed working against a real instance** — net worth and recent
  transactions both render correctly with a live account behind them.

### Keeping transactions updated: the Data Importer

Deliberately chose manual statement import over automatic bank sync
(SimpleFIN or similar) — US banks have no free open-banking API the way
EU banks do under PSD2, so real auto-sync means a third-party aggregator
holding read access to actual bank logins. `firefly-importer`
(`fireflyiii/data-importer`) only ever talks to Firefly's own API — it
never touches a bank or any external service. The tradeoff is it's not
automatic: you download a statement yourself and upload it.

**One-time setup:**

1. Create a **second, separate** Personal Access Token (Options → Profile
   → OAuth → Personal Access Tokens) — don't reuse the dashboard's
   `FIREFLY_API_TOKEN`. Separate tokens per integration means revoking one
   later doesn't take the other down too.
2. Set that token as `FIREFLY_III_ACCESS_TOKEN` on `firefly-importer` in
   `docker-compose.snippet.yml`, then deploy it.
3. NPM proxy host for `import.marshmallowmc.com` → `<your-server-ip>:8081`,
   plus a Pi-hole DNS record — same pattern as every other hostname here.

**Actual workflow, whenever you want to bring in new transactions:**

1. Log into your bank's own website, download a statement as CSV (or
   OFX/QFX if your bank offers it — cleaner mapping, since it's
   structured rather than freeform columns).
2. Visit `https://import.marshmallowmc.com`, upload that file.
3. Map its columns to Firefly's fields (date, description, amount,
   account) — it remembers the mapping per file format, so this gets
   faster after the first time per bank.
4. Review the preview (it flags likely duplicates against what's already
   in Firefly) and confirm the import.

No credentials ever leave your bank's own site — the importer only ever
sees the file you hand it and talks to your own Firefly instance.

### Deployment gotchas hit in practice

Two real issues came up getting this running, neither in the app code —
worth knowing about if this ever gets redeployed from scratch:

- **A stale MariaDB volume caused persistent "Access denied" errors on
  `firefly-app`'s first boot**, even after fixing the password in the
  compose file and even after deleting and recreating the containers in
  Portainer. Cause: MariaDB's official image only runs its user/password
  initialization once, the very first time it starts against an empty
  data directory — changing `MYSQL_PASSWORD` afterward has no effect on
  an already-initialized volume. And deleting containers in Portainer
  does *not* delete their named volumes (that's the point of a named
  volume — it's meant to survive container recreation), so the same
  already-initialized, now-mismatched database kept coming back. The
  giveaway in `firefly-db`'s own logs: `"MariaDB upgrade not required"`
  on startup means it found *existing* data, not a fresh init — a true
  fresh start logs actual table-creation output instead. Fix: delete the
  volume itself (Portainer → Volumes), not just the containers, then
  redeploy.
- **New Firefly instances default to EUR**, not USD — accounts created
  before changing that inherit EUR, and Firefly doesn't cleanly convert
  an account's currency after the fact. Fixed by setting USD as the
  default under **Options → Currencies** and recreating accounts (this
  was a fresh instance with nothing real in it yet, so deleting and
  redoing them was the simplest path — a live instance with real history
  would need more care here).

## A build note from this session

Phase 1 shipped without a real `npm install` (this sandbox's network egress
didn't reach the npm registry at the time). This session's egress *did*
work, so Phase 2 was installed, syntax-checked, and exercised end-to-end
against a small local stand-in for the Docker Engine API (list/start/stop
over the same HTTP protocol `docker-socket-proxy` and `dockerode` actually
speak) — confirmed the status/start/stop cycle, the "container up but
world not joinable yet" state, and graceful fallback when the proxy is
unreachable, all through the real UI in a browser. Phase 3's Firefly route
was tested the same way pre-deployment, against a hand-built stand-in rather than a real
instance (see above).

## Next: Phase 4

Calisthenics: routine builder, then session logging, then the feedback
engine — in that order, since each depends on the last.
