#!/bin/bash
# scripts/install.sh

set -e

REPO="mohamadtsn/public-services-containers"
BRANCH="master"
VERSION="${VERSION:-latest}"

COLOR_GREEN='\033[1;32m'
COLOR_BLUE='\033[1;34m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[1;31m'
COLOR_CYAN='\033[1;36m'
COLOR_RESET='\033[0m'

INSTALL_DIR="/usr/local/lib/public-services-containers"
BIN_DIR="/usr/local/bin"
BIN_LINK="${BIN_DIR}/pubservices"
VERSION_FILE="${INSTALL_DIR}/VERSION"

if [[ $EUID -ne 0 ]]; then
    echo -e "${COLOR_YELLOW}This script must be run as root (use sudo)${COLOR_RESET}"
    exit 1
fi

# Capture the real user who invoked sudo (for file ownership)
REAL_USER="${SUDO_USER:-}"
REAL_GROUP=""
if [[ -n "$REAL_USER" ]]; then
    REAL_GROUP="$(id -gn "$REAL_USER" 2>/dev/null || echo "$REAL_USER")"
fi

# ─── Detect existing installation ─────────────────────────────────────────────

IS_UPDATE=false
INSTALLED_VERSION=""

if [[ -f "$VERSION_FILE" ]]; then
    IS_UPDATE=true
    INSTALLED_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
fi

# ─── Header ───────────────────────────────────────────────────────────────────

print_header() {
    if [[ "$IS_UPDATE" == "true" ]]; then
        echo -e "${COLOR_CYAN}════════════════════════════════════════════════════════════════"
        echo "             Updating Public Services Containers"
        echo -e "════════════════════════════════════════════════════════════════${COLOR_RESET}"
    else
        echo -e "${COLOR_BLUE}════════════════════════════════════════════════════════════════"
        echo "           Installing Public Services Containers"
        echo -e "════════════════════════════════════════════════════════════════${COLOR_RESET}"
    fi
    echo ""
}

print_header

# ─── Resolve source (local clone or remote) ───────────────────────────────────

SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
if [[ "$SCRIPT_SOURCE" == "/dev/stdin" || -z "$SCRIPT_SOURCE" || "$SCRIPT_SOURCE" == "bash" ]]; then
    REMOTE_INSTALL=true
else
    SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
    BASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
    if [[ ! -f "${BASE_DIR}/docker-compose.yml" ]]; then
        REMOTE_INSTALL=true
    else
        REMOTE_INSTALL=false
    fi
fi

# ─── Resolve new version tag ──────────────────────────────────────────────────

RESOLVED_TAG=""

if [[ "$REMOTE_INSTALL" == "true" ]]; then
    if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
        echo -e "${COLOR_RED}Error: curl or wget is required for remote installation${COLOR_RESET}"
        exit 1
    fi

    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT

    if [[ "$VERSION" == "latest" ]]; then
        echo "Checking latest release..."
        if command -v curl &>/dev/null; then
            RESOLVED_TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
                2>/dev/null | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
        elif command -v wget &>/dev/null; then
            RESOLVED_TAG=$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" \
                2>/dev/null | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
        fi
    elif [[ "$VERSION" != "master" ]]; then
        RESOLVED_TAG="$VERSION"
    fi
else
    if [[ -f "${BASE_DIR}/VERSION" ]]; then
        LOCAL_FILE_VERSION="$(tr -d '[:space:]' < "${BASE_DIR}/VERSION")"
        RESOLVED_TAG="v${LOCAL_FILE_VERSION#v}"
    fi
fi

NEW_VERSION="${RESOLVED_TAG:-dev-${BRANCH}}"

# ─── Update confirmation ──────────────────────────────────────────────────────

if [[ "$IS_UPDATE" == "true" ]]; then
    CURRENT_DISPLAY="${INSTALLED_VERSION:-unknown}"
    NEW_DISPLAY="${NEW_VERSION}"

    if [[ "$CURRENT_DISPLAY" == "$NEW_DISPLAY" ]] || \
       [[ "v${CURRENT_DISPLAY#v}" == "${NEW_DISPLAY}" ]] || \
       [[ "${CURRENT_DISPLAY}" == "${NEW_DISPLAY#v}" ]]; then
        echo -e "  Installed : ${COLOR_GREEN}${CURRENT_DISPLAY}${COLOR_RESET}"
        echo -e "  Available : ${COLOR_YELLOW}${NEW_DISPLAY}${COLOR_RESET} (same version)"
        echo ""
        read -r -p "  Same version is already installed. Continue anyway? [y/N]: " _confirm
        _confirm="${_confirm:-n}"
        if [[ ! "$_confirm" =~ ^[Yy]$ ]]; then
            echo -e "\n  ${COLOR_YELLOW}Update cancelled.${COLOR_RESET}\n"
            exit 0
        fi
    else
        echo -e "  Installed : ${COLOR_GREEN}${CURRENT_DISPLAY}${COLOR_RESET}"
        echo -e "  Available : ${COLOR_CYAN}${NEW_DISPLAY}${COLOR_RESET}"
        echo ""
        read -r -p "  Update from ${CURRENT_DISPLAY} → ${NEW_DISPLAY}? [Y/n]: " _confirm
        _confirm="${_confirm:-y}"
        if [[ ! "$_confirm" =~ ^[Yy]$ ]]; then
            echo -e "\n  ${COLOR_YELLOW}Update cancelled.${COLOR_RESET}\n"
            exit 0
        fi
    fi
    echo ""
