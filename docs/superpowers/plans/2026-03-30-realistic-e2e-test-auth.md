# Realistic E2E Test Authentication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace synthetic key injection in ~60 UI E2E test files with real bootstrap/invite flows, per-role Playwright fixtures, and cached storage state.

**Architecture:** Global setup bootstraps admin via real browser flow, creates 4 additional role accounts via real invite/onboarding flows, caches storage state per role. Worker-scoped fixtures load cached state and enter PIN once per file. All ~60 test files updated to use role fixtures instead of `loginAsAdmin`/`loginAsUser`.

**Tech Stack:** Playwright fixtures, `storageState`, worker-scoped browser contexts, existing app flows (bootstrap, invite, onboarding)

**Spec:** `docs/superpowers/specs/epic-80-realistic-e2e-test-auth.md`

---

## File Structure

### New Files
- `tests/fixtures/auth.ts` — Per-role Playwright fixtures (adminPage, volunteerPage, etc.)
- `tests/storage/.gitkeep` — Directory for cached storage state JSONs (gitignored)

### Modified Files
- `tests/global-setup.ts` — Real bootstrap + invite flows for 5 roles
- `tests/helpers/index.ts` — Remove synthetic auth (loginAsAdmin, loginAsUser, preloadEncryptedKey, ADMIN_NSEC), keep utilities (enterPin, navigateAfterLogin, etc.)
- `playwright.config.ts` — Setup timeout increase, storage dir
- `.gitignore` — Add `tests/storage/*.json`
- `tests/ui/*.spec.ts` — All ~60 files migrated to use role fixtures

### Unchanged
- `tests/api-helpers.ts` — API tests use JWT signing, no browser needed
- `tests/helpers/authed-request.ts` — API-only concern
- `tests/pages/index.ts` — Page objects unchanged
- `tests/test-ids.ts` — Test IDs unchanged

---

### Task 1: Create Auth Fixtures

**Files:**
- Create: `tests/fixtures/auth.ts`

- [ ] **Step 1: Create the fixtures file with per-role authenticated pages**

