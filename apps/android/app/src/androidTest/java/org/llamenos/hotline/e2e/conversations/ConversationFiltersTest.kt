package org.llamenos.hotline.e2e.conversations

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
import org.llamenos.hotline.MainActivity
import org.llamenos.hotline.helpers.NavTabs
import org.llamenos.hotline.helpers.TestNavigationHelper
import org.llamenos.hotline.helpers.assertAnyTagDisplayed

/**
 * E2E tests for conversation-filters.feature scenarios.
 *
 * Feature: Conversation Filters
 * Tests switching between Active, Closed, and All filters.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ConversationFiltersTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.CONVERSATIONS)
    }

    // Scenario: Switch to Closed filter
    @Test
    fun switchToClosedFilter() {
        composeRule.onNodeWithTag("filter-closed").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("filter-closed").assertIsDisplayed()
    }

    // Scenario: Switch to All filter
    @Test
    fun switchToAllFilter() {
        composeRule.onNodeWithTag("filter-all").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("filter-all").assertIsDisplayed()
    }

    // Scenario: Switch back to Active filter
    @Test
    fun switchBackToActiveFilter() {
        composeRule.onNodeWithTag("filter-closed").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("filter-active").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("filter-active").assertIsDisplayed()
    }

    // Scenario: Conversations show empty or list state
    @Test
    fun conversationsShowEmptyOrListState() {
        val found = composeRule.assertAnyTagDisplayed(
            "conversations-empty", "conversations-list", "conversations-loading"
        )
        assert(found) { "Expected conversations to show empty state, list, or loading" }
    }
}
