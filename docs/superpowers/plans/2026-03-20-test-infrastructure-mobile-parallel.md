# Test Infrastructure Overhaul + Mobile Parallel Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the desktop BDD/E2E test overhaul (hub-per-worker isolation, zero waitForTimeout, single selector registry, no vacuous tests) and extend hub isolation to iOS XCUITests and Android Cucumber so mobile tests run without global database resets.

**Architecture:** Hub-per-worker isolation uses the existing multi-tenant hub system as a test isolation boundary — each Playwright worker, XCUITest class, and Cucumber scenario creates its own hub via the API and scopes all test data within it. No database resets needed. Mobile tests switch to their test hub via the hub switching implemented in the mobile multi-hub spec.

**Tech Stack:** Playwright + playwright-bdd (desktop), XCTest/XCUITest (iOS), Cucumber-Android/Hilt (Android), Bun backend test server

---

## Current State Assessment

Reading the source files reveals:

**Desktop — largely already implemented (good news):**
- `playwright.config.ts` already has `globalSetup`, 3 projects, `fullyParallel: true`, `workers: 3`
- `tests/steps/fixtures.ts` already has `workerHub` as a worker-scoped fixture via `createHubViaApi`
- `tests/steps/backend/fixtures.ts` already has scenario-scoped `world` + `workerHub` per scenario
- `tests/steps/backend/shared-state.ts` already uses `getState`/`setState` via world — no module-level mutable state
- `tests/steps/admin/admin-flow-steps.ts` already uses `adminWorld` fixture (no module-level `let` vars)
- `tests/test-ids.ts` already has all `SETTINGS_*` entries (`SETTINGS_CUSTOM_FIELDS`, `SETTINGS_TELEPHONY`, etc.)
- `tests/helpers.ts` — `enterPin` and `navigateAfterLogin` already use element waits, no `waitForTimeout`

**Remaining desktop work (confirmed by spec):**
- CSS class selectors still exist in step files (`.cursor-pointer`, `.text-destructive`, etc.)
- DOM ID selectors still exist (`#nsec`, `#cms-toggle`, `#report-types`)
- Empty-body step definitions in `desktop-admin-steps.ts`
- `tests/epic-24-27.spec.ts` — vacuous tests need deletion or migration
- `tests/report-types.spec.ts` and `tests/records-architecture.spec.ts` — weak assertions
- `sectionTestIdMap` still lives in `test-ids.ts` (should move lookup into `interaction-steps.ts` and use `TestIds` directly)
- Remaining `waitForTimeout` calls in `desktop-admin-steps.ts`, `records-architecture.spec.ts`, `report-types.spec.ts`
- `tests/responsive.spec.ts` needs `test.use({ ...devices['Pixel 7'] })` (if `mobile-chromium` project was removed)

**Mobile — not yet implemented:**
- `BaseUITest.swift` still calls `resetServerState()` which hits `/api/test-reset` — no hub isolation
- `APIConnectedUITests.swift` overrides `setUp()` with `resetServerState()` — serial, global reset
- `ScenarioHooks.kt` `@Before(order = 1)` calls `resetServerState()` — global reset per scenario
- `SimulationClient.kt` has no `createTestHub()` method

---

## File Map

**Desktop — files to modify:**
- `tests/helpers.ts` — remove any remaining `waitForTimeout`; add `workerHub` injection helper
- `tests/test-ids.ts` — verify `sectionTestIdMap` usage is correct; `NSEC_INPUT` already present
- `tests/steps/common/interaction-steps.ts` — delete `sectionTestIdMap` local copy (already in `test-ids.ts`); fix CSS selectors
- `tests/steps/common/assertion-steps.ts` — fix `LOGOUT_BTN` duplication if present
- `tests/steps/admin/desktop-admin-steps.ts` — implement 6 empty step definitions; replace `.cursor-pointer`/`[data-settings-section]` selectors; remove remaining `waitForTimeout`
- `tests/steps/crypto/crypto-steps.ts` — replace `#nsec` with `TestIds.NSEC_INPUT`
- `tests/records-architecture.spec.ts` — fix `waitForTimeout`, rewrite weak heading assertions
- `tests/report-types.spec.ts` — fix `waitForTimeout`, rewrite conditional badge assertion
- `tests/responsive.spec.ts` — add `test.use({ ...devices['Pixel 7'] })` if missing
- `tests/bootstrap.spec.ts` — verify it creates own data; remove forced `chromium` dependency if present
- Delete: `tests/epic-24-27.spec.ts`
- Various components: add `data-testid` to elements that currently need CSS-class selectors

**iOS — files to modify:**
- `apps/ios/Tests/UI/Helpers/BaseUITest.swift` — replace `resetServerState()` with `createTestHub()` returning hub ID; update all `launchWithAPI` variants to accept `hubId`
- `apps/ios/Tests/UI/APIConnectedUITests.swift` — update `setUp()` to use hub isolation
- All other iOS test files calling `resetServerState()` — audit via `grep -rn "resetServerState" apps/ios/` and update each caller; expected to find 8 files total with 46 call sites

**Android — files to modify:**
- `apps/android/app/src/androidTest/java/org/llamenos/hotline/steps/ScenarioHooks.kt` — replace `resetServerState()` with `createTestHub()`; store `hubId` for scenario use
- `apps/android/app/src/androidTest/java/org/llamenos/hotline/helpers/SimulationClient.kt` — add `createTestHub()` + `HubResponse` type

---

## Task Structure Rules

Each task:
1. Names the exact files being touched
2. TDD where applicable (for step file changes, run `bun run test:backend:bdd` to verify)
3. Shows exact commands with expected output
4. Commits after each task

Desktop test commands: `bun run test:backend:bdd` (for BDD), `bun run test` (for Playwright E2E), `bun run typecheck`
iOS test commands: `ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17"'`
Android test commands: `cd apps/android && ./gradlew testDebugUnitTest`

---

## Phase 1: Desktop Playwright Config Audit + Responsive Fix

### Task 1 — Verify playwright.config.ts is correct; fix responsive.spec.ts

**Files:** `playwright.config.ts`, `tests/responsive.spec.ts`

The config already has `globalSetup`, 3 projects, and `workerHub`. This task audits the current state and applies any remaining fixes.

- [ ] Read `tests/responsive.spec.ts` to check whether `test.use({ ...devices['Pixel 7'] })` is present at the top. If the `mobile-chromium` project is absent from `playwright.config.ts` (it is — confirmed above) but `responsive.spec.ts` lacks the `test.use` directive, the responsive tests run without mobile emulation.

- [ ] If `test.use` is missing, add it at the top of `responsive.spec.ts`:

```typescript
import { test, expect, devices } from '@playwright/test'

test.use({ ...devices['Pixel 7'] })

// ... rest of file unchanged
```

- [ ] Read `tests/bootstrap.spec.ts` to confirm it creates its own test data and does not depend on another project completing first (no `dependencies:` in config, so this should be fine already).

- [ ] Run typecheck to confirm no issues introduced:

```bash
bun run typecheck
```

Expected: `0 errors`

- [ ] Commit:

```bash
git add tests/responsive.spec.ts
git commit -m "test(desktop): add Pixel 7 device emulation to responsive.spec.ts"
```

---

## Phase 2: waitForTimeout Elimination (Desktop)

### Task 2 — Audit and remove all remaining waitForTimeout calls

**Files:** `tests/steps/admin/desktop-admin-steps.ts`, `tests/records-architecture.spec.ts`, `tests/report-types.spec.ts`, `tests/steps/common/interaction-steps.ts`

The spec identifies specific locations. First audit what actually remains:

- [ ] Find all remaining `waitForTimeout` calls:

```bash
grep -rn "waitForTimeout" tests/ --include="*.ts"
```

