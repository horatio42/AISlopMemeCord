# Changelog

All notable changes to AISlopMemeCord. The project follows a pragmatic semantic versioning: major for breaking API
or data changes, minor for features, patch for fixes. There is only one initial release at the time of writing.

## [1.0.0] — 2026-10-26

The "certified organic free-range slop" release.

### Added

- Single-container Bun application with one exposed port serving the user SPA, admin SPA, REST API, WebSocket
  gateway and static assets.
- SQLite persistence with WAL, migrations, FTS5 search, consistent backup snapshots and all state under `/data`.
- Username/password accounts, Argon2id hashing, session revocation, TOTP 2FA, account export and hard deletion.
- First-user instance admin, seeded **The Slop Pit** demo world for the first admin, invite-only and closed
  registration modes.
- Servers, categories, text/voice/forum/announcement channels, threads, invites, discovery and ownership transfer.
- Discord-style permission bitfields, roles, hierarchy, channel allow/deny overrides and server-side enforcement.
- Messages with safe Markdown, replies, edits, deletes, pins, saves, attachments, spoilers, mentions, typing and
  bulk purge.
- Reactions, custom emoji, upvotes/downvotes, Slop Points, awards, leaderboards and achievements.
- Polls with multiple choice, optional close time and live aggregate results.
- Reddit-style forum boards with tags, hot/new/top sorting, posts, votes, replies and archive/lock states.
- Full-text search scoped by channel/server, author, attachment type and date, with UI operators.
- 1:1 and group DMs, friends, blocks, notifications and presence/custom status.
- Optional 1:1 E2EE using WebCrypto ECDH P-256 + AES-256-GCM, local private keys, backup/import and honest limits.
- WebRTC mesh voice channels with mute/deafen, speaking indicators, participant UI and soundboard.
- Moderation: kick, ban, timeout, warnings, reports, automod rules, audit logs and bulk message deletion.
- Separate admin SPA at `/admin`: dashboard, users, servers, reports, audit, invites, instance settings, assets,
  backups, maintenance, logs/health and announcements.
- Custom server assets (emoji, stickers, sounds), events with RSVPs, webhooks with hashed tokens.
- Five local themes, compact mode, large text, reduced motion, responsive mobile drawers and bottom-sheet modals.
- Dockerfile, Compose file, healthcheck, CI (typecheck, tests, build, container build, optional ghcr publish),
  screenshot automation and complete documentation.
- Integration suite: 85 tests / 1,522 assertions across auth, users, servers, members, messages, DMs, media, admin,
  seed and voice.

### Security

- Strict CSP and security headers, no external requests or telemetry.
- Cookie sessions with CSRF double-submit and origin checks.
- Magic-byte upload validation, active-content rejection, SVG sanitization and path traversal protection.
- Rate limits, admin-only APIs and last-admin safety rails.
- Audit logs for destructive and permission-changing operations.

### Known limitations

- One process / one replica; no horizontal scaling or federation.
- E2EE is 1:1 only, static keys, no ratchet, no group E2EE, no key verification UI, attachments not encrypted.
- Voice is a WebRTC mesh with no built-in TURN, recording, transcription, screen share or DM calls.
- No Discord import, email/push/OAuth, bot marketplace or native apps.
- Uploads do not automatically strip EXIF.
- No auditing by an external security firm.

### Documentation

- README with real screenshots, architecture, privacy, deployment, admin, API, development, research,
  troubleshooting, quickstart, feature tour and AI-slop manifesto.
- Reproduction script for every documentation screenshot.
