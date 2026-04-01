# Epic 80: Realistic E2E Test Authentication

## Problem

The current E2E test infrastructure uses synthetic key injection (`preloadEncryptedKey`) to create admin sessions:
1. Generates a hardcoded nsec hex and encrypts it with a synthetic IdP value in the browser
2. Signs a JWT server-side with the test secret and injects it via `sessionStorage`
3. Reloads the page and enters a PIN to unlock

This creates several problems:
- **Unrealistic**: Real users never inject keys via `page.evaluate`. The test bypasses the actual bootstrap, onboarding, and device-linking flows.
- **Fragile**: Tightly coupled to internal crypto implementation details (synthetic IdP values, `key-store-v2` blob format, `__TEST_KEY_MANAGER` globals). Any change to key management breaks tests.
- **Incomplete coverage**: The actual admin bootstrap, invite creation, invite redemption, and onboarding flows are only tested in one isolated test file (`bootstrap.spec.ts`). Most tests skip these entirely.
- **Permission blindness**: All tests run as super-admin with `permissions: ['*']`. We never test what a volunteer, hub-admin, or reporter actually sees and can do.

## Solution

Replace synthetic key injection with the real user flows the app provides. Build test accounts through the same paths real users take.

### Phase 1: Admin via Real Bootstrap

Replace `loginAsAdmin()` with a flow that:
1. Calls `test-reset-no-admin` to get a fresh state
2. Navigates to `/setup` (bootstrap auto-redirects)
3. Clicks "Get Started", creates a PIN, downloads backup
4. Clicks "Continue to Setup" — admin is now bootstrapped
5. Completes the setup wizard (identity, channels, etc.)
6. Caches the generated nsec + PIN in a Playwright storage state file

Subsequent tests reuse the cached storage state (localStorage + sessionStorage) so the bootstrap only runs once per test suite.

**Key constraint**: The admin's nsec is generated in-browser by `crypto.getRandomValues` — it's not hardcoded. Tests must extract and cache it from the browser context after bootstrap.

**PIN re-entry**: After page reloads, tests re-enter the cached PIN. The `enterPin` helper already handles this correctly with the 8-box PinInput + Enter for 6-digit PINs.

### Phase 2: Volunteers via Invite Flow

After admin bootstrap, create volunteer accounts through the real invite flow:

1. Admin navigates to `/volunteers` and creates an invite (name, phone, role)
2. The invite generates a code (visible in the UI or extractable from the API response)
3. A separate browser context (or the same one after logout) navigates to `/onboarding?code=<code>`
4. The volunteer onboarding flow runs: validate invite → create PIN → generate keypair → backup → done
5. The volunteer's credentials (nsec + PIN) are cached in a separate storage state file

**Channel delivery interception**: When the admin sends an invite via Signal/SMS/WhatsApp, the server calls the messaging adapter. In test mode (`USE_TEST_ADAPTER=true`), the adapter could be extended to capture the invite URL instead of actually sending it. A test API endpoint (`GET /api/test-invites`) could return the most recently generated invite URLs, allowing tests to extract the onboarding link without actually receiving an SMS.

### Phase 3: Permission Matrix

Create test accounts across all default roles:

| Role | Created Via | Test Coverage |
|------|-------------|---------------|
| Super Admin | Bootstrap flow | Full system access, setup wizard, all admin panels |
| Hub Admin | Invite with `role-hub-admin` | Hub-scoped admin (volunteers, shifts, settings) |
| Volunteer | Invite with `role-volunteer` | Call answering, note creation, conversation claiming |
| Reviewer | Invite with `role-reviewer` | Voicemail review, note read-all |
| Reporter | Invite with `role-reporter` | Report submission, own-report tracking |

**Global setup** creates all 5 accounts in a dedicated `setup` project that runs before all other test projects. Each role's credentials are saved to a storage state file.

**Test spec structure**:
```
tests/
  fixtures/
    auth.ts              # Playwright fixture providing per-role pages
  storage/
    admin.json           # Cached admin storage state
    hub-admin.json       # Cached hub-admin storage state
    volunteer.json       # Cached volunteer storage state
    reviewer.json        # Cached reviewer storage state
    reporter.json        # Cached reporter storage state
  global-setup.ts        # Bootstrap admin + create all role accounts
  ui/
    permission-matrix.spec.ts  # Verify each role sees/can do the right things
```

**Permission matrix test** — for each role, verify:
- Which nav links are visible (sidebar)
- Which pages render vs show "Access denied"
- Which actions succeed (create note, manage volunteers, etc.)
- Which actions are blocked (API returns 403)

### Phase 4: Device Linking (Future)

Device linking requires two browser contexts with a QR code / pairing flow:
1. Admin has an active session in Context A
2. Context B navigates to `/link-device`
3. Context A approves the link request
4. Context B receives the nsec via an ephemeral ECDH provisioning room

This is complex but could be tested if:
- The Nostr relay is running (it is in the Docker test env)
- Both contexts can communicate via the relay
- The pairing protocol is exercised end-to-end

**Not blocking for this epic** — the invite flow covers multi-account creation. Device linking is a separate concern (same identity, different device) that can be a follow-up.

## Implementation Notes

### Caching Strategy

Running the full bootstrap + onboarding for every test file would be too slow (PBKDF2 600K iterations per account). Instead:

1. `global-setup.ts` creates all accounts once and saves storage state files
2. Each test file loads the appropriate storage state via `test.use({ storageState: '...' })`
3. Tests that modify state (e.g., change settings) should call a lighter reset endpoint that preserves accounts

### Test Adapter Extension

Add a `GET /api/test-invites` endpoint (dev-only) that returns invite links generated by the `InviteDeliveryService`. This avoids needing actual Signal/SMS delivery:

```typescript
// In dev routes
dev.get('/test-invites', async (c) => {
  return c.json({ invites: testInviteCapture.getAll() })
})
```

The `TestMessagingAdapter` captures messages instead of sending them.

### Migration Path

1. Start by adding the new bootstrap-based `loginAsAdmin` alongside the existing one
2. Migrate tests incrementally — each test file can switch to the new fixture
3. Remove `preloadEncryptedKey`, `__TEST_KEY_MANAGER`, and the hardcoded `ADMIN_NSEC` once all tests are migrated
4. Keep the `authed-request.ts` helper for API-only tests (no browser needed)

## Files

### New
- `tests/fixtures/auth.ts` — Playwright fixtures for per-role authenticated pages
- `tests/fixtures/accounts.ts` — Bootstrap + invite account creation logic
- `tests/ui/permission-matrix.spec.ts` — Role-based access control verification
- `src/server/routes/dev.ts` — Add `GET /api/test-invites` for invite interception

### Modified
- `tests/global-setup.ts` — Create all role accounts via real flows
- `tests/helpers/index.ts` — Refactor `loginAsAdmin` to use cached storage state
- `playwright.config.ts` — Configure storage state paths and setup dependencies

## Non-Goals

- Replacing API-only tests (these don't need browser auth and are faster with JWT injection)
- Testing every permission individually (the matrix covers visibility; API permission tests cover enforcement)
- Production-parity deployment (we're still in pre-production)