```typescript
// tests/fixtures/auth.ts
import { test as base, type Page, type BrowserContext } from '@playwright/test'
import { enterPin, completeProfileSetup, Timeouts } from '../helpers'

const TEST_PIN = '123456'
const STORAGE_DIR = 'tests/storage'

/** Storage state file paths for each role */
export const STORAGE_PATHS = {
  admin: `${STORAGE_DIR}/admin.json`,
  'hub-admin': `${STORAGE_DIR}/hub-admin.json`,
  volunteer: `${STORAGE_DIR}/volunteer.json`,
  reviewer: `${STORAGE_DIR}/reviewer.json`,
  reporter: `${STORAGE_DIR}/reporter.json`,
} as const

type RoleName = keyof typeof STORAGE_PATHS

/**
 * Create an authenticated page for a role by loading cached storage state
 * and entering the PIN to unlock. Worker-scoped — runs once per test file.
 */
async function createAuthenticatedPage(
  browser: import('@playwright/test').Browser,
  role: RoleName
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: STORAGE_PATHS[role],
  })
  const page = await context.newPage()

  // Auto-dismiss session expired modal if it appears during the test
  await page.addLocatorHandler(page.getByText('Session Expired'), async () => {
    const reconnectBtn = page.getByRole('button', { name: /reconnect/i })
    if (await reconnectBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await reconnectBtn.click({ timeout: 3000 }).catch(() => {})
    }
  })

  // Navigate to app — triggers PIN screen (in-memory keyManager cleared on fresh page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('domcontentloaded')

  // Enter PIN to unlock
  const pinInput = page.locator('input[aria-label="PIN digit 1"]')
  await pinInput.waitFor({ state: 'visible', timeout: Timeouts.AUTH })
  await enterPin(page, TEST_PIN)

  // Wait for authenticated state — may redirect to profile-setup first
  const dashboardHeading = page.getByRole('heading', { name: 'Dashboard', exact: true })
  const profileSetupUrl = (u: URL) => u.pathname.includes('profile-setup')

  const destination = await Promise.race([
    dashboardHeading
      .waitFor({ state: 'visible', timeout: Timeouts.AUTH })
      .then(() => 'dashboard' as const),
    page
      .waitForURL((u) => profileSetupUrl(new URL(u.toString())), { timeout: Timeouts.AUTH })
      .then(() => 'profile-setup' as const),
  ])

  if (destination === 'profile-setup') {
    await completeProfileSetup(page)
  }

  return { context, page }
}

/**
 * Extended Playwright test with per-role authenticated page fixtures.
 * Each fixture is worker-scoped — PIN entry happens once per test file.
 */
export const test = base.extend<
  {},
  {
    adminPage: Page
    adminContext: BrowserContext
    hubAdminPage: Page
    hubAdminContext: BrowserContext
    volunteerPage: Page
    volunteerContext: BrowserContext
    reviewerPage: Page
    reviewerContext: BrowserContext
    reporterPage: Page
    reporterContext: BrowserContext
  }
>({
  adminPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'admin')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  adminContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'admin')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  hubAdminPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'hub-admin')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  hubAdminContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'hub-admin')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  volunteerPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'volunteer')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  volunteerContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'volunteer')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  reviewerPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'reviewer')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  reviewerContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'reviewer')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  reporterPage: [
    async ({ browser }, use) => {
      const { context, page } = await createAuthenticatedPage(browser, 'reporter')
      await use(page)
      await context.close()
    },
    { scope: 'worker' },
  ],
  reporterContext: [
    async ({ browser }, use) => {
      const { context } = await createAuthenticatedPage(browser, 'reporter')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
})

export { expect } from '@playwright/test'
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`
Expected: No errors in `tests/fixtures/auth.ts`

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/auth.ts
git commit -m "feat: add per-role Playwright auth fixtures with storage state"
```

---

### Task 2: Rewrite Global Setup

**Files:**
- Modify: `tests/global-setup.ts`

The global setup must bootstrap admin via real browser flow, then create 4 role accounts via real invite/onboarding flows. Each account's storage state is saved to `tests/storage/`.

- [ ] **Step 1: Create storage directory and gitignore**

```bash
mkdir -p tests/storage
touch tests/storage/.gitkeep
```

Add to `.gitignore`:
```
tests/storage/*.json
```

- [ ] **Step 2: Rewrite global-setup.ts**

```typescript
// tests/global-setup.ts
import { test, expect } from '@playwright/test'

const TEST_PIN = '123456'
const TEST_RESET_SECRET = process.env.DEV_RESET_SECRET || 'test-reset-secret'
const STORAGE_DIR = 'tests/storage'

/** Enter a 6-digit PIN into the PinInput component. */
async function enterSetupPin(page: import('@playwright/test').Page, pin: string) {
  const firstDigit = page.locator('input[aria-label="PIN digit 1"]')
  await firstDigit.waitFor({ state: 'visible', timeout: 30000 })
  await firstDigit.focus()
  await page.keyboard.type(pin, { delay: 80 })
  await page.keyboard.press('Enter')
}

/**
 * Complete the admin bootstrap flow:
 * 1. Navigate to /setup
 * 2. Click "Get Started"
 * 3. Create PIN + confirm PIN
 * 4. Download backup
 * 5. Continue to setup wizard
 * 6. Complete identity step (hotline name + org)
 */
