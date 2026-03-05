#!/usr/bin/env bash
set -euo pipefail

# Incremental test runner
# Uses git diff to determine which platforms are affected by recent changes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/platform-detect.sh"

# Parse arguments
VERBOSE="${VERBOSE:-false}"
NO_CODEGEN="${NO_CODEGEN:-false}"
JSON_OUTPUT="${JSON_OUTPUT:-false}"
TIMEOUT="${REPORTER_TIMEOUT:-600}"
BASE_REF="${BASE_REF:-HEAD~1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose) VERBOSE=true; shift ;;
    --no-codegen) NO_CODEGEN=true; shift ;;
    --json) JSON_OUTPUT=true; shift ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --base) BASE_REF="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

cd "$PROJECT_ROOT"

# Colors
if [[ -t 1 ]] && [[ "${JSON_OUTPUT}" != "true" ]]; then
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  BOLD='' GREEN='' YELLOW='' DIM='' RESET=''
fi

# Determine changed files
changed_files="$(git diff --name-only "$BASE_REF" 2>/dev/null || git diff --name-only HEAD 2>/dev/null || true)"

if [[ -z "$changed_files" ]]; then
  # Also check staged + unstaged changes
  changed_files="$(git diff --name-only 2>/dev/null || true)"
  staged_files="$(git diff --cached --name-only 2>/dev/null || true)"
  if [[ -n "$staged_files" ]]; then
    changed_files="${changed_files}
${staged_files}"
  fi
fi

if [[ -z "$changed_files" ]]; then
  echo -e "${GREEN}No changed files detected. Nothing to test.${RESET}"
  exit 0
fi

# Map changed files to affected platforms using simple arrays
need_desktop=false
need_android=false
need_ios=false
need_worker=false
need_crypto=false

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  case "$file" in
    src/client/*|tests/*|playwright.*)
      need_desktop=true ;;
    apps/android/*)
      need_android=true ;;
    apps/ios/*)
      need_ios=true ;;
    apps/worker/*|vitest.*)
      need_worker=true ;;
    packages/crypto/*)
      need_crypto=true ;;
    packages/protocol/*|packages/i18n/*|packages/test-specs/*|scripts/test-*.sh|scripts/lib/*)
      need_desktop=true; need_android=true; need_ios=true; need_worker=true; need_crypto=true ;;
    packages/shared/*)
      need_desktop=true; need_worker=true ;;
  esac
done <<< "$changed_files"

# Collect affected platforms
affected=()
$need_desktop && affected+=("desktop")
$need_android && affected+=("android")
$need_ios && affected+=("ios")
$need_worker && affected+=("worker")
$need_crypto && affected+=("crypto")

if [[ ${#affected[@]} -eq 0 ]]; then
  echo -e "${GREEN}Changed files don't affect any test platforms.${RESET}"
  echo -e "${DIM}Changed files:${RESET}"
  echo "$changed_files" | head -20
  exit 0
fi

# Filter by what's actually available
available="$(detect_platforms)"
platforms_to_run=()

for platform in "${affected[@]}"; do
  if [[ " $available " == *" $platform "* ]]; then
    platforms_to_run+=("$platform")
  else
    echo -e "${YELLOW}Skipping ${platform}: not available on this machine${RESET}"
  fi
done

if [[ ${#platforms_to_run[@]} -eq 0 ]]; then
  echo -e "${YELLOW}No affected platforms available on this machine.${RESET}"
  exit 0
fi

if [[ "${JSON_OUTPUT}" != "true" ]]; then
  echo -e "${BOLD}Incremental Test Runner${RESET}"
  echo -e "  Base: ${BASE_REF}"
  echo -e "  Changed files: $(echo "$changed_files" | wc -l | tr -d ' ')"
  echo -e "  Affected platforms: ${platforms_to_run[*]}"
  echo ""
fi

# Build passthrough args
PASSTHROUGH_ARGS=()
[[ "$VERBOSE" == "true" ]] && PASSTHROUGH_ARGS+=("--verbose")
[[ "$NO_CODEGEN" == "true" ]] && PASSTHROUGH_ARGS+=("--no-codegen")
[[ "$JSON_OUTPUT" == "true" ]] && PASSTHROUGH_ARGS+=("--json")
PASSTHROUGH_ARGS+=("--timeout" "$TIMEOUT")

# Delegate to orchestrator with specific platforms
IFS=','; platforms_csv="${platforms_to_run[*]}"; unset IFS
exec "$SCRIPT_DIR/test-orchestrator.sh" \
  --platforms "$platforms_csv" \
  "${PASSTHROUGH_ARGS[@]}"
