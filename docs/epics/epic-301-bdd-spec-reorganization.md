# Epic 301: BDD Spec Reorganization + Backend BDD Suite

**Status**: PENDING
**Priority**: High
**Depends on**: None
**Blocks**: Epic 302, Epic 303
**Branch**: `desktop`

## Summary

Reorganize 94 BDD feature files from per-screen layout to behavior-focused tiers (`core/`, `admin/`, `security/`, `platform/`), rewrite 34 shallow UI-existence tests as behavioral scenarios, delete 6 zero-value tests, create a backend BDD suite that runs shared specs against Docker Compose via API (no UI), and wire it into the Playwright config + test orchestrator. Touches ~120 files across `packages/test-specs/`, `tests/`, `apps/ios/Tests/`, and `scripts/`.

## Problem Statement

The current test suite has three structural problems:

1. **34 tests check UI existence, not behavior.** Example: `dashboard-display.feature` has `Then I should see the "calls-today" element` — this passes even if the element shows "0" when 5 calls happened. It tests DOM structure, not correctness.

2. **No backend BDD.** Backend correctness is only verified indirectly through UI tests. If a Playwright selector breaks, the backend regression is invisible. The simulation framework (`/api/test-simulate/*`) and API helpers (`tests/api-helpers.ts`) already support API-level testing — they just aren't used in a BDD structure.

3. **Feature files are organized by screen, not by behavior.** `features/dashboard/`, `features/settings/`, `features/navigation/` — this encourages "does the screen render?" tests instead of "does the system work?" tests. Consolidating by behavior (call routing, messaging, notes, auth) naturally produces better scenarios.

Current test audit:
- **84 tests** verify real behavior (KEEP)
- **34 tests** are shallow UI checks (REWRITE)
- **6 tests** are zero-value utilities (DELETE)

## Implementation

**Execution**: Phases are sequential (each builds on previous).

### Phase 1: Create New Directory Structure

```bash
cd packages/test-specs/features
mkdir -p core admin security platform/desktop platform/ios platform/android
```

### Phase 2: Write Consolidated Behavioral Feature Files

Create each new feature file by merging scenarios from old files and rewriting shallow ones.

**`core/call-routing.feature`** — merge from:
- `calls/call-history.feature`, `calls/call-note-link.feature`, `calls/call-date-filter.feature`
- `backend/telephony-adapter.feature`, `backend/shift-routing.feature`
- New scenarios for: banned caller rejection, parallel ring, first-pickup-wins, voicemail recording, call history filtering

Example scenario transformation:
```gherkin
# OLD (shallow)
@android @ios @desktop
Scenario: Call history displays
  Given I am logged in as an admin
  When I navigate to the "Calls" tab
  Then I should see the "call-history-list" element

# NEW (behavioral)
@backend @desktop @ios @android
Scenario: Completed call appears in history with correct metadata
  Given the server is reset
  And 2 volunteers are on shift
  When a call arrives from "+15559876543"
  And volunteer 1 answers the call
  And the call is ended
  Then the call history contains 1 entry
  And the most recent call shows status "completed"
  And the most recent call shows caller "+15559876543"
```

**`core/messaging-flow.feature`** — merge from:
- `conversations/conversation-list.feature`, `conversations/conversation-filters.feature`
- `conversations/conversation-assign.feature`, `conversations/conversation-e2ee.feature`
- `conversations/conversation-notes.feature`, `messaging/conversations-full.feature`
- `backend/conversation-routing.feature`
- New scenarios for: SMS/WhatsApp/Signal routing, auto-assignment, delivery status tracking, conversation close/reopen

**`core/note-encryption.feature`** — merge from:
- `notes/note-create.feature` through `notes/notes-search.feature` (8 files)
- `backend/note-encryption.feature`
- New scenarios for: encrypted note create/read roundtrip, multi-admin envelope verification, note threading, custom field data persistence

**`core/auth-login.feature`** — merge from:
- `auth/login.feature` through `auth/panic-wipe.feature` (9 files)
- `backend/auth-verification.feature`, `backend/permission-system.feature`
- New scenarios for: expired token rejection, tampered signature detection, permission denial (403), bootstrap one-shot enforcement

