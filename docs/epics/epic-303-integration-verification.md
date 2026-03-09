# Epic 303: Integration Verification & Workflow Validation

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 301, Epic 302
**Blocks**: None
**Branch**: `desktop`

## Summary

End-to-end verification that the BDD workflow overhaul from Epics 301-302 works correctly. Run the full test suite, validate all platforms, verify the backend BDD pipeline, confirm the Android/iOS compatibility, and do a dry-run of the new phased workflow with a small test feature to prove the approach works before using it for real features.

## Problem Statement

Epics 301 and 302 make sweeping changes to test infrastructure (94 feature files reorganized, backend BDD added, Playwright config modified) and instructions (5 skills updated, CLAUDE.md rewritten). Before these changes are relied upon for real feature development, we need to verify:

1. No test scenarios were lost in the reorganization (scenario count preserved minus 6 deletions)
2. Backend BDD passes against Docker Compose
3. Desktop BDD passes with reorganized feature files
4. Android `copyFeatureFiles` Gradle task picks up new directory structure
5. iOS test method mapping is documented correctly
6. Test orchestrator includes backend-bdd in `bun run test:all`
7. The phased workflow actually works in practice (dry-run)

## Implementation

**Execution**: Phases are sequential.

### Phase 1: Scenario Count Verification

Count scenarios before and after reorganization to ensure none were lost:

```bash
# Before count (from git history)
git stash
grep -r "Scenario:" packages/test-specs/features/ | wc -l
git stash pop

# After count
grep -r "Scenario:" packages/test-specs/features/ | wc -l
```

Expected: after count = before count - (scenarios from 6 deleted files) + (new behavioral scenarios added).

Document the delta with justification for any difference.

### Phase 2: Full Test Suite

```bash
# Start Docker backend
bun run test:docker:up

# Run backend BDD
bun run test:backend:bdd

# Run desktop BDD
PLAYWRIGHT_TEST=true bunx playwright test --project=bdd

# Run full orchestrator
bun run test:all

# Tear down
bun run test:docker:down
```

All must pass. Any failures → diagnose and fix in the relevant epic's files.

### Phase 3: Platform Compatibility Checks

**Android:**
```bash
cd apps/android
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
./gradlew copyFeatureFiles
# Verify new directories exist
ls -R app/src/androidTest/assets/features/core/
ls -R app/src/androidTest/assets/features/admin/
ls -R app/src/androidTest/assets/features/security/
# Compile androidTest to verify no missing step definitions
./gradlew compileDebugAndroidTestKotlin
```

**iOS:**
- Verify test method naming matches new scenario titles in `packages/test-specs/README.md`
- No automated check needed — iOS uses XCUITest, not Cucumber

### Phase 4: Instruction Consistency Check

Read all updated instruction files and verify no contradictions:

| File A | File B | Check |
|--------|--------|-------|
| CLAUDE.md (working style) | epic-authoring skill (batch workflow) | Same 3-phase description? |
| CLAUDE.md (working style) | bdd-feature-development skill (workflow) | Same phases? |
| MEMORY.md (cardinal rule) | bdd-feature-development (test failure) | Consistent philosophy? |
| epic-authoring (self-review items) | bdd-feature-development (scenario quality) | Same quality bar? |
| test-orchestration (platforms) | package.json (scripts) | All mentioned commands exist? |

### Phase 5: Dry-Run Phased Workflow

Execute the new workflow with a trivially small feature to prove it works:

**Test feature: "Dashboard shows volunteer count"**

1. **Epic**: Write a 1-paragraph epic with AC mapped to scenario
2. **Phase 1**:
   - Add scenario to `packages/test-specs/features/core/volunteer-lifecycle.feature`:
     ```gherkin
     @backend @desktop
     Scenario: Dashboard shows correct on-shift volunteer count
       Given the server is reset
       And 3 volunteers are on shift
       When I query the shift status
       Then 3 volunteers are reported as on-shift
     ```
   - Add backend step definition
   - Run `bun run test:backend:bdd` → must pass
3. **Phase 2**:
   - Add desktop step definition (verify dashboard card shows "3")
   - Run `bunx playwright test --project=bdd --grep "volunteer count"` → must pass
4. **Phase 3**:
   - Run `bun run test:all` → must pass

If the dry-run succeeds, the workflow is validated. If it fails, debug and fix before declaring the overhaul complete.

### Phase 6: Cleanup and Final Commit

- Remove any old empty directories left from migration
- Ensure `.features-gen-backend/` is in `.gitignore`
- Update `docs/COMPLETED_BACKLOG.md` with Epic 301, 302, 303 implementation summaries
- Update `docs/NEXT_BACKLOG.md` to check off all three

## Files to Modify

| File | Change |
|------|--------|
| `.gitignore` | Add `.features-gen-backend/` if not already ignored |
| `docs/COMPLETED_BACKLOG.md` | Add Epics 301-303 implementation summaries |
| `docs/NEXT_BACKLOG.md` | Check off Epics 301-303 |
| `packages/test-specs/features/core/volunteer-lifecycle.feature` | Add dry-run scenario (Phase 5) |
| `tests/steps/backend/admin.steps.ts` | Add dry-run step definition (Phase 5) |

## Testing

This epic IS the test. It verifies:
- `bun run test:backend:bdd` — backend BDD suite passes
- `bun run test:all` — full orchestrator passes including backend-bdd
- `bun run test-specs:validate` — coverage validator works with new structure
- Android `copyFeatureFiles` + `compileDebugAndroidTestKotlin` — Android compatible
- Dry-run of phased workflow succeeds end-to-end

## Acceptance Criteria & Test Scenarios

- [ ] Scenario count verified: no scenarios lost in reorganization
  → Document: "{N} scenarios before, {M} after, delta justified"
- [ ] `bun run test:backend:bdd` passes
  → All `@backend` scenarios green
- [ ] `bun run test:all` passes (all platforms including backend-bdd)
  → Zero failures in orchestrator output
- [ ] Android `copyFeatureFiles` picks up new directory structure
  → `core/`, `admin/`, `security/` present in `androidTest/assets/features/`
- [ ] Android `compileDebugAndroidTestKotlin` succeeds
  → No compile errors from reorganized features
- [ ] No contradictions between instruction files
  → Manual review documented
- [ ] Dry-run phased workflow completes successfully
  → "Dashboard shows volunteer count" scenario passes on backend + desktop
- [ ] `.features-gen-backend/` in .gitignore
- [ ] Backlog files updated with all 3 epics

## Risk Assessment

- **Low risk**: This is a verification epic — it doesn't create new functionality, just confirms Epics 301-302 work correctly.
- **Medium risk**: Full `bun run test:all` may surface pre-existing flaky tests unrelated to this overhaul. Distinguish overhaul regressions from pre-existing issues.
