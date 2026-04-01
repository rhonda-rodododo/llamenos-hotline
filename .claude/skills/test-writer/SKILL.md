---
name: test-writer
description: >
  Write tests for the Llamenos project following established patterns, principles, and project
  conventions. Covers all four suites: unit, integration, API E2E, and UI E2E. Use this skill
  whenever writing new tests, adding test coverage, implementing features that need tests (all of
  them), or following TDD. Complements test-runner (which handles execution) and
  test-driven-development (which handles the red-green-refactor cycle). Triggers on: "write tests",
  "add tests for", "test coverage", "TDD", implementing any new feature or fix, or when a test
  file needs to be created or modified.
---

# Test Writer

You write tests for the Llamenos project. Every feature and fix ships with tests — no exceptions.
This skill teaches you the project's patterns, helpers, and conventions so tests are consistent,
reliable, and parallel-safe.

For *running* tests, use the `test-runner` skill. For the *red-green-refactor workflow*, use
the `test-driven-development` superpowers skill. This skill covers *what to write and how*.

## Core Principles

These exist because violations have caused real incidents — system crashes, false CI passes,
and hours lost debugging phantom failures.

### Tests Protect the App

**Never weaken a test to fix a failure.** If a test fails, the code is wrong. Find and fix
the root cause. The only exception is a genuine test bug (wrong assertion, race in setup) —
and fixing that *strengthens* the test.

**Never weaken the app to fix a test.** Don't add test-only code paths, relax validation, or
skip security checks. If the test can't exercise the real code path, the test infrastructure
needs fixing.

### Natural Flows Over Synthetic

Test what actually happens in the real system. Prefer an end-to-end flow
(`create → read → update → delete`) over testing each operation in isolation. Real bugs live
in the interactions between operations — a create that works alone but breaks subsequent reads
won't be caught by isolated tests.

This applies most strongly to API and UI E2E tests. Unit tests naturally test isolated units.

### Tests Must Be Parallel-Safe

Every test file must be safe to run concurrently with every other file. The mechanism is
**hub scoping** — each file creates its own hub and runs all tests within it. No file may
depend on state created by another file.

### Unit Tests Must Be Fast

If a unit test takes more than 100ms, something is wrong. It's either hitting the network,
disk, or database — which means it belongs in the integration suite.

## Suite Reference

### Unit Tests (`*.test.ts`)

**Location**: Colocated with source. `src/server/services/foo.ts` → `src/server/services/foo.test.ts`

**Framework**: `bun:test`

**Pattern**:

```typescript
import { describe, expect, test } from 'bun:test'
import { myFunction } from './my-module'

describe('myFunction', () => {
  test('returns encrypted bytes for valid input', () => {
    const result = myFunction(validInput)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(32)
  })

  test('throws on empty input', () => {
    expect(() => myFunction(new Uint8Array(0))).toThrow('Input must not be empty')
  })
})
```

**Rules**:
- No network, no disk, no database. Pure computation only.
- Mock only at boundaries when absolutely necessary (e.g., an external API client).
  Prefer testing real logic over mocking it away.
- One behavior per test. Names read like specs: `"encrypts note with per-note random key"`.
- No `beforeAll`/`afterAll` with async setup — that's an integration test smell.

### Integration Tests (`*.integration.test.ts`)

**Location**: Colocated with source. `src/server/services/foo.ts` → `src/server/services/foo.integration.test.ts`

**Framework**: `bun:test`

**Requires**: Docker services running (`bun run dev:docker`)

**Pattern**:

