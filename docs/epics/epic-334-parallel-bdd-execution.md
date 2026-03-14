# Epic 334: Parallel BDD Execution with CMS Isolation

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 333 (Serial Execution Isolation)
**Branch**: `desktop`

## Problem

The desktop BDD suite now has ~500+ scenarios (310 pre-existing + 98 CMS + growing). Running serially at ~1-2s per scenario takes 10-15 minutes. The CMS scenarios compound the state pollution problem from Epic 333 because:

1. **CMS state is global** — entity types, templates, and case management enabled/disabled are hub-level settings. One scenario enabling case management affects all subsequent scenarios.
2. **New DOs have shared state** — ContactDirectoryDO and CaseDO share a single namespace per hub. Records, contacts, and relationships created in one scenario leak into the next.
3. **Template application is not idempotent for tests** — applying "jail-support" twice doesn't error, but creates duplicate entity types with different UUIDs.
4. **Blind index hashes are deterministic** — two scenarios creating contacts with the same name get the same trigram tokens, causing collisions in search tests.

## Solution: Hub-per-Scenario Isolation

Instead of resetting all state between scenarios (slow), give each scenario its own hub. The DO architecture already supports this — `getScopedDOs(env, hubId)` creates per-hub DO instances.

### Architecture

```
Scenario A (arrest case CRUD)    → Hub "test-hub-{uuid-a}" → own CaseDO, ContactDirectoryDO
Scenario B (template application) → Hub "test-hub-{uuid-b}" → own SettingsDO namespace
Scenario C (contact search)      → Hub "test-hub-{uuid-c}" → own ContactDirectoryDO
```

Each scenario:
1. Creates a unique hub via API (`POST /api/hubs`)
2. Sets that hub as the active hub in the browser context
3. Runs all steps scoped to that hub
4. Hub is abandoned after the scenario (no cleanup needed — DOs expire)

### Implementation

#### 1. Hub-per-Scenario Before Hook

```typescript
// tests/steps/common/hub-isolation.ts
import { Before, After } from '../fixtures'

Before(async ({ page, request }) => {
  const hubId = `test-hub-${crypto.randomUUID().slice(0, 8)}`
  const hubName = `Test ${hubId}`

  // Create unique hub for this scenario
  await request.post('/api/hubs', {
    data: { name: hubName, slug: hubId },
    headers: authHeaders(ADMIN_NSEC, 'POST', '/api/hubs'),
  })

  // Store hubId in page context for step definitions to use
  await page.evaluate((id) => {
    window.__TEST_HUB_ID = id
  }, hubId)

  // Set the hub in the app's hub selector
  await page.goto(`/?hub=${hubId}`)
})
```

#### 2. Worker-Based Parallelism

With hub isolation, scenarios can run in parallel (each has its own state):

```typescript
// playwright.config.ts
{
  ...defineBddProject({
    name: 'bdd',
    // ...
  }),
  fullyParallel: true,  // Safe with hub isolation!
  workers: 3,           // 3 parallel browsers
}
```

**Expected speedup**: 15 min serial → 5 min parallel (3 workers).

#### 3. CMS-Specific Isolation

For CMS scenarios specifically:

```typescript
// tests/steps/cases/cms-setup.ts
Given('CMS is configured with the jail-support template', async ({ page, request }) => {
  const hubId = await page.evaluate(() => window.__TEST_HUB_ID)

  // Enable CMS for this hub
  await enableCaseManagementViaApi(request, true, ADMIN_NSEC)

  // Apply template (creates entity types in this hub's SettingsDO)
  await applyTemplateViaApi(request, 'jail-support', ADMIN_NSEC)
})

Given('an arrest case exists in the current hub', async ({ page, request }) => {
  const hubId = await page.evaluate(() => window.__TEST_HUB_ID)
  const entityTypes = await listEntityTypesViaApi(request, ADMIN_NSEC)
  const arrestCase = entityTypes.find(t => t.name === 'arrest_case')

  // Create record scoped to this hub's CaseDO
  await createRecordViaApi(request, arrestCase.id, {
    statusHash: 'status_reported_hash',
  }, ADMIN_NSEC)
})
```

