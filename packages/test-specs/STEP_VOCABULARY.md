# Shared Step Vocabulary

Canonical Given/When/Then phrases that all platform step definitions must implement. Platform runners use these exact phrases for step matching.

## Platform Tags

| Tag | Platforms | Used For |
|-----|-----------|----------|
| `@android` | Android Cucumber | Android-specific scenarios |
| `@ios` | iOS XCUITest | iOS-specific scenarios |
| `@desktop` | Playwright-BDD | Desktop-specific scenarios |
| `@smoke` | All tagged platforms | Quick CI regression subset |
| `@regression` | All tagged platforms | Full test suite |
| `@crypto` | All tagged platforms | Crypto-specific tests |
| `@requires-network` | All tagged platforms | Tests needing network |
| `@requires-camera` | All tagged platforms | Tests needing camera |

Scenarios inherit tags from their Feature. A scenario tagged `@android @ios @desktop` runs on all platforms.

## Auth Steps

```gherkin
Given the app is freshly installed
Given no identity exists on the device
Given an identity exists with PIN {string}
Given I am logged in
Given I am logged in as an admin
When the app launches
When I enter PIN {string}
```

## Navigation Steps

```gherkin
When I navigate to the {string} tab
When I navigate back
When I scroll down
When I scroll to and tap {string}
Then the {string} tab should be selected
```

## Interaction Steps

```gherkin
When I tap {string}
When I enter {string} in the {string} field
When I clear the {string} field
When I toggle {string}
```

## Assertion Steps

```gherkin
Then I should see {string}
Then I should not see {string}
Then I should see the {string} screen
Then I should see the {string} element
Then I should see the {string} button
Then I should see the {string} input
Then the list should be empty or have items
Then I should see {int} items in the list
```

## Data Steps

```gherkin
Given at least one note exists
Given the shift schedule is empty
When I create a note with text {string}
When I fill in {string} with {string}
```

## Notes

- Step phrases are **case-sensitive** for Cucumber matching
- `{string}` parameters use double quotes in feature files: `When I tap "Save"`
- `{int}` parameters are bare numbers: `Then I should see 3 items`
- Platform-specific steps (e.g., bottom tab navigation vs sidebar) use the same vocabulary but different implementations
- Not all steps need to be in this vocabulary — domain-specific steps can be added per-feature as long as all platforms implementing the scenario use the same phrase
