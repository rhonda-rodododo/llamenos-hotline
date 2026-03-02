package org.llamenos.hotline.e2e.navigation

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
 * E2E tests for bottom-navigation.feature scenarios.
 *
 * Feature: Bottom Navigation
 * Tests tab visibility and switching.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class BottomNavigationTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
    }

    // Scenario: All five tabs are visible
    @Test
    fun allFiveTabsAreVisible() {
        composeRule.onNodeWithTag(NavTabs.DASHBOARD).assertIsDisplayed()
        composeRule.onNodeWithTag(NavTabs.NOTES).assertIsDisplayed()
        composeRule.onNodeWithTag(NavTabs.CONVERSATIONS).assertIsDisplayed()
        composeRule.onNodeWithTag(NavTabs.SHIFTS).assertIsDisplayed()
        composeRule.onNodeWithTag(NavTabs.SETTINGS).assertIsDisplayed()
    }

    // Scenario: Tab switching preserves state
    @Test
    fun tabSwitchingPreservesState() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SHIFTS)
        composeRule.onNodeWithTag("clock-card").assertIsDisplayed()

        TestNavigationHelper.navigateToTab(composeRule, NavTabs.NOTES)
        composeRule.onNodeWithTag("create-note-fab").assertIsDisplayed()

        TestNavigationHelper.navigateToTab(composeRule, NavTabs.DASHBOARD)
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()

        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SETTINGS)
        composeRule.onNodeWithTag("settings-identity-card").assertIsDisplayed()
    }

    // Scenario: Tab switching between conversations and notes
    @Test
    fun tabSwitchingBetweenConversationsAndNotes() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.CONVERSATIONS)
        composeRule.onNodeWithTag("conversation-filters").assertIsDisplayed()

        TestNavigationHelper.navigateToTab(composeRule, NavTabs.NOTES)
        composeRule.onNodeWithTag("create-note-fab").assertIsDisplayed()

        TestNavigationHelper.navigateToTab(composeRule, NavTabs.CONVERSATIONS)
        composeRule.onNodeWithTag("conversation-filters").assertIsDisplayed()
    }
}
