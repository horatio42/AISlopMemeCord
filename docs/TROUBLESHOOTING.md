# Troubleshooting

> Start with the actual error. Most self-hosted slop problems are ports, paths, permissions or a missing build.

## First checks

```bash
docker compose ps
docker logs --tail=200 aislopmemecord
curl -i http://localhost:3000/api/health
```

For a non-Docker run, check the terminal running `bun run start` and confirm `dist/public/index.html` exists.

The public health endpoint returns `{ok, uptime, version}`. Detailed DB/media/memory counters are in Slop Control →
Logs & health (`/api/admin/health`). If the public endpoint does not respond, the process or port is the problem; if
it responds but the UI is broken, the build or browser is the problem.

## The page is blank or stuck on "booting the slop…"

1. Open DevTools → Console and Network.
2. `GET /api/auth/me` should return JSON with `user`, `csrfToken` and `instance`.
3. `GET /api/instance` should work without a session.
4. A 404 on `main-*.js` or CSS means the build is missing or stale.

```bash
bun run build
# then restart the server
```

The server serves `dist/public`; running `bun run start` without a build shows a build-missing page. `bun run dev`
builds first and watches the server. If you upgraded the source, restart after rebuilding; static files are hashed.

## "No build found"

The configured `SLOP_STATIC_DIR` does not contain `index.html`. Either build, or point the variable at the correct
directory:

```bash
bun run build
SLOP_STATIC_DIR=./dist/public bun run start
```

Inside Docker, the image expects `/app/dist/public`; do not override it unless you mount a build there.

## Port 3000 is already in use

Change only the host port:

```bash
docker run -p 8080:3000 ... aislopmemecord:local
```

The container always listens on 3000 internally. If using Compose, edit the left side of `ports`. Do not change
`PORT` unless you also change the container mapping and healthcheck.

## Permission denied writing `/data`

```
SQLITE_CANTOPEN: unable to open database file
EACCES: permission denied, mkdir '/data/uploads'
```

- **Named volume:** usually fine because Docker initializes it with the image's ownership.
- **Bind mount:** the host directory may be owned by root. The container runs as `bun`; make it writable:

```bash
sudo chown -R 1000:1000 ./data
```

The exact UID/GID can differ by image; check with `docker run --rm --entrypoint id aislopmemecord:local`.
Do not solve this by running the app as root.

## Registration is closed or requires an invite

`REGISTRATION_CLOSED` or `INVITE_REQUIRED` comes from the instance registration mode, not a bug.

1. Log in as an admin.
2. Open Slop Control → **Invites** and create an account invite code, or
3. Slop Control → **Instance settings** → set registration to `open`.

The environment variable only sets the initial mode; the database value wins after an admin changes it.

## Login fails on a fresh instance

- Registration and login are different flows. If you used the Register button, use the same username/password on
  the Login tab.
- Ten failed attempts from one IP within 15 minutes trigger a temporary lockout.
- If 2FA is enabled, the login form requires a current six-digit TOTP code.
- Disabled/suspended accounts return explicit errors; an admin must reverse those in Slop Control.

There are no default credentials. The seeded demo users cannot log in by design.

## Every POST returns "CSRF token mismatch"

The API uses a double-submit CSRF cookie plus `X-CSRF-Token`. Browser sessions work automatically. Scripts must:

1. Send `slop_session` and `slop_csrf` cookies.
2. Read the `csrfToken` from `POST /api/auth/login`, `POST /api/auth/register` or `GET /api/auth/me`.
3. Send it as `X-CSRF-Token` on unsafe methods.
4. Send an `Origin` header that matches the instance when using a browser-like client.

If you recently restarted with a new data directory, old cookies are invalid; clear them and log in again. Reverse
proxies must not strip the `Cookie` or `X-CSRF-Token` headers.

## WebSocket keeps disconnecting

- Confirm `/api/gateway` is upgraded by the proxy (`Upgrade: websocket`, `Connection: upgrade`).
- Set a long proxy read timeout; nginx examples use 3600 seconds.
- Do not cache `/api/*` responses.
- Multiple tabs are supported; closing one should not take the user offline if another tab remains.
- `SLOP_TRUST_PROXY` only affects client IP resolution, not WebSocket routing. Set it behind a trusted proxy, never
  on an internet-facing direct container.

## "I cannot see messages someone just sent"

This is almost always permissions, not realtime:

1. Does the user have `VIEW_CHANNEL` and `READ_MESSAGE_HISTORY`?
2. Is a channel override denying the role/member?
3. Is the channel locked or the thread archived?
4. Is slowmode active?
5. If it is a DM, check that neither side blocked the other and the conversation is not closed.

The server filters realtime audiences per channel. An admin bypass does not magically subscribe a normal user.

## Uploads fail

