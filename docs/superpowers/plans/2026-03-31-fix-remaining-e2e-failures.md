# Fix Remaining E2E Test Failures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get from 284 passing to 418+ passing E2E tests by fixing 134 failures across 6 categories.

**Architecture:** Failures fall into 6 independent categories — each task fixes one category. Tasks are ordered by impact (most tests fixed first) and can be executed in parallel since they touch different files.

**Tech Stack:** Playwright, React Query, hub-key decryption, authed-request helpers

**Current state:** 284 pass, 134 fail, 61 skip. Auth infrastructure (Epic 80) is complete. All failures are test-specific, not auth infra.

---

## Failure Categories (134 total)

| Category | Tests | Root Cause |
|----------|-------|-----------|
| A: Setup wizard reset | 34 | `setupCompleted=true` after global setup blocks wizard |
| B: API 401 auth | 30 | Tests use `ADMIN_NSEC` but admin pubkey changed |
| C: Page reload PIN | 6 | Tests reload page, need PIN re-entry |
| D: Encrypted names | 27 | Hub-key names not decrypted in queryFns |
| E: page.evaluate 401 | 4 | In-browser API calls lack JWT |
| F: UI/selector changes | 33 | Selectors outdated from phase2b/c/d changes |

---

### Task 1: Fix Setup Wizard Tests (34 tests)

**Problem:** Global setup completes the wizard, setting `setupCompleted: true`. Setup wizard tests navigate to `/setup` but the app redirects to dashboard because setup is already done.

**Fix:** These tests need to reset `setupCompleted` before running. Add a `beforeAll` that calls `POST /api/test-reset-no-admin` followed by a fresh bootstrap, OR add a lighter reset that just clears `setupCompleted`.

**Files:**
- Modify: `tests/ui/setup-wizard.spec.ts`
- Modify: `tests/ui/setup-wizard-provider.spec.ts`
- Modify: `tests/ui/demo-mode.spec.ts`
- Modify: `tests/ui/conversations.spec.ts`

- [ ] **Step 1: Read each file to understand its setup pattern**

Read the first 30 lines of each file to see how they navigate to `/setup`. Most call `navigateAfterLogin(adminPage, '/setup')` or `adminPage.goto('/setup')`.

- [ ] **Step 2: Add `setupCompleted: false` reset via API**

The existing `POST /api/settings` endpoint (or a new lightweight test helper) can reset `setupCompleted`. Check the settings API:

```bash
grep -n "setupCompleted\|updateSetupState" src/server/routes/settings.ts src/server/services/settings.ts | head -10
```

If there's an API to update setup state, use it. If not, add a test-only endpoint in `dev.ts`:

```typescript
// In src/server/routes/dev.ts — add after existing endpoints:
dev.post('/test-reset-setup', async (c) => {
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
    return c.json({ error: 'Not Found' }, 404)
  }
  const secret = c.env.DEV_RESET_SECRET || c.env.E2E_TEST_SECRET
  if (!secret) return c.json({ error: 'Not Found' }, 404)
  if (c.req.header('X-Test-Secret') !== secret) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const services = c.get('services')
  await services.settings.updateSetupState({ setupCompleted: false })
  return c.json({ ok: true })
})
```

- [ ] **Step 3: Update `setup-wizard.spec.ts`**

Add a `beforeAll` block that resets setup state:

```typescript
test.beforeAll(async ({ request }) => {
  await request.post('/api/test-reset-setup', {
    headers: { 'X-Test-Secret': process.env.DEV_RESET_SECRET || 'test-reset-secret' },
  })
})
```

Then update each test to navigate to `/setup` via the admin fixture. The wizard should now show because `setupCompleted: false`.

- [ ] **Step 4: Update `setup-wizard-provider.spec.ts`**

Same pattern — add `beforeAll` with setup reset.

- [ ] **Step 5: Update `demo-mode.spec.ts`**

Same pattern. Demo mode tests need the wizard to create demo mode settings.

- [ ] **Step 6: Update `conversations.spec.ts`**

Check if the single failure here is also setup-related. The test tries to fill `#hotline-name` which is a setup wizard field.

