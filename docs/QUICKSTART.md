# Quickstart

> Goal: a running, seeded slop instance in under two minutes. No accounts, no APIs, no cloud.

## What you need

- Docker 24+ (recommended), or Bun 1.4+ if you want to run from source
- One free TCP port, by default `3000`
- A directory or named volume for `/data`
- No database server, Redis, object store, reverse proxy, email provider or browser extension

## Option A: Docker Compose (recommended)

From the repository root:

```bash
docker compose up -d --build
```

Wait for the container to become healthy:

```bash
docker compose ps
curl http://localhost:3000/api/health
```

`docker compose ps` should show `healthy`. Open <http://localhost:3000>.

The compose file exposes **only port 3000** and mounts the named volume `slop-data` at `/data`. SQLite, uploads,
exports, logs and the generated instance secret all live there.

## Option B: Docker, plain commands

```bash
docker build -t aislopmemecord:local .

docker run -d \
  --name aislopmemecord \
  --restart unless-stopped \
  -p 3000:3000 \
  -v slop-data:/data \
  aislopmemecord:local
```

Do not publish any other port. The HTTP API, WebSocket gateway, user SPA, admin SPA and static assets all share
port 3000.

## Option C: Bun, no container

```bash
bun install
bun run build
SLOP_DATA_DIR=./data bun run start
```

Production needs a completed `bun run build`; the server serves `dist/public`. For development with automatic
rebuilds, use `bun run dev` instead.

## First boot

1. Open <http://localhost:3000>.
2. Select **Register**.
3. Pick a username and password. There is no email field; this instance never asks for one.
4. The first registered account becomes the **instance admin**.
5. With the default `SLOP_DEMO_SEED=true`, that admin lands in a populated demo server called **The Slop Pit**:
   channels, forum posts, messages, a poll, reactions, votes, DMs, friends, notifications, events and a small
   soundboard are seeded. Delete it or keep it; it is ordinary data.

There are no default passwords. The first human to register owns the instance, so do this before exposing it.

## The five-minute tour

| Try this | Where |
|---|---|
| Send a message, upvote it, react | `# general` |
| Open the forum board and create a post | `# slop-board` |
| Join a voice channel and open the soundboard | `The Slop Pit VC` |
| Open the quick switcher | `Ctrl/Cmd + K` |
| Focus the message box | `/` |
| Search with `from:`, `has:`, `before:`, `after:` | `Ctrl/Cmd + F` |
| Edit your profile, theme, notifications and sessions | User panel → settings |
| Manage roles, channels, members and audit log | Server menu → Server settings |
| Manage the whole instance | <http://localhost:3000/admin> or the admin icon in the server rail |

## Invite someone

Two different invite types exist:

- **Server invite**: Server menu → **Invite people**, or the invite button in a channel header. Requires
  `CREATE_INVITES`. The demo invite code is `slop-pit`.
- **Account invite**: Slop Control → **Invites**. Only relevant when instance registration is set to `invite`.

Registration mode is **open** by default. An admin can change it later in **Slop Control → Instance settings**.

## Verify the install

```bash
# Liveness and version
curl http://localhost:3000/api/health

# Public instance info (name, registration mode, version)
curl http://localhost:3000/api/instance

# Login, preserving cookies
curl -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"username":"yourname","password":"yourpassword"}' \
  http://localhost:3000/api/auth/login

# Authenticated call
curl -b cookies.txt http://localhost:3000/api/servers
```

State-changing API calls made with cookies also need the `X-CSRF-Token` header. The browser client handles this
automatically. See [API.md](API.md).

## Where your data lives

Inside the container, everything persistent is under `/data`:

| Path | Contents |
|---|---|
| `/data/slop.db` | SQLite database, WAL and shared-memory files |
| `/data/uploads/` | Avatars, attachments, emoji, stickers, sounds |
| `/data/exports/` | Export staging |
| `/data/secret.key` | Generated instance signing secret, mode `0600` |
| `/data/logs/` | Optional application logs |

Back up the whole directory (or use the in-app backup in Slop Control). There is no data anywhere else.

## Reset a test instance

```bash
docker compose down
docker volume rm aislopmemecord_slop-data
```

Or, for a Bun run:

```bash
rm -rf ./data
bun run start
```

This destroys all users, messages and uploads. There is no undo.

## Next steps

- [Feature tour](FEATURES.md) for everything that works, with screenshots
- [Deployment](DEPLOYMENT.md) for HTTPS, backups, upgrades and resource notes
- [Admin guide](ADMIN.md) for Slop Control
- [Privacy model](PRIVACY.md) for the honest threat model
- [Troubleshooting](TROUBLESHOOTING.md) when the goblin refuses to cooperate

## Common first-run problems

| Symptom | Fix |
|---|---|
| Port already in use | Run on another host port: `-p 8080:3000`. The container still listens on 3000. |
| Page loads but assets 404 | Run `bun run build`; the server needs `dist/public`. |
| "No build found" page | Same as above. `bun run dev` builds automatically. |
| Permission denied writing `/data` | Use a named volume, or `chown` a bind mount to the container's `bun` user. |
| Registration closed unexpectedly | The mode was changed in admin settings; an existing admin can reopen it or issue account invites. |
| Healthcheck fails | Inspect `docker logs aislopmemecord`; most failures are a bad data path or missing build. |
| Voice connects but no audio across NAT | Configure `SLOP_STUN_URLS`; TURN is not included. See [DEPLOYMENT.md](DEPLOYMENT.md#voice--nat). |
