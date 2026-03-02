# @llamenos/test-specs

Cross-platform BDD test specifications using Gherkin `.feature` files.

## Approach

**Gherkin-as-Specification** — feature files are human-readable specifications that drive test writing, not executable Cucumber tests. Android and iOS implement scenarios using their native test frameworks (Compose UI Test, XCUITest) with test method names mirroring Gherkin scenario titles.

## Directory Structure

```
features/
  auth/           # Login, onboarding, PIN setup/unlock, key import
  dashboard/      # Dashboard display, shift actions
  notes/          # Note list, creation, detail view
  conversations/  # Conversation list, filters
  shifts/         # Shift list, clock in/out
  navigation/     # Bottom navigation
  admin/          # Admin navigation, tabs, access control
  settings/       # Settings display, lock/logout, device link
  crypto/         # Keypair generation, PIN encryption, auth tokens, interop
```

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Feature file | `kebab-case.feature` | `pin-setup.feature` |
| Scenario title | Human-readable sentence | `Matching confirmation completes setup` |
| Android test method | `camelCase` | `matchingConfirmationCompletesSetup()` |
| iOS test method | `camelCase` with `test` prefix | `testMatchingConfirmationCompletesSetup()` |

## Tags

```gherkin
@android @ios          # Platform targeting
@smoke                 # Smoke test subset (run on every PR)
@regression            # Full regression suite
@requires-camera       # Requires physical device camera
@requires-network      # Requires API connectivity
@offline               # Works without network
@crypto                # Crypto verification tests
```

## Adding a New Feature

1. Create a `.feature` file in the appropriate directory
2. Write scenarios following Gherkin syntax
3. Implement test methods in Android (`e2e/<area>/`) and iOS (`Tests/E2E/`)
4. Run `bun run test-specs:validate` to verify coverage

## CI Validation

```bash
bun run test-specs:validate   # Validates Android + iOS test coverage
```

The validation script parses `.feature` files, extracts scenario titles, and checks that each platform has a corresponding test method.