- [ ] **Step 7: Verify**

```bash
bunx playwright test --project=setup --project=ui tests/ui/setup-wizard.spec.ts tests/ui/setup-wizard-provider.spec.ts tests/ui/demo-mode.spec.ts tests/ui/conversations.spec.ts --reporter=list
```

Expected: All 34 previously-failing tests now pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/routes/dev.ts tests/ui/setup-wizard.spec.ts tests/ui/setup-wizard-provider.spec.ts tests/ui/demo-mode.spec.ts tests/ui/conversations.spec.ts
git commit -m "fix: setup wizard tests reset setupCompleted before running"
```

---

### Task 2: Fix API Auth 401 Tests (30 tests)

**Problem:** Tests use `ADMIN_NSEC` with `createAuthedRequestFromNsec()` to make API calls. This creates a JWT signed with the hardcoded admin's pubkey. But after the real bootstrap, the admin has a DIFFERENT pubkey (generated in-browser). The JWT's pubkey doesn't match any user in the DB → 401.

**Fix:** The `ADMIN_NSEC` constant is no longer valid. These tests need to use the real admin's credentials from the global setup. Two approaches:

Option A: Write the admin's nsec to a shared file during global setup and read it in API tests.
Option B: Use the admin's refresh cookie to get a JWT, then use that for API calls.

Option A is simpler. The global setup can write `tests/storage/context.json` with the admin pubkey. Then `createAuthedRequestFromNsec` can read from it.

Actually, the simplest fix: these API tests should use the `authed-request.ts` helper with a JWT derived from the admin pubkey stored during bootstrap. The global setup already saves the admin's storage state. We can extract the pubkey from the encrypted key blob.

**BUT** — the better approach: the global setup should write a context file with pubkeys. Then API tests import from it.

**Files:**
- Modify: `tests/global-setup.ts` — write context.json with admin pubkey
- Modify: `tests/helpers/index.ts` — add `getTestAdminPubkey()` helper
- Modify: `tests/ui/provider-oauth.spec.ts`
- Modify: `tests/ui/signal-auto-registration.spec.ts`
- Modify: `tests/ui/file-field.spec.ts`
- Modify: `tests/ui/webauthn-passkeys.spec.ts`
- Modify: `tests/ui/voice-captcha.spec.ts`

- [ ] **Step 1: Update global setup to write context.json**

After bootstrap completes, extract the admin pubkey and write it:

```typescript
// In global-setup.ts, after saving admin storage state:
const adminPubkey = await page.evaluate(async () => {
  const km = window.__TEST_KEY_MANAGER
  return km ? await km.getPublicKeyHex() : null
})
const fs = await import('fs/promises')
await fs.writeFile(`${STORAGE_DIR}/context.json`, JSON.stringify({
  adminPubkey,
  hubId: 'default-hub', // or extract from /api/config
}, null, 2))
```

- [ ] **Step 2: Add helper to read context**

In `tests/helpers/index.ts`:

```typescript
import { readFileSync } from 'fs'

let _testContext: { adminPubkey: string; hubId: string } | null = null

export function getTestContext(): { adminPubkey: string; hubId: string } {
  if (!_testContext) {
    const raw = readFileSync('tests/storage/context.json', 'utf-8')
    _testContext = JSON.parse(raw)
  }
  return _testContext!
}
```

- [ ] **Step 3: Update provider-oauth.spec.ts (18 tests)**

Replace `ADMIN_NSEC` usage with authed request from context:

```typescript
// Before:
import { ADMIN_NSEC } from '../helpers'
const authedReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)

// After:
import { getTestContext } from '../helpers'
import { createAuthedRequest } from '../helpers/authed-request'
// Use the admin pubkey from global setup to create a JWT
```

Actually — these tests need a secret key, not just a pubkey. The `createAuthedRequest` takes a secret key to sign the JWT. Since we don't have the admin's nsec in the test process (it's in the browser), we need a different approach.

The simplest fix: these API tests should create their OWN test user via the API (using `TestContext` from `api-helpers.ts`) rather than relying on `ADMIN_NSEC`. The `TestContext` creates users with known keypairs.

Read each file to determine if it needs the admin specifically or just any authenticated user with admin permissions.

- [ ] **Step 4: For each file, update to use TestContext or authed-request with a generated key**

```typescript
// Pattern for API-only tests:
import { TestContext } from '../../api-helpers'

