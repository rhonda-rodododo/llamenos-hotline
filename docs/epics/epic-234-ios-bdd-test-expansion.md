# Epic 234: iOS BDD Test Expansion

## Goal

Expand the iOS XCUITest suite from 76 tests to ~200+ tests, aligned with the shared BDD specs in `packages/test-specs/features/`. Use XCTContext.runActivity() for Gherkin-style naming (Given/When/Then) without adding a third-party BDD framework. Implement missing iOS UI features required by shared specs. Update `validate-coverage.ts` to track iOS coverage.

## Context

Current iOS test state:
- **7 test files, 76 test methods** (2 unit, 5 XCUITest)
- **~14% coverage** of shared BDD scenarios (447+ scenarios)
- **No BDD infrastructure** — pure XCTest/XCUITest
- **Missing app features**: call history, reports, contacts, note editing, note search, blasts
- **Existing features untested**: dashboard details, settings, admin advanced, form validation
- **Requires macOS**: Cannot build/test from Linux — CI only

## Approach: Gherkin-as-Specification (No Runtime Dependency)

Following the pattern established in Epic 227, use:

```swift
func testDashboardDisplaysShiftStatusCard() {
    XCTContext.runActivity(named: "Given I am authenticated and on the dashboard") { _ in
        launchAuthenticated()
    }
    XCTContext.runActivity(named: "Then I should see the shift status card") { _ in
        XCTAssertTrue(app.staticTexts["shift-status-card"].waitForExistence(timeout: 5))
    }
}
```

This approach:
- Maps 1:1 to shared `.feature` scenarios
- No SPM dependencies needed
- XCTest reports show Given/When/Then in Xcode results
- `validate-coverage.ts` can parse method names to verify coverage

## Deliverables

### Phase 1: Test Infrastructure Improvements

#### 1.1 Shared Test Helpers

**`apps/ios/Tests/Helpers/TestNavigationHelper.swift`**:
```swift
import XCTest

/// Shared navigation helpers for all UI test classes.
class TestNavigationHelper {
    let app: XCUIApplication

    init(_ app: XCUIApplication) {
        self.app = app
    }

    func launchClean() {
        app.launchArguments.append("--reset-keychain")
        app.launch()
    }

    func launchAuthenticated() {
        app.launchArguments.append("--test-authenticated")
        app.launch()
    }

    func launchAsAdmin() {
        app.launchArguments.append("--test-authenticated")
        app.launchArguments.append("--test-admin")
        app.launch()
    }

    func tapTab(_ name: String) {
        app.tabBars.buttons[name].tap()
    }

    func waitForElement(_ identifier: String, timeout: TimeInterval = 5) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier]
        XCTAssertTrue(element.waitForExistence(timeout: timeout),
                      "Element '\(identifier)' not found within \(timeout)s")
        return element
    }
}
```

#### 1.2 Base Test Class

**`apps/ios/Tests/Helpers/BaseUITest.swift`**:
```swift
import XCTest

/// Base class for all BDD-aligned UI tests.
class BaseUITest: XCTestCase {
    var app: XCUIApplication!
    var nav: TestNavigationHelper!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        nav = TestNavigationHelper(app)
    }

    override func tearDown() {
        app = nil
        nav = nil
        super.tearDown()
    }

    /// BDD-style step wrapper for cleaner Xcode output
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

### Phase 2: Expand Existing Test Files

#### 2.1 Dashboard Tests (20 new tests → 20 total)

**`apps/ios/Tests/DashboardUITests.swift`** (new file, replacing dashboard assertions from AuthFlowUITests):

```swift
class DashboardUITests: BaseUITest {
    // Existing: dashboard shows identity + lock (from AuthFlowUITests, moved here)

