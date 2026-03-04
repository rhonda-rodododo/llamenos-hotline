#!/usr/bin/env bash
# iOS build pipeline — runs commands on Mac M4 via SSH
#
# Designed to be run from a Linux development machine. All heavy lifting
# happens on the remote Mac via SSH. Requires passwordless SSH access.
#
# Usage:
#   ./scripts/ios-build.sh status      # Check Xcode/toolchain status
#   ./scripts/ios-build.sh setup       # Install Rust + iOS targets on Mac
#   ./scripts/ios-build.sh sync        # Git pull on Mac
#   ./scripts/ios-build.sh build       # swift build (SPM)
#   ./scripts/ios-build.sh test        # swift test (SPM)
#   ./scripts/ios-build.sh xcframework # Build LlamenosCoreFFI XCFramework
#   ./scripts/ios-build.sh uitest      # Run XCUITest on simulator
#   ./scripts/ios-build.sh all         # sync + xcframework + build + test
#
# Environment:
#   IOS_BUILD_HOST  SSH host alias (default: mac)
#   IOS_BUILD_DIR   Remote project directory (default: ~/projects/llamenos)
#   IOS_BUILD_BRANCH  Git branch to sync (default: desktop)

set -euo pipefail

MAC_HOST="${IOS_BUILD_HOST:-mac}"
REMOTE_DIR="${IOS_BUILD_DIR:-~/projects/llamenos}"
BRANCH="${IOS_BUILD_BRANCH:-desktop}"

# SPM scheme name (xcodebuild generates "PackageName-Package" for SPM packages)
XCODE_SCHEME="Llamenos-Package"

# Remote shell init — SSH non-login shells miss Homebrew and asdf paths
REMOTE_INIT='eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null; export PATH="$HOME/.asdf/shims:$HOME/.asdf/bin:$PATH"'

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[ios-build]${NC} $*"; }
warn() { echo -e "${YELLOW}[ios-build]${NC} $*"; }
err()  { echo -e "${RED}[ios-build]${NC} $*" >&2; }
info() { echo -e "${BLUE}[ios-build]${NC} $*"; }

# ─── SSH helpers ──────────────────────────────────────────────

remote() {
  ssh -o ConnectTimeout=10 -o BatchMode=yes "$MAC_HOST" "$@"
}

remote_script() {
  # Run a multi-line script on the remote host via heredoc.
  # Usage: remote_script <<'SCRIPT' ... SCRIPT
  ssh -o ConnectTimeout=10 -o BatchMode=yes "$MAC_HOST" bash -l -s
}

check_ssh() {
  if ! remote "echo ok" &>/dev/null; then
    err "Cannot connect to $MAC_HOST via SSH."
    err "Verify SSH config: ssh $MAC_HOST"
    exit 1
  fi
}

check_xcode() {
  log "Checking Xcode installation..."
  if ! remote "xcodebuild -version" &>/dev/null; then
    err "Full Xcode is required but not installed or not selected."
    err ""
    err "To install Xcode:"
    err "  1. On the Mac, open App Store and install Xcode"
    err "  2. Accept license: sudo xcodebuild -license accept"
    err "  3. Select it: sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer"
    err ""
    err "Current developer directory:"
    remote "xcode-select -p 2>&1" || true
    exit 1
  fi
}

check_rust() {
  if ! remote "command -v rustc" &>/dev/null; then
    err "Rust is not installed on $MAC_HOST."
    err "Run: ./scripts/ios-build.sh setup"
    exit 1
  fi
}

# ─── Commands ─────────────────────────────────────────────────

