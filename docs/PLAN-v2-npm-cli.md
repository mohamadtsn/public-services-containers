# Plan — v2: pubservices as an npm CLI

Status: proposed · Target: `pubservices@2.0.0` · Decisions locked with owner (interactive + dash, hybrid home, mid-port)

---

## 1. Goal

Replace the bash `bin/pubservices` + `scripts/install.sh` installer with a TypeScript CLI
published to npm, installed with `npm i -g pubservices`. Same command name, same behaviour,
plus an interactive environment. Root usage reduced to ~zero.

Both npm names are free (checked): `pubservices` (primary), `public-services-containers` (alias/deprecated stub).

---

## 2. Shape of the new interface

Three entry modes from one binary:

| Invocation | Behaviour |
|---|---|
| `pubservices` (no args) | Interactive menu — `@clack/prompts`, arrow keys, grouped actions |
| `pubservices status`, `pubservices up --full`, … | Direct, non-interactive, scriptable (`--json`, `--yes`) |
| `pubservices dash` | Live full-screen TUI (Ink), auto-refreshing health table + hotkeys |

Everything the current CLI does stays reachable in all relevant modes. Nothing is menu-only.

---

## 3. Root problem — how it is solved

Current root touchpoints and their replacements:

| # | Today needs root | v2 solution | Root left |
|---|---|---|---|
| 1 | `install.sh` writes `/usr/local/lib` + `/usr/local/bin` + `/etc/bash_completion.d` | Deleted. `npm i -g` handles code install | only npm's own prefix |
| 2 | `.env`, `nginx/site-enabled`, `certificates` are root-owned, chowned back to user | State lives in `$PUBSERVICES_HOME` (default `~/.pubservices`) — user-owned from birth | none |
| 3 | `make reset` → `sudo rm -rf data/mysql/*` (files are uid 999) | Throwaway container does the delete:<br>`docker run --rm -v <home>/data:/d alpine sh -c 'rm -rf /d/mysql/* …'` | none |
| 4 | `restore.sh` writes Redis AOF into root-owned `data/redis` | `docker cp` into the running `redis-main` container | none |
| 5 | `backup.sh` reads `data/redis/appendonly.aof` from host | `docker cp redis-main:/data/. →` tmp (also fixes Redis 7 `appendonlydir/`) | none |
| 6 | nginx binds :80/:443 | Docker daemon binds them, never the CLI | none |
| 7 | completions to `/etc/…` | `pubservices completion install` → `~/.zsh/completions`, `~/.bash_completion.d`, `~/.config/fish/completions` | none |

**Escape hatch:** `src/privilege.ts` exports `withRoot(reason, argv)`. If a future command truly
needs root it prints *why* in one line and re-execs `sudo -E node <cli> …`. Target: unused in v2.

**npm prefix note:** if the user's npm prefix is root-owned, `npm i -g` needs one `sudo`. `doctor`
detects this and prints the two-line fix (`npm config set prefix ~/.npm-global`) instead of
telling the user to sudo forever.

---

## 4. Filesystem layout (hybrid)

```
node_modules/pubservices/          ← code + templates (root-owned, read-only, fine)
  dist/cli.js
  templates/
    docker-compose.yml
    .env.example
    nginx/{Dockerfile,settings/,site-enabled/default.conf}
    mysql/conf.d/custom.cnf

$PUBSERVICES_HOME  (default ~/.pubservices)   ← all mutable state, user-owned
  .env
  docker-compose.yml               ← seeded/refreshed from templates
  docker-compose.override.yml      ← user, written by `static mount`
  nginx/{site-enabled,certificates,static,settings,Dockerfile}
  mysql/conf.d/
  data/{mysql,redis,minio}
  backups/
  state.json                       ← seeded version, static-site sources
```

`ensureHome()` runs before every command: creates dirs, seeds `.env` on first run, and
re-syncs template files when the package version is newer than `state.json.version`.
**It never touches `data/`.** This is `install.sh`'s only remaining job, done without root.

### local-dev-proxy compatibility — verified safe
`devproxy` resolves `CERT_DIR` / `SITE_ENABLED_DIR` by `docker inspect nginx-main` and reading the
bind-mount **sources** (`bin/devproxy:34-43`). It does not hardcode `/usr/local/lib/...`. Moving the
home directory therefore requires no devproxy change — it follows automatically once nginx restarts.
Container names and `public-service-network` stay unchanged in the templates.

---

## 5. Command surface

Parity (all current commands kept):

```
status [--json]              info [--json]
up [service] [--proxy|--pma|--mail|--storage|--full]
down [service]               restart [service]
logs [service] [-n N]        reload-proxy
edit                         build [--no-cache]
backup                       restore <file>
run <cmd...>                 reset
static add <name> [src]      static update [name]
static remove <name>         static list
static mount [path]          static unmount
update                       help
```

New:

