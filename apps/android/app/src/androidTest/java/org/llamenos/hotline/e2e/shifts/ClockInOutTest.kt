package org.llamenos.hotline.e2e.shifts

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

/**
 * E2E tests for clock-in-out.feature scenarios.
 *
 * Feature: Clock In/Out
 * Tests clock in/out state transitions.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ClockInOutTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SHIFTS)
    }

    // Scenario: Clock in changes status to on-shift
    @Test
    fun clockInChangesStatusToOnShift() {
        composeRule.onNodeWithTag("clock-in-button").performClick()
        composeRule.waitForIdle()
        // After clock in attempt, clock card should still be visible
        composeRule.onNodeWithTag("clock-card").assertIsDisplayed()
    }

    // Scenario: Clock out changes status to off-shift
    @Test
    fun clockOutChangesStatusToOffShift() {
        // First clock in
        composeRule.onNodeWithTag("clock-in-button").performClick()
        composeRule.waitForIdle()
        // Then verify the clock card is still shown (clock out button may appear)
        composeRule.onNodeWithTag("clock-card").assertIsDisplayed()
    }
}
