# API reference

> The same endpoints the SPA uses. Local-only, cookie-authenticated, no API keys, no external identity provider.

Base URL: `http://localhost:3000`. All application routes live under `/api`; the WebSocket gateway is
`/api/gateway`. Responses are JSON except media streams and backup ZIPs. IDs are opaque strings (`u_…`, `s_…`,
`ch_…`, `m_…`) and should never be parsed by clients.

## Authentication

Authentication uses two cookies:

| Cookie | Purpose | Flags |
|---|---|---|
| `slop_session` | Opaque session token | HttpOnly, SameSite=Lax, Secure when configured |
| `slop_csrf` | Double-submit CSRF token | Readable by the SPA |

1. `POST /api/auth/register` or `POST /api/auth/login` sets both cookies and returns the user plus `csrfToken`.
2. Send the session cookie on every authenticated request.
3. On unsafe methods (`POST`, `PATCH`, `PUT`, `DELETE`), send the CSRF token in `X-CSRF-Token`. The API also checks
   `Origin` when present.
4. `GET /api/auth/me` returns `{user, csrfToken, instance}`; if a session exists without a CSRF cookie, it issues one.

Browsers using `fetch` should include `credentials: 'same-origin'` and send JSON (`Content-Type: application/json`).
Login and registration are CSRF-exempt; the public invite preview, discovery, instance info, health and webhook
execution endpoints do not require a session.

### Cookie example

```bash
curl -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"username":"bossman","password":"password123"}' \
  http://localhost:3000/api/auth/login

CSRF=$(awk '$6 == "slop_csrf" { print $7 }' cookies.txt)

curl -b cookies.txt -H "x-csrf-token: $CSRF" \
  -H 'content-type: application/json' \
  -d '{"content":"hello from curl"}' \
  http://localhost:3000/api/channels/<channel-id>/messages
```

### Register

`POST /api/auth/register`, no auth, rate-limited.

```json
{
  "username": "bossman",
  "displayName": "Boss Man",
  "password": "at-least-8-characters",
  "accountInvite": "optional-when-registration-is-invite"
}
```

`username` must be unique (case-insensitive), 2–32 characters. Passwords have a minimum length enforced by the
server. The first ever account becomes `is_admin` and receives the demo world when seeding is enabled.

Response:

```json
{
  "user": { "id": "u_…", "username": "bossman", "displayName": "Boss Man", "…": "…" },
  "csrfToken": "…",
  "instance": { "name": "AISlopMemeCord", "version": "1.0.0-slop", "registration": "open", "e2eeEnabled": true }
}
```

### Login

`POST /api/auth/login`

```json
{ "username": "bossman", "password": "password123", "totp": "123456" }
```

`totp` is required when 2FA is enabled. Ten failed attempts from the same hashed IP within 15 minutes trigger a
15-minute lockout. Disabled accounts return `ACCOUNT_DISABLED`; suspended accounts return `ACCOUNT_SUSPENDED`.

### Errors

Every API error uses the same envelope:

```json
{
  "error": "MISSING_PERMISSIONS",
  "message": "You lack the required permission. The audacity.",
  "fields": { "channelId": "Optional field-level detail" }
}
```

Validation errors use `status: 400` and `fields`. Common statuses: `400` invalid input, `401` unauthenticated or bad
credentials, `403` permission/CSRF/origin failure, `404` missing resource, `409` conflict, `413` body/file too large,
`415` wrong content type, `429` rate limited, `500` unexpected server error. Never rely on the joke text; branch on
the stable `error` code.

### Pagination

List endpoints use `limit` and `offset`, clamped and validated server-side. Messages use cursor pagination with
`before=<message-id>` and return `{messages, hasMore}`. Admin lists return `{users|servers|reports…, total, limit,
offset}`. Do not assume a maximum page size beyond the documented clamp; request smaller pages for UIs.