cmd_status() {
  check_ssh
  log "Checking toolchain status on $MAC_HOST..."
  echo ""
  remote_script <<'SCRIPT'
echo "=== macOS ==="
sw_vers
echo ""

echo "=== Developer Tools ==="
echo -n "  xcode-select path: "
xcode-select -p 2>&1
echo -n "  xcodebuild: "
xcodebuild -version 2>&1 | head -1 || echo "NOT INSTALLED (full Xcode required)"
echo -n "  CLT version: "
pkgutil --pkg-info=com.apple.pkg.CLTools_Executables 2>/dev/null | grep version | awk '{print $2}' || echo "not found"
echo ""

echo "=== Xcode.app ==="
if [ -d "/Applications/Xcode.app" ]; then
  echo "  Installed at /Applications/Xcode.app"
  /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -version 2>/dev/null || true
else
  echo "  NOT INSTALLED"
  echo "  Only Command Line Tools are present."
  echo "  Full Xcode is needed for: xcodebuild, XCFramework creation, simulator tests"
fi
echo ""

echo "=== Rust ==="
if command -v rustc &>/dev/null; then
  rustc --version
  echo -n "  iOS targets: "
  rustup target list --installed 2>/dev/null | grep -c "ios" || echo "0"
  rustup target list --installed 2>/dev/null | grep "ios" || true
  echo -n "  cargo-ndk: "
  command -v cargo-ndk &>/dev/null && echo "installed" || echo "not installed"
else
  echo "  NOT INSTALLED"
  echo "  Run: ./scripts/ios-build.sh setup"
fi
echo ""

echo "=== Swift ==="
swift --version 2>&1 | head -1
echo ""

echo "=== Simulators ==="
if command -v xcrun &>/dev/null && xcodebuild -version &>/dev/null; then
  xcrun simctl list devices available 2>/dev/null | grep -E "iPhone|iPad" | head -15
  echo "  ..."
else
  echo "  Not available (requires full Xcode)"
fi
SCRIPT
}

cmd_setup() {
  check_ssh
  log "Setting up build toolchain on $MAC_HOST..."

  # Install Rust if missing
  if ! remote "command -v rustc" &>/dev/null; then
    log "Installing Rust via rustup..."
    remote_script <<'SCRIPT'
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"
rustc --version
SCRIPT
    log "Rust installed."
  else
    info "Rust already installed."
  fi

  # Add iOS targets
  log "Adding iOS cross-compilation targets..."
  remote_script <<'SCRIPT'
source "$HOME/.cargo/env" 2>/dev/null || true
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
echo "Installed iOS targets:"
rustup target list --installed | grep ios
SCRIPT

  # Clone repo if not present
  log "Ensuring project directory exists on $MAC_HOST..."
  remote_script <<SCRIPT
if [ ! -d "$REMOTE_DIR/.git" ]; then
  echo "Cloning repository..."
  mkdir -p "$(dirname "$REMOTE_DIR")"
  git clone "$(git remote get-url origin 2>/dev/null || echo 'git@github.com:llamenos/llamenos.git')" "$REMOTE_DIR"
  cd "$REMOTE_DIR"
  git checkout "$BRANCH"
else
  echo "Repository already exists at $REMOTE_DIR"
fi
SCRIPT

  log "Setup complete. Run './scripts/ios-build.sh status' to verify."
}

cmd_sync() {
  check_ssh
  log "Syncing repository on $MAC_HOST..."
  remote_script <<SCRIPT
cd "$REMOTE_DIR" || { echo "ERROR: $REMOTE_DIR does not exist. Run setup first."; exit 1; }
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"
echo ""
echo "HEAD: $(git log --oneline -1)"
SCRIPT
  log "Sync complete."
}

cmd_xcframework() {
  check_ssh
  check_xcode
  check_rust
  log "Building LlamenosCoreFFI XCFramework..."
  remote_script <<SCRIPT
$REMOTE_INIT
source "\$HOME/.cargo/env" 2>/dev/null || true
cd "$REMOTE_DIR"
bash packages/crypto/scripts/build-mobile.sh ios

# Copy XCFramework to iOS app directory
log "Copying XCFramework to apps/ios/..."
rm -rf apps/ios/LlamenosCoreFFI.xcframework
cp -R packages/crypto/dist/ios/LlamenosCoreFFI.xcframework apps/ios/LlamenosCoreFFI.xcframework

# Copy generated Swift bindings
cp packages/crypto/dist/ios/LlamenosCore.swift apps/ios/Sources/Generated/LlamenosCore.swift

echo "XCFramework installed at apps/ios/LlamenosCoreFFI.xcframework"
SCRIPT
  log "XCFramework built and installed."
}

