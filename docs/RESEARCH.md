# Research notes

> What we borrowed, what we rejected, and why the boring choice won.

This is a design memo, not a market study. No user data was collected, no competitor was scraped, and no analytics
were used to validate any of this. The research was: use the products, read their public docs, then build the
smallest thing that preserves the useful interaction.

## Shortlist

| Product | Useful idea | What we kept | What we rejected |
|---|---|---|---|
| Discord | Servers → categories → channels; role bitfields; per-channel overrides | Whole permission model, channel types, presence, voice lobby | Nitro, boosts, activity feeds, bot marketplace, client telemetry |
| Reddit | Votes change ranking; forum posts are threads; tags | Forum votes, hot/new/top, tags, post cards | Karma farming, algorithmic feed, ads, infinite recommendation |
| Slack | Threads keep side conversations out of the main channel | Threads, mentions, search scopes | Enterprise admin sprawl, app directory, paid message history |
| Teams | Channel tabs and meetings | Light inspiration for server events | Calendars, meetings, tenant/identity complexity |
| Matrix | Self-hosted federation and E2EE | E2EE for 1:1 DMs, self-hosting ethos | Federation, multiple services, device verification complexity |
| Signal | E2EE as a default, minimal metadata | E2EE cipher shape, privacy language | Phone-number identity, Signal Protocol/Double Ratchet |
| Telegram | Fast clients and local chat features | Dense chat UI, sticker/sound fun | MTProto, phone identity, cloud plaintext DMs |
| Mumble | Low-latency self-hosted voice | Mesh voice for small rooms, soundboard | Dedicated voice server, channel tree, codecs we would have to ship |

## The decisions that mattered

### One process, SQLite, one port

Discord-scale chat needs distributed gateways, sharded presence, object storage and a real message queue. A
self-hosted meme server for dozens or hundreds of people does not. SQLite in WAL mode handles concurrent reads and
serialized writes well; Bun serves HTTP, WebSocket and static files from the same process. This removes a class of
deployment failures: no Redis to forget, no migrations service, no object-store credentials, no CORS between
services. The trade-off is explicit: one replica, no horizontal scaling, and a single-writer bottleneck under
extreme write load. That is acceptable for the target use case and documented everywhere it matters.

### Discord's permission model, not a new one

Discord's bitfield + role hierarchy + channel allow/deny overrides is familiar to users and expressive enough for
private channels, read-only announcements, moderator roles and per-user exceptions. Inventing a new ACL would add
documentation and bugs for no user benefit. The server recomputes permissions on every route; the client mirrors
them only to hide impossible actions.

### Forums as threads

Reddit-style posts and Discord-style threads are the same object with different presentation: a channel with an
origin message, tags and votes. Reusing the message pipeline gives replies, mentions, attachments, reactions,
reports and moderation for free. The forum list is a projection, not a second content system.

### E2EE where it is honest

A full Signal-style protocol (X3DH, Double Ratchet, safety numbers, device lists, encrypted attachments) is a large
project and easy to get subtly wrong. Shipping a fake "encrypted" badge would be worse than shipping a limited,
honest feature. The app uses WebCrypto ECDH P-256 + AES-256-GCM for 1:1 DMs, keeps private keys local, and states
the limits: static keys, no forward secrecy, no group E2EE, no key verification UI. Group DMs and attachments remain
plaintext and are labeled as such.

### Voice as a mesh

An SFU is the right answer for large calls and poor networks; it is also another service, another port and another
privacy surface. WebRTC mesh works well for small friend-group voice channels on a LAN or reachable host. The
server relays only signaling. No TURN means symmetric NAT can fail; operators can add STUN, and the limitation is
documented instead of hidden.

### No external anything

Every `<img>`, font, sound and stylesheet is bundled. CSP is `default-src 'self'`. Markdown links are plain links
and do not unfurl. This removes third-party requests, cookie leakage, font licensing surprises and a whole category
of supply-chain risk. It also means no Gravatar, no link previews and no CDN performance tricks, which is fine for a
single-container app.

### Safe Markdown, not HTML

A Discord clone needs bold, code, quotes, spoilers, mentions and images. It does not need raw HTML. The renderer
tokenizes a constrained subset and returns Preact VNodes. There is no `dangerouslySetInnerHTML`, no HTML parser
dependency and no sanitizer bypass surface.

### Seed the first admin, not the instance

Seeding at server startup creates a demo world even for deployments that want an empty instance. Seeding on first
admin registration gives the first human a populated product tour and never interferes with later users. Demo users
have unusable password hashes, so they cannot be logged into.

## Competitive gaps we intentionally accept

| Gap | Why it is acceptable here |
|---|---|
| No federation | Federation multiplies the threat model, identity model and moderation surface. |
| No mobile push | Push requires a third-party service or self-hosted relay; the app uses local notifications only. |
| No TURN | Extra infrastructure and a relay that sees metadata; mesh works for small groups. |
| No screen share | Needs SFU-style routing for quality and permissions; not worth a half-working implementation. |
| No DM voice | Voice is anchored to server channels and permissions; DM calls add another signaling path. |
| No Discord import | Discord exports are not a stable public API; a best-effort importer would mislead users. |
| No group E2EE | Sender keys/device management are a real protocol project, not a checkbox. |
| No horizontal scaling | SQLite + in-memory presence deliberately anchor one process. |

## What "AI slop" means in the architecture

The meme copy, fake headlines, seeded arguments and copypasta are intentionally absurd. The internals are not:
typed boundaries, migrations, transactions, permission checks, CSRF, rate limits, audit logs and integration tests.
The joke is the exterior; the engineering is the straight man.

## References used while building

Primary sources, not benchmarks:

- Discord Developer Docs: permissions, channel types, gateway intents (concepts only; no Discord API calls).
- Reddit help: voting and post ranking concepts (we implement a simple hot score, not Reddit's exact formula).
- Matrix Spec: Olm/Megolm concepts and the difficulty of device verification (we did not implement Olm).
- MDN Web Crypto and WebRTC API documentation.
- SQLite documentation: WAL, FTS5, `VACUUM INTO`.
- Bun documentation: `Bun.serve`, `bun:sqlite`, password hashing, bundler.
- OWASP guidance for CSRF, session handling, file upload validation and content security policy.

No code was copied from Discord, Reddit, Slack or Matrix. The permission constants, DTO names and interaction
patterns are inspired by public product behavior and public documentation.
