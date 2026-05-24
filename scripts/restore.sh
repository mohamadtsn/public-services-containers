#!/bin/bash
# scripts/restore.sh — Restore MySQL and Redis from backup

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$BASE_DIR"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
    echo -e "${RED}Error: backup file is required.${RESET}"
    echo "Usage: $0 <backup.tar.gz>"
    exit 1
fi

if [[ ! -f "$FILE" ]]; then
    echo -e "${RED}Error: file not found: ${FILE}${RESET}"
    exit 1
fi

if [[ -f "${BASE_DIR}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "${BASE_DIR}/.env"; set +a
fi

MYSQL_CONTAINER="${MYSQL_CONTAINER_NAME:-mysql-main}"
MYSQL_ROOT_PASS="${MYSQL_ROOT_PASSWORD:-root}"

echo -e "${CYAN}Restoring from backup: ${FILE}${RESET}"
echo ""
echo -e "${YELLOW}⚠  This will overwrite existing data. Continue? [y/N]: ${RESET}"
read -r confirm
[[ "${confirm:-n}" =~ ^[Yy]$ ]] || { echo "Restore cancelled."; exit 0; }
echo ""

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

tar -xzf "$FILE" -C "$TMP_DIR"

# Restore MySQL
if [[ -f "${TMP_DIR}/mysql_all.sql" ]]; then
    echo -e "  ${CYAN}›${RESET} Restoring MySQL..."
    if docker ps --format '{{.Names}}' | grep -q "^${MYSQL_CONTAINER}$"; then
        docker exec -i "$MYSQL_CONTAINER" \
            mysql -u root "-p${MYSQL_ROOT_PASS}" < "${TMP_DIR}/mysql_all.sql"
        echo -e "  ${GREEN}✓${RESET} MySQL restored"
    else
        echo -e "  ${RED}✗${RESET} MySQL container not running — cannot restore"
    fi
else
    echo -e "  ${YELLOW}⚠${RESET} No MySQL dump found in backup — skipping"
fi

# Restore Redis
if [[ -f "${TMP_DIR}/redis_appendonly.aof" ]]; then
    echo -e "  ${CYAN}›${RESET} Restoring Redis data..."
    cp "${TMP_DIR}/redis_appendonly.aof" "${BASE_DIR}/data/redis/appendonly.aof"
    echo -e "  ${GREEN}✓${RESET} Redis data restored (restart Redis to apply)"
else
    echo -e "  ${YELLOW}⚠${RESET} No Redis data found in backup — skipping"
fi

echo ""
echo -e "${GREEN}✓ Restore complete.${RESET}"
echo ""
