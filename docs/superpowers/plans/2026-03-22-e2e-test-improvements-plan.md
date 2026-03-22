# E2E Test Improvements — Implementation Plan

**Date:** 2026-03-22
**Spec:** docs/superpowers/specs/2026-03-22-e2e-test-improvements-design.md
**Status:** Ready to implement

---

## Key Findings from Codebase Exploration

1. **36 of 37 spec files lack `resetTestState(request)`** — only `bootstrap.spec.ts` calls it correctly.
2. **`resetTestState` signature:** `resetTestState(request: APIRequestContext)` — takes the `request` fixture, not zero arguments. All grepping and fixing must use `resetTestState(request)` (not `resetTestState()`).
3. **3 specs are genuinely read-only** and don't need resets: `call-recording.spec.ts`, `panic-wipe.spec.ts`, `rcs-channel.spec.ts`.
4. **Serial describe blocks** in `reports.spec.ts`, `multi-hub.spec.ts`, `demo-mode.spec.ts` — must use `beforeAll` not `beforeEach`.
5. **`dev:docker` script does not yet exist** in `package.json` — it's being added by the Foundation Tooling workstream. This plan depends on that workstream completing first (or proceed with `docker compose up -d` directly).
6. **`reuseExistingServer: !process.env.CI`** already set in playwright.config.ts — do not change this when enabling parallelism.

---

## Dependency Order

```
Step 1 (create plan file)
    ↓
Step 2 (isolation audit grep commands) ──→ Step 3 (write TEST_ISOLATION_AUDIT.md)
                                                  ↓
                                           Step 4 (add resets to all specs)
                                                  ↓
                                           Step 6 (enable parallelism in config)

Step 5 (coverage gap analysis) → Step 5d (write TEST_COVERAGE_GAPS.md)
    [independent of Steps 3-4]

Steps 7, 8, 9 — independent of each other and of Steps 2-6
```

---

## Step 2 — Isolation Audit Grep Commands

Run from repo root:

```bash
# Find specs already calling resetTestState(request):
grep -l "resetTestState(request)" tests/*.spec.ts
# Expected: tests/bootstrap.spec.ts only

# Find specs with mutations but NO resetTestState(request):
grep -rL "resetTestState(request)" tests/*.spec.ts | \
  xargs grep -l "\.fill\|\.click\|request\.post\|request\.put\|request\.delete"
# These are the "needs reset" list

# Find read-only specs (no mutation keywords):
grep -rL "\.fill\|\.click\|request\.post\|request\.put\|request\.delete" tests/*.spec.ts
# Expected: call-recording.spec.ts, panic-wipe.spec.ts, rcs-channel.spec.ts

# Find serial describe blocks (need beforeAll not beforeEach):
grep -l "mode: 'serial'" tests/*.spec.ts

# Sanity check — confirm no broken zero-arg calls exist:
grep -l "resetTestState()" tests/*.spec.ts
# Expected: empty
```

---

## Step 3 — Write `docs/TEST_ISOLATION_AUDIT.md`

**File to create:** `docs/TEST_ISOLATION_AUDIT.md`

```markdown
# Test Isolation Audit

Generated: 2026-03-22

## Summary
- Total spec files: 37 (excluding bootstrap.spec.ts from counts)
- Already isolated: 1 ✅
- Read-only (no reset needed): 3 ℹ️
- Needs reset added: 33 ⚠️

## ✅ Already Isolated
- `bootstrap.spec.ts` — calls `resetTestState(request)` correctly

## ℹ️ Read-Only (No Server State Mutation)
- `call-recording.spec.ts` — reads call history UI, no persisted mutations
- `panic-wipe.spec.ts` — clears localStorage only, no server state
- `rcs-channel.spec.ts` — reads admin settings page only

## ⚠️ Mutates State — Reset Required (33 files)
### Serial describe blocks (use `beforeAll` pattern):
- `reports.spec.ts` — reset at outer describe level
- `multi-hub.spec.ts` — reset at top-level describe
- `demo-mode.spec.ts` — reset at top-level describe

### Standard (use `beforeEach` pattern):
[all remaining 30 spec files — list populated during audit execution]

## Grep Patterns Used
- Mutation check: `.fill`, `.click`, `request.post`, `request.put`, `request.delete`
- Correct reset call: `resetTestState(request)` (takes request fixture, not zero args)
```

