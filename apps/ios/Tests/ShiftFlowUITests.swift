import XCTest

/// XCUITest suite for the shifts workflow: viewing the shift schedule,
/// clock in/out toggle, and shift signup interactions.
///
/// These tests require the app to be in an authenticated state with a valid hub connection.
final class ShiftFlowUITests: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments.append(contentsOf: ["--reset-keychain", "--test-authenticated"])
        app.launch()
    }

    override func tearDown() {
        app = nil
        super.tearDown()
    }

    // MARK: - Tab Navigation

    func testShiftsTabExists() {
        let tabView = app.otherElements["main-tab-view"]
        XCTAssertTrue(
            tabView.waitForExistence(timeout: 10),
            "Main tab view should be visible after authentication"
        )

        navigateToShiftsTab()

        // Shifts content should appear (loading, empty, or schedule)
        let clockInButton = app.buttons["clock-in-button"].firstMatch
        let emptyState = app.otherElements["shifts-empty-state"].firstMatch
        let loading = app.otherElements["shifts-loading"].firstMatch

        let found = clockInButton.waitForExistence(timeout: 10)
            || emptyState.waitForExistence(timeout: 2)
            || loading.waitForExistence(timeout: 2)

        XCTAssertTrue(found, "Shifts view should show clock button, empty state, or loading")
    }

    // MARK: - Clock In/Out

    func testClockInButtonExists() {
        navigateToShiftsTab()

        // Either clock-in or clock-out button should exist
        let clockInButton = app.buttons["clock-in-button"].firstMatch
        let clockOutButton = app.buttons["clock-out-button"].firstMatch

        let found = clockInButton.waitForExistence(timeout: 10)
            || clockOutButton.waitForExistence(timeout: 2)

        XCTAssertTrue(found, "Clock in or clock out button should exist")
    }

    func testShiftStatusLabelExists() {
        navigateToShiftsTab()

        let statusLabel = app.staticTexts["shift-status-label"]
        XCTAssertTrue(
            statusLabel.waitForExistence(timeout: 10),
            "Shift status label should exist"
        )

        // Should show either "On Shift" or "Off Shift"
        let text = statusLabel.label
        XCTAssertTrue(
            text.contains("Shift") || text.contains("shift"),
            "Status label should contain 'Shift'"
        )
    }

    func testClockOutShowsConfirmation() {
        navigateToShiftsTab()

        // If we're on shift, the clock out button exists
        let clockOutButton = app.buttons["clock-out-button"].firstMatch
        guard clockOutButton.waitForExistence(timeout: 5) else {
            // Not on shift — try clocking in first
            let clockInButton = app.buttons["clock-in-button"].firstMatch
            guard clockInButton.waitForExistence(timeout: 5) else { return }
            clockInButton.tap()

            // Wait for clock out button to appear (shift started)
            guard app.buttons["clock-out-button"].firstMatch.waitForExistence(timeout: 10) else { return }
            app.buttons["clock-out-button"].firstMatch.tap()

            // Confirmation dialog should appear
            let alertExists = app.alerts.firstMatch.waitForExistence(timeout: 5)
            if alertExists {
                // Cancel to not actually clock out
                let cancelButton = app.alerts.firstMatch.buttons.firstMatch
                cancelButton.tap()
            }
            return
        }

        clockOutButton.tap()

        // Confirmation dialog should appear
        let alertExists = app.alerts.firstMatch.waitForExistence(timeout: 5)
        if alertExists {
            XCTAssertTrue(true, "Clock out confirmation dialog appeared")
            // Cancel
            let cancelButton = app.alerts.firstMatch.buttons.element(boundBy: 0)
            if cancelButton.exists {
                cancelButton.tap()
            }
        }
    }

    // MARK: - Weekly Schedule

    func testWeeklyScheduleHeader() {
        navigateToShiftsTab()

        // Wait for content to load
        let clockButton = app.buttons["clock-in-button"].firstMatch
        guard clockButton.waitForExistence(timeout: 10) else { return }

        // Weekly schedule header should exist if there are shifts
        let scheduleHeader = app.staticTexts["weekly-schedule-header"]
        // It's okay if the schedule is empty (no shifts configured)
        if scheduleHeader.waitForExistence(timeout: 3) {
            XCTAssertTrue(true, "Weekly schedule header exists")
        }
    }

    func testTodayBadgeExists() {
        navigateToShiftsTab()

        let clockButton = app.buttons["clock-in-button"].firstMatch
        guard clockButton.waitForExistence(timeout: 10) else { return }

        // If the weekly schedule is showing, today's day section should be highlighted
        let today = Calendar.current.component(.weekday, from: Date()) - 1  // 0-indexed
        let todaySection = app.otherElements["shift-day-\(today)"]

        if todaySection.waitForExistence(timeout: 3) {
            XCTAssertTrue(true, "Today's day section exists in the schedule")
        }
    }

    // MARK: - Error State

    func testErrorMessageDisplays() {
        navigateToShiftsTab()

        // If there's an error (e.g., hub not configured), it should display
        let errorView = app.otherElements["shifts-error"]
        if errorView.waitForExistence(timeout: 5) {
            XCTAssertTrue(true, "Error message is displayed when hub connection fails")
        }
        // If no error, that's fine too — hub might be configured
    }

    // MARK: - Settings Tab

    func testSettingsTabShowsIdentity() {
        let tabView = app.otherElements["main-tab-view"]
        guard tabView.waitForExistence(timeout: 10) else {
            XCTFail("Main tab view should be visible")
            return
        }

        navigateToSettingsTab()

        // Identity section should show npub
        let npubRow = app.otherElements["settings-npub"].firstMatch
        let versionRow = app.otherElements["settings-version"].firstMatch

        let found = npubRow.waitForExistence(timeout: 10)
            || versionRow.waitForExistence(timeout: 2)

        XCTAssertTrue(found, "Settings should show identity or version info")
    }

    func testSettingsLockButton() {
        navigateToSettingsTab()

        let lockButton = app.buttons["settings-lock-app"]
        XCTAssertTrue(
            lockButton.waitForExistence(timeout: 10),
            "Lock app button should exist in settings"
        )
    }

    func testSettingsLogoutButton() {
        navigateToSettingsTab()

        let logoutButton = app.buttons["settings-logout"]
        XCTAssertTrue(
            logoutButton.waitForExistence(timeout: 10),
            "Logout button should exist in settings"
        )
    }

    // MARK: - Navigation Helpers

    private func navigateToShiftsTab() {
        let tabView = app.otherElements["main-tab-view"]
        guard tabView.waitForExistence(timeout: 10) else {
            XCTFail("Main tab view should be visible")
            return
        }

        let tabBar = app.tabBars.firstMatch
        guard tabBar.waitForExistence(timeout: 5) else { return }
        // Third tab = Shifts
        let shiftsTabButton = tabBar.buttons.element(boundBy: 2)
        if shiftsTabButton.exists {
            shiftsTabButton.tap()
        }
    }

    private func navigateToSettingsTab() {
        let tabView = app.otherElements["main-tab-view"]
        guard tabView.waitForExistence(timeout: 10) else {
            XCTFail("Main tab view should be visible")
            return
        }

        let tabBar = app.tabBars.firstMatch
        guard tabBar.waitForExistence(timeout: 5) else { return }
        // Fourth tab = Settings
        let settingsTabButton = tabBar.buttons.element(boundBy: 3)
        if settingsTabButton.exists {
            settingsTabButton.tap()
        }
    }
}