async function bootstrapAdmin(page: import('@playwright/test').Page) {
  await page.goto('/setup', { waitUntil: 'domcontentloaded' })
  // Clear any stale state
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })

  // Wait for bootstrap UI
  await expect(page.getByText('Create Admin Account')).toBeVisible({ timeout: 30000 })

  // Click "Get Started"
  await page.getByRole('button', { name: /get started/i }).click()

  // Create PIN
  await enterSetupPin(page, TEST_PIN)

  // Confirm PIN
  await enterSetupPin(page, TEST_PIN)

  // Wait for keypair generation + recovery key display (PBKDF2 600K — slow)
  const recoveryKey = page.getByTestId('recovery-key')
  await expect(recoveryKey).toBeVisible({ timeout: 90000 })

  // Download backup (required before continuing)
  await page.getByRole('button', { name: /download encrypted backup/i }).click()

  // Acknowledge backup saved
  await page.getByText('I have saved my recovery key').click()

  // Continue to setup wizard
  await page.getByRole('button', { name: /continue to setup/i }).click()

  // Wait for setup wizard to load (importKey runs PBKDF2 again — slow)
  await expect(page.getByText('Setup Wizard')).toBeVisible({ timeout: 90000 })
  await expect(page.getByText('Identity', { exact: true })).toBeVisible()

  // Complete identity step (minimum for functional hub)
  await page.locator('#hotline-name').fill(`Test Hotline ${Date.now()}`)
  await page.locator('#org-name').fill('Test Organization')
  await page.getByRole('button', { name: /next/i }).click()

  // Wait for step 2 to confirm identity was saved
  await expect(page.getByText('Choose Communication Channels')).toBeVisible({ timeout: 10000 })

  // Select at least one channel (Reports — lightweight, no provider needed)
  const reportsChannel = page.locator('[role="button"][aria-pressed]').filter({ hasText: 'Reports' })
  await reportsChannel.click()
  await page.getByRole('button', { name: /next/i }).click()

  // Skip remaining wizard steps to completion
  // Step 3: Providers — skip
  await page.getByRole('button', { name: /skip/i }).waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: /skip/i }).click()
  await page.waitForTimeout(500)

  // Step 4: Settings — skip
  await page.getByRole('button', { name: /skip/i }).waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: /skip/i }).click()
  await page.waitForTimeout(500)

  // Step 5: Invite Users — skip
  await page.getByRole('button', { name: /skip/i }).waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: /skip/i }).click()
  await page.waitForTimeout(500)

  // Step 6: Summary — Launch
  await page.getByRole('button', { name: /launch/i }).waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: /launch/i }).click()

  // Wait for dashboard
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
    timeout: 15000,
  })
}

/**
 * Create an invite for a role and complete onboarding in a new context.
 * Returns after saving the new user's storage state.
 */