fi

# ─── Download (remote installs only) ──────────────────────────────────────────

if [[ "$REMOTE_INSTALL" == "true" ]]; then
    if [[ -n "$RESOLVED_TAG" ]]; then
        ARCHIVE_URL="https://github.com/${REPO}/archive/refs/tags/${RESOLVED_TAG}.tar.gz"
        EXTRACT_SUBDIR="public-services-containers-${RESOLVED_TAG#v}"
        echo "Downloading version ${RESOLVED_TAG}..."
    else
        ARCHIVE_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
        EXTRACT_SUBDIR="public-services-containers-${BRANCH}"
        echo "Downloading from branch ${BRANCH}..."
    fi

    if command -v curl &>/dev/null; then
        curl -fsSL "$ARCHIVE_URL" -o "${TMP_DIR}/archive.tar.gz"
    else
        wget -q "$ARCHIVE_URL" -O "${TMP_DIR}/archive.tar.gz"
    fi

    echo "Extracting..."
    tar -xzf "${TMP_DIR}/archive.tar.gz" -C "$TMP_DIR"
    BASE_DIR="${TMP_DIR}/${EXTRACT_SUBDIR}"
fi

# ─── Install / Update files ───────────────────────────────────────────────────

if [[ "$IS_UPDATE" == "true" ]]; then
    echo "Updating files..."
else
    echo "Creating installation directory..."
fi

mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"

echo "Copying files..."
cp "${BASE_DIR}/docker-compose.yml" "$INSTALL_DIR/"
cp -r "${BASE_DIR}/nginx"       "$INSTALL_DIR/"
cp -r "${BASE_DIR}/mysql"       "$INSTALL_DIR/"
cp -r "${BASE_DIR}/scripts"     "$INSTALL_DIR/"
cp -r "${BASE_DIR}/bin"         "$INSTALL_DIR/"
cp -r "${BASE_DIR}/completion"  "$INSTALL_DIR/"
cp    "${BASE_DIR}/Makefile"    "$INSTALL_DIR/"

# Write version file
if [[ -n "$RESOLVED_TAG" ]]; then
    echo "${RESOLVED_TAG#v}" > "$VERSION_FILE"
elif [[ -f "${BASE_DIR}/VERSION" ]]; then
    cp "${BASE_DIR}/VERSION" "$VERSION_FILE"
else
    echo "dev-${BRANCH}" > "$VERSION_FILE"
fi

echo "Setting permissions..."
chmod +x "$INSTALL_DIR/bin/pubservices"
chmod +x "$INSTALL_DIR/scripts/"*.sh

echo "Creating symbolic link..."
ln -sf "$INSTALL_DIR/bin/pubservices" "$BIN_LINK"

# ─── Install shell completions ────────────────────────────────────────────────

BASH_COMPLETION_DIR="/etc/bash_completion.d"
ZSH_COMPLETION_DIRS=(
    "/usr/local/share/zsh/site-functions"
    "/usr/share/zsh/vendor-completions"
    "/usr/share/zsh/site-functions"
)
FISH_COMPLETION_DIR="/usr/share/fish/completions"

if [[ -d "$BASH_COMPLETION_DIR" ]]; then
    cp "$INSTALL_DIR/completion/pubservices.bash" "${BASH_COMPLETION_DIR}/pubservices"
    echo "Installed bash completion → ${BASH_COMPLETION_DIR}/pubservices"
fi

_zsh_installed=false
for _zsh_dir in "${ZSH_COMPLETION_DIRS[@]}"; do
    if [[ -d "$_zsh_dir" ]]; then
        cp "$INSTALL_DIR/completion/_pubservices" "${_zsh_dir}/_pubservices"
        echo "Installed zsh completion  → ${_zsh_dir}/_pubservices"
        _zsh_installed=true
    fi
done
if [[ "$_zsh_installed" == "false" ]]; then
    mkdir -p "${ZSH_COMPLETION_DIRS[0]}"
    cp "$INSTALL_DIR/completion/_pubservices" "${ZSH_COMPLETION_DIRS[0]}/_pubservices"
    echo "Installed zsh completion  → ${ZSH_COMPLETION_DIRS[0]}/_pubservices"
fi
unset _zsh_dir _zsh_installed

