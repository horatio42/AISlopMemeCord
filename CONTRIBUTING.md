# Contributing

> The slop is collaborative. The tests are mandatory.

## Before you start

- Read [DEVELOPMENT.md](docs/DEVELOPMENT.md) for the repo map and conventions.
- Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing permissions, storage, realtime or E2EE.
- Check existing issues/PRs. For security issues, **do not** open a public issue; see [SECURITY.md](SECURITY.md).
- Keep the single-container promise. No new external services, CDNs, fonts, analytics or runtime dependencies
  without a strong reason.

## Setup

```bash
bun install
bun run build
bun run dev
```

The first registered account becomes admin. With `SLOP_DEMO_SEED=true` (default) it receives the demo world.
Reset local data with `rm -rf ./data` while the server is stopped.

## Workflow

1. Make a focused branch.
2. Write a failing test or reproduce the behavior in a real browser.
3. Implement the smallest correct change; reuse existing patterns.
4. Run the checks below.
5. Update docs if behavior, config or limits changed.
6. Open a PR with the problem, the decision, and the verification evidence.

For UI-only changes, include before/after screenshots or a short capture. Do not commit generated `data/` or
stray screenshots outside `screenshots/`.

## Checks

```bash
bunx tsc --noEmit
bun test
bun run build
bun run screenshot   # when UI or seed data changed; requires Chromium
```

Run a single slice while iterating:

```bash
bun test tests/integration/messages.test.ts
```

A PR is not ready if typecheck, tests or build fail. Do not "fix" a failure by weakening an assertion unless the
assertion encodes wrong behavior; explain why in the PR.

## Code style

### Backend

- Routes thin; validate, check permissions, call a service, return a DTO.
- Services own invariants and transactions; repositories own SQL shape and serialization.
- Stable machine error codes in `ApiError`/`ValidationError`; jokes only in messages.
- Never trust client-supplied IDs, paths, MIME types, role permissions or upload ownership.
- Permission checks belong on the server, even if the UI hides the control.
- Audit moderation, role, server, invite and admin mutations.
- Broadcast after the transaction commits.
- Add or update integration tests for new endpoints, including denial paths.

### Frontend

- Preact function components with strict TypeScript.
- Shared state lives in the store; mutate through store methods and `emit()`.
- Use the existing primitives (`Modal`, `Field`, `Avatar`, buttons, menus) and CSS tokens.
- Do not inject HTML. Markdown goes through the VNode renderer.
- No bare `fetch` when the API helper already handles CSRF and errors.
- No dead controls: every button has a real action, disabled state or explanation.
- Check 390 px mobile, keyboard focus and reduced-motion mode for new UI.
- Keep the theme variables intact; do not hard-code colors that break Light or Terminal.

### Assets and dependencies

- Original SVG art only; no copyrighted meme images or external asset URLs.
- Fonts must be self-hosted with compatible licenses.
- Runtime dependencies are currently `preact` and `fflate`; justify any addition.
- Do not add analytics, error-reporting SDKs, CDN scripts or external API calls.

## Tests

- Tests run against real HTTP servers, real SQLite databases and real WebSockets.
- Use `tests/helpers.ts`; do not mock the app under test.
- Cover authorization boundaries and validation failures, not only the happy path.
- Use temp data dirs; tests must not touch a developer's `./data`.
- Permanent tests should catch consumer-visible bugs. Avoid tests that only re-read source text, mock wiring or
  assert incidental defaults.

See the test helper examples in [DEVELOPMENT.md](docs/DEVELOPMENT.md#testing).

## Migrations

- Never edit a shipped migration. Add the next numbered SQL file.
- Migrations run in filename order in a transaction tracked by `PRAGMA user_version`.
- Add explicit foreign keys/cascades and update repositories/tests.
- Back up before testing a migration against valuable local data.

## Screenshots and docs

- `bun run screenshot` boots a throwaway instance on an ephemeral port and requires a local Chromium. Set
  `SLOP_CHROMIUM` if needed.
- The script fails on browser console errors, missing selectors or broken images. Do not bypass those assertions.
- Update [screenshots/README.md](screenshots/README.md) when adding/removing a screenshot.
- Keep documentation honest about limitations. A known gap documented is better than a fake feature claim.
- Use relative links inside the repo.

## Copy and tone

Swearing is allowed in user-facing copy if it serves the bit. Slurs, harassment, doxxing and cruelty are not.
Keep error messages understandable to a tired human and keep the machine code separate. The app should be weird,
not hostile.

## Security

- Report vulnerabilities privately per [SECURITY.md](SECURITY.md).
- Never commit secrets, session tokens, private E2EE JWKs, `.env` files or production databases.
- Upload validation must use magic bytes; SVG must remain sanitized and restricted to emoji.
- New endpoints need rate limits when abuse-prone and permission checks on every resource.
- Do not weaken CSP, CSRF, origin checks or cookie flags for convenience.

## Definition of done

- [ ] The behavior works end-to-end, including error and permission paths.
- [ ] `bunx tsc --noEmit`, `bun test` and `bun run build` pass.
- [ ] The changed surface was exercised in a browser or smoke script.
- [ ] Docs/config/changelog updated where needed.
- [ ] No new external requests, dead controls or telemetry.
- [ ] Mobile and accessibility regressions checked.
- [ ] The slop is funnier; the internals are not.

## License

By contributing, you agree your work is licensed under the MIT license in [LICENSE](LICENSE).
