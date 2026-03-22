#!/usr/bin/env bash
#
# Llamenos MinIO Initialization Script
#
# Idempotent: safe to run multiple times.
# - Creates the application bucket (if not exists)
# - Sets lifecycle rules for recordings and voicemails
# - Creates a dedicated least-privilege IAM user for the app
# - Attaches a bucket-scoped policy (no admin access)
#
# Usage:
#   # Run directly against the running MinIO container:
#   MINIO_ROOT_USER=<root> MINIO_ROOT_PASSWORD=<pass> \
#   MINIO_BUCKET=llamenos-files MINIO_APP_USER=llamenos-app MINIO_APP_PASSWORD=<pass> \
#   ./init-minio.sh
#
#   # Run inside the docker compose stack (reads from .env):
#   source /opt/llamenos/.env && ./init-minio.sh

set -euo pipefail

MINIO_URL="${MINIO_URL:-http://localhost:9000}"
ROOT_USER="${MINIO_ROOT_USER:-${MINIO_ACCESS_KEY:?MINIO_ROOT_USER or MINIO_ACCESS_KEY required}}"
ROOT_PASS="${MINIO_ROOT_PASSWORD:-${MINIO_SECRET_KEY:?MINIO_ROOT_PASSWORD or MINIO_SECRET_KEY required}}"
BUCKET="${MINIO_BUCKET:-llamenos-files}"
APP_USER="${MINIO_APP_USER:-llamenos-app}"
APP_PASS="${MINIO_APP_PASSWORD:?MINIO_APP_PASSWORD must be set}"

# MinIO client alias name for this session
ALIAS="llamenos-init-$$"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

# Locate mc (MinIO client) — prefer docker exec, then host binary
if docker inspect llamenos-minio &>/dev/null 2>&1; then
  MC="docker exec llamenos-minio mc"
elif command -v mc &>/dev/null; then
  MC="mc"
else
  echo "ERROR: MinIO client (mc) not found."
  echo "Install: https://min.io/docs/minio/linux/reference/minio-mc.html"
  exit 1
fi

log "Waiting for MinIO to be ready at $MINIO_URL..."
for i in $(seq 1 30); do
  if $MC alias set "$ALIAS" "$MINIO_URL" "$ROOT_USER" "$ROOT_PASS" --quiet 2>/dev/null; then
    log "MinIO is ready."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "ERROR: MinIO did not become ready in 60 seconds."
    exit 1
  fi
  sleep 2
done

cleanup() {
  $MC alias remove "$ALIAS" --quiet 2>/dev/null || true
}
trap cleanup EXIT

# Step 1: Create bucket (idempotent)
log "Creating bucket: $ALIAS/$BUCKET"
$MC mb --ignore-existing "$ALIAS/$BUCKET"
log "Bucket ready: $BUCKET"

# Step 2: Lifecycle rules
log "Setting lifecycle rules..."

# Delete recordings after 90 days
$MC ilm rule add \
  --expire-days 90 \
  "$ALIAS/$BUCKET" \
  --prefix "recordings/" \
  2>/dev/null || log "Lifecycle rule for recordings/ may already exist — skipping"

# Delete voicemails after 365 days
$MC ilm rule add \
  --expire-days 365 \
  "$ALIAS/$BUCKET" \
  --prefix "voicemails/" \
  2>/dev/null || log "Lifecycle rule for voicemails/ may already exist — skipping"

log "Lifecycle rules set."

# Step 3: Create dedicated app IAM user (idempotent)
log "Creating IAM user: $APP_USER"
$MC admin user add "$ALIAS" "$APP_USER" "$APP_PASS" 2>/dev/null \
  || log "User $APP_USER already exists — updating password"

# Step 4: Create and attach least-privilege policy
POLICY_NAME="llamenos-app"
POLICY_FILE="$(mktemp /tmp/llamenos-policy-XXXXXX.json)"
trap 'rm -f "$POLICY_FILE"; cleanup' EXIT

cat > "$POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::${BUCKET}/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::${BUCKET}"]
    }
  ]
}
EOF

log "Creating IAM policy: $POLICY_NAME"
$MC admin policy create "$ALIAS" "$POLICY_NAME" "$POLICY_FILE" 2>/dev/null \
  || $MC admin policy create "$ALIAS" "$POLICY_NAME" "$POLICY_FILE"

log "Attaching policy to user: $APP_USER"
$MC admin policy attach "$ALIAS" "$POLICY_NAME" --user "$APP_USER" 2>/dev/null \
  || log "Policy may already be attached — skipping"

log "MinIO initialized successfully."
log "  Bucket: $BUCKET"
log "  App user: $APP_USER (least-privilege, no admin access)"
log "  Lifecycle: recordings/ expire after 90 days, voicemails/ after 365 days"
