#!/bin/sh
# Restores a backup into a NEW database, so a test restore can never touch the live one.
# Usage: restore.sh /var/backups/uptime-arcade/db-XXXX.dump uptime_restore_test
set -eu
DUMP="$1"
TARGET="$2"
if [ "$TARGET" = "$POSTGRES_DB" ]; then
  echo "Refusing to restore over the live database. Choose another name." >&2
  exit 1
fi
export PGPASSWORD="$POSTGRES_PASSWORD"
createdb -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" "$TARGET"
pg_restore -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d "$TARGET" --no-owner "$DUMP"
psql -h "${POSTGRES_HOST:-localhost}" -p "${POSTGRES_PORT:-5432}" -U "$POSTGRES_USER" -d "$TARGET" -c "select count(*) as accounts from auth_user;"