```
dash                 live Ink dashboard
doctor               docker present? daemon up? ports free? npm prefix? home writable? devproxy detected?
migrate              one-shot move from /usr/local/lib/public-services-containers → $PUBSERVICES_HOME
completion install   user-scoped shell completions (bash/zsh/fish)
home                 print $PUBSERVICES_HOME (for scripts / cd)
```

Changed semantics:
- `static-add` → `static add` (sub-noun grouping); old hyphenated forms kept as hidden aliases for one major version.
- `update` → checks npm registry, then runs `npm i -g pubservices@latest` (no more curl|sudo bash).
- `run` → executes a command with cwd = `$PUBSERVICES_HOME`.

Global flags: `--yes` (skip confirms), `--json`, `--no-color` / `NO_COLOR`, `--home <path>` / `PUBSERVICES_HOME`.

---

## 6. Design language

One module, `src/ui.ts`, owns every visual decision. No ad-hoc escape codes anywhere else.

- Palette: cyan brand, green ok, yellow warn, red error, dim meta. `picocolors`, auto-off on `NO_COLOR`/non-TTY.
- Symbols: `●` running · `○` stopped · `✓` done · `✗` fail · `⚠` warn · `›` step.
- Width-safe table helper (strips ANSI before padding — fixes the manual `sed`-based padding in `_row`).
- Every long op gets a `@clack` spinner; every destructive op a typed confirm.

Direct mode:

```
  ╭─ Public Services ───────────────────────────── v2.0.0 ─╮
  │  MySQL        ● healthy      localhost:43306           │
  │  Redis        ● healthy      localhost:46379           │
  │  Nginx        ○ stopped      :80 / :443                │
  │  phpMyAdmin   ● running      http://localhost:18080    │
  │  Mailpit      ○ not found    http://localhost:8025     │
  │  MinIO        ● healthy      :9001  (API :9000)        │
  ╰────────────────────────────────────────────────────────╯
     home  ~/.pubservices          docker  28.1.1
```

Interactive menu:

```
┌  pubservices v2.0.0 · ~/.pubservices
│
◆  What do you want to do?
│  ● Services    start · stop · restart · rebuild
│  ○ Monitor     status · logs · dashboard
│  ○ Static      add · update · remove · list
│  ○ Data        backup · restore · reset
│  ○ Config      edit .env · doctor · update
└
```

Dashboard (`dash`): same table, refresh 2s, footer `[u]p [d]own [r]estart [l]ogs [/]filter [q]uit`.

---

## 7. Stack

`typescript` · `commander` (routing/help) · `@clack/prompts` (interaction) · `picocolors` ·
`dotenv` · `ink` + `react` (dash only, dynamic-imported) · `tsup` (bundle) · `vitest` (tests).

Deliberately **not** added: `execa` (node:child_process is enough), `chalk` (picocolors), any
config/DI framework. Docker is shelled out to — no dockerode.

Node engine: `>=20`.

---

## 8. Files: added / changed / deleted

**Added**
```
package.json  tsconfig.json  tsup.config.ts
src/cli.ts  src/menu.ts  src/dash.tsx  src/ui.ts
src/home.ts  src/env.ts  src/docker.ts  src/privilege.ts  src/state.ts
src/commands/{status,info,up,down,restart,logs,reload,edit,build,run,
              backup,restore,reset,static,update,doctor,migrate,completion}.ts
templates/…            (docker-compose.yml, .env.example, nginx/, mysql/)
test/{home,docker,ui}.test.ts
```

**Deleted**
```
bin/pubservices          → src/
scripts/install.sh       → npm + ensureHome()   (per owner: no longer needed)
scripts/uninstall.sh     → npm rm -g  +  `pubservices reset --purge`
scripts/backup.sh        → src/commands/backup.ts
scripts/restore.sh       → src/commands/restore.ts
```

**Kept as-is**
```
scripts/release.sh       (bash, per decision)
.github/workflows/release.yml   + npm publish step
completion/*             regenerated content, same three files
docker-compose.yml       moves under templates/, contents unchanged
```

**Makefile** shrinks to dev-only targets: `build`, `test`, `lint`, `release*`. Service targets
(`up`, `up-full`, …) are dropped — the CLI is the interface now, and `pubservices run make …`
in the installed home no longer has a Makefile to run.

---

## 9. Release & CI

- `validate.yml`: `npm ci` → `tsc --noEmit` → `vitest run` → `docker compose -f templates/docker-compose.yml config`. Drop shellcheck for deleted scripts, keep it for `release.sh`.
- `release.yml`: on `v*` tag → validate → build → `npm publish --provenance --access public` → GitHub Release (tarball kept for one version so old installs can still update).
- `scripts/release.sh` additionally syncs `VERSION` ↔ `package.json` version.

---

## 10. Migration for existing users

`pubservices migrate` (also offered automatically when v2 starts and the old dir exists):

1. Detect `/usr/local/lib/public-services-containers`.
2. `docker compose down` the old stack.
3. Copy `.env`, `nginx/site-enabled`, `nginx/certificates`, `nginx/static`, `backups` → new home (plain `cp`, all readable).
4. Copy `data/` with a throwaway container so uid-999 files survive without sudo:
   `docker run --rm -v old/data:/from -v new/data:/to alpine cp -a /from/. /to/`
