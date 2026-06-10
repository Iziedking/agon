#!/usr/bin/env bash
# ArcRun backup. Writes two flat files per run to the backup directory on the
# VPS SSD: a compressed Postgres dump (all application state) and a tarball of
# the data that does not live in Postgres (the production env file and the
# Circle wallet recovery directory). Both are plain files, portable to any
# host. Pair this with deploy/restore.sh to rebuild on a new provider.
#
# Install as a daily cron on the VPS:
#   crontab -e
#   0 3 * * * /opt/arcrun/deploy/backup.sh >> /opt/arcrun/backups/backup.log 2>&1
#
# Override defaults with env vars: REPO_DIR, BACKUP_DIR, PG_CONTAINER, KEEP.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/arcrun}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
PG_CONTAINER="${PG_CONTAINER:-arcrun-postgres}"
PG_USER="${PG_USER:-arcrun}"
PG_DB="${PG_DB:-arcrun}"
KEEP="${KEEP:-14}"   # how many of each backup file to retain

stamp="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 1. Postgres: a compressed SQL dump. This is the bulk of the data (agents,
#    contests, entries, payouts, audit tables, skins stored as data URLs).
db_file="$BACKUP_DIR/arcrun-db-$stamp.sql.gz"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$db_file"
chmod 600 "$db_file"
echo "$(date -u) db dump -> $db_file ($(du -h "$db_file" | cut -f1))"

# 2. Non-Postgres flat files: the production secrets and the Circle wallet
#    recovery key. Losing these means losing access to the dev-controlled
#    wallets, so they travel with every backup. The tarball is chmod 600.
files_file="$BACKUP_DIR/arcrun-files-$stamp.tar.gz"
include=()
[ -f "$REPO_DIR/deploy/.env" ] && include+=("deploy/.env")
[ -d "$REPO_DIR/backend/circle-recovery" ] && include+=("backend/circle-recovery")
if [ "${#include[@]}" -gt 0 ]; then
  tar czf "$files_file" -C "$REPO_DIR" "${include[@]}"
  chmod 600 "$files_file"
  echo "$(date -u) files -> $files_file (${include[*]})"
else
  echo "$(date -u) no non-postgres files to back up (skipped tarball)"
fi

# 3. Rotation: keep the newest KEEP of each kind, delete older ones.
rotate() {
  local pattern="$1"
  ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old"
    echo "$(date -u) rotated out $old"
  done
}
rotate "arcrun-db-*.sql.gz"
rotate "arcrun-files-*.tar.gz"

echo "$(date -u) backup complete"
