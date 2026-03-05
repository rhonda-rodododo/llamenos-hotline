#!/usr/bin/env bash
set -euo pipefail

# Android test runner
# Pipeline: codegen -> gradle unit tests -> lint -> androidTest compilation -> e2e (if device connected)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/test-reporter.sh"
source "$SCRIPT_DIR/lib/platform-detect.sh"

# Parse arguments
VERBOSE="${VERBOSE:-false}"
NO_CODEGEN="${NO_CODEGEN:-false}"
JSON_OUTPUT="${JSON_OUTPUT:-false}"
REPORTER_TIMEOUT="${REPORTER_TIMEOUT:-600}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose) VERBOSE=true; shift ;;
    --no-codegen) NO_CODEGEN=true; shift ;;
    --json) JSON_OUTPUT=true; shift ;;
    --timeout) REPORTER_TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

export VERBOSE JSON_OUTPUT REPORTER_TIMEOUT

cd "$PROJECT_ROOT"

ANDROID_DIR="$PROJECT_ROOT/apps/android"

# Source Java environment
if [[ -d "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
elif [[ -d "/usr/lib/jvm/java-21-openjdk-amd64" ]]; then
  export JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64"
elif [[ -n "${JAVA_HOME:-}" ]]; then
  : # Use existing JAVA_HOME
else
  echo "WARNING: JAVA_HOME not set and default paths not found"
fi

if [[ ! -d "$ANDROID_DIR" ]]; then
  echo "Android directory not found: $ANDROID_DIR"
  exit 1
fi

if [[ ! -f "$ANDROID_DIR/gradlew" ]]; then
  echo "gradlew not found in $ANDROID_DIR"
  exit 1
fi

reporter_init "android"

overall_result="pass"

# Step 1: Codegen guard
if [[ "$NO_CODEGEN" != "true" ]]; then
  if ! source "$SCRIPT_DIR/lib/codegen-guard.sh" && run_codegen_guard; then
    overall_result="fail"
    reporter_summary "$overall_result"
    exit 1
  fi
fi

# Step 2: Unit tests
if reporter_run_step "unit tests" \
  "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" testDebugUnitTest; then
  reporter_record_suite "unitTests" 1 0 0
else
  overall_result="fail"
  reporter_record_suite "unitTests" 0 1 0
fi

# Step 3: Lint
if reporter_run_step "lint" \
  "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" lintDebug; then
  reporter_record_suite "lint" 1 0 0
else
  overall_result="fail"
  reporter_record_suite "lint" 0 1 0
fi

# Step 4: Android test compilation (critical -- often skipped)
if reporter_run_step "androidTest compilation" \
  "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" compileDebugAndroidTestKotlin; then
  reporter_record_suite "androidTestCompile" 1 0 0
else
  overall_result="fail"
  reporter_record_suite "androidTestCompile" 0 1 0
fi

# Step 5: Connected E2E tests (only if device/emulator available)
if is_android_device_connected; then
  if reporter_run_step "connected E2E tests" \
    "$ANDROID_DIR/gradlew" -p "$ANDROID_DIR" connectedDebugAndroidTest; then
    reporter_record_suite "connectedE2E" 1 0 0
  else
    overall_result="fail"
    reporter_record_suite "connectedE2E" 0 1 0
  fi
else
  if [[ "${JSON_OUTPUT:-}" != "true" ]]; then
    echo -e "${YELLOW}Skipping connected E2E tests: no device/emulator detected${RESET}"
  fi
  reporter_record_suite "connectedE2E" 0 0 1
fi

reporter_summary "$overall_result"

if [[ "$overall_result" == "fail" ]]; then
  exit 1
fi