**`core/volunteer-lifecycle.feature`** — new file, extract from:
- `admin/volunteer-profile.feature`, `admin/access-control.feature`, `admin/roles.feature`
- New scenarios for: CRUD, role change → session revocation, invite create/validate/redeem/expire

**`core/reports.feature`** — merge from:
- `reports/report-list.feature` through `reports/report-close.feature` (5 files)

**`core/contacts.feature`** — merge from:
- `contacts/contacts-list.feature`, `contacts/contact-timeline.feature`

**`admin/shift-management.feature`** — merge from:
- `shifts/shift-list.feature` through `shifts/shift-scheduling.feature` (4 files)

**`admin/ban-management.feature`** — keep `bans/ban-management.feature` as-is, add `@backend` scenarios for ban check on incoming call

**`admin/audit-log.feature`** — merge from:
- `admin/audit-log.feature`, `backend/audit-chain.feature`
- New scenario: hash chain integrity verification

**`admin/blast-campaign.feature`** — merge from `messaging/blasts.feature`

**`admin/settings.feature`** — merge from:
- `admin/admin-settings.feature` + relevant scenarios from `settings/` directory
- Rewrite shallow toggles-exist tests as real settings mutation tests

**`admin/custom-fields.feature`** — from `notes/custom-fields-admin.feature`

**`security/crypto-interop.feature`** — merge all 4 `crypto/*.feature` files

**`security/e2ee-roundtrip.feature`** — new: encrypt → store → decrypt across platforms

**`security/session-management.feature`** — new: WebAuthn, session TTL, sliding renewal, revocation

**`security/network-security.feature`** — merge all 3 `security/*.feature` files

**`platform/desktop/*.feature`** — move all `desktop/*.feature` files

Move user-preference settings (theme, language, notifications, profile, key-backup, device-link, lock-logout, emergency-wipe, transcription-preferences, advanced-settings) to `platform/` directories with platform-specific tags, keeping only behavioral scenarios.

### Phase 3: Delete Old Directories and Zero-Value Tests

After verifying all scenarios are migrated:

```bash
# Old directories (empty after migration)
rm -rf packages/test-specs/features/dashboard/
rm -rf packages/test-specs/features/navigation/
rm -rf packages/test-specs/features/help/

# Zero-value test files
rm tests/capture-screenshots.spec.ts
rm tests/admin-system.spec.ts
rm apps/ios/Tests/UI/ScreenshotAuditTests.swift
```

### Phase 4: Update Step Vocabulary and Validation

Update `packages/test-specs/STEP_VOCABULARY.md` to add backend-specific steps:

```gherkin
## Backend Steps (API-level, @backend tag)

Given the server is reset
Given {int} volunteers are on shift
Given {string} is on the ban list
Given {int} calls were completed today
When a call arrives from {string}
When volunteer {int} answers the call
When the call is ended
When the call goes to voicemail
When an SMS arrives from {string} with body {string}
When a WhatsApp message arrives from {string} with body {string}
Then the call status is {string}
Then the call is rejected
Then no volunteers receive a ring
Then a conversation is created
Then the call history contains {int} entry/entries
Then the most recent call shows status {string}
Then the most recent call shows caller {string}
Then the response status is {int}
```

Update `packages/test-specs/tools/validate-coverage.ts` to handle new directory structure.

Update `packages/test-specs/README.md` to document new tier structure and tagging rules.

### Phase 5: Create Backend BDD Step Definitions

Create step definitions in `tests/steps/backend/` that hit the API directly (no browser):

| File | Covers |
|------|--------|
| `tests/steps/backend/common.steps.ts` | Server reset, volunteer/shift setup, ban setup |
| `tests/steps/backend/call-routing.steps.ts` | Simulate calls, answer, end, voicemail, verify call state via API |
| `tests/steps/backend/messaging.steps.ts` | Simulate messages, delivery status, conversation state |
| `tests/steps/backend/notes.steps.ts` | Create/read/update encrypted notes via API, verify threading |
| `tests/steps/backend/auth.steps.ts` | Schnorr login, expired/tampered tokens, permission checks |
| `tests/steps/backend/admin.steps.ts` | Volunteer CRUD, shifts, bans, audit log, settings mutations |
| `tests/steps/backend/security.steps.ts` | Crypto test vectors, E2EE roundtrip, domain separation |

