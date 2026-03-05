#!/usr/bin/env bash
set -euo pipefail

# Pre-test codegen validation guard
# Ensures generated files are up-to-date before running tests
# Prevents false test failures from stale codegen output

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
if [[ -t 1 ]]; then
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' DIM='' RESET=''
fi

cd "$PROJECT_ROOT"

run_codegen_guard() {
  local start_time
  start_time="$(date +%s)"
  local errors=()

  echo -e "${BOLD}Codegen Guard${RESET}"

  # Step 1: Run protocol codegen
  echo -e "  ${DIM}Running protocol codegen...${RESET}"
  if ! bun run codegen 2>&1 | tail -5; then
    errors+=("Protocol codegen failed")
  fi

  # Step 2: Run i18n codegen
  echo -e "  ${DIM}Running i18n codegen...${RESET}"
  if ! bun run i18n:codegen 2>&1 | tail -5; then
    errors+=("i18n codegen failed")
  fi

  # Step 3: Check for uncommitted changes in generated files
  local stale_files=()
  local generated_dirs=(
    "packages/protocol/generated"
    "apps/ios/Sources/Generated"
    "apps/android/app/src/main/java/org/llamenos/app/generated"
    "apps/ios/Sources/Resources"
    "apps/android/app/src/main/res/values"
  )

  for dir in "${generated_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      local changed
      changed="$(git diff --name-only -- "$dir" 2>/dev/null || true)"
      if [[ -n "$changed" ]]; then
        while IFS= read -r f; do
          stale_files+=("$f")
        done <<< "$changed"
      fi
      # Also check untracked files
      local untracked
      untracked="$(git ls-files --others --exclude-standard -- "$dir" 2>/dev/null || true)"
      if [[ -n "$untracked" ]]; then
        while IFS= read -r f; do
          stale_files+=("$f (untracked)")
        done <<< "$untracked"
      fi
    fi
  done

  local end_time
  end_time="$(date +%s)"
  local duration=$(( end_time - start_time ))

  # Report results
  if [[ ${#errors[@]} -gt 0 ]]; then
    echo -e "\n${RED}CODEGEN GUARD FAILED${RESET}"
    for err in "${errors[@]}"; do
      echo -e "  ${RED}*${RESET} $err"
    done
    return 1
  fi

  if [[ ${#stale_files[@]} -gt 0 ]]; then
    echo -e "\n${YELLOW}WARNING: Generated files differ from committed versions${RESET}"
    echo -e "${DIM}The following files were modified by codegen:${RESET}"
    for f in "${stale_files[@]}"; do
      echo -e "  ${YELLOW}*${RESET} $f"
    done
    echo ""
    echo -e "${DIM}This means codegen output is stale in git. Tests will use the freshly generated files.${RESET}"
    echo -e "${DIM}Consider committing the updated generated files.${RESET}"
  fi

  echo -e "  ${GREEN}Codegen guard passed${RESET} (${duration}s)"
  return 0
}

# If run directly, execute the guard
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  run_codegen_guard
fi
