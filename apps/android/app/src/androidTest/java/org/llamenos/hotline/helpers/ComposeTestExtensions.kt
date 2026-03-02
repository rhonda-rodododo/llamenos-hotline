package org.llamenos.hotline.helpers

import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.rules.ActivityScenarioRule
import org.llamenos.hotline.MainActivity

/**
 * Utility extension functions for Compose UI tests.
 */

/**
 * Type alias for the standard compose test rule used across all E2E tests.
 */
typealias ComposeRule = AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>

/**
 * Assert that a node with the given test tag is displayed.
 * Returns the [SemanticsNodeInteraction] for chaining.
 */
fun ComposeRule.assertTagDisplayed(tag: String): SemanticsNodeInteraction =
    onNodeWithTag(tag).assertIsDisplayed()

/**
 * Click a node with the given test tag and wait for idle.
 */
fun ComposeRule.clickTag(tag: String) {
    onNodeWithTag(tag).performClick()
    waitForIdle()
}

/**
 * Scroll to and assert that a node with the given test tag is displayed.
 * Useful for items below the fold in scrollable views.
 */
fun ComposeRule.scrollToAndAssertTag(tag: String): SemanticsNodeInteraction {
    onNodeWithTag(tag).performScrollTo()
    return onNodeWithTag(tag).assertIsDisplayed()
}

/**
 * Check if any of the given tags are displayed (loading/empty/list pattern).
 * Returns true if at least one tag is found. Uses try/catch since
 * assertIsDisplayed throws AssertionError when node is not found.
 */
fun ComposeRule.assertAnyTagDisplayed(vararg tags: String): Boolean {
    for (tag in tags) {
        try {
            onNodeWithTag(tag).assertIsDisplayed()
            return true
        } catch (_: AssertionError) {
            continue
        }
    }
    return false
}

/**
 * Enter a 4-digit PIN by tapping pin-N buttons sequentially.
 */
fun ComposeRule.enterPin(pin: String) {
    for (digit in pin.toList()) {
        onNodeWithTag("pin-$digit").performClick()
    }
    waitForIdle()
}
