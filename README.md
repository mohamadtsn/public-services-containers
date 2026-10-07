# pubservices

Shared Docker infrastructure for local development, driven by a single TypeScript CLI.

MySQL, Redis, PostgreSQL, Nginx, phpMyAdmin, pgAdmin 4, Mailpit, and MinIO run on a single bridge network (`public-service-network`), so every project container reaches them by container name — no per-project database duplicate, no port juggling.

```bash
npm install -g pubservices
pubservices up --full
```

```
╭─ Public Services ──────────────────────── v2.0.0 ─╮
│ MySQL        ● healthy     localhost:43306        │
│ Redis        ● healthy     localhost:46379        │
│ PostgreSQL   ● healthy     localhost:45432        │
│ Nginx        ● healthy     :80 / :443             │
│ phpMyAdmin   ● running     http://localhost:18080 │
│ pgAdmin      ● running     http://localhost:18081 │
│ Mailpit      ○ not found   http://localhost:8025  │
│ MinIO        ○ not found   :9001 (API :9000)      │
╰───────────────────────────────────────────────────╯
  home    ~/.pubservices
  docker  29.7.2
```

Run `pubservices` with no arguments for an interactive terminal menu, or `pubservices dash` for a live dashboard.

---

## Services

| Service       | Container         | Host port               | Profile     | Default Credentials / Details |
|---------------|-------------------|-------------------------|-------------|-------------------------------|
| MySQL 8.0     | `mysql-main`      | `43306`                 | core        | `root` / `root` (db: `main`, user: `main_user` / `password`) |
| Redis 7.2     | `redis-main`      | `46379`                 | core        | AOF enabled                   |
| PostgreSQL 16 | `postgres-main`   | `45432`                 | `postgres`  | db: `main`, user: `main_user` / `password` |
| Nginx         | `nginx-main`      | `80` / `443`            | `proxy`     | Static sites & reverse proxy  |
| phpMyAdmin    | `phpmyadmin`      | `18080`                 | `pma`       | Web GUI for MySQL             |
| pgAdmin 4     | `pgadmin`         | `18081`                 | `pgadmin`   | Web GUI for PostgreSQL (`admin@local.dev` / `admin`) |
| Mailpit       | `mailpit`         | `8025` UI / `1025` SMTP | `mail`      | Local email testing           |
| MinIO         | `minio`           | `9001` UI / `9000` API  | `storage`   | S3-compatible object storage  |

MySQL and Redis always start by default. Optional services are opt-in to conserve system memory and CPU:

```bash
pubservices up                 # MySQL + Redis (core services)
pubservices up --postgres      # + PostgreSQL
pubservices up --proxy         # + Nginx
pubservices up --pma --pgadmin # + phpMyAdmin and pgAdmin
pubservices up --mail          # + Mailpit
pubservices up --storage       # + MinIO
pubservices up --full          # Start all services
pubservices up redis           # Start a single service
```

---

## Requirements

- Node.js >= 20
- Docker Engine >= 24 with the Compose v2 plugin

Run `pubservices doctor` to verify system requirements, permissions, and configurations.

---

## Commands

```
status              service health and ports               info      connection details & URLs
up [service]        start services (core or profiled)      down      stop services (data preserved)
restart [service]   restart services                       logs      follow service logs
build [service]     rebuild Docker images                  dash      interactive live dashboard
reload-proxy        test and reload Nginx configuration    edit      open .env in $EDITOR
backup              dump MySQL & Postgres, copy Redis      backups   list archives (--prune N)
restore [file]      restore databases from archive         reset     delete all data (destructive)
static …            manage static & SSR web applications   doctor    system & environment checks
migrate             import a legacy v1 installation        update    install newer release
completion …        install shell completions              run       execute command in home dir
home                print state directory path
```

Every command accepts `--json` (machine-readable output), `-y` / `--yes` (skip interactive confirmation prompts), and `--home <path>` (or the `PUBSERVICES_HOME` environment variable).

```bash
pubservices status --json | jq '.services[] | select(.status != "healthy")'
```

---

## Connecting from a Project

### From another container on Docker network
Add `public-service-network` as an external network in your project's `docker-compose.yml`:

```yaml
networks:
  public-service-network:
    external: true
    name: public-service-network
```

Connect using standard container hostnames:

```env
# MySQL
DB_HOST=mysql-main
DB_PORT=3306

# PostgreSQL
POSTGRES_HOST=postgres-main
POSTGRES_PORT=5432

# Redis
REDIS_HOST=redis-main
REDIS_PORT=6379

# Mailpit
MAIL_HOST=mailpit
MAIL_PORT=1025

# MinIO
AWS_ENDPOINT=http://minio:9000
```

### From the Host machine
Use `localhost` and mapped ports:
- MySQL: `localhost:43306`
- PostgreSQL: `localhost:45432`
- Redis: `localhost:46379`
- phpMyAdmin: `http://localhost:18080`
- pgAdmin 4: `http://localhost:18081`
- Mailpit UI: `http://localhost:8025`
- MinIO Console: `http://localhost:9001` (API: `localhost:9000`)