| Error | Cause |
|---|---|
| `413 FILE_TOO_LARGE` | Purpose limit or `SLOP_MAX_UPLOAD_MB`; reverse proxy body limit may be lower |
| `415 UNSUPPORTED_MEDIA_TYPE` | Use multipart/form-data with `file` and `purpose` |
| `SVG is only allowed for custom emoji` | SVG uploads are restricted; use PNG/WebP for avatars/banners |
| `HTML/JS rejected` | Magic-byte validation rejected active content |
| `UPLOAD_IN_USE` | Detach the file from its message before deleting the upload |
| 404 on media | Missing upload, wrong attachment ID, or no permission to the message/channel |

Admin uploads use purpose `admin` and are intentionally not served by the public media endpoint.

## Voice connects but audio is missing

1. Grant microphone permission and check the OS input device.
2. Verify both participants joined the **same** voice channel.
3. If the server host has no public route between peers, configure STUN:

```bash
-e SLOP_STUN_URLS="stun:stun.l.google.com:19302"
```

4. Symmetric NAT without TURN will fail. TURN is not implemented. Put both peers on the same LAN, use a
   directly reachable host, or use another voice tool for that call.
5. Check the browser console for ICE failures. The server only relays signaling; it cannot hear audio.
6. No screen share or DM voice exists; those controls should not appear.

## E2EE messages show a lock but no text

- The recipient's public key may be missing. Both users must open the app once so the client uploads a public JWK.
- The private key lives in that browser's `localStorage` under `slop-e2ee-private-<userId>`. Clearing site data
  loses the ability to decrypt old messages.
- Import a backup from Settings → Privacy & data → E2EE key backup.
- Group DMs and attachments are not encrypted.
- Encrypted messages are immutable in the UI and excluded from search; this is intentional.
- A key mismatch after importing is usually a different account or browser profile.

## Search returns nothing

- Search is permission-scoped. A private channel or foreign DM will never appear.
- Encrypted messages are excluded.
- FTS5 matches tokens/prefixes, not arbitrary substrings in every case; the fallback uses `LIKE` if FTS fails.
- `from:` needs a username or display name visible in your current workspace.
- `has:file` means an actual attachment; a link does not count. Use `has:link`.
- Check the scope chips: **This channel**, **This server**, **Everything**.

## Admin console returns 403 or redirects

Only accounts with `is_admin` may use `/admin` and `/api/admin/*`. The first registered account is admin. Promote
another account from Slop Control → Users. The last admin cannot be demoted, disabled or deleted; this is a safety
rail, not a permission bug.

## Backups, logs and maintenance

- Admin backup ZIP contains a `VACUUM INTO` DB snapshot, manifest, settings and optional media.
- Logs are written to `/data/logs/app.log`, rotate at 5 MB, and are tailed in Slop Control → Logs & health.
- Maintenance tasks may checkpoint WAL/vacuum; run backups first.
- Restoring a database created by a newer schema into an older binary is unsupported.
- For a fully consistent volume copy, stop the container before archiving the volume.

## Database is locked / writes fail

- Run exactly one app replica against a data directory. Two hubs/processes sharing SQLite will fight.
- Keep `/data` on local disk, not NFS/SMB.
- Long-running `VACUUM` can block writes; take a backup first.
- Check free disk space; SQLite errors can surface as generic write failures when the volume is full.

## Migrations fail at startup

Read the actual SQLite error in logs. Typical causes: a corrupt/partial restore, a database from an incompatible
fork, or an interrupted migration. Restore a matching backup. Do not hand-edit `PRAGMA user_version` unless you
know the schema state; migrations are transactional for a reason.

## Proxy / HTTPS issues

- Set `SLOP_SECURE_COOKIES=true` when TLS terminates at the proxy; otherwise browsers may reject Secure cookies if
  the proxy strips the header, or the app may emit cookies that do not travel over plain HTTP.
- Set `SLOP_TRUST_PROXY=true` only behind a trusted proxy, so rate limits and audit logs see the real client IP.
- Do not enable it when the container is directly exposed.
- Keep `client_max_body_size` at or above the upload cap.
- Preserve WebSocket upgrade headers.

## Browser console shows a CSP warning

A CSP directive delivered in a `<meta>` tag may be ignored for directives that only make sense in a header
(`frame-ancestors`). The server sends the full policy as an HTTP header; the meta policy is a defense-in-depth copy.
If you see an ignored-directive warning, verify the response header is present, then ignore the meta warning. Any
actual request to an external origin, however, is a bug.

## Still stuck

Collect:

- exact error code and message
- `docker logs` or terminal output
- `/api/health` JSON
- browser console/network entries
- steps to reproduce and whether it happens for all users or one account

Open an issue with that evidence. Do not paste session cookies, private JWTs, passwords or backup files.
