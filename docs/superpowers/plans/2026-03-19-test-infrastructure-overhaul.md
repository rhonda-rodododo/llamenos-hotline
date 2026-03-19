# Test Infrastructure Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all sources of test flakiness, slowness, and false-positives by replacing shared-DB isolation with hub-per-worker isolation, removing 202 `waitForTimeout` sleeps, collapsing the 7-project Playwright config to 3, eliminating module-level mutable state in step files, and consolidating to a single selector registry.

**Architecture:** Each Playwright worker creates its own hub at startup via `POST /api/hubs`, stores the hub ID in a worker-scoped fixture, and injects it into the browser via `window.__TEST_SET_ACTIVE_HUB` before each scenario — leveraging the existing `setActiveHub(id)` / `hp()` multi-tenant path prefixing in `api.ts` with zero server-side changes. Module-level state in step files moves to `playwright-bdd` World fixtures so each scenario gets a fresh scope. The `bdd-serial` project and `@resets-state` tag are deleted once hub isolation makes per-scenario resets unnecessary.

**Tech Stack:** Playwright 1.x, playwright-bdd, Vite `VITE_PLAYWRIGHT_TEST` env flag, existing `POST /api/hubs` endpoint (requires `system:manage-hubs` permission — admin nsec satisfies this), `tests/api-helpers.ts` Schnorr auth helpers.

---

### Task 1: Worker-Scoped Hub Fixture

**Files:**
- Modify: `tests/steps/fixtures.ts` — add `workerHub` worker-scoped fixture
- Modify: `tests/api-helpers.ts` — add `createHubViaApi` helper

The `POST /api/hubs` endpoint at `apps/worker/routes/hubs.ts:49` requires `system:manage-hubs` permission. The admin nsec in `ADMIN_NSEC` satisfies this via the Schnorr auth pattern in `api-helpers.ts`.

- [ ] In `tests/api-helpers.ts`, add `createHubViaApi(request, name)` that calls `apiPost(request, '/api/hubs', { name, slug: name.toLowerCase().replace(/\s+/g, '-') })` and returns the created hub's `id`
- [ ] In `tests/steps/fixtures.ts`, extend the `test` fixture with a worker-scoped `workerHub` fixture:
  ```typescript
  workerHub: [async ({ playwright }, use, workerInfo) => {
    const backendUrl = process.env.TEST_HUB_URL || 'http://localhost:3000'
    const ctx = await playwright.request.newContext({ baseURL: backendUrl })
    const hubName = `test-hub-${workerInfo.workerIndex}-${Date.now()}`
    const hubId = await createHubViaApi(ctx, hubName)
    await ctx.dispose()
    await use(hubId)
    // Hub is NOT deleted — stale test hubs accumulate; purge periodically
  }, { scope: 'worker' }]
  ```
- [ ] Update `createBdd(test)` export to include the new fixture in the type signature
- [ ] In `tests/steps/common/before-hooks.ts`, replace the `@resets-state` Before hook with a universal Before hook that calls `window.__TEST_SET_ACTIVE_HUB(workerHubId)` for every scenario:
  ```typescript
  Before(async ({ page, workerHub }) => {
    await page.evaluate((id) => {
      window.__TEST_SET_ACTIVE_HUB?.(id)
    }, workerHub).catch(() => {})
  })
  ```
- [ ] Verify `window.__TEST_SET_ACTIVE_HUB` is already exposed in `src/client/main.tsx:44` (confirmed: `window.__TEST_SET_ACTIVE_HUB = api.setActiveHub`)
- [ ] Commit: `git commit -m "feat(tests): add worker-scoped hub fixture for parallel test isolation"`

---

### Task 2: Delete `@resets-state` Tag and `bdd-serial` Project

**Files:**
- Modify: `tests/steps/common/before-hooks.ts` — remove `@resets-state` Before hook
- Modify: `packages/test-specs/features/platform/desktop/misc/setup-wizard.feature` — remove `@resets-state` tag
- Modify: `packages/test-specs/features/platform/desktop/cases/cms-admin-settings.feature` — remove `@resets-state` tag
- Modify: `packages/test-specs/features/admin/settings.feature` — remove `@resets-state` tags (lines 95 and 102)
- Modify: `playwright.config.ts` — delete `bdd-serial` project

The 4 feature files that use `@resets-state` tag (confirmed via grep: `setup-wizard.feature:1`, `cms-admin-settings.feature:1`, `settings.feature:95`, `settings.feature:102`) must be verified — the scenarios tagged with `@resets-state` modify global settings (CMS toggle, setup wizard state). With hub-per-worker isolation, these operations are already sandboxed within the worker's hub. The tag becomes meaningless.

