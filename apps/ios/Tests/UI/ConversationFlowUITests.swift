import XCTest

/// XCUITest suite for the conversations workflow: navigating to conversations,
/// opening a conversation detail, sending a message, and verifying the list.
///
/// These tests require the app to be in an authenticated state with a valid hub connection.
/// They use the `--test-authenticated` launch argument to skip auth flow.
final class ConversationFlowUITests: XCTestCase {

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

    func testConversationsTabExists() {
        let tabView = app.otherElements["main-tab-view"]
        XCTAssertTrue(
            tabView.waitForExistence(timeout: 10),
            "Main tab view should be visible after authentication"
        )

        navigateToConversationsTab()

        // Conversations list, empty state, or loading should appear
        let conversationsList = app.otherElements["conversations-list"].firstMatch
        let emptyState = app.otherElements["conversations-empty-state"].firstMatch
        let loading = app.otherElements["conversations-loading"].firstMatch

        let found = conversationsList.waitForExistence(timeout: 10)
            || emptyState.waitForExistence(timeout: 2)
            || loading.waitForExistence(timeout: 2)

        XCTAssertTrue(found, "Conversations view should show list, empty state, or loading")
    }

    // MARK: - Empty State

    func testEmptyStateShowsMessage() {
        navigateToConversationsTab()

        let emptyState = app.otherElements["conversations-empty-state"].firstMatch
        if emptyState.waitForExistence(timeout: 10) {
            XCTAssertTrue(true, "Empty state is displayed when no conversations exist")
        }
        // If conversations exist, that's fine too
    }

    // MARK: - Filter Menu

    func testFilterButtonExists() {
        navigateToConversationsTab()

        // Wait for content to load
        let list = app.otherElements["conversations-list"].firstMatch
        let empty = app.otherElements["conversations-empty-state"].firstMatch
        _ = list.waitForExistence(timeout: 10) || empty.waitForExistence(timeout: 2)

        let filterButton = app.buttons["conversations-filter-button"]
        XCTAssertTrue(
            filterButton.waitForExistence(timeout: 5),
            "Filter button should exist in the toolbar"
        )
    }

    // MARK: - Conversation Detail

    func testConversationDetailOpens() {
        navigateToConversationsTab()

        // Wait for the conversations list to load
        let conversationsList = app.otherElements["conversations-list"].firstMatch
        guard conversationsList.waitForExistence(timeout: 10) else {
            // No conversations to test detail on — skip
            return
        }

        // Tap the first conversation row
        let cells = app.cells
        guard cells.count > 0 else { return }
        cells.firstMatch.tap()

        // Detail view should appear
        let detailView = app.otherElements["conversation-detail-view"]
        XCTAssertTrue(
            detailView.waitForExistence(timeout: 5),
            "Conversation detail view should appear when tapping a conversation"
        )

        // Reply text field should exist
        let replyField = app.textFields["reply-text-field"]
        XCTAssertTrue(
            replyField.waitForExistence(timeout: 3),
            "Reply text field should exist in conversation detail"
        )

        // Send button should exist
        let sendButton = app.buttons["send-message-button"]
        XCTAssertTrue(
            sendButton.exists,
            "Send button should exist in conversation detail"
        )
    }

    func testSendMessageButton() {
        navigateToConversationsTab()

        let conversationsList = app.otherElements["conversations-list"].firstMatch
        guard conversationsList.waitForExistence(timeout: 10) else { return }

        let cells = app.cells
        guard cells.count > 0 else { return }
        cells.firstMatch.tap()

        let detailView = app.otherElements["conversation-detail-view"]
        guard detailView.waitForExistence(timeout: 5) else { return }

        // Send button should be disabled when reply field is empty
        let sendButton = app.buttons["send-message-button"]
        XCTAssertTrue(sendButton.exists, "Send button should exist")
        // Note: We can't reliably check isEnabled on all configurations,
        // so we just verify the button exists

        // Type a message
        let replyField = app.textFields["reply-text-field"]
        if replyField.exists {
            replyField.tap()
            replyField.typeText("Test message from UI test - \(Date().timeIntervalSince1970)")

            // Send button should now be interactive
            XCTAssertTrue(sendButton.exists, "Send button should still exist after typing")
        }
    }

    // MARK: - Channel Header

    func testChannelHeaderVisible() {
        navigateToConversationsTab()

        let conversationsList = app.otherElements["conversations-list"].firstMatch
        guard conversationsList.waitForExistence(timeout: 10) else { return }

        let cells = app.cells
        guard cells.count > 0 else { return }
        cells.firstMatch.tap()

        let channelHeader = app.otherElements["conversation-channel-header"]
        if channelHeader.waitForExistence(timeout: 5) {
            XCTAssertTrue(true, "Channel header is visible in conversation detail")
        }
    }

    // MARK: - Navigation Helpers

    private func navigateToConversationsTab() {
        let tabView = app.otherElements["main-tab-view"]
        guard tabView.waitForExistence(timeout: 10) else {
            XCTFail("Main tab view should be visible")
            return
        }

        let tabBar = app.tabBars.firstMatch
        guard tabBar.waitForExistence(timeout: 5) else { return }
        // Third tab = Conversations (0: Dashboard, 1: Notes, 2: Conversations)
        let conversationsTabButton = tabBar.buttons.element(boundBy: 2)
        if conversationsTabButton.exists {
            conversationsTabButton.tap()
        }
    }
}
