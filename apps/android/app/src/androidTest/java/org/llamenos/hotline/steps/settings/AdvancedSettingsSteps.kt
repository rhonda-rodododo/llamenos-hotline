package org.llamenos.hotline.steps.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for advanced-settings.feature.
 *
 * Tests auto-lock timeout, debug logging, and cache clearing.
 */
class AdvancedSettingsSteps : BaseSteps() {

    @Given("I expand the advanced settings section")
    fun iExpandTheAdvancedSettingsSection() {
        onNodeWithTag("settings-advanced-section-header").performClick()
        composeRule.waitForIdle()
    }

    @Then("I should see the auto-lock timeout options")
    fun iShouldSeeTheAutoLockTimeoutOptions() {
        onNodeWithTag("auto-lock-options").assertIsDisplayed()
    }

    @Then("I should see the debug logging toggle")
    fun iShouldSeeTheDebugLoggingToggle() {
        onNodeWithTag("debug-logging-toggle").assertIsDisplayed()
    }

    @Then("I should see the clear cache button")
    fun iShouldSeeTheClearCacheButton() {
        onNodeWithTag("clear-cache-button").assertIsDisplayed()
    }

    @When("I tap the clear cache button")
    fun iTapTheClearCacheButton() {
        onNodeWithTag("clear-cache-button").performClick()
        composeRule.waitForIdle()
    }

    @Then("I should see the clear cache confirmation dialog")
    fun iShouldSeeTheClearCacheConfirmationDialog() {
        onNodeWithTag("clear-cache-dialog").assertIsDisplayed()
    }
}
