#!/usr/bin/env bash
#
# Llamenos PostgreSQL Restore Script
#
# Restores a single encrypted backup file to the live database.
# Use ONLY during disaster recovery — this overwrites production data.
#
# Usage:
#   ./restore-postgres.sh <backup-file> [--yes]
#
#   <backup-file>  Local path or rclone remote path to backup file.
#                  Examples:
#                    /opt/llamenos/backups/daily/llamenos-20260101-030000.sql.gz.age
#                    s3:llamenos-backups/daily/llamenos-20260101-030000.sql.gz.age
#   --yes          Skip confirmation prompt (for CI/automation)
#
# Prerequisites:
#   - AGE_PRIVATE_KEY_FILE: path to the age private key (offline, org security officer holds this)
#   - DATABASE_URL: PostgreSQL connection string
#   - Optionally: rclone configured if restoring from remote

set -euo pipefail

BACKUP_FILE="${1:-}"
SKIP_CONFIRM="${2:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <backup-file> [--yes]"
  echo ""
  echo "Examples:"
  echo "  $0 /opt/llamenos/backups/daily/llamenos-20260101-030000.sql.gz.age"
  echo "  $0 s3:llamenos-backups/daily/llamenos-20260101-030000.sql.gz.age"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

if [[ -z "${AGE_PRIVATE_KEY_FILE:-}" ]]; then
  echo "ERROR: AGE_PRIVATE_KEY_FILE not set (path to the age private key file)"
  echo "The age private key is held offline by the org security officer."
  exit 1
fi

if [[ ! -f "$AGE_PRIVATE_KEY_FILE" ]]; then
  echo "ERROR: AGE_PRIVATE_KEY_FILE does not exist: $AGE_PRIVATE_KEY_FILE"
  exit 1
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

# Confirmation prompt
if [[ "$SKIP_CONFIRM" != "--yes" ]]; then
  echo ""
  echo "WARNING: This will restore the following backup to the LIVE database:"
  echo "  Backup: $BACKUP_FILE"
  echo "  Target: $DATABASE_URL"
  echo ""
  echo "This will DROP and RECREATE all tables. All current data will be lost."
  echo ""
  read -r -p "Type 'restore' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "restore" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TMPDIR}"' EXIT

log "Starting restore from: $BACKUP_FILE"

# Step 1: Fetch the backup file (local or remote)
if [[ "$BACKUP_FILE" == s3:* ]] || [[ "$BACKUP_FILE" == b2:* ]] || [[ "$BACKUP_FILE" == *:* ]]; then
  log "Fetching from remote storage..."
  rclone copy "$BACKUP_FILE" "$TMPDIR/"
  BASENAME="$(basename "$BACKUP_FILE")"
  LOCAL_FILE="$TMPDIR/$BASENAME"
else
  LOCAL_FILE="$BACKUP_FILE"
fi

if [[ ! -f "$LOCAL_FILE" ]]; then
  echo "ERROR: Backup file not found: $LOCAL_FILE"
  exit 1
fi

# Step 2: Decrypt with age
if [[ "$LOCAL_FILE" == *.age ]]; then
  log "Decrypting backup with age..."
  DECRYPTED="$TMPDIR/dump.sql.gz"
  age -d -i "$AGE_PRIVATE_KEY_FILE" -o "$DECRYPTED" "$LOCAL_FILE"
else
  log "Backup is not encrypted (no .age extension) — proceeding without decryption"
  DECRYPTED="$LOCAL_FILE"
fi

# Step 3: Decompress and restore
log "Restoring to database..."
gunzip -c "$DECRYPTED" | psql "$DATABASE_URL" --set ON_ERROR_STOP=1

log "Restore complete. Verifying basic integrity..."

# Step 4: Basic sanity check
VOLUNTEER_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM volunteers" 2>/dev/null | tr -d ' ' || echo "ERROR")
log "volunteers table row count: $VOLUNTEER_COUNT"

if [[ "$VOLUNTEER_COUNT" == "ERROR" ]]; then
  echo "ERROR: volunteers table not found — restore may have failed"
  exit 1
fi

log "Restore successful."
echo ""
echo "IMPORTANT: Restart the app container to clear any stale in-memory state:"
echo "  docker compose restart app"
