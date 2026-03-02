package org.llamenos.hotline.e2e.conversations

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
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

/**
 * E2E tests for conversation-list.feature scenarios.
 *
 * Feature: Conversations List
 * Tests navigation to conversations tab and filter chip display.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ConversationListTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
    }

    // Scenario: Navigate to conversations tab
    @Test
    fun navigateToConversationsTab() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.CONVERSATIONS)
        composeRule.onNodeWithTag("conversation-filters").assertIsDisplayed()
    }

    // Scenario: Filter chips are displayed
    @Test
    fun filterChipsAreDisplayed() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.CONVERSATIONS)
        composeRule.onNodeWithTag("filter-active").assertIsDisplayed()
        composeRule.onNodeWithTag("filter-closed").assertIsDisplayed()
        composeRule.onNodeWithTag("filter-all").assertIsDisplayed()
    }

    // Scenario: Default filter is Active
    @Test
    fun defaultFilterIsActive() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.CONVERSATIONS)
        composeRule.onNodeWithTag("filter-active").assertIsDisplayed()
    }
}
