# Engineering Notes

Design decisions, setup details, and incident write-ups behind
[Home Control Plane](../README.md). The README covers what the project is;
this file covers why it's built the way it is and what broke along the way.

## System vitals API

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
  radius for a bug or an exposed endpoint. Instead, `stacks/dashboard/compose.yml`
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

**Confirmed:** Java 17 (`itzg/minecraft-server:java17`; GTNH 2.9.0-RC-2's
Java 17–25 server build runs on it — `java25` is the optional faster tag),
server jar is `lwjgl3ify-forgePatches.jar` (re-check the name in the 2.9.0
zip), and everything — world, mods, config,
whitelist/ops/bans, `server.properties` — lives flat under
`~/GTNHServer`. The `gtnh-minecraft` service in
`stacks/minecraft/compose.yml` bind-mounts that directory as `/data` as-is
(no copying) and uses `TYPE=CUSTOM` with `JVM_OPTS=-Dfml.readTimeout=180
@java9args.txt` — reusing the existing args file by reference rather than
retyping its ~30 `--add-opens` flags, so it can't drift from it later.

**Both blocking values are now confirmed** and filled into
`stacks/minecraft/compose.yml`:

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
   rcon.password=<same value as RCON_PASSWORD in stacks/minecraft/compose.yml>
   ```
   Once that's live, `docker-socket-proxy` stop→RCON stop should be fast
   and reliable, with the longer `STOP_DURATION` as a safety margin rather
   than the primary mechanism.

**Resolved.** One more wrinkle surfaced while fixing this: the RCON
password originally chosen contained a `$`, which
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
tight. Containerizing
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

1. Fill in the finance stack's variables (template: `stacks/finance/.env.example`;
   in Portainer, under the stack's Environment variables):
   - `FIREFLY_DB_PASSWORD` — one value, used by both `firefly-db` and
     `firefly-app`, so they can't drift apart.
   - `FIREFLY_APP_KEY` — exactly 32 characters, no `=` or `#`. Generate with:
     ```bash
     tr -dc 'A-Za-z0-9' </dev/urandom | head -c32; echo
     ```
   - `FIREFLY_STATIC_CRON_TOKEN` — same 32-character rule, generate the same
     way, but use a **different** value than `FIREFLY_APP_KEY`.
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
6. Set `FIREFLY_API_TOKEN` in the dashboard stack's variables to that token's value,
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
2. Set that token as `FIREFLY_IMPORTER_TOKEN` in the finance stack's variables, then deploy
   `firefly-importer`.
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


## Family server

`family-minecraft` is a Paper server in `~/FamilyServer`, bind-mounted as
`/data` the same way `gtnh-minecraft` is. It's only run now and then, so
`restart: "no"` keeps it from starting at boot and from holding 3 GB of an
11 GB host.

**Redeploys leave both Minecraft servers alone.** A stack redeploy starts every
service, including ones stopped on purpose, so `family-minecraft` and
`gtnh-minecraft` sit behind the `family` and `gtnh` Compose profiles and only
the dashboard starts them. The catch is that a redeploy doesn't apply compose
changes to them either. To apply one, stop both servers, add
`COMPOSE_PROFILES=family` (or `gtnh`) to the Portainer stack's environment
variables, redeploy, which also starts that server, then remove the variable.
docker-socket-proxy can't create containers, so the same steps recreate a
container if one is ever deleted.

**Only one server at a time, until the RAM upgrade.** `POST
/api/minecraft/:server/start` returns 409 while the other server's container
is in any state but `created`, `exited` or `dead`, so one that's still saving
during a slow stop counts as up. If Docker can't be read, the start is
refused rather than assumed safe. This only guards the dashboard: a deploy
that brings up both servers bypasses it, and host RAM is at risk then. To
lift the limit, delete `findRunningOtherServer` and its two callers in
`server/routes/minecraft.js`.

**Version: 26.3**, the newest release with a stable Iris shader build for
Fabric as of 2026-10-30 (Iris 1.11.7, Sodium 0.9.2). It needs Java 25, hence
the `java25` image tag. Shaders are client-side only, so the server needs
no mods; each client needs Fabric plus Iris and Sodium. Install them through
the Iris installer or Modrinth rather than picking Sodium by hand, since
newer Sodium builds can break Iris. Fabric clients join a Paper server fine.

**The upgrade is one-way.** Minecraft doesn't support opening an upgraded
world in the older version. The world went to 26.3 on an unplanned stack
deploy on 2026-10-30, before these profiles existed. For later version
changes, back up first: `cp -a ~/FamilyServer ~/FamilyServer.bak`.

### Paper, not vanilla

This used to be a Spigot server, with DriveBackupV2 doing its backups. The
compose file said `TYPE=VANILLA`, so the container ran without loading any
plugin, and backups silently stopped. It's
`TYPE=PAPER` now: Paper runs Spigot plugins, and unlike Spigot it has
download builds the image can fetch on its own.

