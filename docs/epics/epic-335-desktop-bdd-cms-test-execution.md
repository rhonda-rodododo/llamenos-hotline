# Epic 335: Desktop BDD CMS Test Execution & Fixes

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 314 (Step Alignment), Epics 329-332 (CMS UI components exist)
**Blocks**: Epic 336 (Serial fixes depend on CMS scenarios passing individually)
**Branch**: `desktop`

## Summary

The 98 CMS desktop BDD scenarios have step definitions (in `tests/steps/cases/`) but have never been executed against the actual UI components. This epic runs them, identifies every failure category, and fixes them until all 98 pass when run per-feature-group (the same standard used for the pre-existing 310 scenarios after Epic 314).

## Problem Statement

Epics 329-332 built the CMS UI. Epic 334 wrote step definitions. But nobody has actually run `bun run test:desktop` filtered to the CMS feature files. The step definitions were written against the _design document_ (`docs/plans/2026-03-14-case-management-frontend-design.md`) and the _epic specs_ (330-332), not against the real DOM output. Experience from Epic 314 shows that step definitions written before running against real UI have a ~30-40% first-pass failure rate due to:

1. **Test ID mismatches** -- `data-testid` values in step definitions don't match what components actually render
2. **Selector fragility** -- `.locator('.rounded-full')` or `.locator('.text-\\[10px\\]')` CSS class selectors that broke when shadcn/ui or Tailwind versions changed
3. **Timing issues** -- debounce waits too short, animations not finished, async API calls not settled
4. **API helper failures** -- `createRecordViaApi`, `uploadEvidenceViaApi`, `createRelationshipViaApi`, `createGroupViaApi`, `addGroupMemberViaApi` may not match current worker API signatures
5. **Missing nav entries** -- `navTestIdMap` in `tests/test-ids.ts` has no entries for CMS pages (Cases, Contact Directory, Events, Case Management admin)
6. **Component bugs** -- real bugs in the UI discovered only by automated testing

## Implementation

### Phase 1: Run and Triage

Run each CMS feature file individually and categorize every failure.

```bash
# Run CMS feature files one at a time
bunx playwright test --project bdd --grep "Case Management" --reporter list
bunx playwright test --project bdd --grep "Contact Directory" --reporter list
bunx playwright test --project bdd --grep "Event Management" --reporter list
bunx playwright test --project bdd --grep "Case Management Settings" --reporter list
```

Build a failure matrix:

| Category | Expected Count | Fix Location |
|----------|---------------|--------------|
| Test ID mismatch | ~15-20 | Step definitions |
| CSS selector broke | ~10 | Step definitions |
| Timing / debounce | ~5-8 | Step definitions + component |
| API helper signature | ~5-10 | `tests/api-helpers.ts` |
| Missing nav mapping | 4 | `tests/test-ids.ts` |
| Component bug | ~5-10 | `src/client/components/cases/` |
| Missing data-testid | ~5-10 | Components |

### Phase 2: Fix navTestIdMap

Add CMS page entries to `tests/test-ids.ts`:

```typescript
// In navTestIdMap:
'Cases': 'nav-cases',
'Contact Directory': 'nav-contacts-directory',
'Events': 'nav-events',
'Case Management': 'nav-case-management',
```

Verify these test IDs exist in `src/client/components/Sidebar.tsx`. Add them if missing.

### Phase 3: Fix Test ID Mismatches

For each test ID mismatch, inspect the actual component DOM (via Playwright trace or `page.content()`) and update the step definition to use the real test ID. Common patterns:

- Step says `getByTestId('case-status-pill')` but component renders `data-testid="status-pill"`
- Step says `getByTestId('evidence-grid-item')` but component renders `data-testid="evidence-item"`
- Step says `getByTestId('case-contacts-empty')` but component renders `data-testid="contacts-empty-state"`

**Rule**: Always fix the step definition to match the component, not the other way around -- unless the component's test ID is clearly wrong (generic, non-unique).

### Phase 4: Replace CSS Class Selectors

Every step definition that uses `.locator('.rounded-full')`, `.locator('.text-\\[10px\\]')`, `.locator('.opacity-60')`, or similar Tailwind class selectors must be replaced with `data-testid` selectors. Add test IDs to components where needed.

Affected step definitions:
- `cms-admin-steps.ts` lines 131, 192-200, 217-222, 470-477, 482-488, 551
- `cms-cases-steps.ts` lines 265-266, 273-274, 293
- `cms-events-steps.ts` lines 94, 103