if [[ -d "$FISH_COMPLETION_DIR" ]]; then
    cp "$INSTALL_DIR/completion/pubservices.fish" "${FISH_COMPLETION_DIR}/pubservices.fish"
    echo "Installed fish completion → ${FISH_COMPLETION_DIR}/pubservices.fish"
fi

# Create data directories (never overwrite user data)
mkdir -p "$INSTALL_DIR/data/mysql"
mkdir -p "$INSTALL_DIR/data/redis"
mkdir -p "$INSTALL_DIR/nginx/certificates"

# Setup .env from .env.example if not present
if [[ ! -f "$INSTALL_DIR/.env" ]] && [[ -f "${BASE_DIR}/.env.example" ]]; then
    cp "${BASE_DIR}/.env.example" "$INSTALL_DIR/.env"
    echo "Created .env from .env.example"
    echo -e "${COLOR_YELLOW}  → Please review and update ${INSTALL_DIR}/.env${COLOR_RESET}"
fi

chown -R root:root "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR"

# Give the real user ownership of directories they need to write to
if [[ -n "$REAL_USER" ]]; then
    chown -R "${REAL_USER}:${REAL_GROUP}" "${INSTALL_DIR}/data"
    chown -R "${REAL_USER}:${REAL_GROUP}" "${INSTALL_DIR}/nginx/site-enabled"
    chown -R "${REAL_USER}:${REAL_GROUP}" "${INSTALL_DIR}/nginx/certificates"
    [[ -f "${INSTALL_DIR}/.env" ]] && chown "${REAL_USER}:${REAL_GROUP}" "${INSTALL_DIR}/.env"
fi

# ─── Success message ───────────────────────────────────────────────────────────

FINAL_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE" 2>/dev/null)"

echo ""
if [[ "$IS_UPDATE" == "true" ]]; then
    echo -e "${COLOR_CYAN}════════════════════════════════════════════════════════════════"
    echo "              Update completed successfully!"
    echo -e "════════════════════════════════════════════════════════════════${COLOR_RESET}"
    echo ""
    echo -e "  ${COLOR_GREEN}${INSTALLED_VERSION}${COLOR_RESET}  →  ${COLOR_CYAN}${FINAL_VERSION}${COLOR_RESET}"
else
    echo -e "${COLOR_GREEN}════════════════════════════════════════════════════════════════"
    echo "            Installation completed successfully!"
    echo -e "════════════════════════════════════════════════════════════════${COLOR_RESET}"
    echo ""
    echo -e "  Version    : ${COLOR_GREEN}${FINAL_VERSION}${COLOR_RESET}"
    echo -e "  Install dir: ${COLOR_YELLOW}${INSTALL_DIR}${COLOR_RESET}"
fi

echo ""
if [[ "$IS_UPDATE" == "true" ]]; then
    echo -e "${COLOR_BLUE}  Quick Start${COLOR_RESET}"
    echo ""
    echo -e "  ${COLOR_GREEN}pubservices status${COLOR_RESET}         Show service health + ports"
    echo -e "  ${COLOR_GREEN}pubservices restart${COLOR_RESET}        Restart all services"
    echo -e "  ${COLOR_GREEN}pubservices logs [service]${COLOR_RESET} Follow logs"
    echo -e "  ${COLOR_GREEN}pubservices info${COLOR_RESET}           Show connection details"
    echo -e "  ${COLOR_GREEN}pubservices help${COLOR_RESET}           All available commands"
    echo ""
    echo -e "  For granular control: cd ${COLOR_YELLOW}${INSTALL_DIR}${COLOR_RESET} && make help"
else
    echo -e "${COLOR_BLUE}  Quick Start${COLOR_RESET}"
    echo ""
    echo -e "  1. Review config:    ${COLOR_YELLOW}${INSTALL_DIR}/.env${COLOR_RESET}"
    echo ""
    echo -e "  2. Start services:"
    echo -e "       ${COLOR_GREEN}cd ${INSTALL_DIR}${COLOR_RESET}"
    echo -e "       ${COLOR_GREEN}make up${COLOR_RESET}           MySQL + Redis only"
    echo -e "       ${COLOR_GREEN}make up-proxy${COLOR_RESET}     + Nginx"
    echo -e "       ${COLOR_GREEN}make up-full${COLOR_RESET}      Everything"
    echo ""
    echo -e "  3. After setup, use ${COLOR_CYAN}pubservices${COLOR_RESET} from anywhere:"
    echo -e "       ${COLOR_GREEN}pubservices status${COLOR_RESET}  Show health + ports"
    echo -e "       ${COLOR_GREEN}pubservices help${COLOR_RESET}    All CLI commands"
    echo ""
    echo -e "  ${COLOR_BLUE}Tab completion${COLOR_RESET} is installed for bash, zsh, and fish."
    echo -e "  Reload your shell or run ${COLOR_YELLOW}exec \$SHELL${COLOR_RESET} to activate it."
fi
echo ""
