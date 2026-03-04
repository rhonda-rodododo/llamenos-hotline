package org.llamenos.hotline.steps.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for language-selection.feature.
 *
 * Covers app language selection and spoken languages multi-select.
 */
class LanguageSteps : BaseSteps() {

    @When("I expand the language section")
    fun iExpandTheLanguageSection() {
        onNodeWithTag("settings-language-section-header").performScrollTo().performClick()
        composeRule.waitForIdle()
    }

    @When("I expand the profile section")
    fun iExpandTheProfileSection() {
        // Profile section is expanded by default — only toggle if content is hidden
        val contentNodes = composeRule.onAllNodesWithTag("settings-display-name-input").fetchSemanticsNodes()
        if (contentNodes.isEmpty()) {
            onNodeWithTag("settings-profile-section-header").performScrollTo().performClick()
            composeRule.waitForIdle()
        }
    }

    @When("I tap a language chip")
    fun iTapALanguageChip() {
        onNodeWithTag("lang-es").performScrollTo().performClick()
        composeRule.waitForIdle()
    }

    @When("I tap a spoken language chip")
    fun iTapASpokenLanguageChip() {
        onNodeWithTag("spoken-lang-es").performScrollTo().performClick()
        composeRule.waitForIdle()
    }

    @Then("I should see the language options")
    fun iShouldSeeTheLanguageOptions() {
        onNodeWithTag("language-options").performScrollTo()
        onNodeWithTag("language-options").assertIsDisplayed()
    }

    @Then("I should see language chips for all supported locales")
    fun iShouldSeeLanguageChipsForAllSupportedLocales() {
        // Check a sample of languages are displayed (scroll to each)
        onNodeWithTag("lang-en").performScrollTo().assertIsDisplayed()
        onNodeWithTag("lang-es").performScrollTo().assertIsDisplayed()
        onNodeWithTag("lang-zh").performScrollTo().assertIsDisplayed()
        onNodeWithTag("lang-fr").performScrollTo().assertIsDisplayed()
    }

    @Then("the language chip should be selected")
    fun theLanguageChipShouldBeSelected() {
        onNodeWithTag("lang-es").performScrollTo()
        onNodeWithTag("lang-es").assertIsSelected()
    }

    @Then("I should see the spoken languages chips")
    fun iShouldSeeTheSpokenLanguagesChips() {
        onNodeWithTag("spoken-languages-chips").performScrollTo().assertIsDisplayed()
    }

    @Then("the spoken language chip should be selected")
    fun theSpokenLanguageChipShouldBeSelected() {
        onNodeWithTag("spoken-lang-es").performScrollTo()
        onNodeWithTag("spoken-lang-es").assertIsSelected()
    }
}