    // dashboard-display.feature (8 scenarios)
    func testDashboardShowsConnectionStatusCard() { ... }
    func testDashboardShowsShiftStatusCard() { ... }
    func testDashboardShowsCallsCard() { ... }
    func testDashboardShowsNotesCard() { ... }
    func testDashboardShowsVolunteerName() { ... }
    func testDashboardShowsQuickActionCards() { ... }
    func testDashboardPullToRefreshUpdatesCards() { ... }
    func testDashboardShowsLockButton() { ... }

    // shift-status.feature (2 scenarios)
    func testShiftStatusShowsOnShiftWhenActive() { ... }
    func testShiftStatusShowsOffShiftWhenInactive() { ... }

    // dashboard-quick-actions.feature (5 scenarios)
    func testQuickActionNavigatesToNotes() { ... }
    func testQuickActionNavigatesToConversations() { ... }
    func testQuickActionNavigatesToShifts() { ... }
    func testQuickActionNavigatesToSettings() { ... }
    func testQuickActionNavigatesToAdmin() { ... }

    // calls-today.feature (2 scenarios, promoted from Android)
    func testCallsTodayCountDisplayed() { ... }
    func testCallsTodayUpdatesOnRefresh() { ... }

    // dashboard-errors.feature (2 scenarios)
    func testDashboardShowsErrorOnNetworkFailure() { ... }
    func testDashboardErrorDismissible() { ... }
}
```

#### 2.2 Notes Tests (15 new tests → 22 total)

**`apps/ios/Tests/NoteFlowUITests.swift`** (expand existing):

```swift
// Add to existing file:

// note-edit.feature (3 scenarios)
func testEditNoteBody() { ... }
func testEditNoteCancellation() { ... }
func testEditNoteValidation() { ... }

// notes-search.feature (3 scenarios)
func testSearchNotesByKeyword() { ... }
func testSearchShowsNoResultsMessage() { ... }
func testClearSearchRestoresFullList() { ... }

// note-thread.feature (5 scenarios, promoted from Android)
func testThreadSectionVisibleOnDetail() { ... }
func testEmptyThreadShowsPlaceholder() { ... }
func testReplyCountInThreadHeader() { ... }
func testReplyInputAndSendButton() { ... }
func testReplyBadgeOnNoteCard() { ... }

// notes-custom-fields.feature (4 key scenarios)
func testCustomFieldsDisplayOnNoteForm() { ... }
func testDropdownCustomFieldSelection() { ... }
func testCheckboxCustomFieldToggle() { ... }
func testTextCustomFieldInput() { ... }
```

#### 2.3 Settings Tests (25 new tests → 25 total)

**`apps/ios/Tests/SettingsUITests.swift`** (new file):

```swift
class SettingsUITests: BaseUITest {
    // settings-display.feature (6 scenarios)
    func testSettingsShowsProfileSection() { ... }
    func testSettingsShowsAppearanceSection() { ... }
    func testSettingsShowsSecuritySection() { ... }
    func testSettingsShowsAboutSection() { ... }
    func testSettingsShowsLogoutButton() { ... }
    func testSettingsShowsLockButton() { ... }

    // profile-settings.feature (6 key scenarios)
    func testEditDisplayName() { ... }
    func testEditPhoneNumber() { ... }
    func testViewPublicKey() { ... }
    func testCopyPublicKey() { ... }
    func testProfileShowsRoleBadge() { ... }
    func testProfileShowsJoinDate() { ... }

    // theme.feature (6 scenarios)
    func testThemeLightModeSelection() { ... }
    func testThemeDarkModeSelection() { ... }
    func testThemeSystemModeSelection() { ... }
    func testThemePersistsAfterRelaunch() { ... }
    func testThemeSwitchUpdatesUI() { ... }
    func testThemeDefaultIsSystem() { ... }

    // language-selection.feature (5 scenarios, promoted from Android)
    func testLanguageSectionVisible() { ... }
    func testLanguageChipsDisplayAllLocales() { ... }
    func testSelectLanguage() { ... }
    func testSpokenLanguagesVisible() { ... }
    func testToggleSpokenLanguage() { ... }

