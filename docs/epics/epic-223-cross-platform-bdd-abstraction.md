# Epic 223: Cross-Platform BDD Specification Framework

## Overview

Redesign `packages/test-specs/` into a proper cross-platform BDD abstraction layer with platform tagging, shared step vocabulary, and multi-platform CI validation. This is the foundation for Epics 224-227.

## Current State

- 25 `.feature` files in `packages/test-specs/features/` (102 scenarios, 106 Android tests)
- No platform tags — all features implicitly target Android only
- `validate-coverage.ts` only validates Android Kotlin `@Test` methods
- No shared step vocabulary — each platform reinvents Given/When/Then phrasing
- Desktop has 40 Playwright spec files (361+ tests) with NO corresponding `.feature` files

## Goals

1. Platform tag system: `@all`, `@desktop`, `@android`, `@ios`, `@mobile`
2. Shared step vocabulary document defining reusable Given/When/Then patterns
3. Tag all 25 existing feature files with appropriate platform scope
4. Extend `validate-coverage.ts` to validate Android (Cucumber step defs), Desktop (playwright-bdd steps), and iOS (XCUITest methods)
5. Create `packages/test-specs/features/desktop/` directory for desktop-specific features

## Platform Tag Specification

Tags control which platforms must implement a scenario:

```gherkin
@all           # Every platform must implement (auth, basic CRUD)
@mobile        # Android + iOS only (bottom nav, camera/QR, push perms)
@desktop       # Desktop only (sidebar nav, WebRTC, call recording playback)
@android       # Android only (Compose-specific behaviors)
@ios           # iOS only (SwiftUI-specific behaviors)
@smoke         # Quick regression subset for CI
@regression    # Full suite
```

Tag inheritance: Feature-level tags apply to all scenarios. Scenario tags override/extend.

```gherkin
@all @smoke
Feature: Login Screen
  # All scenarios inherit @all @smoke

  @desktop
  Scenario: Login with sidebar navigation visible
    # Gets @all @smoke @desktop
```

## Shared Step Vocabulary

Define a controlled vocabulary of Given/When/Then phrases that all platforms implement identically. Platform step definitions must match these exact phrases.

### Auth Steps
```gherkin
Given the app is freshly installed
Given no identity exists on the device
Given an identity exists with PIN {string}
Given I am logged in
Given I am logged in as an admin
When the app launches
When I enter PIN {string}
When I tap {string}                          # Generic button/link tap
When I enter {string} in the {string} field  # Generic text input
Then I should see {string}                   # Generic text assertion
Then I should see the {string} screen        # Screen/route assertion
Then I should see the {string} element       # testid assertion
Then I should not see {string}
```

### Navigation Steps
```gherkin
When I navigate to the {string} tab          # Bottom nav (mobile) / sidebar (desktop)
When I navigate back
When I scroll down
Then the {string} tab should be selected
```

### Data Steps
```gherkin
Given at least one note exists
Given the shift schedule is empty
When I create a note with text {string}
When I fill in {string} with {string}
Then I should see {int} items in the list
Then the list should be empty or have items   # Handles parallel test state
```

## Feature File Tagging Plan

### Existing Features — Add `@desktop` to make cross-platform

Current tags: `@android @ios @smoke/@regression/@crypto`. Strategy: **add `@desktop`** to all shared features (preserving existing tags). This makes them `@android @ios @desktop` (equivalent to `@all`). Platform runners filter by their own tag:

- Android Cucumber: `tags = "@android"`
- Playwright-BDD: `tags = "@desktop"`
- iOS XCUITest: validate methods for scenarios tagged `@ios`

| Directory | Files | Current Tags | Action |
|-----------|-------|-------------|--------|
| `auth/` | login, onboarding, pin-setup, pin-unlock, key-import | `@android @ios @smoke/@regression` | Add `@desktop` |
| `dashboard/` | dashboard-display, shift-status | `@android @ios @smoke/@regression` | Add `@desktop` |
| `notes/` | note-list, note-create, note-detail | `@android @ios @smoke/@regression` | Add `@desktop` |
| `conversations/` | conversation-list, conversation-filters | `@android @ios @smoke/@regression` | Add `@desktop` |
| `shifts/` | shift-list, clock-in-out | `@android @ios @smoke/@regression` | Add `@desktop` |
| `navigation/` | bottom-navigation | `@android @ios @smoke` | Keep as-is (no `@desktop`) |
| `settings/` | settings-display, lock-logout, device-link | `@android @ios @smoke/@regression` | Add `@desktop` |
| `admin/` | admin-navigation, admin-tabs, access-control | `@android @ios @smoke/@regression` | Add `@desktop` |
| `crypto/` | keypair-generation, pin-encryption, auth-tokens, crypto-interop | `@android @ios @smoke/@crypto` | Add `@desktop` |

