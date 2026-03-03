# Epic 232: Desktop Spec-to-BDD Migration

## Goal

Migrate all desktop Playwright `.spec.ts` tests to BDD step definitions driven by shared Gherkin features, then delete redundant spec files. After this epic, 90%+ of desktop E2E tests run through the BDD project (`playwright-bdd`), with only infrastructure-specific spec files remaining.

## Context

Current desktop test suite:
- **39 `.spec.ts` files** with 336 tests (traditional Playwright)
- **63 `.feature` files** with 331 scenarios (BDD via `playwright-bdd`)
- **26 step definition files** in `tests/steps/`
- Both suites run in CI — significant overlap and maintenance burden
- BDD project filters on `@desktop` tag

After Epic 231 adds ~65 new scenarios, the shared BDD suite will cover ~396 scenarios. This epic adds desktop step definitions for the new scenarios and removes spec files whose coverage is fully subsumed.

## Prerequisites

- **Epic 231** (Shared BDD Spec Consolidation) — must be complete, providing expanded scenarios for roles, messaging, device-linking, help, telephony

## Deliverables

### Phase 1: Safe Deletions — Fully Migrated Spec Files (8 files, 63 tests)

These spec files are 100% covered by existing BDD features + step definitions:

| Spec File | Tests | Covered By | Action |
|-----------|-------|-----------|--------|
| `auth.spec.ts` | 6 | `auth/login.feature` (6 scenarios) | DELETE |
| `invite-onboarding.spec.ts` | 4 | `auth/invite-onboarding.feature` (4 scenarios) | DELETE |
| `ban-management.spec.ts` | 13 | `bans/ban-management.feature` (13 scenarios) | DELETE |
| `theme.spec.ts` | 6 | `settings/theme.feature` (6 scenarios) | DELETE |
| `panic-wipe.spec.ts` | 2 | `auth/panic-wipe.feature` (2 scenarios) | DELETE |
| `demo-mode.spec.ts` | 7 | `admin/demo-mode.feature` (7 scenarios) | DELETE |
| `call-recording.spec.ts` | 4 | `desktop/calls/call-recording.feature` (4 scenarios) | DELETE |
| `form-validation.spec.ts` | 8 | `auth/form-validation.feature` (7 scenarios) | DELETE |
| `blasts.spec.ts` | 3 | `messaging/blasts.feature` (4 scenarios) | DELETE |
| `rcs-channel.spec.ts` | 1 | `desktop/messaging/rcs-channel.feature` (2 scenarios) | DELETE |

**Pre-deletion check**: `form-validation.spec.ts` has 8 tests vs 7 BDD scenarios — identify the 8th test and add a matching scenario to `auth/form-validation.feature` before deletion.

**Verification**: Run `bun run test` after each deletion to confirm BDD project still passes all scenarios. Run deleted tests' assertions against BDD step definitions to confirm parity.

### Phase 2: Expand Step Definitions for New Scenarios

Add desktop step definitions (`tests/steps/`) to cover the scenarios added by Epic 231:

#### `tests/steps/admin/roles-steps.ts` — Expand for 19 new scenarios

```typescript
// New steps needed:
When('I create a custom role with an existing slug', ...)
Then('I should see a duplicate slug error', ...)
When('I create a role with slug {string}', ...)
Then('I should see an invalid slug error', ...)
When('I update the role permissions', ...)
Then('the permissions should be updated', ...)
When('I request the permissions catalog', ...)
Then('I should see all available permissions grouped by domain', ...)
Then('I should have access to all API endpoints', ...)
// ... 10 more steps
```

#### `tests/steps/messaging/conversations-full-steps.ts` — Expand for 9 new scenarios

```typescript
When('I configure SMS channel with Twilio credentials', ...)
Then('the SMS channel should be enabled', ...)
When('I configure WhatsApp channel', ...)
When('I type a message and click send', ...)
Then('the message should appear in the thread', ...)
// ... 4 more steps
```

#### `tests/steps/settings/device-link-steps.ts` — New file for 10 total scenarios