let ctx: TestContext
test.beforeAll(async ({ request }) => {
  ctx = await TestContext.create(request, { roles: ['super-admin'] })
})
test.afterAll(async () => { await ctx.cleanup() })

test('some API test', async ({ request }) => {
  ctx.refreshApis(request)
  const res = await ctx.adminApi.get('/settings/provider/oauth/start?provider=twilio')
  expect(res.status()).toBe(200)
})
```

- [ ] **Step 5: Update each file**

Apply the TestContext pattern to:
1. `provider-oauth.spec.ts` (18 tests)
2. `signal-auto-registration.spec.ts` (7 tests)
3. `file-field.spec.ts` (3 tests)
4. `webauthn-passkeys.spec.ts` (1 test)
5. `voice-captcha.spec.ts` (1 test)

- [ ] **Step 6: Verify**

```bash
bunx playwright test --project=setup --project=ui tests/ui/provider-oauth.spec.ts tests/ui/signal-auto-registration.spec.ts tests/ui/file-field.spec.ts tests/ui/webauthn-passkeys.spec.ts tests/ui/voice-captcha.spec.ts --reporter=list
```

- [ ] **Step 7: Commit**

```bash
git add tests/
git commit -m "fix: API-only E2E tests use TestContext instead of hardcoded ADMIN_NSEC"
```

---

### Task 3: Fix Page Reload PIN Re-entry (6 tests)

**Problem:** Tests that call `adminPage.reload()` or `adminPage.goto('/login')` clear the in-memory keyManager. The next action expects authenticated state but the page shows the PIN screen.

**Fix:** After any `page.reload()`, call `reenterPinAfterReload(adminPage)` from the helpers.

**Files:**
- Modify: `tests/ui/theme.spec.ts`
- Modify: `tests/ui/telephony-provider.spec.ts`
- Modify: `tests/ui/webrtc-settings.spec.ts`
- Modify: `tests/ui/notification-pwa.spec.ts`
- Modify: `tests/ui/profile-settings.spec.ts`

- [ ] **Step 1: Read each file and find the reload/navigation that breaks auth**

Search for `adminPage.reload()`, `adminPage.goto('/login')`, or `page.reload()`.

- [ ] **Step 2: Add `reenterPinAfterReload()` after each reload**

```typescript
// After any page.reload():
await adminPage.reload()
await reenterPinAfterReload(adminPage)
```

The `reenterPinAfterReload` helper already handles PIN entry and session-expired modals.

- [ ] **Step 3: Verify**

```bash
bunx playwright test --project=setup --project=ui tests/ui/theme.spec.ts tests/ui/telephony-provider.spec.ts tests/ui/webrtc-settings.spec.ts tests/ui/notification-pwa.spec.ts tests/ui/profile-settings.spec.ts --reporter=list
```

- [ ] **Step 4: Commit**

```bash
git add tests/ui/
git commit -m "fix: add PIN re-entry after page reload in E2E tests"
```

---

### Task 4: Fix Hub-Key Encrypted Names (27 tests)

**Problem:** Several queryFns return raw `name: ''` from the server (Phase 2B moved names to `encryptedName`). The roles queryFn was already fixed to decrypt in the queryFn. The same pattern needs to be applied to shifts, bans, custom fields, and notes.

**Fix:** Update each React Query queryFn to call `decryptHubField(item.encryptedName, hubId, item.name)` and populate the `name` field with the decrypted value. This follows the pattern established in `src/client/lib/queries/roles.ts`.

**Files:**
- Modify: `src/client/lib/queries/shifts.ts` — decrypt shift names
- Modify: `src/client/lib/queries/custom-fields.ts` — decrypt field labels
- Check: `src/client/lib/queries/notes.ts` — notes may use envelope encryption (not hub-key)
- Check: bans — ban phone numbers are PII, not hub-key encrypted

- [ ] **Step 1: Identify which queries need hub-key decryption**

```bash
grep -rn "encryptedName\|encryptedLabel\|encryptedDescription" src/client/lib/queries/ | head -20
```

Check each query file: does its queryFn decrypt `encryptedName` → `name`?

- [ ] **Step 2: Update shifts queryFn**

In `src/client/lib/queries/shifts.ts`, add `decryptHubField` to the queryFn:

```typescript
import { decryptHubField } from '@/lib/hub-field-crypto'

