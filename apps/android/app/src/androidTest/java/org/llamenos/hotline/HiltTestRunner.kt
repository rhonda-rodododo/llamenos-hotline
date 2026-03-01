package org.llamenos.hotline

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner
import dagger.hilt.android.testing.HiltTestApplication

/**
 * Custom AndroidJUnitRunner that uses [HiltTestApplication] as the test Application class.
 *
 * This is required for Hilt to generate the test component graph properly.
 * Referenced in app/build.gradle.kts as testInstrumentationRunner.
 */
class HiltTestRunner : AndroidJUnitRunner() {
    override fun newApplication(
        cl: ClassLoader?,
        className: String?,
        context: Context?,
    ): Application {
        return super.newApplication(cl, HiltTestApplication::class.java.name, context)
    }
}
