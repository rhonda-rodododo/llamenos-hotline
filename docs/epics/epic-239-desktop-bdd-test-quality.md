# Epic 239: Desktop BDD Test Quality Pass

## Status: In Progress

## Problem

Desktop Playwright BDD tests pass 142/298 (47.7%). 151 failures fall into 6 systemic categories:

| Category | Count | Root Cause |
|----------|-------|------------|
| Invalid CSS selectors | 7 | `text=/regex/i` inside CSS locator strings |
| Missing test IDs | 52 | `getByText()`, `getByRole()` instead of `data-testid` |
| Click timeouts | 48 | Navigation not completing, elements missing |
| Missing nav links | 15 | RBAC sidebar incomplete for some roles |
| Auth/crypto timeouts | 18 | Login flows timing out or incomplete |
| Strict mode violations | 6 | Broad `getByRole(/create|add/i)` matching 2+ elements |

## Principles

1. **Test IDs everywhere** — every assertion/interaction uses `data-testid`, never `getByText` or `getByRole` for element selection
2. **Tests hit the real API** — Docker Compose backend, not mocks
3. **Per-worker isolation** — unique admin credentials per Playwright worker to prevent parallel overlap
4. **No fragile selectors** — CSS `text=` patterns, regex in locators, and `getByRole` broad matches are all replaced

## Phase 1: Fix Broken Selectors & Test ID Migration (Step Definitions)

### 1a. Fix CSS selector parsing errors

**File:** `tests/steps/admin/admin-steps.ts:70-76`

Current (broken):
```typescript
const content = page.locator(
  `[data-testid="${TestIds.VOLUNTEER_LIST}"], [data-testid="${TestIds.EMPTY_STATE}"], [data-testid="${TestIds.LOADING_SKELETON}"], text=/${tabContent}|no |add|empty/i`,
)
```

Fix — use Playwright's `.or()` API:
```typescript
const content = page.getByTestId(TestIds.VOLUNTEER_LIST)
  .or(page.getByTestId(TestIds.EMPTY_STATE))
  .or(page.getByTestId(TestIds.LOADING_SKELETON))
await expect(content.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
```

**Impact:** Fixes 7 admin-tabs and ban-management failures.

### 1b. Replace `getByText()` / `getByRole()` with test IDs in step definitions

Every step definition in `tests/steps/` that uses these fragile patterns must be migrated:

**Pattern 1 — `getByText(string)` for buttons/tabs:**
```typescript
// BEFORE (fragile)
await page.getByText(tabName, { exact: true }).first().click()

// AFTER (robust)
const testIdMap: Record<string, string> = {
  'Volunteers': 'nav-volunteers',
  'Bans': 'nav-bans',
  'Invites': 'nav-invites',
  'Audit': 'nav-audit',
  // ... etc
}
await page.getByTestId(testIdMap[tabName] ?? `nav-${tabName.toLowerCase()}`).click()
```

**Pattern 2 — `getByRole('link', { name })` for nav:**
```typescript
// BEFORE (fragile)
const link = page.getByRole('link', { name: tabName })
await expect(link).toBeVisible()

// AFTER (robust)
await expect(page.getByTestId(`nav-${tabName.toLowerCase()}`)).toBeVisible()
```

**Pattern 3 — `getByRole('button', { name: /regex/ })` matching multiple:**
```typescript
// BEFORE (strict mode violation)
await page.getByRole('button', { name: /create|add/i }).click()

// AFTER (unambiguous)
await page.getByTestId('role-create-btn').click()
```

**Files to modify:** All 37 step definition files in `tests/steps/`.

### 1c. Add missing test IDs to UI components

Cross-reference `tests/test-ids.ts` with what step definitions need. Add `data-testid` attributes for:

**Navigation:**
- `nav-volunteers`, `nav-bans`, `nav-invites`, `nav-audit`, `nav-roles`, `nav-reports`
- `nav-notes`, `nav-conversations`, `nav-shifts`, `nav-settings`, `nav-dashboard`
- `nav-calls`, `nav-contacts`, `nav-blasts`