5. Start the stack from the new home; devproxy re-detects paths on next run.
6. Print the one command the user may run themselves to reclaim the old dir:
   `sudo rm -rf /usr/local/lib/public-services-containers` (never run automatically).

---

## 11. Phases

| Phase | Content | Ships |
|---|---|---|
| 0 ✅ | Scaffold: package.json, tsup, tsconfig, CI skeleton, `ui.ts`, `home.ts`, `docker.ts`, `state.ts`, `env.ts`, `privilege.ts` | nothing user-visible |
| 1 ✅ | Read-only commands: `status`, `info`, `doctor`, `home`, `--json` | usable alongside v1 |
| 2 ✅ | Lifecycle: `up/down/restart/logs/build/reload-proxy/edit/run` | full parity minus data |
| 3 ✅ | Data: `backup`, `restore`, `reset` — all root-free via containers | parity reached |
| 4 ✅ | `static *` group + override-file generation | parity complete |
| 5 ✅ | Interactive menu (`@clack`) + `completion install` | the "environment" |
| 6 ✅ | `dash` (Ink) | the dashboard |
| 7 ✅ | `migrate`, `update`, delete bash scripts, README/CLAUDE.md rewrite, publish `2.0.0` | release |

---

## 11a. Test safety (production stack on the dev machine)

The live v1 stack is bind-mounted from `/usr/local/lib/public-services-containers`
(verified via `docker inspect`). Two rails keep the test suite away from it:

- `test/setup.ts` refuses to run if `PUBSERVICES_HOME` resolves outside the OS temp
  directory, or matches `~/.pubservices` / the legacy install path.
- Command tests override every `*_CONTAINER_NAME` to `pubservices-test-*`, so even a
  read-only `docker inspect` never names a live container.

`src/legacy.ts` documents the legacy path as read-only: `doctor` detects it, `migrate`
copies out of it, nothing ever writes to or deletes it.

Lifecycle commands are exercised against a **sandbox stack** (`test/sandbox.ts`): its own
compose project (`psvc-it`), network (`psvc-it-network`), container prefix (`psvc-it-`) and
port block (`452xx`). `assertIsolated()` re-checks every one of those against the shipped
defaults before each run and again before any destructive call, so a change to the defaults
fails the suite rather than reaching a live container. Verified after each run: container,
network and volume listings are byte-identical to the pre-run snapshot.

Backup/restore/reset are proven on a real round-trip in `test/data.test.ts`: MySQL and Redis
are seeded, backed up, wiped, restored and verified, then `reset` clears the container-owned
data directories. `fileParallelism: false` keeps the two integration suites from tearing down
each other's sandbox — they share one fixed project name and port block by design.

Static-site tests need no Docker at all: they sync real directories inside temp dirs and assert
on the result, including the v1 `.sources/` fallback and the name guard that keeps a site name
from escaping `nginx/static/`.

The menu is guarded two ways: `MENU_GROUPS` carries the equivalent CLI command for each action,
and a test asserts every command a user would otherwise type is reachable — adding a command
without a menu entry fails CI. `runMenu` refuses to open without a TTY instead of hanging on a
prompt, so a piped `pubservices` prints status and exits.

Completions are generated from the commander tree (`specsFrom`) instead of the three hand-kept
files v1 shipped, and the generated bash and zsh scripts are syntax-checked with `bash -n` /
`zsh -n` plus a live completion run.

`dash` is dynamically imported and `splitting: true` puts it in its own chunk, so React and Ink
are never parsed by a plain `pubservices status` (`--version` runs in ~50 ms). It refuses to open
without a TTY, shows "checking" until the first inspect returns rather than reporting a healthy
stack as down, and asks before the one destructive key (`x` = stop). A test pins its colour and
glyph tables to the full `ContainerStatus` union.

`migrate` is tested only against a simulated v1 installation in a temp directory: every test
passes an explicit `from` and asserts it is not `LEGACY_INSTALL_DIR`. After each run the real
installation's tree, checksums and mtimes are diffed against a pre-run fingerprint — all
identical, and the v1 CLI still runs.

`test/package.test.ts` closes the last gap: it packs the tarball, installs it globally into a
temp npm prefix (no root) and drives the installed `pubservices` binary, so a template missing
from `files`, a broken `bin` entry or a runtime dependency misfiled as a dev dependency fails
the suite rather than the first user.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Data loss during migration | Copy, never move; old dir left untouched; `backup` run first and offered by `migrate` |
| npm global install still needs sudo on some setups | `doctor` detects root-owned prefix and prints the prefix fix |
| Redis 7 AOF layout (`appendonlydir/`) breaks old backup assumption | New backup uses `docker cp` of the whole `/data` — fixes an existing latent bug |
| devproxy breakage | Verified: path is auto-detected from container mounts, not hardcoded |
| Windows | Out of scope for v2 (Docker paths + bind mounts); Node makes it possible later |
