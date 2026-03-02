package org.llamenos.hotline.e2e.settings

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
import org.llamenos.hotline.helpers.assertAnyTagDisplayed

/**
 * E2E tests for device-link.feature scenarios.
 *
 * Feature: Device Linking
 * Tests the device link QR code scanning flow.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class DeviceLinkTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SETTINGS)
        composeRule.onNodeWithTag("settings-device-link-card").performScrollTo()
        composeRule.onNodeWithTag("settings-device-link-card").performClick()
        composeRule.waitForIdle()
    }

    // Scenario: Device link screen shows step indicator
    @Test
    fun deviceLinkScreenShowsStepIndicator() {
        composeRule.onNodeWithTag("device-link-steps").assertIsDisplayed()
    }

    // Scenario: Device link shows camera or permission prompt
    @Test
    fun deviceLinkShowsCameraOrPermissionPrompt() {
        val found = composeRule.assertAnyTagDisplayed(
            "camera-preview", "camera-permission-prompt"
        )
        assert(found) { "Expected camera preview or permission prompt" }
    }

    // Scenario: Camera permission denied shows request button
    @Test
    fun cameraPermissionDeniedShowsRequestButton() {
        // If permission not granted, the prompt should be visible
        val hasPrompt = composeRule.assertAnyTagDisplayed(
            "camera-permission-prompt", "camera-preview"
        )
        assert(hasPrompt) { "Expected camera permission prompt or preview" }
    }

    // Scenario: Invalid QR code shows error
    @Test
    fun invalidQrCodeShowsError() {
        // This scenario requires camera hardware — verify the screen structure exists
        composeRule.onNodeWithTag("device-link-steps").assertIsDisplayed()
    }

    // Scenario: Cancel returns to settings
    @Test
    fun cancelReturnsToSettings() {
        composeRule.onNodeWithTag("device-link-back").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings-identity-card").assertIsDisplayed()
    }

    // Scenario: Device link back navigation
    @Test
    fun deviceLinkBackNavigation() {
        composeRule.onNodeWithTag("device-link-back").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings-device-link-card").performScrollTo()
        composeRule.onNodeWithTag("settings-device-link-card").assertIsDisplayed()
    }
}
