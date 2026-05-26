# Fish completion for pubservices

set -l services mysql redis nginx phpmyadmin mailpit minio
set -l commands_with_service up restart logs
set -l commands_no_service status info down reload-proxy edit update backup restore build run static-add static-remove static-list static-mount static-unmount reset help

# Disable file completion
complete -c pubservices -f

# Commands (only when no command given yet)
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a status       -d "Show status of all services (health + ports)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a info         -d "Show connection info for all services"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a up           -d "Start all services (or one specific service)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a down         -d "Stop all services"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a restart      -d "Restart services (or one specific service)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a reload-proxy -d "Reload Nginx configuration"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a logs         -d "Follow service logs (or one specific service)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a edit         -d "Edit .env in \$EDITOR"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a update       -d "Check for updates and install if available"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a backup       -d "Backup MySQL and Redis data"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a restore      -d "Restore from a backup file"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a build        -d "Rebuild Docker images (no cache)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a run          -d "Run any command inside the pubservices environment"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a static-add   -d "Sync a build directory into nginx/static/"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a static-remove -d "Remove a static site from nginx/static/"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a static-list  -d "List static sites in nginx/static/"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a static-mount -d "Create docker-compose.override.yml to mount a host path"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a static-unmount -d "Remove the docker-compose.override.yml mount"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a reset        -d "Stop all services and delete data (DESTRUCTIVE)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service $commands_no_service" \
    -a help         -d "Show help message"

# Service names for commands that accept a service argument
complete -c pubservices -n "__fish_seen_subcommand_from $commands_with_service" \
    -a mysql       -d "MySQL database container"
complete -c pubservices -n "__fish_seen_subcommand_from $commands_with_service" \
    -a redis       -d "Redis cache container"
complete -c pubservices -n "__fish_seen_subcommand_from $commands_with_service" \
    -a nginx       -d "Nginx reverse proxy container"
complete -c pubservices -n "__fish_seen_subcommand_from $commands_with_service" \
    -a phpmyadmin  -d "phpMyAdmin web UI container"
complete -c pubservices -n "__fish_seen_subcommand_from $commands_with_service" \
    -a mailpit     -d "Mailpit mail catcher container"
complete -c pubservices -n "__fish_seen_subcommand_from $commands_with_service" \
    -a minio       -d "MinIO object storage container"