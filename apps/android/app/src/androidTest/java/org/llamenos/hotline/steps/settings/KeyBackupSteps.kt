package org.llamenos.hotline.steps.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performScrollTo
import io.cucumber.java.en.Then
import org.llamenos.hotline.steps.BaseSteps

/**
 * Step definitions for key-backup.feature scenarios.
 *
 * Feature: Key Backup Settings — verifies the key backup section
 * is visible in settings and shows the security warning.
 */
class KeyBackupSteps : BaseSteps() {

    @Then("I should see the key backup section")
    fun iShouldSeeTheKeyBackupSection() {
        onNodeWithTag("settings-key-backup-section").performScrollTo()
        onNodeWithTag("settings-key-backup-section").assertIsDisplayed()
    }

    @Then("I should see the key backup warning")
    fun iShouldSeeTheKeyBackupWarning() {
        onNodeWithTag("key-backup-warning").performScrollTo()
        onNodeWithTag("key-backup-warning").assertIsDisplayed()
    }
}
