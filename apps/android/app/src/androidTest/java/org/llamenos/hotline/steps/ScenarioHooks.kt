package org.llamenos.hotline.steps

import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import io.cucumber.java.After
import io.cucumber.java.Before
import org.llamenos.hotline.crypto.CryptoService
import org.llamenos.hotline.crypto.KeystoreService
import org.llamenos.hotline.helpers.SimulationClient

/**
 * Cucumber hooks for scenario lifecycle management.
 *
 * @Before(order = 0): Grant camera permissions.
 * @Before(order = 1): Create an isolated test hub for this scenario.
 *   Each scenario gets its own hub ID, scoping all test data within it.
 *   No global database reset needed — hub isolation replaces resetServerState().
 * @After: Close activity, wipe local identity.
 */
class ScenarioHooks {

    companion object {
        /**
         * The hub ID created for the current scenario.
         * Set in @Before(order = 1), readable by step definitions via ScenarioHooks.currentHubId.
         *
         * Thread-safe: Cucumber-Android runs scenarios sequentially within a single device,
         * so a single companion object var is safe.
         */
        @Volatile
        var currentHubId: String = ""
            private set
    }

    private val keystoreService = KeystoreService(
        InstrumentationRegistry.getInstrumentation().targetContext
    )
    private val cryptoService = CryptoService()

    /**
     * Grant runtime permissions before each scenario to prevent system dialogs
     * from stealing focus from the Compose test harness.
     * Camera permission is needed for Device Linking QR scanner.
     */
    @Before(order = 0)
    fun grantPermissions() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val packageName = instrumentation.targetContext.packageName
        try {
            instrumentation.uiAutomation.executeShellCommand(
                "pm grant $packageName android.permission.CAMERA"
            ).close()
        } catch (e: Exception) {
            Log.w("ScenarioHooks", "Camera permission grant failed: ${e.message}")
        }
    }

    /**
     * Create an isolated hub for this scenario.
     * Replaces the previous resetServerState() — no global database wipe.
     * Each scenario gets its own hub, so tests never share data.
     */
    @Before(order = 1)
    fun createScenarioHub() {
        try {
            val response = SimulationClient.createTestHub()
            if (response.id.isNotEmpty()) {
                currentHubId = response.id
                Log.d("ScenarioHooks", "Created test hub: ${response.id} (${response.name})")
            } else {
                Log.w("ScenarioHooks", "createTestHub returned empty ID — error: ${response.error}")
            }
        } catch (e: Exception) {
            Log.w("ScenarioHooks", "createTestHub failed: ${e.message}")
            // Best-effort — don't fail the scenario if hub creation fails
        }
    }

    @After(order = 10000)
    fun closeActivity() {
        ComposeRuleHolder.current.activityScenarioHolder.close()
    }

    @After(order = 9000)
    fun clearIdentityState() {
        try {
            keystoreService.clear()
            cryptoService.lock()
        } catch (_: Throwable) {
            // Cleanup is best-effort
        }
    }
}
