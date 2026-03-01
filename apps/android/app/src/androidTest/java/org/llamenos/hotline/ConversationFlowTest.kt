package org.llamenos.hotline

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented UI tests for the conversations feature flow.
 *
 * Tests:
 * 1. Navigate to conversations tab
 * 2. View filter chips
 * 3. View empty state or list
 * 4. Tab switching with conversations tab
 *
 * Prerequisites: The test must complete the auth flow first to reach
 * the main screen with bottom navigation.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ConversationFlowTest {

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
    fun bottomNavigationShowsConversationsTab() {
        navigateToMainScreen()

        // Verify the conversations tab is present in bottom navigation
        composeRule.onNodeWithTag("nav-conversations").assertIsDisplayed()
    }

    @Test
    fun navigateToConversationsTab() {
        navigateToMainScreen()

        // Tap Conversations tab
        composeRule.onNodeWithTag("nav-conversations").performClick()
        composeRule.waitForIdle()

        // Should show the filter chips
        composeRule.onNodeWithTag("conversation-filters").assertIsDisplayed()
        composeRule.onNodeWithTag("filter-active").assertIsDisplayed()
        composeRule.onNodeWithTag("filter-closed").assertIsDisplayed()
        composeRule.onNodeWithTag("filter-all").assertIsDisplayed()
    }

    @Test
    fun conversationsFilterChipsAreClickable() {
        navigateToMainScreen()

        // Navigate to Conversations tab
        composeRule.onNodeWithTag("nav-conversations").performClick()
        composeRule.waitForIdle()

        // Tap the "Closed" filter chip
        composeRule.onNodeWithTag("filter-closed").performClick()
        composeRule.waitForIdle()

        // Filter should still be visible (it should be selected now)
        composeRule.onNodeWithTag("filter-closed").assertIsDisplayed()

        // Tap the "All" filter chip
        composeRule.onNodeWithTag("filter-all").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("filter-all").assertIsDisplayed()
    }

    @Test
    fun conversationsShowsEmptyOrListState() {
        navigateToMainScreen()

        // Navigate to Conversations tab
        composeRule.onNodeWithTag("nav-conversations").performClick()
        composeRule.waitForIdle()

        // Should show either loading, empty state, or list
        // (depending on API response in test environment)
        val hasEmpty = try {
            composeRule.onNodeWithTag("conversations-empty").assertIsDisplayed()
            true
        } catch (_: AssertionError) {
            false
        }

        val hasList = try {
            composeRule.onNodeWithTag("conversations-list").assertIsDisplayed()
            true
        } catch (_: AssertionError) {
            false
        }

        val hasLoading = try {
            composeRule.onNodeWithTag("conversations-loading").assertIsDisplayed()
            true
        } catch (_: AssertionError) {
            false
        }

        // At least one state should be shown (or an error)
        assert(hasEmpty || hasList || hasLoading) {
            "Expected conversations screen to show empty state, list, or loading"
        }
    }

    @Test
    fun tabSwitchingWithConversations() {
        navigateToMainScreen()

        // Go to Conversations
        composeRule.onNodeWithTag("nav-conversations").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("conversation-filters").assertIsDisplayed()

        // Go to Dashboard
        composeRule.onNodeWithTag("nav-dashboard").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()

        // Go back to Conversations
        composeRule.onNodeWithTag("nav-conversations").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("conversation-filters").assertIsDisplayed()

        // Go to Notes
        composeRule.onNodeWithTag("nav-notes").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("create-note-fab").assertIsDisplayed()
    }
}
