# Public Services — Docker Stack

A centralized Docker-based infrastructure stack providing shared services for all local development projects. All containers run on a single shared bridge network (`public-service-network`) so any project container can reach MySQL, Redis, and Nginx by container name.

## Services

| Service      | Container       | Host Port | Description                     |
|--------------|-----------------|-----------|----------------------------------|
| MySQL 8.0    | `mysql-main`    | `43306`   | Shared relational database       |
| Redis        | `redis-main`    | `46379`   | Cache & message broker           |
| Nginx        | `nginx-main`    | `80/443`  | Reverse proxy for all projects   |
| phpMyAdmin   | `phpmyadmin`    | `18080`   | MySQL web management UI          |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) >= 24
- [Docker Compose](https://docs.docker.com/compose/) >= 2.20

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/public-services.git
cd public-services

# 2. Copy and configure environment variables
cp .env.example .env
# Edit .env and set strong passwords before running in any shared environment

# 3. Start all services
docker compose up -d

# 4. Verify everything is healthy
docker compose ps
```

phpMyAdmin will be available at `http://localhost:18080`.

## Configuration

All tuneable values live in `.env` (copy from `.env.example`):

| Variable            | Default     | Description                    |
|---------------------|-------------|-------------------------------|
| `MYSQL_DATABASE`    | `main`      | Default database name          |
| `MYSQL_USER`        | `main_user` | Application DB user            |
| `MYSQL_PASSWORD`    | `password`  | Application DB password        |
| `MYSQL_ROOT_PASSWORD` | `root`    | MySQL root password            |
| `MYSQL_PORT`        | `43306`     | Host port for MySQL            |
| `REDIS_PORT`        | `46379`     | Host port for Redis            |
| `PMA_PORT`          | `18080`     | Host port for phpMyAdmin       |

> **Never commit `.env`** — it is listed in `.gitignore`.

## Data Persistence

MySQL and Redis data is stored in bind-mounted local directories so it survives container restarts and re-creations:

```
data/
├── mysql/   ← MySQL data directory (/var/lib/mysql)
└── redis/   ← Redis AOF persistence (/data)
```

These directories are excluded from version control via `.gitignore`.

## Adding a New Site to Nginx

1. Create a new config file in `nginx/site-enabled/`, e.g. `myproject.test.conf`:

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
docker exec nginx-main nginx -s reload
```

## Connecting a Project Container to This Stack

Add the following to the project's `docker-compose.yml`:

```yaml
networks:
  public-service-network:
    external: true
```

Then attach any service that needs to reach MySQL or Redis to `public-service-network`. Within the network, use `mysql-main:3306` and `redis-main:6379` as connection hosts.

## SSL Certificates

Place certificate files in `nginx/certificates/`. They are mounted read-only into Nginx at `/etc/nginx/ssl/`. The directory is tracked in git but certificate files (`.crt`, `.key`, `.pem`) are excluded via `.gitignore`.

For local development, generate a self-signed certificate:

```bash
openssl req -x509 -nodes -days 365 \
  -subj "/CN=*.test" \
  -addext "subjectAltName=DNS:*.test" \
  -newkey rsa:2048 \
  -keyout nginx/certificates/local.key \
  -out nginx/certificates/local.crt
```

## Common Commands

```bash
# Start stack
docker compose up -d

# Stop stack (data is preserved)
docker compose down

# View logs
docker compose logs -f

# Rebuild a single service after Dockerfile changes
docker compose build nginx && docker compose up -d nginx

# Open MySQL shell
docker exec -it mysql-main mysql -u root -p

# Open Redis CLI
docker exec -it redis-main redis-cli
```

## Directory Structure

```
.
├── data/                   # Local persistent data (git-ignored)
│   ├── mysql/
│   └── redis/
├── mysql/
│   └── conf.d/             # Custom MySQL configuration
│       └── custom.cnf
├── nginx/
│   ├── Dockerfile
│   ├── certificates/       # SSL certs (git-ignored)
│   ├── settings/
│   │   ├── nginx.conf
│   │   └── mime.types
│   └── site-enabled/       # Virtual host configs
├── phpmyadmin/
│   ├── Dockerfile
│   ├── config.inc.php
│   └── custom-themes/
├── .env.example
├── .gitignore
└── docker-compose.yml
```

## License

MIT