### Phase 5: Fix API Helpers

Run each CMS API helper in isolation to verify it matches the current worker API:

```typescript
// Verify these against actual worker routes:
enableCaseManagementViaApi    // PATCH /api/settings with { caseManagementEnabled: bool }
listEntityTypesViaApi          // GET /api/settings/entity-types
applyTemplateViaApi           // POST /api/settings/templates/:id/apply
createRecordViaApi            // POST /api/records
listRecordsViaApi             // GET /api/records
createInteractionViaApi       // POST /api/records/:id/interactions
uploadEvidenceViaApi          // POST /api/records/:id/evidence
createContactViaApi           // POST /api/contacts
listContactsViaApi            // GET /api/contacts
linkContactToRecordViaApi     // POST /api/records/:id/contacts
createRelationshipViaApi      // POST /api/contacts/:id/relationships
createGroupViaApi             // POST /api/contacts/groups
addGroupMemberViaApi          // POST /api/contacts/groups/:id/members
createEventViaApi             // POST /api/records (with event entity type)
linkRecordToEventViaApi       // POST /api/records/:eventId/links
linkReportToEventViaApi       // POST /api/records/:eventId/report-links
createEntityTypeViaApi        // POST /api/settings/entity-types
updateEntityTypeViaApi        // PATCH /api/settings/entity-types/:id
deleteEntityTypeViaApi        // DELETE /api/settings/entity-types/:id
```

### Phase 6: Fix Timing Issues

Standardize waits using `Timeouts` constants:
- After API calls: `Timeouts.ASYNC_SETTLE` (1000ms)
- After UI animations: `Timeouts.UI_SETTLE` (300ms)
- Search debounce: 500ms (component uses 300ms debounce + network latency)
- For visibility: `Timeouts.ELEMENT` (5000ms)

Add explicit `waitForResponse` where possible instead of fixed waits:
```typescript
await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/records') && resp.status() === 200),
  page.getByTestId('case-create-submit').click(),
])
```

### Phase 7: Fix Component Bugs

Any real component bugs found during testing get fixed in-place. Track each fix with a comment in the commit message.

## Files to Modify

| File | Change |
|------|--------|
| `tests/test-ids.ts` | Add CMS nav entries to `navTestIdMap` |
| `tests/steps/cases/cms-cases-steps.ts` | Fix test IDs, replace CSS selectors, fix timing |
| `tests/steps/cases/cms-admin-steps.ts` | Fix test IDs, replace CSS selectors, fix timing |
| `tests/steps/cases/cms-contacts-steps.ts` | Fix test IDs, replace CSS selectors, fix timing |
| `tests/steps/cases/cms-events-steps.ts` | Fix test IDs, replace CSS selectors, fix timing |
| `tests/api-helpers.ts` | Fix API helper signatures to match worker routes |
| `src/client/components/cases/*.tsx` | Add missing `data-testid` attrs, fix component bugs |
| `src/client/components/Sidebar.tsx` | Add CMS nav test IDs if missing |

## Testing

```bash
# Per-feature-group execution (the gate):
bunx playwright test --project bdd --grep "Case Management$" --reporter list
bunx playwright test --project bdd --grep "Case Management Settings" --reporter list
bunx playwright test --project bdd --grep "Contact Directory" --reporter list
bunx playwright test --project bdd --grep "Event Management" --reporter list

# All CMS scenarios:
bunx playwright test --project bdd packages/test-specs/features/platform/desktop/cases/ --reporter list
```

## Acceptance Criteria

- [ ] All 98 CMS desktop BDD scenarios pass when run per-feature-group (4 groups, 0 failures each)
- [ ] Zero CSS class selectors remain in CMS step definitions (all use `data-testid`)
- [ ] All CMS API helpers succeed against the current worker API
- [ ] `navTestIdMap` includes all CMS page entries
- [ ] Any component bugs discovered are fixed (not skipped or worked around)
- [ ] `bun run typecheck` passes
- [ ] `bun run test:desktop` runs with CMS scenarios included

## Risk Assessment

- **High**: Unknown failure count -- could be 20 or 60. Mitigated by systematic triage-then-fix approach.
- **Medium**: Some component bugs may require non-trivial fixes (encryption, schema rendering). Mitigated by fixing in-place rather than rewriting.
- **Low**: API helper fixes -- the backend BDD already validates these routes. Desktop helpers just need auth header alignment.