```typescript
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { RecordsService } from './records-service'
import { db } from '../db'

describe('RecordsService', () => {
  let service: RecordsService
  let hubId: string

  beforeAll(async () => {
    // Create isolated hub for this test file
    hubId = crypto.randomUUID()
    await db.insert(hubs).values({ id: hubId, name: `test-${Date.now()}` })
    service = new RecordsService(db)
  })

  afterAll(async () => {
    // Clean up hub and all scoped data
    await db.delete(hubs).where(eq(hubs.id, hubId))
  })

  test('creates and retrieves a note', async () => {
    const note = await service.createNote(hubId, { content: encrypted, authorPubkey: pubkey })
    const retrieved = await service.getNote(hubId, note.id)
    expect(retrieved).toBeDefined()
    expect(retrieved!.authorPubkey).toBe(pubkey)
  })
})
```

**Rules**:
- Test real integrations. The whole point is verifying your code works with the actual database,
  storage, or relay. Mocking defeats the purpose.
- Hub-scoped isolation. Each file gets its own hub. Clean up in `afterAll`.
- These run with `bun test .integration.` — the filename pattern matters.

### API E2E Tests (`tests/api/*.spec.ts`)

**Location**: `tests/api/`

**Framework**: Playwright (request fixture only, no browser)

**Requires**: Docker services + dev server

**Key helpers**:
- `createAuthedRequest(request, nsecOrSecretKey)` — wraps Playwright's `APIRequestContext` with JWT auth
- `createAuthedRequestFromNsec(request, nsec)` — convenience for nsec strings
- `simulateIncomingCall(request, provider, params)` — telephony webhook simulation
- `simulateIncomingMessage(request, provider, channel, params)` — messaging simulation

**Pattern**:

```typescript
import { test, expect } from '@playwright/test'
import { createAuthedRequestFromNsec } from '../helpers/authed-request'
import { ADMIN_NSEC } from '../helpers'

test.describe('Volunteers API', () => {
  let hubId: string

  test.beforeAll(async ({ request }) => {
    const api = await createAuthedRequestFromNsec(request, ADMIN_NSEC)
    const res = await api.post('/api/hubs', { name: `test-vol-${Date.now()}` })
    expect(res.ok()).toBeTruthy()
    hubId = (await res.json()).id
  })

  test.afterAll(async ({ request }) => {
    const api = await createAuthedRequestFromNsec(request, ADMIN_NSEC)
    await api.delete(`/api/hubs/${hubId}`)
  })

  test('create and list volunteers', async ({ request }) => {
    const api = await createAuthedRequestFromNsec(request, ADMIN_NSEC)

    // Create
    const createRes = await api.post(`/api/hubs/${hubId}/volunteers`, {
      name: 'Test Volunteer',
      phone: '+15551234567',
    })
    expect(createRes.ok()).toBeTruthy()
    const volunteer = await createRes.json()

    // List — verify the volunteer appears
    const listRes = await api.get(`/api/hubs/${hubId}/volunteers`)
    expect(listRes.ok()).toBeTruthy()
    const volunteers = await listRes.json()
    expect(volunteers.some((v: { id: string }) => v.id === volunteer.id)).toBe(true)
  })
})
```

**Rules**:
- Test through HTTP. Don't import server internals — the HTTP boundary is the contract.
- Natural flows. `POST` → `GET` → `PUT` → `DELETE` in sequence, not isolated.
- Use simulation helpers for telephony/messaging instead of hitting real providers.
- Hub-scoped. Create hub in `beforeAll`, delete in `afterAll`.

### UI E2E Tests (`tests/ui/*.spec.ts`)

**Location**: `tests/ui/`

**Framework**: Playwright (browser context)

**Requires**: Docker services + dev server + Chromium

**Key helpers**:
- `loginAsAdmin(page)` — full admin auth flow (nsec + PIN + session)
- `loginAsVolunteer(page, nsec)` — volunteer auth with profile setup
- `enterPin(page, pin)` — PIN entry with auto-advance
- `navigateAfterLogin(page, url)` — SPA navigation without reload
- `createTestHub(page, name)` — creates hub via API while on page
- Page objects in `tests/pages/index.ts` — `waitForApiAndUi()`, `clickAndWaitForApi()`

**Pattern**:

