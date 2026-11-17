#!/bin/sh
# Nightly compressed logical backup using the READ-ONLY role; keeps the last N days.
# Restore: gunzip -c backups/trendscope-YYYYmmdd-HHMM.sql.gz | psql -U postgres -d trendscope
set -eu
mkdir -p /backups
while true; do
  stamp=$(date -u +%Y%m%d-%H%M)
  if pg_dump -h db -U trendscope_readonly -d trendscope --no-owner --no-privileges \
       | gzip > "/backups/trendscope-$stamp.sql.gz.part"; then
    mv "/backups/trendscope-$stamp.sql.gz.part" "/backups/trendscope-$stamp.sql.gz"
    echo "backup ok: trendscope-$stamp.sql.gz"
  else
    rm -f "/backups/trendscope-$stamp.sql.gz.part"
    echo "backup FAILED at $stamp" >&2
  fi
  find /backups -name 'trendscope-*.sql.gz' -mtime +"${BACKUP_KEEP_DAYS:-7}" -delete
  sleep 86400
done