**Admin:**
- `admin-section`, `admin-volunteers-tab`, `admin-bans-tab`, `admin-invites-tab`, `admin-audit-tab`
- `role-list`, `role-card`, `role-create-btn`, `role-name-input`, `role-permissions`
- `invite-list`, `invite-card`, `invite-create-btn`, `invite-code`, `invite-revoke-btn`

**Auth:**
- `login-nsec-input`, `login-hub-url-input`, `login-submit-btn`, `login-create-identity-btn`
- `login-error-message`, `login-import-btn`
- `pin-pad`, `pin-digit-{0-9}`, `pin-backspace`, `pin-title`, `pin-dots`
- `onboarding-nsec-display`, `onboarding-npub-display`, `onboarding-confirm-btn`

**Dashboard:**
- `dashboard-identity-card`, `dashboard-connection-card`, `dashboard-shift-card`
- `dashboard-calls-card`, `dashboard-help-card`, `dashboard-contacts-card`
- `dashboard-clock-in-btn`, `dashboard-break-toggle`

**Forms/Dialogs:**
- `volunteer-name-input`, `volunteer-phone-input`, `volunteer-save-btn`
- `ban-phone-input`, `ban-reason-input`, `ban-save-btn`
- `shift-name-input`, `shift-start-input`, `shift-end-input`, `shift-save-btn`
- `report-create-btn`, `report-title-input`, `report-body-input`
- `confirmation-dialog`, `confirmation-ok-btn`, `confirmation-cancel-btn`

**Settings:**
- `settings-identity-section`, `settings-hub-section`, `settings-security-section`
- `settings-lock-btn`, `settings-logout-btn`, `settings-version`
- `settings-transcription-toggle`, `settings-language-select`
- `settings-device-link-card`, `settings-admin-card`

**Messaging:**
- `blast-create-btn`, `blast-recipients-input`, `blast-message-input`, `blast-send-btn`
- `conversation-filter-active`, `conversation-filter-closed`, `conversation-filter-all`
- `conversation-assign-btn`, `conversation-close-btn`, `conversation-reopen-btn`

Add to `tests/test-ids.ts` and the corresponding React components.

## Phase 2: Per-Worker Credential Isolation

### Problem
All 3 Playwright workers share the same `ADMIN_NSEC`. While unique resource names prevent data collisions, shared sessions can cause:
- Race conditions when tests navigate to the same page simultaneously
- Storage conflicts (localStorage/sessionStorage shared in same browser context)
- Admin state mutations (settings changes) affecting other workers

### Solution: Worker-Indexed Admin Accounts

**Seed 3 admin accounts during global-setup:**

```typescript
// tests/global-setup.ts
import { test } from '@playwright/test'

const ADMIN_NSECS = [
  'nsec174zsa94n3e7t0ugfldh9tgkkzmaxhalr78uxt9phjq3mmn6d6xas5jdffh', // worker 0
  // Generate 2 more stable nsecs for workers 1 and 2
]

test('reset test state', async ({ request }) => {
  await request.post('/api/test-reset', { timeout: 30_000 })
  // Seed admin accounts for each worker
  for (const nsec of ADMIN_NSECS) {
    await request.post('/api/bootstrap', { data: { nsec } })
  }
})
```

**Select per-worker credentials in helpers.ts:**

```typescript
export function getWorkerCredentials(): { nsec: string; pin: string } {
  const workerIndex = parseInt(process.env.TEST_WORKER_INDEX ?? '0', 10)
  return {
    nsec: ADMIN_NSECS[workerIndex % ADMIN_NSECS.length],
    pin: TEST_PIN,
  }
}
```

**Update all login helpers to use worker credentials:**

```typescript
export async function loginAsAdmin(page: Page): Promise<void> {
  const { nsec, pin } = getWorkerCredentials()
  await preloadEncryptedKey(page, nsec, pin)
  // ... rest of login
}
```

### Alternative (simpler): BrowserContext isolation
Playwright already creates separate `BrowserContext` per test — so localStorage is already isolated. If the API doesn't have per-session state issues, this may not be needed. Verify by running tests with `workers: 1` first to confirm no concurrency bugs.

## Phase 3: Auth & Navigation Robustness

### 3a. Increase crypto timeout for BDD tests

The current 30s timeout is marginal for PIN encryption (PBKDF2 600K iterations in WASM). Increase:

```typescript
// playwright.config.ts — bdd project
{
  name: 'bdd',
  testDir: bddTestDir,
  timeout: 60_000, // 60s for crypto-heavy tests
  use: { ...devices['Desktop Chrome'] },
}
```

### 3b. Robust login step with retry

```typescript
Given('I am authenticated and on the dashboard', async ({ page }) => {
  await loginAsAdmin(page)
  await expect(page.getByTestId('dashboard-title')).toBeVisible({ timeout: 30_000 })
})
```

### 3c. SPA navigation helpers for step definitions

```typescript
When('I navigate to the {string} page', async ({ page }, pageName: string) => {
  const routes: Record<string, string> = {
    'dashboard': '/',
    'notes': '/notes',
    'conversations': '/conversations',
    'shifts': '/shifts',
    'settings': '/settings',
    'admin': '/admin/volunteers',
    'bans': '/admin/bans',
    'invites': '/admin/invites',
    'audit': '/admin/audit',
    'reports': '/reports',
    'calls': '/calls',
    'blasts': '/blasts',
  }
  const path = routes[pageName.toLowerCase()]
  if (path) {
    await navigateAfterLogin(page, path)
  }
})
```

## Phase 4: Demo Mode & Feature Data Seeding

### Problem
Many BDD tests expect demo mode data (shifts, bans, volunteers, reports) that doesn't exist.

### Solution: API-based test data seeding

Create a `tests/seed-helpers.ts` that seeds test data via API before each feature group:

```typescript
export async function seedDemoData(request: APIRequestContext) {
  // Create volunteers
  await createVolunteerViaApi(request, { name: 'Demo Volunteer 1', phone: uniquePhone() })
  await createVolunteerViaApi(request, { name: 'Demo Volunteer 2', phone: uniquePhone() })

  // Create shifts
  await createShiftViaApi(request, { name: 'Morning Shift' })
  await createShiftViaApi(request, { name: 'Evening Shift' })

  // Create bans
  await createBanViaApi(request, { phone: uniquePhone(), reason: 'Spam caller' })

  // Create reports (if API exists)
  // ...
}
```

Use in BDD `Before` hooks:
```typescript
Before({ tags: '@requires-data' }, async ({ request }) => {
  await seedDemoData(request)
})
```

## Phase 5: Validation & CI

### 5a. Run `validate-coverage.ts` in CI
```bash
bun run test-specs:validate --platform desktop
```

### 5b. Target: 280+/298 passing (94%+)
Some tests will remain expected-fail until features are fully implemented (demo mode, RCS, WebRTC). Tag these `@wip`.

## Execution Order

1. **Phase 1a** (30 min) — Fix CSS selectors — immediate 7-test fix
2. **Phase 1b+1c** (4-6 hours) — Test ID migration across step defs + UI components — fixes ~52 tests
3. **Phase 3** (1 hour) — Auth robustness — fixes ~18 tests
4. **Phase 2** (1 hour) — Per-worker isolation — prevents concurrency issues
5. **Phase 4** (2 hours) — Data seeding — fixes remaining ~48 tests
6. **Phase 5** (30 min) — CI validation

## Files Modified

| Category | Files |
|----------|-------|
| Step definitions | All 37 files in `tests/steps/` |
| Test IDs | `tests/test-ids.ts` |
| Helpers | `tests/helpers.ts`, `tests/api-helpers.ts` |
| Page objects | `tests/pages/index.ts` |
| Global setup | `tests/global-setup.ts` |
| Playwright config | `playwright.config.ts` |
| UI components | ~30 React components needing `data-testid` attributes |
| Seed helpers | `tests/seed-helpers.ts` (new) |

## Success Criteria

- [ ] Zero `text=` CSS selectors in step definitions
- [ ] Zero `getByText()` for element interaction (only for text content assertions)
- [ ] Zero `getByRole()` for specific element selection (only for generic dialog/heading assertions)
- [ ] All step definitions use `getByTestId()` or `page.locator('[data-testid="..."]')`
- [ ] Per-worker credential isolation configured
- [ ] API-based data seeding for demo/feature tests
- [ ] 280+/298 BDD tests passing
- [ ] CI runs BDD validation