## Auth, instance and users

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` | Create account; first account becomes admin |
| `POST` | `/api/auth/login` | Log in, optional TOTP |
| `GET` | `/api/auth/me` | Current user, CSRF token, instance info |
| `POST` | `/api/auth/logout` | Delete current session and clear cookies |
| `POST` | `/api/auth/password` | Change password; revokes other sessions |
| `GET` | `/api/auth/sessions` | List active sessions with device metadata |
| `DELETE` | `/api/auth/sessions/:id` | Revoke one session |
| `POST` | `/api/auth/sessions/revoke-all` | Revoke every other session |
| `POST` | `/api/auth/export` | ZIP export of personal data; optional password body |
| `POST` | `/api/auth/delete` | Hard-delete account; requires password + confirmation |
| `POST` | `/api/auth/2fa/setup` | Generate a TOTP secret/otpauth URI |
| `POST` | `/api/auth/2fa/enable` | Verify a code and enable 2FA |
| `POST` | `/api/auth/2fa/disable` | Disable 2FA with password |
| `GET` | `/api/instance` | Public instance name, MOTD, registration mode, version |
| `GET` | `/api/health` | Public liveness: `{ok, uptime, version}` |
| `GET` | `/api/users/search?q=` | Search visible usernames/display names |
| `GET` | `/api/users/:id` | Public profile |
| `PATCH` | `/api/users/@me` | Update profile fields (display name, bio, avatar, banner, status…) |
| `PUT` | `/api/users/@me/presence` | Set status and custom status |
| `POST` | `/api/users/@me/keys` | Upload E2EE public JWK |
| `GET` | `/api/users/:id/public-key` | Fetch a user's E2EE public JWK |
| `GET` | `/api/users/@me/saved` | Saved messages |
| `GET` | `/api/users/@me/achievements` | Earned achievements |
| `GET` | `/api/achievements` | Achievement definitions |
| `GET` | `/api/leaderboard?period=week\|month\|all` | Karma/Slop Points leaderboard |

Profile updates accept only allow-listed fields. Upload IDs must belong to you and match the required purpose.
`publicKey` is stored as an opaque string; the server does not validate curve parameters beyond size/shape, so
clients must validate received keys (the bundled client does).

## Servers, channels and invites

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/servers` | Servers you belong to |
| `POST` | `/api/servers` | Create server with default roles/channels |
| `GET` | `/api/servers/:id` | Server bundle: server, channels, roles, member, assets |
| `PATCH` | `/api/servers/:id` | Update name/description/icon/banner/MOTD/visibility/NSFW |
| `DELETE` | `/api/servers/:id` | Delete server; owner only, confirm name |
| `POST` | `/api/servers/:id/leave` | Leave server |
| `POST` | `/api/servers/:id/transfer` | Transfer ownership |
| `POST` | `/api/servers/:id/channels` | Create channel/category |
| `PATCH` | `/api/channels/:id` | Update channel settings |
| `DELETE` | `/api/channels/:id` | Delete channel and contents |
| `PATCH` | `/api/servers/:id/channels/positions` | Reorder channels/categories |
| `PUT` | `/api/channels/:id/overrides` | Replace role/user permission overrides |
| `POST` | `/api/channels/:id/invites` | Create invite for this channel's server |
| `GET` | `/api/servers/:id/invites` | List server invites |
| `DELETE` | `/api/invites/:code` | Revoke invite |
| `GET` | `/api/invites/:code` | Public invite preview |
| `POST` | `/api/invites/:code` | Accept invite |
| `GET` | `/api/discover` | Public server discovery |
| `POST` | `/api/discover/:id/join` | Join a public server |
| `POST/GET` | `/api/servers/:id/emojis` | Create/list custom emoji |
| `DELETE` | `/api/emojis/:id` | Delete custom emoji |
| `POST/GET` | `/api/servers/:id/stickers` | Create/list stickers |
| `DELETE` | `/api/stickers/:id` | Delete sticker |
| `POST/GET` | `/api/servers/:id/sounds` | Create/list soundboard sounds |
| `DELETE` | `/api/sounds/:id` | Delete sound |
| `POST/GET` | `/api/servers/:id/events` | Create/list events |
| `PATCH/DELETE` | `/api/events/:id` | Edit/delete event |
| `POST` | `/api/events/:id/rsvp` | RSVP with `{response}` |
| `POST/GET` | `/api/servers/:id/webhooks` | Create/list webhooks |
| `DELETE` | `/api/webhooks/:id` | Revoke webhook |
| `POST` | `/api/webhooks/:id/:token` | Execute webhook (public, no CSRF) |
| `GET/POST` | `/api/servers/:id/rules` | List/create moderation rules |
| `DELETE` | `/api/rules/:id` | Delete moderation rule |

