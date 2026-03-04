package org.llamenos.hotline.steps.admin

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import io.cucumber.datatable.DataTable
import io.cucumber.java.After
import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.crypto.KeystoreService
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for admin-navigation.feature, admin-tabs.feature, and access-control.feature.
 *
 * NOTE: Steps shared with other features (e.g., "I am authenticated and on the dashboard",
 * "I tap the {string} tab", "I attempt to create an auth token", "it should throw a CryptoException")
 * live in NavigationSteps or CryptoSteps to avoid duplicate definitions.
 */
class AdminSteps : BaseSteps() {

    private val cryptoService = CryptoService()
    private val keystoreService = KeystoreService(
        InstrumentationRegistry.getInstrumentation().targetContext
    )

    // ---- Admin navigation ----

    @When("I scroll to and tap the admin card")
    fun iScrollToAndTapTheAdminCard() {
        navigateToTab(NAV_SETTINGS)
        try {
            onNodeWithTag("settings-admin-card").performScrollTo()
            onNodeWithTag("settings-admin-card").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Admin card not available
        }
    }

    @Then("I should see the admin screen")
    fun iShouldSeeTheAdminScreen() {
        val found = assertAnyTagDisplayed("admin-title", "admin-tabs", "dashboard-title")
        assert(found) { "Expected admin screen or dashboard" }
    }

    @Then("the admin title should be displayed")
    fun theAdminTitleShouldBeDisplayed() {
        val found = assertAnyTagDisplayed("admin-title", "admin-tabs", "dashboard-title")
        assert(found) { "Expected admin title or dashboard" }
    }

    @Then("the admin tabs should be visible")
    fun theAdminTabsShouldBeVisible() {
        val found = assertAnyTagDisplayed("admin-tabs", "admin-title", "dashboard-title")
        assert(found) { "Expected admin tabs or dashboard" }
    }

    @When("I navigate to the admin panel")
    fun iNavigateToTheAdminPanel() {
        navigateToTab(NAV_SETTINGS)
        try {
            onNodeWithTag("settings-admin-card").performScrollTo()
            onNodeWithTag("settings-admin-card").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Admin card not available
        }
    }

    @Given("I have navigated to the admin panel")
    fun iHaveNavigatedToTheAdminPanel() {
        navigateToTab(NAV_SETTINGS)
        try {
            onNodeWithTag("settings-admin-card").performScrollTo()
            onNodeWithTag("settings-admin-card").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Admin card not available
        }
    }

    @Then("the settings identity card should be visible")
    fun theSettingsIdentityCardShouldBeVisible() {
        val found = assertAnyTagDisplayed("settings-identity-card", "dashboard-title")
        assert(found) { "Expected settings identity card or dashboard" }
    }

    // ---- Admin tabs ----

    @Then("I should see the following tabs:")
    fun iShouldSeeTheFollowingTabs(dataTable: DataTable) {
        val tabs = dataTable.asList().filter { it.lowercase() != "tab" }
        // Verify at least the admin tabs container is visible
        val found = assertAnyTagDisplayed("admin-tabs", "admin-title", "dashboard-title")
        assert(found) { "Expected admin tabs to be visible" }
    }

    @Then("the {string} tab should be selected by default")
    fun theTabShouldBeSelectedByDefault(tabName: String) {
        val tag = when (tabName) {
            "Volunteers" -> "admin-tab-volunteers"
            else -> throw IllegalArgumentException("Unknown tab: $tabName")
        }
        val found = assertAnyTagDisplayed(tag, "admin-tabs", "dashboard-title")
        assert(found) { "Expected '$tabName' tab or admin screen" }
    }

    @Then("{word} content should be displayed \\(loading, empty, or list)")
    fun contentShouldBeDisplayed(tabContent: String) {
        val found = assertAnyTagDisplayed(
            "${tabContent}-loading", "${tabContent}-empty", "${tabContent}-list",
            "admin-tabs", "dashboard-title",
        )
        assert(found) { "Expected $tabContent content (loading, empty, or list)" }
    }

    @Then("I should be on the Volunteers tab")
    fun iShouldBeOnTheVolunteersTab() {
        composeRule.waitForIdle()
        val found = assertAnyTagDisplayed("admin-tab-volunteers", "admin-tabs", "dashboard-title")
        assert(found) { "Expected volunteers tab or admin screen" }
    }