- [ ] Open each of the 4 feature files and remove `@resets-state` from the tag lines — leave all other tags intact
- [ ] In `tests/steps/common/before-hooks.ts`, remove the `Before({ tags: '@resets-state' }, ...)` hook entirely. The file should only contain the universal hub-injection Before hook added in Task 1.
- [ ] In `playwright.config.ts`, delete the entire `bdd-serial` project block (lines 71–88: the `...defineBddProject({ name: 'bdd-serial', ... })` object)
- [ ] In `playwright.config.ts`, update the `bdd` project's `tags` filter: remove `and not @resets-state` from line 63 so it reads: `tags: "@desktop and not @backend and not @wip"`
- [ ] Commit: `git commit -m "feat(tests): delete bdd-serial project and @resets-state tag — hub isolation replaces them"`

---

### Task 3: Playwright Config Simplification (7 → 3 Projects)

**Files:**
- Modify: `playwright.config.ts`
- Modify: `tests/global-setup.ts` — convert from test file to proper globalSetup function
- Modify: `tests/responsive.spec.ts` — add `test.use({ ...devices['Pixel 7'] })`
- Modify: `tests/bootstrap.spec.ts` — remove `dependencies` on `chromium`, refactor to create own data

**Context:** `tests/global-setup.ts` is currently implemented as a `test()` block (run via the `setup` project). `playwright.config.ts:106` shows `webServer` config already exists. The `bootstrap` project has `dependencies: ['chromium']` because its tests call `request.post('/api/test-reset-no-admin', ...)` which resets the admin — if `chromium` tests run first, they complete before bootstrap nukes the admin. Bootstrap tests can instead use the worker hub to avoid conflict.

- [ ] Rewrite `tests/global-setup.ts` as a proper `globalSetup` export function (not a `test()` block):
  ```typescript
  import type { FullConfig } from '@playwright/test'

  export default async function globalSetup(_config: FullConfig) {
    // Server health check with retry — same retry logic as current test
    const backendUrl = process.env.TEST_HUB_URL || 'http://localhost:3000'
    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(`${backendUrl}/api/config`)
        if (res.ok) return
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, 2000))
    }
    throw new Error('Backend not ready after 10 attempts')
  }
  ```
  Note: Do NOT reset the database in globalSetup. Hub isolation makes this unnecessary.
- [ ] In `playwright.config.ts`, replace the `setup` project with `globalSetup: './tests/global-setup.ts'` at the top-level config
- [ ] In `playwright.config.ts`, remove `dependencies: ['setup']` from `chromium`, `bdd`, and any remaining project that had it
- [ ] In `tests/responsive.spec.ts`, add at the top of the file:
  ```typescript
  import { test } from '@playwright/test'
  test.use({ viewport: { width: 412, height: 915 }, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) ...' })
  ```
  Or use: `test.use({ ...devices['Pixel 7'] })` (import `devices` from `@playwright/test`)
- [ ] In `playwright.config.ts`, delete the `mobile-chromium` project block entirely
- [ ] In `playwright.config.ts`, update the `chromium` project: remove `testIgnore: [/bootstrap\.spec\.ts/]` — bootstrap will now run as part of `chromium`
- [ ] Refactor `tests/bootstrap.spec.ts`: each test currently calls `request.post('/api/test-reset-no-admin', ...)` which nukes the global admin. These tests require a genuinely fresh state (no admin). This is fundamentally incompatible with parallel execution since there is only one admin slot. Approach: keep `test.describe.configure({ mode: 'serial' })` for bootstrap, but remove `dependencies: ['chromium']`. The bootstrap tests are self-contained (they reset to no-admin and re-create admin), so they can run at any time as long as they run serially among themselves.
- [ ] Delete the `bootstrap` project from `playwright.config.ts` (the file `bootstrap.spec.ts` will be picked up by the `chromium` project now that `testIgnore` no longer excludes it)
- [ ] In `playwright.config.ts`, update the `backend-bdd` project: set `fullyParallel: true` and `workers: 3` (Task 5 must be completed first for this to be safe — add a TODO comment here and complete it in Task 5)
- [ ] Final `playwright.config.ts` should have exactly 3 projects: `chromium`, `bdd`, `backend-bdd`
- [ ] Commit: `git commit -m "feat(tests): collapse playwright config from 7 to 3 projects, add globalSetup"`

---

### Task 4: Eliminate All 202 `waitForTimeout` Calls