Expected output will show lines in `desktop-admin-steps.ts`, `records-architecture.spec.ts`, `report-types.spec.ts`, and possibly `interaction-steps.ts`.

- [ ] For each occurrence in `desktop-admin-steps.ts` that follows a navigation click (e.g., `Hub Settings`, `Call History`), replace with a wait for the primary page element. The pattern is:

**Before:**
```typescript
await page.waitForTimeout(Timeouts.ASYNC_SETTLE)
```

**After (Hub Settings click):**
```typescript
await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.ELEMENT })
```

**After (Call History click):**
```typescript
await expect(
  page.getByTestId(TestIds.CALL_LIST).or(page.getByTestId(TestIds.EMPTY_STATE))
).toBeVisible({ timeout: Timeouts.ELEMENT })
```

Apply this pattern for every `waitForTimeout` in `desktop-admin-steps.ts`. The element to wait for is always the primary content element of the route that was just navigated to — use `TestIds.PAGE_TITLE` as the default when no more specific element is available.

- [ ] In `tests/records-architecture.spec.ts`, replace `waitForTimeout(1500)` after sending a reply:

**Before:**
```typescript
await page.waitForTimeout(1500)
```

**After:**
```typescript
await expect(
  page.getByTestId(TestIds.NOTE_REPLY_BTN).first()
).toContainText(/1 repl/i, { timeout: Timeouts.API })
```

For any other `waitForTimeout` occurrences in that file (e.g., after sending other API operations), apply the same principle: identify the state indicator proving the operation completed, then assert on it.

- [ ] In `tests/report-types.spec.ts`, replace `waitForTimeout(2000)`:

**Before:**
```typescript
await page.waitForTimeout(2000)
const badges = page.locator('button[type="button"]').first().locator('.text-\\[10px\\]')
if (await badges.count() > 0) {
  const badgeText = await badges.first().textContent()
  expect(badgeText?.trim().length).toBeGreaterThan(0)
}
```

**After** (see Task 9 for the full selector fix — for now just fix the sleep):
```typescript
await expect(
  page.getByTestId(TestIds.REPORT_TYPE_BADGE).first()
    .or(page.getByTestId(TestIds.EMPTY_STATE))
).toBeVisible({ timeout: Timeouts.ELEMENT })
```

- [ ] Verify zero `waitForTimeout` remain:

```bash
grep -rn "waitForTimeout" tests/ --include="*.ts"
```

Expected: **empty output**

- [ ] Run typecheck:

```bash
bun run typecheck
```

- [ ] Commit:

```bash
git add tests/steps/admin/desktop-admin-steps.ts tests/records-architecture.spec.ts tests/report-types.spec.ts tests/steps/common/interaction-steps.ts
git commit -m "test(desktop): eliminate all waitForTimeout — replace with element waits"
```

---

## Phase 3: Selector Consolidation (Desktop)

### Task 3 — Move sectionTestIdMap out of test-ids.ts into interaction-steps.ts; fix LOGOUT_BTN duplication

**Files:** `tests/test-ids.ts`, `tests/steps/common/interaction-steps.ts`, `tests/steps/common/assertion-steps.ts`

The `sectionTestIdMap` currently lives in `tests/test-ids.ts` (lines 311–330). The spec says step files should look up `TestIds` directly rather than maintaining a parallel map. The map in `test-ids.ts` is fine as a helper; the issue is if a duplicate copy exists in step files or if `assertion-steps.ts` re-declares `LOGOUT_BTN` mappings.

- [ ] Read `tests/steps/common/assertion-steps.ts` fully to confirm whether it redeclares a `LOGOUT_BTN` map or any other TestId mapping that duplicates what is in `test-ids.ts`.

- [ ] If `assertion-steps.ts` contains a local `buttonTestIdMap` or equivalent that maps `'Log Out'`/`'Logout'` to `TestIds.LOGOUT_BTN`, remove that local map and import `TestIds.LOGOUT_BTN` directly:

```typescript
// Before (in assertion-steps.ts):
const logoutMap: Record<string, string> = {
  'Log Out': TestIds.LOGOUT_BTN,
  'Logout': TestIds.LOGOUT_BTN,
}

// After:
// (no local map — use TestIds.LOGOUT_BTN directly in the step body)
Then('I should be logged out', async ({ page }) => {
  await expect(page.getByTestId(TestIds.LOGOUT_BTN)).not.toBeVisible()
})
```

- [ ] Read `tests/steps/common/interaction-steps.ts` (full file) to check whether it has a local `sectionTestIdMap` or `buttonTestIdMap` that duplicates what is in `test-ids.ts`. The spec says both maps should be deleted from step files and `TestIds` used directly.

- [ ] If `interaction-steps.ts` contains a local `sectionTestIdMap`, delete it. The `I expand the {string} section` step should look up `TestIds` via the `sectionTestIdMap` exported from `test-ids.ts`:

```typescript
// In interaction-steps.ts — import sectionTestIdMap from the registry:
import { TestIds, navTestIdMap, sectionTestIdMap } from '../../test-ids'

When('I expand the {string} section', async ({ page }, sectionName: string) => {
  const testId = sectionTestIdMap[sectionName]
  if (!testId) throw new Error(`Unknown section: "${sectionName}". Add it to sectionTestIdMap in test-ids.ts`)
  const trigger = page.getByTestId(`${testId}-trigger`)
  await trigger.click()
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: Timeouts.ELEMENT })
})
```

- [ ] Run typecheck:

```bash
bun run typecheck
```

- [ ] Run backend BDD to confirm nothing regressed:

```bash
bun run test:backend:bdd
```

Expected: same pass count as before (598+ scenarios passing)

- [ ] Commit:

```bash
git add tests/test-ids.ts tests/steps/common/interaction-steps.ts tests/steps/common/assertion-steps.ts
git commit -m "test(desktop): consolidate sectionTestIdMap to test-ids.ts; fix LOGOUT_BTN duplication"
```

---

### Task 4 — Replace CSS/DOM/position selectors with data-testid

**Files:** `tests/steps/admin/desktop-admin-steps.ts`, `tests/steps/common/interaction-steps.ts`, `tests/steps/crypto/crypto-steps.ts`, `tests/report-types.spec.ts`, `tests/records-architecture.spec.ts`, plus corresponding component source files

This is the highest-value selector cleanup. The banned patterns from the spec, with their replacements:

#### 4a: `#nsec` → `data-testid="nsec-input"`

**File:** `tests/steps/crypto/crypto-steps.ts` (lines 173, 252)

`TestIds.NSEC_INPUT = 'nsec-input'` already exists. The component must expose this `data-testid`.

- [ ] Find the component that renders the nsec input:

```bash
grep -rn "id=\"nsec\"" src/ --include="*.tsx" --include="*.ts"
```

- [ ] Add `data-testid="nsec-input"` to the `<input>` element in the component (alongside or replacing `id="nsec"`).

- [ ] In `crypto-steps.ts`, replace:

```typescript
// Before:
const nsecInput = page.locator('#nsec')

// After:
const nsecInput = page.getByTestId(TestIds.NSEC_INPUT)
```

#### 4b: `#cms-toggle` → `data-testid="cms-toggle"`

- [ ] Find the component rendering the CMS toggle:

```bash
grep -rn "id=\"cms-toggle\"" src/ --include="*.tsx"
```

- [ ] Add `data-testid={TestIds.SETTINGS_CMS_TOGGLE}` to the element. `TestIds.SETTINGS_CMS_TOGGLE = 'cms-toggle'` already exists.

- [ ] Replace `#cms-toggle` references in test files:

```typescript
// Before:
page.locator('#cms-toggle')

// After:
page.getByTestId(TestIds.SETTINGS_CMS_TOGGLE)
```

#### 4c: `#report-types` → `data-testid="report-types"`

- [ ] Find the component:

