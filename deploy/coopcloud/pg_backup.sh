#!/bin/bash
# Manual PostgreSQL backup for Llamenos Co-op Cloud deployments.
# Usage: ./pg_backup.sh <stack-name> [backup-dir]
#
# Examples:
#   ./pg_backup.sh llamenos_hotline
#   ./pg_backup.sh llamenos_hotline /backups
set -euo pipefail

STACK_NAME="${1:?Usage: $0 <stack-name> [backup-dir]}"
BACKUP_DIR="${2:-/tmp}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/llamenos-${STACK_NAME}-${TIMESTAMP}.sql.gz"

DB_CONTAINER="$(docker ps -q -f "name=${STACK_NAME}_db")"
if [ -z "$DB_CONTAINER" ]; then
  echo "Error: No running container found for ${STACK_NAME}_db"
  exit 1
fi

echo "Backing up ${STACK_NAME} database..."
docker exec "$DB_CONTAINER" pg_dump -U llamenos llamenos | gzip > "$BACKUP_FILE"
echo "Backup saved to: ${BACKUP_FILE}"

# Retention: keep last 7 daily backups
if [ "$BACKUP_DIR" != "/tmp" ]; then
  find "$BACKUP_DIR" -name "llamenos-${STACK_NAME}-*.sql.gz" -mtime +7 -delete 2>/dev/null || true
fi
