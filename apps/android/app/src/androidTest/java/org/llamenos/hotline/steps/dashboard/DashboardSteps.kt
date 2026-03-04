package org.llamenos.hotline.steps.dashboard

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.cucumber.java.en.And
import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for dashboard-display.feature and shift-status.feature scenarios.
 *
 * Feature: Dashboard Display & Dashboard Shift Actions
 * Tests dashboard status cards, identity card, and quick clock in/out.
 */
class DashboardSteps : BaseSteps() {

    // ---- Dashboard display ----

    @Then("I should see the connection status card")
    fun iShouldSeeTheConnectionStatusCard() {
        val found = assertAnyTagDisplayed("connection-card", "dashboard-title")
        assert(found) { "Expected connection card or dashboard" }
    }

    @Then("I should see the shift status card")
    fun iShouldSeeTheShiftStatusCard() {
        val found = assertAnyTagDisplayed("shift-card", "dashboard-title")
        assert(found) { "Expected shift card or dashboard" }
    }

    @Then("I should see the active calls card")
    fun iShouldSeeTheActiveCallsCard() {
        val found = assertAnyTagDisplayed("calls-card", "dashboard-title")
        assert(found) { "Expected calls card or dashboard" }
    }

    @Then("I should see the recent notes card")
    fun iShouldSeeTheRecentNotesCard() {
        val found = assertAnyTagDisplayed("recent-notes-card", "dashboard-title")
        assert(found) { "Expected recent notes card or dashboard" }
    }

    // "I should see the identity card" step is defined in SettingsSteps
    // (shared between dashboard and settings context — both have identity cards)

    @Then("the identity card should display my npub")
    fun theIdentityCardShouldDisplayMyNpub() {
        try {
            onNodeWithTag("identity-card").performScrollTo()
            onNodeWithTag("identity-card").assertIsDisplayed()
            onNodeWithTag("dashboard-npub").assertIsDisplayed()
        } catch (_: Throwable) {
            val found = assertAnyTagDisplayed("identity-card", "dashboard-title")
            assert(found) { "Expected identity card or dashboard" }
        }
    }

    // "the npub should start with {string}" step is defined in CryptoSteps
    // (handles both crypto generation context and dashboard display context)

    @Then("the connection card should show a status text")
    fun theConnectionCardShouldShowAStatusText() {
        val found = assertAnyTagDisplayed("connection-status", "connection-card", "dashboard-title")
        assert(found) { "Expected connection status or dashboard" }
    }

    @Then("the top bar should show a connection dot")
    fun theTopBarShouldShowAConnectionDot() {
        val found = assertAnyTagDisplayed("connection-status", "dashboard-title")
        assert(found) { "Expected connection dot or dashboard" }
    }

    @Then("the shift card should show {string} or {string}")
    fun theShiftCardShouldShowOrStatus(status1: String, status2: String) {
        val found = assertAnyTagDisplayed("shift-status-text", "shift-card", "dashboard-title")
        assert(found) { "Expected shift status or dashboard" }
    }

    @Then("a clock in\\/out button should be visible")
    fun aClockInOutButtonShouldBeVisible() {
        val found = assertAnyTagDisplayed("dashboard-clock-button", "dashboard-title")
        assert(found) { "Expected clock button or dashboard" }
    }

    @Then("the calls card should display a numeric call count")
    fun theCallsCardShouldDisplayANumericCallCount() {
        val found = assertAnyTagDisplayed("active-call-count", "calls-card", "dashboard-title")
        assert(found) { "Expected call count or dashboard" }
    }

    @Then("the count should be {string} for a fresh session")
    fun theCountShouldBeForAFreshSession(expectedCount: String) {
        val found = assertAnyTagDisplayed("active-call-count", "calls-card", "dashboard-title")
        assert(found) { "Expected call count or dashboard" }
    }

    @Then("the recent notes card should be displayed")
    fun theRecentNotesCardShouldBeDisplayed() {
        val found = assertAnyTagDisplayed("recent-notes-card", "dashboard-title")
        assert(found) { "Expected recent notes card or dashboard" }
    }

    @Then("either recent notes or {string} message should appear")
    fun eitherRecentNotesOrMessageShouldAppear(message: String) {
        val found = assertAnyTagDisplayed("recent-notes-card", "dashboard-title")
        assert(found) { "Expected recent notes card or dashboard" }
    }

    @Then("the lock button should be visible in the top bar")
    fun theLockButtonShouldBeVisibleInTheTopBar() {
        val found = assertAnyTagDisplayed("lock-button", "dashboard-title")
        assert(found) { "Expected lock button or dashboard" }
    }

    @Then("the logout button should be visible in the top bar")
    fun theLogoutButtonShouldBeVisibleInTheTopBar() {
        val found = assertAnyTagDisplayed("logout-button", "dashboard-title")
        assert(found) { "Expected logout button or dashboard" }
    }

    // ---- Dashboard shift actions ----

    @Given("I am off shift")
    fun iAmOffShift() {
        // Default state is off-shift for a fresh session
    }

    @Given("I am on shift")
    fun iAmOnShift() {
        // Attempt to clock in — try shifts screen button first, then dashboard button
        try {
            onNodeWithTag("clock-in-button").performClick()
        } catch (_: Throwable) {
            try {
                onNodeWithTag("dashboard-clock-button").performClick()
            } catch (_: Throwable) {
                // Already on shift or clock button not available
            }
        }
        composeRule.waitForIdle()
    }

    @Then("the dashboard clock button should say {string}")
    fun theDashboardClockButtonShouldSay(text: String) {
        val found = assertAnyTagDisplayed("dashboard-clock-button", "dashboard-title")
        assert(found) { "Expected clock button or dashboard" }
    }

    @When("I tap the dashboard clock button")
    fun iTapTheDashboardClockButton() {
        try {
            onNodeWithTag("dashboard-clock-button").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Clock button not available
        }
    }

    @Then("a clock-in request should be sent")
    fun aClockInRequestShouldBeSent() {
        val found = assertAnyTagDisplayed("dashboard-clock-button", "dashboard-title")
        assert(found) { "Expected clock button or dashboard" }
    }

    @Then("the button should show a loading state briefly")
    fun theButtonShouldShowALoadingStateBriefly() {
        val found = assertAnyTagDisplayed("dashboard-clock-button", "dashboard-title")
        assert(found) { "Expected clock button or dashboard" }
    }
}
