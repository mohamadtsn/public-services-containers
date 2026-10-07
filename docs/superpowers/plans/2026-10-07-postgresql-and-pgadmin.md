# PostgreSQL and pgAdmin 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostgreSQL (`postgres:16-alpine`) and pgAdmin 4 (`dpage/pgadmin4:latest`) services to pubservices with optional profile management, connection info, backup/restore/reset data management, shell completions, and full test suite coverage.

**Architecture:** Add service definitions and volume configurations to compose and env templates; extend the TypeScript CLI environment, profile resolution, and lifecycle commands with `--postgres` and `--pgadmin` flags; integrate PostgreSQL dump/restore into `backup` and `restore` commands and include PostgreSQL in `reset` data directory purging; update test sandboxes and suites.

**Tech Stack:** TypeScript, Docker Compose, Vitest, Commander.js, pgAdmin 4, PostgreSQL 16 Alpine.

**Spec:** [docs/superpowers/specs/2026-10-07-postgresql-and-pgadmin-design.md](file:///home/mohamadtsn/projects/docker/public-services/docs/superpowers/specs/2026-10-07-postgresql-and-pgadmin-design.md)

## Global Constraints

- Container names: `postgres-main`, `pgadmin` (customizable via `.env`)
- Network name: `public-service-network`
- Default PostgreSQL port: `45432`
- Default pgAdmin port: `18081`
- Profile names: `postgres`, `pgadmin`
- Rootless execution: container-owned files must never use host `sudo`, use `purgeDataDirs`
- Conventional commit messages with emoji prefix; no `Co-Authored-By` lines

## Review Focus

1. Unset `.env` values fall back cleanly to `src/env.ts` `DEFAULTS`.
2. `pubservices up` without flags starts only core services (MySQL and Redis), leaving PostgreSQL and pgAdmin stopped unless requested.
3. `pubservices up --full` starts all profiles including `postgres` and `pgadmin`.
4. `pubservices backup` dumps PostgreSQL only if the container is running; does not fail if PostgreSQL is stopped while MySQL/Redis are running.
5. `pubservices reset` cleanly purges `data/postgres` without requiring host privileges.

---

### Task 1: Environment, Templates & Home Initialization

**Files:**
- Modify: `templates/docker-compose.yml`
- Modify: `templates/.env.example`
- Modify: `src/env.ts`
- Modify: `src/home.ts`
- Test: `test/scaffold.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULTS.POSTGRES_PORT`, `DEFAULTS.POSTGRES_CONTAINER_NAME`, `DEFAULTS.PGADMIN_PORT`, `DEFAULTS.PGADMIN_CONTAINER_NAME`, etc. in `src/env.ts`
  - `ALL_PROFILES` with `'postgres'` and `'pgadmin'` in `src/env.ts`
  - `services(env: Env)` includes keys `'postgres'` and `'pgadmin'` in `src/env.ts`
  - `DIRS` in `src/home.ts` includes `'data/postgres'`

- [ ] **Step 1: Write the failing tests in `test/scaffold.test.ts`**

Update `test/scaffold.test.ts` to expect `postgres` and `pgadmin` in `services()` and check `data/postgres` creation in `ensureHome`:
```ts
expect(list.map((s) => s.key)).toEqual([
  'mysql',
  'redis',
  'postgres',
  'nginx',
  'phpmyadmin',
  'pgadmin',
  'mailpit',
  'minio',
]);
expect(existsSync(join(home, 'data/postgres'))).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scaffold.test.ts`
Expected: FAIL (missing `postgres` and `pgadmin` keys, missing `data/postgres` directory)

- [ ] **Step 3: Update `templates/docker-compose.yml`**

Add `postgres` and `pgadmin` services, and `main-pgadmin` volume.

- [ ] **Step 4: Update `templates/.env.example`**

Add default variables for PostgreSQL (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `POSTGRES_CONTAINER_NAME`) and pgAdmin (`PGADMIN_PORT`, `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, `PGADMIN_CONTAINER_NAME`).

- [ ] **Step 5: Update `src/env.ts` and `src/home.ts`**

In `src/env.ts`:
- Add `DEFAULTS` entries for Postgres and pgAdmin.
- Add `postgres` and `pgadmin` to `services(env)`.
- Add `'postgres'` and `'pgadmin'` to `ALL_PROFILES`.

In `src/home.ts`:
- Add `'data/postgres'` to `DIRS`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/scaffold.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add templates/docker-compose.yml templates/.env.example src/env.ts src/home.ts test/scaffold.test.ts
git commit -m "feat: ✨ add PostgreSQL and pgAdmin to compose template and environment defaults"
```

---

### Task 2: Profile Resolution, CLI Lifecycle Options & Shell Completions

**Files:**
- Modify: `src/profiles.ts`
- Modify: `src/cli.ts`
- Modify: `src/commands/completion.ts`
- Test: `test/lifecycle.test.ts`
- Test: `test/completion.test.ts`

**Interfaces:**
- Consumes: `ALL_PROFILES` from `src/env.ts`
- Produces:
  - `ProfileFlags.postgres?: boolean`, `ProfileFlags.pgadmin?: boolean` in `src/profiles.ts`
  - `--postgres` and `--pgadmin` CLI flags in `src/cli.ts`
  - Updated completion service lists in `src/commands/completion.ts`

- [ ] **Step 1: Write the failing tests in `test/lifecycle.test.ts` and `test/completion.test.ts`**

In `test/lifecycle.test.ts`:
```ts
expect(profilesForUp({ full: true })).toEqual(['proxy', 'pma', 'mail', 'storage', 'postgres', 'pgadmin']);
expect(profilesForUp({ postgres: true })).toEqual(['postgres']);
expect(profilesForUp({ pgadmin: true })).toEqual(['pgadmin']);
expect(profilesForAll({})).toEqual(['proxy', 'pma', 'mail', 'storage', 'postgres', 'pgadmin']);
```

In `test/completion.test.ts`:
Assert that generated shell completions contain `'postgres'` and `'pgadmin'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/lifecycle.test.ts test/completion.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement profile flags in `src/profiles.ts` and `src/cli.ts`**

In `src/profiles.ts`:
- Add `postgres?: boolean; pgadmin?: boolean;` to `ProfileFlags`.
- Add `['postgres', 'postgres']` and `['pgadmin', 'pgadmin']` to `FLAG_TO_PROFILE`.

In `src/cli.ts`:
- In `withProfiles(cmd)`:
  - Add `.option('--postgres', 'include PostgreSQL')`
  - Add `.option('--pgadmin', 'include pgAdmin')`

- [ ] **Step 4: Update completions in `src/commands/completion.ts`**

Update `services` variable in `bashScript`, `zshScript`, and `fishScript` to:
`mysql redis postgres nginx phpmyadmin pgadmin mailpit minio`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/lifecycle.test.ts test/completion.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/profiles.ts src/cli.ts src/commands/completion.ts test/lifecycle.test.ts test/completion.test.ts
git commit -m "feat: ⚡ support --postgres and --pgadmin profiles in CLI and shell completions"
```

---

### Task 3: Connection Info (`info` command)

**Files:**
- Modify: `src/commands/info.ts`
- Test: `test/commands.test.ts`

**Interfaces:**
- Consumes: `Env` from `src/env.ts`
- Produces: `postgres` and `pgadmin` sections in JSON and terminal output of `infoCommand`

- [ ] **Step 1: Write the failing test in `test/commands.test.ts`**

In `test/commands.test.ts`:
```ts
it('info includes postgres and pgadmin connection details', () => {
  const out = captureStdout();
  infoCommand(ctx);
  const parsed = JSON.parse(out.lines());
  out.restore();

  expect(parsed.postgres).toBeDefined();
  expect(parsed.postgres.port).toBe(45432);
  expect(parsed.postgres.url).toContain('postgresql://');
  expect(parsed.pgadmin).toBeDefined();
  expect(parsed.pgadmin.url).toBe('http://localhost:18081');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/commands.test.ts`
Expected: FAIL (parsed.postgres is undefined)

- [ ] **Step 3: Implement PostgreSQL and pgAdmin in `src/commands/info.ts`**

- Construct `postgresUrl`:
  `postgresql://${e.POSTGRES_USER}:${e.POSTGRES_PASSWORD}@localhost:${e.POSTGRES_PORT}/${e.POSTGRES_DB}`
- Add `postgres` and `pgadmin` objects to `emitJson`.
- Add `section('PostgreSQL', [...])` and `section('pgAdmin', [...])` to console output.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/info.ts test/commands.test.ts
git commit -m "feat: ℹ️ add PostgreSQL and pgAdmin connection info to info command"
```

---

### Task 4: Data Management (Backup, Restore, Reset)

**Files:**
- Modify: `src/commands/backup.ts`
- Modify: `src/commands/restore.ts`
- Modify: `src/commands/reset.ts`
- Test: `test/data.test.ts`

**Interfaces:**
- Produces:
  - `Manifest.contents.postgres: boolean` in `src/commands/backup.ts`
  - `restorePostgres(ctx: Ctx, sqlFile: string)` in `src/commands/restore.ts`
  - `purgeDataDirs` with `'postgres'` in `src/commands/reset.ts`

- [ ] **Step 1: Update `src/commands/backup.ts`**

- Update `Manifest`:
  ```ts
  contents: { mysql: boolean; redis: boolean; postgres: boolean };
  ```
- If `await isRunning(postgres)` is true:
  Dump databases using `pg_dumpall -U ${ctx.env.POSTGRES_USER} --clean` inside container via `docker exec -e PGPASSWORD=...` to `staging/postgres_all.sql`.
  Set `contents.postgres = true`.
- Check `if (!contents.mysql && !contents.redis && !contents.postgres) throw new UserError('Nothing to back up...');`.

- [ ] **Step 2: Update `src/commands/restore.ts`**

- Read `hasPostgres = manifest?.contents.postgres ?? existsSync(join(staging, 'postgres_all.sql'))`.
- Update confirmation prompt summary to list `PostgreSQL` if present.
- Implement `restorePostgres(ctx, sqlFile)`:
  Pipe SQL file into `docker exec -i -e PGPASSWORD=${ctx.env.POSTGRES_PASSWORD} ${container} psql -U ${ctx.env.POSTGRES_USER} -d ${ctx.env.POSTGRES_DB}`.

- [ ] **Step 3: Update `src/commands/reset.ts`**

- Change `purgeDataDirs(ctx.home, ['mysql', 'redis', 'minio', 'postgres'])`.
- Update warning prompt text to include PostgreSQL.

- [ ] **Step 4: Verify with tests in `test/data.test.ts`**

Run: `npx vitest run test/data.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/commands/backup.ts src/commands/restore.ts src/commands/reset.ts test/data.test.ts
git commit -m "feat: 💾 support PostgreSQL in backup, restore, and reset commands"
```

---

### Task 5: Sandboxes, Package Tests & Verification

**Files:**
- Modify: `test/sandbox.ts`
- Modify: `test/commands.test.ts`
- Modify: `test/package.test.ts`
- Test: Full test suite

**Interfaces:**
- Produces:
  - Isolated ports (`POSTGRES_PORT: '45532'`, `PGADMIN_PORT: '45881'`) in `test/sandbox.ts`
  - Isolated containers (`psvc-it-postgres`, `psvc-it-pgadmin`) in `test/sandbox.ts`
  - Updated service count assertions in `test/commands.test.ts` and `test/package.test.ts`

- [ ] **Step 1: Update `test/sandbox.ts`**

- Add to `PORTS`: `POSTGRES_PORT: '45532'`, `PGADMIN_PORT: '45881'`.
- Add to `CONTAINERS`: `POSTGRES_CONTAINER_NAME: `${PREFIX}postgres``, `PGADMIN_CONTAINER_NAME: `${PREFIX}pgadmin``.
- Add live names and ports to `LIVE` collision check list.
- Add `'postgres'` to `purgeDataDirs` in `destroy()`.

- [ ] **Step 2: Update service count assertions in tests**

In `test/commands.test.ts`:
Update `expect(parsed.services).toHaveLength(8)`.

In `test/package.test.ts`:
Update `expect(status.services).toHaveLength(8)`.

- [ ] **Step 3: Run full typecheck and tests**

Run: `npm run typecheck && npx vitest run`
Expected: PASS for all non-integration suites.

- [ ] **Step 4: Commit**

```bash
git add test/sandbox.ts test/commands.test.ts test/package.test.ts
git commit -m "test: 🧪 update test sandboxes and test suites for PostgreSQL and pgAdmin"
```