Create server body minimum: `{"name":"My Slop"}`. Optional `description`, `icon` upload ID and `template`.
Create channel body minimum: `{"name":"general","type":"text"}`. Types: `text`, `voice`, `forum`, `announcement`,
`category`, plus `thread` only through the thread endpoint. Optional: `parentId`, `topic`, `nsfw`, `slowmode`,
`votingEnabled`, `tags`, `defaultSort` (`hot|new|top`, forums only), `icon`.

Invite creation accepts `expiresInHours`/`maxUses` when supported by the service. Invite preview is safe for
logged-out users and reveals only server name/icon/member count/inviter.

### Permissions

Permissions are a Discord-like bitfield on roles, plus tri-state (`allow`/`deny`/inherit) per-channel overrides.
`@everyone` applies to members. Role position breaks ties; the owner and administrator bypass channel checks where
documented. Client-side permission checks are UX only. Every endpoint recomputes permissions from the database.

## Members, roles, moderation and audit

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/servers/:id/members` | Member list with roles/presence |
| `PATCH` | `/api/servers/:id/members/:userId` | Nickname, roles, timeout |
| `DELETE` | `/api/servers/:id/members/:userId` | Kick |
| `GET` | `/api/servers/:id/bans` | List bans |
| `POST` | `/api/servers/:id/bans/:userId` | Ban member |
| `DELETE` | `/api/servers/:id/bans/:userId` | Unban |
| `GET/POST` | `/api/servers/:id/warnings` | List/create warning |
| `DELETE` | `/api/servers/:id/warnings/:id` | Delete warning |
| `GET` | `/api/servers/:id/audit-log` | Server audit log |
| `POST` | `/api/servers/:id/roles` | Create role |
| `PATCH/DELETE` | `/api/roles/:id` | Update/delete role |
| `PATCH` | `/api/servers/:id/roles/positions` | Reorder role hierarchy |
| `GET` | `/api/servers/:id/reports` | Server report queue |
| `PATCH` | `/api/reports/:id` | Resolve server report |

Member updates accept `nickname`, `roles`, `timeoutUntil` (epoch ms or `null`). Bans accept `reason` and optional
`deleteMessageSeconds` to purge recent messages. Hierarchy rules apply: you cannot moderate a member at or above your highest
role, kick the owner, or ban someone without `BAN_MEMBERS`. The last instance admin cannot be demoted/deleted.

## Messages, forums, polls and search

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/channels/:id/messages?limit=&before=` | Message history, newest page |
| `GET` | `/api/messages/:id` | Single message plus channel |
| `POST` | `/api/channels/:id/messages` | Send message, poll, attachment, sticker, encrypted DM |
| `PATCH` | `/api/messages/:id` | Edit own message |
| `DELETE` | `/api/messages/:id` | Delete own or moderate others |
| `POST` | `/api/channels/:id/purge` | Bulk delete 1–100 messages |
| `GET` | `/api/channels/:id/pins` | Pinned messages |
| `POST/DELETE` | `/api/messages/:id/pin` | Pin/unpin |
| `PUT/DELETE` | `/api/messages/:id/reactions/:emoji` | Add/remove reaction |
| `PUT` | `/api/messages/:id/vote` | Set vote `{value: -1\|0\|1}` |
| `POST` | `/api/messages/:id/award` | Give award `{award}` |
| `POST/DELETE` | `/api/messages/:id/save` | Save/unsave |
| `POST` | `/api/messages/:id/report` | Report message |
| `POST` | `/api/channels/:id/read` | Advance read cursor |
| `POST` | `/api/channels/:id/typing` | Typing over REST fallback |
| `POST` | `/api/messages/:id/thread` | Create thread from message |
| `GET` | `/api/channels/:id/threads` | Threads for a channel |
| `PATCH` | `/api/threads/:id` | Lock/archive/rename thread |
| `POST/GET` | `/api/channels/:id/posts` | Create/list forum posts |
| `POST/DELETE` | `/api/messages/:id/poll/vote` | Vote/unvote in a poll |
| `GET` | `/api/search` | FTS5 search with filters |

### Send a message

