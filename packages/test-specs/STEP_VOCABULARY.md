# Shared Step Vocabulary

Canonical Given/When/Then phrases that all platform step definitions must implement. Platform runners use these exact phrases for step matching.

## Platform Tags

| Tag | Platforms | Used For |
|-----|-----------|----------|
| `@backend` | Playwright API-only | Backend behavioral tests (no UI) |
| `@android` | Android Cucumber | Android-specific scenarios |
| `@ios` | iOS XCUITest | iOS-specific scenarios |
| `@desktop` | Playwright-BDD | Desktop-specific scenarios |
| `@smoke` | All tagged platforms | Quick CI regression subset |
| `@regression` | All tagged platforms | Full test suite |
| `@crypto` | All tagged platforms | Crypto-specific tests |
| `@security` | All tagged platforms | Security enforcement tests |
| `@requires-network` | All tagged platforms | Tests needing network |
| `@requires-camera` | All tagged platforms | Tests needing camera |

Scenarios inherit tags from their Feature. A scenario tagged `@backend @desktop @ios @android` runs on all platforms.

## Auth Steps

```gherkin
Given the app is freshly installed
Given no identity exists on the device
Given an identity exists with PIN {string}
Given I am logged in
Given I am logged in as an admin
Given I am logged in as a volunteer
Given I am logged in as a reporter
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

## Backend Steps (API-level, @backend tag)

These steps use only API assertions -- no UI interaction. They are implemented
in `tests/steps/backend/` using `APIRequestContext`.

### Setup

```gherkin
Given the server is reset
Given {int} volunteers are on shift
Given {string} is on the ban list
Given {int} calls were completed today
Given {int} call went to voicemail today
```

### Call Simulation

```gherkin
When a call arrives from {string}
When volunteer {int} answers the call
When the call is ended
When the call goes to voicemail
Then the call status is {string}
Then the call is rejected
Then no volunteers receive a ring
Then all {int} volunteers receive a ring
Then volunteer {int} no longer receives a ring
```

### Call History Verification

```gherkin
Then the call history contains {int} entry/entries
Then the most recent call shows status {string}
Then the most recent call shows caller {string}
When the call history is filtered by status {string}
When the call history is filtered to today's date
```

### Messaging

```gherkin
When an SMS arrives from {string} with body {string}
When a WhatsApp message arrives from {string} with body {string}
Then a conversation is created
Then the message delivery status is {string}
```

### Auth & Permissions

```gherkin
Then the response status is {int}
Then the server should reject with {int}
Then they should pass permission checks for {string}
Then they should fail permission checks for {string}
```

### Security

```gherkin
Then the response should not contain {string}
Then the request should be rejected
Then the request should be rejected with {int}
```

## Notes

- Step phrases are **case-sensitive** for Cucumber matching
- `{string}` parameters use double quotes in feature files: `When I tap "Save"`
- `{int}` parameters are bare numbers: `Then I should see 3 items`
- Platform-specific steps (e.g., bottom tab navigation vs sidebar) use the same vocabulary but different implementations
- Not all steps need to be in this vocabulary -- domain-specific steps can be added per-feature as long as all platforms implementing the scenario use the same phrase
- Backend steps MUST NOT interact with page elements or DOM -- API only
