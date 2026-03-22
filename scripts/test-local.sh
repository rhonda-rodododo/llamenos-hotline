#!/usr/bin/env bash
# Run E2E tests locally with Docker backend
# Usage: ./scripts/test-local.sh [playwright args]
set -e

echo "Starting Docker backend (v1 dev ports)..."
bun run dev:docker &
DOCKER_PID=$!

echo "Waiting for app health check..."
until curl -sf http://localhost:8788/api/health/ready 2>/dev/null; do
  sleep 2
done

echo "Running E2E tests..."
PLAYWRIGHT_BASE_URL=http://localhost:8788 bunx playwright test "$@"
