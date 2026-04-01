# Epic 80: Realistic E2E Test Authentication

## Problem

The current E2E test infrastructure uses synthetic key injection (`preloadEncryptedKey`) to create admin sessions:

1. Generates a hardcoded nsec hex and encrypts it with a synthetic IdP value in the browser
2. Signs a JWT server-side with the test secret and injects it via `sessionStorage`
3. Reloads the page and enters a PIN to unlock

This is fundamentally broken after Phase 2B (hub-key E2EE for org metadata). The synthetic approach:

- **Never provisions hub keys** — hub keys are distributed via ECIES wrapping during real bootstrap/onboarding. The synthetic flow skips this, so the browser can't decrypt role names, hub names, custom field labels, or any org metadata.
- **Bypasses all real auth flows** — real users never inject keys via `page.evaluate`. The bootstrap, onboarding, invite redemption, and key provisioning flows are untested.
- **Couples tests to crypto internals** — synthetic IdP values, `key-store-v2` blob format, `__TEST_KEY_MANAGER` globals. Any change to key management breaks hundreds of tests.
- **Permission blindness** — all tests run as super-admin with `permissions: ['*']`. No coverage of what volunteer, hub-admin, reviewer, or reporter roles actually see and can do.

### Scale of Impact

~479 UI E2E tests across ~60 test files. 56 files call `loginAsAdmin`, 9 also use `loginAsUser`. Nearly the entire UI test suite is affected.

## Solution

Replace synthetic key injection with real user flows. Every test account is created through the same paths real users take. No mocking of auth flows — the only acceptable shortcuts are for things that are genuinely impossible to test naturally (none identified for this scope).

### Global Setup: Real Bootstrap + Real Invites

`tests/global-setup.ts` becomes a Playwright test suite that provisions 5 role accounts via real browser flows:

**Step 1 — Admin Bootstrap:**
1. Call `test-reset-no-admin` (fresh DB)
2. Open browser, navigate to `/setup`
3. Run real bootstrap: create PIN → generate keypair → download recovery key → continue to setup
4. Complete identity step of setup wizard (hotline name + org — minimum for functional hub)
5. Save storage state to `tests/storage/admin.json`

**Step 2 — Role Account Creation (×4):**
For each of hub-admin, volunteer, reviewer, reporter:
1. Admin (already authenticated) navigates to `/users`
2. Creates invite: name, phone, selects role
3. Reads invite link from the UI (`TestIds.USER_INVITE_LINK` or similar)
4. Opens a **new browser context** (clean, no storage state)
5. Navigates to invite link → onboarding page
6. Completes onboarding: create PIN → generate keypair → save recovery key → continue
7. Saves storage state to `tests/storage/<role>.json`
8. Closes onboarding context, returns to admin context

**Roles provisioned:**

| Role | Storage File | Created Via |
|------|-------------|-------------|
| Super Admin | `admin.json` | Bootstrap flow |
| Hub Admin | `hub-admin.json` | Invite with `role-hub-admin` |
| Volunteer | `volunteer.json` | Invite with `role-volunteer` |
| Reviewer | `reviewer.json` | Invite with `role-reviewer` |
| Reporter | `reporter.json` | Invite with `role-reporter` |

**Time budget:** ~2-3 min total (PBKDF2 600K × 5 accounts). Runs once per `bunx playwright test` invocation. All 479 tests reuse cached storage state files.

### Auth Fixtures: Per-Role Authenticated Pages

`tests/fixtures/auth.ts` provides worker-scoped Playwright fixtures:

```
adminPage     — loads admin.json, enters PIN once per worker
hubAdminPage  — loads hub-admin.json, enters PIN once per worker
volunteerPage — loads volunteer.json, enters PIN once per worker
reviewerPage  — loads reviewer.json, enters PIN once per worker
reporterPage  — loads reporter.json, enters PIN once per worker
```

Each fixture:
1. Creates a browser context with the role's `storageState`
2. Navigates to `/` (triggers PIN screen — in-memory keyManager cleared on fresh page)
3. Enters PIN via `enterPin()` (~1s)
4. Waits for authenticated state (Dashboard visible)
5. Returns the authenticated page