---

## Step 4 — Add `resetTestState(request)` to All 33 ⚠️ Specs

### Pattern A — Specs with existing `beforeEach`

```typescript
// Before:
test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})

// After:
test.beforeEach(async ({ page, request }) => {
  await resetTestState(request)
  await loginAsAdmin(page)
})
```

Add `resetTestState` to the import line if not already imported:
```typescript
import { loginAsAdmin, resetTestState } from './helpers'
```

### Pattern B — Specs with no existing `beforeEach`

```typescript
// Add at top of the describe block (or file if no describe):
test.beforeEach(async ({ request }) => {
  await resetTestState(request)
})
```

### Pattern C — Serial describe blocks (`reports.spec.ts`, `multi-hub.spec.ts`, `demo-mode.spec.ts`)

```typescript
test.describe('Suite Name', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  // ... tests that share state across the block ...
})
```

Use `beforeAll` (not `beforeEach`) — serial tests share inter-test state by design. Reset runs once at the start.

### Specific notes per spec

- **`admin-flow.spec.ts`**, **`notes-crud.spec.ts`**, **`shift-management.spec.ts`**, **`custom-fields.spec.ts`**, **`ban-management.spec.ts`**: Already have `beforeEach({ page }) => loginAsAdmin(page)` — add `request` to destructuring and prepend reset.
- **`smoke.spec.ts`**: No `beforeEach`, no `loginAsAdmin`. Add `beforeEach({ request }) => resetTestState(request)` at file level (outside any describe).
- **`reports.spec.ts`**: Has two nested serial describes. Add `beforeAll(reset)` to the outer `'Reports feature'` describe only — inner describes share state.
- **`theme.spec.ts`**: Only changes localStorage theme — technically no server state. But add reset anyway as cheap insurance since it calls `loginAsAdmin`.

---

## Step 5 — Coverage Gap Analysis

### Step 5a — Enumerate all routes

```bash
find src/client/routes -name "*.tsx" | sort
```

### Step 5b — Extract URL strings from spec files

```bash
grep -h "goto\|navigateAfterLogin\|navigateTo" tests/*.spec.ts | \
  grep -oE "'[^']*'" | sort -u
```

### Step 5c — Coverage mapping

| Route/Feature | Spec File(s) | Status |
|---|---|---|
| `/login` | smoke, auth-guards, login-restore | ✅ |
| `/setup` | setup-wizard, bootstrap, demo-mode | ✅ |
| `/onboarding` | invite-onboarding, reports | ✅ |
| `/notes` | notes-crud, notes-custom-fields, call-recording | ✅ |
| `/calls` | call-recording, admin-flow | ⚠️ No call state machine E2E |
| `/conversations` | conversations, messaging-epics | ⚠️ Partial |
| `/volunteers` | admin-flow, volunteer-flow, pin-challenge | ✅ |
| `/shifts` | shift-management, admin-flow | ✅ |
| `/bans` | ban-management | ✅ |
| `/blasts` | blasts | ⚠️ Composer only, no actual send/opt-in/out |
| `/reports` | reports | ✅ |
| `/audit` | audit-log | ✅ |
| `/help` | help | ✅ |
| `/admin/hubs` | multi-hub | ⚠️ Hub switching and cross-hub scoping untested |
| `/admin/settings` | telephony-provider, webrtc-settings, rcs-channel | ⚠️ RCS barely tested |
| `/preferences` | theme | ⚠️ Theme only |
| Panic wipe | panic-wipe | ✅ |
| Client transcription | client-transcription | ✅ |
| Roles/permissions | roles, epic-24-27 | ✅ |
| Hub deletion/archiving | none | ❌ Not yet implemented |
| Cross-hub call reception | none | ❌ Multi-hub gap |

