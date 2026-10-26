# Security policy

> Serious enough to have a policy. Not serious enough to claim an audit.

## Supported versions

| Version | Supported |
|---|---|
| Current `main` / latest release | Yes |
| Older releases | Best effort; upgrade first |

There is one container and one schema. Fixes are released on `main` and tagged releases; long-term backports are not
promised. Before reporting, reproduce on the latest source or image if possible.

## Reporting a vulnerability

**Do not open a public GitHub issue with exploit details.**

Use the repository's **Security → Report a vulnerability** private advisory flow when available. If private
advisories are not enabled, contact the repository owner privately through their GitHub profile and ask for a
private channel. Include:

- affected version/commit
- deployment shape (Docker/Bun, proxy, TLS)
- clear steps to reproduce
- impact and required attacker position
- proof-of-concept or request/response, with secrets redacted
- any suggested fix

Do not include real session cookies, passwords, private E2EE keys, user data or production backups. Use a disposable
instance and synthetic accounts.

We will acknowledge a complete report when possible, investigate, and coordinate disclosure. This is a hobby-scale
project: there is no bounty, SLA or guaranteed response time, but credible reports are taken seriously.

## In scope

Examples of issues we want to hear about:

- Authentication/session/CSRF bypasses; privilege escalation; admin-last-user bypass.
- Permission errors that expose a private channel, server, DM, upload, report or admin asset.
- SQL injection, path traversal, unsafe file handling, SSRF, stored/reflected XSS.
- SVG sanitizer bypasses or upload MIME/magic-byte bypasses leading to active content.
- Rate-limit or registration-gate bypass with meaningful impact.
- WebSocket audience mistakes that leak message content or voice signaling across permissions.
- Backup/export leakage of another user's data or secrets.
- Remote code execution, dependency compromise or container escape caused by this project.
- E2EE plaintext being sent to or stored by the server contrary to the documented design.

## Out of scope / known limitations

These are documented design limits, not vulnerabilities by themselves:

- The **instance operator** can read unencrypted server messages, DMs, metadata and backups. This is the trust model.
- E2EE is limited to 1:1 DMs, uses static keys, has no forward secrecy, no safety-number verification, no group
  E2EE, and does not encrypt attachments. A compromised browser/device can read keys and plaintext.
- No TURN; voice may fail across NAT. No screen share or DM voice exists.
- No EXIF stripping on uploads. Uploading sensitive photos may leak metadata.
- No federation or multi-node security model; running multiple replicas against one SQLite file is unsupported.
- Local notifications require browser permission; no push service exists.
- Deterministic local "AI" meme generation is not a security boundary.
- Missing hardening by the operator (plain HTTP, weak admin password, exposed `/data`, no backups) is not a product
  vulnerability, though we welcome documentation improvements.
- Social engineering, spam from accounts the operator invited, or content moderation disputes.
- Denial of service requiring enormous resources against a deliberately single-process hobby deployment, unless it
  is a trivial unauthenticated crash or amplification bug.

## Security baseline in the code

- Argon2id password hashing via Bun; passwords never logged.
- Opaque session tokens, only SHA-256 hashes stored; expiry, sliding activity, per-session revocation.
- HttpOnly/SameSite cookies; Secure flag configurable for HTTPS.
- Origin checks plus double-submit CSRF on unsafe methods.
- Strict CSP (`default-src 'self'`), no external scripts/fonts/images/connections, frame denial.
- Server-side permission recomputation for every resource; client gating is UX only.
- Parameterized SQLite queries; FTS fallback parameterized.
- Magic-byte upload validation; active formats rejected; SVG sanitized and emoji-only.
- Random stored filenames with DB as the only path source; traversal checks on media serving.
- Rate limits on auth, uploads, invites, reports, voice and global requests.
- Audit logs for moderation, server, role, invite and admin mutations.
- Admin-only routes with last-admin protections.
- No telemetry and no outbound requests, except optional operator-configured STUN.

## Operator hardening checklist

1. Serve over HTTPS and set `SLOP_SECURE_COOKIES=true`.
2. Use a long unique admin password; enable TOTP.
3. Set registration to `invite` or `closed` when public.
4. Keep `/data` off the public web root; back it up and protect backups like the database.
5. Run one replica; keep the volume on local disk.
6. Align reverse-proxy body limits with `SLOP_MAX_UPLOAD_MB`.
7. Patch the image/source and review release notes.
8. Set `SLOP_TRUST_PROXY=true` only behind a trusted proxy.
9. Remove EXIF from sensitive images before upload.
10. Treat E2EE as a privacy improvement, not a replacement for endpoint security.

## Disclosure

We prefer coordinated disclosure. Once a fix is available, we may publish an advisory with credit unless you ask to
remain anonymous. Please give us a reasonable window before public write-ups. Do not test against instances you do
not own or have permission to test.
