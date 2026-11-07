#!/bin/sh
# Nightly database backup, kept for 14 days. Copy these off the server too: a backup on the same disk won't survive losing it.
set -eu
DIR="${BACKUP_DIR:-/var/backups/uptime-arcade}"
STAMP="$(date +%Y%m%d-%H%M%S)"
umask 077
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${POSTGRES_HOST:-localhost}" -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$DIR/db-$STAMP.dump.tmp"
mv "$DIR/db-$STAMP.dump.tmp" "$DIR/db-$STAMP.dump"
find "$DIR" -name 'db-*.dump' -mtime +14 -delete
