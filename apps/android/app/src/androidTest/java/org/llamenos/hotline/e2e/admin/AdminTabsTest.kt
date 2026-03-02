package org.llamenos.hotline.e2e.admin

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.llamenos.hotline.MainActivity
import org.llamenos.hotline.helpers.NavTabs
import org.llamenos.hotline.helpers.TestNavigationHelper
import org.llamenos.hotline.helpers.assertAnyTagDisplayed

/**
 * E2E tests for admin-tabs.feature scenarios.
 *
 * Feature: Admin Tabs
 * Tests admin tab switching and content display.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class AdminTabsTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.SETTINGS)
        composeRule.onNodeWithTag("settings-admin-card").performScrollTo()
        composeRule.onNodeWithTag("settings-admin-card").performClick()
        composeRule.waitForIdle()
    }

    // Scenario: All four admin tabs are present
    @Test
    fun allFourAdminTabsArePresent() {
        composeRule.onNodeWithTag("admin-tab-volunteers").assertIsDisplayed()
        composeRule.onNodeWithTag("admin-tab-bans").assertIsDisplayed()
        composeRule.onNodeWithTag("admin-tab-audit").assertIsDisplayed()
        composeRule.onNodeWithTag("admin-tab-invites").assertIsDisplayed()
    }

    // Scenario: Default tab is Volunteers
    @Test
    fun defaultTabIsVolunteers() {
        composeRule.onNodeWithTag("admin-tab-volunteers").assertIsDisplayed()
        val found = composeRule.assertAnyTagDisplayed(
            "volunteers-loading", "volunteers-empty", "volunteers-list"
        )
        assert(found) { "Expected volunteers content (loading, empty, or list)" }
    }

    // Scenario Outline: Switch to Ban List tab
    @Test
    fun switchToAdminTabBanList() {
        composeRule.onNodeWithTag("admin-tab-bans").performClick()
        composeRule.waitForIdle()
        val found = composeRule.assertAnyTagDisplayed(
            "bans-loading", "bans-empty", "bans-list"
        )
        assert(found) { "Expected bans content (loading, empty, or list)" }
    }

    // Scenario Outline: Switch to Audit Log tab
    @Test
    fun switchToAdminTabAuditLog() {
        composeRule.onNodeWithTag("admin-tab-audit").performClick()
        composeRule.waitForIdle()
        val found = composeRule.assertAnyTagDisplayed(
            "audit-loading", "audit-empty", "audit-list"
        )
        assert(found) { "Expected audit content (loading, empty, or list)" }
    }

    // Scenario Outline: Switch to Invites tab
    @Test
    fun switchToAdminTabInvites() {
        composeRule.onNodeWithTag("admin-tab-invites").performClick()
        composeRule.waitForIdle()
        val found = composeRule.assertAnyTagDisplayed(
            "invites-loading", "invites-empty", "invites-list"
        )
        assert(found) { "Expected invites content (loading, empty, or list)" }
    }

    // Scenario: Switch between all tabs without crash
    @Test
    fun switchBetweenAllTabsWithoutCrash() {
        composeRule.onNodeWithTag("admin-tab-bans").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("admin-tab-audit").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("admin-tab-invites").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("admin-tab-volunteers").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("admin-tab-volunteers").assertIsDisplayed()
    }
}