    // lock-logout.feature (2 key scenarios)
    func testLockNavigatesToPINScreen() { ... }
    func testLogoutClearsSessionAndNavigatesToLogin() { ... }
}
```

#### 2.4 Auth Tests (12 new tests → 21 total)

**`apps/ios/Tests/AuthFlowUITests.swift`** (expand existing):

```swift
// form-validation.feature (7 scenarios)
func testLoginRejectsEmptyHubUrl() { ... }
func testLoginRejectsInvalidUrlFormat() { ... }
func testOnboardingRejectsShortPIN() { ... }
func testOnboardingRejectsMismatchedPINConfirm() { ... }
func testImportRejectsInvalidNsec() { ... }
func testImportRejectsEmptyNsec() { ... }
func testPINUnlockShowsErrorOnWrongPIN() { ... }

// invite-onboarding.feature (4 scenarios)
func testInviteCodeInputScreen() { ... }
func testInviteCodeValidation() { ... }
func testInviteCodeRedemption() { ... }
func testInviteCodeExpired() { ... }

// panic-wipe.feature (1 key scenario — hardware key handling may differ on iOS)
func testPanicWipeDeletesAllData() { ... }
```

#### 2.5 Admin Tests (16 new tests → 27 total)

**`apps/ios/Tests/AdminFlowUITests.swift`** (expand existing):

```swift
// roles.feature (4 key scenarios)
func testRolesListShowsDefaultRoles() { ... }
func testCreateCustomRole() { ... }
func testDeleteCustomRole() { ... }
func testAssignRoleToVolunteer() { ... }

// volunteer-profile.feature (5 scenarios, promoted from Android)
func testNavigateToVolunteerProfile() { ... }
func testProfileCardShowsInfo() { ... }
func testProfileShowsJoinDate() { ... }
func testRecentActivitySection() { ... }
func testNavigateBackFromProfile() { ... }

// demo-mode.feature (3 key scenarios)
func testDemoModeLoginButtons() { ... }
func testDemoModeBanner() { ... }
func testDemoModeExitButton() { ... }

// access-control.feature (3 scenarios)
func testVolunteerCannotAccessAdminTabs() { ... }
func testReporterSeesLimitedNavigation() { ... }
func testAdminSeesAllNavigation() { ... }

// audit-log.feature (1 additional scenario)
func testAuditLogFiltersByEventType() { ... }
```

#### 2.6 Conversation Tests (7 new tests → 13 total)

**`apps/ios/Tests/ConversationFlowUITests.swift`** (expand existing):

```swift
// conversation-filters.feature (4 scenarios)
func testFilterByActiveConversations() { ... }
func testFilterByClosedConversations() { ... }
func testFilterShowsAllConversations() { ... }
func testSearchConversationsByContact() { ... }

// conversation-assign.feature (2 scenarios)
func testAssignConversationToVolunteer() { ... }
func testAutoAssignConversation() { ... }

// conversation-notes.feature (1 key scenario)
func testAttachNoteToConversation() { ... }
```

#### 2.7 Shift Tests (5 new tests → 15 total)

**`apps/ios/Tests/ShiftFlowUITests.swift`** (expand existing):

```swift
// shift-detail.feature (5 scenarios, promoted from Android)
func testNavigateToShiftDetail() { ... }
func testShiftDetailShowsInfo() { ... }
func testShiftDetailShowsVolunteerAssignments() { ... }
func testToggleVolunteerAssignment() { ... }
func testNavigateBackFromShiftDetail() { ... }
```

### Phase 3: New Test Files for Missing Coverage

#### 3.1 Crypto Interop Tests (8 new tests → 27 total)

**`apps/ios/Tests/CryptoServiceTests.swift`** (expand existing — currently has 19 test methods):

```swift
// crypto-interop.feature (8 scenarios)
func testKeypairInteropWithRustTestVectors() { ... }
func testPINEncryptionInteropWithTestVectors() { ... }
func testAuthTokenInteropWithTestVectors() { ... }
func testNoteEncryptionInteropWithTestVectors() { ... }
func testDomainSeparationLabelsMatch() { ... }
func testECIESEnvelopeFormat() { ... }
func testHKDFWithApplicationSalt() { ... }
func testSchnorrSignatureFormat() { ... }
```

#### 3.2 Security Tests (6 new tests)

**`apps/ios/Tests/SecurityUITests.swift`** (new file):

```swift
class SecurityUITests: BaseUITest {
    // emergency-wipe.feature (4 scenarios)
    func testEmergencyWipeButtonExists() { ... }
    func testEmergencyWipeConfirmation() { ... }
    func testEmergencyWipeDeletesAllData() { ... }
    func testEmergencyWipeNavigatesToLogin() { ... }

