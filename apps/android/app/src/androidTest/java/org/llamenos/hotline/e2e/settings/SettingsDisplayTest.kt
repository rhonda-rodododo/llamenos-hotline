package org.llamenos.hotline.e2e.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
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
 * E2E tests for settings-display.feature scenarios.
 *
 * Feature: Settings Screen
 * Tests settings screen layout and card visibility.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class SettingsDisplayTest {

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

    // Scenario: Settings tab displays identity card
    @Test
    fun settingsTabDisplaysIdentityCard() {
        composeRule.onNodeWithTag("settings-identity-card").assertIsDisplayed()
    }

    // Scenario: Settings shows hub connection info
    @Test
    fun settingsShowsHubConnectionInfo() {
        composeRule.onNodeWithTag("settings-hub-card").assertIsDisplayed()
    }

    // Scenario: Settings shows device link card
    @Test
    fun settingsShowsDeviceLinkCard() {
        composeRule.onNodeWithTag("settings-device-link-card").performScrollTo()
        composeRule.onNodeWithTag("settings-device-link-card").assertIsDisplayed()
    }

    // Scenario: Settings shows admin card
    @Test
    fun settingsShowsAdminCard() {
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").assertIsDisplayed()
    }

    // Scenario: Settings shows lock and logout buttons
    @Test
    fun settingsShowsLockAndLogoutButtons() {
        composeRule.onNodeWithTag("settings-lock-button").assertIsDisplayed()
        composeRule.onNodeWithTag("settings-logout-button").assertIsDisplayed()
    }

    // Scenario: Settings shows version text
    @Test
    fun settingsShowsVersionText() {
        composeRule.onNodeWithTag("settings-version").assertIsDisplayed()
    }
}