```typescript
import { test, expect } from '@playwright/test'
import { loginAsAdmin, createTestHub, deleteTestHub, TestIds } from '../helpers'

test.describe('Volunteer Management', () => {
  let hubId: string

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await loginAsAdmin(page)
    hubId = await createTestHub(page, `test-ui-vol-${Date.now()}`)
    await page.close()
  })

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage()
    await loginAsAdmin(page)
    await deleteTestHub(page, hubId)
    await page.close()
  })

  test('adds a volunteer from the UI', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto(`/admin/hubs/${hubId}/volunteers`)

    // Use stable data-testid selectors
    await page.getByTestId(TestIds.VOLUNTEER_ADD_BTN).click()
    await page.getByTestId(TestIds.VOLUNTEER_NAME_INPUT).fill('Jane Doe')
    await page.getByTestId(TestIds.VOLUNTEER_PHONE_INPUT).fill('+15559876543')
    await page.getByTestId(TestIds.VOLUNTEER_SAVE_BTN).click()

    // Verify the volunteer appears in the list
    await expect(page.getByTestId(TestIds.VOLUNTEER_ROW)).toContainText('Jane Doe')
  })
})
```

**Rules**:
- **Stable selectors only.** Use `getByTestId()` with constants from `tests/test-ids.ts`.
  Never `getByText()` for dynamic content — it breaks on i18n, rewording, or data changes.
  If a component doesn't have a `data-testid`, add one.
- **Natural user flows.** Navigate → interact → verify result. Test what a user does, not
  implementation details.
- **Page objects for shared flows.** Login, navigation, hub creation live in helpers/pages.
  If you're writing the same sequence in multiple tests, extract it.
- **Auth helpers handle complexity.** `loginAsAdmin(page)` deals with nsec encryption, PIN entry,
  session modals, and profile setup. Don't reimplement auth in tests.

## Selectors: The TestIds System

All stable selectors live in `tests/test-ids.ts`:

```typescript
export const TestIds = {
  VOLUNTEER_ADD_BTN: 'volunteer-add-btn',
  VOLUNTEER_ROW: 'volunteer-row',
  // ...
}
```

When adding a new component that tests need to interact with:

1. Add the ID to `tests/test-ids.ts` following the `SECTION_ELEMENT_ACTION` convention
2. Add `data-testid={TestIds.YOUR_ID}` to the component
3. Use `page.getByTestId(TestIds.YOUR_ID)` in tests

This means selectors survive refactors, renames, and i18n changes.

## Hub Scoping for Parallelism

This is the key pattern that makes parallel test execution safe. Each test file operates in
its own hub — no shared state, no ordering dependencies.

```
File A (hub-a)  ──┐
File B (hub-b)  ──┼── Parallel workers, no interference
File C (hub-c)  ──┘
```

Within a file, tests run serially (they may depend on prior test state within the same hub).
Across files, everything is parallel.

**Setup**: Create hub in `beforeAll`, store `hubId`, use it in every test, delete in `afterAll`.

**Naming**: Include a timestamp or random suffix to avoid name collisions:
`test-volunteers-${Date.now()}`.

## TDD Integration

This skill pairs with `test-driven-development` (superpowers). The workflow:

1. **test-writer** (this skill): Choose the right suite, write the test using project patterns
2. **test-driven-development**: Red-green-refactor — watch it fail, implement, watch it pass
3. **test-runner**: Execute the test, verify results, check for orphans

Invoke all three during feature work. The test-writer tells you *what to write*, TDD tells
you *when to write it*, and test-runner tells you *how to run it*.

## Keeping Test Config in Sync

When you add new env vars, change test secrets, or modify service dependencies, multiple
config files must be updated together. A mismatch between local and CI config is a common
source of "works on my machine" failures.

### Files That Must Stay in Sync