async function createRoleAccount(
  adminPage: import('@playwright/test').Page,
  browser: import('@playwright/test').Browser,
  opts: {
    name: string
    phone: string
    roleName: string
    storageFile: string
  }
) {
  // Navigate to Users page
  await adminPage.getByRole('link', { name: 'Users' }).click()
  await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 10000 })

  // Click "Invite User"
  await adminPage.getByRole('button', { name: /invite user/i }).click()

  // Fill invite form
  await adminPage.getByLabel('Name').fill(opts.name)
  await adminPage.locator('#invite-phone').fill(opts.phone)
  await adminPage.locator('#invite-phone').blur()
  await adminPage.waitForTimeout(500)

  // Select role from the invite form's role dropdown (shadcn Select with id="invite-role")
  const roleTrigger = adminPage.locator('#invite-role')
  await roleTrigger.click()
  // Role names are hub-key encrypted display names — match by role convention
  // The default roles are named "Super Admin", "Hub Admin", "Volunteer", "Reviewer", "Reporter"
  const roleDisplayNames: Record<string, string> = {
    'hub-admin': 'Hub Admin',
    volunteer: 'Volunteer',
    reviewer: 'Reviewer',
    reporter: 'Reporter',
  }
  const displayName = roleDisplayNames[opts.roleName]
  if (displayName) {
    await adminPage.getByRole('option', { name: displayName }).click()
  }

  // Create invite
  await adminPage.getByRole('button', { name: /create invite/i }).click()

  // Wait for invite link to appear
  const inviteLinkEl = adminPage.getByTestId('invite-link-code')
  await expect(inviteLinkEl).toBeVisible({ timeout: 15000 })
  const inviteLink = await inviteLinkEl.textContent()
  if (!inviteLink) throw new Error(`Failed to get invite link for ${opts.name}`)

  // Dismiss the send invite dialog if it auto-opens
  await adminPage.keyboard.press('Escape')
  await adminPage.waitForTimeout(300)

  // Dismiss the invite link card
  const dismissBtn = adminPage.getByTestId('dismiss-invite')
  if (await dismissBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dismissBtn.click()
  }

  // Open new browser context for the invited user
  const userContext = await browser.newContext()
  const userPage = await userContext.newPage()

  try {
    // Navigate to invite link
    await userPage.goto(inviteLink, { waitUntil: 'domcontentloaded' })

    // Wait for welcome page
    await expect(userPage.getByText(/welcome/i)).toBeVisible({ timeout: 15000 })

    // Click "Get Started"
    await userPage.getByRole('button', { name: /get started/i }).click()

    // Create PIN
    await enterSetupPin(userPage, TEST_PIN)

    // Confirm PIN
    await enterSetupPin(userPage, TEST_PIN)

    // Wait for keypair generation + recovery key (PBKDF2 600K — slow)
    const recoveryKey = userPage.getByTestId('recovery-key')
    await expect(recoveryKey).toBeVisible({ timeout: 90000 })

    // Download backup
    await userPage.getByRole('button', { name: /download encrypted backup/i }).click()

    // Acknowledge backup
    await userPage.getByText('I have saved my recovery key').click()

    // Continue
    await userPage.getByRole('button', { name: /continue/i }).click()

    // Wait for redirect to profile-setup or dashboard
    await userPage.waitForURL(
      (url) => {
        const path = new URL(url.toString()).pathname
        return path.includes('profile-setup') || path === '/'
      },
      { timeout: 60000 }
    )

    // Complete profile setup if redirected there
    if (userPage.url().includes('profile-setup')) {
      await userPage.getByRole('button', { name: /complete setup/i }).click()
      await userPage.waitForURL((u) => !u.toString().includes('profile-setup'), {
        timeout: 15000,
      })
    }

    // Wait for authenticated state
    await expect(userPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
      timeout: 15000,
    })

    // Save storage state
    await userContext.storageState({ path: opts.storageFile })
  } finally {
    await userContext.close()
  }
}

// =====================================================================
// Global setup test suite — runs once before all other test projects
// =====================================================================

