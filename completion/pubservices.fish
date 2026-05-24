# Fish completion for pubservices

set -l services mysql redis nginx phpmyadmin mailpit minio
set -l commands_with_service up restart logs
set -l commands_no_service status info down reload-proxy edit update reset help

# Disable file completion
complete -c pubservices -f

# Commands (only when no command given yet)
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a status       -d "Show status of all services (health + ports)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a info         -d "Show connection info for all services"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a up           -d "Start all services (or one specific service)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a down         -d "Stop all services"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a restart      -d "Restart services (or one specific service)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a reload-proxy -d "Reload Nginx configuration"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a logs         -d "Follow service logs (or one specific service)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a edit         -d "Edit .env in \$EDITOR"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a update       -d "Check for updates and install if available"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
    -a reset        -d "Stop all services and delete data (DESTRUCTIVE)"
complete -c pubservices -n "not __fish_seen_subcommand_from $commands_with_service status info down reload-proxy edit update reset help" \
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