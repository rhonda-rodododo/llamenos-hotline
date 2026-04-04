---
name: test-runner
description: >
  Orchestrate and run tests across all four suites (unit, integration, API E2E, UI E2E) with
  automatic service management, orphan process cleanup, worktree port tracking, and env validation.
  Use this skill whenever the user asks to run tests, check test health, verify changes work,
  or when you've completed implementation and need to validate. Also use proactively after any
  code change to verify it passes. Triggers on: "run tests", "check tests", "does this pass",
  "verify", "make sure tests pass", or after completing implementation steps.
---

# Test Runner & Orchestrator

You run tests in the Llamenos project. This means the right suite, the right services, clean
environment, and proper cleanup. Your job is operational — for guidance on *writing* tests,
use the `test-writer` skill.

## The Four Suites

| Suite | Command | Services Needed | Browser | Typical Speed |
|-------|---------|----------------|---------|--------------|
| **Unit** | `bun run test:unit` | None | No | <10s |
| **Integration** | `bun run test:integration` | Postgres, RustFS, Strfry | No | 15-30s |
| **API E2E** | `bunx playwright test --project=api` | All Docker + dev server | No | 1-3min |
| **UI E2E** | `bunx playwright test --project=ui` | All Docker + dev server | Chromium | 2-5min |

### Choosing the Right Suite

- Pure function, utility, or class → **Unit**
- Service that talks to Postgres/storage/relay → **Integration**
- API endpoint behavior through HTTP → **API E2E**
- What a user sees and clicks in the browser → **UI E2E**
- Changed code that touches multiple layers → run **all affected suites**, bottom-up

## Pre-Flight Checklist

Run these checks before every test execution. Don't skip steps — each one exists because
skipping it has caused real incidents (system freezes, false passes, hours of debugging).

### 1. Kill Orphaned Processes

Previous crashed runs leave behind bun processes that can balloon to 30GB+ and freeze the system.

```bash
# Detect orphans
ps aux | grep -E 'bun.*(server\.ts|index\.ts|sip-bridge)' | grep -v grep
```

If found, kill them:

```bash
ps -eo pid,args | grep -E 'bun.*(src/server/server\.ts|sip-bridge)' | grep -v grep | awk '{print $1}' | xargs -r kill
```

### 2. Start Services (Integration/API/UI only)

Tests that need external services must have them running. Always start — never work around
missing services with mocks or skips.

```bash
# Start all backing services
bun run dev:docker
```

Wait for health checks:

```bash
# Postgres (critical path for most tests)
until docker exec llamenos-postgres-1 pg_isready -U llamenos 2>/dev/null; do sleep 2; done
echo "Postgres ready"
```

Check service health:

```bash
docker compose --env-file deploy/docker/.env.dev.defaults \
  -f deploy/docker/docker-compose.yml \
  -f deploy/docker/docker-compose.dev.yml \
  --profile asterisk ps --format '{{.Name}}\t{{.Status}}'
```

### 3. Worktree Port Tracking

Multiple worktrees can collide on ports. Check the registry in the main repo:

```bash
cat /media/rikki/recover2/projects/llamenos-hotline/.worktree-ports.json 2>/dev/null || echo '{}'
```

See [references/worktree-ports.md](references/worktree-ports.md) for the allocation protocol.

### 4. Validate Environment

| Variable | Required For | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Integration, API, UI | `postgres://llamenos:llamenos@localhost:5433/llamenos` |
| `ENVIRONMENT` | API, UI (`/api/test-reset`) | Must be `development` |
| `JWT_SECRET` | API, UI | Test default in helpers/index.ts |
| `HMAC_SECRET` | API, UI | All zeros (dev) |

If `ENVIRONMENT` is wrong, global-setup will get 404 on `/api/test-reset` and all tests fail.

## Running Tests

### Unit Tests (no services needed)

```bash
bun run test:unit
```

Run a single file:

```bash
bun test src/server/services/specific.test.ts
```

### Integration Tests

```bash
bun run dev:docker    # ensure services
bun run test:integration
```

### API E2E Tests

```bash
bun run dev:docker    # ensure services
bun run test:api      # Playwright starts dev server automatically
```

Single file:

```bash
bunx playwright test tests/api/specific.spec.ts --project=api
```

### UI E2E Tests

```bash
bun run dev:docker
bun run test:e2e
```

Single file, headed for debugging:

```bash
bunx playwright test tests/ui/specific.spec.ts --project=ui --headed --debug
```

### All Tests (bottom-up)

```bash
bun run test:all
```

This runs unit → integration → Playwright (API + UI + bootstrap + mobile).

### Parallel Workers

Default is 3. Increase if tests are isolated (hub-scoped):

```bash
PLAYWRIGHT_WORKERS=5 bunx playwright test
```

## Post-Run

### Read Output Carefully

Count actual pass/fail numbers. Don't assume from partial output. Warnings matter.

### Verify No Orphans Left

```bash
ps aux | grep -E 'bun.*(server\.ts|index\.ts|sip-bridge)' | grep -v grep
```

The `globalTeardown` in `tests/global-teardown.ts` handles this for clean Playwright exits,
but Ctrl-C or crashes bypass it.

### Memory Check

If the system feels slow after a test run:

```bash
free -h
ps aux --sort=-%mem | head -5
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 404 on `/api/test-reset` | `ENVIRONMENT` not `development` | Check `.env.local` |
| Tests hang after Ctrl-C | Orphaned bun processes | Kill orphans (step 1 above) |
| System freeze / OOM | Runaway bridge processes | `ps aux --sort=-%mem \| head -10`, kill runaways |
| Port conflicts | Multiple worktrees | Check `.worktree-ports.json` |
| Crypto failures (macOS) | Node/Chromium PBKDF2 divergence | Use `preloadEncryptedKey()` helper |
| Connection refused | Docker services not running | `bun run dev:docker`, wait for healthchecks |
| Slow unit tests (>10s) | Tests hitting DB or network | Move to integration suite or mock at boundary |