**Files (all 202 occurrences across):**
- Modify: `tests/helpers.ts` (lines 100–108, 152, 259)
- Modify: `tests/steps/admin/desktop-admin-steps.ts` (18 occurrences)
- Modify: `tests/steps/common/interaction-steps.ts` (line 213, 249, 453)
- Modify: `tests/records-architecture.spec.ts` (lines 95, 121, 155, 181, 270)
- Modify: `tests/report-types.spec.ts` (line 105)
- Modify: `tests/steps/contacts/contacts-steps.ts` (line 80)
- Modify: `tests/steps/security/sas-verification-steps.ts` (line 27)
- Modify: `tests/steps/security/security-steps.ts` (line 72)
- Modify: `tests/steps/calls/call-steps.ts` (lines 21, 127)
- Modify: `tests/steps/calls/in-call-actions-steps.ts` (lines 18, 28, 54)
- Modify: `tests/steps/conversations/conversation-steps.ts` (lines 25, 67)
- Modify: `tests/steps/messaging/conversations-full-steps.ts` (lines 31, 49, 79, 114)
- Modify: `tests/steps/messaging/messaging-extended-steps.ts` (lines 79, 102, 126)
- Modify: `tests/steps/cases/cms-assignment-steps.ts` (lines 149, 154, 176, 199)
- Modify: `tests/steps/cases/cms-events-steps.ts` (12 occurrences)
- Modify: `tests/steps/cases/cms-triage-steps.ts` (lines 69, 81, 92, 97, 102)
- Modify: `tests/steps/cases/cms-admin-steps.ts` (9 occurrences)
- Modify: `tests/steps/auth/volunteer-steps.ts` (lines 60, 264)
- Modify: `tests/steps/shifts/scheduling-steps.ts` (line 22)
- Modify: `tests/steps/shifts/shift-detail-steps.ts` (line 16)
- Modify: `tests/steps/shifts/shift-steps.ts` (line 42)
- Modify: `tests/steps/settings/theme-steps.ts` (lines 17, 22, 27)
- Modify: `tests/steps/settings/language-steps.ts` (lines 18, 57, 64, 82, 103)
- Modify: `tests/steps/settings/device-link-extended-steps.ts` (lines 29, 64)
- Modify: `tests/steps/settings/notification-steps.ts` (line 22)
- Modify: `tests/steps/settings/settings-steps.ts` (line 199)
- Modify: `tests/steps/admin/audit-steps.ts` (lines 58, 80)
- Modify: `tests/steps/admin/ban-steps.ts` (line 173)
- Modify: `tests/steps/admin/admin-settings-steps.ts` (lines 29, 47)
- Modify: `tests/steps/admin/roles-steps.ts` (line 31)
- Modify: `tests/steps/admin/admin-flow-steps.ts` (lines 226, 229, 241, 247)
- Modify: `tests/steps/admin/volunteer-profile-steps.ts` (line 14)
- Modify: `tests/steps/notes/note-steps.ts` (lines 114, 122, 157, 196, 202, 251, 268)
- Modify: `tests/steps/notes/custom-fields-steps.ts` (lines 34, 70, 81, 147, 170, 210, 233, 251)
- Modify: `tests/steps/notes/note-thread-steps.ts` (lines 43, 50)
- Modify: `tests/updater.spec.ts` (line 44)

**Replacement rules (apply uniformly):**

| Old pattern | Replacement |
|---|---|
| `await page.waitForTimeout(Timeouts.ASYNC_SETTLE)` after nav click | `await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })` |
| `await page.waitForTimeout(Timeouts.UI_SETTLE)` after state toggle | `await expect(targetElement).toBeVisible()` or remove if already followed by an assertion |
| `await page.waitForTimeout(100)` per digit in PIN | remove per-digit delay (see `enterPin` fix below) |
| `await page.waitForTimeout(500)` after PIN Enter | `await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.AUTH })` |
| `await page.waitForTimeout(300)` after expand | `await expect(expandedContent).toBeVisible()` |
| `await page.waitForTimeout(N)` before asserting list content | `await expect(page.getByTestId(TestIds.X).first().or(page.getByTestId(TestIds.EMPTY_STATE))).toBeVisible({ timeout: Timeouts.ELEMENT })` |

**Specific high-impact fixes:**

- [ ] **`tests/helpers.ts:enterPin` (lines 99–108):** Replace per-digit `waitForTimeout(100)` with direct keyboard typing without delay. After pressing Enter, replace `waitForTimeout(500)` with:
  ```typescript
  for (const digit of pin) {
    await page.keyboard.type(digit)
  }
  await page.keyboard.press('Enter')
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.AUTH })
  ```
  If the PinInput requires delay for React state, use `page.keyboard.type(pin)` (all at once) then wait for the unlock indicator.