All step definitions use:
- `tests/simulation-helpers.ts` for call/message simulation
- `tests/api-helpers.ts` for authenticated CRUD operations
- Scenario state passed via module-scoped object

### Phase 6: Wire Backend BDD into Playwright Config

Modify `playwright.config.ts`:

```typescript
// Add second BDD config for backend-only scenarios
const backendBddTestDir = defineBddConfig({
  features: "packages/test-specs/features/**/*.feature",
  steps: "tests/steps/backend/**/*.ts",
  outputDir: ".features-gen-backend",
  featuresRoot: "packages/test-specs/features",
  tags: "@backend",
});

// Add project
{
  name: "backend-bdd",
  testDir: backendBddTestDir,
  use: {
    baseURL: process.env.TEST_HUB_URL || "http://localhost:3000",
  },
  dependencies: ["setup"],
},
```

### Phase 7: Add test:backend:bdd Script and Wire into Orchestrator

Create `scripts/test-backend-bdd.sh`:
- Check Docker backend health (start if needed via `bun run test:docker:up`)
- Run `bunx playwright test --project=backend-bdd`
- Report results

Add to `package.json`: `"test:backend:bdd": "scripts/test-backend-bdd.sh"`

Update `scripts/lib/platform-detect.sh` to detect `backend-bdd` as a platform.

### Phase 8: Update Desktop Step Definitions

Update `tests/steps/` to match the reorganized feature files:
- Add missing step definitions for new behavioral scenarios
- Remove step definitions that only served deleted tests
- Add behavioral assertion steps (verify data, not UI existence)

### Phase 9: Verify Android/iOS Compatibility

Verify `apps/android/app/build.gradle.kts` `copyFeatureFiles` task picks up new directory structure (it uses recursive copy, should work).

Verify Android `CucumberHiltRunner` tag filter (`@android and not @wip`) still matches reorganized scenarios.

Document iOS test method mapping for new scenario titles in `packages/test-specs/README.md`.

## Files to Create

| File | Purpose |
|------|---------|
| `packages/test-specs/features/core/call-routing.feature` | Call routing behavioral specs |
| `packages/test-specs/features/core/messaging-flow.feature` | Messaging behavioral specs |
| `packages/test-specs/features/core/note-encryption.feature` | Note encryption behavioral specs |
| `packages/test-specs/features/core/auth-login.feature` | Auth behavioral specs |
| `packages/test-specs/features/core/volunteer-lifecycle.feature` | Volunteer CRUD specs |
| `packages/test-specs/features/core/reports.feature` | Report workflow specs |
| `packages/test-specs/features/core/contacts.feature` | Contact timeline specs |
| `packages/test-specs/features/admin/shift-management.feature` | Shift management specs |
| `packages/test-specs/features/admin/audit-log.feature` | Audit log + hash chain specs |
| `packages/test-specs/features/admin/blast-campaign.feature` | Blast messaging specs |
| `packages/test-specs/features/admin/settings.feature` | Settings mutation specs |
| `packages/test-specs/features/admin/custom-fields.feature` | Custom field admin specs |
| `packages/test-specs/features/security/crypto-interop.feature` | Crypto cross-platform specs |
| `packages/test-specs/features/security/e2ee-roundtrip.feature` | E2EE encrypt/decrypt roundtrip |
| `packages/test-specs/features/security/session-management.feature` | Session lifecycle specs |
| `packages/test-specs/features/security/network-security.feature` | HTTPS, relay, SAS specs |
| `tests/steps/backend/common.steps.ts` | Shared backend Given steps |
| `tests/steps/backend/call-routing.steps.ts` | Call simulation steps |
| `tests/steps/backend/messaging.steps.ts` | Message simulation steps |
| `tests/steps/backend/notes.steps.ts` | Note CRUD API steps |
| `tests/steps/backend/auth.steps.ts` | Auth verification steps |
| `tests/steps/backend/admin.steps.ts` | Admin operations steps |
| `tests/steps/backend/security.steps.ts` | Crypto/security steps |
| `scripts/test-backend-bdd.sh` | Backend BDD runner script |

## Files to Modify