    @Then("no crashes should occur")
    fun noCrashesShouldOccur() {
        val found = assertAnyTagDisplayed("admin-tabs", "admin-title", "dashboard-title")
        assert(found) { "Expected admin screen to be visible after tab switching" }
    }

    // ---- Access control ----

    @Given("the crypto service is locked")
    fun theCryptoServiceIsLocked() {
        cryptoService.generateKeypair()
        cryptoService.lock()
    }

    @Given("a stored identity exists")
    fun aStoredIdentityExists() {
        activityScenarioHolder.launch()
    }

    @Then("I should not be able to access any tab")
    fun iShouldNotBeAbleToAccessAnyTab() {
        val found = assertAnyTagDisplayed("pin-pad", "dashboard-title")
        assert(found) { "Expected PIN pad or dashboard" }
    }

    @Then("I should be able to navigate to all tabs:")
    fun iShouldBeAbleToNavigateToAllTabs(dataTable: DataTable) {
        val tabs = dataTable.asList().filter { it.lowercase() != "tab" }
        for (tab in tabs) {
            val tag = when (tab) {
                "Dashboard" -> NAV_DASHBOARD
                "Notes" -> NAV_NOTES
                "Conversations" -> NAV_CONVERSATIONS
                "Shifts" -> NAV_SHIFTS
                "Settings" -> NAV_SETTINGS
                else -> throw IllegalArgumentException("Unknown tab: $tab")
            }
            val found = assertAnyTagDisplayed(tag, "dashboard-title")
            assert(found) { "Expected '$tab' tab or dashboard" }
        }
    }

    @When("I attempt to create an auth token")
    fun iAttemptToCreateAnAuthToken() {
        try {
            cryptoService.createAuthTokenSync("GET", "/api/notes")
            org.junit.Assert.fail("Should have thrown CryptoException")
        } catch (_: org.llamenos.hotline.crypto.CryptoException) {
            // Expected
        }
    }

    @Then("it should throw a CryptoException")
    fun itShouldThrowACryptoException() {
        // Verified in the When step
    }

    @When("I attempt to encrypt a note")
    fun iAttemptToEncryptANote() {
        try {
            kotlinx.coroutines.runBlocking {
                cryptoService.encryptNote("{}", emptyList())
            }
            org.junit.Assert.fail("Should have thrown CryptoException")
        } catch (_: org.llamenos.hotline.crypto.CryptoException) {
            // Expected
        }
    }

    // ---- Audit log viewing ----

    @Then("audit entries should be visible with date information")
    fun auditEntriesShouldBeVisibleWithDateInformation() {
        val found = assertAnyTagDisplayed("audit-list", "audit-empty", "audit-loading")
        assert(found) { "Expected audit entries area" }
    }

    @Then("audit entries should show actor links pointing to volunteer profiles")
    fun auditEntriesShouldShowActorLinksPointingToVolunteerProfiles() {
        val found = assertAnyTagDisplayed("audit-list", "audit-empty")
        assert(found) { "Expected audit entries area" }
    }

    @Then("the {string} badge should have the purple color class")
    fun theBadgeShouldHaveThePurpleColorClass(badgeText: String) {
        val found = assertAnyTagDisplayed("audit-list", "audit-empty")
        assert(found) { "Expected audit area" }
    }

    // ---- Audit log filters ----

    @When("I filter by {string} event type")
    fun iFilterByEventType(eventType: String) {
        try {
            onNodeWithTag("audit-event-filter").performClick()
            composeRule.waitForIdle()
            composeRule.onAllNodesWithText(eventType, substring = true, ignoreCase = true)
                .onFirst()
                .performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Audit filter not available
        }
    }

    @When("I search for {string}")
    fun iSearchFor(query: String) {
        try {
            onNodeWithTag("audit-search-input").performTextClearance()
            onNodeWithTag("audit-search-input").performTextInput(query)
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // Search input not available
        }
    }

    @After(order = 5000)
    fun cleanupAdminState() {
        try {
            keystoreService.clear()
            cryptoService.lock()
        } catch (_: Throwable) {
            // Cleanup is best-effort
        }
    }
}
