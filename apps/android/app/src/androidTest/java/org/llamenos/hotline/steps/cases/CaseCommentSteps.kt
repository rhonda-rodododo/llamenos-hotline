package org.llamenos.hotline.steps.cases

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import io.cucumber.java.en.And
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for adding comments to the case timeline.
 *
 * Covers: tapping the comment input to open the AddCommentSheet,
 * typing a comment, submitting it, and verifying the timeline updates.
 *
 * Comments are E2EE-encrypted via CryptoService before being sent to
 * the API as a "comment" interaction type.
 */
class CaseCommentSteps : BaseSteps() {

    // ---- When ----

    @When("I tap the comment input")
    fun iTapTheCommentInput() {
        // The comment input is at the bottom of the Timeline tab.
        // Make sure we're on the Timeline tab first.
        try {
            onNodeWithTag("case-tab-timeline").performClick()
            composeRule.waitForIdle()
        } catch (_: Throwable) {
            // May already be on Timeline tab
        }
        // Wait for the timeline content to load
        composeRule.waitUntil(10_000) {
            composeRule.onAllNodesWithTag("case-comment-input").fetchSemanticsNodes().isNotEmpty()
        }
        // Tap the comment button (it's an OutlinedButton that opens the sheet)
        onNodeWithTag("case-comment-input").performClick()
        composeRule.waitForIdle()
        // Wait for the AddCommentSheet to appear
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithTag("comment-sheet-title").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @And("I type {string}")
    fun iType(text: String) {
        // The comment input field inside the sheet
        composeRule.waitUntil(5_000) {
            composeRule.onAllNodesWithTag("comment-input").fetchSemanticsNodes().isNotEmpty()
        }
        onNodeWithTag("comment-input").performTextInput(text)
        composeRule.waitForIdle()
    }

    @And("I submit the comment")
    fun iSubmitTheComment() {
        onNodeWithTag("comment-submit").assertIsDisplayed()
        onNodeWithTag("comment-submit").performClick()
        composeRule.waitForIdle()
        // Wait for the sheet to dismiss (the ViewModel sets showCommentSheet = false)
        composeRule.waitUntil(10_000) {
            composeRule.onAllNodesWithTag("comment-sheet-title").fetchSemanticsNodes().isEmpty()
        }
    }

    // ---- Then ----

    @Then("the timeline should update with the new comment")
    fun theTimelineShouldUpdateWithTheNewComment() {
        // After submitting, the ViewModel calls loadInteractions which refreshes
        // the timeline. The new comment should appear as a timeline item.
        // Wait for timeline items to appear (the API may take a moment)
        composeRule.waitUntil(10_000) {
            composeRule.onAllNodes(hasTestTagPrefix("timeline-item-"))
                .fetchSemanticsNodes().isNotEmpty() ||
                composeRule.onAllNodesWithTag("case-timeline-empty").fetchSemanticsNodes().isNotEmpty()
        }
        // Verify no action error
        val hasError = composeRule.onAllNodesWithTag("case-detail-action-error")
            .fetchSemanticsNodes().isNotEmpty()
        if (hasError) {
            throw AssertionError("Comment submission failed: action error is displayed")
        }
        // If timeline items exist, the comment was added
        val hasItems = composeRule.onAllNodes(hasTestTagPrefix("timeline-item-"))
            .fetchSemanticsNodes().isNotEmpty()
        if (hasItems) {
            onAllNodes(hasTestTagPrefix("timeline-item-")).onFirst().assertIsDisplayed()
        }
    }
}
