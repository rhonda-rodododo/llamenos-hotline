#!/usr/bin/env bash
# Start a Cloudflare quick tunnel for local Twilio development.
# Automatically configures both Twilio phone numbers to point at the tunnel,
# and restores the original URLs on exit.
#
# Usage:
#   ./scripts/dev-tunnel.sh          # starts tunnel + configures Twilio
#   ./scripts/dev-tunnel.sh --restore # restores original Twilio webhook URLs
#
# Prerequisites:
#   - cloudflared installed
#   - .env.live with TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
#   - Dev server running on localhost:3000

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load credentials
ENV_FILE="${PROJECT_DIR}/.env.live"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .env.live.example and fill in credentials."
  exit 1
fi
source "$ENV_FILE"

# Twilio phone number SIDs (looked up via API)
HOTLINE_SID="PN4441b3c8562f1ab7a1c7c352a1236cba"   # +12162086138
CALLER_SID="PN4f81e87589b8e771751c5f84646f5883"     # +12166000401

# Original production URLs to restore on exit
ORIGINAL_VOICE_URL="https://demo-next.llamenos-hotline.com/telephony/incoming"
ORIGINAL_SMS_URL="https://demo-next.llamenos-hotline.com/api/messaging/sms/webhook"

LOCAL_PORT="${LOCAL_PORT:-3000}"
TUNNEL_LOG="${PROJECT_DIR}/.tunnel.log"

update_twilio_number() {
  local sid="$1"
  local voice_url="$2"
  local label="$3"

  echo "  Updating ${label} voice URL → ${voice_url}"
  curl -s -X POST \
    "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${sid}.json" \
    --data-urlencode "VoiceUrl=${voice_url}" \
    --data-urlencode "VoiceMethod=POST" \
    --data-urlencode "StatusCallback=${voice_url%/incoming}/call-status" \
    --data-urlencode "StatusCallbackMethod=POST" \
    -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
    -o /dev/null
}

restore_urls() {
  echo ""
  echo "Restoring original Twilio webhook URLs..."
  update_twilio_number "$HOTLINE_SID" "$ORIGINAL_VOICE_URL" "hotline (+12162086138)"
  echo "  Restored hotline to production URL."
  echo "Done."
}

# Handle --restore flag
if [[ "${1:-}" == "--restore" ]]; then
  restore_urls
  exit 0
fi

# Start cloudflared tunnel in background
echo "Starting Cloudflare quick tunnel → localhost:${LOCAL_PORT}..."
cloudflared tunnel --url "http://localhost:${LOCAL_PORT}" --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel URL to appear in logs
echo "Waiting for tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
  if [[ -n "$TUNNEL_URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "Error: Could not get tunnel URL after 30s. Check $TUNNEL_LOG"
  kill "$TUNNEL_PID" 2>/dev/null
  exit 1
fi

echo ""
echo "Tunnel active: ${TUNNEL_URL}"
echo ""

# Configure Twilio numbers
echo "Configuring Twilio phone numbers..."
update_twilio_number "$HOTLINE_SID" "${TUNNEL_URL}/telephony/incoming" "hotline (+12162086138)"
echo ""

# Cleanup on exit
cleanup() {
  echo ""
  echo "Shutting down tunnel..."
  kill "$TUNNEL_PID" 2>/dev/null || true
  wait "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$TUNNEL_LOG"
  restore_urls
}
trap cleanup EXIT INT TERM

echo "=== Local dev tunnel ready ==="
echo ""
echo "  Tunnel URL:  ${TUNNEL_URL}"
echo "  Voice webhook: ${TUNNEL_URL}/telephony/incoming"
echo "  SMS webhook:   ${TUNNEL_URL}/api/messaging/sms/webhook"
echo ""
echo "  Hotline number: +1 (216) 208-6138"
echo "  Test caller:    +1 (216) 600-0401"
echo ""
echo "  Dev server must be running on localhost:${LOCAL_PORT}"
echo ""
echo "Press Ctrl+C to stop tunnel and restore production URLs."
echo ""

# Keep running until interrupted
wait "$TUNNEL_PID"