**Worker-scoped** means the PIN entry happens once per test file, not per test. Tests within a file share the authenticated page and run serially. A file with 10 tests pays 1 PIN entry, not 10.

### Test File Updates

Every UI test file is updated — no incremental migration:

**Pattern replacement:**
```typescript
// Before:
test('does something', async ({ page }) => {
  await loginAsAdmin(page)
  await navigateAfterLogin(page, '/settings')
  // ...
})

// After:
test('does something', async ({ adminPage }) => {
  await navigateAfterLogin(adminPage, '/settings')
  // ...
})
```

**Multi-role files** (e.g., `roles.spec.ts` testing admin + reporter views) use multiple fixtures with separate `describe` blocks per role.

**Files that create users as test data** (e.g., `user-flow.spec.ts` testing the invite UI) still exercise invite creation — the test actor is authenticated via fixture, the created user is test data.

### Cleanup: Remove Synthetic Auth Infrastructure

Delete entirely:
- `preloadEncryptedKey()` function
- `ADMIN_NSEC` constant
- `loginAsAdmin()` function
- `loginAsUser()` function
- `loginWithNsec()` function (unless any test exercises recovery path explicitly)
- JWT signing in test helpers (`signAccessToken` imports)
- Hub key injection (`__TEST_HUB_KEY_CACHE.set('global', ...)`)

Keep:
- `enterPin()` — still needed for PIN entry after storage state load
- `navigateAfterLogin()` — still useful for SPA navigation
- `reenterPinAfterReload()` — needed when tests explicitly reload pages
- `completeProfileSetup()` — needed for new user first-login flows
- `TestIds`, page objects, `Timeouts` — unchanged
- `__TEST_ROUTER` global — still used for SPA navigation in `navigateAfterLogin`
- `__TEST_KEY_MANAGER` global in `main.tsx` — `bootstrap.spec.ts` may reference it
- `authed-request.ts` — API-only tests unchanged (no browser needed)

### Playwright Config Changes

- `setup` project timeout increased (~3 min for 5× PBKDF2)
- `tests/storage/` directory gitignored
- Role fixtures imported from `tests/fixtures/auth.ts`
- `bootstrap.spec.ts` stays in its own project (runs after `ui`, deliberately resets admin)

### Test Data Isolation & Reset Endpoints

- Global setup calls `test-reset-no-admin` (not `test-reset`) — the admin is bootstrapped in-browser with a random keypair, not from `ADMIN_PUBKEY` env var
- Individual test files that need clean records use `test-reset-records` (light reset: clears records, calls, conversations, shifts — preserves accounts + settings)
- **No test file should call `test-reset`** (the full reset with admin re-bootstrap) — this would create a different admin than the one in cached storage state, breaking auth for all subsequent tests
- `bootstrap.spec.ts` is the exception — it calls `test-reset-no-admin` and runs in its own project after the `ui` project, so it doesn't affect other tests
- Hub isolation via `TestContext` patterns unchanged for API tests

## Device Linking (Phase 4 — Deferred)

Device linking can be tested naturally with two browser contexts + the strfry relay (runs in Docker test env). Not blocking for this scope — it's a same-identity-different-device concern, separate from multi-role account provisioning.

## Files

### New
- `tests/fixtures/auth.ts` — Per-role Playwright fixtures (worker-scoped)
- `tests/storage/` — Gitignored directory for cached storage state files
- `tests/ui/permission-matrix.spec.ts` — Role-based access control verification

### Modified
- `tests/global-setup.ts` — Real bootstrap + invite flows for all 5 roles
- `tests/helpers/index.ts` — Remove synthetic auth, keep PIN/navigation helpers
- `playwright.config.ts` — Setup timeout, storage state paths
- `tests/ui/*.spec.ts` — All ~60 files updated to use role fixtures
- `.gitignore` — Add `tests/storage/`

## Non-Goals

- Replacing API-only tests (no browser needed, JWT signing is fine)
- Incremental migration or backwards compatibility shims
- Device linking (deferred, separate scope)
- Production-parity deployment (pre-production)
