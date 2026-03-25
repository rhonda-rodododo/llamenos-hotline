#!/usr/bin/env bash
# Generate locally-trusted TLS certificates for dev Asterisk WSS.
# Requires mkcert: https://github.com/FiloSottile/mkcert
#
# Usage: ./scripts/dev-certs.sh
#
# Generates certs in asterisk-bridge/dev-certs/ for:
# - Asterisk WSS (localhost, 127.0.0.1)

set -euo pipefail

CERT_DIR="asterisk-bridge/dev-certs"

if ! command -v mkcert &>/dev/null; then
  echo "Error: mkcert is not installed."
  echo "Install it: https://github.com/FiloSottile/mkcert#installation"
  exit 1
fi

# Install local CA if not already done
mkcert -install 2>/dev/null || true

mkdir -p "$CERT_DIR"

echo "Generating TLS certificates for local Asterisk WSS..."
mkcert -cert-file "$CERT_DIR/asterisk.pem" \
       -key-file "$CERT_DIR/asterisk.key" \
       localhost 127.0.0.1 ::1

echo "Certificates generated:"
echo "  $CERT_DIR/asterisk.pem"
echo "  $CERT_DIR/asterisk.key"
echo ""
echo "Mount into Asterisk container at /etc/asterisk/keys/"
