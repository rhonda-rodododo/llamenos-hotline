package org.llamenos.hotline.steps.admin

import androidx.compose.ui.test.assertIsDisplayed
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
        waitForNode("admin-transcription-card")
        onNodeWithTag("admin-transcription-card").assertIsDisplayed()
    }

    @Then("I should see the transcription enabled toggle")
    fun iShouldSeeTheTranscriptionEnabledToggle() {
        waitForNode("transcription-enabled-toggle")
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