### Step 5d — Write `docs/TEST_COVERAGE_GAPS.md`

Create file documenting all ⚠️ and ❌ items with specific gaps noted per feature. This feeds directly into the Application Hardening workstream.

---

## Step 6 — Update `playwright.config.ts` — Parallelism

**File:** `playwright.config.ts`

**Dependency:** Complete Step 4 first (all isolation fixes confirmed working).

```typescript
// Before:
workers: process.env.CI ? 3 : 1,

// After:
workers: process.env.CI ? 3 : parseInt(process.env.PLAYWRIGHT_WORKERS || '1'),
```

Do NOT change `reuseExistingServer: !process.env.CI` — leave as-is. This is correct.

Local default stays at 1 until isolation is verified. Enable via `PLAYWRIGHT_WORKERS=3 bunx playwright test`.

---

## Step 7 — Create `.dev.vars.local.example`

**File to create:** `/home/rikki/projects/llamenos-hotline/.dev.vars.local.example`

```
# Local dev vars — used when running wrangler dev against Docker backend
# Copy to .dev.vars.local (gitignored) and fill in your values
PLATFORM=node
DATABASE_URL=postgresql://llamenos:yourpassword@localhost:5433/llamenos
MINIO_ENDPOINT=http://localhost:9002
NOSTR_RELAY_URL=ws://localhost:7778
```

Check `.gitignore` and add `.dev.vars.local` if not already present:
```bash
grep "dev.vars.local" .gitignore || echo ".dev.vars.local" >> .gitignore
```

---

## Step 8 — Create `scripts/test-local.sh`

**File to create:** `scripts/test-local.sh`

```bash
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
```

Make executable: `chmod +x scripts/test-local.sh`

Note: `bun run dev:docker` is added by Foundation Tooling workstream. If not yet available, use `docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.dev.yml up -d` directly.

---

## Step 9 — Update `CLAUDE.md`

Add to Development Commands:

```
bun run dev:docker                           # Start Docker backing services (v1 port offsets)
./scripts/test-local.sh                      # Run E2E tests against Docker backend
PLAYWRIGHT_WORKERS=3 bunx playwright test    # Run with 3 workers (after isolation verified)
```

Add note: "For local E2E tests, copy `.dev.vars.local.example` to `.dev.vars.local`, fill in values, then start backing services before running wrangler dev."

---

## Step 10 — Verification

```bash
# Confirm all mutation specs now have resets:
grep -rL "resetTestState(request)" tests/*.spec.ts | \
  xargs grep -l "\.fill\|\.click\|request\.post\|request\.put\|request\.delete" 2>/dev/null
# Expected: empty output

# Typecheck:
bun run typecheck

# Full suite (single worker):
bunx playwright test

# Three workers (after isolation confirmed):
PLAYWRIGHT_WORKERS=3 bunx playwright test

# Run 3x to confirm no flakiness:
for i in 1 2 3; do PLAYWRIGHT_WORKERS=3 bunx playwright test --reporter=list; done

# Confirm docs exist:
ls docs/TEST_ISOLATION_AUDIT.md docs/TEST_COVERAGE_GAPS.md
```

---

## Files Created / Modified

| File | Action |
|------|--------|
| `docs/TEST_ISOLATION_AUDIT.md` | Create |
| `docs/TEST_COVERAGE_GAPS.md` | Create |
| `tests/*.spec.ts` (33 files) | Modify (add beforeEach/beforeAll resets) |
| `playwright.config.ts` | Modify (PLAYWRIGHT_WORKERS env var) |
| `.dev.vars.local.example` | Create |
| `.gitignore` | Modify (add .dev.vars.local if missing) |
| `scripts/test-local.sh` | Create |
| `CLAUDE.md` | Modify |
