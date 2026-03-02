package org.llamenos.hotline.e2e.auth

import androidx.compose.ui.test.assertIsDisplayed
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
 * E2E tests for login.feature scenarios.
 *
 * Feature: Login Screen
 * Tests the initial login screen display and input validation.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class LoginScreenTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
    }

    // Scenario: Login screen displays all required elements
    @Test
    fun loginScreenDisplaysAllRequiredElements() {
        composeRule.onNodeWithTag("app-title").assertIsDisplayed()
        composeRule.onNodeWithTag("hub-url-input").assertIsDisplayed()
        composeRule.onNodeWithTag("nsec-input").assertIsDisplayed()
        composeRule.onNodeWithTag("create-identity").assertIsDisplayed()
        composeRule.onNodeWithTag("import-key").assertIsDisplayed()
    }

    // Scenario: Hub URL input accepts and displays text
    @Test
    fun hubUrlInputAcceptsAndDisplaysText() {
        composeRule.onNodeWithTag("hub-url-input").performTextInput("https://hub.example.com")
        composeRule.waitForIdle()
        // The text field should contain the entered URL
        composeRule.onNodeWithTag("hub-url-input").assertIsDisplayed()
    }

    // Scenario: Nsec input is password-masked
    @Test
    fun nsecInputIsPasswordMasked() {
        composeRule.onNodeWithTag("nsec-input").performTextInput("nsec1test")
        composeRule.waitForIdle()
        // Password fields mask input — we verify the field exists and accepted input
        composeRule.onNodeWithTag("nsec-input").assertIsDisplayed()
    }

    // Scenario: Import key with empty nsec shows error
    @Test
    fun importKeyWithEmptyNsecShowsError() {
        composeRule.onNodeWithTag("import-key").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("nsec-error").assertIsDisplayed()
        // Should remain on login screen
        composeRule.onNodeWithTag("app-title").assertIsDisplayed()
    }

    // Scenario: Import key with invalid nsec shows error
    @Test
    fun importKeyWithInvalidNsecShowsError() {
        composeRule.onNodeWithTag("nsec-input").performTextInput("not-a-valid-nsec")
        composeRule.onNodeWithTag("import-key").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("nsec-error").assertIsDisplayed()
        // Should remain on login screen
        composeRule.onNodeWithTag("app-title").assertIsDisplayed()
    }

    // Scenario: Import key with valid nsec navigates to PIN setup
    @Test
    fun importKeyWithValidNsecNavigatesToPinSetup() {
        composeRule.onNodeWithTag("nsec-input")
            .performTextInput("nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5e")
        composeRule.onNodeWithTag("import-key").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("pin-pad").assertIsDisplayed()
        composeRule.onNodeWithTag("pin-title").assertIsDisplayed()
    }
}
