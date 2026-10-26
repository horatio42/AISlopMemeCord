# Privacy model

> We cannot sell your data. We do not have your data. We are barely capable of keeping our own data.

AISlopMemeCord is built for people who want a chat app without an advertising company in the middle. This page is
the honest version, including what the server operator **can** see. It is not a marketing page.

## The promises

| Promise | How it is enforced |
|---|---|
| No telemetry or analytics | No analytics dependencies or code. No beacon, no pixel, no event collector. |
| No external requests | Fonts, art, sounds and app code are bundled. CSP `default-src 'self'` plus explicit connect/img/font/media rules. |
| No email or phone | Registration accepts only a username + password. |
| Local passwords | Argon2id hashing with Bun's password API. No password reset email. |
| No third-party AI | Meme generator and slop meter are deterministic local logic. Messages never leave the instance. |
| Data portability | One-click ZIP export of profile, messages, servers, friends, DM metadata, uploaded files. |
| Account deletion | Hard deletes the account and cascaded personal rows; no soft "deactivated" purgatory. |
| Self-contained storage | SQLite + uploads + exports + secret key under `/data` only. |
| Optional E2EE | 1:1 DM encryption happens in the browser; the server stores ciphertext only. |

## What the instance operator can see

The **host/operator is trusted for unencrypted data**. They have the SQLite file, uploads and backups. This is the
same trust model as any self-hosted chat app.

- All server-channel messages, public and private, and all non-encrypted DMs.
- Profile fields, usernames, avatars, roles, memberships, read cursors, reactions, votes and uploads.
- Session metadata: hashed token, optional hashed IP, browser user-agent for session display.
- Login attempt counts used for throttling.
- Reports and audit logs.
- **Encrypted DMs only as ciphertext.** Plaintext is never transmitted to the server by the client.

Instance admins have a management bypass for server permissions and can read message context in reports. They
cannot decrypt 1:1 E2EE payloads and cannot access browser private keys.

## E2EE threat model

**What it protects:** message plaintext in 1:1 DMs from the server operator, database theft without browser keys,
backup leaks and casual admin snooping.

**What it does not protect:**

- A compromised **client device** or browser profile. The private key is in `localStorage`; malware/XSS with local
  storage access can read it.
- Group DMs. E2EE is offered for 1:1 DMs only. Group DMs are plaintext on the server (marked in the UI).
- Metadata: who messaged whom, when, message lengths, reactions, read state and attachments.
- Forward secrecy / post-compromise security. Keys are static ECDH P-256; no Double Ratchet, no key rotation UX.
- Key verification against MITM by the server. The server distributes public keys and could substitute them in a
  targeted attack; there is no safety-number UI yet. Trust the operator or verify keys out of band.
- Lost keys. If browser site data is cleared, old encrypted messages cannot be recovered. Export the private key
  from **Settings → Privacy & data** if you care about the ciphertext.
- Attachments in DMs. Files are not encrypted by the E2EE message layer; they are permission-checked but stored
  in plaintext on disk.

**Cipher details:** browser WebCrypto ECDH P-256 → AES-256-GCM, random 96-bit IV per message. Ciphertext and IV
are stored; the private JWK never leaves the device. The server does not implement key escrow or recovery.

## Voice & video privacy

- Voice channels use peer-to-peer WebRTC. Audio flows between participants, not through the server.
- The server relays signaling messages (SDP/ICE) over an authenticated WebSocket and sees who is in which channel.
- No STUN/TURN is configured by default. Set `SLOP_STUN_URLS` for NAT traversal; remember that a third-party STUN
  service learns public IPs. Self-host STUN/TURN if that matters.
- No recording, transcription or server-side media storage exists.
- Soundboard playback is same-origin bundled audio; no external media fetch.

## Uploads

- Files are stored in `/data/uploads` with random names; the database is the only source of path truth.
- Magic-byte MIME validation; HTML/JS rejected; SVG only for emoji and sanitized.
- Upload endpoints strip no EXIF currently. Assume photos may contain metadata. Remove metadata before uploading
  sensitive images. This is a known limitation.
- Access checks: attachments require channel/DM visibility; profile and emoji media require an authenticated session;
  admin uploads are never exposed; pending uploads are owner-only.
- Backups may include media; the admin backup is database-only unless `?media=1`, in which case it includes uploads.

## Cookies, sessions & CSRF

- `slop_session`: HttpOnly, SameSite=Lax, Secure when configured; server stores only a SHA-256 token hash.
- `slop_csrf`: readable double-submit token, verified against the header on state-changing authenticated requests.
- Origin checks on unsafe methods; SameSite and CSP reduce CSRF/XSS surface.
- Sessions expire after 30 days, slide with activity, and can be revoked individually or all at once.
- Login attempts are recorded (hashed IP + username + success + time) for throttling and pruned after 30 days.

## Network behavior

At runtime the app makes **no outbound requests** as part of normal operation:

- No CDN, no Google Fonts, no analytics, no Gravatar, no link unfurling, no external avatars, no push service.
- Markdown links open only when you click them; there are no previews/fetches.
- The CSP forbids external scripts, styles, fonts, frames, images and connections.
- Optional STUN is the only network exception, and only if the operator configures it.

There is no remote content embedded anywhere. Markdown links and the optional GitHub link in Settings → About open
only when you click them; the app never prefetches or previews them.

## Data lifecycle

- **Export:** settings → Privacy & data → download ZIP. Includes profile, messages, servers, friends, DM metadata,
  sessions metadata and up to 200 uploads. History is plain JSON.
- **Deletion:** settings → Privacy & data → delete account. Cascades owned servers, memberships, messages, uploads,
  sessions, friendships and notification rows. There is no undo and no grace period.
- **Retention:** messages and uploads persist until deleted by a user/moderator/admin or the instance is destroyed.
- **Backups:** admin backups are generated on demand and contain the database (including password hashes, session
  token hashes and ciphertext). Protect backup files like the database itself. Raw passwords and the secret key are
  not included.
- **Database at rest:** not encrypted by SQLite. Use full-disk encryption on the host if physical theft is in scope.

## Recommendations

1. Serve the app over HTTPS and set `SLOP_SECURE_COOKIES=true`.
2. Give the admin account a long unique password and enable TOTP.
3. Use a named Docker volume and back it up; protect your backups.
4. Keep the instance patched. This is AI slop with tests, not a security-audited product.
5. If you need group E2EE or metadata privacy from your own operator, use a dedicated E2EE messenger (SimpleX,
   Matrix with E2EE, Signal). This app intentionally favors usability and a single-container deployment.
6. Remove EXIF from sensitive images before upload until we ship automatic stripping.

## What we will never add

- Ad networks, tracking pixels or "partners".
- Email verification/phone verification.
- Silent analytics, session replay, crash telemetry.
- Server-side decryption of E2EE messages.
- Selling, licensing or "anonymizing" user data.

If a future change violates these, it is no longer AISlopMemeCord. Fork it and call it something else.

*Last updated: 2026 — a goblin reviewed this and said "yeah seems fine".*
