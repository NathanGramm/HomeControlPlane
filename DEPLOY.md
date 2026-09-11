# Deploying Home Control Plane

You're SSHed into the server, not sitting at it — GitHub as the handoff is
the right call. Here's the full path from what's on your local machine now
to it running behind NPM.

## 1. Push this to GitHub

From wherever you unzipped the project on your own machine:

```
cd home-control-plane
git init
git add .
git commit -m "Phase 1: skeleton, service tiles, vitals"
```

Then either with the `gh` CLI:

```
gh repo create home-control-plane --private --source=. --remote=origin --push
```

or manually: create an empty **private** repo on GitHub first, then

```
git remote add origin git@github.com:<you>/home-control-plane.git
git push -u origin main
```

Private, since this repo will end up describing your internal network
layout (hostnames, container names) even before any real secrets show up
in Phase 3.

## 2. Get it onto the server

Two ways — pick whichever fits how you already manage your stack.

**Option A — Portainer's git-based stack (worth knowing about, since
you're already Portainer-centric):** Stacks → Add stack → Repository. Point
it at your GitHub repo URL and the compose file (rename or copy
`docker-compose.snippet.yml` to `docker-compose.yml` at the repo root
first). Portainer clones and deploys it for you directly — no SSH needed at
all, and updates later are a "Pull and redeploy" button instead of manual
git commands.

**Option B — manual, over SSH, if you'd rather see the compose file
sitting alongside your others:**

```
ssh <you>@<server>
cd ~/docker              # wherever your other compose stacks live
git clone git@github.com:<you>/home-control-plane.git
cd home-control-plane
cp docker-compose.snippet.yml docker-compose.yml
# or merge the `home-control-plane` service into your existing compose file
```

## 3. Point it at your real services

Edit `server/config/services.json` — swap the placeholder hostnames
(`portainer.marshmallowmc.com` etc.) for your actual Pi-hole entries. Do
this before the push in step 1, or directly on the server afterward —
either way, it's a data file, not code, so no rebuild logic depends on it.

## 4. Build and run

```
docker compose up -d --build
```

(In Portainer: redeploying the stack after an edit does the same thing.)

## 5. Wire up Nginx Proxy Manager

- New Proxy Host → domain `dash.marshmallowmc.com` → forward to
  `home-control-plane:3000` (the container name and port from the compose
  file), same pattern as your other services.
- Access Lists → new list with basic auth (a username/password) → attach it
  to this proxy host.

## 6. Pi-hole

Add a local DNS record: `dash.marshmallowmc.com` → your server's LAN IP.

## 7. Test

From a Tailscale-connected device, visit `https://dash.marshmallowmc.com` —
you should hit the NPM basic-auth prompt first, then the dashboard.

## Updating later

```
git pull
docker compose up -d --build
```

Or, on Portainer's git-stack option, just "Pull and redeploy" in the stack
view — no SSH required after the initial setup. This is the pattern for
every phase from here on.

## A note on secrets

Nothing in Phase 1 needs one. Phase 3 (Firefly III) will need an API
token, and it should never land in a committed file — a `.env` file
(already excluded via `.gitignore`) read through `process.env` is the
pattern to reach for when that comes up, not a hardcoded value in
`services.json` or anywhere else in the repo.