- [ ] **`tests/helpers.ts:navigateAfterLogin` (line 152):** Replace `await page.waitForTimeout(Timeouts.ASYNC_SETTLE)` with:
  ```typescript
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
  ```

- [ ] **`tests/helpers.ts:loginAsVolunteer` (line 259):** Remove the redundant `await page.waitForTimeout(Timeouts.UI_SETTLE)` — the preceding `NAV_SIDEBAR.waitFor()` on line 257 already waits for auth completion.

- [ ] **`tests/steps/admin/desktop-admin-steps.ts` — all 18 occurrences:** For each navigation step followed by `waitForTimeout(Timeouts.ASYNC_SETTLE)`, replace with `await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })`. For steps that open a section (line 209: `UI_SETTLE` after `.cursor-pointer` click), replace with `await expect(expandedSection.locator('[data-state="open"]')).toBeVisible()`.

- [ ] **`tests/steps/common/interaction-steps.ts:453` — `they navigate to the {string} page`:** Replace `await page.waitForTimeout(Timeouts.ASYNC_SETTLE)` with `await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })`.

- [ ] **`tests/steps/common/interaction-steps.ts:249` (inside `Then('the {string} button should be disabled'`):** Remove `await page.waitForTimeout(300)` — use `await expect(btn.first()).toBeDisabled({ timeout: 3000 })` directly.

- [ ] **`tests/records-architecture.spec.ts:95`:** Replace `await page.waitForTimeout(1500)` with `await expect(page.getByTestId(TestIds.NOTE_REPLY_BTN).first()).toContainText(/1 repl/i, { timeout: Timeouts.API })`.

- [ ] **`tests/records-architecture.spec.ts:121`, `:155`, `:181`, `:270`:** Same pattern — identify the state indicator that confirms the operation completed and assert on it.

- [ ] **`tests/report-types.spec.ts:105`:** Replace `await page.waitForTimeout(2000)` with `await expect(page.getByTestId('report-type-badge').first().or(page.getByTestId(TestIds.EMPTY_STATE))).toBeVisible({ timeout: Timeouts.ELEMENT })`.

- [ ] For all remaining files: scan each occurrence, identify what it is waiting for (navigation complete, element visible, API response), and replace with the appropriate `expect(...).toBeVisible()` or `expect(...).toHaveText()` assertion.

- [ ] Once all occurrences are removed, delete `UI_SETTLE` and `ASYNC_SETTLE` from `tests/helpers.ts:25–27`:
  ```typescript
  // DELETE these two entries:
  UI_SETTLE: 500,
  ASYNC_SETTLE: 1500,
  ```
  This forces a compile error on any future attempt to use them.

- [ ] Run `grep -rn "waitForTimeout" tests/` to verify the count is 0 (excluding comment lines).
- [ ] Commit: `git commit -m "perf(tests): eliminate all 202 waitForTimeout sleeps — replace with deterministic assertions"`

---

### Task 5: Module-Level State Elimination

**Files:**
- Modify: `tests/steps/fixtures.ts` — extend World type with AdminWorld state
- Modify: `tests/steps/admin/admin-flow-steps.ts` — move module-level `let` vars to World
- Modify: `tests/steps/backend/fixtures.ts` — extend World type with scenario state
- Modify: `tests/steps/backend/common.steps.ts` — move `export let state` to World
- Modify: `tests/steps/backend/call-actions.steps.ts` — move `lastCallerNumber`, `banCountBefore` to World
- Modify: `tests/steps/backend/relay.steps.ts` — move `lastCapturedEvent`, `serverPubkey` to World
- Modify: All other backend step files with module-level `let` state

**Desktop step file fix:**

- [ ] In `tests/steps/fixtures.ts`, add AdminWorld to the test fixture:
  ```typescript
  export type AdminWorld = {
    lastVolunteerName: string
    lastVolunteerPubkey: string
    lastShiftName: string
    lastPhone: string
  }

  export const test = base.extend<{
    apiErrors: ...
    backendRequest: ...
    workerHub: string        // added in Task 1
    adminWorld: AdminWorld   // NEW
  }>({
    adminWorld: async ({}, use) => {
      await use({ lastVolunteerName: '', lastVolunteerPubkey: '', lastShiftName: '', lastPhone: '' })
    },
    ...
  })
  ```

- [ ] In `tests/steps/admin/admin-flow-steps.ts`, delete lines 19–22 (`let lastVolunteerName`, etc.) and update every step definition that reads/writes those variables to use `adminWorld` from the fixture parameter. Example:
  ```typescript
  // Before:
  When('I add a new volunteer with a unique name and phone', async ({ page }) => {
    lastVolunteerName = `Vol ${Date.now()}`
    ...
  })
  // After:
  When('I add a new volunteer with a unique name and phone', async ({ page, adminWorld }) => {
    adminWorld.lastVolunteerName = `Vol ${Date.now()}`
    ...
  })
  ```