cmd_build() {
  check_ssh
  check_xcode
  log "Building iOS app (xcodebuild)..."

  # Find an available simulator for the build destination
  local sim_device
  sim_device=$(find_simulator)

  remote_script <<SCRIPT
$REMOTE_INIT
source "\$HOME/.cargo/env" 2>/dev/null || true
cd "$REMOTE_DIR/apps/ios"
xcodebuild build \
  -scheme "$XCODE_SCHEME" \
  -destination "platform=iOS Simulator,name=$sim_device" \
  -derivedDataPath /tmp/llamenos-build \
  2>&1 | tail -20
SCRIPT
  log "Build succeeded."
}

cmd_test() {
  check_ssh
  check_xcode
  log "Running iOS tests (xcodebuild test)..."

  local sim_device
  sim_device=$(find_simulator)

  remote_script <<SCRIPT
$REMOTE_INIT
source "\$HOME/.cargo/env" 2>/dev/null || true
cd "$REMOTE_DIR/apps/ios"
xcodebuild test \
  -scheme "$XCODE_SCHEME" \
  -destination "platform=iOS Simulator,name=$sim_device" \
  -derivedDataPath /tmp/llamenos-build \
  2>&1
SCRIPT
  log "Tests passed."
}

cmd_uitest() {
  check_ssh
  check_xcode
  log "Running XCUITests on simulator..."

  local sim_device
  sim_device=$(find_simulator)

  log "Using simulator: $sim_device"
  remote_script <<SCRIPT
$REMOTE_INIT
cd "$REMOTE_DIR/apps/ios"
xcodebuild test \
  -scheme "$XCODE_SCHEME" \
  -destination "platform=iOS Simulator,name=$sim_device" \
  -resultBundlePath TestResults.xcresult \
  2>&1 | xcbeautify 2>/dev/null || cat
SCRIPT
  log "XCUITests completed."
}

find_simulator() {
  # Find an available iPhone simulator, with fallback
  remote_script <<'SCRIPT'
xcrun simctl list devices available -j 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devices in sorted(data.get('devices', {}).items(), reverse=True):
    if 'iOS' in runtime:
        for d in devices:
            if d.get('isAvailable') and 'iPhone' in d.get('name', ''):
                print(d['name'])
                sys.exit(0)
print('iPhone 17')
" 2>/dev/null || echo "iPhone 17"
SCRIPT
}

cmd_all() {
  cmd_sync
  cmd_xcframework
  cmd_build
  cmd_test
  log "All iOS build steps completed successfully."
}

cmd_help() {
  echo "Usage: $0 <command>"
  echo ""
  echo "Commands:"
  echo "  status       Check Xcode, Rust, Swift, and simulator status on the Mac"
  echo "  setup        Install Rust and iOS targets on the Mac (first-time setup)"
  echo "  sync         Git pull the current branch on the Mac"
  echo "  build        Run 'swift build' for the iOS app"
  echo "  test         Run 'swift test' for the iOS app"
  echo "  xcframework  Build the LlamenosCoreFFI XCFramework (requires Xcode + Rust)"
  echo "  uitest       Run XCUITests on a simulator (requires Xcode)"
  echo "  all          Run sync + xcframework + build + test"
  echo ""
  echo "Environment variables:"
  echo "  IOS_BUILD_HOST    SSH host alias (default: mac)"
  echo "  IOS_BUILD_DIR     Remote project directory (default: ~/projects/llamenos)"
  echo "  IOS_BUILD_BRANCH  Git branch to sync (default: desktop)"
}

# ─── Main ─────────────────────────────────────────────────────

ACTION="${1:-help}"
case "$ACTION" in
  status)      cmd_status ;;
  setup)       cmd_setup ;;
  sync)        cmd_sync ;;
  xcframework) cmd_xcframework ;;
  build)       cmd_build ;;
  test)        cmd_test ;;
  uitest)      cmd_uitest ;;
  all)         cmd_all ;;
  help|--help|-h) cmd_help ;;
  *)
    err "Unknown command: $ACTION"
    echo ""
    cmd_help
    exit 1
    ;;
esac
