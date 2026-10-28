package com.agent.ai

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Accessibility Service that acts as the "hands" of the agent.
 * It can perform taps, swipes, long presses, type text, and read the UI tree.
 */
class AgentService : AccessibilityService() {

    companion object {
        private const val TAG = "AgentService"

        @Volatile
        private var instance: AgentService? = null

        fun getInstance(): AgentService? = instance
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "AgentService connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // We mostly use pull-based approach (getRootInActiveWindow)
        // Events can be used later for smarter waiting
    }

    override fun onInterrupt() {
        Log.w(TAG, "AgentService interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        Log.i(TAG, "AgentService destroyed")
    }

    // =========================================================
    //                      PUBLIC ACTIONS
    // =========================================================

    /**
     * Tap at specific screen coordinates
     */
    fun tap(x: Float, y: Float, durationMs: Long = 50): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()

        return dispatchGestureSync(gesture)
    }

    /**
     * Long press at coordinates
     */
    fun longPress(x: Float, y: Float, durationMs: Long = 800): Boolean {
        return tap(x, y, durationMs)
    }

    /**
     * Swipe from (x1,y1) to (x2,y2)
     */
    fun swipe(
        x1: Float, y1: Float,
        x2: Float, y2: Float,
        durationMs: Long = 400
    ): Boolean {
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()

        return dispatchGestureSync(gesture)
    }

    /**
     * Scroll down (common action)
     */
    fun scrollDown(distance: Float = 800f): Boolean {
        val metrics = resources.displayMetrics
        val centerX = metrics.widthPixels / 2f
        val startY = metrics.heightPixels * 0.7f
        val endY = startY - distance
        return swipe(centerX, startY, centerX, endY, 500)
    }

    /**
     * Scroll up
     */
    fun scrollUp(distance: Float = 800f): Boolean {
        val metrics = resources.displayMetrics
        val centerX = metrics.widthPixels / 2f
        val startY = metrics.heightPixels * 0.3f
        val endY = startY + distance
        return swipe(centerX, startY, centerX, endY, 500)
    }

    /**
     * Type text into the currently focused field
     */
    fun typeText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val focused = findFocusedNode(root) ?: return false

        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
    }

    /**
     * Paste text using clipboard (more reliable in some apps)
     */
    fun pasteText(text: String): Boolean {
        // First try set text
        if (typeText(text)) return true

        // Fallback: focus + paste is more complex, keep simple for now
        return false
    }

    /**
     * Press Back button
     */
    fun pressBack(): Boolean {
        return performGlobalAction(GLOBAL_ACTION_BACK)
    }

    /**
     * Press Home button
     */
    fun pressHome(): Boolean {
        return performGlobalAction(GLOBAL_ACTION_HOME)
    }

    /**
     * Open Recents
     */
    fun pressRecents(): Boolean {
        return performGlobalAction(GLOBAL_ACTION_RECENTS)
    }

    /**
     * Get a simplified text representation of the current screen UI tree.
     * Useful to feed into the LLM.
     */
    fun getScreenText(maxDepth: Int = 8): String {
        val root = rootInActiveWindow ?: return "Unable to get screen content"
        val builder = StringBuilder()
        buildNodeTree(root, builder, 0, maxDepth)
        return builder.toString()
    }

    /**
     * Find a node that contains the given text (case insensitive)
     */
    fun findNodeByText(text: String): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        return findNodeByTextRecursive(root, text.lowercase())
    }

    /**
     * Tap on a node that contains the given text
     */
    fun tapOnText(text: String): Boolean {
        val node = findNodeByText(text) ?: return false
        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (rect.isEmpty) return false
        val x = rect.centerX().toFloat()
        val y = rect.centerY().toFloat()
        return tap(x, y)
    }

    // =========================================================
    //                      INTERNAL HELPERS
    // =========================================================

    private fun dispatchGestureSync(gesture: GestureDescription, timeoutMs: Long = 2000): Boolean {
        val latch = CountDownLatch(1)
        var success = false

        val callback = object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                success = true
                latch.countDown()
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                success = false
                latch.countDown()
            }
        }

        val result = dispatchGesture(gesture, callback, mainHandler)
        if (!result) return false

        return try {
            latch.await(timeoutMs, TimeUnit.MILLISECONDS) && success
        } catch (e: InterruptedException) {
            false
        }
    }

    private fun findFocusedNode(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isFocused && node.isEditable) return node

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findFocusedNode(child)
            if (result != null) return result
        }
        return null
    }

    private fun findNodeByTextRecursive(node: AccessibilityNodeInfo, query: String): AccessibilityNodeInfo? {
        val nodeText = node.text?.toString()?.lowercase() ?: ""
        val contentDesc = node.contentDescription?.toString()?.lowercase() ?: ""

        if (nodeText.contains(query) || contentDesc.contains(query)) {
            return node
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = findNodeByTextRecursive(child, query)
            if (result != null) return result
        }
        return null
    }

    private fun buildNodeTree(
        node: AccessibilityNodeInfo,
        builder: StringBuilder,
        depth: Int,
        maxDepth: Int
    ) {
        if (depth > maxDepth) return

        val text = node.text?.toString()?.trim()
        val desc = node.contentDescription?.toString()?.trim()
        val className = node.className?.toString()?.substringAfterLast('.') ?: ""
        val isClickable = node.isClickable

        if (!text.isNullOrEmpty() || !desc.isNullOrEmpty() || isClickable) {
            val indent = "  ".repeat(depth)
            val label = when {
                !text.isNullOrEmpty() -> text
                !desc.isNullOrEmpty() -> desc
                else -> className
            }
            val clickableMark = if (isClickable) " [clickable]" else ""
            builder.append("$indent- $label$clickableMark\n")
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            buildNodeTree(child, builder, depth + 1, maxDepth)
        }
    }
}