**Backend step file fix:**

- [ ] In `tests/steps/backend/fixtures.ts`, extend the test fixture with a `scenarioState` fixture scoped to `'test'` (per-scenario):
  ```typescript
  import type { ScenarioState } from './common.steps'

  export const test = base.extend<{ scenarioState: ScenarioState }>({
    scenarioState: async ({}, use) => {
      await use({ volunteers: [], shiftIds: [], banPhones: [] })
    },
  })
  ```

- [ ] In `tests/steps/backend/common.steps.ts`:
  - Delete `export let state: ScenarioState` (line 36)
  - Delete the `Before(async () => { state = {...} })` hook (lines 38–44) — the fixture handles reset
  - Update all steps in this file to use `scenarioState` from the fixture parameter instead of the module-level `state`

- [ ] In `tests/steps/backend/call-actions.steps.ts`:
  - Delete `let lastCallerNumber` and `let banCountBefore` (lines 22–25)
  - Import `scenarioState` from fixture
  - Move these to the `scenarioState` type: add `lastCallerNumber?: string`, `banCountBefore?: number` to `ScenarioState` in `common.steps.ts`
  - Update all steps to use `scenarioState.lastCallerNumber`, `scenarioState.banCountBefore`

- [ ] In `tests/steps/backend/relay.steps.ts`:
  - Delete `let lastCapturedEvent` and `let serverPubkey` (lines 32–33)
  - Add `lastCapturedEvent?: CapturedEvent`, `serverPubkey?: string` to `ScenarioState`
  - Update all steps to use `scenarioState.lastCapturedEvent`, `scenarioState.serverPubkey`

- [ ] Audit all remaining backend step files for module-level `let` state (use `grep -n "^let \|^export let " tests/steps/backend/*.ts`) and move each to `ScenarioState` using the same pattern.

- [ ] In `tests/steps/backend/shared-state.ts`:
  - Delete the file entirely once all consumers are migrated
  - Update imports in any file that still imports from `./shared-state` to use `scenarioState` instead

- [ ] Now that backend state is scenario-scoped, enable parallelism in `playwright.config.ts` (complete the TODO from Task 3): set `backend-bdd` project `fullyParallel: true`, `workers: 3`

- [ ] Commit: `git commit -m "refactor(tests): move all module-level step state to fixture-scoped World — enables safe parallelism"`

---

### Task 6: Selector Consolidation

**Files:**
- Modify: `tests/test-ids.ts` — add missing settings section constants
- Modify: `tests/steps/common/interaction-steps.ts` — delete `buttonTestIdMap`, `sectionTestIdMap`; use `TestIds` directly
- Modify: `tests/steps/common/assertion-steps.ts` — remove duplicate `buttonTestIdMap`-equivalent
- Modify: `tests/steps/crypto/crypto-steps.ts` — replace `#nsec` DOM ID with `data-testid`
- Modify: `tests/steps/admin/desktop-admin-steps.ts` — replace `.cursor-pointer`, `[data-settings-section]` selectors
- Modify: `tests/report-types.spec.ts` — replace `button[type="button"]`, `.text-\\[10px\\]`
- Modify: `tests/records-architecture.spec.ts` — replace `[data-testid="custom-fields"] h3`
- Modify: `src/client/components/` — add `data-testid` to the elements that lack them

**Add missing `TestIds` entries:**

- [ ] In `tests/test-ids.ts`, add the settings section constants that `sectionTestIdMap` currently owns:
  ```typescript
  // ============ Settings Sections ============
  SETTINGS_CUSTOM_FIELDS: 'custom-fields',
  SETTINGS_TELEPHONY: 'telephony',
  SETTINGS_TRANSCRIPTION: 'transcription',
  SETTINGS_SPAM: 'spam-section',
  SETTINGS_KEY_BACKUP: 'key-backup',
  SETTINGS_LINKED_DEVICES: 'linked-devices',
  SETTINGS_ADVANCED: 'advanced',
  SETTINGS_PROFILE: 'profile',
  SETTINGS_THEME: 'theme',
  SETTINGS_LANGUAGE: 'language',
  SETTINGS_NOTIFICATIONS: 'notifications',
  SETTINGS_PASSKEYS: 'passkeys',
  // ============ Auth ============
  NSEC_INPUT: 'nsec-input',
  // ============ Reports ============
  REPORT_TYPE_BADGE: 'report-type-badge',
  ```

**Delete `buttonTestIdMap` and `sectionTestIdMap`:**