export const shiftsListOptions = (hubId = 'global') =>
  queryOptions({
    queryKey: queryKeys.shifts.list(),
    queryFn: async () => {
      const { shifts } = await listShifts()
      return shifts.map((s) => ({
        ...s,
        name: decryptHubField(s.encryptedName, hubId, s.name),
      }))
    },
    staleTime: 60 * 1000,
  })
```

Update `useShifts()` to accept `hubId` parameter.

- [ ] **Step 3: Update custom-fields queryFn**

Same pattern for custom field labels/names.

- [ ] **Step 4: Check notes, bans, and other failing entities**

Notes use envelope encryption (per-note key, not hub-key). Their `name` field is likely the note content, decrypted via the crypto worker. Check if the notes queryFn already decrypts.

Bans show phone numbers — these are PII (envelope-encrypted), not hub-key. The ban tests fail because `getByText('+15559314108')` doesn't match the encrypted/masked phone. Check if the ban queryFn decrypts phones.

- [ ] **Step 5: Update callers to pass hubId**

Files using `useShifts()`, `useCustomFields()`, etc. need to pass `hubId` from `useConfig()`.

- [ ] **Step 6: Verify**

```bash
bun run typecheck && bun run build
bunx playwright test --project=setup --project=ui tests/ui/admin-flow.spec.ts tests/ui/ban-management.spec.ts tests/ui/shift-management.spec.ts tests/ui/notes-crud.spec.ts tests/ui/notes-custom-fields.spec.ts --reporter=list
```

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/queries/ src/client/routes/
git commit -m "fix: decrypt hub-key names in shift/custom-field queryFns"
```

---

### Task 5: Fix page.evaluate API 401s (4 tests)

**Problem:** Tests use `page.evaluate()` to make API calls directly from the browser (e.g., `fetch('/api/...')` inside evaluate). These calls don't include the auth token because the evaluate runs in the browser's JS context where the auth facade client may not have a valid JWT.

**Fix:** Either:
1. Use the Playwright `request` fixture for API calls (preferred — no browser needed)
2. Or ensure the auth facade has a valid JWT before the evaluate

**Files:**
- Modify: `tests/ui/call-detail.spec.ts`
- Modify: `tests/ui/call-spam.spec.ts`
- Modify: `tests/ui/call-flow.spec.ts`

- [ ] **Step 1: Read each file and find the page.evaluate API calls**

Look for patterns like `page.evaluate(async () => { await fetch('/api/...') })`.

- [ ] **Step 2: Replace with Playwright request fixture**

```typescript
// Before:
await adminPage.evaluate(async () => {
  const res = await fetch('/api/bans', { method: 'POST', ... })
})

// After:
await request.post('/api/bans', {
  data: { phone, reason },
  headers: { Authorization: `Bearer ${jwt}` },
})
```

Or better: use the `authed-request` helper with the admin's JWT from the auth facade.

Actually, the simplest approach: inject the JWT into the evaluate context so the browser fetch includes it. The auth facade should already have it after PIN unlock.

Check if `window.__TEST_AUTH_FACADE.getAccessToken()` returns a valid token during the test.

- [ ] **Step 3: Verify**

```bash
bunx playwright test --project=setup --project=ui tests/ui/call-detail.spec.ts tests/ui/call-spam.spec.ts tests/ui/call-flow.spec.ts --reporter=list
```

- [ ] **Step 4: Commit**

```bash
git add tests/ui/
git commit -m "fix: API calls in page.evaluate use auth facade JWT"
```

---

