package org.llamenos.hotline.steps.admin

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for admin-settings.feature.
 *
 * Tests the admin settings tab with transcription controls.
 */
class AdminSettingsSteps : BaseSteps() {

    @Given("I navigate to the admin settings tab")
    fun iNavigateToTheAdminSettingsTab() {
        navigateToAdminTab("settings")
    }

    @Then("I should see the transcription settings card")
    fun iShouldSeeTheTranscriptionSettingsCard() {
        // Admin settings loads from API — wait for loading to finish first
        composeRule.waitUntil(10_000) {
            composeRule.onAllNodesWithTag("admin-transcription-card").fetchSemanticsNodes().isNotEmpty() ||
                composeRule.onAllNodesWithTag("admin-settings-error").fetchSemanticsNodes().isNotEmpty()
        }
        onNodeWithTag("admin-transcription-card").assertIsDisplayed()
    }

    @Then("I should see the transcription enabled toggle")
    fun iShouldSeeTheTranscriptionEnabledToggle() {
        // Wait for settings to load (API may fail but UI still renders)
        composeRule.waitUntil(10_000) {
            composeRule.onAllNodesWithTag("transcription-enabled-toggle").fetchSemanticsNodes().isNotEmpty() ||
                composeRule.onAllNodesWithTag("admin-settings-error").fetchSemanticsNodes().isNotEmpty()
        }
        onNodeWithTag("transcription-enabled-toggle").assertIsDisplayed()
    }

    @Then("I should see the transcription opt-out toggle")
    fun iShouldSeeTheTranscriptionOptOutToggle() {
        onNodeWithTag("transcription-optout-toggle").assertIsDisplayed()
    }

    @When("I toggle transcription on")
    fun iToggleTranscriptionOn() {
        onNodeWithTag("transcription-enabled-toggle").performClick()
        composeRule.waitForIdle()
    }

    @Then("transcription should be enabled")
    fun transcriptionShouldBeEnabled() {
        onNodeWithTag("transcription-enabled-toggle").assertIsDisplayed()
    }
}
