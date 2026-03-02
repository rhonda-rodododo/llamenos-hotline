package org.llamenos.hotline.steps.dashboard

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for dashboard-break.feature.
 *
 * Tests the break toggle and banner on the dashboard.
 */
class DashboardBreakSteps : BaseSteps() {

    @Given("the volunteer is on shift")
    fun theVolunteerIsOnShift() {
        // In demo mode, volunteer may already be on shift
        composeRule.waitForIdle()
    }

    @Given("the volunteer is on break")
    fun theVolunteerIsOnBreak() {
        // In demo mode, break state is simulated
        composeRule.waitForIdle()
    }

    @Then("I should see the break toggle button")
    fun iShouldSeeTheBreakToggleButton() {
        onNodeWithTag("dashboard-break-button").assertIsDisplayed()
    }

    @Then("I should see the on-break banner")
    fun iShouldSeeTheOnBreakBanner() {
        onNodeWithTag("break-banner").assertIsDisplayed()
    }
}
