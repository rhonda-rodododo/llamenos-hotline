# Epic 226: Playwright-BDD Integration

## Overview

Integrate `playwright-bdd` (v8.4.2) into the desktop test suite so that shared `.feature` files from `packages/test-specs/` drive Playwright test execution. Existing 361+ `.spec.ts` tests coexist with BDD tests during incremental migration.

## Current State

- 40 Playwright `.spec.ts` files (361+ tests) in `tests/`
- Page objects in `tests/pages/index.ts` (387 lines)
- Test IDs in `tests/test-ids.ts` (159 constants)
- Helpers in `tests/helpers.ts` (248 lines) + `tests/api-helpers.ts` (259 lines)
- Tauri IPC mocks in `tests/mocks/` (triggered by `PLAYWRIGHT_TEST=true`)
- `playwright.config.ts` with 4 projects (setup, chromium, bootstrap, mobile-chromium)

## Architecture

### playwright-bdd Flow
```
packages/test-specs/features/**/*.feature
    ↓ (defineBddConfig reads features)
tests/steps/**/*.ts  (step definitions)
    ↓ (playwright-bdd generates)
.features-gen/**/*.spec.ts  (auto-generated, gitignored)
    ↓ (Playwright runs)
Results in standard Playwright reporter
```

### Hybrid Config
```
playwright.config.ts
  ├── setup (global-setup.ts — existing)
  ├── bdd (playwright-bdd generated tests from .feature files)
  ├── chromium (existing .spec.ts tests — gradually shrinks as BDD replaces)
  ├── bootstrap (existing — depends on chromium)
  └── mobile-chromium (existing — responsive tests)
```

## Installation

```bash
bun add -d playwright-bdd
```

Single dependency. Peer dependency on `@playwright/test` (already installed).

## Configuration

### `playwright.config.ts`
```typescript
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const bddTestDir = defineBddConfig({
  features: 'packages/test-specs/features/**/*.feature',
  steps: 'tests/steps/**/*.ts',
  outputDir: '.features-gen',
  featuresRoot: 'packages/test-specs/features',
  importTestFrom: './tests/steps/fixtures.ts',
  tags: '@desktop',
});

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 3,
  reporter: 'html',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8788',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
      testDir: './tests',
    },
    {
      name: 'bdd',
      testDir: bddTestDir,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      name: 'chromium',
      testDir: './tests',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/bootstrap\.spec\.ts/, /steps\//],
      dependencies: ['setup'],
    },
    {
      name: 'bootstrap',
      testDir: './tests',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /bootstrap\.spec\.ts/,
      dependencies: ['chromium'],
    },
    {
      name: 'mobile-chromium',
      testDir: './tests',
      use: { ...devices['Pixel 7'] },
      testMatch: /responsive\.spec\.ts/,
      dependencies: ['setup'],
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'PLAYWRIGHT_TEST=true bun run dev:vite --port 8788',
        url: 'http://localhost:8788',
        reuseExistingServer: !process.env.CI,
      },
});
```

### `.gitignore`
```
.features-gen/
```

## Step Definition Architecture

### `tests/steps/fixtures.ts` — Custom Fixture Base
```typescript
import { test as base, createBdd } from 'playwright-bdd';

export const test = base;
export const { Given, When, Then, Before, After } = createBdd(test);
```

### Step Definition Files

```
tests/steps/
  fixtures.ts               # Base test + createBdd exports
  common/
    auth-steps.ts            # Login, PIN, identity (reuses helpers.ts)
    navigation-steps.ts      # Navigate to page/tab (reuses pages/index.ts)
    assertion-steps.ts       # Generic "I should see", "I should not see"
    form-steps.ts            # Fill field, submit, validation
  auth/
    login-steps.ts           # Login screen specific
    onboarding-steps.ts      # Identity creation
    pin-steps.ts             # PIN setup/unlock
  notes/
    note-steps.ts            # Note CRUD
    custom-field-steps.ts    # Custom field interactions
  volunteers/
    volunteer-steps.ts       # Volunteer CRUD (reuses api-helpers.ts)
  shifts/
    shift-steps.ts           # Shift CRUD
  bans/
    ban-steps.ts             # Ban list CRUD
  admin/
    admin-steps.ts           # Audit log, multi-hub, roles
  settings/
    settings-steps.ts        # Profile, WebRTC, theme
  crypto/
    crypto-steps.ts          # Crypto interop (reuses helpers)
```

### Example: Common Auth Steps

