#!/usr/bin/env bash
set -euo pipefail

# Test reporter library for structured output formatting
# Source this file from test scripts to get reporting functions

# Colors (disabled if not a terminal or --json mode)
if [[ -t 1 ]] && [[ "${JSON_OUTPUT:-}" != "true" ]]; then
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  CYAN='\033[0;36m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' CYAN='' DIM='' RESET=''
fi

# Global state
REPORTER_PLATFORM="${REPORTER_PLATFORM:-unknown}"
REPORTER_START_TIME=""
REPORTER_LOG_FILE=""
REPORTER_SUITES=()
REPORTER_SUITE_RESULTS=()
REPORTER_TIMEOUT="${REPORTER_TIMEOUT:-600}"
REPORTER_TIMEOUT_PID=""

# Initialize the reporter for a platform
reporter_init() {
  local platform="$1"
  REPORTER_PLATFORM="$platform"
  REPORTER_START_TIME="$(date +%s)"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  REPORTER_LOG_FILE="/tmp/test-${platform}-${timestamp}.log"
  REPORTER_SUITES=()
  REPORTER_SUITE_RESULTS=()

  if [[ "${JSON_OUTPUT:-}" != "true" ]]; then
    echo -e "${BOLD}=== Testing: ${CYAN}${platform}${RESET}${BOLD} ===${RESET}"
    echo -e "${DIM}Log: ${REPORTER_LOG_FILE}${RESET}"
    echo ""
  fi
}

# Run a command with tee logging, timeout, and filtered output
# Usage: reporter_run_step "Step Name" command [args...]
reporter_run_step() {
  local step_name="$1"
  shift
  local step_start
  step_start="$(date +%s)"

  if [[ "${JSON_OUTPUT:-}" != "true" ]]; then
    echo -e "${CYAN}--- ${step_name} ---${RESET}"
  fi

  local exit_code=0

  # Set up timeout watcher
  local timeout_seconds="${REPORTER_TIMEOUT}"
  local warn_seconds=$(( timeout_seconds * 80 / 100 ))

  (
    sleep "$warn_seconds" 2>/dev/null && \
      echo -e "\n${YELLOW}WARNING: Approaching timeout (${warn_seconds}s / ${timeout_seconds}s)${RESET}" >&2
  ) &
  local warn_pid=$!

  # Portable timeout: use `timeout` if available, else use background + wait + kill
  local _timeout_cmd=""
  if command -v timeout &>/dev/null; then
    _timeout_cmd="timeout"
  elif command -v gtimeout &>/dev/null; then
    _timeout_cmd="gtimeout"
  fi

  # Run the command with tee, capturing exit code
  if [[ -n "$_timeout_cmd" ]]; then
    if [[ "${VERBOSE:-}" == "true" ]]; then
      "$_timeout_cmd" "$timeout_seconds" "$@" 2>&1 | tee -a "$REPORTER_LOG_FILE" || exit_code=$?
    else
      "$_timeout_cmd" "$timeout_seconds" "$@" 2>&1 | tee -a "$REPORTER_LOG_FILE" | \
        _filter_output "$REPORTER_PLATFORM" || exit_code=$?
    fi
  else
    # Portable fallback: run in background with manual timeout
    if [[ "${VERBOSE:-}" == "true" ]]; then
      "$@" 2>&1 | tee -a "$REPORTER_LOG_FILE" &
    else
      "$@" 2>&1 | tee -a "$REPORTER_LOG_FILE" | \
        _filter_output "$REPORTER_PLATFORM" &
    fi
    local cmd_pid=$!

    # Wait with timeout
    local elapsed=0
    while kill -0 "$cmd_pid" 2>/dev/null; do
      if [[ "$elapsed" -ge "$timeout_seconds" ]]; then
        kill "$cmd_pid" 2>/dev/null || true
        wait "$cmd_pid" 2>/dev/null || true
        exit_code=124
        break
      fi
      sleep 1
      elapsed=$(( elapsed + 1 ))
    done
    if [[ "$exit_code" -ne 124 ]]; then
      wait "$cmd_pid" 2>/dev/null || exit_code=$?
    fi
  fi

  # Clean up timeout watcher
  kill "$warn_pid" 2>/dev/null || true
  wait "$warn_pid" 2>/dev/null || true

  local step_end
  step_end="$(date +%s)"
  local step_duration=$(( step_end - step_start ))

  # Handle timeout (exit code 124 from timeout command)
  if [[ "$exit_code" -eq 124 ]]; then
    echo -e "\n${RED}TIMEOUT: ${step_name} exceeded ${timeout_seconds}s${RESET}"
    echo -e "${DIM}Last 50 lines of log:${RESET}"
    tail -50 "$REPORTER_LOG_FILE" 2>/dev/null || true
    return 1
  fi

  # Check for empty output (common iOS/Android issue)
  if [[ ! -s "$REPORTER_LOG_FILE" ]]; then
    echo -e "${YELLOW}WARNING: No output captured for ${step_name}${RESET}"
  fi

  if [[ "$exit_code" -ne 0 ]]; then
    if [[ "${VERBOSE:-}" != "true" ]] && [[ "${JSON_OUTPUT:-}" != "true" ]]; then
      echo -e "\n${RED}FAILED: ${step_name} (exit code: ${exit_code}, ${step_duration}s)${RESET}"
      echo -e "${DIM}Last 30 lines of log:${RESET}"
      tail -30 "$REPORTER_LOG_FILE" 2>/dev/null || true
    fi
    return "$exit_code"
  fi

  if [[ "${JSON_OUTPUT:-}" != "true" ]]; then
    echo -e "${GREEN}OK${RESET} ${step_name} (${step_duration}s)"
  fi

  return 0
}

