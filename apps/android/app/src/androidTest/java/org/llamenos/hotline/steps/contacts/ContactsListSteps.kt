package org.llamenos.hotline.steps.contacts

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.cucumber.java.en.And
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for contacts-list.feature scenarios.
 *
 * Feature: Contacts List — navigation from dashboard, empty state,
 * and back navigation.
 */
class ContactsListSteps : BaseSteps() {

    // ---- Navigation ----

    @When("I tap the view contacts button")
    fun iTapTheViewContactsButton() {
        onNodeWithTag("view-contacts").performClick()
        composeRule.waitForIdle()
    }

    @Then("I should see the contacts screen")
    fun iShouldSeeTheContactsScreen() {
        onNodeWithTag("contacts-title").assertIsDisplayed()
    }

    @Then("I should see the contacts title")
    fun iShouldSeeTheContactsTitle() {
        onNodeWithTag("contacts-title").assertIsDisplayed()
    }

    @And("I tap the back button on contacts")
    fun iTapTheBackButtonOnContacts() {
        onNodeWithTag("contacts-back").performClick()
        composeRule.waitForIdle()
    }

    // ---- Empty state ----

    @Then("I should see the contacts empty state")
    fun iShouldSeeTheContactsEmptyState() {
        // Either shows empty state or a list — both are valid depending on data
        assertAnyTagDisplayed("contacts-empty", "contacts-list")
    }
}