```bash
grep -rn "id=\"report-types\"" src/ --include="*.tsx"
```

- [ ] Add `data-testid={TestIds.SETTINGS_REPORT_TYPES}` to the element. `TestIds.SETTINGS_REPORT_TYPES = 'report-types'` already exists.

- [ ] Replace `#report-types` references in test files with `page.getByTestId(TestIds.SETTINGS_REPORT_TYPES)`.

#### 4d: `.cursor-pointer` → data-testid on the trigger element

**Files:** `desktop-admin-steps.ts` (line 208), `interaction-steps.ts` (line 212)

These clicks target settings section expand triggers. The `sectionTestIdMap` now maps section names to their `data-testid`. The trigger convention is `{sectionId}-trigger`.

- [ ] In `desktop-admin-steps.ts`, replace the `.cursor-pointer` click:

```typescript
// Before:
await page.locator('.cursor-pointer').first().click()

// After — look up the section from the step parameter:
await page.getByTestId(`${TestIds.SETTINGS_TELEPHONY}-trigger`).click()
// (or whatever specific section this step is expanding)
```

- [ ] In `interaction-steps.ts`, same fix — the `I expand the {string} section` step should already use `{testId}-trigger` after Task 3.

#### 4e: `[data-settings-section]` → `data-testid` (all 12 occurrences in 7 files)

- [ ] Find ALL occurrences of `[data-settings-section]` across the test and source trees:

```bash
grep -rn "\[data-settings-section\]" tests/ src/ --include="*.ts" --include="*.tsx"
```

Expected: ~12 occurrences across ~7 files.

- [ ] For EVERY occurrence in test files, replace with `getByTestId(TestIds.SETTINGS_SECTION)`:

```typescript
// Before (any test file):
page.locator('[data-settings-section]').first()
page.locator('[data-settings-section]').nth(2)
await page.locator('[data-settings-section]').count()

// After:
page.getByTestId(TestIds.SETTINGS_SECTION).first()
page.getByTestId(TestIds.SETTINGS_SECTION).nth(2)
await page.getByTestId(TestIds.SETTINGS_SECTION).count()
```

- [ ] For each component source file that currently uses `data-settings-section` as an attribute, add `data-testid="settings-section"` alongside it (do NOT remove `data-settings-section` if it serves a non-test purpose):

```tsx
// Before:
<div data-settings-section="telephony" ...>

// After:
<div data-settings-section="telephony" data-testid="settings-section" ...>
```

- [ ] Verify zero `[data-settings-section]` remain in test files:

```bash
grep -rn "\[data-settings-section\]" tests/ --include="*.ts" | wc -l
```

Expected: `0`

#### 4f: `.text-destructive` → `data-testid="error-message"` or `getByRole('alert')`

**File:** `interaction-steps.ts` (line 294)

- [ ] Replace:

```typescript
// Before:
await expect(page.locator('.text-destructive')).toBeVisible()

// After:
await expect(
  page.getByTestId(TestIds.ERROR_MESSAGE).or(page.getByRole('alert'))
).toBeVisible({ timeout: Timeouts.ELEMENT })
```

#### 4g: `button[type="button"]` + `.text-\[10px\]` → `data-testid="report-type-badge"`

**File:** `tests/report-types.spec.ts` (already updated in Task 2 to use `TestIds.REPORT_TYPE_BADGE`)

- [ ] Confirm the component that renders report type badges has `data-testid="report-type-badge"`:

```bash
grep -rn "report-type-badge" src/ --include="*.tsx"
```

- [ ] If missing, add `data-testid="report-type-badge"` to the badge element in the report card component.

#### 4h: `[data-testid="custom-fields"] h3` → specific child testid

**File:** `tests/records-architecture.spec.ts` (line 195)

- [ ] Replace positional descendant selector:

```typescript
// Before:
page.locator('[data-testid="custom-fields"] h3')

// After:
page.getByTestId(TestIds.CUSTOM_FIELD_SECTION).getByRole('heading', { level: 3 })
// Or better — add data-testid="custom-fields-heading" to the h3 in the component
page.getByTestId('custom-fields-heading')
```

#### 4i: `dateInputs.first()` and `dateInputs.nth(1)` in call-steps

**File:** `tests/steps/calls/call-steps.ts` (lines 125–126)

- [ ] Read this section of `call-steps.ts` to understand what the two date inputs are (start date, end date). Add `data-testid="call-filter-start-date"` and `data-testid="call-filter-end-date"` to the components.

- [ ] Replace position-based selectors:

```typescript
// Before:
const dateInputs = page.locator('input[type="date"]')
await dateInputs.first().fill(startDate)
await dateInputs.nth(1).fill(endDate)

// After:
await page.getByTestId('call-filter-start-date').fill(startDate)
await page.getByTestId('call-filter-end-date').fill(endDate)
```

- [ ] Run typecheck:

```bash
bun run typecheck
```

- [ ] Verify no banned selectors remain:

```bash
grep -rn "\.cursor-pointer\|\.text-destructive\|\.text-\\\[10px\\\]\|button\[type=\"button\"\]\|#nsec\|#cms-toggle\|#report-types\|\[data-settings-section\]" tests/ --include="*.ts"
```

Expected: empty output

- [ ] Commit:

```bash
git add tests/steps/admin/desktop-admin-steps.ts tests/steps/common/interaction-steps.ts tests/steps/crypto/crypto-steps.ts tests/report-types.spec.ts tests/records-architecture.spec.ts tests/steps/calls/call-steps.ts src/
git commit -m "test(desktop): replace all CSS/DOM/position selectors with data-testid"
```

---

**Phase 3 checkpoint — run full desktop E2E suite:**

```bash
bun run test
```

Expected: all tests pass with zero `waitForTimeout` and zero CSS class selector failures.

---

## Phase 4: Delete Vacuous Tests (Desktop)

### Task 5 — Delete tests/epic-24-27.spec.ts; migrate behavioral tests to BDD

**Files:** `tests/epic-24-27.spec.ts`, `packages/test-specs/features/desktop/settings/settings-toggle.feature` (new)

- [ ] Read `tests/epic-24-27.spec.ts` in full to identify which tests contain real behavioral assertions worth preserving.

Based on the spec analysis:
- `sidebar shows shift status indicator` — vacuous text-match; **delete**
- `dashboard shows calls today metric` — vacuous text-exist check; **delete**
- `command palette opens with Ctrl+K` — real behavioral test; **migrate to BDD**
- `voice prompts card shows prompt types` — vacuous text-exist check; **delete**
- `settings toggle shows confirmation dialog` — real behavioral test; **migrate to BDD**

- [ ] Create a new BDD feature file for the two real behavioral tests:

**`packages/test-specs/features/desktop/settings/settings-toggle.feature`:**

```gherkin
@desktop
Feature: Settings toggle confirmation dialogs
  Admins confirm before toggling destructive settings
  to prevent accidental changes to live system configuration.

  Background:
    Given I am logged in as admin

  Scenario: Toggling a live setting shows a confirmation dialog
    When I navigate to the "Hub Settings" page
    And I expand the "Spam Mitigation" section
    And I click the spam mitigation toggle
    Then I should see a confirmation dialog
    And I can cancel without applying the change

  Scenario: Command palette opens with keyboard shortcut
    When I press "Control+k"
    Then I should see the command palette
    And it should be focusable and searchable
```

- [ ] Implement any missing step definitions for these new scenarios in the appropriate step file (`tests/steps/settings/` or `tests/steps/common/`). The `confirm-dialog` and `confirm-dialog-cancel` TestIds already exist.

- [ ] Delete `tests/epic-24-27.spec.ts`:

```bash
rm tests/epic-24-27.spec.ts
```

- [ ] Run typecheck and BDD codegen to confirm the new feature file is valid:

