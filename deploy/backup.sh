#!/usr/bin/env bash
# Backs up Kitchen Table: a consistent copy of the database (taken while it
# runs) and every photo and doodle, in one file per night. Keeps two weeks.
# To restore: stop the service, unpack a backup into the data folder, start it.
set -euo pipefail

DATA=${FAMILY_DATA_DIR:-/var/lib/kitchen-table}
OUT=${BACKUP_DIR:-/var/backups/kitchen-table}
KEEP_DAYS=${KEEP_DAYS:-14}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/data"
for db in "$DATA"/*.db; do
  [ -e "$db" ] && sqlite3 "$db" ".backup '$work/data/$(basename "$db")'"
done
tar -C "$DATA" --exclude='./*.db' --exclude='./*.db-*' --exclude='./tmp' --exclude='./log' -cf - . | tar -C "$work/data" -xf -
tar -C "$work/data" -czf "$OUT/kitchen-table-$(date +%Y-%m-%d).tar.gz" .
find "$OUT" -name 'kitchen-table-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
