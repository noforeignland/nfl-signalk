# Agent Guide — nfl-signalk

Guidance for AI coding assistants (Claude Code, Copilot, Cursor, etc.) working in this repository. Human contributors will also find it useful as a quick orientation.

This file is the single source of truth for agent behaviour. `CLAUDE.md` is a symlink to this file.

## What this project is

`@noforeignland/signalk-to-noforeignland` is a [Signal K](https://signalk.org/) server plugin that logs the boat's GNSS position and uploads tracks to **noforeignland.com**. It runs inside a Signal K server (typically `~/.signalk` on Linux, or `/data/conf/signalk` on a Victron Cerbo GX).

The plugin is published to npm as `@noforeignland/signalk-to-noforeignland` and installed from the Signal K Appstore.

## Stack

- **Language:** TypeScript 5.7, `strict` + `strictTypeChecked` ESLint config (no `any`, no unsafe casts, no floating promises).
- **Runtime:** Node.js ≥ 18 (CI matrix: 22.x, 24.x).
- **Build:** `tsc` → `dist/` (no bundler). `dist/` is the only thing published to npm.
- **Tests:** Jest + ts-jest. Config is `jest.config.ts`.
- **Lint/format:** ESLint flat config (`eslint.config.mjs`) + Prettier (`.prettierrc`).
- **Signal K types:** `@signalk/server-api`.

## Layout

```
src/
  index.ts              # Plugin entry — exports SignalK plugin object, owns lifecycle
  lib/                  # One responsibility per module
    ConfigManager.ts    # Schema, config migration, defaults, CRON randomisation
    TrackLogger.ts      # Subscribes to navigation.position, writes pending.jsonl
    TrackSender.ts      # Reads pending.jsonl, POSTs to NFL API with retry
    HealthMonitor.ts    # Position-freshness checks, error/healthy callbacks
    DataPathEmitter.ts  # Emits noforeignland.* deltas for dashboards
    PluginCleanup.ts    # Runtime removal of deprecated predecessor plugins
    TrackMigration.ts   # Migrates legacy track filenames into pending/sent.jsonl
    DirectoryUtils.ts   # Mkdir + permission checks with friendly errors
  types/                # Shared types (signalk.ts, config.ts, position.ts, api.ts)
  utils/                # validation.ts, geo.ts (equirectangular distance, m/s↔kts)
test/
  unit/                 # Jest tests
  mocks/signalk-app.ts  # Minimal SignalKApp double for tests
doc/                    # User install notes (Cerbo, RPi)
.github/workflows/      # signalk-ci.yml (push/PR via shared SignalK reusable workflow), publish.yml (tag → npm)
```

`PROJECT_STRUCTURE.md` has the long-form architecture description and data-flow diagrams — read it before adding new modules or changing the startup sequence.

## Plugin contract

The Signal K plugin contract is:

```ts
export = (app: SignalKApp): Plugin => ({ id, name, description, schema, start, stop });
```

`start(config)` is `async` and must be idempotent under restart. `stop()` must tear down everything started in `start()`:

- the CRON job (`this.cron?.stop()`),
- the subscription manager unsubscribes returned by `TrackLogger`,
- the `HealthMonitor` timers.

Anything that leaks across a stop/start cycle will corrupt status reporting on the next config save.

## Data the plugin owns

On disk (under the plugin's data directory):

- `pending.jsonl` — track points not yet uploaded. JSONL: `{"lat":…,"lon":…,"t":"ISO8601"}` per line.
- `sent.jsonl` — archived points (only if "keep track files on disk" is enabled).

Signal K deltas emitted (consumed by Node-RED, KIP, dashboards):

```
noforeignland.savepoint              ISO8601 of last point saved
noforeignland.savepoint_local        Locale string of the same
noforeignland.sent_to_api            ISO8601 of last successful upload
noforeignland.sent_to_api_local      Locale string of the same
noforeignland.status                 Human-readable status
noforeignland.status_boolean         0 = OK, 1 = error (no notification emitted; users set Zones if they want one)
noforeignland.source                 Active GNSS source name
```

Don't rename or repurpose these paths without a version bump and a note in `CHANGELOG.md` — users wire dashboards to them.

## Commands

```
npm install               Install dependencies
npm run build             tsc → dist/
npm run dev               tsc --watch
npm run typecheck         tsc --noEmit
npm run lint              eslint src test
npm run lint:fix          eslint --fix
npm run format            eslint --fix + prettier --write
npm run format:check      prettier --check (run this before pushing)
npm test                  jest
npm run test:coverage     jest --coverage
npm run validate          typecheck + lint + test:coverage  ← the full chain
```

`npm run validate` is what CI runs (plus `npm run build`). Run it locally before pushing.

## Workflow expectations

- **Branches:** work on a feature branch off `main`. Don't commit directly to `main`. Don't use `/` in branch names — use hyphens (`fix-outlier-filter`, not `fix/outlier-filter`).
- **Commits:** [Angular conventional commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. PR titles follow the same convention. No `Co-Authored-By` lines, no "Generated with …" attribution.
- **`CHANGELOG.md`:** maintained by the human, manually, at release time. **Do not edit it in feature PRs.** Bump the version + changelog in a separate, dedicated PR.
- **PR description:** "Tested" section lists only what was actually verified. No speculative test plans, no `[ ]` / `[x]` checkboxes.
- **Before pushing:** always run `npm run validate` and `npm run format:check`. If either fails, fix it — don't push and hope CI sorts it out.
- **Never `git push` without explicit human approval.** Approval to commit is not approval to push.
- **Never open PRs without explicit human approval.** Wait for the word "PR".
- **Never merge without explicit human approval.** Wait for the word "merge".
- **Don't `npm publish` from a developer machine.** Publishing happens via the tag-triggered `publish.yml` workflow against npm trusted publishers (OIDC). Local publishes would break the trust chain.

## Code conventions

- TypeScript `strict` everywhere. No `any`, no `as unknown as X`, no `// @ts-ignore`. If the types fight you, the model is probably wrong — fix the type rather than escaping it.
- ESLint is `strictTypeChecked`. `no-floating-promises` is on — every promise either gets `await`ed or `void`ed deliberately.
- One module per responsibility under `src/lib/`. New cross-cutting concerns get their own file, instantiated in `SignalkToNoforeignland`'s constructor and torn down in `stop()`.
- Pure helpers (distance math, validation, formatting) belong in `src/utils/` so they can be unit-tested without a Signal K app double.
- Log via `app.debug()` for verbose output and `app.setPluginStatus()` / `app.setPluginError()` for the UI status pill. Don't `console.log`.
- **No echo comments.** Don't write comments that restate what the code already says (`// increment counter`, `// loop over items`). Only comment when the *why* is non-obvious — a workaround, a constraint, an invariant that would surprise a reader.
- No emojis in code or commit messages unless a human asks for them.

## Things that have bitten us before

- **`dist/` is gitignored but must be in the npm tarball.** That's what `.npmignore` is for — keep `dist` out of `.npmignore`'s ignore list. CI verifies `dist/index.js` and `dist/index.d.ts` exist after build.
- **`composite: true` in `tsconfig.json` breaks the build** when combined with `tsc --noEmit` in `typecheck`. Don't add it back.
- **Position validation rejects coordinates near `(0, 0)`** — this is intentional (catches uninitialised GNSS). Don't "fix" it.
- **GNSS source auto-selection is sticky.** Once a source is chosen, `TrackLogger` only switches if the current source goes stale (>5 min). Changing this risks track jumps when multiple GNSS devices are present.
- **Velocity outlier filter** (`MAX_VELOCITY`, default 50 m/s) catches GPS jumps. Aircraft users raise it; boats should never need to lower it.
- **API retry policy:** retry on network errors and 5xx only. 4xx (especially 401 "invalid BOAT API key") must surface to the user immediately — don't make them wait through three retries to see a config error.

## Where to look

- `README.md` — user-facing install/config notes.
- `PROJECT_STRUCTURE.md` — architecture, data flow, file locations on Cerbo vs standard.
- `doc/beta_install_cerbo.md`, `doc/beta_install_rpi.md` — install procedures for hardware testers.
- `CHANGELOG.md` — version history (human-maintained; do not edit from agents).
- Upstream: this repo is a maintained fork of `amirlanesman/signalk-to-nfl` under the `noforeignland` GitHub org.