Run `pubservices info` to display ready-to-copy connection URLs and full credential details.

---

## Static Sites & SSR Application Deployments

`pubservices` includes built-in framework detection and automated deployment for frontend and Node.js web applications:

### Supported Frameworks & Modes
- **Vite / Create React App**: Auto-detected SPA; builds and syncs output to Nginx.
- **Next.js**: Auto-detects static export (`output: 'export'`) or SSR standalone server mode.
- **Nuxt**: Auto-detects static generation (`nuxt generate`) or SSR Nitro server mode.
- **Generic HTML / Static**: Any directory containing static build assets.

### Deploying a Site or App
```bash
# Auto-detects framework, builds (using npm/pnpm/yarn), and deploys:
pubservices static add myapp ~/projects/myapp

# Force fresh build before deploy:
pubservices static add myapp ~/projects/myapp --build

# Deploy an existing build directory directly without running a build:
pubservices static add myapp ~/projects/myapp/dist --no-build
```

- **Static sites** are checksum-synced into `~/.pubservices/nginx/static/myapp` and served directly by Nginx at `/srv/static/myapp`.
- **SSR applications** are automatically provisioned in a dedicated isolated container (`node:20-alpine`) on `public-service-network` with automatic port allocation and background lifecycle management.

### Updating & Managing Sites
```bash
pubservices static update myapp     # Re-sync static site or restart SSR container
pubservices static update           # Update all recorded sites at once
pubservices static list             # List deployed sites, framework, ports, and statuses
pubservices static remove myapp     # Remove static files or stop & tear down SSR container
```

### Exposing Host Directories (Direct Mount)
```bash
pubservices static mount ~/projects # Mounts host path directly into Nginx
pubservices up --proxy              # Restart Nginx to apply
pubservices static unmount          # Revert host mount
```

---

## Backup, Restore & Reset

### Backups
```bash
pubservices backup            # Creates ~/.pubservices/backups/backup_YYYYMMDD_HHMMSS.tar.gz
pubservices backups           # List existing archives with timestamps and sizes
pubservices backups --prune 5 # Retain newest 5 archives and remove older ones
```
- Dumps MySQL using `mysqldump --all-databases --single-transaction`.
- Dumps PostgreSQL using `pg_dumpall --clean`.
- Copies Redis `/data` directory (including AOF `appendonlydir`).
- Generates a structured `manifest.json` inside the archive.

### Restore
```bash
pubservices restore                      # Interactive picker from available backups
pubservices restore path/to/backup.tar.gz # Restore directly from an archive
```
- Safely stops Redis before file copy to prevent AOF rewrite on exit, then restarts it.
- Pipes SQL dumps back into MySQL and PostgreSQL containers.

### Reset (Destructive)
```bash
pubservices reset         # Clears data in data/{mysql,redis,postgres,minio}
pubservices reset --purge # Also removes .env and generated compose overrides
```
Container-owned files are deleted via an isolated throwaway container, needing no host `sudo`.

---

## Directory Layout (`$PUBSERVICES_HOME`)

All state and persistent files live under `$PUBSERVICES_HOME` (default: `~/.pubservices`):

```
~/.pubservices
├── .env                  configuration; edit with `pubservices edit`
├── docker-compose.yml    seeded from package, refreshed on CLI upgrades
├── nginx/
│   ├── site-enabled/     vhosts (local-dev-proxy writes here)
│   ├── certificates/     SSL certificates
│   └── static/           static web assets mounted at /srv/static
├── mysql/conf.d/         custom MySQL configuration
├── data/
│   ├── mysql/            persistent MySQL data
│   ├── postgres/         persistent PostgreSQL data
│   ├── redis/            persistent Redis data
│   └── minio/            persistent MinIO data
├── backups/              tar.gz backup archives
└── state.json            recorded deployed sites and app ports
```

---

## Shell Completion

Fast shell completion generated directly from the Commander CLI tree:

```bash
pubservices completion install        # Install for bash, zsh, and fish
pubservices completion install zsh    # Install for specific shell
pubservices completion show bash      # Output completion script to stdout
```

Files are written to standard user directories (`~/.local/share/bash-completion`, `~/.zsh/completion`, `~/.config/fish/completions`) without needing root privileges.

---

## Upgrading from v1

v1 was a bash script installed in `/usr/local/lib/public-services-containers`. To migrate:

```bash
npm install -g pubservices
cd /usr/local/lib/public-services-containers && sudo docker compose down
pubservices migrate
pubservices up --full
```

`migrate` reads the v1 installation without modifying it and copies configuration, certificates, static sites, backups, and database data to `~/.pubservices`. Once verified, the old directory can be safely removed.

---

## Ecosystem Integration

Designed to work seamlessly alongside [`local-dev-proxy`](https://github.com/mohamadtsn/local-dev-proxy), which manages per-project `.local` domains, automatic SSL certificates, and Nginx vhosts:

```bash
# Example static site with local-dev-proxy:
devproxy create -h myapp.local --static --name myapp --type static

# Example SSR application with local-dev-proxy:
devproxy create -h myapp.local --upstream localhost:45100
```

---

## License

MIT
