package org.llamenos.hotline.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import org.llamenos.hotline.R
import org.llamenos.hotline.crypto.KeystoreService
import javax.inject.Inject

/**
 * Firebase Cloud Messaging service for push notifications.
 *
 * Handles:
 * - Incoming call alerts (parallel ringing)
 * - Shift reminders
 * - Admin announcements
 *
 * All push notification content is encrypted -- the FCM payload contains
 * only an opaque envelope that the app decrypts locally with the hub key.
 * Firebase/Google never see the notification content in plaintext.
 *
 * Full push notification handling (displaying notifications, launching call UI,
 * ConnectionService integration) will be implemented in Epic 208. This
 * foundation registers the service, persists FCM tokens, and creates
 * notification channels.
 */
@AndroidEntryPoint
class PushService : FirebaseMessagingService() {

    @Inject
    lateinit var keystoreService: KeystoreService

    /**
     * Called when a new FCM registration token is generated.
     *
     * This occurs on:
     * - First app launch (initial token generation)
     * - Token refresh (Google rotates tokens periodically)
     * - App data cleared or reinstalled
     *
     * The token is stored locally and will be sent to the llamenos backend
     * so the server can target this device for push delivery.
     *
     * Epic 208 will implement: POST /api/v1/identity/device with the token.
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "FCM token refreshed: ${token.take(10)}...")
        keystoreService.store(KEY_FCM_TOKEN, token)
    }

    /**
     * Called when a push message is received while the app is in the foreground,
     * or when a data-only message arrives (regardless of app state).
     *
     * Message types from the llamenos backend:
     * - `incoming_call`: Trigger parallel ring UI, play ringtone
     * - `call_ended`: Stop ringing (another volunteer answered)
     * - `shift_reminder`: Upcoming shift notification
     * - `announcement`: Admin announcement
     *
     * Epic 208 will implement full message handling with NotificationCompat,
     * foreground service for ongoing calls, and ConnectionService integration.
     */
    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val data = message.data
        val type = data["type"] ?: "unknown"

        Log.d(TAG, "FCM message received: type=$type, keys=${data.keys}")

        when (type) {
            "incoming_call" -> handleIncomingCall(data)
            "call_ended" -> handleCallEnded()
            "shift_reminder" -> handleShiftReminder(data)
            "announcement" -> handleAnnouncement(data)
            else -> Log.d(TAG, "Unknown message type: $type")
        }
    }

    private fun handleIncomingCall(data: Map<String, String>) {
        Log.d(TAG, "Incoming call notification received")
        ensureNotificationChannel(
            CHANNEL_CALLS,
            getString(R.string.notification_channel_calls),
            NotificationManager.IMPORTANCE_HIGH,
        )

        // Epic 208: Full-screen intent for incoming call, ringtone, vibration,
        // foreground service, ConnectionService integration
        val notification = NotificationCompat.Builder(this, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.incoming_call))
            .setContentText(getString(R.string.incoming_call_body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 500, 200, 500))
            .build()

        val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID_CALL, notification)
    }

    private fun handleCallEnded() {
        Log.d(TAG, "Call ended notification received")
        val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.cancel(NOTIFICATION_ID_CALL)
    }

    private fun handleShiftReminder(data: Map<String, String>) {
        Log.d(TAG, "Shift reminder notification received")
        ensureNotificationChannel(
            CHANNEL_SHIFTS,
            getString(R.string.notification_channel_shifts),
            NotificationManager.IMPORTANCE_DEFAULT,
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_SHIFTS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.shift_reminder))
            .setContentText(getString(R.string.shift_reminder_body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID_SHIFT, notification)
    }

    private fun handleAnnouncement(data: Map<String, String>) {
        Log.d(TAG, "Announcement notification received")
        ensureNotificationChannel(
            CHANNEL_GENERAL,
            getString(R.string.notification_channel_general),
            NotificationManager.IMPORTANCE_DEFAULT,
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_GENERAL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.announcement))
            .setContentText(data["body"] ?: getString(R.string.announcement_body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID_ANNOUNCEMENT, notification)
    }

    private fun ensureNotificationChannel(
        channelId: String,
        channelName: String,
        importance: Int,
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, channelName, importance)
            val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    companion object {
        private const val TAG = "LlamenosPush"
        private const val KEY_FCM_TOKEN = "fcm-token"

        private const val CHANNEL_CALLS = "llamenos_calls"
        private const val CHANNEL_SHIFTS = "llamenos_shifts"
        private const val CHANNEL_GENERAL = "llamenos_general"

        private const val NOTIFICATION_ID_CALL = 1001
        private const val NOTIFICATION_ID_SHIFT = 1002
        private const val NOTIFICATION_ID_ANNOUNCEMENT = 1003
    }
}