### Task 6: Fix UI/Selector Changes (33 tests)

**Problem:** Phase 2B/C/D changed UI structure, field names, and component layouts. Test selectors no longer match. This is the most heterogeneous category — each file has different issues.

**Files:** Multiple — see list below.

This task is best split into sub-tasks per file. Each file needs individual reading and selector fixing.

- [ ] **Step 1: Fix `reports.spec.ts` (13 failures)**

Errors show `not.toBeVisible` failing for `getByPlaceholder('Brief descrip...')` — a placeholder input that should be hidden but is visible. The reports UI likely changed layout. Read the file, compare with the current reports component, and update selectors.

- [ ] **Step 2: Fix `i18n.spec.ts` (6 failures)**

5 failures are "Raw i18n key found on page: nav.users" — a translation key `nav.users` isn't translated. This means the `users` nav item was renamed or the translation key changed. Check `src/client/locales/en.json` for the correct key.

1 failure is `getByRole('heading', { name: /sign in/ })` not visible on login page — check the login page heading text.

- [ ] **Step 3: Fix `user-flow.spec.ts` (7 failures)**

All tests fail — this file tests volunteer navigation. Read the file, check if it correctly uses `volunteerPage` fixture, and fix selectors.

- [ ] **Step 4: Fix `form-validation.spec.ts` (3 failures)**

`getByRole('button', ...)` click timeouts — button text or role may have changed. Read the file, check the current add-user form, fix selectors.

- [ ] **Step 5: Fix `webauthn.spec.ts` (3 failures)**

`getByTestId('passkey-credential-row')` not visible — passkey list may render differently. Check the webauthn settings component.

- [ ] **Step 6: Fix remaining files (1-3 failures each)**

For each file with 1-3 failures:
- `auth-guards.spec.ts` (2f) — URL assertion after reload
- `blasts.spec.ts` (3f) — volunteer access + delete
- `contacts.spec.ts` (1f) — dialog close
- `gdpr.spec.ts` (2f) — consent UI
- `hub-access-control.spec.ts` (1f) — undefined property
- `blast-sending.spec.ts` (1f) — API timeout
- `epic-24-27.spec.ts` (3f) — various
- `multi-hub.spec.ts` (1f) — archive assertion
- `nostr-relay.spec.ts` (1f) — REST polling
- `help.spec.ts` (1f) — guide text
- `report-types.spec.ts` (2f) — selector
- `roles.spec.ts` (2f) — encrypted role names in selector
- `dashboard-analytics.spec.ts` (1f) — volunteer visibility

Read each, fix the specific selector or assertion, verify individually.

- [ ] **Step 7: Verify all**

```bash
bun run build && bunx playwright test --project=setup --project=ui --reporter=json 2>/dev/null > /tmp/results.json && python3 -c "
import json
with open('/tmp/results.json') as f:
    d = json.load(f)
s = {}
def w(suites):
    for su in suites:
        for sp in su.get('specs', []):
            for t in sp.get('tests', []):
                st = t.get('status', '?')
                s[st] = s.get(st, 0) + 1
        w(su.get('suites', []))
w(d.get('suites', []))
print(s)
"
```

Target: 418+ passed.

- [ ] **Step 8: Commit**

```bash
git add tests/ui/
git commit -m "fix: update E2E test selectors for phase2b/c/d UI changes"
```

---

## Execution Notes

**Task independence:** Tasks 1-5 are independent and can be executed in parallel. Task 6 depends on Tasks 4 (encrypted names) being done first, since some selector fixes overlap with decryption fixes.

**Priority order by impact:**
1. Task 1 (34 tests) — setup wizard reset
2. Task 2 (30 tests) — API auth 401
3. Task 4 (27 tests) — encrypted names queryFn
4. Task 6 (33 tests) — UI selectors
5. Task 3 (6 tests) — page reload PIN
6. Task 5 (4 tests) — evaluate 401

**Verification after all tasks:**
```bash
bun run typecheck && bun run build && bunx playwright test --project=setup --project=ui --reporter=list
```

Target: 418+ passed, 0 failed (excluding intentional skips).
