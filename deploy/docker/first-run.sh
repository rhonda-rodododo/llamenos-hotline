#!/usr/bin/env bash
# Llamenos First-Run Setup
#
# Convenience wrapper — delegates to scripts/docker-setup.sh.
# Run from anywhere:
#   cd deploy/docker && bash first-run.sh
#   bash deploy/docker/first-run.sh
#
# Prerequisites: docker, docker compose, openssl

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec "$REPO_ROOT/scripts/docker-setup.sh" "$@"