```typescript
When('I start the device linking process', ...)
Then('I should see a QR code displayed', ...)
Then('I should see the linking progress indicator', ...)
When('I cancel the linking', ...)
// ... 6 more steps
```

#### `tests/steps/help/help-steps.ts` — Expand for 4 new scenarios

```typescript
Then('I should see the FAQ accordion', ...)
When('I click on a FAQ question', ...)
Then('the answer should be visible', ...)
Then('I should see the getting started checklist', ...)
```

#### `tests/steps/dashboard/calls-today-steps.ts` — New file for 2 promoted scenarios

```typescript
Then('I should see the calls today count on the dashboard', ...)
```

#### `tests/steps/notes/note-thread-steps.ts` — New file for 5 promoted scenarios

```typescript
Then('I should see the thread replies section', ...)
Then('I should see the reply input field', ...)
Then('I should see the no replies message', ...)
```

#### `tests/steps/shifts/shift-detail-steps.ts` — New file for 5 promoted scenarios

```typescript
When('I tap a shift card', ...)
Then('I should see the shift detail screen', ...)
Then('I should see the shift info card', ...)
```

#### `tests/steps/admin/volunteer-profile-steps.ts` — New file for 5 promoted scenarios

```typescript
When('I tap a volunteer card', ...)
Then('I should see the volunteer detail screen', ...)
Then('I should see the volunteer name', ...)
```

### Phase 3: Partial Migration — Spec Files with BDD Overlap (15 files, 196 tests)

After Phase 2, these spec files should be 100% covered by BDD. Delete them one at a time, running tests after each:

| Spec File | Tests | New BDD Coverage | Action |
|-----------|-------|-----------------|--------|
| `volunteer-flow.spec.ts` | 9 | `auth/volunteer-crud.feature` (9) | DELETE |
| `shift-management.spec.ts` | 10 | `shifts/shift-scheduling.feature` (10) + `shift-list.feature` (3) | DELETE |
| `audit-log.spec.ts` | 11 | `admin/audit-log.feature` (11) | DELETE |
| `profile-settings.spec.ts` | 13 | `settings/profile-settings.feature` (14) | DELETE |
| `notes-crud.spec.ts` | 6 | `notes/note-*.feature` (15 total) | DELETE |
| `notes-custom-fields.spec.ts` | 8 | `notes/notes-custom-fields.feature` (8) | DELETE |
| `setup-wizard.spec.ts` | 17 | `desktop/misc/setup-wizard.feature` (16) | DELETE |
| `conversations.spec.ts` | 7 | `conversations/*.feature` (13 total) | DELETE |
| `reports.spec.ts` | 21 | `reports/report-*.feature` (22 total) | DELETE |
| `roles.spec.ts` | 27 | `admin/roles.feature` (27 after Epic 231) | DELETE |
| `messaging-epics.spec.ts` | 20 | `messaging/*.feature` (20 after Epic 231) | DELETE |
| `device-linking.spec.ts` | 10 | `settings/device-link.feature` (10 after Epic 231) | DELETE |
| `help.spec.ts` | 9 | `help/help-screen.feature` (9 after Epic 231) | DELETE |
| `multi-hub.spec.ts` | 7 | `desktop/admin/multi-hub.feature` (7 after Epic 231) | DELETE |
| `custom-fields.spec.ts` | 5 | `notes/custom-fields-admin.feature` (4) + expand 1 | DELETE |

### Phase 4: Migrate Remaining Migratable Specs (7 files, 58 tests)

These require new BDD features or expanding existing ones:

| Spec File | Tests | Action |
|-----------|-------|--------|
| `admin-flow.spec.ts` | 17 | Create `desktop/admin/admin-flow.feature` or merge into existing admin features |
| `webrtc-settings.spec.ts` | 10 | Expand `desktop/settings/webrtc-settings.feature` (+7 scenarios) |
| `telephony-provider.spec.ts` | 10 | Expand `desktop/calls/telephony-provider.feature` (+5 after Epic 231) |
| `crypto-interop.spec.ts` | 23 | Expand `crypto/crypto-interop.feature` (+15 IPC-specific scenarios, tagged `@desktop`) |
| `login-restore.spec.ts` | 10 | Create `auth/login-restore.feature` with session persistence scenarios |
| `pin-challenge.spec.ts` | 3 | Expand `auth/pin-setup.feature` or `pin-unlock.feature` |
| `auth-guards.spec.ts` | 7 | Expand `auth/login.feature` with route guard scenarios |