| File | Change |
|------|--------|
| `playwright.config.ts` | Add `backendBddTestDir` + `backend-bdd` project |
| `package.json` | Add `test:backend:bdd` script |
| `packages/test-specs/README.md` | Rewrite for new tier structure |
| `packages/test-specs/STEP_VOCABULARY.md` | Add backend step vocabulary |
| `packages/test-specs/tools/validate-coverage.ts` | Update for new directories |
| `scripts/lib/platform-detect.sh` | Add backend-bdd detection |
| `scripts/test-orchestrator.sh` | Include backend-bdd in platform list |
| `tests/steps/**/*.ts` | Update desktop steps for reorganized features |

## Files to Delete

| File | Reason |
|------|--------|
| `tests/capture-screenshots.spec.ts` | Manual utility, not a test |
| `tests/admin-system.spec.ts` | Mock-only, tests nothing real |
| `apps/ios/Tests/UI/ScreenshotAuditTests.swift` | Visual audit, no assertions |
| `packages/test-specs/features/help/help-screen.feature` | "Help screen displays" = no behavior |
| `packages/test-specs/features/navigation/bottom-navigation.feature` | "Nav items visible" = no behavior |
| Old directories after migration | `dashboard/`, `navigation/`, `help/` |

## Testing

- `bun run test:backend:bdd` — new backend BDD suite passes against Docker Compose
- `PLAYWRIGHT_TEST=true bunx playwright test --project=bdd` — desktop BDD passes with reorganized features
- `bun run typecheck` — no TypeScript errors in new step definitions
- `bun run test-specs:validate` — coverage validator works with new structure
- Verify Android `copyFeatureFiles` picks up new directories
- `bun run test:all` — full integration gate passes

## Acceptance Criteria & Test Scenarios

- [ ] 94 feature files reorganized into `core/` (7), `admin/` (6), `security/` (4), `platform/` (rest)
  → Verify with `find packages/test-specs/features -name '*.feature' | wc -l` (count preserved minus 6 deleted)
- [ ] 34 shallow UI-existence scenarios rewritten as behavioral tests
  → Every scenario uses Then clauses that verify state/data, not element visibility
- [ ] 6 zero-value tests deleted
  → `tests/capture-screenshots.spec.ts`, `tests/admin-system.spec.ts`, `apps/ios/Tests/UI/ScreenshotAuditTests.swift`, `help-screen.feature`, `bottom-navigation.feature` removed
- [ ] Backend BDD suite exists with 7 step definition files in `tests/steps/backend/`
  → `bun run test:backend:bdd` passes
- [ ] Backend BDD wired into Playwright config as `backend-bdd` project
  → `bunx playwright test --project=backend-bdd` works
- [ ] Backend BDD wired into test orchestrator
  → `bun run test:all` includes backend-bdd results
- [ ] Desktop BDD passes with reorganized features
  → `bunx playwright test --project=bdd` passes
- [ ] Step vocabulary updated with backend steps
  → `packages/test-specs/STEP_VOCABULARY.md` includes backend section
- [ ] Android copyFeatureFiles works with new structure
  → `cd apps/android && ./gradlew copyFeatureFiles` succeeds
- [ ] All platform tests pass (`bun run test:all`)
- [ ] Backlog files updated

## Self-Review Fixes

- Verified all "Files to Modify" paths exist in codebase
- Verified all "Files to Delete" paths exist in codebase
- Confirmed `packages/test-specs/features/core/` and `platform/` directories don't exist yet (created in Phase 1)
- Confirmed `tests/steps/backend/` directory doesn't exist yet (created in Phase 5)
- Added: `.features-gen-backend/` must be added to `.gitignore` (currently only `.features-gen/` is listed)
- Confirmed `.claude/skills/bdd-feature-development/` directory already exists (empty) — ready for Epic 302
- Confirmed Android `copyFeatureFiles` uses recursive Copy from `packages/test-specs/features` — will pick up new subdirs automatically
- Note: `admin/`, `security/` directories already exist in features/ with different files — new files will be added alongside, old ones removed after migration

## Risk Assessment

- **Medium risk**: Feature file reorganization is large (94 files) — could miss scenarios during migration. Mitigate with `validate-coverage.ts` + manual scenario count verification.
- **Medium risk**: Desktop step definitions may break if Gherkin phrases change during rewrite. Mitigate by running `bunx playwright test --project=bdd` after each batch of changes.
- **Low risk**: Backend BDD step definitions — uses existing, well-tested simulation framework.