```bash
bun run typecheck
bun run test:backend:bdd 2>&1 | tail -5
```

- [ ] Commit:

```bash
git add packages/test-specs/features/desktop/settings/settings-toggle.feature tests/steps/
git rm tests/epic-24-27.spec.ts
git commit -m "test(desktop): delete vacuous epic-24-27 tests; migrate real behavioral tests to BDD"
```

---

### Task 6 — Implement or delete empty step definitions in desktop-admin-steps.ts

**Files:** `tests/steps/admin/desktop-admin-steps.ts`, `packages/test-specs/features/desktop/admin/*.feature`

The spec identifies 6+ empty step bodies. Read the file to find current state:

- [ ] Read `tests/steps/admin/desktop-admin-steps.ts` in full, noting all step definitions with empty or comment-only bodies.

For each empty step, apply one of two approaches:

**Approach A — Implement the step (preferred):**

If the step represents a real user action or assertion, implement it fully. Below are the implementations for each confirmed empty step:

**`Given('a call with a recording exists')`** — create a simulated call via test API, then simulate it going to voicemail (which generates a recording placeholder):

```typescript
Given('a call with a recording exists', async ({ request, workerHub }) => {
  const response = await request.post('/api/test-simulate/incoming-call', {
    data: { callerNumber: '+15551230001', hubId: workerHub },
    headers: { 'X-Test-Secret': process.env.E2E_TEST_SECRET ?? 'test-reset-secret' },
  })
  expect(response.ok()).toBeTruthy()
  const { callId } = await response.json() as { callId: string }
  const vmRes = await request.post('/api/test-simulate/voicemail', {
    data: { callId },
    headers: { 'X-Test-Secret': process.env.E2E_TEST_SECRET ?? 'test-reset-secret' },
  })
  expect(vmRes.ok()).toBeTruthy()
})
```