# Record a suite result
# Usage: reporter_record_suite "SuiteName" passed failed skipped
reporter_record_suite() {
  local name="$1"
  local passed="${2:-0}"
  local failed="${3:-0}"
  local skipped="${4:-0}"
  REPORTER_SUITES+=("$name")
  REPORTER_SUITE_RESULTS+=("${passed}:${failed}:${skipped}")
}

# Print the final summary block
reporter_summary() {
  local overall_result="${1:-pass}"
  local end_time
  end_time="$(date +%s)"
  local duration=$(( end_time - REPORTER_START_TIME ))

  if [[ "${JSON_OUTPUT:-}" == "true" ]]; then
    _print_json_summary "$overall_result" "$duration"
    return
  fi

  echo ""
  echo -e "${BOLD}=== Test Results: ${REPORTER_PLATFORM} ===${RESET}"

  local total_passed=0
  local total_failed=0
  local total_skipped=0

  for i in "${!REPORTER_SUITES[@]}"; do
    local name="${REPORTER_SUITES[$i]}"
    local result="${REPORTER_SUITE_RESULTS[$i]}"
    IFS=':' read -r passed failed skipped <<< "$result"
    total_passed=$(( total_passed + passed ))
    total_failed=$(( total_failed + failed ))
    total_skipped=$(( total_skipped + skipped ))

    local status_color="$GREEN"
    if [[ "$failed" -gt 0 ]]; then
      status_color="$RED"
    fi
    echo -e "  ${name}: ${status_color}${passed} passed${RESET}, ${failed} failed, ${skipped} skipped"
  done

  if [[ "${#REPORTER_SUITES[@]}" -eq 0 ]]; then
    echo "  (no suite results recorded)"
  fi

  echo -e "  ${DIM}Duration: ${duration}s${RESET}"
  echo -e "  ${DIM}Full log: ${REPORTER_LOG_FILE}${RESET}"

  if [[ "$overall_result" == "pass" ]]; then
    echo -e "${BOLD}=== RESULT: ${GREEN}PASS${RESET}${BOLD} ===${RESET}"
  else
    echo -e "${BOLD}=== RESULT: ${RED}FAIL${RESET}${BOLD} ===${RESET}"
  fi
}

# Filter output based on platform
_filter_output() {
  local platform="$1"
  case "$platform" in
    ios)
      grep --line-buffered -E '(Test Case|Test Suite|Executed|error:|warning:|Build Succeeded|Build Failed|FAILED|PASSED|Compiling)' || true
      ;;
    android)
      grep --line-buffered -E '(> Task|BUILD|FAILED|PASSED|tests completed|Test .* FAILED|test.*PASSED|Error|Exception)' || true
      ;;
    desktop)
      grep --line-buffered -E '(PASS|FAIL|ERROR|✓|✗|tests? passed|test results|Running|Timed out)' || true
      ;;
    worker)
      grep --line-buffered -E '(PASS|FAIL|ERROR|✓|✗|Tests|test results|Running)' || true
      ;;
    crypto)
      grep --line-buffered -E '(test .* \.\.\.|test result:|running|FAILED|ok$|error\[)' || true
      ;;
    *)
      cat
      ;;
  esac
}