- [ ] In `tests/steps/common/interaction-steps.ts`:
  - Delete the `buttonTestIdMap` constant (lines 16–46)
  - Update `clickByTextOrTestId` to look up `TestIds` directly for each known label, or use the fallback role-based lookup without the map — since `TestIds` is already imported, reference `TestIds.FORM_SAVE_BTN` etc. directly in a type-safe switch/lookup or just rely on the role-based fallback:
    ```typescript
    async function clickByTextOrTestId(page: Page, text: string): Promise<void> {
      // Fall through to role-based lookup — specific steps use TestIds directly
      const button = page.getByRole('button', { name: text }).first()
      if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(button).toBeEnabled({ timeout: Timeouts.ELEMENT })
        await button.click()
        return
      }
      // ... link, tab, text fallbacks unchanged
    }
    ```
  - Delete the `sectionTestIdMap` constant (lines 183–197)
  - Update `I expand the {string} section` to look up `TestIds` directly:
    ```typescript
    When('I expand the {string} section', async ({ page }, sectionName: string) => {
      const sectionTestIds: Record<string, string> = {
        'Custom Note Fields': TestIds.SETTINGS_CUSTOM_FIELDS,
        'Custom Fields': TestIds.SETTINGS_CUSTOM_FIELDS,
        'Telephony': TestIds.SETTINGS_TELEPHONY,
        // ... use TestIds constants, not raw strings
      }
      const testId = sectionTestIds[sectionName]
      // ... rest of implementation
    })
    ```

- [ ] In `tests/steps/common/assertion-steps.ts`, find and remove the duplicate logout/button label mappings (lines 12–14 per spec), replacing with direct `TestIds.LOGOUT_BTN` references.

**Fix banned selectors:**

- [ ] **`tests/steps/admin/desktop-admin-steps.ts:85`** — `[data-settings-section]`: Replace with `page.getByTestId(TestIds.TELEPHONY_PROVIDER)` (already defined in `TestIds`)
- [ ] **`tests/steps/admin/desktop-admin-steps.ts:208`** — `.cursor-pointer`: Replace with the section header's `data-testid` trigger. The section uses an accordion pattern — find the `[data-testid="telephony"] button` or add `data-testid="settings-section-trigger"` to the accordion trigger in the component.
- [ ] **`tests/steps/common/interaction-steps.ts:212`** — `.cursor-pointer` inside `I expand the {string} section`: Replace with `el.getByRole('button').first().click()` or `el.locator('[data-testid="section-trigger"]').click()` after adding `data-testid="section-trigger"` to accordion triggers in settings components.
- [ ] **`tests/steps/crypto/crypto-steps.ts:173`** — `#nsec`: Replace with `page.getByTestId(TestIds.NSEC_INPUT)`. Find the nsec input component (`src/client/components/` — grep for `id="nsec"`) and add `data-testid={TestIds.NSEC_INPUT}` attribute.
- [ ] **`tests/report-types.spec.ts:109`** — `button[type="button"]` and `.text-\\[10px\\]`: Add `data-testid="report-type-badge"` to the badge element in the report card component. Replace selector with `page.getByTestId(TestIds.REPORT_TYPE_BADGE)`.
- [ ] **`tests/records-architecture.spec.ts:195`** — `[data-testid="custom-fields"] h3`: Find the h3 heading and add `data-testid="custom-fields-heading"` to it, then update the selector.
- [ ] **`tests/steps/common/interaction-steps.ts:294`** — `.text-destructive`: Replace with `page.getByTestId(TestIds.ERROR_MESSAGE)` — `TestIds.ERROR_MESSAGE = 'error-message'` is already defined.

- [ ] Grep for any remaining banned patterns: `grep -rn "\.cursor-pointer\|\.text-destructive\|#nsec\|#cms-toggle\|#report-types\|button\[type\|\.text-\\\[" tests/` — fix any that remain.
- [ ] Commit: `git commit -m "refactor(tests): consolidate to single TestIds registry, delete buttonTestIdMap/sectionTestIdMap, fix banned selectors"`

---

### Task 7: Delete Vacuous Tests and Implement Empty Steps

**Files:**
- Delete: `tests/epic-24-27.spec.ts`
- Modify: `tests/steps/admin/desktop-admin-steps.ts` — implement or delete 6 empty-body steps
- Modify: `tests/report-types.spec.ts` — rewrite lines 100–115
- Modify: `tests/records-architecture.spec.ts` — rewrite lines 250–271
- Create: `packages/test-specs/features/platform/desktop/settings/` — migrate 1 real behavioral test from `epic-24-27.spec.ts`

**Delete `epic-24-27.spec.ts`:**