    // key-backup.feature (2 scenarios)
    func testKeyBackupShowsEncryptedFile() { ... }
    func testKeyBackupRestoreFromFile() { ... }
}
```

### Phase 4: Update Coverage Validation

#### Fix and Expand `validate-coverage.ts`

**Critical fix**: The existing `checkIosCoverage()` function looks for `apps/ios/Tests/E2E/` which does not exist — iOS tests live directly in `apps/ios/Tests/`. Must update:

1. Fix `checkIosCoverage()` to scan `IOS_TEST_DIR` directly (not `IOS_TEST_DIR/E2E`)
2. Fix `parsePlatformArg()` to check `existsSync(IOS_TEST_DIR)` instead of `existsSync(join(IOS_TEST_DIR, "E2E"))`
3. Add scenario-to-method mapping via naming convention

```typescript
// Updated checkIosCoverage in packages/test-specs/tools/validate-coverage.ts

function checkIosCoverage(features: Feature[]) {
  const iosFeatures = features.filter(f => f.tags.includes('@ios'))
  // FIX: scan Tests/ directly, not Tests/E2E/
  const iosTestFiles = glob.sync(join(IOS_TEST_DIR, '**/*.swift'))

  if (iosTestFiles.length === 0) {
    console.warn('⚠️  No iOS test files found in', IOS_TEST_DIR)
    return
  }

  // Parse test method names and map to scenarios
  let totalMethods = 0
  for (const file of iosTestFiles) {
    const content = readFileSync(file, 'utf-8')
    const methods = content.match(/func test\w+/g) || []
    totalMethods += methods.length
  }

  const totalScenarios = iosFeatures.reduce((sum, f) => sum + f.scenarios.length, 0)
  const pct = Math.round((totalMethods / totalScenarios) * 100)
  console.log(`iOS: ${totalMethods}/${totalScenarios} scenarios covered (${pct}%)`)
}
```

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| iOS test files | 7 | 10 (+3 new) |
| iOS test methods | 76 | ~200 (+124 new) |
| iOS BDD coverage | ~14% | ~45% |
| iOS unit tests | 33 | 41 (+8 crypto interop) |
| iOS UI tests | 43 | ~159 (+116 new) |

## Scope Limitations

Features that require **iOS app code changes** (not just tests):
- Call history screen — NOT IMPLEMENTED in iOS
- Reports UI — NOT IMPLEMENTED in iOS
- Contacts list — NOT IMPLEMENTED in iOS
- Blasts/messaging UI — NOT IMPLEMENTED in iOS
- Note search — NOT IMPLEMENTED in iOS

These should be separate epics focused on iOS feature development. This epic only adds tests for **features that already exist** in the iOS app or require trivial additions (like accessibility identifiers).

## Dependencies

- **Requires**: Epic 231 (for promoted feature scenarios)
- **Blocked on**: macOS CI runner (cannot execute from Linux)
- **Independent of**: Epics 232, 233 (can run in parallel)

## Notes

- All iOS tests require macOS with Xcode — verified in CI via `ios-tests` job
- XCUITest accessibility identifiers must match the ones used in test helpers
- Some tests may need new `accessibilityIdentifier` values added to iOS Views
- The `--test-authenticated` and `--test-admin` launch arguments must be maintained for test state setup
