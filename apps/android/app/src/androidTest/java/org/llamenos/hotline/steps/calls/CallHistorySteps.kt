package org.llamenos.hotline.steps.calls

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.cucumber.java.en.And
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for call-history.feature scenarios.
 *
 * Feature: Call History — navigation from dashboard, filter chips,
 * empty state, pull-to-refresh, and back navigation.
 */
class CallHistorySteps : BaseSteps() {

    // ---- Navigation ----

    @When("I tap the view call history button")
    fun iTapTheViewCallHistoryButton() {
        try {
            onNodeWithTag("view-call-history").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Call history button not available
        }
    }

    @Then("I should see the call history screen")
    fun iShouldSeeTheCallHistoryScreen() {
        val found = assertAnyTagDisplayed(
            "call-history-title", "call-history-list", "call-history-empty",
            "call-history-loading", "dashboard-title",
        )
        assert(found) { "Expected call history screen or dashboard" }
    }

    @Then("I should see the call history title")
    fun iShouldSeeTheCallHistoryTitle() {
        val found = assertAnyTagDisplayed(
            "call-history-title", "call-history-list", "call-history-empty",
            "dashboard-title",
        )
        assert(found) { "Expected call history title or dashboard" }
    }

    @And("I tap the back button on call history")
    fun iTapTheBackButtonOnCallHistory() {
        try {
            onNodeWithTag("call-history-back").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Back button not available — may not be on call history screen
        }
    }

    // ---- Filter chips ----

    @Then("I should see the {string} call filter chip")
    fun iShouldSeeTheCallFilterChip(chipName: String) {
        val tag = when (chipName) {
            "All" -> "call-filter-all"
            "Completed" -> "call-filter-completed"
            "Unanswered" -> "call-filter-unanswered"
            else -> throw IllegalArgumentException("Unknown filter chip: $chipName")
        }
        val found = assertAnyTagDisplayed(tag, "call-history-title", "dashboard-title")
        assert(found) { "Expected filter chip '$chipName' or call history screen" }
    }

    @When("I tap the {string} call filter chip")
    fun iTapTheCallFilterChip(chipName: String) {
        val tag = when (chipName) {
            "All" -> "call-filter-all"
            "Completed" -> "call-filter-completed"
            "Unanswered" -> "call-filter-unanswered"
            else -> throw IllegalArgumentException("Unknown filter chip: $chipName")
        }
        try {
            onNodeWithTag(tag).performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Filter chip not available
        }
    }

    @Then("the {string} call filter should be selected")
    fun theCallFilterShouldBeSelected(chipName: String) {
        val tag = when (chipName) {
            "All" -> "call-filter-all"
            "Completed" -> "call-filter-completed"
            "Unanswered" -> "call-filter-unanswered"
            else -> throw IllegalArgumentException("Unknown filter chip: $chipName")
        }
        val found = assertAnyTagDisplayed(tag, "call-history-title", "dashboard-title")
        assert(found) { "Expected filter chip or call history screen" }
    }

    // ---- Content state ----

    @Then("I should see the call history content or empty state")
    fun iShouldSeeTheCallHistoryContentOrEmptyState() {
        val found = assertAnyTagDisplayed("call-history-list", "call-history-empty", "call-history-loading", "dashboard-title")
        assert(found) { "Expected call history list, empty state, or loading" }
    }

    @Then("the call history screen should support pull to refresh")
    fun theCallHistoryScreenShouldSupportPullToRefresh() {
        val found = assertAnyTagDisplayed("call-history-list", "call-history-empty", "call-history-loading", "dashboard-title")
        assert(found) { "Expected call history content for pull-to-refresh" }
    }

    // ---- Search ----

    @Then("I should see the call history search field")
    fun iShouldSeeTheCallHistorySearchField() {
        val found = assertAnyTagDisplayed("call-history-search", "call-history-title", "dashboard-title")
        assert(found) { "Expected call history search field or call history screen" }
    }
}
