#!/usr/bin/env bash
# Bash completion for pubservices

_pubservices() {
    local cur prev commands services
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    commands="status info up down restart reload-proxy logs edit reset help"
    services="mysql redis nginx phpmyadmin mailpit minio"

    if [[ $COMP_CWORD -eq 1 ]]; then
        # shellcheck disable=SC2207
        COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
        return 0
    fi

    if [[ $COMP_CWORD -eq 2 ]]; then
        case "$prev" in
            up|restart|logs)
                # shellcheck disable=SC2207
                COMPREPLY=( $(compgen -W "$services" -- "$cur") )
                return 0
                ;;
        esac
    fi
}

complete -F _pubservices pubservices