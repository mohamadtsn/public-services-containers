# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-05-24

### Added
- `Makefile` with targets: `up`, `up-proxy`, `up-pma`, `up-mail`, `up-storage`, `up-full`, `down`, `restart`, `status`, `logs`, `reset`, `build`, `install`, `uninstall`, `release`, `lint`, `backup`, `restore`
- `bin/pubservices` CLI: `status`, `info`, `up`, `down`, `restart`, `reload`, `logs`, `edit`, `reset`
- `scripts/install.sh` — install from GitHub release or local clone, auto-creates `.env` from `.env.example`
- `scripts/uninstall.sh` — stops containers, asks about data and config removal
- `scripts/release.sh` — semver bump, shellcheck lint, commit, tag, push
- `scripts/backup.sh` — MySQL dump + Redis AOF archive to `backups/`
- `scripts/restore.sh` — restore MySQL and Redis from backup archive
- `VERSION` file for semver tracking (`0.1.0`)
- `.shellcheckrc` — project-wide shellcheck configuration
- `.github/workflows/release.yml` — creates GitHub Release with archive on tag push
- `.github/workflows/validate.yml` — validates docker-compose syntax and shellcheck on push/PR
- Docker Compose profiles: `proxy` (Nginx), `pma` (phpMyAdmin), `mail` (Mailpit), `storage` (MinIO)
- **Mailpit** service — catch-all SMTP for local email testing (profile: `mail`)
- **MinIO** service — S3-compatible local object storage (profile: `storage`)
- `nginx/site-enabled/default.conf` — default Nginx server block (now loaded via volume mount)
- `nginx/certificates/.gitkeep` — tracks empty certificates directory
- `.gitkeep` files for `data/mysql/`, `data/redis/`, `data/minio/`
- Container names configurable via `.env` (`MYSQL_CONTAINER_NAME`, `REDIS_CONTAINER_NAME`, etc.)
- Network name configurable via `NETWORK_NAME` env var
- `NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT` configurable via `.env`
- `PMA_BLOWFISH_SECRET` env var for phpMyAdmin cookie auth encryption

### Changed
- **Nginx Dockerfile**: removed dead commented-out code; now `COPY settings/nginx.conf` at build time (no volume mount needed for static config)
- **`nginx.conf`**: fixed resolver `127.0.0.1` → `127.0.0.11` (Docker internal DNS)
- **`nginx.conf`**: `user root` → `user nginx` (security hardening)
- **`default.conf`**: moved from `nginx/configs/` to `nginx/site-enabled/` (was never loaded before)
- **`nginx` service**: added healthcheck (`nginx -t`); ports now use env vars
- **Redis**: updated image `6.0.17-alpine` → `7.2-alpine`
- **phpMyAdmin**: removed `config.inc.php` — now relies entirely on env vars and cookie auth
- **phpMyAdmin**: removed erroneous `depends_on: nginx`
- **phpMyAdmin**: `UPLOAD_LIMIT` increased to `512M`; split into own profile `pma`
- **MySQL healthcheck**: `--password=` → `-p` to prevent password appearing in process list
- **MySQL**: `MYSQL_ALLOW_EMPTY_PASSWORD` default changed `yes` → `no`
- **`.env.example`**: fully synced — now includes all services, ports, container names, and network name
- **`.gitignore`**: consolidated; removed per-directory nginx gitignores; uses negation patterns for `.gitkeep` files
- **`nginx/site-enabled/.gitignore`**: now tracks `default.conf` while still ignoring user site configs

### Removed
- `nginx/ssl/` directory (certificates live in `nginx/certificates/`)
- `nginx/configs/default.conf` (moved to `nginx/site-enabled/default.conf`)
- `nginx/site-generator/` scripts (obsolete)
- `phpmyadmin/config.inc.php` — auto-login without password, `AllowNoPassword = true` (security risk)
- `nginx/certificates/.gitignore` and `nginx/ssl/.gitignore` (consolidated into root `.gitignore`)

[1.0.0]: https://github.com/mohamadtsn/public-services-containers/releases/tag/v1.0.0