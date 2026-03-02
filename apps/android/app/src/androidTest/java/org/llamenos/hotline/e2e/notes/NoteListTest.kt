package org.llamenos.hotline.e2e.notes

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
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
 * E2E tests for note-list.feature scenarios.
 *
 * Feature: Notes List
 * Tests navigation to notes tab and FAB visibility.
 */
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class NoteListTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        TestNavigationHelper.navigateToMainScreen(composeRule)
    }

    // Scenario: Navigate to notes tab
    @Test
    fun navigateToNotesTab() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.NOTES)
        composeRule.onNodeWithTag("create-note-fab").assertIsDisplayed()
    }

    // Scenario: Notes tab shows empty state or list
    @Test
    fun notesTabShowsEmptyStateOrList() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.NOTES)
        val found = composeRule.assertAnyTagDisplayed(
            "notes-list", "notes-empty", "notes-loading"
        )
        assert(found) { "Expected notes screen to show list, empty, or loading state" }
    }

    // Scenario: Create note FAB navigates to create screen
    @Test
    fun createNoteFabNavigatesToCreateScreen() {
        TestNavigationHelper.navigateToTab(composeRule, NavTabs.NOTES)
        composeRule.onNodeWithTag("create-note-fab").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("note-create-title").assertIsDisplayed()
        composeRule.onNodeWithTag("note-text-input").assertIsDisplayed()
        composeRule.onNodeWithTag("note-save-button").assertIsDisplayed()
        composeRule.onNodeWithTag("note-create-back").assertIsDisplayed()
    }
}