test.describe('Global Setup: Provision Test Accounts', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 })

  test('reset database and bootstrap admin', async ({ page, request, browser }) => {
    // Full reset to fresh state (no admin)
    const res = await request.post('/api/test-reset-no-admin', {
      headers: { 'X-Test-Secret': TEST_RESET_SECRET },
    })
    expect(res.ok(), `test-reset-no-admin failed: ${res.status()}`).toBeTruthy()

    // Run real bootstrap flow
    await bootstrapAdmin(page)

    // Save admin storage state
    await page.context().storageState({ path: `${STORAGE_DIR}/admin.json` })
  })

  test('create hub-admin account via invite', async ({ browser }) => {
    // Load admin context from saved state
    const adminContext = await browser.newContext({
      storageState: `${STORAGE_DIR}/admin.json`,
    })
    const adminPage = await adminContext.newPage()

    try {
      // Re-enter PIN (fresh context, keyManager cleared)
      await adminPage.goto('/', { waitUntil: 'domcontentloaded' })
      await enterSetupPin(adminPage, TEST_PIN)
      await expect(
        adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
      ).toBeVisible({ timeout: 60000 })

      await createRoleAccount(adminPage, browser, {
        name: 'Test Hub Admin',
        phone: '+15551000001',
        roleName: 'hub-admin',
        storageFile: `${STORAGE_DIR}/hub-admin.json`,
      })
    } finally {
      await adminContext.close()
    }
  })

  test('create volunteer account via invite', async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: `${STORAGE_DIR}/admin.json`,
    })
    const adminPage = await adminContext.newPage()

    try {
      await adminPage.goto('/', { waitUntil: 'domcontentloaded' })
      await enterSetupPin(adminPage, TEST_PIN)
      await expect(
        adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
      ).toBeVisible({ timeout: 60000 })

      await createRoleAccount(adminPage, browser, {
        name: 'Test Volunteer',
        phone: '+15551000002',
        roleName: 'volunteer',
        storageFile: `${STORAGE_DIR}/volunteer.json`,
      })
    } finally {
      await adminContext.close()
    }
  })

  test('create reviewer account via invite', async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: `${STORAGE_DIR}/admin.json`,
    })
    const adminPage = await adminContext.newPage()

    try {
      await adminPage.goto('/', { waitUntil: 'domcontentloaded' })
      await enterSetupPin(adminPage, TEST_PIN)
      await expect(
        adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
      ).toBeVisible({ timeout: 60000 })

      await createRoleAccount(adminPage, browser, {
        name: 'Test Reviewer',
        phone: '+15551000003',
        roleName: 'reviewer',
        storageFile: `${STORAGE_DIR}/reviewer.json`,
      })
    } finally {
      await adminContext.close()
    }
  })

  test('create reporter account via invite', async ({ browser }) => {
    const adminContext = await browser.newContext({
      storageState: `${STORAGE_DIR}/admin.json`,
    })
    const adminPage = await adminContext.newPage()

    try {
      await adminPage.goto('/', { waitUntil: 'domcontentloaded' })
      await enterSetupPin(adminPage, TEST_PIN)
      await expect(
        adminPage.getByRole('heading', { name: 'Dashboard', exact: true })
      ).toBeVisible({ timeout: 60000 })

      await createRoleAccount(adminPage, browser, {
        name: 'Test Reporter',
        phone: '+15551000004',
        roleName: 'reporter',
        storageFile: `${STORAGE_DIR}/reporter.json`,
      })
    } finally {
      await adminContext.close()
    }
  })
})
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add tests/global-setup.ts tests/storage/.gitkeep .gitignore
git commit -m "feat: rewrite global setup with real bootstrap + invite flows"
```

---

### Task 3: Update Playwright Config

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Update config for new setup timeout and storage**

In `playwright.config.ts`, change the `setup` project to allow 5 minutes for the 5-account bootstrap:

```typescript
// In the projects array, update the setup project:
{
  name: "setup",
  testMatch: /global-setup\.ts/,
  timeout: 300_000, // 5 min for bootstrap + 4 invite onboardings
},
```

- [ ] **Step 2: Verify config is valid**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "chore: increase setup project timeout for real bootstrap flows"
```

---

### Task 4: Clean Up Test Helpers

**Files:**
- Modify: `tests/helpers/index.ts`

Remove synthetic auth functions, keep utility functions. This is done AFTER test files are migrated (Task 5+), but the plan is written here for clarity.

- [ ] **Step 1: Remove synthetic auth functions from helpers**

Delete these functions/constants from `tests/helpers/index.ts`:
- `ADMIN_NSEC` constant
- `TEST_JWT_SECRET` constant (keep `TEST_PIN`)
- `preloadEncryptedKey()` function (entire function)
- `loginAsAdmin()` function (entire function)
- `loginAsUser()` function (entire function)
- `loginWithNsec()` function (entire function — unless `login-restore.spec.ts` needs it)
- `createUserAndGetNsec()` function (entire function)
- `dismissNsecCard()` function (entire function)

Keep these:
- `TEST_PIN` constant
- `Timeouts` object
- `enterPin()` function
- `navigateAfterLogin()` function
- `reenterPinAfterReload()` function
- `completeProfileSetup()` function
- `uniquePhone()` function
- `resetTestState()` function
- `logout()` function
- `TestIds` re-export
- Page object re-exports

Also remove the server-side imports that were only needed for JWT signing:
- `import('../../src/server/lib/jwt')` (dynamic import in loginAsAdmin/loginAsUser)
- `import('nostr-tools')` (dynamic import in loginAsAdmin/loginAsUser)
- `import('@noble/hashes/utils.js')` (dynamic import in preloadEncryptedKey)

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/index.ts
git commit -m "refactor: remove synthetic auth from test helpers"
```

---

### Task 5: Migrate Admin-Only Test Files (Batch 1 — 20 files)

**Files:** First batch of admin-only test files. These all follow the same pattern: replace `loginAsAdmin(page)` with `adminPage` fixture.

**Migration pattern for each file:**

1. Change the import:
```typescript
// Before:
import { test, expect } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin, ... } from '../helpers'