For each:
1. Write scenarios matching spec test coverage
2. Write step definitions
3. Verify BDD tests pass
4. Delete spec file

### Phase 5: Keep as Infrastructure Specs (7 files, 22 tests)

These spec files are **NOT migratable** to BDD and should remain:

| Spec File | Tests | Reason |
|-----------|-------|--------|
| `bootstrap.spec.ts` | 6 | Admin state reset — runs in isolated Playwright project |
| `smoke.spec.ts` | 6 | Quick sanity checks — useful as separate CI gate |
| `responsive.spec.ts` | 2 | Mobile viewport — runs in `mobile-chromium` project |
| `capture-screenshots.spec.ts` | 1 | Asset generation — not a test |
| `records-architecture.spec.ts` | 13 | Architecture validation — complex multi-step API assertions |
| `epic-24-27.spec.ts` | 14 | Feature-specific integration tests — complex state setup |
| `client-transcription.spec.ts` | 2 | WASM/WebWorker isolation — requires special browser context |

**Note**: `records-architecture.spec.ts` and `epic-24-27.spec.ts` could potentially be migrated in a future epic, but their complex multi-step API assertions make BDD awkward. Keep them for now.

## File Changes

### Deleted files (30 spec files total across Phases 1-4):
Phases 1+3: 23 fully-migrated spec files
Phase 4: 7 newly-migrated spec files

### New files (~12 step definition files):
- `tests/steps/settings/device-link-steps.ts`
- `tests/steps/dashboard/calls-today-steps.ts`
- `tests/steps/notes/note-thread-steps.ts`
- `tests/steps/shifts/shift-detail-steps.ts`
- `tests/steps/admin/volunteer-profile-steps.ts`
- `tests/steps/auth/login-restore-steps.ts`
- `tests/steps/auth/auth-guard-steps.ts`
- `tests/steps/crypto/crypto-ipc-steps.ts`
- Plus expansions to 8+ existing step files

### New/modified feature files (~5):
- `packages/test-specs/features/auth/login-restore.feature` (new, 10 scenarios)
- `packages/test-specs/features/desktop/settings/webrtc-settings.feature` (expand +7)
- `packages/test-specs/features/crypto/crypto-interop.feature` (expand +15 `@desktop`)
- Various minor expansions to existing features

## Verification

After each phase:
```bash
# All BDD tests pass
bun run test -- --project=bdd

# Remaining spec tests pass
bun run test -- --project=chromium

# No deleted spec tests were lost (count should remain stable or increase)
bun run test -- --reporter=list 2>&1 | grep -c "passed"

# Full CI gate
bun run typecheck && bun run build && bun run test
```

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| .spec.ts files | 39 | 7 (infrastructure-only) |
| .spec.ts tests | 336 | ~42 (infrastructure) |
| BDD feature files | 75→80 (after Epic 231) | ~85 (+5 new) |
| BDD scenarios | ~420 (after Epic 231) | ~454 (+34 new) |
| Step definition files | 26 | ~38 (+12 new) |
| Duplicate test coverage | ~150 tests | 0 |
| BDD coverage of desktop E2E | ~60% | ~92% |

## Risk Mitigation

- **Incremental deletion**: Delete one spec file at a time, run full test suite after each
- **Assertion parity**: Before deleting a spec, verify its key assertions exist in BDD steps
- **CI stability**: Run full CI pipeline after each phase commit
- **Rollback**: Each phase is an independent commit — easy to revert specific deletions

## Dependencies

- **Requires**: Epic 231 (shared spec consolidation)
- **Enables**: Cleaner CI, single BDD-driven test suite, easier cross-platform test sharing
