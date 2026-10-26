# Deployment

> One container. One port. One data directory. No Kubernetes cosplay.

## Minimum requirements

- Docker 24+ (or Bun 1.4+ if running without Docker)
- ~200 MB RAM for a small instance; more for uploads/backups
- A writable `/data` volume
- No database server, Redis, object store, message queue or external service

## Docker run

```bash
docker build -t aislopmemecord:local .

docker run -d \
  --name aislopmemecord \
  --restart unless-stopped \
  -p 3000:3000 \
  -v slop-data:/data \
  aislopmemecord:local
```

Only port `3000` (HTTP + WebSocket) is exposed. The image runs as non-root `bun`.

### Compose from a checkout

```bash
git clone https://github.com/horatio42/AISlopMemeCord.git
cd AISlopMemeCord
docker compose up -d --build
```

The compose file uses a named volume `slop-data` and opens `3000`. The GitHub Actions publish job also pushes the
public `ghcr.io/horatio42/aislopmemecord:latest` image, verified with an anonymous pull and a container smoke test.

## Data directory

| Path | Contents |
|---|---|
| `/data/slop.db` (+ `-wal`, `-shm`) | SQLite database: users, servers, messages, etc. |
| `/data/uploads/YYYY/MM/` | Attachments, avatars, emoji, stickers, sounds |
| `/data/exports/` | Reserved for exports/jobs |
| `/data/secret.key` | Generated instance secret (mode 0600) |
| `/data/logs/app.log` | Application log tail shown in Slop Control → Logs & health; rotates at 5 MB |

**Use a named volume.** If you bind-mount a host directory, ensure the container's `bun` user can write to it
(e.g. `chown -R 1000:1000 ./data` on typical Linux hosts). There is no root entrypoint chowning files for you,
because running your chat server as root is a bad trade.

## Configuration

Environment variables (also see README):

```bash
PORT=3000
SLOP_DATA_DIR=/data
SLOP_REGISTRATION=open          # open | invite | closed
SLOP_DEMO_SEED=true             # seed demo world for the first admin
SLOP_MAX_UPLOAD_MB=25
SLOP_SECURE_COOKIES=false       # true behind HTTPS
SLOP_TRUST_PROXY=false          # true behind a trusted reverse proxy
SLOP_STUN_URLS=                 # optional comma-separated STUN URLs
SLOP_HOST=0.0.0.0
SLOP_LOG_LEVEL=info
```

Changing registration settings in **Slop Control → Instance settings** overrides the initial env value and is
stored in the database.

## HTTPS / reverse proxy

Terminate TLS in front of the container. Only one upstream is needed; WebSockets are on the same port.

### Caddy

```caddyfile
slop.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Set `SLOP_SECURE_COOKIES=true` when HTTPS is terminated by the proxy.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name slop.example.com;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

If you trust the proxy, set `SLOP_TRUST_PROXY=true`. Do not enable it when exposing the container directly to the
internet; clients could spoof IPs.

## First boot & admin

1. Start the container.
2. Open `http://host:3000`.
3. Register. The **first account** becomes instance admin and receives the seeded demo world (unless `SLOP_DEMO_SEED=false`).
4. Go to `/admin` for Slop Control.
5. Configure registration mode, MOTD, upload limits and features.

### Registration modes

| Mode | Behavior |
|---|---|
| `open` | Anyone can register. |
| `invite` | Account invite code required. Generate codes in Slop Control → Invites. |
| `closed` | No new registrations. Existing users can log in. |

Server invites are separate from **account invites**: server invites let existing users join a server; account
invites let new users create accounts on an invite-only instance.

## Backups

### Admin backup (recommended)

Slop Control → Backup & maintenance → **Download backup**. The ZIP contains a consistent SQLite snapshot
(`VACUUM INTO`), `manifest.json` and sanitized `settings.json`. Toggle **include media** to also include uploads.

### Volume backup

Stop the container for a completely consistent copy, then archive the whole volume:

```bash
docker stop aislopmemecord
docker run --rm -v slop-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/aislopmemecord-$(date +%F).tar.gz -C /data .
docker start aislopmemecord
```

Restore by extracting into an empty volume before starting. Never restore a newer schema into an older app
version; restore a matching backup or run migrations with the version that created it.

### Database-only snapshot from SQLite

```bash
docker exec aislopmemecord bun -e \
  "const {Database}=require('bun:sqlite');const d=new Database('/data/slop.db');d.exec(\"VACUUM INTO '/data/backup.db'\")"
docker cp aislopmemecord:/data/backup.db ./slop.db
```

## Upgrades

```bash
git pull
docker compose up -d --build
```

If you build locally with plain Docker:

```bash
docker build -t aislopmemecord:local .
docker rm -f aislopmemecord
docker run -d --name aislopmemecord --restart unless-stopped \
  -p 3000:3000 -v slop-data:/data aislopmemecord:local
```

Migrations run automatically on startup inside a transaction, tracked by `PRAGMA user_version`. Back up first if
you have valuable slop. Downgrades are not supported.

## Resource notes

- SQLite WAL is enabled; keep `/data` on local disk, not a network filesystem.
- FTS5 search is local and fast for tens/hundreds of thousands of messages.
- Uploads are capped per purpose; adjust `SLOP_MAX_UPLOAD_MB` and reverse-proxy body limits together.
- The WebSocket hub holds presence and voice state in memory. Restarting the process drops connections; clients
  reconnect automatically and state is rebuilt.
- **Run exactly one replica.** Two containers with the same SQLite file and separate hubs will fight over writes and
  presence. Horizontal scaling is intentionally unsupported.

## Voice / NAT

Voice uses peer-to-peer WebRTC mesh. Without STUN, it works when participants can reach each other directly
(LAN or public host). For internet use behind NAT, provide a STUN URL:

```bash
-e SLOP_STUN_URLS="stun:stun.l.google.com:19302"
```

A third-party STUN server learns public IPs. For stronger privacy, self-host STUN/TURN. TURN relaying is not
implemented; if all peers are behind symmetric NAT, use a platform like Mumble/Matrix for those calls.

## Health & monitoring

```bash
curl http://localhost:3000/api/health
```

The Docker healthcheck uses the same endpoint. Admin → Logs/Health shows DB/WAL size, memory, uptime,
Bun version and log tail.

## Hardening checklist

- HTTPS everywhere + `SLOP_SECURE_COOKIES=true`
- Long unique admin password + TOTP enabled
- Registration set to `invite` or `closed` when the instance is public
- Regular backups, encrypted at rest
- Reverse proxy body limit aligned with `SLOP_MAX_UPLOAD_MB`
- Do not expose `/data`
- Patch the image; review release notes
- Remember: this is AI slop with tests, not an audited security product

## Uninstall

```bash
docker compose down
docker volume rm slop-data   # destroys everything, including your memories
```