// After:
import { test, expect } from '../fixtures/auth'
import { navigateAfterLogin, ... } from '../helpers'
```

2. Replace `page` with `adminPage` in test signatures and remove login calls:
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

3. For `beforeEach` patterns:
```typescript
// Before:
test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})
test('does something', async ({ page }) => { ... })

// After (remove beforeEach, use fixture directly):
test('does something', async ({ adminPage }) => { ... })
```

- [ ] **Step 1: Migrate these 20 files**

Apply the migration pattern to each file:
1. `tests/ui/admin-flow.spec.ts`
2. `tests/ui/audit-log.spec.ts`
3. `tests/ui/ban-management.spec.ts`
4. `tests/ui/blast-sending.spec.ts`
5. `tests/ui/call-detail.spec.ts`
6. `tests/ui/call-flow.spec.ts`
7. `tests/ui/call-recording.spec.ts`
8. `tests/ui/call-spam.spec.ts`
9. `tests/ui/client-transcription.spec.ts`
10. `tests/ui/contacts.spec.ts`
11. `tests/ui/conversations.spec.ts`
12. `tests/ui/custom-fields.spec.ts`
13. `tests/ui/dashboard-analytics.spec.ts`
14. `tests/ui/demo-mode.spec.ts`
15. `tests/ui/epic-24-27.spec.ts`
16. `tests/ui/file-field.spec.ts`
17. `tests/ui/form-validation.spec.ts`
18. `tests/ui/geocoding.spec.ts`
19. `tests/ui/help.spec.ts`
20. `tests/ui/hub-access-control.spec.ts`

- [ ] **Step 2: Verify batch compiles**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add tests/ui/
git commit -m "refactor: migrate first 20 admin-only test files to auth fixtures"
```

---

### Task 6: Migrate Admin-Only Test Files (Batch 2 — 20 files)

**Files:** Second batch of admin-only files, same migration pattern as Task 5.

- [ ] **Step 1: Migrate these 20 files**

1. `tests/ui/i18n.spec.ts`
2. `tests/ui/invite-delivery.spec.ts`
3. `tests/ui/messaging-epics.spec.ts`
4. `tests/ui/multi-hub.spec.ts`
5. `tests/ui/nostr-relay.spec.ts`
6. `tests/ui/notes-crud.spec.ts`
7. `tests/ui/notes-custom-fields.spec.ts`
8. `tests/ui/notification-pwa.spec.ts`
9. `tests/ui/panic-wipe.spec.ts`
10. `tests/ui/pin-challenge.spec.ts`
11. `tests/ui/profile-settings.spec.ts`
12. `tests/ui/pwa-offline.spec.ts`
13. `tests/ui/rcs-channel.spec.ts`
14. `tests/ui/report-types.spec.ts`
15. `tests/ui/responsive.spec.ts`
16. `tests/ui/setup-wizard-provider.spec.ts`
17. `tests/ui/setup-wizard.spec.ts`
18. `tests/ui/shift-management.spec.ts`
19. `tests/ui/telephony-provider.spec.ts`
20. `tests/ui/theme.spec.ts`

