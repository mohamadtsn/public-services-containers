# Design Specification: PostgreSQL and pgAdmin 4 Service Integration

**Date:** 2026-10-07  
**Status:** Approved  
**Author:** Pair Programming (Antigravity & Mohamadtsn)

---

## 1. Overview & Objectives

`pubservices` provides local Docker infrastructure for development environments. Currently, it supports MySQL, Redis, Nginx, phpMyAdmin, Mailpit, and MinIO.

This specification details adding:
1. **PostgreSQL** (`postgres:16-alpine`) as an optional database service managed under the `postgres` compose profile.
2. **pgAdmin 4** (`dpage/pgadmin4:latest`) as an optional web management interface under the `pgadmin` compose profile, analogous to phpMyAdmin.
3. Full integration into CLI commands: lifecycle (`up`, `down`, `restart`, `logs`, `build`), connection info (`info`), data management (`backup`, `restore`, `reset`), home initialization (`ensureHome`), shell completions (`bash`, `zsh`, `fish`), and test sandboxes.

---

## 2. Docker Compose & Environment Configuration

### 2.1 Compose Template (`templates/docker-compose.yml`)

#### PostgreSQL Service
```yaml
  postgres:
    image: 'postgres:16-alpine'
    container_name: ${POSTGRES_CONTAINER_NAME:-postgres-main}
    profiles:
      - postgres
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    restart: unless-stopped
    ports:
      - '${POSTGRES_PORT:-45432}:5432'
    environment:
      POSTGRES_DB: '${POSTGRES_DB:-main}'
      POSTGRES_USER: '${POSTGRES_USER:-main_user}'
      POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:-password}'
    volumes:
      - './data/postgres:/var/lib/postgresql/data'
    networks:
      - public-service-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-main_user} -d ${POSTGRES_DB:-main}"]
      interval: 10s
      retries: 5
      timeout: 5s
```

#### pgAdmin 4 Service
```yaml
  pgadmin:
    image: 'dpage/pgadmin4:latest'
    container_name: ${PGADMIN_CONTAINER_NAME:-pgadmin}
    profiles:
      - pgadmin
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    restart: unless-stopped
    ports:
      - '${PGADMIN_PORT:-18081}:80'
    environment:
      PGADMIN_DEFAULT_EMAIL: '${PGADMIN_DEFAULT_EMAIL:-admin@local.dev}'
      PGADMIN_DEFAULT_PASSWORD: '${PGADMIN_DEFAULT_PASSWORD:-admin}'
      PGADMIN_LISTEN_PORT: 80
    volumes:
      - 'main-pgadmin:/var/lib/pgadmin'
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - public-service-network
```

#### Volumes
Under top-level `volumes:` in `docker-compose.yml`:
```yaml
volumes:
  main-phpmyadmin:
    driver: local
  main-pgadmin:
    driver: local
```

### 2.2 Environment Variables (`templates/.env.example`)
Add the following defaults:
```env
# PostgreSQL
POSTGRES_DB=main
POSTGRES_USER=main_user
POSTGRES_PASSWORD=password
POSTGRES_PORT=45432

# pgAdmin
PGADMIN_PORT=18081
PGADMIN_DEFAULT_EMAIL=admin@local.dev
PGADMIN_DEFAULT_PASSWORD=admin

# Container names
POSTGRES_CONTAINER_NAME=postgres-main
PGADMIN_CONTAINER_NAME=pgadmin
```

---

## 3. TypeScript CLI Integration

### 3.1 `src/env.ts`
- Extend `DEFAULTS` with:
  - `POSTGRES_CONTAINER_NAME`: `'postgres-main'`
  - `PGADMIN_CONTAINER_NAME`: `'pgadmin'`
  - `POSTGRES_DB`: `'main'`
  - `POSTGRES_USER`: `'main_user'`
  - `POSTGRES_PASSWORD`: `'password'`
  - `POSTGRES_PORT`: `'45432'`
  - `PGADMIN_PORT`: `'18081'`
  - `PGADMIN_DEFAULT_EMAIL`: `'admin@local.dev'`
  - `PGADMIN_DEFAULT_PASSWORD`: `'admin'`