#### 4. Unique Data per Scenario

All CMS step definitions already use `Date.now()` for unique names. With hub isolation, even collisions are harmless since each hub has its own DO instances.

#### 5. Shared Setup Steps (Not Duplicated)

Common CMS setup can be extracted into reusable step compositions:

```gherkin
# Background shared across multiple feature files
Background:
  Given a fresh test hub is created
  And the admin is logged in to the test hub
  And CMS is configured with the jail-support template
```

This replaces the monolithic `Given the server is reset` with targeted hub creation.

## CMS Desktop Step Definitions Needed

The 98 CMS desktop scenarios need step definitions. Group by page:

### Cases Page Steps (`tests/steps/cases/cms-cases-steps.ts`)
- Navigation: `When I navigate to the cases page`
- Entity type tabs: `When I click the {string} entity type tab`
- Status filter: `When I filter by status {string}`
- Record creation: `When I click "New Case"`, `When I select entity type {string}`, `When I fill in the required fields`
- Record detail: `When I click on case {string}`, `Then the detail panel should show`
- Status change: `When I click the status pill`, `When I select {string}`
- Timeline: `When I click the "Timeline" tab`, `When I type a comment`
- Evidence: `When I click the "Evidence" tab`
- Bulk: `When I select multiple cases`, `When I click "Change Status" in bulk`

### Contact Directory Steps (`tests/steps/cases/cms-contacts-steps.ts`)
- Search: `When I search for {string}`
- Create: `When I click "New Contact"`, `When I fill in display name`
- Profile: `When I click on {string}`, `Then I should see the Profile tab`
- Restricted: `Then PII fields should show a restricted indicator`

### Admin Settings Steps (`tests/steps/cases/cms-admin-steps.ts`)
- Navigation: `When I navigate to case management settings`
- Toggle: `When I toggle case management on`
- Template: `When I click "Apply" on the {string} template`
- Entity type: `When I click "Create Entity Type"`, `When I add a status`
- Fields: `When I navigate to the Fields tab`, `When I add a new text field`

### Events Steps (`tests/steps/cases/cms-events-steps.ts`)
- Navigation: `When I navigate to events`
- Create: `When I create a {string}`, `When I link arrest cases to the event`

## Parallel Execution Configuration

```typescript
// playwright.config.ts updates
{
  ...defineBddProject({
    name: 'bdd',
    features: 'packages/test-specs/features/**/*.feature',
    steps: [
      'tests/steps/**/*.ts',
      '!tests/steps/backend/**/*.ts',  // exclude backend steps
    ],
    featuresRoot: 'packages/test-specs/features',
    tags: '@desktop',
    missingSteps: 'skip-scenario',
  }),
  fullyParallel: true,
  workers: process.env.CI ? 3 : 2,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
}
```

## Files to Create

| File | Purpose |
|------|---------|
| `tests/steps/common/hub-isolation.ts` | Before hook creating per-scenario hubs |
| `tests/steps/cases/cms-cases-steps.ts` | Cases page step definitions |
| `tests/steps/cases/cms-contacts-steps.ts` | Contact directory step definitions |
| `tests/steps/cases/cms-admin-steps.ts` | Admin settings step definitions |
| `tests/steps/cases/cms-events-steps.ts` | Events step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `playwright.config.ts` | Enable `fullyParallel: true`, increase workers |
| `tests/steps/fixtures.ts` | Import hub-isolation hook |
| `tests/api-helpers.ts` | Add hub-scoped API helpers |

## Acceptance Criteria

- [ ] Full desktop BDD suite runs in parallel (3 workers)
- [ ] CMS scenarios all pass with hub isolation
- [ ] Total execution time < 5 minutes (down from 15+)
- [ ] No scenario depends on state from another scenario
- [ ] CI pipeline uses parallel execution

## Risk Assessment

- **Medium**: Hub creation overhead (~100ms per scenario) adds ~50s across 500 scenarios
- **Medium**: Some pre-existing scenarios may assume they're in the default hub
- **Low**: DO isolation is already built into the architecture (getScopedDOs pattern)
