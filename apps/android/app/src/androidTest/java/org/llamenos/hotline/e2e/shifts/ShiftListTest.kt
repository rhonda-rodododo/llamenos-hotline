package org.llamenos.hotline.e2e.shifts

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
import org.llamenos.hotline.helpers.assertAnyTagDisplayed

/**
 * E2E tests for shift-list.feature scenarios.
 *
 * Feature: Shifts Tab
 * Tests navigation to shifts tab and clock card visibility.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class ShiftListTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
    }

    // Scenario: Navigate to shifts tab
    @Test
    fun navigateToShiftsTab() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SHIFTS)
        composeRule.onNodeWithTag("clock-card").assertIsDisplayed()
        composeRule.onNodeWithTag("clock-status-text").assertIsDisplayed()
    }

    // Scenario: Clock in button visible when off shift
    @Test
    fun clockInButtonVisibleWhenOffShift() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SHIFTS)
        composeRule.onNodeWithTag("clock-in-button").assertIsDisplayed()
    }

    // Scenario: Shifts show schedule or empty state
    @Test
    fun shiftsShowScheduleOrEmptyState() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SHIFTS)
        val found = composeRule.assertAnyTagDisplayed(
            "shifts-list", "shifts-empty", "shifts-loading"
        )
        assert(found) { "Expected shifts to show list, empty, or loading state" }
    }
}
