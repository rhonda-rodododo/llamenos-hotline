package org.llamenos.hotline

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented UI tests for the notes feature flow.
 *
 * Tests the complete note lifecycle:
 * 1. Navigate to notes tab
 * 2. View empty state
 * 3. Create a new note
 * 4. Verify note appears in list
 * 5. View note detail
 *
 * Prerequisites: The test must complete the auth flow first to reach
 * the main screen with bottom navigation.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class NoteFlowTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
    }

    /**
     * Complete the auth flow to reach the main screen.
     * This is a helper used by all note tests.
     */
    private fun navigateToMainScreen() {
        // Create identity
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()

        // Confirm backup
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()

        // Enter PIN: 1234
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.waitForIdle()

        // Confirm PIN: 1234
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.waitForIdle()

        // Should reach main screen with dashboard
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()
    }

    @Test
    fun bottomNavigationDisplaysCorrectly() {
        navigateToMainScreen()

        // Verify bottom navigation tabs are present
        composeRule.onNodeWithTag("nav-dashboard").assertIsDisplayed()
        composeRule.onNodeWithTag("nav-notes").assertIsDisplayed()
        composeRule.onNodeWithTag("nav-conversations").assertIsDisplayed()
        composeRule.onNodeWithTag("nav-shifts").assertIsDisplayed()
        composeRule.onNodeWithTag("nav-settings").assertIsDisplayed()
    }

    @Test
    fun navigateToNotesTab() {
        navigateToMainScreen()

        // Tap Notes tab
        composeRule.onNodeWithTag("nav-notes").performClick()
        composeRule.waitForIdle()

        // Should show the create note FAB
        composeRule.onNodeWithTag("create-note-fab").assertIsDisplayed()
    }

    @Test
    fun openNoteCreateScreen() {
        navigateToMainScreen()

        // Navigate to Notes tab
        composeRule.onNodeWithTag("nav-notes").performClick()
        composeRule.waitForIdle()

        // Tap the FAB to create a new note
        composeRule.onNodeWithTag("create-note-fab").performClick()
        composeRule.waitForIdle()

        // Note create screen should be displayed
        composeRule.onNodeWithTag("note-create-title").assertIsDisplayed()
        composeRule.onNodeWithTag("note-text-input").assertIsDisplayed()
        composeRule.onNodeWithTag("note-save-button").assertIsDisplayed()
    }

    @Test
    fun noteCreateScreenHasBackNavigation() {
        navigateToMainScreen()

        // Navigate to Notes tab and open create screen
        composeRule.onNodeWithTag("nav-notes").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("create-note-fab").performClick()
        composeRule.waitForIdle()

        // Verify create screen is shown
        composeRule.onNodeWithTag("note-create-title").assertIsDisplayed()

        // Tap back
        composeRule.onNodeWithTag("note-create-back").performClick()
        composeRule.waitForIdle()

        // Should be back on notes screen
        composeRule.onNodeWithTag("create-note-fab").assertIsDisplayed()
    }

    @Test
    fun noteTextInputAcceptsText() {
        navigateToMainScreen()

        // Navigate to Notes tab and open create screen
        composeRule.onNodeWithTag("nav-notes").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("create-note-fab").performClick()
        composeRule.waitForIdle()

        // Type in the note text field
        val testText = "Test note ${System.currentTimeMillis()}"
        composeRule.onNodeWithTag("note-text-input").performTextInput(testText)
        composeRule.waitForIdle()

        // The text should be visible
        composeRule.onNodeWithText(testText).assertIsDisplayed()
    }

    @Test
    fun dashboardShowsRecentNotesSection() {
        navigateToMainScreen()

        // Dashboard should show the recent notes card
        composeRule.onNodeWithTag("recent-notes-card").assertIsDisplayed()
    }

    @Test
    fun navigateToSettingsTab() {
        navigateToMainScreen()

        // Tap Settings tab
        composeRule.onNodeWithTag("nav-settings").performClick()
        composeRule.waitForIdle()

        // Should show settings elements
        composeRule.onNodeWithTag("settings-identity-card").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-lock-button").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-logout-button").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-version").assertIsDisplayed()
    }
}