```typescript
// tests/steps/common/auth-steps.ts
import { expect } from '@playwright/test';
import { Given, When, Then, Before } from '../fixtures';
import {
  loginAsAdmin,
  loginAsVolunteer,
  loginWithNsec,
  enterPin,
  preloadEncryptedKey,
  logout,
  Timeouts,
} from '../../helpers';

Given('the app is freshly installed', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

Given('no identity exists on the device', async ({ page }) => {
  // Implicit — localStorage was cleared
});

Given('an identity exists with PIN {string}', async ({ page }, pin: string) => {
  await preloadEncryptedKey(page, pin);
  await page.goto('/');
});

Given('I am logged in', async ({ page }) => {
  await loginAsAdmin(page);
});

Given('I am logged in as an admin', async ({ page }) => {
  await loginAsAdmin(page);
});

When('the app launches', async ({ page }) => {
  await page.waitForLoadState('domcontentloaded');
});

When('I enter PIN {string}', async ({ page }, pin: string) => {
  await enterPin(page, pin);
});

When('I tap {string}', async ({ page }, text: string) => {
  await page.getByRole('button', { name: new RegExp(text, 'i') }).click();
});

When('I enter {string} in the {string} field', async ({ page }, value: string, field: string) => {
  await page.getByLabel(field).fill(value);
});
```

### Example: Navigation Steps (Reusing Page Objects)

```typescript
// tests/steps/common/navigation-steps.ts
import { expect } from '@playwright/test';
import { Given, When, Then } from '../fixtures';
import { Navigation } from '../../pages/index';
import { navigateAfterLogin, Timeouts } from '../../helpers';

When('I navigate to the {string} page', async ({ page }, pageName: string) => {
  switch (pageName.toLowerCase()) {
    case 'volunteers': await Navigation.goToVolunteers(page); break;
    case 'shifts': await Navigation.goToShifts(page); break;
    case 'ban list': await Navigation.goToBanList(page); break;
    case 'notes': await Navigation.goToNotes(page); break;
    case 'settings': await Navigation.goToSettings(page); break;
    default: throw new Error(`Unknown page: ${pageName}`);
  }
});

When('I navigate to the {string} tab', async ({ page }, tab: string) => {
  // Desktop uses sidebar navigation
  await page.getByRole('link', { name: new RegExp(tab, 'i') }).click();
});

Then('I should see the {string} heading', async ({ page }, heading: string) => {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
});

Then('the {string} tab should be selected', async ({ page }, tab: string) => {
  const link = page.getByRole('link', { name: new RegExp(tab, 'i') });
  await expect(link).toHaveAttribute('aria-current', 'page');
});
```

### Example: Generic Assertion Steps

```typescript
// tests/steps/common/assertion-steps.ts
import { expect } from '@playwright/test';
import { Given, When, Then } from '../fixtures';
import { testIdSelector } from '../../test-ids';

Then('I should see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).toBeVisible();
});

Then('I should not see {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).not.toBeVisible();
});

Then('I should see the {string} element', async ({ page }, testId: string) => {
  await expect(page.locator(testIdSelector(testId))).toBeVisible();
});

Then('I should see the {string} screen', async ({ page }, screen: string) => {
  // Screen identification varies — could be heading, URL, or test ID
  await expect(page.getByRole('heading', { name: new RegExp(screen, 'i') })).toBeVisible();
});

Then('the list should be empty or have items', async ({ page }) => {
  // Handles parallel test state uncertainty
  const hasItems = await page.locator('[data-testid*="row"]').count();
  const hasEmpty = await page.getByText(/no .+ found|empty/i).isVisible().catch(() => false);
  expect(hasItems > 0 || hasEmpty).toBeTruthy();
});
```

## Migration Strategy

### Phase 1: Infrastructure (this epic)
1. Install `playwright-bdd`
2. Create `tests/steps/fixtures.ts`
3. Create common step definitions (auth, navigation, assertion)
4. Update `playwright.config.ts` with hybrid BDD + existing config
5. Verify: `bun run test` still passes all existing tests + BDD tests run

### Phase 2: Shared Features (this epic)
6. Create step definitions for all 25 shared `.feature` files
7. Verify: BDD project runs 102 shared scenarios
8. **Do NOT delete any existing `.spec.ts` files yet** — both run in CI

### Phase 3: Desktop Features (after Epic 225)
9. Create step definitions for desktop-specific `.feature` files
10. As each domain's BDD tests are verified, consider removing redundant `.spec.ts` tests

### Phase 4: Gradual Spec Migration (future)
11. Migrate remaining `.spec.ts` tests to BDD step definitions
12. Eventually remove `chromium` project from config when fully migrated

## Run Commands

```bash
# Run only BDD tests
PLAYWRIGHT_TEST=true bunx playwright test --project=bdd

# Run only legacy spec tests
PLAYWRIGHT_TEST=true bunx playwright test --project=chromium

# Run everything
bun run test

# Generate BDD test files without running (debugging)
bunx bddgen

# Validate coverage
bun run test-specs:validate --platform desktop
```

## Dependencies

- Epic 223 (platform tags on feature files)
- Epic 225 (desktop-specific feature files — for Phase 3)

## Verification

```bash
# All tests pass (BDD + existing specs)
bun run test

# BDD tests specifically
PLAYWRIGHT_TEST=true bunx playwright test --project=bdd

# Build still works
bun run build
bun run typecheck
```