| File | Purpose | What Lives Here |
|------|---------|----------------|
| `tests/helpers/index.ts` | Test constants | `ADMIN_NSEC`, `TEST_PIN`, `TEST_JWT_SECRET` |
| `.env.local.example` | Local dev template | `DATABASE_URL`, `HMAC_SECRET`, ports |
| `deploy/docker/.env.dev.defaults` | Docker dev defaults | ARI passwords, bridge secrets, Authentik |
| `.github/workflows/ci.yml` | CI env vars | `TEST_*` env block + per-job env sections |
| `playwright.config.ts` | Playwright config | `webServer` command, env passthrough |
| `docker-compose.dev.yml` | Docker dev overrides | Port offsets, host bindings |

### When Adding a New Env Var

If you add a new env var that the server reads (e.g., a new encryption key or service URL):

1. **Server code**: Read from `process.env` with a sensible default for dev
2. **`.env.local.example`**: Add with a comment and example value
3. **`deploy/docker/.env.dev.defaults`**: Add the dev default
4. **`ci.yml` global env block**: Add as `TEST_<VAR_NAME>` with a safe test value
5. **`ci.yml` per-job env sections**: Pass it to the jobs that need it — at minimum:
   - `unit-tests` (if the var affects any unit-testable code path)
   - `api-tests` (env block under the Playwright step)
   - `e2e-tests` (env block under the Playwright step)
6. **`tests/helpers/index.ts`**: If tests need to reference the value directly, add a constant
7. **Docker compose**: If it's needed by a Docker service, add to the service's environment

### When Changing a Test Secret

Test secrets (JWT_SECRET, HMAC_SECRET, ADMIN_NSEC) appear in multiple places. If you change one:

1. Update `tests/helpers/index.ts` (the source of truth for test code)
2. Update `ci.yml` `TEST_*` env block (the source of truth for CI)
3. Verify `.env.local.example` still matches
4. If the secret is derived (e.g., `ADMIN_PUBKEY` from `ADMIN_NSEC`), regenerate the derived value

### When Adding a New Docker Service

1. Add service to `docker-compose.yml` (with healthcheck)
2. Add dev port offset to `docker-compose.dev.yml`
3. Add to `bun run dev:docker` command in `package.json` (service name in the `up` list)
4. If tests need it, add healthcheck wait to test-runner pre-flight
5. Update CI workflow if CI needs the service (add to `services:` block)

### Quick Check: Are Configs in Sync?

Compare the env vars across configs:

```bash
# CI env vars
grep -E '^\s+TEST_' .github/workflows/ci.yml | sort

# Local example
grep -E '^[A-Z_]+=' .env.local.example | sort

# Docker defaults
grep -E '^[A-Z_]+=' deploy/docker/.env.dev.defaults | sort

# Test helpers constants
grep -E 'const.*SECRET|const.*NSEC|const.*KEY' tests/helpers/index.ts
```

If a var exists in CI but not locally (or vice versa), something's out of sync.

## Anti-Patterns to Avoid

| Anti-Pattern | Why It's Wrong | Do This Instead |
|-------------|---------------|-----------------|
| `test.skip()` to "fix" a failing test | Hides bugs | Fix the root cause |
| Mocking the database in integration tests | Defeats the purpose of the suite | Use real DB with hub scoping |
| `getByText('Submit')` in UI tests | Breaks on i18n/rewording | `getByTestId(TestIds.SUBMIT_BTN)` |
| `waitForTimeout(2000)` | Flaky, slow | `waitForSelector`, `expect().toBeVisible()`, or `waitForApiAndUi()` |
| Testing internal state/props | Couples test to implementation | Test observable behavior (HTTP response, visible UI) |
| Shared mutable state across files | Breaks parallel execution | Hub-scoped isolation per file |
| Unit tests that need Docker | Wrong suite | Move to `*.integration.test.ts` |
| Giant test files (>500 lines) | Hard to maintain, slow per-file | Split by feature area |
| `expect(res.status()).toBe(200)` alone | Doesn't verify the response body | Also check the response payload |
| Weakening app validation to pass tests | Creates false security | Fix the test approach instead |
