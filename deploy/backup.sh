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
#
# Off-box copy to Backblaze B2 (recommended): drop a deploy/backup.env file (it
# is gitignored) with your B2 application key, and every run also uploads the two
# fresh files to your bucket. Without that file the script just writes locally,
# exactly as before. See deploy/backup.env.example and first_deploy.md step 11.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/arcrun}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
PG_CONTAINER="${PG_CONTAINER:-arcrun-postgres}"
PG_USER="${PG_USER:-arcrun}"
PG_DB="${PG_DB:-arcrun}"
KEEP="${KEEP:-14}"   # how many of each backup file to retain

# Optional off-box (Backblaze B2) settings. Read them from EITHER a dedicated
# deploy/backup.env OR straight from deploy/.env, so all config can live in one
# place. From deploy/.env we pull ONLY the B2_* lines (not source the whole app
# env, which may hold values bash can't parse). Already-set vars win.
[ -f "$REPO_DIR/deploy/backup.env" ] && . "$REPO_DIR/deploy/backup.env"
if [ -f "$REPO_DIR/deploy/.env" ]; then
  while IFS= read -r _line; do
    _k="${_line%%=*}"
    [ -n "${!_k:-}" ] && continue
    export "$_k=${_line#*=}"
  done < <(grep -E '^B2_[A-Za-z_]+=' "$REPO_DIR/deploy/.env" 2>/dev/null || true)
fi
# Accept B2_APPLICATION_KEY (the name Backblaze shows) as an alias for B2_APP_KEY.
B2_APP_KEY="${B2_APP_KEY:-${B2_APPLICATION_KEY:-}}"

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

# 4. Off-box copy to Backblaze B2. The local SSD copy above protects against an
#    app/DB mistake; this protects against losing the whole box. Stateless: we
#    pass the key on an rclone connection string so no rclone config file or
#    persistent secret is needed. Skipped cleanly when B2 isn't configured or
#    rclone isn't installed, so a local-only setup still works.
if [ -n "${B2_BUCKET:-}" ] && [ -n "${B2_KEY_ID:-}" ] && [ -n "${B2_APP_KEY:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    prefix="${B2_PREFIX:-arcrun}"
    remote=":b2,account=$B2_KEY_ID,key=$B2_APP_KEY:$B2_BUCKET/$prefix"
    upload() {
      local f="$1"
      [ -f "$f" ] || return 0
      if rclone copyto "$f" "$remote/$(basename "$f")" --b2-hard-delete 2>&1; then
        echo "$(date -u) b2 upload -> $B2_BUCKET/$prefix/$(basename "$f")"
      else
        echo "$(date -u) WARNING b2 upload failed for $(basename "$f")"
      fi
    }
    upload "$db_file"
    [ -n "${files_file:-}" ] && upload "$files_file"
    # Optional remote retention: delete B2 copies older than B2_KEEP_DAYS. Off by
    # default — leave it unset and use a B2 bucket lifecycle rule instead, which
    # is the safer, provider-native way to age out old backups.
    if [ -n "${B2_KEEP_DAYS:-}" ]; then
      rclone delete "$remote/" --min-age "${B2_KEEP_DAYS}d" \
        --include "arcrun-db-*.sql.gz" --include "arcrun-files-*.tar.gz" --b2-hard-delete 2>&1 \
        && echo "$(date -u) b2 pruned copies older than ${B2_KEEP_DAYS}d" || true
    fi
  else
    echo "$(date -u) WARNING B2 configured but rclone not installed; skipped off-box upload"
  fi
fi

echo "$(date -u) backup complete"
