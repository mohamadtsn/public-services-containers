# pubservices

Shared Docker infrastructure for local development, driven by one CLI.

MySQL, Redis, Nginx, phpMyAdmin, Mailpit and MinIO run on a single bridge network
(`public-service-network`), so every project container reaches them by container name — no
per-project database, no port juggling.

```bash
npm install -g pubservices
pubservices up --full
```

```
╭─ Public Services ──────────────────────── v2.0.0 ─╮
│ MySQL        ● healthy     localhost:43306        │
│ Redis        ● healthy     localhost:46379        │
│ Nginx        ● healthy     :80 / :443             │
│ phpMyAdmin   ● running     http://localhost:18080 │
│ Mailpit      ○ not found   http://localhost:8025  │
│ MinIO        ○ not found   :9001 (API :9000)      │
╰───────────────────────────────────────────────────╯
  home  ~/.pubservices
  docker  29.7.2
```

Run `pubservices` with no arguments for an interactive menu, or `pubservices dash` for a live
dashboard.

## Services

| Service    | Container    | Host port                | Profile   |
|------------|--------------|--------------------------|-----------|
| MySQL 8.0  | `mysql-main` | `43306`                  | core      |
| Redis 7.2  | `redis-main` | `46379`                  | core      |
| Nginx      | `nginx-main` | `80` / `443`             | `proxy`   |
| phpMyAdmin | `phpmyadmin` | `18080`                  | `pma`     |
| Mailpit    | `mailpit`    | `8025` UI / `1025` SMTP  | `mail`    |
| MinIO      | `minio`      | `9001` UI / `9000` API   | `storage` |

MySQL and Redis always start. The rest are opt-in:

```bash
pubservices up                 # MySQL + Redis
pubservices up --proxy         # + Nginx
pubservices up --pma --mail    # + phpMyAdmin and Mailpit
pubservices up --full          # everything
pubservices up redis           # just one service
```

## Requirements

- Node.js >= 20
- Docker Engine >= 24 with the Compose v2 plugin

`pubservices doctor` checks all of this and reports anything that needs fixing.

## Commands

```
status          service health and ports              info      connection details
up / down       start / stop services                 restart   restart services
logs            follow service logs                   build     rebuild images
reload-proxy    test and reload the Nginx config      edit      open .env in $EDITOR
backup          dump MySQL, copy Redis data           backups   list archives (--prune N)
restore [file]  restore from an archive               reset     delete all data (destructive)
static …        manage static sites                   dash      live dashboard
doctor          check the environment                 migrate   import a v1 installation
update          install a newer release               home      print the state directory
completion …    install shell completions             run       run a command in the home dir
```

Every command accepts `--json` (machine-readable), `-y/--yes` (skip confirmations) and
`--home <path>` (or the `PUBSERVICES_HOME` environment variable).

```bash
pubservices status --json | jq '.services[] | select(.status != "healthy")'
```

## Where things live

Everything mutable lives in `$PUBSERVICES_HOME`, defaulting to `~/.pubservices`:

```
~/.pubservices
├── .env                  configuration; edit with `pubservices edit`
├── docker-compose.yml    seeded from the package, refreshed on upgrade
├── nginx/
│   ├── site-enabled/     vhosts (local-dev-proxy writes here)
│   ├── certificates/     SSL certificates
│   └── static/           static sites, mounted read-only at /srv/static
├── mysql/conf.d/
├── data/{mysql,redis,minio}
└── backups/
```

The package itself is read-only. Nothing here needs root — including deleting MySQL's data,
which is done from inside a throwaway container rather than with `sudo rm`.

## Connecting from a project

From another container on the network, use the container name:

```env
DB_HOST=mysql-main
DB_PORT=3306
REDIS_HOST=redis-main
REDIS_PORT=6379
MAIL_HOST=mailpit
MAIL_PORT=1025
```

From the host, use `localhost` and the mapped port. `pubservices info` prints both, plus
ready-made connection URLs.

Join the network from your project's compose file:

```yaml
networks:
  public-service-network:
    external: true
    name: public-service-network
```

## Static sites

`~/.pubservices/nginx/static/` is mounted into Nginx at `/srv/static/`.

```bash
cd ~/projects/myapp && npm run build
pubservices static add myapp ~/projects/myapp/dist
devproxy create -h myapp.local --static --root /srv/static/myapp

pubservices static update myapp   # after each rebuild
pubservices static update         # or every site at once
pubservices static list
```

The sync uses `rsync --checksum`, so a rebuild that changes only a content hash — same file
size, same second — is not silently skipped.

Alternatively, expose a host directory to Nginx at its real path:

```bash
pubservices static mount ~/projects   # writes docker-compose.override.yml
pubservices up --proxy                # restart nginx to apply
devproxy create -h myapp.local --static --root /home/you/projects/myapp/dist
pubservices static unmount            # undo
```

## Backup and restore

```bash
pubservices backup            # → ~/.pubservices/backups/backup_YYYYMMDD_HHMMSS.tar.gz
pubservices backups           # list them
pubservices backups --prune 5 # keep the newest five
pubservices restore           # choose from the list
pubservices restore path/to/backup.tar.gz
```

Backups contain a full `mysqldump` and Redis's entire `/data` directory. Restoring stops Redis
before replacing its files, because Redis rewrites its AOF on shutdown.

## Upgrading from v1

v1 installed a bash CLI into `/usr/local/lib/public-services-containers`. To move to v2:

```bash
npm install -g pubservices
cd /usr/local/lib/public-services-containers && sudo docker compose down
pubservices migrate
pubservices up --full
```

`migrate` only reads the old installation — it copies configuration, certificates, static sites,
backups and the data directories, and leaves everything in place. Remove the old directory
yourself once you are satisfied:

```bash
sudo rm -rf /usr/local/lib/public-services-containers
```

`local-dev-proxy` finds the Nginx config and certificate paths through `docker inspect`, so it
follows the new location automatically once Nginx restarts.

## Configuration

`pubservices edit` opens `~/.pubservices/.env`. Notable values:

- `PMA_BLOWFISH_SECRET` must be **exactly** 32 characters or phpMyAdmin will not keep you
  logged in; `pubservices doctor` checks this
- `MYSQL_PORT=43306`, `REDIS_PORT=46379` — non-standard host ports, to avoid clashing with a
  system MySQL or Redis
- Changing `NGINX_CONTAINER_NAME` or `NETWORK_NAME` breaks the `local-dev-proxy` integration

Restart the affected services after editing: `pubservices restart`.

## Shell completion

```bash
pubservices completion install        # bash, zsh and fish
pubservices completion install zsh    # just one
pubservices completion show bash      # print to stdout
```

Files are written into your own config directories, so this needs no root. The scripts are
generated from the CLI itself, so they cannot drift out of sync with the commands.

## Ecosystem

Designed to run alongside [`local-dev-proxy`](https://github.com/mohamadtsn/local-dev-proxy),
which handles per-project SSL, DNS and Nginx vhost generation. Both agree on
`NGINX_CONTAINER_NAME` and `NETWORK_NAME`.

## License

MIT
