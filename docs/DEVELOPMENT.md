# Development

## Requirements

- [Bun](https://bun.sh) ≥ 1.4
- Node is not required (Bun runs TypeScript directly)
- No external database/services
- Docker optional for container testing

## Get running

```bash
bun install
bun run build          # build client + admin bundles into dist/public
bun run dev            # build, then run server with watch
```

`bun run dev` uses `./data` by default. The first registered account is admin and (with `SLOP_DEMO_SEED=true`) gets
the seeded demo world. To reset a dev instance:

```bash
rm -rf ./data
bun run dev
```

Production-ish local run:

```bash
bun run build
SLOP_DATA_DIR=./data PORT=3000 bun run start
```

The server serves `dist/public`; without a build you will see a "No build found" page.

## Commands

| Command | Purpose |
|---|---|
| `bun run dev` | Build + watch server |
| `bun run build` | Bundle client/admin + copy assets and CSS |
| `bun run start` | Run server only |
| `bun test` | Full integration/unit suite |
| `bun test tests/integration/messages.test.ts` | One slice |
| `bunx tsc --noEmit` | Strict TypeScript check |
| `bun run screenshot` | Boot throwaway instance, regenerate `screenshots/` (needs Chromium) |

## Repository map

```
src/server/
  index.ts        bootstrap (config, DB, seed, serve, shutdown)
  app.ts          runtime, router registration, static/SPA serving, request pipeline
  config.ts       env → Config
  db.ts           bun:sqlite wrapper + migrations
  db/migrations/  ordered SQL
  routes/         auth/users/servers/members/messages/dms/media/admin/misc/voice/gateway
  services/       permissions, auth, uploads, messages, invites, seed, admin helpers…
  repos/          row types + DTO assemblers
  realtime/hub.ts connections, presence, audience filtering, voice state
  util/           IDs, validation, crypto, logging
src/shared/       shared types, permissions, memes/achievements/awards
src/client/       Preact SPA (see ARCHITECTURE.md)
src/client/admin/ separate admin SPA bundle
src/assets/       original fonts, SVG memoji/memes/stickers, generated sounds
tests/helpers.ts  test server + cookie-aware client + WS utilities
tests/integration real API/WebSocket suites
scripts/          build, asset generators, screenshot automation
```

## Backend conventions

- Routes are thin. Validate with `readJson` + validators; check permissions; call a service; return DTO.
- Errors: `throw new ApiError(status, 'CODE', 'meme-flavored but clear message')`.
- Input errors: `throw new ValidationError({ field: 'message' })`.
- IDs: `newId('m')`, `newId('u')`, etc. Never use timestamps as IDs.
- Use snake_case DB columns and camelCase DTO fields.
- Wrap multi-step mutations in `db.transaction(fn)`.
- Audit every moderation/server/role/admin action with `logAudit`.
- Broadcast after the transaction commits. Use `hub.broadcastChannel` for content, `broadcastServer` for server-wide
  metadata, `hub.send` for user-specific events.
- Never trust client-supplied paths, MIME types, external URLs, role permission escalation or upload ownership.
- Add route options for rate limits on abuse-prone endpoints (`login`, uploads, invites, voice).

### Adding an endpoint

1. Add the route in the relevant `src/server/routes/*.ts` module (or a new one registered in `app.ts`).
2. Validate body/query, resolve the channel/server via permission helpers, check exact permissions.
3. Implement business logic in a service; keep SQL in repos if reusable.
4. Serialize DTOs from `src/shared/types.ts`.
5. Broadcast relevant gateway events.
6. Add integration tests with `startTestServer` and clients; cover denial paths.

### Adding a migration

Create the next numbered SQL file in `src/server/db/migrations/` (`004_...sql`). Migrations run in filename order
inside a transaction tracked by `PRAGMA user_version`. Never edit a shipped migration; add a new one. Update
repositories/DTOs and tests. Use foreign keys with explicit cascade behavior.

### Adding a WebSocket event

1. Add the name to `GatewayEventName` in `src/shared/events.ts`.
2. Broadcast a payload from the server with a stable, minimal shape.
3. Handle it in `src/client/lib/store-realtime.ts` (defensively; older/newer payloads may differ).
4. Document it in `docs/API.md`.
5. Test it with `connectWs` + `waitFor` (buffered so you cannot miss an event).

## Client conventions

- Preact function components, hooks, strict TS. No external UI framework.
- State lives in `src/client/lib/store.ts` and is read with `useApp()`. Mutate through store methods and call
  `store.emit()`; avoid local component state for shared data.
- API calls go through `src/client/lib/api.ts` (CSRF handled automatically). Never use bare `fetch` unless
  downloading a blob/raw response where documented.
- CSS lives in `src/client/styles/*.css` using the design tokens. Reuse `.btn`, `.card`, `.modal`, `.menu`,
  `.input`, `.badge`, etc. Themes are CSS variable overrides on `data-theme`.
- No external assets/fonts/CDNs. Add art to `src/assets/` and reference `/static/assets/...`.
- Markdown is rendered to VNodes by `markdown.tsx`; never inject HTML. Add safe inline nodes there.
- Use `store.toast()` for feedback and the menu/modal primitives for interactions.
- Respect permissions client-side only for UX; server still enforces.
- Keep mobile classes/responsive styles working (`@media` in app/chat CSS).

### Adding a modal/page

- Build it under `src/client/components/modals/` or `src/client/views/`.
- Use `Modal` from `Ui.tsx` and `Field`/`Toggle` primitives.
- Wire it to store UI state or local `ChatApp` state as appropriate.
- Add styles to `settings.css`, `chat.css` or `app.css` (avoid one-off inline styles beyond spacing).
- Ensure loading/error/empty states and real API calls; no dead buttons.

## Testing

Tests use real servers, real SQLite and real WebSockets:

```ts
import { startTestServer, newClient, makeUsers, connectWs, waitFor } from '../helpers';

const server = startTestServer();
const alice = newClient(server);
await alice.register('alice', 'password123');
const res = await alice.get('/api/auth/me');
expect(res.body.user.username).toBe('alice');
```

- `startTestServer({ demoSeed: true })` for seeded-world tests.
- `makeUsers(server, ['a', 'b'])` creates registered clients.
- `createTestServerViaApi(client, name)` creates a guild with defaults.
- `connectWs` buffers received events; `waitFor` checks the buffer and future messages.
- Tests do not use mocks for app behavior. They run in temp dirs and clean up.

Run only your slice while developing; run the full suite before committing.

## Seeding

- `src/server/seed_assets.ts` seeds global sounds.
- `src/server/seed_workspace.ts` seeds the full first-admin demo world.
- First registration calls `seedDemoForAdmin` when `SLOP_DEMO_SEED=true`.
- Demo users have intentionally unusable password hashes; they are decorative, not login accounts.
- Seeding is idempotent per admin and never runs for later users.

## Build details

`scripts/build.ts` bundles `src/client/main.tsx` and `src/client/admin/main.tsx` with Bun, copies `src/assets` to
`dist/public/assets`, concatenates CSS in a fixed order (`base → components → app → chat → landing → settings`),
adds `admin.css`, and writes `index.html` / `admin.html` with CSP and hashed asset names.

The server serves `/static/*` from `dist/public` with immutable caching and SPA fallbacks for `/` and `/admin`.

## Code style

- Boring, explicit internals; joke only in copy and visuals.
- Prefer small pure functions and repository helpers over clever abstractions.
- Strict TypeScript; avoid `any` at module boundaries. Demo data can be cast narrowly.
- Comments explain why, not what.
- No new runtime dependencies without a strong reason. We currently ship only `preact` and `fflate` plus Bun itself.
- Keep the single-container promise; no external services in tests or runtime.

## Debugging tips

- `SLOP_LOG_LEVEL=debug` for request/error logs.
- Admin → Logs/Health for DB sizes, memory and log tail.
- SQLite can be inspected directly: `bun -e "new (require('bun:sqlite').Database)('./data/slop.db')"`.
- Network panel should show zero external requests. If it doesn't, that's a bug.
- WebSocket: check `READY`, heartbeat `pong`, and channel audience; if a user "can't see" events, verify channel
  permissions rather than assuming broadcast failure.
- Voice: check microphone permission, STUN config, and that both users joined the same voice channel. Mesh voice
  does not work across symmetric NAT without TURN (not included).

## Definition of done

- Feature works end-to-end, with permission/error paths.
- Tests pass; typecheck clean; production build succeeds.
- Docs and user-facing copy updated.
- No new external requests or telemetry.
- Mobile layout and keyboard accessibility not obviously broken.
- You did not make the slop less weird than it needs to be.
