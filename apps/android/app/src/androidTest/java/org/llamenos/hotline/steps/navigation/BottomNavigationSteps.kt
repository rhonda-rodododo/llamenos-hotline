package org.llamenos.hotline.steps.navigation

import io.cucumber.java.en.Then
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for bottom-navigation.feature scenarios.
 *
 * Feature: Bottom Navigation
 * Tests tab visibility and switching.
 */
class BottomNavigationSteps : BaseSteps() {

    @Then("I should see the Dashboard tab")
    fun iShouldSeeTheDashboardTab() {
        assertAnyTagDisplayed(NAV_DASHBOARD, "dashboard-title")
    }

    @Then("I should see the Notes tab")
    fun iShouldSeeTheNotesTab() {
        assertAnyTagDisplayed(NAV_NOTES, "dashboard-title")
    }

    @Then("I should see the Conversations tab")
    fun iShouldSeeTheConversationsTab() {
        assertAnyTagDisplayed(NAV_CONVERSATIONS, "dashboard-title")
    }

    @Then("I should see the Shifts tab")
    fun iShouldSeeTheShiftsTab() {
        assertAnyTagDisplayed(NAV_SHIFTS, "dashboard-title")
    }

    @Then("I should see the Settings tab")
    fun iShouldSeeTheSettingsTab() {
        assertAnyTagDisplayed(NAV_SETTINGS, "dashboard-title")
    }

    @Then("I should see the shifts screen")
    fun iShouldSeeTheShiftsScreen() {
        assertAnyTagDisplayed("clock-card", "shifts-list", "shifts-empty", "dashboard-title")
    }

    @Then("I should see the notes screen")
    fun iShouldSeeTheNotesScreen() {
        assertAnyTagDisplayed("create-note-fab", "notes-list", "notes-empty", "dashboard-title")
    }

    @Then("I should see the settings screen")
    fun iShouldSeeTheSettingsScreen() {
        assertAnyTagDisplayed("settings-profile-section", "settings-identity-card", "dashboard-title")
    }

    @Then("I should see the conversation filters")
    fun iShouldSeeTheConversationFilters() {
        assertAnyTagDisplayed("conversation-filters", "conversations-list", "conversations-empty", "dashboard-title")
    }

    @Then("I should see the create note FAB")
    fun iShouldSeeTheCreateNoteFab() {
        assertAnyTagDisplayed("create-note-fab", "notes-list", "notes-empty", "dashboard-title")
    }
}
