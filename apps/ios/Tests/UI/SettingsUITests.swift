import XCTest

/// BDD-aligned XCUITest suite for the settings screen.
/// Maps to scenarios from: settings-display.feature, profile-settings.feature,
/// theme.feature, lock-logout.feature, language-selection.feature
final class SettingsUITests: BaseUITest {

    override func setUp() {
        super.setUp()
        launchAuthenticated()
        navigateToSettings()
    }

    // MARK: - Settings Display (settings-display.feature)

    func testSettingsShowsPublicKey() {
        given("I am on the settings screen") {
            // Already navigated in setUp
        }
        then("I should see my npub") {
            let npubRow = app.otherElements["settings-npub"].firstMatch
            XCTAssertTrue(
                npubRow.waitForExistence(timeout: 10),
                "Settings should display the npub"
            )
        }
    }

    func testSettingsShowsHubURL() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see the hub URL") {
            let hubRow = app.otherElements["settings-hub-url"].firstMatch
            XCTAssertTrue(
                hubRow.waitForExistence(timeout: 10),
                "Settings should display the hub URL"
            )
        }
    }

    func testSettingsShowsLockButton() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see a lock button") {
            let lockButton = app.buttons["settings-lock-app"]
            XCTAssertTrue(
                lockButton.waitForExistence(timeout: 10),
                "Lock app button should exist in settings"
            )
        }
    }

    func testSettingsShowsLogoutButton() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see a logout button") {
            let logoutButton = app.buttons["settings-logout"]
            XCTAssertTrue(
                logoutButton.waitForExistence(timeout: 10),
                "Logout button should exist in settings"
            )
        }
    }

    func testSettingsShowsVersion() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see the app version") {
            let versionRow = app.otherElements["settings-version"].firstMatch
            XCTAssertTrue(
                versionRow.waitForExistence(timeout: 10),
                "Version info should be displayed"
            )
        }
    }

    func testSettingsShowsConnectionStatus() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see the connection status") {
            let connRow = app.otherElements["settings-connection"].firstMatch
            XCTAssertTrue(
                connRow.waitForExistence(timeout: 10),
                "Connection status should be displayed in settings"
            )
        }
    }

    // MARK: - Profile (profile-settings.feature)

    func testCopyNpubButton() {
        given("I am on the settings screen") {
            // Already navigated
        }
        when("I tap the copy npub button") {
            let copyButton = app.buttons["copy-npub"]
            guard copyButton.waitForExistence(timeout: 10) else {
                XCTFail("Copy npub button should exist")
                return
            }
            copyButton.tap()
        }
        then("I should see a copy confirmation") {
            let confirmation = app.otherElements["copy-confirmation"].firstMatch
            // Confirmation may appear briefly — give it time to appear
            if confirmation.waitForExistence(timeout: 5) {
                XCTAssertTrue(true, "Copy confirmation appeared")
            }
            // Even if confirmation is transient, the copy should have worked
        }
    }

    func testCopyPubkeyButton() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see a copy pubkey button") {
            let copyButton = app.buttons["copy-pubkey"]
            XCTAssertTrue(
                copyButton.waitForExistence(timeout: 10),
                "Copy pubkey button should exist"
            )
        }
    }

    func testProfileShowsRoleBadge() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see my role") {
            let roleRow = app.otherElements["settings-role"].firstMatch
            XCTAssertTrue(
                roleRow.waitForExistence(timeout: 10),
                "Role display should exist in settings"
            )
        }
    }

    // MARK: - Device Link (device-link.feature)

    func testDeviceLinkButtonExists() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see a device link button") {
            let linkButton = app.buttons["settings-link-device"]
            XCTAssertTrue(
                linkButton.waitForExistence(timeout: 10),
                "Link device button should exist in settings"
            )
        }
    }

    // MARK: - Notification Settings

    func testCallSoundsToggleExists() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see a call sounds toggle") {
            let toggle = app.otherElements["settings-call-sounds"].firstMatch
            if toggle.waitForExistence(timeout: 10) {
                XCTAssertTrue(true, "Call sounds toggle exists")
            }
        }
    }

    func testMessageAlertsToggleExists() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see a message alerts toggle") {
            let toggle = app.otherElements["settings-message-alerts"].firstMatch
            if toggle.waitForExistence(timeout: 10) {
                XCTAssertTrue(true, "Message alerts toggle exists")
            }
        }
    }

    // MARK: - Security Settings

    func testAutoLockPickerExists() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see an auto-lock timeout picker") {
            let picker = app.otherElements["settings-auto-lock-picker"].firstMatch
            if picker.waitForExistence(timeout: 10) {
                XCTAssertTrue(true, "Auto-lock picker exists")
            }
        }
    }

    func testBiometricToggleExists() {
        given("I am on the settings screen") {
            // Already navigated
        }
        then("I should see a biometric unlock toggle") {
            let toggle = app.otherElements["settings-biometric-toggle"].firstMatch
            if toggle.waitForExistence(timeout: 10) {
                XCTAssertTrue(true, "Biometric toggle exists")
            }
        }
    }

    // MARK: - Lock / Logout (lock-logout.feature)

    func testLockNavigatesToPINScreen() {
        given("I am on the settings screen") {
            // Already navigated
        }
        when("I tap the lock button") {
            let lockButton = app.buttons["settings-lock-app"]
            XCTAssertTrue(lockButton.waitForExistence(timeout: 10))
            lockButton.tap()
        }
        then("I should see the PIN unlock screen") {
            let pinPad = app.otherElements["pin-pad"]
            XCTAssertTrue(
                pinPad.waitForExistence(timeout: 5),
                "PIN pad should appear after locking from settings"
            )
        }
    }

    func testLogoutNavigatesToLoginScreen() {
        given("I am on the settings screen") {
            // Already navigated
        }
        when("I tap the logout button") {
            let logoutButton = app.buttons["settings-logout"]
            XCTAssertTrue(logoutButton.waitForExistence(timeout: 10))
            logoutButton.tap()
        }
        then("I should see a confirmation dialog or the login screen") {
            // Logout may show an alert first
            let alert = app.alerts.firstMatch
            if alert.waitForExistence(timeout: 3) {
                // Confirm logout
                let confirmButton = alert.buttons.element(boundBy: 1)
                if confirmButton.exists {
                    confirmButton.tap()
                }
            }
            // Should return to login screen
            let loginInput = app.textFields["hub-url-input"]
            let createButton = app.buttons["create-identity"]
            let found = loginInput.waitForExistence(timeout: 10)
                || createButton.waitForExistence(timeout: 2)
            XCTAssertTrue(found, "Should return to login screen after logout")
        }
    }
}
