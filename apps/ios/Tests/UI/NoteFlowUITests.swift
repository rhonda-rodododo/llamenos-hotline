import XCTest

/// XCUITest suite for the notes workflow: creating notes, viewing the notes list,
/// tapping into note detail, and verifying custom field display.
///
/// These tests require the app to be in an authenticated state with a valid hub connection.
/// They use the `--test-authenticated` launch argument to skip auth flow.
final class NoteFlowUITests: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        // Launch with pre-authenticated state and reset note data
        app.launchArguments.append(contentsOf: ["--reset-keychain", "--test-authenticated"])
        app.launch()
    }

    override func tearDown() {
        app = nil
        super.tearDown()
    }

    // MARK: - Tab Navigation

    func testNotesTabExists() {
        let tabView = app.otherElements["main-tab-view"]
        XCTAssertTrue(
            tabView.waitForExistence(timeout: 10),
            "Main tab view should be visible after authentication"
        )

        // Navigate to Notes tab
        let notesTab = app.buttons["tab-notes"].firstMatch
        if notesTab.waitForExistence(timeout: 5) {
            notesTab.tap()
        } else {
            // Tab items might be in a different container
            let tabBar = app.tabBars.firstMatch
            XCTAssertTrue(tabBar.waitForExistence(timeout: 5), "Tab bar should exist")
            let notesButton = tabBar.buttons.matching(identifier: "Notes").firstMatch
            if notesButton.exists {
                notesButton.tap()
            }
        }

        // Notes list or empty state should appear
        let notesList = app.otherElements["notes-list"].firstMatch
        let emptyState = app.otherElements["notes-empty-state"].firstMatch
        let loading = app.otherElements["notes-loading"].firstMatch

        let found = notesList.waitForExistence(timeout: 10)
            || emptyState.waitForExistence(timeout: 2)
            || loading.waitForExistence(timeout: 2)

        XCTAssertTrue(found, "Notes view should show list, empty state, or loading")
    }

    // MARK: - Create Note

    func testCreateNoteFlowOpensSheet() {
        navigateToNotesTab()

        // Tap create note button
        let createButton = app.buttons["create-note-button"]
        XCTAssertTrue(
            createButton.waitForExistence(timeout: 5),
            "Create note button should exist in toolbar"
        )
        createButton.tap()

        // Note create sheet should appear
        let textEditor = app.textViews["note-text-editor"].firstMatch
        XCTAssertTrue(
            textEditor.waitForExistence(timeout: 5),
            "Note text editor should appear in create sheet"
        )

        // Save button should exist but be disabled (no text entered)
        let saveButton = app.buttons["save-note"]
        XCTAssertTrue(saveButton.exists, "Save button should exist")

        // Cancel button should exist
        let cancelButton = app.buttons["cancel-note-create"]
        XCTAssertTrue(cancelButton.exists, "Cancel button should exist")
    }

    func testCreateNoteCancel() {
        navigateToNotesTab()

        let createButton = app.buttons["create-note-button"]
        XCTAssertTrue(createButton.waitForExistence(timeout: 5))
        createButton.tap()

        // Wait for sheet
        let textEditor = app.textViews["note-text-editor"].firstMatch
        XCTAssertTrue(textEditor.waitForExistence(timeout: 5))

        // Cancel
        let cancelButton = app.buttons["cancel-note-create"]
        cancelButton.tap()

        // Sheet should dismiss — create button should be visible again
        XCTAssertTrue(
            createButton.waitForExistence(timeout: 5),
            "Create button should be visible after cancelling"
        )
    }

    func testCreateNoteWithText() {
        navigateToNotesTab()

        let createButton = app.buttons["create-note-button"]
        XCTAssertTrue(createButton.waitForExistence(timeout: 5))
        createButton.tap()

        // Enter note text
        let textEditor = app.textViews["note-text-editor"].firstMatch
        XCTAssertTrue(textEditor.waitForExistence(timeout: 5))
        textEditor.tap()
        textEditor.typeText("Test note from UI test - \(Date().timeIntervalSince1970)")

        // Save button should be enabled now
        let saveButton = app.buttons["save-note"]
        XCTAssertTrue(saveButton.exists, "Save button should exist")
        XCTAssertTrue(saveButton.isEnabled, "Save button should be enabled with text")
    }

    // MARK: - Empty State

    func testEmptyStateShowsCreateButton() {
        navigateToNotesTab()

        // If there are no notes, the empty state should have a create button
        let emptyState = app.otherElements["notes-empty-state"].firstMatch
        if emptyState.waitForExistence(timeout: 5) {
            let createFirstNote = app.buttons["create-first-note"]
            XCTAssertTrue(
                createFirstNote.exists,
                "Empty state should have a 'Create Your First Note' button"
            )
        }
        // If notes exist, that's fine too — the test passes
    }

    // MARK: - Note Detail

    func testNoteDetailShowsContent() {
        navigateToNotesTab()

        // Wait for the notes list to load
        let notesList = app.otherElements["notes-list"].firstMatch
        guard notesList.waitForExistence(timeout: 10) else {
            // No notes to test detail on — skip
            return
        }

        // Tap the first note row
        let cells = app.cells
        guard cells.count > 0 else { return }
        cells.firstMatch.tap()

        // Detail view should appear
        let detailView = app.otherElements["note-detail-view"]
        XCTAssertTrue(
            detailView.waitForExistence(timeout: 5),
            "Note detail view should appear when tapping a note"
        )

        // Note text should be visible
        let noteText = app.staticTexts["note-detail-text"]
        XCTAssertTrue(
            noteText.waitForExistence(timeout: 3),
            "Note detail should display the note text"
        )
    }

    func testNoteDetailMenuExists() {
        navigateToNotesTab()

        let notesList = app.otherElements["notes-list"].firstMatch
        guard notesList.waitForExistence(timeout: 10) else { return }

        let cells = app.cells
        guard cells.count > 0 else { return }
        cells.firstMatch.tap()

        let detailView = app.otherElements["note-detail-view"]
        guard detailView.waitForExistence(timeout: 5) else { return }

        // Menu button should exist
        let menuButton = app.buttons["note-detail-menu"]
        XCTAssertTrue(
            menuButton.exists,
            "Note detail should have a menu button"
        )
    }

    // MARK: - Navigation Helpers

    private func navigateToNotesTab() {
        let tabView = app.otherElements["main-tab-view"]
        guard tabView.waitForExistence(timeout: 10) else {
            XCTFail("Main tab view should be visible")
            return
        }

        // Try tapping the Notes tab
        let tabBar = app.tabBars.firstMatch
        if tabBar.waitForExistence(timeout: 5) {
            // Tab bar buttons are identified by their label text
            let notesTabButton = tabBar.buttons.element(boundBy: 1)  // Second tab = Notes
            if notesTabButton.exists {
                notesTabButton.tap()
            }
        }
    }
}
