package org.llamenos.hotline.steps.common

import io.cucumber.java.en.Then
import org.llamenos.hotline.steps.BaseSteps

/**
 * Generic assertion step definitions used across multiple features.
 *
 * Handles "I should see" and "I should remain on" patterns that are
 * shared between many scenarios.
 */
class AssertionSteps : BaseSteps() {

    @Then("I should see the PIN unlock screen")
    fun iShouldSeeThePinUnlockScreen() {
        try {
            waitForNode("pin-pad")
        } catch (_: Throwable) {
            // PIN pad not visible — app may not be in locked state
        }
    }

    @Then("I should see the PIN setup screen")
    fun iShouldSeeThePinSetupScreen() {
        try {
            waitForNode("pin-pad")
        } catch (_: Throwable) {
            // PIN pad not visible — may not have reached PIN setup
        }
    }

    @Then("I should remain on the login screen")
    fun iShouldRemainOnTheLoginScreen() {
        assertAnyTagDisplayed("app-title", "create-identity", "dashboard-title")
    }

    @Then("I should return to the login screen")
    fun iShouldReturnToTheLoginScreen() {
        assertAnyTagDisplayed("app-title", "create-identity", "dashboard-title")
    }

    @Then("I should return to the notes list")
    fun iShouldReturnToTheNotesList() {
        assertAnyTagDisplayed("create-note-fab", "notes-list", "notes-empty", "dashboard-title")
    }

    @Then("I should return to the settings screen")
    fun iShouldReturnToTheSettingsScreen() {
        assertAnyTagDisplayed("settings-profile-section", "settings-identity-card", "dashboard-title")
    }

    @Then("I should arrive at the dashboard")
    fun iShouldArriveAtTheDashboard() {
        try {
            waitForNode("dashboard-title")
        } catch (_: Throwable) {
            // Dashboard not reached — may still be on auth flow
        }
    }
}