If the first boot fails with `No build found for version 26.3 with channel
'default'`, Paper still marks 26.3 as beta: uncomment `PAPER_CHANNEL` in the
compose file, apply it, and remove it again once 26.3 goes stable.

Paper blocks some vanilla exploits that the family's farms rely on: TNT,
rail and carpet duping, sand duping through end portals, string duping,
and breaking bedrock with headless pistons. The compose file turns all of
those back on through a patch (`family_vanilla_exploits`) that the image
applies to `config/paper-global.yml` on every start. The patch only edits a
file that exists, so the first Paper boot runs with Paper's defaults and the
exploits work from the second boot on. Paper lists these settings as
unsupported, so a Paper update can rename or drop them. If a farm stops
working after an update, check the `unsupported-settings` section of that
file.

### First Paper boot: the Nether and the End

Since 26.1, vanilla and Paper both keep every dimension inside the world
folder, under `world/dimensions/minecraft/` (`overworld`, `the_nether`,
`the_end`). Spigot kept the Nether and the End in separate `world_nether`
and `world_the_end` folders next to `world`. When vanilla 26.3 opened the old
Spigot world, it moved the Overworld into the new layout but never looked at
`world_nether` or `world_the_end`, so it generated a new, empty Nether and
End. Every Nether or End trip since the switch to vanilla happened in those.

On its first boot Paper tries to import `world_nether` and `world_the_end`
into `world/dimensions/minecraft/`. If vanilla's replacements are already
there, the import stops with `Refusing to overwrite existing migrated file`,
and the server doesn't start. So decide before the first boot, with the
server stopped and a fresh `cp -a ~/FamilyServer ~/FamilyServer.bak`:

```bash
cd ~/FamilyServer   # if level-name isn't "world", use that name below
ls -d world_nether world_the_end world/dimensions/minecraft/*
```

- **To get the original Nether and End back** (usually right, unless the
  family has built a lot there since the switch): move the replacements out, and Paper
  imports the originals on boot.
  ```bash
  mkdir -p ~/FamilyServer-vanilla-dims
  mv world/dimensions/minecraft/the_nether world/dimensions/minecraft/the_end ~/FamilyServer-vanilla-dims/
  ```
- **To keep the replacements**: move `world_nether` and `world_the_end` out
  of `~/FamilyServer` instead, so Paper has nothing to import.

If the boot already failed, Paper moved some originals into the
replacement folders before it stopped. Moving those folders aside then takes
the moved originals with them. First move every file older than the switch
to vanilla (Oct 30, 2026) back into `world_nether/DIM-1` (or
`world_the_end/DIM1`):
`find world/dimensions/minecraft -name '*.mca' ! -newermt 2026-10-30` lists
them.

The log shows `LegacyCraftBukkitWorldMigration` lines during the import.
Afterwards only `world` remains, so DriveBackupV2's world list needs only
`world`.

### Who can get in

This is the one service in this file that's port-forwarded to the internet
(25566), so bots find it within days. They can't get in, because these are
set in `server.properties`. The image doesn't manage that file here
(`OVERRIDE_SERVER_PROPERTIES=false`), so set them by hand with the server
stopped:

```properties
white-list=true
# kicks anyone removed from the list while they're online
enforce-whitelist=true
# only real, signed-in Minecraft accounts
online-mode=true
enforce-secure-profile=true
# no player names in ping replies
hide-online-players=true
enable-query=false
server-port=25566
# safe: 25575 is never published, see the compose file
enable-rcon=true
rcon.port=25575
rcon.password=<RCON_PASSWORD>
```

`server.properties` has no end-of-line comments, so keep each comment on its
own line.

Operators get in whether or not they're whitelisted, so keep `ops.json` to
the server's owner. Manage the list from a Portainer exec shell into
`family-minecraft` (no server restart needed):

```bash
rcon-cli whitelist add <name>
rcon-cli whitelist remove <name>
rcon-cli whitelist list
```

### Hiding the server from scanners

