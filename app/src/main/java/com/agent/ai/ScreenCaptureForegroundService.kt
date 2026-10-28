package com.agent.ai

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.IntentCompat

class ScreenCaptureForegroundService : Service() {

    companion object {
        const val ACTION_START = "com.agent.ai.action.START_CAPTURE"
        const val ACTION_STOP = "com.agent.ai.action.STOP_CAPTURE"
        const val EXTRA_RESULT_CODE = "com.agent.ai.extra.RESULT_CODE"
        const val EXTRA_RESULT_DATA = "com.agent.ai.extra.RESULT_DATA"

        private const val TAG = "ScreenCaptureService"
        private const val CHANNEL_ID = "screen_capture"
        private const val NOTIFICATION_ID = 101
    }

    private val screenCapture: ScreenCapture
        get() = (application as PhoneAgentApplication).screenCapture

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf(startId)
                return START_NOT_STICKY
            }
            ACTION_START -> startCapture(intent, startId)
            else -> {
                Log.e(TAG, "Started without a valid action")
                stopSelf(startId)
            }
        }
        return START_NOT_STICKY
    }

    private fun startCapture(intent: Intent, startId: Int) {
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        val resultData = IntentCompat.getParcelableExtra(
            intent,
            EXTRA_RESULT_DATA,
            Intent::class.java
        )
        if (resultCode == 0 || resultData == null) {
            Log.e(TAG, "MediaProjection permission data is missing")
            stopSelf(startId)
            return
        }

        try {
            createNotificationChannel()
            startForeground(
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
            screenCapture.start(resultCode, resultData)
        } catch (e: Exception) {
            Log.e(TAG, "Could not start screen capture", e)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
        }
    }

    private fun buildNotification() =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Screen capture is active for your agent task.")
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
            .setOngoing(true)
            .addAction(
                0,
                "Stop capture",
                PendingIntent.getService(
                    this,
                    1,
                    Intent(this, ScreenCaptureForegroundService::class.java).setAction(ACTION_STOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
            .build()

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Phone screen capture",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        screenCapture.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