- [ ] Before deleting, identify the two real behavioral tests to migrate:
  1. `settings toggle shows confirmation dialog` — a settings toggle triggering a confirmation dialog
  2. `command palette opens with Ctrl+K` — keyboard shortcut opens a command palette
  Both belong in BDD feature files, not in a file named after epic numbers.
- [ ] For `settings toggle shows confirmation dialog`: check `packages/test-specs/features/admin/settings.feature` or `packages/test-specs/features/platform/desktop/settings/` — if no matching scenario exists, create one with `@desktop` tag and proper `data-testid` selectors (not positional `.last()` locators)
- [ ] For `command palette opens with Ctrl+K`: check `packages/test-specs/features/platform/desktop/` for an existing keyboard/shortcut feature file — if none exists, create `packages/test-specs/features/platform/desktop/misc/command-palette.feature` with a `@desktop` scenario that presses `Control+k` and asserts the command palette is visible via a `data-testid`
- [ ] Delete `tests/epic-24-27.spec.ts`

**Empty-body step definitions in `tests/steps/admin/desktop-admin-steps.ts`:**

- [ ] **Lines 143–145** — `Given('a call with a recording exists', ...)`: Either:
  - Implement: use `page.request.post(...)` to create a call record with a recording flag via API, OR
  - Delete this step and its Gherkin line from `features/desktop/calls/call-recording.feature` if the behavior cannot be tested without real telephony infrastructure
- [ ] **Lines 147–149** — `Given('a call without a recording exists', ...)`: Same decision as above.
- [ ] **Lines 168–170** — `Then('the call entry should not show a recording badge', ...)`: Implement with `await expect(page.getByTestId(TestIds.RECORDING_BADGE)).not.toBeVisible()` — this is a real assertion that can fail.
- [ ] **Lines 266–268** — `Given('multiple hubs exist', ...)`: Implement using `createHubViaApi` from Task 1 to create a second hub. Use `page.request` and the admin auth headers.
- [ ] **Lines 295–296** — `When('I switch to a specific hub', ...)`: Implement by clicking the hub selector in the UI and selecting the second option. If no hub selector UI exists, implement via `window.__TEST_SET_ACTIVE_HUB(hubId)`.
- [ ] **Lines 362–370** — `Then('both channels should be marked as selected', ...)`, `Then('other channels should not be selected', ...)`, `Then('the channel should be deselected', ...)`: Implement real assertions using `data-state="checked"` or `aria-pressed="true"` on the channel buttons in the setup wizard. If these assertions cannot be made without knowledge of the internal component structure, add `data-testid="channel-card-{name}"` and `data-selected="true/false"` attributes to the channel cards, then assert on those.

**Rewrite `tests/report-types.spec.ts:100–115`:**

- [ ] Delete the current `test('report card shows report type badge', ...)` test
- [ ] Confirm that `data-testid="report-type-badge"` has been added to the badge element (done in Task 6)
- [ ] Add a deterministic assertion at the end of the `creating report with selected type works` test (or as a separate follow-up test that uses the same report) that asserts `await expect(page.getByTestId(TestIds.REPORT_TYPE_BADGE).first()).toBeVisible()`

**Rewrite `tests/records-architecture.spec.ts:250–271`:**

- [ ] **Lines 250–261** — `reports page only shows reports, not conversations`: Implement real isolation check:
  1. Create a report via `page.request.post('/api/hubs/:hubId/conversations', { type: 'report', ... })`
  2. Navigate to `/reports`
  3. Assert `REPORT_CARD` is visible
  4. Assert `CONVERSATION_ITEM` is not visible (or skip if conversations require telephony — but then delete the test)
- [ ] **Lines 262–271** — `conversations page only shows conversations, not reports`: Same pattern in reverse.
- [ ] If real data isolation testing requires telephony infrastructure not available in the test environment, delete both tests.

- [ ] Commit: `git commit -m "refactor(tests): delete vacuous tests, implement empty-body steps, rewrite non-asserting tests"`

---

### Task 8: Backend Hub Isolation and Final Verification

**Files:**
- Modify: `tests/steps/backend/fixtures.ts` — add `workerHub` fixture for backend tests
- Modify: `tests/steps/backend/common.steps.ts` — use hub-scoped API paths in all requests
- Modify: `playwright.config.ts` — confirm `backend-bdd` is `fullyParallel: true`

**Context:** Backend BDD tests call the API directly via `request` context (no browser). They need hub isolation too. The `apiPost`, `apiGet`, etc. helpers in `tests/api-helpers.ts` take a path string — those paths need to be prefixed with `/hubs/:hubId` for hub-scoped operations.