```json
{
  "content": "certified banger",
  "replyToId": "m_optional",
  "attachmentIds": ["upl_…"],
  "poll": {
    "question": "Is cereal a soup?",
    "options": ["Yes", "No", "I am calling the police"],
    "multiple": false,
    "durationHours": 24
  },
  "stickerId": "st_optional",
  "nonce": "client-idempotency-optional",
  "tts": false
}
```

`content` is limited to 4,000 characters (8,000 for encrypted), in addition to channel permissions, locked/archived
state, slowmode and automod rules. Attachment IDs are max 10 and must be owned/unattached uploads with purpose
`attachment`. Polls need a question, 2–10 options and optional duration in hours.

Encrypted DM payload:

```json
{
  "content": "<base64 ciphertext>",
  "cryptoMeta": "{\"v\":1,\"alg\":\"A256GCM\",\"iv\":\"<base64 iv>\"}",
  "encrypted": true
}
```

The server stores this verbatim. It does not decrypt, index, search, edit through normal UI flows, or include
encrypted messages in FTS. Use only in 1:1 DMs with a recipient public key.

### Search

`GET /api/search?q=…&serverId=&channelId=&authorId=&has=image|file|link&before=&after=&limit=&offset=`

- `q` is required and max 200 characters.
- `serverId`/`channelId` restrict scope; access checks run first.
- `authorId` restricts by author.
- `has` filters by attachment/link content.
- `before`/`after` accept a message ID or a 10+ digit epoch-ms timestamp.
- Results are ordered by message ID descending and include total count and query time.
- Encrypted messages are excluded.
- FTS falls back to parameterized `LIKE` if the index/query fails; it never throws SQL into the response.

The bundled UI additionally parses `from:`, `has:`, `before:` and `after:` operators from the search box and maps them
onto these parameters.

### Read cursors and unread state

`POST /api/channels/:id/read` with optional `{messageId}` advances the read cursor and returns unread counts. The
server validates that the message belongs to the channel. For forum containers, the client should not send the first
thread message as a channel cursor; the server rejects cross-channel cursors by design.

## DMs, friends, blocks and notifications

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/dms` | Conversations with unread/last message |
| `POST` | `/api/dms` | Open 1:1 (`recipientIds:[id]`) or create group (2+ plus `name`) |
| `GET` | `/api/dms/:id` | Conversation details |
| `PATCH` | `/api/dms/:id` | Rename group or change settings |
| `DELETE` | `/api/dms/:id` | Close/leave conversation |
| `POST/DELETE` | `/api/dms/:id/members[/:userId]` | Add/remove group members |
| `GET` | `/api/users/@me/friends` | Friends, incoming, outgoing |
| `POST` | `/api/friends/:userId` | Send request |
| `POST` | `/api/friends/:userId/accept` | Accept request |
| `POST` | `/api/friends/:userId/decline` | Decline request |
| `DELETE` | `/api/friends/:userId` | Remove friend |
| `POST/DELETE` | `/api/users/:id/block` | Block/unblock |
| `GET` | `/api/notifications` | Notification inbox |
| `POST` | `/api/notifications/read` | Mark read (all or IDs) |
| `DELETE` | `/api/notifications/all` | Clear inbox |
| `DELETE` | `/api/notifications/:id` | Delete one notification |

You cannot DM a user who blocked you, add a blocked user to a group, or create a 1:1 duplicate: reopening a closed
1:1 resurrects the existing channel. Group DMs require a name (1–100 chars) and at least two recipients besides you.

## Uploads and media

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/uploads` | Multipart upload: `file` + `purpose` |
| `GET` | `/api/media/uploads/:id` | Serve upload with access checks |
| `GET` | `/api/attachments/:id` | Serve message attachment with channel checks |
| `DELETE` | `/api/uploads/:id` | Delete own unattached upload |

Purposes: `attachment`, `avatar`, `webhook_avatar`, `server_icon`, `server_banner`, `banner`, `emoji`, `sticker`,
`sound`, `event_cover`, `admin`. Files are limited by purpose (avatars 2 MB, banners 5 MB, sounds 8 MB, attachments
use `SLOP_MAX_UPLOAD_MB`). MIME is detected from magic bytes, not the client header. SVG is only accepted for emoji
and is sanitized. HTML/JS is rejected. Admin uploads are never served by the media endpoint. EXIF is not stripped.

Example:

