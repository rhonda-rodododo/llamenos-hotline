# Epic 314: Desktop BDD Step Definition Alignment

## Problem

102 desktop BDD scenarios fail because step definitions reference UI elements, navigation patterns, or flows that have changed since the steps were written. The `[bdd]` Playwright project (shared Gherkin specs + desktop step definitions) has not been maintained in sync with UI changes.

## Failure Breakdown (by error type)

| Error Type | Count | Root Cause |
|-----------|-------|------------|
| `toBeVisible` — element not found | 42 | Headings/text changed, elements renamed |
| `locator.click` timeout | 24 | Buttons/links renamed or navigation flow changed |
| `locator.waitFor` timeout | 4 | Page transitions changed |
| `toBe` assertion mismatch | 5 | API response shape or content changed |
| `toBeGreaterThan` assertion | 3 | Data-dependent tests with empty state |
| `Failed to create volunteer: 403` | 3 | Permission model tightened |
| Other (scroll, fill, select) | ~20 | Various UI restructuring |

## Common Patterns

1. **Navigation steps**: `I navigate to the "X" page` — sidebar link text or route changed
2. **Heading assertions**: `I should see the "X" heading` — page titles changed
3. **Button clicks**: `I click on "X"` — button labels changed or removed
4. **Form interactions**: `I fill in "X" with "Y"` — form field labels/structure changed
5. **Visibility checks**: Elements moved, renamed, or wrapped differently

## Affected Step Files

- `tests/steps/common/*.ts` — Navigation, assertions, generic steps
- `tests/steps/admin/*.ts` — Admin flow, settings, shifts, bans, invites
- `tests/steps/auth/*.ts` — Login, onboarding, PIN
- `tests/steps/calls/*.ts` — Call history, simulation
- `tests/steps/notes/*.ts` — Notes, custom fields
- `tests/steps/reports/*.ts` — Reports
- `tests/steps/conversations/*.ts` — Conversations
- `tests/steps/settings/*.ts` — Settings pages

## Approach

1. Fix shared common steps first (navigation, headings, buttons) — highest leverage
2. Fix feature-specific steps by feature area
3. Run after each area to verify incremental progress

## Priority

Medium-High — BDD specs are the behavioral contract. Having 102 failing scenarios means the contract is unverified.

## Discovered

2026-03-13 during comprehensive Linux test session. These failures pre-date this session — the `.features-gen/` directory was stale and the `[bdd]` project wasn't being regenerated.
