# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

`pubservices` — an npm-published TypeScript CLI that runs a shared Docker stack for local
development: MySQL, Redis, Nginx, phpMyAdmin, Mailpit and MinIO on one bridge network
(`public-service-network`), so any project container can reach them by container name.

Installed with `npm i -g pubservices`. v1 was a bash CLI installed by `scripts/install.sh` into
`/usr/local/lib/public-services-containers`; that path is now **read-only legacy** (see below).

## Common Commands

```bash
npm ci            # install dependencies
npm run build     # bundle to dist/ (tsup)
npm run typecheck # tsc --noEmit
npm test          # vitest — starts a sandbox Docker stack, see "Testing"
make lint         # typecheck + shellcheck scripts/release.sh
make release      # bump patch → commit → tag → push → GitHub Actions publishes to npm
make release-dry  # preview without making changes
```

## Architecture

**Two directories, and the split matters:**

| | Owner | Contents |
|---|---|---|
| the npm package | root (or npm prefix owner), read-only | `dist/`, `templates/` |
| `$PUBSERVICES_HOME` (default `~/.pubservices`) | the user | `.env`, `docker-compose.yml`, `nginx/`, `mysql/`, `data/`, `backups/`, `state.json` |

`ensureHome()` in `src/home.ts` runs before every command: it creates the layout, seeds `.env`
on first run, and re-copies templates when the package version changes. **It never touches
`data/`** — those files belong to the container users and rewriting them corrupts startup.
This replaces everything `scripts/install.sh` used to do with root.

**Source layout:**
- `src/cli.ts` — commander wiring; no arguments → status, then the interactive menu on a TTY
- `src/menu.ts` — `@clack/prompts` menu; `MENU_GROUPS` carries each action's equivalent command
- `src/dash.tsx` — Ink dashboard, dynamically imported so React stays out of the fast path
- `src/ui.ts` — every colour, glyph and layout decision; **no ANSI escapes anywhere else**
- `src/docker.ts` — process spawning, compose wrapper, `inContainer`, `purgeDataDirs`
- `src/commands/*.ts` — one file per command group

## The No-Root Rule

v2 needs root for nothing. When adding a command, keep it that way:

- Files the containers own (MySQL runs as uid 999) are edited **from inside a throwaway
  container** — `inContainer()` / `purgeDataDirs()` in `src/docker.ts`, never `sudo rm`.
- Anything the CLI writes goes under `$PUBSERVICES_HOME`, which the user owns.
- Completions install into `~/.local/share/...` and `~/.config/fish/...`, never `/etc`.
- Ports below 1024 are bound by the Docker daemon, not by the CLI.

The only place root can still appear is a root-owned npm prefix; `doctor` detects it and prints
the `npm config set prefix` fix rather than telling the user to sudo forever.

## Fixed Constraints (do not change these defaults)

- Container names: `mysql-main`, `redis-main`, `nginx-main`, `phpmyadmin`, `mailpit`, `minio`
- Network name: `public-service-network`
- They are hardcoded into dependent projects. `src/env.ts` holds them as defaults and
  `test/scaffold.test.ts` pins them.

`local-dev-proxy` resolves its nginx paths from `docker inspect nginx-main` bind-mount sources,
not from a hardcoded path, so moving the home directory does not break it.

## The Legacy v1 Installation

`/usr/local/lib/public-services-containers` (`LEGACY_INSTALL_DIR` in `src/legacy.ts`) is
**read-only for this codebase, forever**. On a developer machine it is usually a live stack with
real data bind-mounted out of it.

- `doctor` detects it and suggests `migrate`
- `migrate` copies out of it — config with `cp`, `data/` through a container to preserve uids
- Nothing writes to it, renames it or deletes it. The user removes it themselves.

## Testing

`npm test` starts real containers. Three rails keep it away from anything real:

1. `test/setup.ts` throws if `PUBSERVICES_HOME` resolves outside the OS temp directory, or
   matches `~/.pubservices` or the legacy path.
2. `test/sandbox.ts` uses its own compose project (`psvc-it`), network (`psvc-it-network`),
   container prefix (`psvc-it-`) and port block (`452xx`). `assertIsolated()` re-checks all of
   them against the shipped defaults before each run and again before any destructive call.
3. `test/migrate.test.ts` always passes an explicit `from` pointing at a simulated v1 install in
   a temp directory, and asserts it is not `LEGACY_INSTALL_DIR`.

`fileParallelism: false` in `vitest.config.ts` — the integration suites share one sandbox stack
by design, so they must not run concurrently.

`test/package.test.ts` installs the packed tarball into a temp npm prefix and drives the
installed binary, which catches templates missing from `files` and broken `bin` entries.

**When touching anything destructive, snapshot `docker ps -a`, `docker volume ls` and
`docker network ls` before and after, and diff them.**

## Adding a Command

1. Write it in `src/commands/`, taking `Ctx` as its first argument.
2. Register it in `src/cli.ts`.
3. Add it to `MENU_GROUPS` in `src/menu.ts` with its `command` string — `test/menu.test.ts`
   fails if a user-facing command is unreachable from the menu.
4. Completions need no work: they are generated from the commander tree by `specsFrom()`.

## Git Conventions

- Commit messages must not include `Co-Authored-By` or any sign-off attribution lines
- Use conventional commit prefixes with an emoji: `fix:`, `feat:`, `ci:`, `docs:`, `refactor:`
