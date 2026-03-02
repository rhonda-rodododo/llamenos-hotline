# Epic 227: iOS BDD E2E Test Foundation

## Overview

Prepare the iOS XCUITest suite for BDD-aligned testing using Gherkin-as-Specification (matching the shared `.feature` files), with `XCTContext.runActivity(named:)` for BDD-style Xcode test reporting. No third-party BDD runner — all iOS BDD frameworks are dead/unmaintained.

## Research Findings

| Framework | Last Update | Status | Verdict |
|-----------|------------|--------|---------|
| Cucumberish | 2021 | Unmaintained, seeking new owner | Avoid |
| XCTest-Gherkin | 2022 | Stale, limited features | Avoid |
| Skylark | Abandoned | WIP, never production | Avoid |
| SwiftGherkin | 2020 | Parser only, no runner | Building block only |
| XCFit | Stale | Wraps dead Cucumberish | Avoid |

**Decision**: Use native XCUITest with strict naming conventions matching Gherkin scenarios, and `XCTContext.runActivity(named:)` for Given/When/Then structured reporting in Xcode.

## Current State

- iOS app in `apps/ios/` with SwiftUI, SPM
- Existing tests in `apps/ios/Tests/` — basic XCTest and XCUITest
- No BDD naming alignment yet
- `validate-coverage.ts` doesn't scan Swift files

## Architecture

### Naming Convention

Scenario title → Swift test method name:

```
Scenario: "Login screen displays all required elements"
→ func testLoginScreenDisplaysAllRequiredElements()
```

Rule: `test` + PascalCase of scenario title (no underscores).

### BDD-Style Reporting with XCTContext

```swift
func testLoginScreenDisplaysAllRequiredElements() {
    XCTContext.runActivity(named: "Given the app is freshly installed") { _ in
        app.launchArguments.append("--reset-keychain")
        app.launch()
    }

    XCTContext.runActivity(named: "When the app launches") { _ in
        // App already launched above
    }

    XCTContext.runActivity(named: "Then I should see the app title") { _ in
        XCTAssertTrue(app.staticTexts["app-title"].waitForExistence(timeout: 5))
    }

    XCTContext.runActivity(named: "Then I should see the hub URL input") { _ in
        XCTAssertTrue(app.textFields["hub-url-input"].waitForExistence(timeout: 5))
    }
}
```

This produces structured output in Xcode's test navigator showing each Given/When/Then step.

## Test Directory Structure

```
apps/ios/Tests/
  E2E/
    Auth/
      LoginScreenTests.swift          # 6 tests from login.feature
      OnboardingFlowTests.swift       # 4 tests from onboarding.feature
      PinSetupTests.swift             # 6 tests from pin-setup.feature
      PinUnlockTests.swift            # 5 tests from pin-unlock.feature
      KeyImportTests.swift            # 3 tests from key-import.feature
    Dashboard/
      DashboardDisplayTests.swift     # 8 tests
      DashboardShiftActionsTests.swift # 2 tests
    Notes/
      NoteListTests.swift             # 3 tests
      NoteCreateTests.swift           # 3 tests
      NoteDetailTests.swift           # 3 tests
    Conversations/
      ConversationListTests.swift     # 3 tests
      ConversationFiltersTests.swift  # 4 tests
    Shifts/
      ShiftListTests.swift            # 3 tests
      ClockInOutTests.swift           # 2 tests
    Navigation/
      TabNavigationTests.swift        # 3 tests (bottom tabs on iOS)
    Settings/
      SettingsDisplayTests.swift      # 6 tests
      LockLogoutTests.swift           # 4 tests
      DeviceLinkTests.swift           # 6 tests
    Admin/
      AdminNavigationTests.swift      # 2 tests
      AdminTabsTests.swift            # 6 tests
      AccessControlTests.swift        # 3 tests
    Crypto/
      KeypairGenerationTests.swift    # 4 tests
      PinEncryptionTests.swift        # 6 tests
      AuthTokenTests.swift            # 3 tests
      CryptoInteropTests.swift        # 8 tests
  Helpers/
    TestNavigationHelper.swift        # Shared auth + navigation helpers
    XCUITestExtensions.swift          # waitForElement, enterPin, etc.
  Unit/
    CryptoServiceTests.swift          # Existing unit tests
    KeychainServiceTests.swift
```

## Shared Test Helpers

### TestNavigationHelper.swift
```swift
import XCTest

enum TestNavigationHelper {
    static let testPin = "1234"

    static func navigateToMainScreen(_ app: XCUIApplication) {
        // Create identity flow
        let createButton = app.buttons["create-identity-button"]
        if createButton.waitForExistence(timeout: 5) {
            createButton.tap()

            // Confirm backup
            let confirmButton = app.buttons["confirm-backup-button"]
            XCTAssertTrue(confirmButton.waitForExistence(timeout: 5))
            confirmButton.tap()

            // Enter PIN
            enterPin(app, pin: testPin)
            // Confirm PIN
            enterPin(app, pin: testPin)

            // Wait for dashboard
            let dashboard = app.otherElements["dashboard-screen"]
            XCTAssertTrue(dashboard.waitForExistence(timeout: 10))
        }
    }

    static func enterPin(_ app: XCUIApplication, pin: String) {
        for digit in pin {
            app.buttons["pin-\(digit)"].tap()
        }
    }

    static func navigateToTab(_ app: XCUIApplication, tab: String) {
        app.tabBars.buttons[tab].tap()
    }
}
```

