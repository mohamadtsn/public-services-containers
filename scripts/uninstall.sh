#!/bin/bash
# scripts/uninstall.sh

set -e

INSTALL_DIR="/usr/local/lib/public-services-containers"
BIN_LINK="/usr/local/bin/pubservices"

COLOR_GREEN='\033[1;32m'
COLOR_BLUE='\033[1;34m'
COLOR_YELLOW='\033[1;33m'
COLOR_RESET='\033[0m'

echo -e "${COLOR_BLUE}════════════════════════════════════════════════════════════════"
echo "         Uninstalling Public Services Containers"
echo -e "════════════════════════════════════════════════════════════════${COLOR_RESET}"
echo ""

if [[ $EUID -ne 0 ]]; then
    echo -e "${COLOR_YELLOW}This script must be run as root (use sudo)${COLOR_RESET}"
    exit 1
fi

if [[ ! -d "$INSTALL_DIR" ]] && [[ ! -L "$BIN_LINK" ]]; then
    echo -e "${COLOR_YELLOW}Public Services Containers does not appear to be installed.${COLOR_RESET}"
    exit 0
fi

# Stop running containers before removing files
if [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    echo "Stopping containers..."
    if cd "$INSTALL_DIR"; then
        docker compose --profile proxy --profile pma --profile mail --profile storage down 2>/dev/null || true
    fi
fi

# Remove symbolic link
if [[ -L "$BIN_LINK" ]]; then
    rm -f "$BIN_LINK"
    echo -e "${COLOR_GREEN}✓${COLOR_RESET} Removed symbolic link"
fi

# Remove shell completions
_removed_completions=false

[[ -f "/etc/bash_completion.d/pubservices" ]] && \
    rm -f "/etc/bash_completion.d/pubservices" && _removed_completions=true

for _zsh_dir in \
    "/usr/local/share/zsh/site-functions" \
    "/usr/share/zsh/vendor-completions" \
    "/usr/share/zsh/site-functions"
do
    [[ -f "${_zsh_dir}/_pubservices" ]] && \
        rm -f "${_zsh_dir}/_pubservices" && _removed_completions=true
done
unset _zsh_dir

[[ -f "/usr/share/fish/completions/pubservices.fish" ]] && \
    rm -f "/usr/share/fish/completions/pubservices.fish" && _removed_completions=true

if [[ "$_removed_completions" == "true" ]]; then
    echo -e "${COLOR_GREEN}✓${COLOR_RESET} Removed shell completions"
fi
unset _removed_completions

# Ask about MySQL data
if [[ -d "$INSTALL_DIR/data/mysql" ]] && compgen -G "$INSTALL_DIR/data/mysql/*" > /dev/null 2>&1; then
    echo ""
    read -r -p "  Remove MySQL data (data/mysql/)? [y/N]: " response
    if [[ "${response:-n}" =~ ^[Yy]$ ]]; then
        rm -rf "${INSTALL_DIR:?}/data/mysql/"
        echo -e "${COLOR_GREEN}✓${COLOR_RESET} Removed MySQL data"
    else
        echo -e "${COLOR_YELLOW}ℹ${COLOR_RESET}  Kept MySQL data"
    fi
fi

# Ask about Redis data
if [[ -d "$INSTALL_DIR/data/redis" ]] && compgen -G "$INSTALL_DIR/data/redis/*" > /dev/null 2>&1; then
    echo ""
    read -r -p "  Remove Redis data (data/redis/)? [y/N]: " response
    if [[ "${response:-n}" =~ ^[Yy]$ ]]; then
        rm -rf "${INSTALL_DIR:?}/data/redis/"
        echo -e "${COLOR_GREEN}✓${COLOR_RESET} Removed Redis data"
    else
        echo -e "${COLOR_YELLOW}ℹ${COLOR_RESET}  Kept Redis data"
    fi
fi

# Ask about nginx configs and certificates
if [[ -d "$INSTALL_DIR/nginx/site-enabled" ]] || [[ -d "$INSTALL_DIR/nginx/certificates" ]]; then
    echo ""
    read -r -p "  Remove nginx site configs and certificates? [y/N]: " response
    if [[ "${response:-n}" =~ ^[Yy]$ ]]; then
        rm -rf "${INSTALL_DIR:?}/nginx/site-enabled/"
        rm -rf "${INSTALL_DIR:?}/nginx/certificates/"
        echo -e "${COLOR_GREEN}✓${COLOR_RESET} Removed nginx configs and certificates"
    else
        echo -e "${COLOR_YELLOW}ℹ${COLOR_RESET}  Kept nginx configs and certificates"
    fi
fi

# Remove remaining program files
if [[ -d "$INSTALL_DIR" ]]; then
    echo ""
    read -r -p "  Remove all remaining files in ${INSTALL_DIR}? [Y/n]: " response
    if [[ ! "${response:-y}" =~ ^[Nn]$ ]]; then
        rm -rf "$INSTALL_DIR"
        echo -e "${COLOR_GREEN}✓${COLOR_RESET} Removed installation directory"
    fi
fi

echo ""
echo -e "${COLOR_GREEN}════════════════════════════════════════════════════════════════"
echo "             Uninstallation completed!"
echo -e "════════════════════════════════════════════════════════════════${COLOR_RESET}"
echo ""
