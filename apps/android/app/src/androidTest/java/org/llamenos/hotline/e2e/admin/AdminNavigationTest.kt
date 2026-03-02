package org.llamenos.hotline.e2e.admin

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
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
 * E2E tests for admin-navigation.feature scenarios.
 *
 * Feature: Admin Panel Navigation
 * Tests navigating to and from the admin panel via settings.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class AdminNavigationTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SETTINGS)
    }

    // Scenario: Navigate to admin panel
    @Test
    fun navigateToAdminPanel() {
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("admin-title").assertIsDisplayed()
        composeRule.onNodeWithTag("admin-tabs").assertIsDisplayed()
    }

    // Scenario: Admin back navigation returns to settings
    @Test
    fun adminBackNavigationReturnsToSettings() {
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("admin-title").assertIsDisplayed()

        composeRule.onNodeWithTag("admin-back").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("settings-identity-card").assertIsDisplayed()
    }
}