**`Given('a call without a recording exists')`** — create and answer a call (answered calls don't generate recordings):

```typescript
Given('a call without a recording exists', async ({ request, workerHub }) => {
  const response = await request.post('/api/test-simulate/incoming-call', {
    data: { callerNumber: '+15551230002', hubId: workerHub },
    headers: { 'X-Test-Secret': process.env.E2E_TEST_SECRET ?? 'test-reset-secret' },
  })
  expect(response.ok()).toBeTruthy()
  // Answered calls produce no recording — leave it unanswered but not voicemailed
})
```

**`Then('the call entry should not show a recording badge')`** — assert the badge is absent:

```typescript
Then('the call entry should not show a recording badge', async ({ page }) => {
  await expect(
    page.getByTestId(TestIds.CALL_LIST).getByTestId(TestIds.RECORDING_BADGE).first()
  ).not.toBeVisible({ timeout: Timeouts.ELEMENT })
})
```

**`Given('multiple hubs exist')`** — create two hubs via API:

```typescript
Given('multiple hubs exist', async ({ request }) => {
  const ts = Date.now()
  for (const name of [`extra-hub-a-${ts}`, `extra-hub-b-${ts}`]) {
    const res = await request.post('/api/hubs', {
      data: { name },
      headers: { Authorization: `Bearer ${ADMIN_AUTH_HEADER}` },
    })
    expect(res.ok()).toBeTruthy()
  }
})
```

Note: `ADMIN_AUTH_HEADER` must be obtained via the same mechanism as other admin-authenticated API calls in the desktop step files. Check `tests/api-helpers.ts` for the admin auth pattern.

**`When('I switch to a specific hub')`** — click the first hub in the hub switcher:

```typescript
When('I switch to a specific hub', async ({ page }) => {
  const hubSwitcher = page.getByTestId(TestIds.NAV_ADMIN_HUBS)
  await hubSwitcher.click()
  // Wait for hub list to appear and click the first non-active hub
  const hubRows = page.getByTestId('hub-row')
  await expect(hubRows.first()).toBeVisible({ timeout: Timeouts.ELEMENT })
  await hubRows.first().click()
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible({ timeout: Timeouts.NAVIGATION })
})
```

**`Then('both channels should be marked as selected')` / `Then('other channels should not be selected')` / `Then('the channel should be deselected')`** — assert channel toggle states:

```typescript
Then('both channels should be marked as selected', async ({ page }) => {
  // Each channel item has data-testid="channel-item" with aria-checked or data-selected
  const channels = page.getByTestId('channel-item')
  const count = await channels.count()
  for (let i = 0; i < count; i++) {
    await expect(channels.nth(i)).toHaveAttribute('data-selected', 'true')
  }
})

Then('other channels should not be selected', async ({ page }) => {
  // After selecting one channel, verify the rest are deselected
  const channels = page.getByTestId('channel-item')
  const count = await channels.count()
  let selectedCount = 0
  for (let i = 0; i < count; i++) {
    const selected = await channels.nth(i).getAttribute('data-selected')
    if (selected === 'true') selectedCount++
  }
  expect(selectedCount).toBe(1)
})

Then('the channel should be deselected', async ({ page }) => {
  const activeChannel = page.getByTestId('channel-item').filter({ hasAttribute: 'data-selected' })
  await expect(activeChannel).toHaveCount(0, { timeout: Timeouts.ELEMENT })
})
```

**Approach B — Delete the step + its Gherkin line (when the behavior cannot be meaningfully tested):**

If the channel toggle steps require UI that does not have the `data-selected` attribute, and adding that attribute is out of scope, delete these step definitions **and** the corresponding `Then` lines from the `.feature` file. An absent scenario is better than an always-passing scenario.

- [ ] For each step: either fully implement or delete the step + matching Gherkin. Do not leave empty bodies.

- [ ] Run BDD to confirm all implemented steps pass and no "undefined step" errors appear:

```bash
bun run test:backend:bdd
```

- [ ] Commit:

```bash
git add tests/steps/admin/desktop-admin-steps.ts packages/test-specs/features/desktop/admin/
git commit -m "test(desktop): implement 6 empty step definitions in desktop-admin-steps.ts"
```

---

### Task 7 — Rewrite weak assertions in report-types.spec.ts and records-architecture.spec.ts

**Files:** `tests/report-types.spec.ts`, `tests/records-architecture.spec.ts`

#### 7a: `tests/report-types.spec.ts:100-115`

The conditional `if (await badges.count() > 0)` pattern must become an unconditional assertion. The preceding test creates a report with a type — this test should assert that badge is visible:

- [ ] Read the full `test('report card shows report type badge')` test. Identify the report created in the preceding test. If the tests are independent (not using `test.describe.configure({ mode: 'serial' })`), this test must create its own data:

```typescript
test('report card shows report type badge', async ({ page, workerHub }) => {
  // This test depends on a report with a type having been created.
  // Either:
  // A) Run it after 'creating report with selected type works' in a serial suite, or
  // B) Create report data directly via API here.

  // Option B (preferred — no serial dependency):
  // Use backendRequest to POST a report with a known type via API
  // then navigate to the reports list and assert the badge

  await navigateAfterLogin(page, '/reports')
  const badge = page.getByTestId(TestIds.REPORT_TYPE_BADGE).first()
  await expect(badge).toBeVisible({ timeout: Timeouts.API })
  // Assert the badge has non-empty text (actual type name, not just existence)
  const badgeText = await badge.textContent()
  expect(badgeText?.trim().length).toBeGreaterThan(0)
})
```

If the report with a type is created in the preceding test in the same `describe` block with `mode: 'serial'`, this is acceptable. Document why:

```typescript
// NOTE: This test depends on 'creating report with selected type works' running first.
// The suite is serial (test.describe.configure({ mode: 'serial' })) so ordering is guaranteed.
test('report card shows report type badge', ...)
```

Either way, the assertion must be unconditional — no `if (count > 0)` guard.

#### 7b: `tests/records-architecture.spec.ts:250-271`

The `h1` heading assertion must be replaced with actual data isolation verification:

- [ ] Read the full tests at lines 250–271. They test that reports and conversations are not cross-contaminated in their respective list pages.

- [ ] Replace with data-creating + data-isolation assertions:

```typescript
test('reports page only shows reports, not conversations', async ({ page, backendRequest, workerHub }) => {
  // Create a report via API so we have known data
  const reportRes = await backendRequest.post(`/api/hubs/${workerHub}/reports`, {
    data: { title: `Isolation Test Report ${Date.now()}`, body: 'test' },
    headers: { Authorization: adminAuthHeader },
  })
  expect(reportRes.ok()).toBeTruthy()

  await navigateAfterLogin(page, '/reports')
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible()

  // Reports list should show report cards
  await expect(
    page.getByTestId(TestIds.REPORT_CARD).first()
      .or(page.getByTestId(TestIds.EMPTY_STATE))
  ).toBeVisible({ timeout: Timeouts.API })

  // Conversation items must NOT appear on the reports page
  await expect(page.getByTestId(TestIds.CONVERSATION_ITEM)).not.toBeVisible()
})

test('conversations page only shows conversations, not reports', async ({ page }) => {
  await navigateAfterLogin(page, '/conversations')
  await expect(page.getByTestId(TestIds.PAGE_TITLE)).toBeVisible()

  // Wait for the conversation list or empty state to render
  await expect(
    page.getByTestId(TestIds.CONVERSATION_LIST)
      .or(page.getByTestId(TestIds.EMPTY_STATE))
  ).toBeVisible({ timeout: Timeouts.API })

  // Report cards must NOT appear on the conversations page
  await expect(page.getByTestId(TestIds.REPORT_CARD)).not.toBeVisible()
})
```

Note: If `backendRequest` is not available in this spec file's fixture, use `page.request` (which uses the baseURL of the Vite preview) and target the backend via an absolute URL, or add the `backendRequest` fixture to this test file's `test` instance.

- [ ] Run typecheck:

```bash
bun run typecheck
```

- [ ] Commit:

```bash
git add tests/report-types.spec.ts tests/records-architecture.spec.ts
git commit -m "test(desktop): replace vacuous conditional assertions with real behavioral checks"
```

---

**Phase 4 checkpoint — run backend BDD and full desktop E2E:**

```bash
bun run test:backend:bdd
```

Expected: 598+ scenarios passing.

```bash
bun run test
```

Expected: all tests pass, no vacuous tests, no empty step definitions.

---

## Phase 5: iOS XCUITest Hub Isolation

### Task 8 — Add createTestHub() to BaseUITest.swift; replace resetServerState()

**Files:** `apps/ios/Tests/UI/Helpers/BaseUITest.swift`

This is the key mobile change. Instead of resetting global server state before each test class, each `XCTestCase` subclass creates its own hub and scopes all data within it.

- [ ] Read `apps/ios/Tests/UI/Helpers/BaseUITest.swift` in full to understand all existing methods and properties.

- [ ] Add the admin auth helpers and `createTestHub()` to `BaseUITest`:

```swift
import XCTest
import Foundation

class BaseUITest: XCTestCase {
    var app: XCUIApplication!

    /// Hub ID created for this test class — set in setUp(), used in all test methods.
    var testHubId: String = ""

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        // Create an isolated hub for this test class — no global reset needed.
        testHubId = createTestHub()
    }

    override func tearDown() {
        app = nil
        super.tearDown()
        // Hub is not deleted — stale test hubs accumulate and are purged separately.
    }

    // MARK: - Hub URL

    var testHubURL: String {
        ProcessInfo.processInfo.environment["TEST_HUB_URL"]
            ?? "http://localhost:3000"
    }

    // MARK: - Hub Isolation

    /// The admin nsec used for test authentication — matches ADMIN_NSEC in global-setup.ts.
    private let adminNsec = "nsec174zsa94n3e7t0ugfldh9tgkkzmaxhalr78uxt9phjq3mmn6d6xas5jdffh"

    /// Create a new isolated hub via the backend API.
    /// Returns the hub ID. Called once per XCTestCase class in setUp().
    ///
    /// Uses the admin Nostr keypair for authentication, matching the same
    /// bootstrap token mechanism used by tests/global-setup.ts.
    func createTestHub() -> String {
        let hubName = "ios-test-\(ProcessInfo.processInfo.processIdentifier)-\(Int(Date().timeIntervalSince1970 * 1000))"

        guard let url = URL(string: "\(testHubURL)/api/hubs") else {
            XCTFail("Invalid test hub URL: \(testHubURL)/api/hubs")
            return ""
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Build admin auth token (same format as makeBootstrapToken in global-setup.ts)
        let authHeader = makeAdminAuthHeader(method: "POST", path: "/api/hubs")
        request.setValue(authHeader, forHTTPHeaderField: "Authorization")

        let body = ["name": hubName]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        var hubId = ""
        let semaphore = DispatchSemaphore(value: 0)

        URLSession.shared.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error = error {
                XCTFail("createTestHub network error: \(error)")
                return
            }
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = json["id"] as? String else {
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? "<no body>"
                XCTFail("createTestHub: unexpected response: \(body)")
                return
            }
            hubId = id
        }.resume()

        _ = semaphore.wait(timeout: .now() + 15)
        XCTAssertFalse(hubId.isEmpty, "createTestHub returned empty hub ID")
        return hubId
    }

    /// Build a Bearer token for admin API calls.
    /// Uses the same llamenos:auth: prefix + Schnorr signature format as the backend.
    ///
    /// NOTE: This requires a Swift implementation of Schnorr signing or the use of
    /// a pre-computed static token. For test purposes, use the X-Test-Admin header
    /// if the backend supports it, or the bootstrap token approach.
    ///
    /// Implementation options (choose one):
    /// A) Add `X-Test-Admin: <adminPubkey>` header support to POST /api/hubs in dev mode
    /// B) Use a long-lived test JWT pre-generated from the admin nsec
    /// C) Add a `POST /api/test-admin-token` endpoint that returns a short-lived token
    ///
    /// For now, use Option A — the backend already has X-Test-Secret for test endpoints.
    /// Add X-Test-Admin support to hub creation in dev mode.
    private func makeAdminAuthHeader(method: String, path: String) -> String {
        // Use pre-computed admin pubkey and a test-mode header
        // The backend's POST /api/hubs in ENVIRONMENT=development mode accepts:
        // X-Test-Admin: <pubkey>  →  treats the request as authenticated admin
        return "TestAdmin ac4718373d30301e5c7cf55e9e6f2568efb94f3278fb88f37f4981e880505228"
    }

    // MARK: - Launch Helpers

    func launchClean() {
        app.launchArguments.append("--reset-keychain")
        app.launch()
    }

    func launchAuthenticated() {
        app.launchArguments.append(contentsOf: ["--reset-keychain", "--test-authenticated"])
        app.launch()
    }

    func launchAsAdmin() {
        app.launchArguments.append(contentsOf: [
            "--reset-keychain",
            "--test-authenticated",
            "--test-admin",
        ])
        app.launch()
    }

    /// Launch the app connected to the live backend, scoped to testHubId.
    func launchWithAPI() {
        app.launchArguments.append(contentsOf: [
            "--reset-keychain",
            "--test-authenticated",
            "--test-hub-url", testHubURL,
            "--test-hub-id", testHubId,   // NEW: inject hub context
            "--test-register",
        ])
        app.launch()
    }

    /// Launch as admin, scoped to testHubId.
    func launchAsAdminWithAPI() {
        app.launchArguments.append(contentsOf: [
            "--reset-keychain",
            "--test-authenticated",
            "--test-admin",
            "--test-hub-url", testHubURL,
            "--test-hub-id", testHubId,   // NEW: inject hub context
            "--test-register",
        ])
        app.launch()
    }

    // MARK: - BDD-style helpers
    func given(_ description: String, block: () -> Void) { block() }
    func when(_ description: String, block: () -> Void) { block() }
    func then(_ description: String, block: () -> Void) { block() }
}
```

**Backend change required:** The backend's `POST /api/hubs` endpoint (and potentially other hub-creation paths) must accept a test-mode authentication method in `ENVIRONMENT=development`. Add support for `Authorization: TestAdmin <pubkey>` header to trust admin requests in dev/test without requiring a full Schnorr signature.

Alternatively, add `POST /api/test-create-hub` to `apps/worker/routes/dev.ts` alongside the existing test simulation endpoints. This is the cleanest approach — no auth changes needed:

**`apps/worker/routes/dev.ts` addition:**
```typescript
// POST /api/test-create-hub — create an isolated test hub (dev/test mode only)
dev.post('/test-create-hub', requireTestSecret, async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  const hub = await hubService.createHub({ name: name ?? `test-hub-${Date.now()}` })
  return c.json({ id: hub.id, name: hub.name })
})
```

Then in `BaseUITest.swift`, call `/api/test-create-hub` with `X-Test-Secret` header instead of `/api/hubs` with auth:

```swift
func createTestHub() -> String {
    let hubName = "ios-test-\(Int(Date().timeIntervalSince1970 * 1000))"
    guard let url = URL(string: "\(testHubURL)/api/test-create-hub") else {
        XCTFail("Invalid URL"); return ""
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(testSecret, forHTTPHeaderField: "X-Test-Secret")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["name": hubName])

    var hubId = ""
    let semaphore = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { data, _, _ in
        defer { semaphore.signal() }
        if let data,
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let id = json["id"] as? String {
            hubId = id
        }
    }.resume()
    _ = semaphore.wait(timeout: .now() + 15)
    return hubId
}

private var testSecret: String {
    ProcessInfo.processInfo.environment["E2E_TEST_SECRET"] ?? "test-reset-secret"
}
```

- [ ] Implement `POST /api/test-create-hub` in `apps/worker/routes/dev.ts`.

- [ ] Update `BaseUITest.swift` with the full `createTestHub()` implementation using `/api/test-create-hub`.

- [ ] Remove the `resetServerState()` method from `BaseUITest.swift` entirely (or deprecate with a fatal assertion to catch any remaining callers).

- [ ] Build to confirm no Swift compile errors:

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild build -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | tail -20'
```

Expected: `BUILD SUCCEEDED`

- [ ] Commit:

```bash
git add apps/ios/Tests/UI/Helpers/BaseUITest.swift apps/worker/routes/dev.ts
git commit -m "test(ios): replace resetServerState() with createTestHub() hub isolation"
```

---

### Task 9 — Update APIConnectedUITests.swift to use hub isolation

**Files:** `apps/ios/Tests/UI/APIConnectedUITests.swift`

- [ ] Read the full `APIConnectedUITests.swift` file.

- [ ] Remove the override of `setUp()` that calls `resetServerState()`. The base class `setUp()` now calls `createTestHub()` and sets `testHubId`. Each test method in `APIConnectedUITests` will automatically get an isolated hub via `testHubId`.

```swift
// BEFORE:
override func setUp() {
    super.setUp()
    resetServerState()
}

// AFTER:
// (delete this entire override — the base class setUp() now creates a hub)
```

- [ ] Remove the serial execution override if it was only needed because of shared state:

```swift
// BEFORE:
override class var defaultTestSuite: XCTestSuite {
    let suite = XCTestSuite(forTestCaseClass: self)
    return suite
}

// AFTER:
// (delete this override — tests no longer share state, parallelism is safe)
```

Note: XCTest parallelism within a test class requires explicit opt-in via `XCTestCase` subclass configuration. Removing the serial override doesn't automatically enable parallelism — but it removes the artificial serialization. Xcode's test parallelism is controlled at the scheme level.

- [ ] Verify any call simulation tests pass the `testHubId` to simulation endpoints that require it. The `simulateIncomingCall` in `BaseUITest.swift` (if it exists) should include `hubId: testHubId` in the request body.

- [ ] Build and run iOS tests:

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" -testPlan LlamenosTests 2>&1 | tail -30'
```

Expected: all previously-passing tests still pass (no regressions from removing the reset)

- [ ] Commit:

```bash
git add apps/ios/Tests/UI/APIConnectedUITests.swift
git commit -m "test(ios): remove serial execution and per-test resetServerState() — use hub isolation"
```

---

### Task 9b — Audit and update all remaining iOS test files calling resetServerState()

**Files:** All iOS test files with `resetServerState()` calls beyond `BaseUITest.swift` and `APIConnectedUITests.swift`

- [ ] Find all remaining callers:

```bash
grep -rn "resetServerState" apps/ios/ --include="*.swift"
```

Expected: approximately 6 additional files with a total of ~44 additional call sites (46 total across all files, minus the 2 already fixed in Tasks 8 and 9).

- [ ] For each file found:
  1. Remove the `resetServerState()` call from `setUp()` (or wherever it appears)
  2. If the test class has its own `setUp()` that calls `super.setUp()` (which now calls `createTestHub()`), no further change needed — the hub is already created
  3. If the test uses `testHubId` (from `BaseUITest`) in simulation calls, ensure `testHubId` is passed to `simulateIncomingCall(hubId:)` etc.
  4. If the test had a custom `resetServerState()` override (not from base), delete it entirely

- [ ] Verify zero `resetServerState` calls remain in iOS:

```bash
grep -rn "resetServerState" apps/ios/ --include="*.swift" | wc -l
```

Expected: `0`

- [ ] Build to confirm no compile errors:

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild build -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | grep -E "error:|BUILD"'
```

Expected: `BUILD SUCCEEDED`

- [ ] Commit:

```bash
git add apps/ios/Tests/
git commit -m "test(ios): remove all resetServerState() calls from iOS test suite — hub isolation complete"
```

---

## Phase 6: Android Cucumber Hub Isolation

### Task 10 — Add createTestHub() to SimulationClient.kt

**Files:** `apps/android/app/src/androidTest/java/org/llamenos/hotline/helpers/SimulationClient.kt`

`SimulationClient` already has the `post()` helper and all the infrastructure needed. Adding `createTestHub()` is a small addition:

- [ ] Add the `HubResponse` data class and `createTestHub()` function to `SimulationClient.kt`:

```kotlin
// Add to SimulationClient.kt, in the Response Types section:

@Serializable
data class HubResponse(
    val id: String = "",
    val name: String = "",
    val error: String? = null,
)

// Add to the companion functions section:

/**
 * Create an isolated test hub via the test endpoint.
 *
 * Calls POST /api/test-create-hub with X-Test-Secret header.
 * Returns the new hub's ID. Called once per Cucumber scenario in ScenarioHooks @Before.
 *
 * Hub is NOT deleted after the scenario — stale hubs accumulate and are purged periodically.
 */
fun createTestHub(name: String? = null): HubResponse {
    val hubName = name ?: "android-test-${System.currentTimeMillis()}"
    val body = """{"name":"${escapeJson(hubName)}"}"""
    val responseText = post("/api/test-create-hub", body)
    return json.decodeFromString<HubResponse>(responseText)
}
```

Note: The `post()` function in `SimulationClient` already appends the `X-Test-Secret` header and uses `hubUrl` as the base URL. `POST /api/test-create-hub` will be added to the backend in Task 8 (iOS phase), so no additional backend work is needed here.

- [ ] Run Android unit tests to confirm the Kotlin compiles:

```bash
cd apps/android && ./gradlew compileDebugAndroidTestKotlin
```

Expected: `BUILD SUCCESSFUL`

- [ ] Commit:

```bash
git add apps/android/app/src/androidTest/java/org/llamenos/hotline/helpers/SimulationClient.kt
git commit -m "test(android): add createTestHub() to SimulationClient"
```

---

### Task 11 — Update ScenarioHooks.kt to use hub-per-scenario isolation

**Files:** `apps/android/app/src/androidTest/java/org/llamenos/hotline/steps/ScenarioHooks.kt`

The current `resetServerState()` in `@Before(order = 1)` resets the entire database. Replace it with hub creation:

- [ ] Add a mechanism to store the `hubId` so other step definitions can access it. Cucumber-Android does not have a World object like playwright-bdd — the idiomatic pattern is a shared singleton or a `@Singleton` Hilt component scoped to the test.

The simplest approach that matches the existing codebase (no new Hilt scopes): use a thread-local or object-level `var` in a companion object of `ScenarioHooks`, or use `InstrumentationRegistry.getArguments()` to pass the hub ID via launch argument.

The cleanest approach for step isolation: store `hubId` in a `ScenarioState` object in `ScenarioHooks` and inject it via Hilt into step definitions. But since the existing codebase uses direct instantiation (not Hilt injection) in most step files, use a simpler companion object store:

```kotlin
package org.llamenos.hotline.steps

import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import io.cucumber.java.After
import io.cucumber.java.Before
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.crypto.KeystoreService
import org.llamenos.hotline.helpers.SimulationClient

/**
 * Cucumber hooks for scenario lifecycle management.
 *
 * @Before(order = 0): Grant camera permissions.
 * @Before(order = 1): Create an isolated test hub for this scenario.
 *   Each scenario gets its own hub ID, scoping all test data within it.
 *   No global database reset needed — hub isolation replaces resetServerState().
 * @After: Close activity, wipe local identity.
 */
class ScenarioHooks {

    companion object {
        /**
         * The hub ID created for the current scenario.
         * Set in @Before(order = 1), readable by step definitions via ScenarioHooks.currentHubId.
         *
         * Thread-safe: Cucumber-Android runs scenarios sequentially within a single device,
         * so a single companion object var is safe. If parallelism is added later, replace
         * with a ThreadLocal.
         */
        @Volatile
        var currentHubId: String = ""
            private set
    }

    private val keystoreService = KeystoreService(
        InstrumentationRegistry.getInstrumentation().targetContext
    )
    private val cryptoService = CryptoService()

    @Before(order = 0)
    fun grantPermissions() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val packageName = instrumentation.targetContext.packageName
        try {
            instrumentation.uiAutomation.executeShellCommand(
                "pm grant $packageName android.permission.CAMERA"
            ).close()
        } catch (e: Exception) {
            Log.w("ScenarioHooks", "Camera permission grant failed: ${e.message}")
        }
    }

    /**
     * Create an isolated hub for this scenario.
     * Replaces the previous resetServerState() — no global database wipe.
     * Each scenario gets its own hub, so tests never share data.
     */
    @Before(order = 1)
    fun createScenarioHub() {
        try {
            val response = SimulationClient.createTestHub()
            if (response.id.isNotEmpty()) {
                currentHubId = response.id
                Log.d("ScenarioHooks", "Created test hub: ${response.id} (${response.name})")
            } else {
                Log.w("ScenarioHooks", "createTestHub returned empty ID — error: ${response.error}")
                // Don't fail — allow the scenario to proceed (may use default hub)
            }
        } catch (e: Exception) {
            Log.w("ScenarioHooks", "createTestHub failed: ${e.message}")
            // Best-effort — don't fail the scenario if hub creation fails
        }
    }

    @After(order = 10000)
    fun closeActivity() {
        ComposeRuleHolder.current.activityScenarioHolder.close()
    }

    @After(order = 9000)
    fun clearIdentityState() {
        try {
            keystoreService.clear()
            cryptoService.lock()
        } catch (_: Throwable) {
            // Cleanup is best-effort
        }
    }
}
```

- [ ] Update step definitions that call `SimulationClient.simulateIncomingCall()` to pass `hubId = ScenarioHooks.currentHubId`:

```kotlin
// In call simulation steps:
val result = SimulationClient.simulateIncomingCall(
    callerNumber = "+15551234567",
    hubId = ScenarioHooks.currentHubId,  // scope to this scenario's hub
)
```

- [ ] Search for all Android step files that call simulation endpoints and add `hubId` where appropriate:

```bash
grep -rn "SimulationClient\." apps/android/app/src/androidTest/ --include="*.kt" -l
```

For each file, pass `ScenarioHooks.currentHubId` to any call that accepts a `hubId` parameter.

- [ ] Compile Android test code:

```bash
cd apps/android && ./gradlew compileDebugAndroidTestKotlin
```

Expected: `BUILD SUCCESSFUL`

- [ ] Run Android unit tests:

```bash
cd apps/android && ./gradlew testDebugUnitTest
```

Expected: all unit tests pass

- [ ] Commit:

```bash
git add apps/android/app/src/androidTest/java/org/llamenos/hotline/steps/ScenarioHooks.kt
git commit -m "test(android): replace resetServerState() with createScenarioHub() hub isolation"
```

---

### Task 12 — Wire hub ID into Android app launch; verify Android BDD scenarios

**Files:** `apps/android/app/src/androidTest/java/org/llamenos/hotline/steps/` (all step files), any Android app code that reads launch arguments for test configuration

The hub ID must reach the app's network layer so API calls use the test hub. On Android, the app reads test configuration from `InstrumentationRegistry.getArguments()` or `Intent` extras.

- [ ] Find where the Android app reads its hub URL in test mode:

```bash
grep -rn "testHubUrl\|TEST_HUB_URL\|hubUrl" apps/android/app/src/main/ --include="*.kt" -l
```

- [ ] Find where the app sets its active hub context. In the multi-hub architecture, this is the `activeHubId` that prefixes all API calls. In the Android app, this will be in the network layer or repository:

```bash
grep -rn "activeHub\|hubId\|setHub" apps/android/app/src/main/ --include="*.kt" -l
```

- [ ] If the Android app supports hub switching (from the mobile multi-hub spec), it will have an API to set the active hub. In test setup (`@Before`), after `createScenarioHub()`, set the active hub:

The approach depends on the Android app's architecture. Two options:

**Option A — Pass hub ID via InstrumentationRegistry arguments:**

In `createScenarioHub()`, after getting the hub ID, store it so the app can read it:
```kotlin
// The app reads hub ID from InstrumentationRegistry.getArguments() in its test shim
// (same pattern as reading testHubUrl)
// No additional step needed — app picks it up at next Activity launch
```

**Option B — Call a test-only activity receiver:**

```kotlin
// After creating hub, notify the app via a BroadcastReceiver or direct injection
// that the active hub has changed:
val intent = Intent("org.llamenos.hotline.SET_TEST_HUB")
intent.putExtra("hubId", currentHubId)
InstrumentationRegistry.getInstrumentation().targetContext.sendBroadcast(intent)
```

The correct option depends on what the Android app already implements. Read the app's test configuration shim to determine which approach is in use.

- [ ] If neither option exists yet, implement the simplest one: pass `hubId` via `InstrumentationRegistry.getArguments()` by setting it as an argument before the scenario's Activity is launched. Since Cucumber-Android launches the Activity before `@Before` hooks run, this requires restructuring to pass hub ID via the Activity Intent instead:

```kotlin
// In ComposeRuleHolder (or wherever the Activity is launched):
// Read hubId from ScenarioHooks.currentHubId at Activity launch time
// Pass via Intent extra: intent.putExtra("TEST_HUB_ID", ScenarioHooks.currentHubId)
```

This is an architectural decision that depends on the existing test harness. Document the chosen approach in the step definition code.

- [ ] Verify the full Android test compilation succeeds:

```bash
cd apps/android && ./gradlew compileDebugAndroidTestKotlin
```

- [ ] Commit after all Android changes:

```bash
git add apps/android/
git commit -m "test(android): wire hub ID into app launch for per-scenario isolation"
```

---

## Phase 7: Final Verification

### Task 13 — Run full desktop test suite; confirm success criteria

- [ ] Run backend BDD tests:

```bash
bun run test:backend:bdd
```

Expected: 598+ scenarios passing, 0 failing, `fullyParallel: true`, `workers: 3`

- [ ] Run desktop Playwright tests:

```bash
bun run test
```

Expected: all tests passing, no `waitForTimeout`, no CSS class selectors

- [ ] Run typecheck:

```bash
bun run typecheck
```

Expected: `0 errors`

- [ ] Verify success criteria from the spec:

```bash
# waitForTimeout: must be 0
grep -rn "waitForTimeout" tests/ --include="*.ts" | wc -l

