package org.llamenos.hotline

import android.content.Context
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Lightweight crash reporter that captures uncaught exceptions to app-private storage.
 *
 * No third-party crash SDK — privacy commitment. Crash logs are stored locally
 * and can be sent to the hub server on next launch (opt-in, see Epic 213).
 *
 * Crash log format: timestamp, device info, thread name, and full stack trace.
 * Logs are stored in `files/crashes/` within the app's private storage.
 *
 * Retains the last [MAX_CRASH_FILES] crash logs to prevent disk bloat.
 */
@Singleton
class CrashReporter @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private var previousHandler: Thread.UncaughtExceptionHandler? = null

    /**
     * Install as the default uncaught exception handler.
     * Chains to the previous handler (Android's default) after logging.
     */
    fun install() {
        previousHandler = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                writeCrashLog(thread, throwable)
            } catch (_: Exception) {
                // If crash logging itself fails, don't recurse
            }

            // Chain to previous handler (Android's default kills the process)
            previousHandler?.uncaughtException(thread, throwable)
        }
    }

    /**
     * Get stored crash logs, newest first.
     * Returns at most [MAX_CRASH_FILES] entries.
     */
    fun getCrashLogs(): List<File> {
        return crashDir().listFiles()
            ?.sortedByDescending { it.lastModified() }
            ?.take(MAX_CRASH_FILES)
            ?: emptyList()
    }

    /**
     * Delete all stored crash logs.
     */
    fun clearCrashLogs() {
        crashDir().listFiles()?.forEach { it.delete() }
    }

    private fun writeCrashLog(thread: Thread, throwable: Throwable) {
        val dir = crashDir()
        dir.mkdirs()

        // Prune old crash files
        val existing = dir.listFiles()?.sortedByDescending { it.lastModified() } ?: emptyList()
        if (existing.size >= MAX_CRASH_FILES) {
            existing.drop(MAX_CRASH_FILES - 1).forEach { it.delete() }
        }

        val timestamp = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date())
        val file = File(dir, "crash_$timestamp.txt")

        val sw = StringWriter()
        val pw = PrintWriter(sw)

        pw.println("=== Llamenos Crash Report ===")
        pw.println("Timestamp: ${Date()}")
        pw.println("Thread: ${thread.name} (id=${thread.id})")
        pw.println("Device: ${Build.MANUFACTURER} ${Build.MODEL}")
        pw.println("Android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        pw.println("App: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        pw.println()
        pw.println("--- Stack Trace ---")
        throwable.printStackTrace(pw)
        pw.flush()

        file.writeText(sw.toString())
    }

    private fun crashDir(): File = File(context.filesDir, CRASH_DIR)

    companion object {
        private const val CRASH_DIR = "crashes"
        private const val MAX_CRASH_FILES = 10
    }
}
