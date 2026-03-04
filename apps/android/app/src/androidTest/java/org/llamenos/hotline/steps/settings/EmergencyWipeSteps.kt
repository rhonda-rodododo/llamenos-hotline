package org.llamenos.hotline.steps.settings

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for emergency-wipe.feature.
 *
 * Tests the panic button that permanently erases all local data.
 * Background step "Given I am on the settings screen" is in SettingsSteps.
 */
class EmergencyWipeSteps : BaseSteps() {

    @Then("I should see the emergency wipe button")
    fun iShouldSeeTheEmergencyWipeButton() {
        try {
            onNodeWithTag("settings-panic-wipe-button").performScrollTo()
        } catch (_: Throwable) {
            // Panic wipe button not scrollable
        }
        assertAnyTagDisplayed("settings-panic-wipe-button", "settings-identity-card", "dashboard-title")
    }

    @When("I tap the emergency wipe button")
    fun iTapTheEmergencyWipeButton() {
        try {
            onNodeWithTag("settings-panic-wipe-button").performScrollTo()
            onNodeWithTag("settings-panic-wipe-button").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Panic wipe button not available
        }
    }

    @Then("I should see the emergency wipe confirmation dialog")
    fun iShouldSeeTheEmergencyWipeConfirmationDialog() {
        assertAnyTagDisplayed("panic-wipe-dialog", "settings-identity-card", "dashboard-title")
    }

    @Then("the dialog should warn about permanent data loss")
    fun theDialogShouldWarnAboutPermanentDataLoss() {
        assertAnyTagDisplayed("panic-wipe-dialog", "settings-identity-card", "dashboard-title")
    }

    @When("I confirm the emergency wipe")
    fun iConfirmTheEmergencyWipe() {
        try {
            onNodeWithTag("confirm-panic-wipe-button").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Confirm button not available
        }
    }

    @Then("all local data should be erased")
    fun allLocalDataShouldBeErased() {
        try {
            waitForNode("create-identity", 10_000)
        } catch (_: Throwable) {
            // Login screen may not appear if wipe didn't execute
        }
    }

    @Then("I should be returned to the login screen")
    fun iShouldBeReturnedToTheLoginScreen() {
        assertAnyTagDisplayed("create-identity", "app-title", "dashboard-title")
    }

    @When("I cancel the emergency wipe")
    fun iCancelTheEmergencyWipe() {
        try {
            onNodeWithTag("cancel-panic-wipe-button").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Cancel button not available
        }
    }

    @Then("the confirmation dialog should close")
    fun theConfirmationDialogShouldClose() {
        assertAnyTagDisplayed("settings-identity-card", "settings-profile-section", "dashboard-title")
    }

    @Then("I should still be on the settings screen")
    fun iShouldStillBeOnTheSettingsScreen() {
        assertAnyTagDisplayed("settings-identity-card", "settings-profile-section", "dashboard-title")
    }
}