# CSS class selectors: must be 0
grep -rn "\.cursor-pointer\|\.text-destructive\|\.text-\\\[10px\\\]\|button\[type\]" tests/ --include="*.ts" | wc -l

# DOM ID selectors: must be 0
grep -rn "#nsec\|#cms-toggle\|#report-types" tests/ --include="*.ts" | wc -l

# epic-24-27.spec.ts: must not exist
ls tests/epic-24-27.spec.ts 2>&1

# sectionTestIdMap in step files (not test-ids.ts): must be 0
grep -rn "sectionTestIdMap" tests/steps/ --include="*.ts" | wc -l
```

Each command should output `0` or `ls: cannot access 'tests/epic-24-27.spec.ts': No such file or directory`.

- [ ] Final commit of success criteria documentation or README update if required.

---

### Task 14 — Run iOS tests; confirm no regressions

```bash
ssh mac 'cd ~/projects/llamenos && xcodebuild test -scheme Llamenos-Package -destination "platform=iOS Simulator,name=iPhone 17" 2>&1 | grep -E "PASS|FAIL|error:|BUILD"'
```

Expected: All tests that previously passed still pass. No new failures from removing `resetServerState()`. Each test class now creates its own hub.

---

### Task 15 — Run Android tests; confirm no regressions

```bash
cd apps/android && ./gradlew testDebugUnitTest && ./gradlew lintDebug && ./gradlew compileDebugAndroidTestKotlin
```

Expected: `BUILD SUCCESSFUL` for all three commands.

- [ ] If a device or emulator is available, also run the full Android E2E suite to confirm hub isolation works:

```bash
cd apps/android && ./gradlew connectedAndroidTest 2>&1 | tail -30
```

Expected: all Cucumber scenarios pass with hub-per-scenario isolation (no shared global state resets). If no device is connected, skip this step and note it in the commit message — CI will pick it up.

- [ ] Commit final Android verification:

```bash
git add apps/android/
git commit -m "test(android): verify hub isolation — all unit, lint, E2E tests pass"
```

---

### Task 16 — Parallelism stress test: time bun run test:backend:bdd at workers=3

This task verifies that hub-per-worker isolation actually enables meaningful parallel speedup, not just that the tests pass.

- [ ] Run the BDD suite and capture the wall-clock time:

```bash
time bun run test:backend:bdd
```

Record the elapsed time. It should be significantly less than running sequentially (workers: 1).

- [ ] As a baseline comparison, run with workers=1:

```bash
PLAYWRIGHT_WORKERS=1 bun run test:backend:bdd
```

Expected: `workers: 3` run should be at least 40% faster than `workers: 1`. If the speedup is minimal, investigate whether scenarios are truly independent (no shared state, no ordering dependencies). A realistic target: 598 scenarios should complete in under 3 minutes at workers=3.

- [ ] Record results in a commit message note:

```bash
git commit --allow-empty -m "test(perf): BDD parallel baseline — workers=3: Xs, workers=1: Ys (Z% speedup)"
```

(Replace X, Y, Z with actual measured values.)

---

## Success Criteria Checklist

| Criterion | Target | Verification Command |
|---|---|---|
| `waitForTimeout` occurrences | 0 | `grep -rn "waitForTimeout" tests/ --include="*.ts"` → empty |
| Playwright projects | 3 + `globalSetup` | Read `playwright.config.ts` |
| `bdd-serial` project | deleted | Not in `playwright.config.ts` |
| `@resets-state` tag | 0 uses | `grep -rn "resets-state" packages/test-specs/ tests/` → empty |
| Test isolation | hub-per-worker | `tests/steps/fixtures.ts` workerHub fixture |
| Module-level mutable `let` in step files | 0 | `grep -rn "^let " tests/steps/ --include="*.ts"` |
| Selector registries | 1 (`TestIds`) | No `buttonTestIdMap` in step files |
| `sectionTestIdMap` in step files | deleted | `grep -rn "sectionTestIdMap" tests/steps/` → empty |
| `epic-24-27.spec.ts` | deleted | `ls tests/epic-24-27.spec.ts` → not found |
| Empty step definitions | 0 | All steps in `desktop-admin-steps.ts` have non-empty bodies |
| CSS class selectors | 0 | `grep -rn "\.cursor-pointer\|\.text-destructive" tests/` → empty |
| DOM ID selectors (`#nsec`, etc.) | 0 | `grep -rn "#nsec\|#cms-toggle\|#report-types" tests/` → empty |
| iOS `resetServerState()` calls | 0 | `grep -rn "resetServerState" apps/ios/` → empty (all 8 files cleaned) |
| Android `resetServerState()` calls | 0 | `grep -rn "resetServerState" apps/android/` → empty |
| `[data-settings-section]` in test files | 0 | `grep -rn "[data-settings-section]" tests/` → empty (all 12 occurrences) |
| Backend BDD parallel | `fullyParallel: true`, workers: 3 | Read `playwright.config.ts` backend-bdd project |
| Backend BDD pass count | 598+ | `bun run test:backend:bdd` output |
| Parallel speedup | ≥40% faster at workers=3 vs workers=1 | `time bun run test:backend:bdd` (Task 16) |
| Android E2E hub isolation | hub-per-scenario | `./gradlew connectedAndroidTest` passes |

