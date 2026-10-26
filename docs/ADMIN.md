# Slop Control — instance administration

> A separate, deliberately corporate web interface for managing the entire instance.
> Located at **`/admin`**. Your neon is confiscated at the door.

## Access

- You must be logged in as an **instance admin** (`users.is_admin = 1`).
- The first account registered on a fresh instance becomes admin.
- Existing admins can promote/demote others in **Users**.
- The interface shares the session cookie with the chat app but every `/api/admin/*` route checks `is_admin`
  server-side. There is no separate password or hidden admin port.

If you open `/admin` without a session, you get a login card. If you are logged in but not an admin, you get a
polite (meme-laced) 403 and a link back to chat.

> **Safety rails:** you cannot delete your own account, disable/demote the last active admin, or ban yourself into
> a lockout. All admin writes are written to the global audit log with `server_id = NULL`.

## Dashboard

The overview shows:

- counts: users, servers, messages, channels, uploads, open reports, active sessions
- online connections
- storage used by uploads/attachments
- 14-day signup and message bar charts
- top servers by member count
- recent global audit entries
- health: DB/WAL size, memory, uptime, Bun version

Refresh at any time. Numbers are direct SQL COUNTs, not cached vanity metrics.

## Users

Search by username/display name; filter all/admin/banned/disabled; paginate. Each row can open a detail panel.

Actions:

| Action | Effect |
|---|---|
| Promote / demote admin | Toggles `is_admin` with last-admin protection |
| Disable / enable | Blocks login and invalidates access; sessions may need revoking |
| Suspend until + reason | Temporary account ban (login blocked until time) |
| Reset password | Generates a 16-char random password, revokes sessions, shows it **once**; copy it before closing |
| Revoke sessions | Logs the account out everywhere |
| Edit display name/bio | Correct abusive profiles; usernames are immutable |
| Delete user | Hard delete with DB cascades; blocked for yourself |

Admin views never expose password hashes, TOTP secrets, session tokens or private keys.

## Servers & channels

- Search/list all servers with owner, member/channel/message counts and visibility.
- Open a server to inspect its channels, roles, owner, invites and counts.
- Rename/edit description/visibility/NSFW; transfer ownership to a valid member (membership is created if needed).
- Delete a server with confirmation; members receive a realtime `SERVER_LEAVE`.
- Delete individual channels or edit name/topic/NSFW/locked/slowmode.

## Reports

Reports come from **Report message** in the chat UI. Anonymous to the reported user; reporter identity is visible
to moderators/admins.

Resolve with:

- **Dismiss** — no action.
- **Delete message** — soft-deletes the reported message.
- **Timeout** — sets a timeout for the author (duration configurable).
- **Ban** — server ban for the author (documented reason).
- **Resolve only** — close with a note and no punitive action.

Resolution notes are stored; the reporter receives a notification. Encrypted DMs are shown as ciphertext/privacy
placeholders. Do not ask admins to decrypt them; the plaintext is not on the server.

Per-server moderation queues also exist inside server settings (requires appropriate server permissions), and the
instance admin console can see all open reports across servers.

## Audit log

Global, filterable by server, actor and free-text query. Actions include server/channel/role changes, member
moderation, message deletion, report resolution, admin user/server actions, settings changes, asset uploads,
maintenance and account invites. Changes are stored as JSON and expandable in the UI. Entries are append-only from
the application's perspective; there is no delete endpoint.

## Invites

Two different concepts:

- **Server invites** — codes that let an existing user join a server. List/revoke globally.
- **Account invites** — codes that let a **new user register** when registration mode is `invite`. Create with
  optional max uses and expiry; revoke any time. Uses are counted; individual attribution is not stored.

Registration mode is configured in Instance settings. `open` needs no code; `closed` rejects all new accounts.

## Instance settings

Editable settings:

| Key | Notes |
|---|---|
| Instance name / description / MOTD | Displayed on landing, README-ish metadata and home |
| Registration | `open`, `invite`, `closed` |
| Max upload MB | 1–500; coordinate with reverse proxy body limit |
| E2EE, voice, soundboard, forums, webhooks | Feature toggles for the instance |
| Public discovery | Allows public servers to appear in Discover |
| Meme mode / Slop of the Day | Cosmetic instance flavor |

Settings are stored in SQLite and audited. Secrets (`secret.key`, admin tokens) are never included in the settings
API response. Changing features is immediate for new UI loads; disabling E2EE does not decrypt existing ciphertext.

## Assets

- View global and per-server emojis, stickers and sounds.
- Upload global emoji (uploaded with purpose `emoji`).
- Delete assets by type. Server-specific assets can also be managed in server settings by users with permissions.

Deleted asset rows disappear; existing messages referencing them render the fallback name/emoji.

## Backup & maintenance

- **Download backup** — ZIP with a consistent SQLite snapshot (`VACUUM INTO`), manifest and sanitized settings.
  Optional media inclusion. No `secret.key`, no raw session tokens (only hashes inside the DB snapshot).
- **Maintenance actions** — `VACUUM`, WAL `checkpoint`, prune old login attempts, cleanup orphan uploads without
  attached messages.
- **Logs / health** — tail the rotating `/data/logs/app.log` plus health stats. Docker logs remain the primary source.
- **Announcement** — sends a notification to every non-disabled user. It does not DM users or post to all servers.

Protect downloaded backups: they contain password hashes, session hashes, messages and possibly media.

## What admins can and cannot see

**Can:** manage accounts/servers, read server-channel content, see reported message context, see unencrypted DM
content via database tooling (but not through a convenient admin route), see metadata and reports.

**Cannot:** read E2EE DM plaintext, access users' browser private keys, bypass account/session protections, or
recover deleted accounts. Admin actions are audited and visible in the console.

## Operational playbook

1. **Compromised account** — disable, revoke sessions, reset password, then hand the temp password to the owner via
   a trusted channel. Check audit for admin actions.
2. **Spam wave** — delete messages/purge the channel, timeout/ban authors, set server account registration to
   invite-only globally if needed, use `cleanup_orphan_uploads` only after investigating.
3. **Abusive admin** — another admin demotes/disables them, revokes sessions, rotates secrets if exposed; check
   audit log. (If the only admin is compromised, restore from backup/DB access.)
4. **Storage pressure** — clean orphan uploads, remove old channels/servers, inspect DB/WAL size, expand volume,
   consider lowering upload caps.
5. **Upgrade** — back up first, then pull/rebuild. Migrations run automatically; downgrades are unsupported.