- [ ] In `tests/steps/backend/fixtures.ts`, add worker-scoped `workerHub` fixture using the same `createHubViaApi` helper from Task 1:
  ```typescript
  export const test = base.extend<
    { scenarioState: ScenarioState },
    { workerHub: string }  // worker-scoped
  >({
    scenarioState: async ({}, use) => {
      await use({ volunteers: [], shiftIds: [], banPhones: [] })
    },
    workerHub: [async ({ playwright }, use, workerInfo) => {
      const backendUrl = process.env.TEST_HUB_URL || 'http://localhost:3000'
      const ctx = await playwright.request.newContext({ baseURL: backendUrl })
      const hubName = `backend-hub-${workerInfo.workerIndex}-${Date.now()}`
      const hubId = await createHubViaApi(ctx, hubName)
      await ctx.dispose()
      await use(hubId)
    }, { scope: 'worker' }],
  })
  ```

- [ ] In `tests/steps/backend/common.steps.ts`, update the `state` object (now `scenarioState`) to include `hubId: string`. Populate it from the `workerHub` fixture in a `Before` hook:
  ```typescript
  Before(async ({ scenarioState, workerHub }) => {
    scenarioState.hubId = workerHub
    // ... reset other state fields
  })
  ```

- [ ] Update all hub-scoped API calls in backend step files to prefix with `/hubs/${scenarioState.hubId}`. For example, creating a volunteer: `POST /hubs/${hubId}/volunteers` instead of `POST /volunteers`. This ensures backend BDD tests operate within the worker's hub, not the global default.

- [ ] Remove the `Given('the server is reset', ...)` step usage from all feature files — this step called `/api/test-reset` to nuke shared state. With hub isolation, tests don't need server resets. If any feature file's `Background:` block starts with `Given the server is reset`, remove that line.

- [ ] Confirm `playwright.config.ts` `backend-bdd` project has `fullyParallel: true`, `workers: 3` (set in Task 5 with a TODO; confirm it's done)

- [ ] Run `bun run test` and verify the suite passes with all 3 projects
- [ ] Run `grep -rn "waitForTimeout" tests/` to confirm 0 occurrences
- [ ] Run `grep -rn "@resets-state" tests/ packages/test-specs/` to confirm 0 occurrences
- [ ] Run `grep -rn "bdd-serial" playwright.config.ts` to confirm the project is deleted
- [ ] Run `grep -n "buttonTestIdMap\|sectionTestIdMap" tests/` to confirm both are deleted
- [ ] Commit: `git commit -m "feat(tests): complete hub isolation for backend BDD — enable fullyParallel backend tests"`

---

### Task 9: Final Cleanup and Success Criteria Verification

**Files:**
- Modify: `tests/helpers.ts` — remove `resetTestState` function if no longer used
- Modify: `tests/steps/backend/shared-state.ts` — delete file if fully migrated (Task 5)

- [ ] Check if `resetTestState` in `tests/helpers.ts:318` is still imported anywhere: `grep -rn "resetTestState" tests/`. If no callers remain, delete the function.
- [ ] Check if `tests/steps/backend/shared-state.ts` has any remaining importers: `grep -rn "shared-state" tests/`. Delete the file if no importers remain.
- [ ] Verify the final success criteria from the spec:

  | Criterion | Verify with |
  |---|---|
  | `waitForTimeout` = 0 | `grep -rn "waitForTimeout" tests/ \| grep -v "^.*\/\/"` |
  | Playwright projects = 3 | Count objects in `projects:` array in `playwright.config.ts` |
  | `bdd-serial` deleted | `grep "bdd-serial" playwright.config.ts` returns empty |
  | `@resets-state` = 0 uses | `grep -rn "@resets-state" packages/test-specs/ tests/` |
  | `buttonTestIdMap` deleted | `grep -rn "buttonTestIdMap" tests/` returns empty |
  | `sectionTestIdMap` deleted | `grep -rn "sectionTestIdMap" tests/` returns empty |
  | `epic-24-27.spec.ts` deleted | `ls tests/epic-24-27.spec.ts` returns error |
  | Empty-body steps = 0 | Review `desktop-admin-steps.ts` manually |
  | CSS class selectors = 0 | `grep -rn "\.cursor-pointer\|\.text-destructive\|\.text-\\\[" tests/` |
  | DOM ID selectors = 0 | `grep -rn "locator('#nsec\|locator('#cms\|locator('#report" tests/` |

- [ ] Run the full suite: `bun run test`
- [ ] Confirm wall-clock time is below the previous baseline
- [ ] Commit: `git commit -m "chore(tests): final cleanup — delete unused helpers, verify all overhaul success criteria"`
