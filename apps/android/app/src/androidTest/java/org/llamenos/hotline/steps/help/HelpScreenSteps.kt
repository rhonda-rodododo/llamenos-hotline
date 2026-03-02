package org.llamenos.hotline.steps.help

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for help-screen.feature.
 *
 * Tests the Help & Reference screen with security overview,
 * role guides, and collapsible FAQ sections.
 */
class HelpScreenSteps : BaseSteps() {

    @Given("I am on the help screen")
    fun iAmOnTheHelpScreen() {
        navigateToTab(NAV_DASHBOARD)
        onNodeWithTag("help-card").performScrollTo()
        onNodeWithTag("help-card").performClick()
        composeRule.waitForIdle()
    }

    @Then("I should see the security overview card")
    fun iShouldSeeTheSecurityOverviewCard() {
        onNodeWithTag("help-security-card").assertIsDisplayed()
    }

    @Then("it should show encryption status for notes, reports, auth, and sessions")
    fun itShouldShowEncryptionStatus() {
        onNodeWithTag("sec-notes").assertIsDisplayed()
        onNodeWithTag("sec-reports").assertIsDisplayed()
        onNodeWithTag("sec-auth").assertIsDisplayed()
        onNodeWithTag("sec-sessions").assertIsDisplayed()
    }

    @Then("I should see the volunteer guide section")
    fun iShouldSeeTheVolunteerGuideSection() {
        onNodeWithTag("help-volunteer-guide").assertIsDisplayed()
    }

    @Then("the volunteer guide should be expandable")
    fun theVolunteerGuideShouldBeExpandable() {
        onNodeWithTag("help-volunteer-guide").performClick()
        composeRule.waitForIdle()
    }

    @Then("I should see the admin guide section")
    fun iShouldSeeTheAdminGuideSection() {
        onNodeWithTag("help-admin-guide").performScrollTo()
        onNodeWithTag("help-admin-guide").assertIsDisplayed()
    }

    @Then("the admin guide should be expandable")
    fun theAdminGuideShouldBeExpandable() {
        onNodeWithTag("help-admin-guide").performClick()
        composeRule.waitForIdle()
    }

    @Then("I should see the FAQ title")
    fun iShouldSeeTheFaqTitle() {
        onNodeWithTag("help-faq-title").performScrollTo()
        onNodeWithTag("help-faq-title").assertIsDisplayed()
    }

    @Then("I should see FAQ sections for getting started, calls, notes, and admin")
    fun iShouldSeeFaqSections() {
        onNodeWithTag("faq-getting-started").performScrollTo()
        onNodeWithTag("faq-getting-started").assertIsDisplayed()
        onNodeWithTag("faq-calls").performScrollTo()
        onNodeWithTag("faq-calls").assertIsDisplayed()
        onNodeWithTag("faq-notes").performScrollTo()
        onNodeWithTag("faq-notes").assertIsDisplayed()
        onNodeWithTag("faq-admin").performScrollTo()
        onNodeWithTag("faq-admin").assertIsDisplayed()
    }

    @When("I expand the {string} FAQ section")
    fun iExpandTheFaqSection(section: String) {
        val tag = when (section) {
            "Getting Started" -> "faq-getting-started"
            "Calls & Shifts" -> "faq-calls"
            "Notes & Encryption" -> "faq-notes"
            "Administration" -> "faq-admin"
            else -> "faq-getting-started"
        }
        onNodeWithTag("$tag-header").performScrollTo()
        onNodeWithTag("$tag-header").performClick()
        composeRule.waitForIdle()
    }

    @Then("I should see FAQ questions and answers")
    fun iShouldSeeFaqQuestionsAndAnswers() {
        onNodeWithTag("faq-getting-started-item-0").assertIsDisplayed()
    }
}
