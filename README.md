<div align="center">

<img src="src/assets/brand/mascot.svg" alt="The Slop Goblin" width="150" />

# AISlopMemeCord

**Discord, but it fell into the slop pit.**

A privacy-first, meme-drenched, single-container chat platform. Servers, voice, forums, threads, DMs,
custom emoji, WebRTC audio, an admin console, and a truly irresponsible amount of AI slop.
No telemetry. No cloud. No adults.

[![CI](https://github.com/horatio42/AISlopMemeCord/actions/workflows/ci.yml/badge.svg?branch=main)](.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-b8ff35.svg)](LICENSE)
[![One Container](https://img.shields.io/badge/deploy-one%20container-ff9f1c.svg)](#quick-start)
[![Tests](https://img.shields.io/badge/tests-85%20passing-57d98a.svg)](#testing)
[![Telemetry](https://img.shields.io/badge/telemetry-zero-ff5d5d.svg)](docs/PRIVACY.md)
[![AI Slop](https://img.shields.io/badge/AI%20slop-100%25-b58cff.svg)](docs/AI_SLOP.md)

</div>

![AISlopMemeCord chat screenshot](screenshots/03-chat.png)

---

## What is this?

AISlopMemeCord is a fully functional Discord clone built out of pure AI slop and poor impulse control.
It runs as **one Bun process in one Docker container**, stores **everything** in `/data`, exposes **one port**,
and never phones home. It looks like Discord fell into a neon dumpster behind a Reddit server and decided to stay.

It is **not** a serious product. It is a real chat application with real permissions, real WebRTC audio,
real tests and a real admin console. Both things can be true.

## Why would anyone build this?

- To prove a chat app does not need 47 microservices, a Kubernetes cluster and three SaaS vendors.
- To have a Discord clone that does not require an email address, phone number, or soul.
- To make the frontend deliberately weird: Slop Points, awards, copypastas, a soundboard, a local AI-ish
  slop generator, forum boards with Reddit-style votes, and achievements for touching grass.
- Because "AI slop" is a badge of honor, not an apology.

## Features

| Area | What works |
|---|---|
| **Servers** | Public/private servers, categories, channels, invites, discovery, transfer ownership, leave/delete |
| **Channels** | Text, voice, forums, announcements, categories, threads, slowmode, NSFW flags, reordering |
| **Permissions** | Discord-style role bitfields, @everyone roles, per-channel role/user allow/deny overrides, role hierarchy |
| **Messages** | Markdown, replies, edit/delete, pins, bookmarks, attachments, spoilers, mentions, typing indicators, purge |
| **Reactions & voting** | Unicode + custom emoji reactions, upvote/downvote Slop Points, awards, karma leaderboard |
| **Polls** | Single/multiple choice, timed polls, anonymous-ish aggregate results |
| **Threads & forums** | Message threads, side-panel threads, Reddit-style forum posts with tags, hot/new/top sorting |
| **Search** | SQLite FTS5 full-text search with channel/server/author/has filters; permission-safe |
| **DMs & friends** | 1:1 and group DMs, friend requests/accept/decline/block, per-conversation unread counts |
| **E2EE** | Optional client-side end-to-end encryption for 1:1 DMs (ECDH P-256 + AES-256-GCM) |
| **Voice** | WebRTC mesh voice channels, mute/deafen, speaking detection, participant UI, soundboard |
| **Presence** | Online/idle/DND/invisible, custom status, typing, multi-tab connections |
| **Customization** | Custom emoji, stickers, sounds, five themes, compact mode, large text, reduced motion |
| **Moderation** | Kick, ban, timeout, warnings, message purge, reports queue, moderation rules, audit logs |
| **Admin console** | Separate `/admin` SPA: users, servers, reports, audit, invites, instance settings, assets, backups |
| **Privacy** | No telemetry, no external requests, Argon2id, TOTP 2FA, session revoke, data export, hard delete |
| **Meme tech** | Slop meter, copypasta machine, offline slop generator, achievements, soundboard, original meme art |

**Deliberately not included:** Nitro, paywalls, ads, engagement algorithms, email marketing, "AI features" that
send your messages to a third party, or anything requiring an external account.

## Quick start

### Docker (the intended way)

```bash
git clone https://github.com/horatio42/AISlopMemeCord.git
cd AISlopMemeCord
docker compose up -d --build
```

Or build the image directly:

```bash
docker build -t aislopmemecord:local .
docker run -d \
  --name aislopmemecord \
  -p 3000:3000 \
  -v slop-data:/data \
  aislopmemecord:local
```

The included GitHub Actions workflow publishes `ghcr.io/horatio42/aislopmemecord:latest` on pushes to `main`.
Use it instead of the local build if the package is public:

```bash
docker run -d \
  --name aislopmemecord \
  -p 3000:3000 \
  -v slop-data:/data \
  ghcr.io/horatio42/aislopmemecord:latest
```

Open **http://localhost:3000**. The first account you register becomes the instance admin and receives a
fully seeded demo server (because staring at an empty chat app is for cowards).

> **Only one port is exposed: 3000.** SQLite, uploads, sessions, exports and your secret key all live in `/data`.
> Use a named volume (as above). If you bind-mount a host directory, make sure it is writable by the container user.

### No Docker? Bun is enough

```bash
bun install
bun run build
SLOP_DATA_DIR=./data bun run start
```

Requires Bun ≥ 1.4. No database server, no Redis, no reverse proxy required for local use.

### First five minutes

1. Register the first account → you are the admin.
2. You land in **The Slop Pit**, a seeded demo server. Run wild or delete it.
3. Open **Slop Control** at [`/admin`](http://localhost:3000/admin) for instance management.
4. Hit `Ctrl/Cmd + K` for the quick switcher and `/` to focus the message box.
5. Try `/poll`, `/slop`, `/meme`, `/8ball`, or the copypasta button. Try the soundboard in voice.

## Screenshots

| Landing | Chat |
|---|---|
| ![Landing](screenshots/01-landing.png) | ![Chat](screenshots/03-chat.png) |

| Forum board | Server settings |
|---|---|
| ![Forum](screenshots/05-forum.png) | ![Server settings](screenshots/08-server-settings.png) |

| Admin console | Mobile |
|---|---|
| ![Admin](screenshots/09-admin.png) | ![Mobile](screenshots/18-mobile.png) |

More in the [screenshot gallery](screenshots/README.md) and the [guided tour](docs/TOUR.md).

## The stack (aggressively boring)

```
┌─────────────────────────────────────────────────────┐
│ One Docker container · port 3000                     │
│                                                     │
│  Bun runtime                                        │
│   ├─ Bun.serve  HTTP + WebSocket + static assets    │
│   ├─ TypeScript backend (routes → services → repos) │
│   ├─ SQLite (WAL, FTS5) at /data/slop.db            │
│   ├─ Uploads + exports + secret key at /data        │
│   └─ Preact SPA (client + separate admin bundle)    │
│                                                     │
│  No external services. No CDN. No telemetry.        │
└─────────────────────────────────────────────────────┘
```

- **Runtime:** [Bun](https://bun.sh) + TypeScript.
- **Database:** SQLite via `bun:sqlite`, schema migrations on startup.
- **Frontend:** Preact + a hand-rolled reactive store + JSX, bundled by Bun.
- **Realtime:** native WebSocket gateway with presence/typing/voice signaling.
- **Media:** multipart uploads to `/data/uploads`, streamed back with permission checks.
- **Voice:** browser-native WebRTC mesh + server relay for signaling only.
- **Dependencies:** Bun, SQLite, Preact, fflate. That's basically it.

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full internal design.

## Privacy in one paragraph

No analytics, no telemetry, no external HTTP requests from the browser or server, no third-party fonts or CDNs.
Passwords are Argon2id. Sessions are opaque, hashed at rest and revocable. Optional TOTP 2FA. Optional client-side
E2EE for 1:1 DMs. One-click full data export and hard account deletion. The CSP forbids external scripts and connections.
The host you run it on is the only party that can read unencrypted data. Read the honest details in
[PRIVACY.md](docs/PRIVACY.md).

## Admin console

A separate, deliberately colder web interface at `/admin`:

- Dashboard with users/servers/messages/storage/report stats and 14-day charts
- User administration: promote/demote, suspend, reset passwords, revoke sessions, delete
- Server management: inspect channels/roles, transfer owner, close server
- Report queue with actions: delete message, timeout, ban, dismiss
- Global audit log, invite management, account invite codes
- Instance settings: registration mode, upload limit, feature toggles, MOTD, meme mode
- Asset management, backup download (DB + optional media), maintenance tasks, logs/health
- Announcements to every user

Default protection: only accounts with `is_admin` can enter; the last admin cannot be removed or disabled.
See [ADMIN.md](docs/ADMIN.md).

## Configuration

All configuration is environment variables; defaults are safe and zero-config.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket port |
| `SLOP_DATA_DIR` | `./data` (`/data` in Docker) | SQLite, uploads, exports, secret key |
| `SLOP_REGISTRATION` | `open` | Initial mode: `open`, `invite`, `closed` (admin can change later) |
| `SLOP_DEMO_SEED` | `true` | Seed the demo world for the first admin |
| `SLOP_MAX_UPLOAD_MB` | `25` | Per-file upload cap (1–500) |
| `SLOP_SECURE_COOKIES` | `false` | Set `true` when served over HTTPS |
| `SLOP_TRUST_PROXY` | `false` | Trust `X-Forwarded-For` behind a proxy |
| `SLOP_STUN_URLS` | empty | Optional comma-separated STUN URLs for voice NAT traversal |
| `SLOP_HOST` | `0.0.0.0` | Bind address |
| `SLOP_RATE_LIMIT` | `true` | In-process request rate limiting |
| `SLOP_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for HTTPS, backups, upgrades and limits.

## Examples

```bash
# Health check
curl http://localhost:3000/api/health

# Public instance info (no auth)
curl http://localhost:3000/api/instance

# Log in and call the API with the session cookie
curl -c cookies.txt -H 'content-type: application/json' \
  -d '{"username":"yourname","password":"yourpassword"}' \
  http://localhost:3000/api/auth/login

curl -b cookies.txt http://localhost:3000/api/servers

# Webhook-style post after creating a server webhook in the UI
curl -X POST http://localhost:3000/api/webhooks/<webhook-id>/<token> \
  -H 'content-type: application/json' \
  -d '{"content":"hello from curl, I guess"}'
```

The full API surface and WebSocket protocol are documented in [API.md](docs/API.md).

## Testing

```bash
bun test                 # API + websocket + permission + security integration tests
bunx tsc --noEmit        # strict typecheck
bun run build            # production bundle
bun run screenshot       # boot a throwaway instance and regenerate screenshots
```

The suite covers auth/CSRF/registration modes, server/channel/invite permissions, roles/hierarchy,
messages/reactions/votes/polls/threads/forums/search privacy, DMs/friends/notifications, media sanitization and
traversal, admin safety rails, the seeded world, voice signaling and WebSocket realtime events.

> Tests run against real HTTP servers and real SQLite databases in temp directories. No mocks of the app.

## Documentation

- [Quickstart](docs/QUICKSTART.md) — from zero to slop in one command
- [Feature tour](docs/FEATURES.md) — every feature, with screenshots
- [Architecture](docs/ARCHITECTURE.md) — layers, data model, realtime, permissions, E2EE, voice
- [API reference](docs/API.md) — REST + WebSocket, auth, CSRF, examples
- [Deployment](docs/DEPLOYMENT.md) — Docker, HTTPS, backups, resource notes
- [Admin guide](docs/ADMIN.md) — Slop Control
- [Privacy model](docs/PRIVACY.md) — what is protected, what is not, threat model
- [Research notes](docs/RESEARCH.md) — what we stole from Discord, Reddit, Teams, Slack, Matrix, Telegram
- [Development](docs/DEVELOPMENT.md) — repo layout, conventions, adding endpoints
- [Troubleshooting](docs/TROUBLESHOOTING.md) — "it broke" flowcharts
- [AI Slop Manifesto](docs/AI_SLOP.md) — why this exists and why we are not sorry
- [Contributing](CONTRIBUTING.md) — setup, conventions, tests and the definition of done
- [Security policy](SECURITY.md) — reporting and threat-model boundaries
- [Changelog](CHANGELOG.md) — what shipped in the slop release

## FAQ

**Is this actually secure?** It is a serious application with a serious baseline: Argon2id, CSRF/origin checks,
strict CSP, rate limits, sanitized uploads, permission checks on every route, and tests. It is not audited by a
security firm. Use TLS, strong admin passwords, and 2FA if exposed to the internet. See [PRIVACY.md](docs/PRIVACY.md).

**Is it really one container?** Yes. No external DB, cache, object store or worker.

**Does it phone home?** No. There is no telemetry code and the CSP blocks external network requests. Fonts and
memes are bundled. You can run it with the network firewall closed and everything still works except optional
STUN for voice.

**Can I migrate from Discord?** Not automatically. The data model is close enough that an import script would be
straightforward; PRs welcome. Bring memes.

**Why is the code so weird?** It was vibe-coded by an AI agent under human supervision, with tests and a design
system. The weirdness is a feature; the tests are not optional.

**Why "AISlopMemeCord"?** Because naming things is hard and "Slop" is the most honest description of the last
two years of the internet.

## Contributing

Yes, please. Read [CONTRIBUTING.md](CONTRIBUTING.md). The house style is: boring internals, unhinged copy,
tests for behavior, no new dependencies without a good reason.

## License

MIT. See [LICENSE](LICENSE). Meme art is original vector work generated for this project; fonts are self-hosted
open-source files. No copyrighted meme images are bundled.

---

<div align="center">
  <img src="src/assets/memes/this-is-slop.svg" alt="This is slop" width="420" />
  <br />
  <strong>Built by goblins. Tested by goblins. Used by you.</strong>
  <br />
  <sub>If you are reading this at 3am, close the tab. Touch grass. The slop will wait.</sub>
</div>
