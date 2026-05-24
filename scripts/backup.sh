#!/bin/bash
# scripts/backup.sh — Backup MySQL and Redis data

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$BASE_DIR"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

if [[ -f "${BASE_DIR}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "${BASE_DIR}/.env"; set +a
fi

MYSQL_CONTAINER="${MYSQL_CONTAINER_NAME:-mysql-main}"
MYSQL_ROOT_PASS="${MYSQL_ROOT_PASSWORD:-root}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BASE_DIR}/backups"
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo -e "${CYAN}Creating backup...${RESET}"
echo ""

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# MySQL dump
echo -e "  ${CYAN}›${RESET} Dumping MySQL databases..."
if docker ps --format '{{.Names}}' | grep -q "^${MYSQL_CONTAINER}$"; then
    docker exec "$MYSQL_CONTAINER" \
        mysqldump -u root "-p${MYSQL_ROOT_PASS}" --all-databases --single-transaction \
        > "${TMP_DIR}/mysql_all.sql"
    echo -e "  ${GREEN}✓${RESET} MySQL dump complete"
else
    echo -e "  ${YELLOW}⚠${RESET} MySQL container not running — skipping"
fi

# Redis AOF
echo -e "  ${CYAN}›${RESET} Copying Redis data..."
if [[ -f "${BASE_DIR}/data/redis/appendonly.aof" ]]; then
    cp "${BASE_DIR}/data/redis/appendonly.aof" "${TMP_DIR}/redis_appendonly.aof"
    echo -e "  ${GREEN}✓${RESET} Redis data copied"
else
    echo -e "  ${YELLOW}⚠${RESET} Redis AOF not found — skipping"
fi

# Package archive
tar -czf "$BACKUP_FILE" -C "$TMP_DIR" .
echo ""
echo -e "${GREEN}✓ Backup saved: ${BACKUP_FILE}${RESET}"
echo ""