```bash
curl -b cookies.txt -H "x-csrf-token: $CSRF" \
  -F 'purpose=attachment' -F 'file=@meme.png' \
  http://localhost:3000/api/uploads
```

## Voice and soundboard

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/channels/:id/voice` | Voice room state and participants |
| `POST` | `/api/channels/:id/voice/join` | Register voice participation |
| `POST` | `/api/channels/:id/voice/leave` | Leave voice |
| `PATCH` | `/api/channels/:id/voice/state` | Mute/deafen/speaking update |
| `GET` | `/api/channels/:id/soundboard` | Available sounds |
| `POST` | `/api/channels/:id/soundboard/:soundId/play` | Play sound to room |
| `GET` | `/api/sounds/global` | Bundled/global sounds |
| `GET` | `/api/servers/:id/voice-states` | Current participants per voice channel |

The HTTP endpoints update server-side presence; actual SDP/ICE crosses the WebSocket (`voice_signal`). Soundboard
playback is mixed into the caller's outgoing WebRTC audio; the play endpoint returns the clip URL and emits
`VOICE_SOUND` for room state. There is no server audio relay, recording or screen share. Media never passes through
the API. `SLOP_STUN_URLS` controls the
optional ICE servers returned to clients.

## Admin (`/api/admin/*`)

Every admin route requires `is_admin`. Last-admin protections apply to destructive user changes.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/overview` | Counts, online, storage, 14-day series, top servers, recent audit |
| `GET` | `/api/admin/session` | Current admin identity |
| `GET` | `/api/admin/health` | DB/WAL/memory/uptime/runtime |
| `GET` | `/api/admin/logs?lines=` | Tail of `/data/logs/app.log` |
| `GET` | `/api/admin/users?q=&filter=all\|admin\|banned\|disabled` | Paged users |
| `GET` | `/api/admin/users/:id` | User detail |
| `PATCH` | `/api/admin/users/:id` | Promote/demote, disable, suspend, reset profile fields |
| `POST` | `/api/admin/users/:id/reset-password` | Set a temporary password |
| `POST` | `/api/admin/users/:id/revoke-sessions` | Revoke all sessions |
| `DELETE` | `/api/admin/users/:id` | Hard-delete user |
| `GET` | `/api/admin/servers?q=` | Paged servers |
| `GET` | `/api/admin/servers/:id` | Server detail |
| `PATCH/DELETE` | `/api/admin/servers/:id` | Admin update/close-delete server |
| `PATCH/DELETE` | `/api/admin/channels/:id` | Admin update/delete channel |
| `GET` | `/api/admin/reports` | Global report queue |
| `POST` | `/api/admin/reports/:id/resolve` | Resolve with action and note |
| `GET` | `/api/admin/audit` | Instance audit log |
| `GET` | `/api/admin/invites` | Server invites |
| `DELETE` | `/api/admin/invites/:code` | Revoke server invite |
| `GET/POST` | `/api/admin/account-invites` | List/create account invite codes |
| `DELETE` | `/api/admin/account-invites/:code` | Revoke account invite |
| `GET/PATCH` | `/api/admin/settings` | Read/update instance settings |
| `GET/POST` | `/api/admin/emojis` | List/create instance emoji |
| `DELETE` | `/api/admin/emojis/:id` | Delete instance emoji |
| `GET` | `/api/admin/assets` | List all assets |
| `DELETE` | `/api/admin/assets/:type/:id` | Delete asset by type |
| `GET` | `/api/admin/backup?media=1` | ZIP backup: consistent DB, manifest, settings, optional media |
| `POST` | `/api/admin/maintenance` | Vacuum/checkpoint/cleanup task |
| `POST` | `/api/admin/announce` | Broadcast announcement notification |

The admin backup is generated with `VACUUM INTO` for a consistent snapshot. Treat it as sensitive: it contains
password hashes, session token hashes and message plaintext (except E2EE ciphertext).

## WebSocket gateway

Connect to `ws://localhost:3000/api/gateway` (or `wss://` behind TLS) with the session cookie. The server upgrades
only after authenticating the session. No query token is accepted.

### Server messages

```json
{ "op": "hello", "d": { "heartbeatInterval": 25000 } }
{ "op": "dispatch", "t": "READY", "d": { "user": {}, "sessionId": "…", "servers": ["s_…"], "unread": {}, "instance": {} } }
{ "op": "event", "t": "MESSAGE_CREATE", "d": { "message": {} }, "seq": 42 }
```

`READY` is sent once after `hello`. Heartbeats are client-initiated; the server replies with `{ "op": "pong" }`.
Messages on the socket are at-least-once from the client's perspective; use message IDs/nonces for deduplication.

### Client messages

```json
{ "op": "heartbeat" }
{ "op": "typing", "d": { "channelId": "ch_…" } }
{ "op": "voice_signal", "d": { "channelId": "ch_…", "target": "u_…", "kind": "offer|answer|ice", "payload": {} } }
{ "op": "voice_state", "d": { "channelId": "ch_…", "muted": true, "deafened": false, "speaking": false } }
```

Typing and voice signaling are permission-checked server-side. A signal is relayed only between participants known
to be in the same voice channel.

### Events

| Event | Meaning | Typical payload |
|---|---|---|
| `READY` | Initial snapshot | user, servers, unread, instance |
| `PING`/`PONG` | Heartbeat | timestamp |
| `MESSAGE_CREATE` | New message | `{message}` |
| `MESSAGE_UPDATE` | Edited message | `{message}` |
| `MESSAGE_DELETE` | Single delete | `{messageId, channelId, deletedBy}` |
| `MESSAGE_BULK_DELETE` | Purge | `{channelId, messageIds, deletedBy}` |
| `MESSAGE_VOTE` | Vote/score changed | message id, score, voter |
| `REACTION_ADD` / `REACTION_REMOVE` | Reaction changed | message/channel/emoji/user |
| `TYPING_START` | Typing indicator | `{channelId, user, at}` |
| `PRESENCE_UPDATE` | Status/custom status | `{userId, status, customStatus}` |
| `USER_UPDATE` | Profile changed | `{user}` |
| `CHANNEL_CREATE/UPDATE/DELETE` | Channel lifecycle | `{channel}` or `{channelId}` |
| `CHANNELS_REORDER` | Positions changed | server + order |
| `SERVER_UPDATE/JOIN/LEAVE` | Server lifecycle | server id/user id |
| `MEMBER_UPDATE/ADD/REMOVE` | Membership changed | member/server ids |
| `MEMBERS_CHUNK` | Member list chunk | members |
| `ROLE_CREATE/UPDATE/DELETE` | Role changes | role/id |
| `READ_STATE_UPDATE` | Read cursor changed | channel/unread |
| `NOTIFICATION_CREATE` | New inbox item | notification |
| `FRIEND_UPDATE` | Friend request state | friendship |
| `DM_CREATE/UPDATE` | Conversation changed | channel or channelId |
| `POLL_UPDATE` | Poll totals changed | message/poll |
| `THREAD_CREATE/UPDATE` | Forum thread changed | thread |
| `VOICE_STATE` | Join/leave/mute/deafen | participant state |
| `VOICE_SPEAKING` | Speaking indicator | user/channel/speaking |
| `VOICE_SOUND` | Soundboard played | sound/channel/user |
| `VOICE_SIGNAL` | WebRTC SDP/ICE relay | from/target/kind/payload |
| `SERVER_EVENT_UPDATE` | Event edited/RSVP | event |
| `TYPING_STOP` | Typing ended | channel/user |

Payloads are intentionally minimal and stable. Consumers must ignore unknown fields and event names. See
`src/shared/events.ts` for the canonical names.

## Rate limiting and limits

- Global per-IP limiter plus stricter buckets for login, registration, uploads, invites, reports and voice.
- JSON request bodies: 2 MB maximum (`413 BODY_TOO_LARGE`).
- Uploads: purpose-specific limits and `SLOP_MAX_UPLOAD_MB` for attachments.
- Messages: 4,000 characters (8,000 encrypted); 10 attachments; 100-message purge.
- Search: 200-character query, 100 results per page.
- Admin lists: bounded page sizes.
- Rate limits return `429` with a meme-flavored message; retry after the window, do not hammer.

## Versioning

The API and gateway ship together with the frontend; there is no separate version negotiation. `GET /api/instance`
and `/api/health` expose the build version. Breaking changes are documented in the changelog and are not expected
within a major release. Pin the Docker image or commit if you build integrations against it.
