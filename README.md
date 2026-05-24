# Public Services — Docker Stack

A centralized Docker-based infrastructure stack providing shared services for all local development projects. All containers run on a single shared bridge network (`public-service-network`) so any project container can reach MySQL, Redis, and Nginx by container name.

## Services

| Service        | Container       | Host Port              | Profile    | Description                    |
|----------------|-----------------|------------------------|------------|--------------------------------|
| MySQL 8.0      | `mysql-main`    | `43306`                | core       | Shared relational database     |
| Redis 7.2      | `redis-main`    | `46379`                | core       | Cache & message broker         |
| Nginx          | `nginx-main`    | `80` / `443`           | `proxy`    | Reverse proxy for all projects |
| phpMyAdmin     | `phpmyadmin`    | `18080`                | `pma`      | MySQL web management UI        |
| Mailpit        | `mailpit`       | `8025` UI / `1025` SMTP | `mail`   | Catch-all email for testing    |
| MinIO          | `minio`         | `9001` UI / `9000` API | `storage`  | S3-compatible local storage    |

**Core services** (MySQL + Redis) always start. Optional services each have their own profile:

```bash
make up            # core only (MySQL + Redis)
make up-proxy      # core + Nginx
make up-pma        # core + phpMyAdmin
make up-mail       # core + Mailpit
make up-storage    # core + MinIO
make up-full       # everything
```

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) >= 24
- [Docker Compose](https://docs.docker.com/compose/) >= 2.20
- `make`

## Installation

### System-wide (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/mohamadtsn/public-services-containers/master/scripts/install.sh | sudo bash
```

Or from a local clone:

```bash
git clone https://github.com/mohamadtsn/public-services-containers.git
cd public-services-containers
sudo scripts/install.sh
```

### Local / development

```bash
git clone https://github.com/mohamadtsn/public-services-containers.git
cd public-services-containers
cp .env.example .env
make up
```

## Quick Start

```bash
# Start core services
make up

# Start everything
make up-full

# Show status
make status

# View logs
make logs
```

## Configuration

All tuneable values live in `.env` (copy from `.env.example`):

**MySQL**

| Variable | Default | Description |
|---|---|---|
| `MYSQL_DATABASE` | `main` | Default database name |
| `MYSQL_USER` | `main_user` | Application DB user |
| `MYSQL_PASSWORD` | `password` | Application DB password |
| `MYSQL_ROOT_PASSWORD` | `root` | MySQL root password |
| `MYSQL_ALLOW_EMPTY_PASSWORD` | `no` | Allow empty root password |
| `MYSQL_PORT` | `43306` | Host port |
| `MYSQL_CONTAINER_NAME` | `mysql-main` | Container name |

**Redis**

| Variable | Default | Description |
|---|---|---|
| `REDIS_PORT` | `46379` | Host port |
| `REDIS_CONTAINER_NAME` | `redis-main` | Container name |

**Nginx** *(profile: `proxy`)*

| Variable | Default | Description |
|---|---|---|
| `NGINX_HTTP_PORT` | `80` | HTTP host port |
| `NGINX_HTTPS_PORT` | `443` | HTTPS host port |
| `NGINX_CONTAINER_NAME` | `nginx-main` | Container name ⚠️ |

**phpMyAdmin** *(profile: `pma`)*

| Variable | Default | Description |
|---|---|---|
| `PMA_PORT` | `18080` | Host port |
| `PMA_BLOWFISH_SECRET` | *(change this)* | Cookie encryption key — must be 32 chars |
| `PMA_CONTAINER_NAME` | `phpmyadmin` | Container name |

**Mailpit** *(profile: `mail`)*

| Variable | Default | Description |
|---|---|---|
| `MAILPIT_SMTP_PORT` | `1025` | SMTP host port |
| `MAILPIT_HTTP_PORT` | `8025` | Web UI host port |
| `MAILPIT_CONTAINER_NAME` | `mailpit` | Container name |

**MinIO** *(profile: `storage`)*

| Variable | Default | Description |
|---|---|---|
| `MINIO_ROOT_USER` | `minioadmin` | Root access key |
| `MINIO_ROOT_PASSWORD` | `minioadmin` | Root secret key |
| `MINIO_API_PORT` | `9000` | S3 API host port |
| `MINIO_CONSOLE_PORT` | `9001` | Web console host port |
| `MINIO_CONTAINER_NAME` | `minio` | Container name |

**Network**

| Variable | Default | Description |
|---|---|---|
| `NETWORK_NAME` | `public-service-network` | Shared Docker network name ⚠️ |

> ⚠️ **Never commit `.env`** — it is listed in `.gitignore`.
>
> ⚠️ `NGINX_CONTAINER_NAME` and `NETWORK_NAME` must match `~/.local-dev-proxy.conf` if you use `local-dev-proxy`.

## Makefile Targets

```bash
make up             # Start core services (MySQL + Redis)
make up-proxy       # Start core + Nginx
make up-pma         # Start core + phpMyAdmin
make up-mail        # Start core + Mailpit
make up-storage     # Start core + MinIO
make up-full        # Start all services
make down           # Stop all services (data preserved)
make restart        # Restart all running services
make status         # Show service status with ports
make logs           # Follow service logs
make build          # Rebuild Docker images (no cache)
make reset          # Stop services and delete all data (DESTRUCTIVE)
make backup         # Backup MySQL and Redis
make restore FILE=  # Restore from backup archive
make lint           # Run shellcheck on scripts
make install        # Install system-wide
make uninstall      # Remove system-wide installation
make release        # Bump patch version and publish
```

## pubservices CLI

After system-wide install, a `pubservices` CLI is available:

```bash
pubservices status          # Show all service status + ports
pubservices info            # Show connection details
pubservices up [service]    # Start services
pubservices down            # Stop all services
pubservices restart [svc]   # Restart services
pubservices reload-proxy    # Reload Nginx config (nginx -s reload)
pubservices logs [service]  # Follow logs
pubservices edit            # Edit .env in $EDITOR
pubservices reset           # Delete all data (DESTRUCTIVE)
```

## Adding a New Site to Nginx

1. Create a config in `nginx/site-enabled/`, e.g. `myproject.test.conf`:

```nginx
server {
    listen 80;
    server_name myproject.test;

    location / {
        proxy_pass http://myproject-container:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

2. Reload Nginx without downtime:

```bash
pubservices reload-proxy
# or: docker exec nginx-main nginx -s reload
```

## Connecting a Project to This Stack

Add to your project's `docker-compose.yml`:

```yaml
networks:
  public-service-network:
    external: true
```

Then attach services to `public-service-network`. Within the network, use:
- MySQL: `mysql-main:3306`
- Redis: `redis-main:6379`

## SSL / Domain Management

For SSL certificates and local domain routing (e.g. `myapp.test` with HTTPS), use [local-dev-proxy](https://github.com/mohamadtsn/local-dev-proxy). It integrates directly with this stack's Nginx container and handles certificate generation, site config creation, and domain resolution automatically.

> See the [Ecosystem](#ecosystem) section below for how the two packages work together.

## Email Testing with Mailpit

Start Mailpit with `make up-mail` or `make up-full`.

- **Web UI**: `http://localhost:8025`
- **SMTP**: `localhost:1025` (no authentication required)

Configure your app to send SMTP to `localhost:1025` and all outgoing emails will be caught by Mailpit instead of being delivered.

## Object Storage with MinIO

Start MinIO with `make up-storage` or `make up-full`.

- **Console**: `http://localhost:9001` (user: `minioadmin`, pass: `minioadmin`)
- **S3 API**: `http://localhost:9000`

Configure your app's S3 client to point to `http://localhost:9000` with the credentials from `.env`. MinIO is fully S3-compatible.

## Backup & Restore

```bash
# Create backup (MySQL dump + Redis AOF)
make backup

# Restore from backup
make restore FILE=backups/backup_20260101_120000.tar.gz
```

## Ecosystem

This package works together with [local-dev-proxy](https://github.com/mohamadtsn/local-dev-proxy):

| Package | Responsibility |
|---|---|
| **public-services** | Shared services: MySQL, Redis, Nginx, phpMyAdmin, MinIO |
| **local-dev-proxy** | Domain management, SSL, nginx site configs for projects |

> ⚠️ If you use `local-dev-proxy`, keep `NGINX_CONTAINER_NAME=nginx-main` and `NETWORK_NAME=public-service-network` (the defaults) — or update `~/.local-dev-proxy.conf` to match.

## Directory Structure

```
.
├── bin/
│   └── pubservices             # CLI entrypoint
├── data/                       # Persistent data (git-ignored content)
│   ├── mysql/
│   └── redis/
├── mysql/
│   └── conf.d/
│       └── custom.cnf
├── nginx/
│   ├── Dockerfile
│   ├── certificates/           # SSL certs (git-ignored)
│   ├── settings/
│   │   └── nginx.conf
│   └── site-enabled/           # Virtual host configs
│       └── default.conf
├── scripts/
│   ├── backup.sh
│   ├── install.sh
│   ├── release.sh
│   ├── restore.sh
│   └── uninstall.sh
├── .env.example
├── .gitignore
├── .shellcheckrc
├── CHANGELOG.md
├── docker-compose.yml
├── Makefile
└── VERSION
```

## License

MIT