Exception: `bottom-navigation.feature` stays `@android @ios` only (desktop uses sidebar navigation).

### New Desktop-Specific Features (written in Epic 225)

These cover the 361 Playwright tests that have no shared `.feature` file:

| Directory | Feature Files | Scenarios (est.) |
|-----------|--------------|-----------------|
| `desktop/navigation/` | sidebar-navigation | 5 |
| `desktop/volunteers/` | volunteer-crud, invite-onboarding | 20 |
| `desktop/shifts/` | shift-management | 12 |
| `desktop/bans/` | ban-management | 10 |
| `desktop/calls/` | call-recording, telephony-provider | 15 |
| `desktop/messaging/` | conversations-full, rcs-channel | 15 |
| `desktop/notes/` | notes-custom-fields, custom-fields-admin | 20 |
| `desktop/admin/` | audit-log, multi-hub, roles | 20 |
| `desktop/settings/` | profile-settings, webrtc-settings | 10 |
| `desktop/misc/` | demo-mode, theme, responsive, blasts, reports, panic-wipe | 25 |

Estimated: ~150 additional desktop-specific scenarios.

## Multi-Platform validate-coverage.ts

Extend the existing validation script to check all 3 platforms:

```
$ bun run test-specs:validate

Platform: Android (cucumber-android step definitions)
  Scanning: apps/android/app/src/androidTest/java/**/steps/**/*.kt
  Matching: @Given/@When/@Then annotations against feature steps
  Coverage: 102/102 scenarios (100%)

Platform: Desktop (playwright-bdd step definitions)
  Scanning: tests/steps/**/*.ts
  Matching: Given()/When()/Then() calls against feature steps
  Coverage: 250/250 scenarios (100%)

Platform: iOS (XCUITest method names)
  Scanning: apps/ios/Tests/E2E/**/*.swift
  Matching: func test*() names against scenario titles
  Coverage: 102/102 scenarios (100%)

Overall: 3/3 platforms at 100% coverage
```

### Validation Rules (BLOCKING prerequisite for Epics 224-227)

The tag-aware validator MUST be implemented in this epic before any new feature files or platform migrations are added. Without tag filtering, adding `@desktop`-only features will break Android validation.

1. Parse feature-level tags from each `.feature` file
2. For `--platform android`: only validate scenarios tagged `@android`
3. For `--platform desktop`: only validate scenarios tagged `@desktop`
4. For `--platform ios`: only validate scenarios tagged `@ios`
5. For `--platform all`: validate each platform's tagged scenarios independently
6. Android validation: match `@Test fun` method names (current approach, also works for Cucumber since step definitions execute the same scenarios)
7. Desktop validation: match step definition files exist for all step phrases in tagged features
8. iOS validation: match `func test*()` method names against scenario titles
9. Report coverage per-platform and overall
10. Fail CI if any platform drops below 100% for its tagged scenarios

## File Changes

### Modified
- `packages/test-specs/tools/validate-coverage.ts` — Multi-platform validation
- `packages/test-specs/README.md` — Updated conventions, tag docs, step vocabulary
- `packages/test-specs/package.json` — Add platform validation flags
- All 25 existing `.feature` files — Add `@all` or `@mobile` tags

### Created
- `packages/test-specs/STEP_VOCABULARY.md` — Shared step phrase reference
- `packages/test-specs/features/desktop/` — Directory structure for desktop-specific features

### Root
- `package.json` — Update `test-specs:validate` to accept `--platform` flag

## Dependencies

None — this epic is the foundation for 224-227.

## Verification

```bash
# Tags applied
grep -r "@all\|@mobile\|@desktop" packages/test-specs/features/ | wc -l  # Should be 25+

# Validation still passes for Android (existing behavior)
bun run test-specs:validate --platform android

# New validation modes work
bun run test-specs:validate --platform all  # Full cross-platform check
```
