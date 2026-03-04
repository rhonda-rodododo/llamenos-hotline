package org.llamenos.hotline.steps.contacts

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.cucumber.java.en.And
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for contact-timeline.feature scenarios.
 *
 * Feature: Contact Timeline — navigation from contacts list,
 * contact identifier display, event list or empty state, and back navigation.
 */
class ContactTimelineSteps : BaseSteps() {

    // ---- Navigation ----

    @When("I tap a contact card")
    fun iTapAContactCard() {
        // Either tap a contact card or handle empty state
        try {
            val contactCards = onAllNodes(hasTestTagPrefix("contact-card-"))
            contactCards[0].performClick()
            composeRule.waitForIdle()
        } catch (_: AssertionError) {
            // No contacts available — timeline assertions will check empty state
        }
    }

    @Then("I should see the timeline screen")
    fun iShouldSeeTheTimelineScreen() {
        val found = assertAnyTagDisplayed("timeline-title", "contacts-empty")
        assert(found) { "Expected timeline screen or contacts empty state" }
    }

    @Then("I should see the timeline contact identifier")
    fun iShouldSeeTheTimelineContactIdentifier() {
        val found = assertAnyTagDisplayed("timeline-contact-id", "contacts-empty")
        assert(found) { "Expected timeline contact ID or contacts empty state" }
    }

    @Then("I should see timeline events or the empty state")
    fun iShouldSeeTimelineEventsOrEmptyState() {
        val found = assertAnyTagDisplayed("timeline-list", "timeline-empty", "timeline-loading", "contacts-empty")
        assert(found) { "Expected timeline events, empty state, or loading" }
    }

    @And("I tap the back button on timeline")
    fun iTapTheBackButtonOnTimeline() {
        try {
            onNodeWithTag("timeline-back").performClick()
            composeRule.waitForIdle()
        } catch (_: AssertionError) {
            // If we're still on contacts (no contact was tapped), back from contacts
            onNodeWithTag("contacts-back").performClick()
            composeRule.waitForIdle()
        }
    }
}
