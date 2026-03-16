#!/usr/bin/env bash
# Build WASM module from the Rust crypto crate using wasm-pack.
# Output goes to packages/crypto/dist/wasm/ for use by Vite/esbuild.
#
# Usage:
#   ./scripts/build-wasm.sh           # Release build (default)
#   ./scripts/build-wasm.sh dev       # Development build (faster, larger, debug symbols)
#
# Prerequisites:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$CRATE_DIR/dist/wasm"

PROFILE="${1:-release}"

echo "Building WASM module (profile: $PROFILE)..."

cd "$CRATE_DIR"

if [ "$PROFILE" = "dev" ]; then
  wasm-pack build \
    --target web \
    --out-dir "$OUT_DIR" \
    --dev \
    --features wasm \
    --no-default-features
else
  wasm-pack build \
    --target web \
    --out-dir "$OUT_DIR" \
    --release \
    --features wasm \
    --no-default-features
fi

# Remove generated .gitignore (wasm-pack adds one)
rm -f "$OUT_DIR/.gitignore"

# Remove the generated package.json (we import directly, not via npm)
rm -f "$OUT_DIR/package.json"

echo ""
echo "=============================="
echo " WASM Build Summary"
echo "=============================="
echo ""
echo "Output: $OUT_DIR"
ls -lh "$OUT_DIR"/*.wasm "$OUT_DIR"/*.js "$OUT_DIR"/*.d.ts 2>/dev/null || true
echo ""

# Show WASM file size
if [ -f "$OUT_DIR/llamenos_core_bg.wasm" ]; then
  SIZE=$(wc -c < "$OUT_DIR/llamenos_core_bg.wasm")
  echo "WASM binary: $(echo "scale=1; $SIZE/1024" | bc)KB"
fi

echo ""
echo "Done. Import in JavaScript:"
echo "  import init, { WasmCryptoState, generateKeypair } from '@protocol/../../packages/crypto/dist/wasm/llamenos_core'"
