#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check k6 is installed
if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 is not installed."
  echo ""
  echo "Install k6:"
  echo "  macOS:   brew install k6"
  echo "  Linux:   sudo snap install k6 (or see https://grafana.com/docs/k6/latest/set-up/install-k6/)"
  echo "  Docker:  docker run --rm -i grafana/k6 run -"
  echo ""
  exit 1
fi

SCENARIO="${1:-}"
shift 2>/dev/null || true

run_scenario() {
  local name="$1"
  local file="$2"
  shift 2

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Load Test: ${name}"
  echo "  Target:    ${BASE_URL:-http://localhost:3000}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  k6 run \
    --env BASE_URL="${BASE_URL:-http://localhost:3000}" \
    --env TEST_SECRET="${TEST_SECRET:-test-secret}" \
    "$@" \
    "${SCRIPT_DIR}/${file}"
}

case "${SCENARIO}" in
  calls)
    run_scenario "Concurrent Calls" "concurrent-calls.js" "$@"
    ;;
  messages)
    run_scenario "Messaging Throughput" "messaging-throughput.js" "$@"
    ;;
  mixed)
    run_scenario "Mixed Operations" "mixed-operations.js" "$@"
    ;;
  burst)
    run_scenario "Burst Traffic" "burst.js" "$@"
    ;;
  all)
    run_scenario "Concurrent Calls" "concurrent-calls.js" "$@"
    run_scenario "Messaging Throughput" "messaging-throughput.js" "$@"
    run_scenario "Mixed Operations" "mixed-operations.js" "$@"
    run_scenario "Burst Traffic" "burst.js" "$@"
    ;;
  *)
    echo "Usage: $0 <scenario> [k6 args...]"
    echo ""
    echo "Scenarios:"
    echo "  calls     Concurrent call simulation (ramp 1→50 VUs)"
    echo "  messages  High-volume messaging (17/min constant rate)"
    echo "  mixed     Weighted mix of API operations (ramp 5→50 VUs)"
    echo "  burst     Normal→10x spike→recovery (5→50→5 VUs)"
    echo "  all       Run all scenarios sequentially"
    echo ""
    echo "Environment variables:"
    echo "  BASE_URL     Backend URL (default: http://localhost:3000)"
    echo "  TEST_SECRET  X-Test-Secret header value (default: test-secret)"
    echo ""
    echo "Examples:"
    echo "  $0 calls"
    echo "  $0 burst --out json=results.json"
    echo "  BASE_URL=https://staging.example.com $0 all"
    exit 1
    ;;
esac
