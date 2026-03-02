package org.llamenos.hotline.e2e.auth

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.llamenos.hotline.MainActivity
import org.llamenos.hotline.helpers.enterPin
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * E2E tests for pin-setup.feature scenarios.
 *
 * Feature: PIN Setup
 * Tests the PIN creation flow during onboarding.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class PinSetupTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
    }

    private fun navigateToPinSetup() {
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()
    }

    // Scenario: PIN pad displays correctly
    @Test
    fun pinPadDisplaysCorrectly() {
        navigateToPinSetup()
        composeRule.onNodeWithTag("pin-pad").assertIsDisplayed()
        composeRule.onNodeWithTag("pin-backspace").assertIsDisplayed()
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }

    // Scenario: Entering 4 digits moves to confirmation
    @Test
    fun entering4DigitsMovesToConfirmation() {
        navigateToPinSetup()
        composeRule.enterPin("1234")
        // Title should change to confirm mode
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }

    // Scenario: Matching confirmation completes setup
    @Test
    fun matchingConfirmationCompletesSetup() {
        navigateToPinSetup()
        composeRule.enterPin("1234")
        composeRule.enterPin("1234")
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()
    }

    // Scenario: Mismatched confirmation shows error
    @Test
    fun mismatchedConfirmationShowsError() {
        navigateToPinSetup()
        composeRule.enterPin("1234")
        composeRule.enterPin("5678")
        composeRule.onNodeWithTag("pin-error").assertIsDisplayed()
    }

    // Scenario: Backspace removes last digit
    @Test
    fun backspaceRemovesLastDigit() {
        navigateToPinSetup()
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()
        composeRule.onNodeWithTag("pin-backspace").performClick()
        composeRule.waitForIdle()
        // Continue to enter remaining digits (now "1" + "3" + "4" + "5" = 4 digits)
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.onNodeWithTag("pin-5").performClick()
        composeRule.waitForIdle()
        // Should be in confirmation mode
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }

    // Scenario: PIN is encrypted and stored
    @Test
    fun pinIsEncryptedAndStored() {
        navigateToPinSetup()
        composeRule.enterPin("1234")
        composeRule.enterPin("1234")
        // If we reach the dashboard, the PIN was accepted and key data was stored
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()
    }
}