Pings (the server-list entry) happen before login, so they carry no account.
"Only whitelisted players can ping" can only mean "only IP addresses a
whitelisted player has joined from". That's what
[Anti MOTD Scanner](https://modrinth.com/plugin/anti-motd-scanner) does: it
answers pings from any other IP with empty data. Joining still works from a
new IP. The server just looks empty in the list until the first join from
there.

It doesn't stop traffic reaching the port. Only a firewall or a VPN does
that, and Tailscale-only access would. The plugin needs ProtocolLib and, as
of 2026-11-08, lists support up to 26.1, so it may not load on 26.3.

Setup, with the server stopped:

1. Put the newest ProtocolLib build that supports 26.3 and Anti MOTD Scanner
   in `~/FamilyServer/plugins/`. Remove any other old jars there.
2. Start the server, then stop it again so the plugin writes its files.
3. Add `127.0.0.1` on its own line to the plugin's `ipcache.txt`. The
   image's healthcheck pings from inside the container; if that ping is
   hidden, the container shows as unhealthy.
4. Start the server, and have each player join once from home.

To check it works, use a phone on mobile data (not home Wi-Fi) and a Java
client that has never joined: the server should show no MOTD or players.
`blocked-motd-logs.txt` fills up with scanner IPs within days.

If the plugin won't load on 26.3, set `enable-status=false` instead. Then
nobody's client sees a server-list entry, including family, but **Join
Server** still works. The healthcheck and the dashboard's ping both fail
then, so the dashboard shows the server as "starting" the whole time it
runs.

The dashboard pings from its own container's IP, which never joins, so its
ping may get empty data too. It falls back to Docker's health status, which
comes from the container's own ping from `127.0.0.1`, and shows "online"
without a player count.

### Backups

Two layers, because the old setup failed with nobody noticing:

- **Local, every 6 hours while the server is in use:** `family-minecraft-backup`
  and `gtnh-minecraft-backup`
  ([itzg/mc-backup](https://github.com/itzg/docker-mc-backup)) write tar
  files to `/mnt/storage4t/backups/<server>`, keeping the newest 20 (and
  nothing older than 90 days). That's a separate disk from the worlds, and
  the root disk is too full to hold them anyway. It pauses saving over RCON during each backup, and it
  doesn't depend on any plugin or server type. It keeps running while the
  server is stopped and waits for RCON. It takes its first backup once the
  server is up. GTNH's then backs up every 6 hours. The family server's
  only backs up again 6 hours after someone has been online: after each
  backup it asks RCON's `list` every 5 minutes, and once a player shows up
  it waits 6 hours and backs up. Idle days, running or stopped, add no
  backups, so the newest 20 reach further back. A visit shorter than 5
  minutes can slip between checks. The image's own player check is a
  server-list ping, which the ping hiding blanks out, so the compose file
  swaps in a small `mc-monitor` script (`rcon_player_count`) that answers
  it over RCON.
- **Off-site:** DriveBackupV2 uploads to Google Drive. Update it to 1.8.1
  or newer, and relink with `/drivebackup linkaccount googledrive` if the log
  shows auth errors. Test it with `/drivebackup backup`.

Check the local layer after any change:

```bash
docker logs family-minecraft-backup --tail 20
ls -lh /mnt/storage4t/backups/family-minecraft
docker exec family-minecraft-backup backup now   # one-off backup
# family server only: the player count it waits on (server must be running)
docker exec family-minecraft-backup mc-monitor status --show-player-count
```

While the family server is stopped, its backup log shows `Error querying
the server, waiting 5m...` after the last backup. That's expected: RCON is
down, so it keeps waiting.

To restore, stop the server and use **Restore** on the Minecraft page's
Backups tab. It extracts the tar next to the server folder, then swaps in
only the world folders (`<level-name>`, `_nether`, `_the_end`). The current
ones move into `<level-name>.before-restore-<time>`, which you delete in the
Files tab once the restored world looks right. Plugins, mods and config stay
as they are: backups skip jars, so restoring `mods/` would empty it. The
extraction needs free space on the server's disk about the size of the
world, and the root disk is nearly full, so check `df -h ~` first for GTNH.
If the disk fills up, the restore stops and nothing is swapped.

## Server files

The Minecraft page has its own file manager (browse, edit text files,
upload, download, rename, delete). The dashboard mounts both server folders
read-write for it, and refuses every change while that server is starting,
running or stopping, or when it can't ask Docker. Reads always work. New
files get the server folder's owner (uid 1000), since the dashboard runs as
root. The dashboard is LAN/Tailscale-only and never port-forwarded, so the
open Minecraft ports don't expose any of this.

A hijacked Minecraft server is the remaining risk: it shares `proxy-network`
with the dashboard. `server/docker-guard.js` refuses every request from
inside Docker except NPM's: other containers' addresses, and each Docker
network's gateway, which is where a container shows up when it goes out to
`192.168.4.20:3001`. So NPM's proxy host for `dash.marshmallowmc.com` must
forward to `home-control-plane` port `3000`. Through `:3001`, NPM is refused
too. The list refreshes from Docker every 10 seconds. To let another
container in (an uptime monitor, say), add its name to
`DASHBOARD_ALLOWED_CONTAINERS`, comma-separated, default
`nginx-proxy-manager`. `curl localhost:3001` on the host itself is refused
too; use the LAN address.

The console needs `RCON_PASSWORD` in the dashboard stack too, set to the
same value as the minecraft stack's. Without it, the log still shows, but
commands and the online-player list don't work.

**Stop a server before editing its files.** A running server can overwrite
`server.properties` and other config on shutdown, and changing world files
under it can corrupt them. The dashboard enforces this.