- Extend `services(env: Env)`:
  ```ts
  {
    key: 'postgres',
    label: 'PostgreSQL',
    container: env.POSTGRES_CONTAINER_NAME,
    profile: 'postgres',
    address: `localhost:${env.POSTGRES_PORT}`,
  },
  {
    key: 'pgadmin',
    label: 'pgAdmin',
    container: env.PGADMIN_CONTAINER_NAME,
    profile: 'pgadmin',
    address: `http://localhost:${env.PGADMIN_PORT}`,
  }
  ```
- Update `ALL_PROFILES`:
  ```ts
  export const ALL_PROFILES = [
    'proxy',
    'pma',
    'mail',
    'storage',
    'postgres',
    'pgadmin',
  ] as const;
  ```

### 3.2 `src/profiles.ts`
- Extend `ProfileFlags` with `postgres?: boolean; pgadmin?: boolean;`.
- Add entries to `FLAG_TO_PROFILE`:
  ```ts
  ['postgres', 'postgres'],
  ['pgadmin', 'pgadmin'],
  ```

### 3.3 `src/cli.ts`
- In `withProfiles(cmd)`:
  - Add `.option('--postgres', 'include PostgreSQL')`.
  - Add `.option('--pgadmin', 'include pgAdmin')`.

### 3.4 `src/commands/info.ts`
- Compute `postgresUrl = "postgresql://${e.POSTGRES_USER}:${e.POSTGRES_PASSWORD}@localhost:${e.POSTGRES_PORT}/${e.POSTGRES_DB}"`.
- Output postgres connection info in JSON and box format:
  - Host: `localhost:${e.POSTGRES_PORT}`
  - Database: `e.POSTGRES_DB`
  - User: `e.POSTGRES_USER`
  - Password: `e.POSTGRES_PASSWORD`
  - URL: `postgresUrl`
  - Container host: `${e.POSTGRES_CONTAINER_NAME}:5432`
- Output pgAdmin info:
  - URL: `http://localhost:${e.PGADMIN_PORT}`
  - Email: `e.PGADMIN_DEFAULT_EMAIL`
  - Password: `e.PGADMIN_DEFAULT_PASSWORD`

### 3.5 `src/home.ts`
- Add `'data/postgres'` to `DIRS` array so it is created inside `~/.pubservices` during initialization.

---

## 4. Data Operations: Backup, Restore & Reset

### 4.1 Backup (`src/commands/backup.ts`)
- Update `Manifest`:
  ```ts
  export interface Manifest {
    format: 1;
    createdBy: string;
    createdAt: string;
    contents: { mysql: boolean; redis: boolean; postgres: boolean };
  }
  ```
- Check if PostgreSQL container is running:
  ```ts
  if (await isRunning(postgres)) {
    say.step('Dumping PostgreSQL databases...');
    const res = await run(
      'docker',
      [
        'exec',
        '-e',
        `PGPASSWORD=${ctx.env.POSTGRES_PASSWORD}`,
        postgres,
        'pg_dumpall',
        '-U',
        ctx.env.POSTGRES_USER,
        '--clean',
      ],
      { stdoutFile: join(staging, 'postgres_all.sql') },
    );
    if (res.code !== 0) {
      throw new UserError('pg_dumpall failed.', (res.stderr || '').trim());
    }
    contents.postgres = true;
    say.ok('PostgreSQL dump complete.');
  }
  ```
- Update emptiness check: `if (!contents.mysql && !contents.redis && !contents.postgres) { ... }`.

### 4.2 Restore (`src/commands/restore.ts`)
- Check `const hasPostgres = manifest?.contents.postgres ?? existsSync(sqlPgFile);`.
- Implement `restorePostgres(ctx, sqlPgFile)`:
  - Verify container is running.
  - Pipe SQL into `docker exec -i -e PGPASSWORD=${ctx.env.POSTGRES_PASSWORD} ${container} psql -U ${ctx.env.POSTGRES_USER} -d ${ctx.env.POSTGRES_DB}`.

### 4.3 Reset (`src/commands/reset.ts`)
- Add `'postgres'` to `purgeDataDirs(ctx.home, ['mysql', 'redis', 'minio', 'postgres'])`.
- Update prompt: `This permanently deletes all MySQL, Redis, PostgreSQL and MinIO data.`

---

## 5. Completions & Testing

### 5.1 Shell Completions (`src/commands/completion.ts`)
- Update service lists in `bashScript`, `zshScript`, and `fishScript`:
  - `mysql redis postgres nginx phpmyadmin pgadmin mailpit minio`.

### 5.2 Sandbox & Tests (`test/`)
- `test/sandbox.ts`:
  - Add isolated ports: `POSTGRES_PORT: '45532'`, `PGADMIN_PORT: '45881'`.
  - Add isolated containers: `POSTGRES_CONTAINER_NAME: '${PREFIX}postgres'`, `PGADMIN_CONTAINER_NAME: '${PREFIX}pgadmin'`.
  - Add live collision guards for postgres and pgadmin ports/names.
  - Add `'postgres'` to sandbox `purgeDataDirs` in `destroy()`.
- `test/scaffold.test.ts`:
  - Update expected service list in `services(loadEnv(dir))` to include `'postgres'` and `'pgadmin'`.
- `test/commands.test.ts`:
  - Update expected service length from 6 to 8.
- `test/package.test.ts`:
  - Update expected service count to 8.
- `test/lifecycle.test.ts`:
  - Update `profilesForUp({ full: true })` and `profilesForAll({})` expectations to include `'postgres'` and `'pgadmin'`.
- `test/data.test.ts`:
  - Verify `resetCommand` empties `data/postgres` as well.
