# Deploying

Every service runs as a Portainer stack deployed straight from this repo.
Each stack is one folder in `stacks/`:

| Stack | Containers |
|-------|------------|
| [dashboard](stacks/dashboard/compose.yml) | home-control-plane, docker-socket-proxy |
| [minecraft](stacks/minecraft/compose.yml) | gtnh-minecraft, family-minecraft, their backups |
| [finance](stacks/finance/compose.yml) | firefly-db, firefly-app, firefly-cron, firefly-importer |
| [nginx-proxy-manager](stacks/nginx-proxy-manager/compose.yml) | nginx-proxy-manager |
| [pihole](stacks/pihole/compose.yml) | pihole |
| [tandoor](stacks/tandoor/compose.yml) | tandoor_db, tandoor_web |
| [media](stacks/media/compose.yml) | jellyfin |
| [rippers](stacks/rippers/compose.yml) | makemkv, handbrake |

Portainer itself runs outside any stack.

The quest board's progress lives in the `dashboard_quests_data` volume (one
JSON file). The app copies it to `/mnt/storage4t/backups/quests` once a day
and keeps the last 30. To restore, stop the dashboard, copy a
`quests-<date>.json` over `quests.json` in the volume, and start it again.

A folder with secrets has a `.env.example` listing them. Stacks that need to
reach each other by container name join the existing external Docker
network `proxy-network`.

Every named volume has a pinned `name:` that matches the volume already on
the host. Re-creating a stack under any name keeps its data.

## Adding a stack in Portainer

1. Stacks → Add stack → **Repository**.
2. Repository URL: this repo. Compose path: `stacks/<name>/compose.yml`.
3. Under **Environment variables**, add every key from that folder's
   `.env.example`. Compose refuses to start if a required one is missing.
4. Optional: turn on **GitOps updates** (polling) so a `git push` redeploys
   only the stacks whose files changed.
5. Deploy.

The minecraft stack's servers sit behind Compose profiles, so a normal
deploy doesn't create or start them. See the
[engineering notes](docs/engineering-notes.md#family-server) for how to
apply compose changes to them.

## When the reverse proxy is down

Every subdomain goes through NPM and Pi-hole. If either is down, open the
dashboard at `http://192.168.4.20:3001` instead. Each tile shows a direct
`IP:port` link under its name that bypasses both.

## Exposing a service

- Put the service on `proxy-network` in its compose file.
- Nginx Proxy Manager: new proxy host, `<name>.marshmallowmc.com` →
  scheme `http`, the **container name** and its **internal** port (e.g.
  `jellyfin:8096`, not `192.168.4.20:8096`). NPM can't reach the host's
  own IP. SSL tab: the `*.marshmallowmc.com` certificate, Force SSL, HTTP/2.
  Attach the basic-auth access list if the app has no login of its own.
  The certificate is a Let's Encrypt wildcard from a Cloudflare DNS
  challenge, and NPM renews it automatically.
- Pi-hole: local DNS record `<name>.marshmallowmc.com` → server LAN IP.
- Dashboard tile: add it to `server/config/services.json` with `url` (the
  subdomain) and `directUrl` (`http://192.168.4.20:<port>`).
- Never port-forward anything except Minecraft.

## Migrating the existing stacks to git

Portainer can't turn a web-editor stack into a git stack, so each one is
deleted and re-added from the repo. The containers are recreated; data in
named volumes and bind mounts stays.

**Before starting:** reach Portainer by IP (`https://<host-ip>:9443`), not
through NPM, since NPM goes down for a minute during its own step. Have each
stack's current secret values ready (Portainer → stack → Editor shows them).

### 1. The old dashboard stack (dashboard + minecraft + finance)

1. Stop both Minecraft servers from the dashboard and wait for *stopped*.
2. Back up the named volumes:
   ```bash
   mkdir -p ~/backups
   for v in dashboard_firefly_db_data dashboard_firefly_upload dashboard_filebrowser_data; do
     sudo docker run --rm -v "$v":/v -v ~/backups:/b alpine tar czf "/b/$v.tgz" -C /v .
   done
   ```
3. Delete the `dashboard` stack in Portainer. Check under Volumes that the
   three volumes above are still there.
4. Add the finance, minecraft and dashboard stacks, in that order.
5. Create the Minecraft containers one at a time so both never run at once:
   add `COMPOSE_PROFILES=family` to the minecraft stack, redeploy, stop the
   server from the dashboard, then do the same with `gtnh`, then remove the
   variable.
6. Open the dashboard and confirm vitals and both Minecraft tiles.

### 2. The other stacks, one at a time

For each of rippers, media, tandoor, nginx-proxy-manager, then pihole:
delete the stack, re-add it from the repo with its secrets, and check
the service works before moving on.

- **tandoor:** `TANDOOR_DB_PASSWORD` must be the old password exactly.
  Postgres only reads it when the database is first created, so a new value
  locks the app out.
- **pihole last:** while it's down, nothing on the LAN resolves names, which
  can include the server's own clone from GitHub. If the re-add fails to
  clone, set the host's DNS fallback to `9.9.9.9` and retry.
- **homepage:** isn't re-added; the dashboard replaces it. Once the
  dashboard's tiles work, delete the stack, then remove its config folder
  (`~/docker/homepage`).
- **rippers:** don't run it mid-rip. HandBrake deletes sources after
  encoding.