### XCUITestExtensions.swift
```swift
import XCTest

extension XCUIApplication {
    func waitForElement(
        _ testId: String,
        timeout: TimeInterval = 5
    ) -> XCUIElement {
        let element = otherElements[testId]
            .firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: timeout))
        return element
    }
}

extension XCTestCase {
    /// BDD step helper — wraps action in XCTContext for structured reporting
    func given(_ description: String, block: () throws -> Void) rethrows {
        try XCTContext.runActivity(named: "Given \(description)") { _ in
            try block()
        }
    }

    func when(_ description: String, block: () throws -> Void) rethrows {
        try XCTContext.runActivity(named: "When \(description)") { _ in
            try block()
        }
    }

    func then(_ description: String, block: () throws -> Void) rethrows {
        try XCTContext.runActivity(named: "Then \(description)") { _ in
            try block()
        }
    }
}
```

Usage:
```swift
func testLoginScreenDisplaysAllRequiredElements() {
    given("the app is freshly installed") {
        app.launch()
    }
    when("the app launches") {
        // Already launched
    }
    then("I should see the app title") {
        XCTAssertTrue(app.staticTexts["app-title"].waitForExistence(timeout: 5))
    }
}
```

## Crypto Tests (Non-UI)

```swift
// Tests/E2E/Crypto/KeypairGenerationTests.swift
import XCTest
@testable import Llamenos

final class KeypairGenerationTests: XCTestCase {
    var cryptoService: CryptoService!

    override func setUp() {
        super.setUp()
        cryptoService = CryptoService()
    }

    func testGeneratedKeypairHasValidFormat() {
        given("the crypto service is initialized") {
            // Already initialized in setUp
        }
        when("I generate a keypair") {
            cryptoService.generateKeypair()
        }
        then("the nsec should start with nsec1") {
            XCTAssertTrue(cryptoService.nsec?.hasPrefix("nsec1") == true)
        }
        then("the npub should start with npub1") {
            XCTAssertTrue(cryptoService.npub?.hasPrefix("npub1") == true)
        }
    }
}
```

## Validation Script Extension

Add iOS platform to `validate-coverage.ts`:

```typescript
// iOS test method pattern
const swiftTestRegex = /func\s+(test\w+)\s*\(/g;

// Convert scenario to Swift method name
function scenarioToSwiftMethod(scenario: string): string {
  const camel = scenarioToCamelCase(scenario);  // existing function
  return 'test' + camel.charAt(0).toUpperCase() + camel.slice(1);
}

// Scan Swift files
function scanSwiftTests(dir: string): Map<string, string[]> {
  // Glob for *.swift in Tests/E2E/
  // Extract func test*() names
  // Map back to scenario names
}
```

## Test Vectors

Copy `test-vectors.json` to iOS test bundle:

```swift
// Package.swift — add to test target resources
.testTarget(
    name: "LlamenosUITests",
    dependencies: ["Llamenos"],
    resources: [
        .copy("Resources/test-vectors.json")
    ]
)
```

Or use a build phase script:
```bash
cp ../../packages/crypto/tests/fixtures/test-vectors.json Tests/Resources/
```

## Implementation Phases

### Phase 1: Structure & Helpers
1. Create `Tests/E2E/` directory structure (9 subdirectories)
2. Create `Tests/Helpers/TestNavigationHelper.swift`
3. Create `Tests/Helpers/XCUITestExtensions.swift` (given/when/then helpers)

### Phase 2: Auth Tests (24 scenarios)
4. Create 5 test files in `Tests/E2E/Auth/`

### Phase 3: Core Tests (34 scenarios)
5. Create 11 test files in Dashboard/, Notes/, Conversations/, Shifts/, Navigation/

### Phase 4: Admin/Settings Tests (27 scenarios)
6. Create 6 test files in Settings/, Admin/

### Phase 5: Crypto Tests (21 scenarios)
7. Create 5 test files in Crypto/
8. Copy test-vectors.json to test resources

### Phase 6: Validation
9. Extend `validate-coverage.ts` for Swift scanning
10. Verify: `bun run test-specs:validate --platform ios` reports 100%

## Dependencies

- Epic 223 (platform tags must be applied)
- Mac Mini availability for building and running tests
- iOS app must have accessibility identifiers matching `data-testid` values

## Verification

```bash
# On macOS (Mac Mini):
cd apps/ios && swift build          # Compile
cd apps/ios && swift test           # Run all tests
xcodebuild test -scheme Llamenos -destination 'platform=iOS Simulator,name=iPhone 16'

# Cross-platform validation
bun run test-specs:validate --platform ios  # 102/102 scenarios
```

## Notes

- **Blocked on Mac Mini**: This epic can be fully authored (test files written) but cannot be verified until the Mac Mini is connected. The structure and naming conventions are defined here so that when the Mac Mini arrives, it's plug-and-play.
- **Accessibility identifiers**: iOS uses `accessibilityIdentifier` which maps to Android's `testTag`. The shared test-id values must be consistent across platforms. This is already the convention.
- **No third-party BDD dependency**: Using native XCTest + `XCTContext.runActivity` avoids all maintenance burden from dead BDD frameworks.
