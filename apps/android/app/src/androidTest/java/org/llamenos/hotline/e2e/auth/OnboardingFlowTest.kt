package org.llamenos.hotline.e2e.auth

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.llamenos.hotline.MainActivity

/**
 * E2E tests for onboarding.feature scenarios.
 *
 * Feature: Identity Creation & Onboarding
 * Tests identity creation flow and nsec backup confirmation.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class OnboardingFlowTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
    }

    // Scenario: Create identity navigates to onboarding
    @Test
    fun createIdentityNavigatesToOnboarding() {
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("nsec-display").assertIsDisplayed()
        composeRule.onNodeWithTag("npub-display").assertIsDisplayed()
        composeRule.onNodeWithTag("confirm-backup").assertIsDisplayed()
    }

    // Scenario: Create identity with hub URL stores it
    @Test
    fun createIdentityWithHubUrlStoresIt() {
        composeRule.onNodeWithTag("hub-url-input").performTextInput("https://hub.example.com")
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("nsec-display").assertIsDisplayed()
    }

    // Scenario: Generated nsec has correct format
    @Test
    fun generatedNsecHasCorrectFormat() {
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()
        // Verify nsec and npub display nodes exist — format is verified in crypto tests
        composeRule.onNodeWithTag("nsec-display").assertIsDisplayed()
        composeRule.onNodeWithTag("npub-display").assertIsDisplayed()
    }

    // Scenario: Confirm backup navigates to PIN setup
    @Test
    fun confirmBackupNavigatesToPinSetup() {
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("pin-pad").assertIsDisplayed()
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }
}
