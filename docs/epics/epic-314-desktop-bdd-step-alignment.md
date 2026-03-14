# Epic 314: Desktop BDD Step Definition Alignment

## Status: PARTIALLY COMPLETE

## Problem

102 desktop BDD scenarios fail because step definitions reference UI elements, navigation patterns, or flows that have changed since the steps were written. The `[bdd]` Playwright project (shared Gherkin specs + desktop step definitions) has not been maintained in sync with UI changes.

## Results

### Improvements Made (Phase 1)
- **Baseline**: 78 failures in full serial run, 232 passed
- **After fixes**: 75 failures, 235 passed (+3 net improvement)
- **Per-group results**: All individual feature groups pass (0 failures when run in isolation)

### Fixes Applied

| Area | Fix | Impact |
|------|-----|--------|
| Navigation (i18n) | Added Spanish + missing labels to `navTestIdMap` | Language switching, Reports nav |
| Section expansion | Added `sectionTestIdMap` for settings sections | Custom Fields, Notifications, Key Backup |
| Custom Fields | Fixed type select (value vs label), option input locator, delete dialog handling | 2 scenarios fixed |
| Device Linking | Adapted step indicator checks for desktop inline flow (no mobile step UI) | 3 scenarios fixed |
| WebRTC | Added phone number fill (required for Save button enabled state) | 1 scenario fixed |
| RCS | Added `data-testid="form-save-btn"` to RCS save button | 1 scenario fixed |
| Reports | Created `createReportViaApi` helper, seeded data for filter/detail tests | ~8 scenarios fixed |
| Report Form | Changed `data-testid` to `report-form-submit-btn` (descriptive) | Submit button alignment |
| Settings | Fixed identity card step mismatch (dashboard vs settings step) | 1 scenario fixed |
| Config | Excluded `@wip` scenarios from desktop BDD test run | 5+ WIP scenarios removed |
| Click handler | Wait for button enabled state before clicking in fallback path | Robustness |

### Remaining 75 Failures (Pre-existing)

These failures appear ONLY in the full serial run (310 tests, 1 worker) and pass when run per-group. Root causes:

1. **Serial state leakage** — Tests share server state; setup wizard tests modify demo mode, which cascades to subsequent settings tests
2. **Step definition collisions** — Same Gherkin step text resolves to wrong step definition depending on import order
3. **Test data dependencies** — Reports, contacts, and call recording tests need data that doesn't exist in clean state
4. **Missing `@wip` on incomplete features** — Some scenarios reference unimplemented UI

### Recommendation for Phase 2

1. Add `@wip` tag to scenarios that test unimplemented features
2. Add test-reset between feature groups (not just at suite start)
3. Fix step definition collisions (unique step text per context)
4. Add `@serial` tag to tests that modify global state (demo mode, setup wizard)

## Files Changed

- `playwright.config.ts` — Added `not @wip` to tag filter
- `tests/test-ids.ts` — Extended `navTestIdMap` with i18n and missing entries
- `tests/steps/common/interaction-steps.ts` — `sectionTestIdMap`, button mappings, enabled-wait
- `tests/steps/settings/settings-steps.ts` — Device link steps adapted for desktop
- `tests/steps/settings/webrtc-extended-steps.ts` — Phone number fill
- `tests/steps/notes/custom-fields-steps.ts` — Type select, option inputs, delete handler
- `tests/steps/reports/report-steps.ts` — Filter/detail data seeding
- `tests/steps/admin/desktop-admin-steps.ts` — Report data seeding, RCS navigation
- `tests/api-helpers.ts` — `createReportViaApi`, `assignReportViaApi`, `updateReportStatusViaApi`
- `src/client/components/ReportForm.tsx` — Descriptive `data-testid`
- `src/client/components/admin-settings/rcs-channel-section.tsx` — Added `data-testid`
- `packages/test-specs/features/admin/settings.feature` — Identity card step fix