---

## Notes for Implementors

### On the current state

Much of the desktop work described in the spec has already been completed. When starting implementation, always read the current file state before applying changes — do not assume the spec's "before" snippets match the current code exactly. The fixtures, World pattern, and workerHub isolation are already in place for both desktop BDD and backend BDD.

### On iOS auth for hub creation

The `POST /api/hubs` endpoint requires admin authentication. The cleanest test approach is to add `POST /api/test-create-hub` to `apps/worker/routes/dev.ts` (alongside the existing test simulation endpoints) — this avoids needing to implement Schnorr signing in Swift for the test helper. This endpoint is gated by `X-Test-Secret` and `ENVIRONMENT=development`, the same as all other test endpoints.

### On Android parallelism

Android Cucumber runs scenarios sequentially on a single device/emulator. The `ScenarioHooks.currentHubId` companion object var is safe for sequential execution. If true parallel scenario execution is added later (e.g., multiple emulators), replace with `ThreadLocal<String>`.

### On hub accumulation

Test hubs are never deleted. They accumulate in the database. A periodic cleanup job (or manual `DELETE FROM hubs WHERE name LIKE 'test-%' AND created_at < NOW() - INTERVAL '7 days'`) should be scheduled. This is acceptable for a development database; document it in the deployment runbook.

### On the `POST /api/test-create-hub` backend endpoint

This endpoint must be added to `apps/worker/routes/dev.ts` before Tasks 8 and 10 can be completed. It is a one-function addition to an existing file — implement it early (at the start of Task 8) so that both iOS and Android can use it.
