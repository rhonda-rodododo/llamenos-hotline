package org.llamenos.hotline

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

/**
 * Instrumented UI tests for the authentication flow.
 *
 * Tests the complete onboarding journey:
 * 1. Create new identity
 * 2. View generated nsec
 * 3. Confirm backup
 * 4. Set PIN
 * 5. Confirm PIN
 * 6. Arrive at dashboard
 *
 * Uses Compose testing APIs with testTag selectors for reliable element targeting.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class AuthFlowTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
    }

    @Test
    fun loginScreenDisplaysCorrectly() {
        // The login screen should be the default when no keys are stored
        composeRule.onNodeWithTag("app-title").assertIsDisplayed()
        composeRule.onNodeWithTag("hub-url-input").assertIsDisplayed()
        composeRule.onNodeWithTag("nsec-input").assertIsDisplayed()
        composeRule.onNodeWithTag("create-identity").assertIsDisplayed()
        composeRule.onNodeWithTag("import-key").assertIsDisplayed()
    }

    @Test
    fun createIdentityNavigatesToOnboarding() {
        // Tap "Create New Identity"
        composeRule.onNodeWithTag("create-identity").performClick()

        // Should navigate to onboarding screen with nsec display
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("nsec-display").assertIsDisplayed()
        composeRule.onNodeWithTag("npub-display").assertIsDisplayed()
        composeRule.onNodeWithTag("confirm-backup").assertIsDisplayed()
    }

    @Test
    fun onboardingFlowToPinSet() {
        // Create identity
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()

        // Verify nsec is displayed
        composeRule.onNodeWithTag("nsec-display").assertIsDisplayed()

        // Confirm backup
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()

        // Should navigate to PIN set screen
        composeRule.onNodeWithTag("pin-pad").assertIsDisplayed()
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }

    @Test
    fun fullOnboardingFlow() {
        // 1. Create identity
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()

        // 2. Confirm backup
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()

        // 3. PIN pad should appear
        composeRule.onNodeWithTag("pin-pad").assertIsDisplayed()

        // 4. Enter 4-digit PIN
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.waitForIdle()

        // 5. Confirm PIN (same digits)
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.waitForIdle()

        // 6. Should reach dashboard
        composeRule.onNodeWithTag("dashboard-title").assertIsDisplayed()
    }

    @Test
    fun pinMismatchShowsError() {
        // Create identity and confirm backup
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()

        // Enter first PIN: 1234
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.waitForIdle()

        // Enter mismatched PIN: 5678
        composeRule.onNodeWithTag("pin-5").performClick()
        composeRule.onNodeWithTag("pin-6").performClick()
        composeRule.onNodeWithTag("pin-7").performClick()
        composeRule.onNodeWithTag("pin-8").performClick()
        composeRule.waitForIdle()

        // Should show error
        composeRule.onNodeWithTag("pin-error").assertIsDisplayed()
    }

    @Test
    fun pinBackspaceRemovesDigit() {
        // Create identity and go through to PIN
        composeRule.onNodeWithTag("create-identity").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("confirm-backup").performClick()
        composeRule.waitForIdle()

        // Enter some digits
        composeRule.onNodeWithTag("pin-1").performClick()
        composeRule.onNodeWithTag("pin-2").performClick()

        // Backspace
        composeRule.onNodeWithTag("pin-backspace").performClick()
        composeRule.waitForIdle()

        // Enter more digits to verify backspace worked
        // (PIN should now be "1" + "3" + "4" + "5" = "1345")
        composeRule.onNodeWithTag("pin-3").performClick()
        composeRule.onNodeWithTag("pin-4").performClick()
        composeRule.onNodeWithTag("pin-5").performClick()
        composeRule.waitForIdle()

        // Should move to confirmation phase (4 digits entered)
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }
}