- [ ] **Step 2: Verify batch compiles**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add tests/ui/
git commit -m "refactor: migrate second 20 admin-only test files to auth fixtures"
```

---

### Task 7: Migrate Admin-Only Test Files (Batch 3 — Remaining)

**Files:** Final batch of admin-only files plus special cases.

- [ ] **Step 1: Migrate remaining admin-only files**

1. `tests/ui/voice-captcha.spec.ts`
2. `tests/ui/voicemail-webhook.spec.ts`
3. `tests/ui/webauthn.spec.ts`
4. `tests/ui/webauthn-passkeys.spec.ts`
5. `tests/ui/webrtc-settings.spec.ts`
6. `tests/ui/signal-auto-registration.spec.ts`

- [ ] **Step 2: Handle special-case files that don't need login**

These files should NOT be migrated — they test unauthenticated flows:
- `tests/ui/smoke.spec.ts` — tests login page (no auth needed)
- `tests/ui/login-restore.spec.ts` — tests login page scenarios
- `tests/ui/device-linking.spec.ts` — tests link-device page without stored key
- `tests/ui/sip-browser-calling.spec.ts` — skipped tests, no login

For these files, only update the import if they import `loginAsAdmin` (remove unused import). If they use `{ test, expect }` from `@playwright/test` directly, leave them unchanged.

- [ ] **Step 3: Handle `capture-screenshots.spec.ts`**

This file has custom encrypted key logic separate from `loginAsAdmin`. Read it, understand the pattern, and update to use the `adminPage` fixture instead.

- [ ] **Step 4: Handle `provider-oauth.spec.ts`**

This file uses `ADMIN_NSEC` for API-only auth (no UI login). It should use `authed-request.ts` patterns instead of importing `ADMIN_NSEC` from helpers. Update to create its own authed request.

- [ ] **Step 5: Verify batch compiles**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add tests/ui/
git commit -m "refactor: migrate remaining admin-only test files to auth fixtures"
```

---

### Task 8: Migrate Multi-Role Test Files

**Files:** 5 files that create users and test as different roles. These need the role-specific fixtures.

- [ ] **Step 1: Migrate `tests/ui/roles.spec.ts`**

This file creates a reporter and tests what they can see. Replace `createUserAndGetNsec` + `loginAsUser` with `reporterPage` fixture.

```typescript
// Before: Creates reporter inline, assigns role via API, logs in as reporter
// After: Uses reporterPage fixture (reporter already created in global setup)

// Change import:
import { test, expect } from '../fixtures/auth'

// Split into describe blocks per role:
test.describe('admin role views', () => {
  test('admin sees all nav items', async ({ adminPage }) => { ... })
})

test.describe('reporter role views', () => {
  test('reporter sees reports UI, not call/user management', async ({ reporterPage }) => { ... })
})
```

- [ ] **Step 2: Migrate `tests/ui/user-flow.spec.ts`**

This file creates a volunteer and tests limited navigation. Replace with `volunteerPage` fixture.

```typescript
// Before: Creates volunteer, logs in as volunteer
// After: Uses volunteerPage fixture

test.describe('volunteer navigation', () => {
  test('volunteer sees limited nav', async ({ volunteerPage }) => { ... })
})
```

- [ ] **Step 3: Migrate `tests/ui/blasts.spec.ts`**

Tests that volunteers can't access blasts. Use `volunteerPage` fixture.

- [ ] **Step 4: Migrate `tests/ui/reports.spec.ts`**

Tests report creation as different roles. Use `reporterPage` and `adminPage` fixtures.

- [ ] **Step 5: Migrate `tests/ui/gdpr.spec.ts`**

Tests consent gate for users. May need both `adminPage` and `volunteerPage`.

- [ ] **Step 6: Verify batch compiles**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`

- [ ] **Step 7: Commit**

```bash
git add tests/ui/
git commit -m "refactor: migrate multi-role test files to role-specific fixtures"
```

---

### Task 9: Migrate bootstrap.spec.ts and invite-onboarding.spec.ts

**Files:**
- Modify: `tests/ui/bootstrap.spec.ts`
- Modify: `tests/ui/invite-onboarding.spec.ts`

These files test the bootstrap and invite flows themselves. They need special handling because they deliberately reset state and run the flows from scratch.

- [ ] **Step 1: Update `bootstrap.spec.ts`**

This file calls `test-reset-no-admin` and runs bootstrap from scratch. It does NOT use `loginAsAdmin` — it tests the bootstrap UI directly. The main change:
- Update import to use `{ test, expect }` from `@playwright/test` (NOT from fixtures — it doesn't use fixtures)
- Remove any `loginAsAdmin` imports if present
- Keep all existing test logic — this file IS the bootstrap flow test

- [ ] **Step 2: Update `invite-onboarding.spec.ts`**

This file tests invite creation and onboarding. The admin part should use `adminPage` fixture, but the onboarding part uses a fresh context (as it does now).

```typescript
// Change import to use fixtures:
import { test, expect } from '../fixtures/auth'

