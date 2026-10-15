# Agent Guide — nfl-signalk

Guidance for AI coding assistants (Claude Code, Copilot, Cursor, etc.) working in this repository. Human contributors will also find it useful as a quick orientation.

This file is the single source of truth for agent behaviour. `CLAUDE.md` is a symlink to this file.

## What this project is

`@noforeignland/signalk-to-noforeignland` is a [Signal K](https://signalk.org/) server plugin that logs the boat's GNSS position and uploads tracks to **noforeignland.com**. It runs inside a Signal K server (typically `~/.signalk` on Linux, or `/data/conf/signalk` on a Victron Cerbo GX).

The plugin is published to npm as `@noforeignland/signalk-to-noforeignland` and installed from the Signal K Appstore.

## Stack

- **Language:** TypeScript 6.0 (held below 6.1 until typescript-eslint supports newer), `strict` + `strictTypeChecked` ESLint config (no `any`, no unsafe casts, no floating promises).
- **Runtime:** Node.js ≥ 22 (CI matrix: 22.x, 24.x). An ES module (`"type": "module"`); Signal K server loads ESM plugins since 2.14.
- **Build:** `vite build` bundles `src/` into one ES module, `dist/index.js`, with node built-ins and runtime dependencies left external. `vite-plugin-checker` runs `tsc` and fails the build on a type error; `vite-plugin-dts` writes the declarations. Config is `vite.config.ts`. `dist/` is the only thing published to npm.
- **Tests:** Vitest, configured in the `test` block of `vite.config.ts`. Coverage (`@vitest/coverage-v8`, 80 % thresholds) counts the source files the tests load. Vitest does not typecheck, so `npm run typecheck` also checks `test/` through `tsconfig.eslint.json`.
- **Lint/format:** ESLint flat config (`eslint.config.mjs`) + Prettier (`.prettierrc`).
- **Signal K types:** `@signalk/server-api`.
- **Config schema:** `typebox` 1.x (the unscoped package; `@sinclair/typebox` is the separate 0.34 line). `src/lib/configSchema.ts` defines the settings form, and through `Static` the type of the stored configuration. `test/unit/__snapshots__/config-schema.json` pins the schema as emitted. A change there is a change to the form users see, so update it on purpose (`npx vitest run -u`) and review the diff.

## Layout

```
src/
  index.ts              # Plugin entry — exports SignalK plugin object, owns lifecycle
  lib/                  # One responsibility per module
    ConfigManager.ts    # Config migration, flattening with defaults, CRON randomisation
    configSchema.ts     # typebox schema of the settings form, CONFIG_DEFAULTS
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
  unit/                 # Vitest tests
  mocks/signalk-app.ts  # Minimal SignalKApp double for tests
doc/                    # User install notes (Cerbo, RPi)
.github/workflows/      # signalk-ci.yml (push/PR via shared SignalK reusable workflow), release-please.yml (release PR → tag),
                        # publish.yml (tag → npm), label-by-title.yml (PR label from the title's type)
```

`PROJECT_STRUCTURE.md` has the long-form architecture description and data-flow diagrams — read it before adding new modules or changing the startup sequence.

## Plugin contract

The Signal K plugin contract is:

```ts
export default (app: SignalKApp): Plugin => ({ id, name, description, schema, start, stop });
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

Don't rename or repurpose these paths without a breaking change (`!` in the PR title, `BREAKING CHANGE:` footer) that says what moved. Users wire dashboards to them.

## Commands

```
npm install               Install dependencies
npm run build             vite build → dist/ (fails on a type error)
npm run dev               vite build --watch
npm run typecheck         tsc --noEmit over src/, then src/ + test/
npm run lint              eslint src test vite.config.ts
npm run lint:fix          eslint --fix
npm run format            eslint --fix + prettier --write
npm run format:check      prettier --check (run this before pushing)
npm test                  vitest run
npm run test:coverage     vitest run --coverage
npm run validate          typecheck + lint + test:coverage  ← the full chain
```

`npm run validate` is what CI runs (plus `npm run build`). Run it locally before pushing.

## Workflow expectations

- **Branches:** work on a feature branch off `main`. Don't commit directly to `main`. Don't use `/` in branch names — use hyphens (`fix-outlier-filter`, not `fix/outlier-filter`).
- **Commits:** [Angular conventional commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. PR titles follow the same convention. No `Co-Authored-By` lines, no "Generated with …" attribution.
- **Releases come from release-please.** Never bump `version` in a PR. On every releasable merge to `main`, `release-please.yml` refreshes a standing `chore(release): X.Y.Z` PR. Merging it creates the tag and the GitHub Release, then dispatches `publish.yml`. Releasable means `feat`, `fix`, `perf`, `revert`, any `type!:` or `BREAKING CHANGE:` footer, and `build(deps)` (a runtime dependency bump). `docs`, `ci`, `chore`, `refactor`, `test` and `build(deps-dev)` merges wait for the next releasable one. Release notes are GitHub's, built from PR titles and grouped by the label `label-by-title.yml` sets, so the PR title is the changelog entry. There is no `CHANGELOG.md`.
- **Betas:** run the release-please workflow by hand with `beta` to turn the open release PR into the next `-beta.N` (npm `beta` tag), and with `stable` to promote the current beta. `refresh` rebuilds the release PR.
- **PR description:** "Tested" section lists only what was actually verified. No speculative test plans, no `[ ]` / `[x]` checkboxes.
- **Before pushing:** always run `npm run validate` and `npm run format:check`. If either fails, fix it — don't push and hope CI sorts it out.
- **Never `git push` without explicit human approval.** Approval to commit is not approval to push.
- **Never open PRs without explicit human approval.** Wait for the word "PR".
- **Never merge without explicit human approval.** Wait for the word "merge".
- **Don't `npm publish` from a developer machine.** Publishing happens in `publish.yml` against npm trusted publishers (OIDC). Local publishes would break the trust chain. The trusted publisher is bound to that workflow's file name, so don't rename it.

## Code conventions

- TypeScript `strict` everywhere. No `any`, no `as unknown as X`, no `// @ts-ignore`. If the types fight you, the model is probably wrong — fix the type rather than escaping it.
- ESLint is `strictTypeChecked`. `no-floating-promises` is on — every promise either gets `await`ed or `void`ed deliberately.
- One module per responsibility under `src/lib/`. New cross-cutting concerns get their own file, instantiated in `SignalkToNoforeignland`'s constructor and torn down in `stop()`.
- Pure helpers (distance math, validation, formatting) belong in `src/utils/` so they can be unit-tested without a Signal K app double.
- Log via `app.debug()` for verbose output and `app.setPluginStatus()` / `app.setPluginError()` for the UI status pill. Don't `console.log`.
- **No echo comments.** Don't write comments that restate what the code already says (`// increment counter`, `// loop over items`). Only comment when the *why* is non-obvious — a workaround, a constraint, an invariant that would surprise a reader.
- No emojis in code or commit messages unless a human asks for them.

## Things that have bitten us before

- **`dist/` is gitignored but must be in the npm tarball.** The `files` allowlist in `package.json` is what ships it; check with `npm pack --dry-run`. CI verifies `dist/index.js` and `dist/index.d.ts` exist after build.
- **The published code is one file, `dist/index.js`, one level below the package root.** Anything that finds a file relative to its own module (`import.meta.url`) runs from there, not from `src/lib/`. That is why the plugin version reaches the code as `__PLUGIN_VERSION__`, set by `define` in `vite.config.ts`, rather than by reading `package.json`.
- **`composite: true` in `tsconfig.json` breaks the build** when combined with `tsc --noEmit` in `typecheck`. Don't add it back.
- **Position validation rejects coordinates near `(0, 0)`** — this is intentional (catches uninitialised GNSS). Don't "fix" it.
- **GNSS source auto-selection is sticky.** Once a source is chosen, `TrackLogger` only switches if the current source goes stale (>5 min). Changing this risks track jumps when multiple GNSS devices are present.
- **Velocity outlier filter** (`MAX_VELOCITY`, default 50 m/s) catches GPS jumps. Aircraft users raise it; boats should never need to lower it.
- **API retry policy:** retry on network errors and 5xx only. 4xx (especially 401 "invalid BOAT API key") must surface to the user immediately — don't make them wait through three retries to see a config error.

## Where to look

- `README.md` — user-facing install/config notes.
- `PROJECT_STRUCTURE.md` — architecture, data flow, file locations on Cerbo vs standard.
- `doc/beta_install_cerbo.md`, `doc/beta_install_rpi.md` — install procedures for hardware testers.
- [GitHub Releases](https://github.com/noforeignland/nfl-signalk/releases) — version history, back to 0.1.25.
- Upstream: this repo is a maintained fork of `amirlanesman/signalk-to-nfl` under the `noforeignland` GitHub org.
