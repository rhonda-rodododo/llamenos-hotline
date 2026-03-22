# E2E Test Improvements — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Improve the v1 E2E test suite quality and developer experience: port configuration for local dev (matching the new port offsets), better parallelism, isolation auditing, and a coverage gap analysis. The goal is that `bunx playwright test` works out-of-the-box for local dev without port conflicts, runs faster, and gives high confidence in regressions.

---

## 1. Port Configuration for Local Dev

### Problem

`playwright.config.ts` hardcodes port `8788` for the wrangler dev server. The Docker Compose backend services (PostgreSQL, MinIO, strfry) need to be running for tests, and local dev uses offset ports. The test config needs to accommodate both the CF Workers path (wrangler at 8788) and the Docker backend path.

### Solution

`playwright.config.ts` already reads `process.env.PLAYWRIGHT_BASE_URL` and uses it to skip the `webServer` block. Tests against Docker backend set `PLAYWRIGHT_BASE_URL=http://localhost:8788` (wrangler in front, pointing to Docker services).

No changes needed to the wrangler port (8788 has no conflict). However, the wrangler dev config needs `PLATFORM=node` and a `DATABASE_URL` pointing to `localhost:5433` (the offset PostgreSQL port) when running locally with Docker.

Add `.dev.vars.local.example`:
```
# Local dev vars — used when running wrangler dev against Docker backend
# Copy to .dev.vars.local (gitignored)
PLATFORM=node
DATABASE_URL=postgresql://llamenos:yourpassword@localhost:5433/llamenos
MINIO_ENDPOINT=http://localhost:9002
NOSTR_RELAY_URL=ws://localhost:7778
```

Document in CLAUDE.md: for local E2E, run `bun run dev:docker` first, then `bun run dev:worker`.

---

## 2. Parallelism Improvements

### Current state

`playwright.config.ts`:
```js
workers: process.env.CI ? 3 : 1,
fullyParallel: true,
```

Local dev runs single-worker (serialized), which is slow for 40+ spec files. CI runs 3 workers.

### Problem

`workers: 1` locally is intentional to avoid test isolation issues. But many specs should be safe to parallelize if they use `beforeEach` resets properly.

### Solution

**Short term:** Increase local workers to 3, matching CI. This requires all mutating specs to have proper `beforeEach` resets.

**Gate:** Only increase after completing the isolation audit (section 3).

Update `playwright.config.ts`:
```js
workers: process.env.CI ? 3 : parseInt(process.env.PLAYWRIGHT_WORKERS || '1'),
```

Operators can run `PLAYWRIGHT_WORKERS=3 bunx playwright test` locally once they verify isolation. CI remains at 3. Default stays 1 until isolation is confirmed.

---

## 3. Isolation Audit

### What

Audit all spec files that perform mutations (create/update/delete operations) to verify they call `resetTestState()` in a `beforeEach` block.

### Method

Grep-based audit to find specs that:
1. Perform mutations (POST, PUT, DELETE API calls or UI form submissions)
2. Do NOT have `test.beforeEach(() => resetTestState())`

### Known pattern

`tests/helpers.ts` exports `resetTestState(request: APIRequestContext)`. The actual call signature requires the Playwright `request` fixture. Specs should call it:
```ts
test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});
```

The grep pattern to find specs missing this is: files that contain mutation keywords (`.fill\|\.click\|request\.post\|request\.put\|request\.delete`) but do NOT contain `resetTestState(request)`. Do not grep for `resetTestState()` (no args) — that form does not exist.

### Output

Produce a `docs/TEST_ISOLATION_AUDIT.md` listing:
- Specs that are already isolated ✅
- Specs that mutate state but lack reset ⚠️
- Specs that are read-only and don't need reset ℹ️

Fix all ⚠️ specs. Mark `workers: 3` as the new local default once audit passes.

---

## 4. Coverage Gap Analysis

### What

Identify features that exist in the app but lack E2E test coverage. This feeds into future workstreams (multi-hub, application hardening).

### Method

Compare feature list (from NEXT_BACKLOG.md, COMPLETED_BACKLOG.md, and route files) against existing spec files.

Key areas to check:
- Multi-hub: `multi-hub.spec.ts` exists — but verify it covers hub switching, hub-scoped volunteer access, hub-scoped telephony routing
- Message blasts: `blasts.spec.ts` exists — verify opt-in/opt-out, scheduling
- RCS channel: `rcs-channel.spec.ts` — verify rich card sending, SMS fallback
- Reports: `reports.spec.ts` — verify export functionality
- Panic wipe: `panic-wipe.spec.ts` — verify triple-Escape trigger
- Reproducible builds: no spec (not E2E testable)
- WebRTC settings: `webrtc-settings.spec.ts` — verify per-provider settings

### Output

`docs/TEST_COVERAGE_GAPS.md` listing:
- Features with good coverage ✅
- Features with partial coverage ⚠️ (with specific gaps noted)
- Features with no coverage ❌

This document feeds into the Application Hardening workstream specs.

---

## 5. Test Reliability Improvements

### Retry configuration

CI retries are set to 1 (one retry on failure). This is appropriate. No change needed.

### Timeout review

Current timeouts:
- `timeout: 30_000` (test timeout)
- `expect.timeout: 10_000`
- `actionTimeout: 10_000`
- `navigationTimeout: 15_000`

These are reasonable. No change unless flaky tests are identified.

### Trace artifacts

Currently `trace: "on-first-retry"`. Keep as-is (already at 1-day retention per epic 64 L-8).

---

## 6. Local Dev Helper Script

Add `scripts/test-local.sh`:
```bash
#!/usr/bin/env bash
# Run E2E tests locally with Docker backend
# Usage: ./scripts/test-local.sh [playwright args]
set -e

echo "Starting Docker backend (v1 dev ports)..."
bun run dev:docker &   # background — docker compose up -d returns quickly anyway
DOCKER_PID=$!

echo "Waiting for app health check..."
until curl -sf http://localhost:8788/api/health/ready 2>/dev/null; do
  sleep 2
done

echo "Running E2E tests..."
PLAYWRIGHT_BASE_URL=http://localhost:8788 bunx playwright test "$@"
```

Note: `bun run dev:docker` wraps `docker compose up -d` which returns immediately once containers start. The health check loop ensures the app is ready before tests begin. The `&` is included for safety in case the command blocks.

---

## Testing / Success Criteria

- `bunx playwright test` runs without port conflict errors when v2 is also running
- Isolation audit complete; all mutating specs have `beforeEach` resets
- `PLAYWRIGHT_WORKERS=3 bunx playwright test` passes locally (after isolation confirmed)
- Coverage gap document exists and is actionable

## Out of Scope

- Adding new spec files (that's the Application Hardening workstream)
- Visual regression testing
- Performance/load testing (separate `load-test.yml` workflow exists)
- Live test configs (`playwright.live.config.ts`)
