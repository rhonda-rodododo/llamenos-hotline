package org.llamenos.hotline.steps.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import io.cucumber.java.en.Then
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for notifications.feature scenarios.
 *
 * Feature: Notification Preferences — verifies the notifications
 * section and toggle switches are visible in settings.
 */
class NotificationSteps : BaseSteps() {

    @Then("I should see the notifications section")
    fun iShouldSeeTheNotificationsSection() {
        onNodeWithTag("settings-notifications-section").performScrollTo()
        onNodeWithTag("settings-notifications-section").assertIsDisplayed()
    }

    @Then("I should see the notification toggles")
    fun iShouldSeeTheNotificationToggles() {
        onNodeWithTag("notify-calls-toggle").performScrollTo()
        onNodeWithTag("notify-calls-toggle").assertIsDisplayed()
        onNodeWithTag("notify-shifts-toggle").assertIsDisplayed()
        onNodeWithTag("notify-general-toggle").assertIsDisplayed()
    }
}
