#!/usr/bin/env bash
# ArcRun restore. Rebuilds state from the flat files that backup.sh produced.
# Run on a fresh host after the stack is up (Postgres container running) but
# before you trust the data. See deploy.md for the full provider-migration
# sequence.
#
# Usage:
#   deploy/restore.sh <arcrun-db-STAMP.sql.gz> [arcrun-files-STAMP.tar.gz]
#
# The DB restore drops and recreates the public schema, so it overwrites
# whatever is currently in the database. The files restore unpacks deploy/.env
# and backend/circle-recovery back into the repo on the host.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/arcrun}"
PG_CONTAINER="${PG_CONTAINER:-arcrun-postgres}"
PG_USER="${PG_USER:-arcrun}"
PG_DB="${PG_DB:-arcrun}"

db_file="${1:-}"
files_file="${2:-}"

if [ -z "$db_file" ] || [ ! -f "$db_file" ]; then
  echo "usage: $0 <db-dump.sql.gz> [files.tar.gz]" >&2
  exit 1
fi

echo "Restoring database from $db_file into container $PG_CONTAINER ..."
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c "$db_file" | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB"
echo "Database restored."

if [ -n "$files_file" ]; then
  if [ ! -f "$files_file" ]; then
    echo "files archive $files_file not found" >&2
    exit 1
  fi
  echo "Restoring non-postgres files from $files_file ..."
  tar xzf "$files_file" -C "$REPO_DIR"
  echo "Files restored (deploy/.env, backend/circle-recovery)."
fi

echo "Restore complete. Restart the stack so services pick up restored config:"
echo "  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d"
