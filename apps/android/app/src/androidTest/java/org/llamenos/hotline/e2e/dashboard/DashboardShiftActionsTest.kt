package org.llamenos.hotline.e2e.dashboard

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
import org.llamenos.hotline.helpers.TestNavigationHelper

/**
 * E2E tests for shift-status.feature scenarios.
 *
 * Feature: Dashboard Shift Actions
 * Tests quick clock in/out from the dashboard.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class DashboardShiftActionsTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
    }

    // Scenario: Clock in button shows when off shift
    @Test
    fun clockInButtonShowsWhenOffShift() {
        composeRule.onNodeWithTag("dashboard-clock-button").assertIsDisplayed()
    }

    // Scenario: Tapping clock in attempts to clock in
    @Test
    fun tappingClockInAttemptsToClockIn() {
        composeRule.onNodeWithTag("dashboard-clock-button").performClick()
        composeRule.waitForIdle()
        // Button should still be visible after clock attempt (may show loading briefly)
        composeRule.onNodeWithTag("dashboard-clock-button").assertIsDisplayed()
    }
}
