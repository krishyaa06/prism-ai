package com.agent.ai

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * Handles screen capture using MediaProjection API.
 * Used by the AgentLoop to get the current screen as a Bitmap.
 */
class ScreenCapture(private val context: Context) {

    companion object {
        private const val TAG = "ScreenCapture"
        const val REQUEST_MEDIA_PROJECTION = 1001
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null

    private var screenWidth = 0
    private var screenHeight = 0
    private var screenDensity = 0

    private var latestBitmap: Bitmap? = null
    private val lock = Any()

    /**
     * Call this from MainActivity when user grants MediaProjection permission.
     */
    fun start(resultCode: Int, data: Intent) {
        stop()
        val projectionManager =
            context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        val projection = projectionManager.getMediaProjection(resultCode, data)
        mediaProjection = projection

        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                Log.d(TAG, "MediaProjection stopped")
                mediaProjection = null
                releaseCaptureResources()
                context.stopService(Intent(context, ScreenCaptureForegroundService::class.java))
            }
        }, Handler(context.mainLooper))

        try {
            setupVirtualDisplay()
        } catch (e: Exception) {
            stop()
            throw e
        }
        Log.d(TAG, "ScreenCapture started: ${screenWidth}x${screenHeight}")
    }

    private fun setupVirtualDisplay() {
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()

        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(metrics)

        screenWidth = metrics.widthPixels
        screenHeight = metrics.heightPixels
        screenDensity = metrics.densityDpi

        // Start background thread for image processing
        handlerThread = HandlerThread("ScreenCaptureThread").also { it.start() }
        handler = Handler(handlerThread!!.looper)

        imageReader = ImageReader.newInstance(
            screenWidth,
            screenHeight,
            PixelFormat.RGBA_8888,
            2
        )

        imageReader?.setOnImageAvailableListener({ reader ->
            var image: Image? = null
            try {
                image = reader.acquireLatestImage()
                if (image != null) {
                    val bitmap = imageToBitmap(image)
                    synchronized(lock) {
                        latestBitmap?.recycle()
                        latestBitmap = bitmap
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error capturing frame", e)
            } finally {
                image?.close()
            }
        }, handler)

        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "PhoneAgentVirtualDisplay",
            screenWidth,
            screenHeight,
            screenDensity,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            handler
        )
    }

    private fun imageToBitmap(image: Image): Bitmap {
        val planes = image.planes
        val buffer: ByteBuffer = planes[0].buffer
        val pixelStride = planes[0].pixelStride
        val rowStride = planes[0].rowStride
        val rowPadding = rowStride - pixelStride * screenWidth

        val bitmap = Bitmap.createBitmap(
            screenWidth + rowPadding / pixelStride,
            screenHeight,
            Bitmap.Config.ARGB_8888
        )
        bitmap.copyPixelsFromBuffer(buffer)

        // Crop padding if needed
        return if (rowPadding == 0) {
            bitmap
        } else {
            Bitmap.createBitmap(bitmap, 0, 0, screenWidth, screenHeight).also {
                if (it != bitmap) bitmap.recycle()
            }
        }
    }

    /**
     * Returns the latest captured screen as Bitmap.
     * Can be null if capture has not started or no frame is ready yet.
     */
    fun capture(): Bitmap? {
        synchronized(lock) {
            val bitmap = latestBitmap ?: return null
            return bitmap.copy(bitmap.config ?: Bitmap.Config.ARGB_8888, false)
        }
    }

    fun captureJpeg(maxDimension: Int = 960): ByteArray? {
        val source = capture() ?: return null
        val scale = minOf(1f, maxDimension.toFloat() / maxOf(source.width, source.height))
        val scaled = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                source,
                (source.width * scale).toInt().coerceAtLeast(1),
                (source.height * scale).toInt().coerceAtLeast(1),
                true
            )
        } else {
            source
        }

        return try {
            ByteArrayOutputStream().use { output ->
                check(scaled.compress(Bitmap.CompressFormat.JPEG, 82, output)) {
                    "Could not encode the captured screen"
                }
                output.toByteArray()
            }
        } finally {
            scaled.recycle()
            if (scaled !== source) source.recycle()
        }
    }

    /**
     * Returns screen dimensions
     */
    fun getScreenSize(): Pair<Int, Int> = Pair(screenWidth, screenHeight)

    fun isRunning(): Boolean = mediaProjection != null && virtualDisplay != null

    fun stop() {
        val projection = mediaProjection
        mediaProjection = null
        releaseCaptureResources()
        projection?.stop()
        Log.d(TAG, "ScreenCapture stopped")
    }

    private fun releaseCaptureResources() {
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        handlerThread?.quitSafely()
        handlerThread = null
        handler = null
        synchronized(lock) {
            latestBitmap?.recycle()
            latestBitmap = null
        }
    }

    /**
     * Helper to create the permission intent from Activity
     */
    fun createScreenCaptureIntent(): Intent {
        val projectionManager =
            context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        return projectionManager.createScreenCaptureIntent()
    }
}