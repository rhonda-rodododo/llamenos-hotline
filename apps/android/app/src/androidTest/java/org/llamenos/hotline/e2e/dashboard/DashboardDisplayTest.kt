package org.llamenos.hotline.e2e.dashboard

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
import org.llamenos.hotline.helpers.TestNavigationHelper

/**
 * E2E tests for dashboard-display.feature scenarios.
 *
 * Feature: Dashboard Display
 * Tests the dashboard status cards and elements.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class DashboardDisplayTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
    }

    // Scenario: Dashboard displays all status cards
    @Test
    fun dashboardDisplaysAllStatusCards() {
        composeRule.onNodeWithTag("connection-card").assertIsDisplayed()
        composeRule.onNodeWithTag("shift-card").assertIsDisplayed()
        composeRule.onNodeWithTag("calls-card").assertIsDisplayed()
        composeRule.onNodeWithTag("recent-notes-card").assertIsDisplayed()
        composeRule.onNodeWithTag("identity-card").assertIsDisplayed()
    }

    // Scenario: Dashboard shows npub in identity card
    @Test
    fun dashboardShowsNpubInIdentityCard() {
        composeRule.onNodeWithTag("identity-card").assertIsDisplayed()
        composeRule.onNodeWithTag("identity-npub").assertIsDisplayed()
    }

    // Scenario: Dashboard shows connection status
    @Test
    fun dashboardShowsConnectionStatus() {
        composeRule.onNodeWithTag("connection-card").assertIsDisplayed()
        composeRule.onNodeWithTag("connection-status").assertIsDisplayed()
    }

    // Scenario: Dashboard shows shift status
    @Test
    fun dashboardShowsShiftStatus() {
        composeRule.onNodeWithTag("shift-card").assertIsDisplayed()
        composeRule.onNodeWithTag("shift-status-text").assertIsDisplayed()
        composeRule.onNodeWithTag("dashboard-clock-button").assertIsDisplayed()
    }

    // Scenario: Dashboard shows active call count
    @Test
    fun dashboardShowsActiveCallCount() {
        composeRule.onNodeWithTag("calls-card").assertIsDisplayed()
        composeRule.onNodeWithTag("active-call-count").assertIsDisplayed()
    }

    // Scenario: Dashboard shows recent notes section
    @Test
    fun dashboardShowsRecentNotesSection() {
        composeRule.onNodeWithTag("recent-notes-card").assertIsDisplayed()
    }

    // Scenario: Dashboard lock button is present
    @Test
    fun dashboardLockButtonIsPresent() {
        composeRule.onNodeWithTag("dashboard-lock-button").assertIsDisplayed()
    }

    // Scenario: Dashboard logout button is present
    @Test
    fun dashboardLogoutButtonIsPresent() {
        composeRule.onNodeWithTag("dashboard-logout-button").assertIsDisplayed()
    }
}