# Print JSON summary
_print_json_summary() {
  local result="$1"
  local duration="$2"
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local json_file="/tmp/test-${REPORTER_PLATFORM}-$(date +%Y%m%d-%H%M%S).json"

  local suites_json="[]"
  if [[ "${#REPORTER_SUITES[@]}" -gt 0 ]]; then
    suites_json="["
    for i in "${!REPORTER_SUITES[@]}"; do
      local name="${REPORTER_SUITES[$i]}"
      local suite_result="${REPORTER_SUITE_RESULTS[$i]}"
      IFS=':' read -r passed failed skipped <<< "$suite_result"
      if [[ "$i" -gt 0 ]]; then
        suites_json+=","
      fi
      suites_json+="{\"name\":\"${name}\",\"passed\":${passed},\"failed\":${failed},\"skipped\":${skipped}}"
    done
    suites_json+="]"
  fi

  cat > "$json_file" <<ENDJSON
{
  "platform": "${REPORTER_PLATFORM}",
  "timestamp": "${timestamp}",
  "duration_seconds": ${duration},
  "suites": ${suites_json},
  "result": "${result}",
  "log_file": "${REPORTER_LOG_FILE}"
}
ENDJSON

  cat "$json_file"
}

# Parse common test output for pass/fail counts
# Usage: parse_test_counts "suite_name" < log_output
# Sets: PARSED_PASSED, PARSED_FAILED, PARSED_SKIPPED
parse_cargo_results() {
  local log_file="$1"
  PARSED_PASSED=0
  PARSED_FAILED=0
  PARSED_SKIPPED=0

  # Sum across all "test result:" lines (one per crate)
  while IFS= read -r result_line; do
    local p f s
    p="$(echo "$result_line" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo 0)"
    f="$(echo "$result_line" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo 0)"
    s="$(echo "$result_line" | grep -oE '[0-9]+ ignored' | grep -oE '[0-9]+' || echo 0)"
    PARSED_PASSED=$(( PARSED_PASSED + p ))
    PARSED_FAILED=$(( PARSED_FAILED + f ))
    PARSED_SKIPPED=$(( PARSED_SKIPPED + s ))
  done < <(grep "test result:" "$log_file" 2>/dev/null || true)
}

parse_playwright_results() {
  local log_file="$1"
  PARSED_PASSED=0
  PARSED_FAILED=0
  PARSED_SKIPPED=0

  # Playwright outputs "X passed", "X failed", "X skipped"
  PARSED_PASSED="$(grep -oE '[0-9]+ passed' "$log_file" | tail -1 | grep -oE '[0-9]+' || echo 0)"
  PARSED_FAILED="$(grep -oE '[0-9]+ failed' "$log_file" | tail -1 | grep -oE '[0-9]+' || echo 0)"
  PARSED_SKIPPED="$(grep -oE '[0-9]+ skipped' "$log_file" | tail -1 | grep -oE '[0-9]+' || echo 0)"
}

parse_xcodebuild_results() {
  local log_file="$1"
  PARSED_PASSED=0
  PARSED_FAILED=0
  PARSED_SKIPPED=0

  # xcodebuild: "Executed N tests, with M failures" -- sum all lines
  while IFS= read -r executed_line; do
    local total failures
    total="$(echo "$executed_line" | grep -oE '[0-9]+ test' | head -1 | grep -oE '[0-9]+' || echo 0)"
    failures="$(echo "$executed_line" | grep -oE '[0-9]+ failure' | head -1 | grep -oE '[0-9]+' || echo 0)"
    PARSED_PASSED=$(( PARSED_PASSED + total - failures ))
    PARSED_FAILED=$(( PARSED_FAILED + failures ))
  done < <(grep "Executed" "$log_file" 2>/dev/null || true)
}

# If run directly, show help
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "Test Reporter Library"
  echo "Source this file from test scripts:"
  echo '  source "$(dirname "$0")/lib/test-reporter.sh"'
  echo ""
  echo "Functions:"
  echo "  reporter_init <platform>"
  echo "  reporter_run_step <name> <command> [args...]"
  echo "  reporter_record_suite <name> <passed> <failed> <skipped>"
  echo "  reporter_summary <pass|fail>"
fi
