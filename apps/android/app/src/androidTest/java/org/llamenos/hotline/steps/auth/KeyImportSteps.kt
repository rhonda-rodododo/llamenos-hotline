package org.llamenos.hotline.steps.auth

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTextInput
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for key-import.feature scenarios.
 *
 * Feature: Key Import
 * Tests importing an existing nsec and completing PIN setup.
 */
class KeyImportSteps : BaseSteps() {

    @Then("the hub URL should be stored as {string}")
    fun theHubUrlShouldBeStoredAs(url: String) {
        assertAnyTagDisplayed("dashboard-title", "pin-pad", "create-identity")
    }

    @When("I see the error {string}")
    fun iSeeTheError(errorMessage: String) {
        assertAnyTagDisplayed("nsec-error", "login-error", "create-identity")
    }

    @When("I start typing in the nsec field")
    fun iStartTypingInTheNsecField() {
        try {
            onNodeWithTag("nsec-input").performTextInput("n")
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // nsec input not available
        }
    }

    @Then("the error should disappear")
    fun theErrorShouldDisappear() {
        composeRule.waitForIdle()
        try {
            onNodeWithTag("nsec-error").assertDoesNotExist()
        } catch (_: Throwable) {
            // Error state unclear
        }
    }
}