// Admin tests use adminPage fixture
test('admin creates invite and user completes onboarding', async ({ adminPage, browser }) => {
  // Navigate to Users (no loginAsAdmin needed)
  await adminPage.getByRole('link', { name: 'Users' }).click()
  // ... rest of invite creation using adminPage ...

  // User onboarding in new context (unchanged pattern)
  const userContext = await browser.newContext()
  const userPage = await userContext.newPage()
  await userPage.goto(inviteLink)
  // ... onboarding flow unchanged ...
})
```

- [ ] **Step 3: Verify compiles**

Run: `cd /home/rikki/projects/llamenos-hotline-cms && bun run typecheck`

- [ ] **Step 4: Commit**

```bash
git add tests/ui/bootstrap.spec.ts tests/ui/invite-onboarding.spec.ts
git commit -m "refactor: update bootstrap and invite-onboarding tests for new auth fixtures"
```

---

### Task 10: Run Full E2E Suite and Fix Failures

**Files:** Various — depends on what fails

- [ ] **Step 1: Build and run the full UI test suite**

```bash
cd /home/rikki/projects/llamenos-hotline-cms
bun run build
bunx playwright test --project=setup --project=ui --reporter=list
```

Expected: Global setup provisions 5 accounts (~2-3 min), then UI tests run using cached storage state.

- [ ] **Step 2: Analyze failures**

Categorize failures:
- **Auth failures** — PIN entry timing, storage state not loaded, JWT expired → fix in fixtures
- **Selector failures** — tests looking for elements that moved/renamed → fix selectors
- **Hub key failures** — org metadata still not decryptable → should be fixed by real bootstrap (hub keys provisioned naturally)
- **Timing failures** — react-query caching changes → add appropriate waits

- [ ] **Step 3: Fix failures iteratively**

For each failure category, fix the root cause:
- Auth: adjust fixture timeouts, PIN entry waits
- Selectors: update to match current UI
- Hub key: verify hub key is in storage state (should be automatic from real flow)
- Timing: use `waitFor` instead of fixed timeouts where react-query changed data flow

- [ ] **Step 4: Re-run until green**

```bash
bunx playwright test --project=setup --project=ui --reporter=list
```

Iterate until all tests pass.

- [ ] **Step 5: Commit fixes**

```bash
git add -A
git commit -m "fix: resolve E2E test failures after auth fixture migration"
```

---

### Task 11: Final Cleanup and Verification

**Files:**
- Modify: `tests/helpers/index.ts` (remove dead code — Task 4)
- Various test files (remove unused imports)

- [ ] **Step 1: Execute Task 4 (clean up helpers)**

Remove the synthetic auth functions from `tests/helpers/index.ts` as detailed in Task 4.

- [ ] **Step 2: Remove unused imports from test files**

Search for any remaining imports of deleted functions:
```bash
grep -r 'loginAsAdmin\|loginAsUser\|loginWithNsec\|ADMIN_NSEC\|createUserAndGetNsec\|preloadEncryptedKey' tests/ui/ tests/helpers/
```

Remove any remaining references.

- [ ] **Step 3: Run typecheck + build**

```bash
cd /home/rikki/projects/llamenos-hotline-cms
bun run typecheck
bun run build
```

- [ ] **Step 4: Run full test suite (all projects)**

```bash
bunx playwright test --reporter=list
```

This runs setup → api → ui → bootstrap → mobile. All should pass.

- [ ] **Step 5: Commit final cleanup**

```bash
git add -A
git commit -m "chore: remove synthetic auth infrastructure, clean up imports"
```

- [ ] **Step 6: Push to remote**

```bash
git push origin feat/contact-directory-cms
```
