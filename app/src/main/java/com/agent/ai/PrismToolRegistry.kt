package com.agent.ai

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.ContentValues
import android.content.ContentUris
import android.content.Intent
import android.net.Uri
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.app.RemoteInput
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/**
 * Local Android tools exposed to the on-device model.
 */
class PrismToolRegistry(
    private val context: Context,
    private val pickUserFile: suspend () -> String,
    private val requestContactsPermission: suspend () -> Boolean,
    private val requestCalendarPermission: suspend (write: Boolean) -> Boolean
) {
    companion object {
        const val TOOL_GUIDE = """
Available local tools (use {"action":"tool","tool":"NAME","arguments":{...}}):
- PrismOpenApp: {"app":"WhatsApp"} or {"package":"com.example.app"}
- PrismOpenSettings: {"page":"main|wifi|bluetooth|display|accessibility|apps"}
- PrismOpenWeb: {"url":"https://example.com"}
- PrismSearchCalendar: {"begin_epoch_ms":123,"end_epoch_ms":456}
- PrismCreateCalendarEvent: {"title":"...","begin_epoch_ms":123,"end_epoch_ms":456}
- PrismSearchContacts: {"query":"name"}
- PrismPickFile: {} (the user picks a text/JSON document; at most 2,000 characters are returned locally)
- PrismReadNotifications: {}
- PrismReplyNotification: {"package":"app.package","notification_title":"Exact title","text":"reply"}
- PrismEnableNotificationAccess: {}
Use only a tool relevant to the user's task. Never claim a tool succeeded unless its result says it did.
"""
    }

    suspend fun execute(name: String, arguments: org.json.JSONObject): String {
        return try {
            when (name) {
                "PrismOpenApp" -> openApp(arguments)
                "PrismOpenSettings" -> openSettings(arguments)
                "PrismOpenWeb" -> openWeb(arguments)
                "PrismSearchCalendar" -> searchCalendar(arguments)
                "PrismCreateCalendarEvent" -> createCalendarEvent(arguments)
                "PrismSearchContacts" -> searchContacts(arguments)
                "PrismPickFile" -> pickUserFile()
                "PrismReadNotifications" -> readNotifications()
                "PrismReplyNotification" -> replyNotification(arguments)
                "PrismEnableNotificationAccess" -> enableNotificationAccess()
                else -> "Prism tool failed: unsupported tool '$name'."
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            "Prism tool failed: ${e.message ?: e.javaClass.simpleName}"
        }
    }

    private fun openApp(arguments: org.json.JSONObject): String {
        val requestedApp = arguments.optString("app").trim()
        val requestedPackage = arguments.optString("package").trim()
        require(requestedApp.isNotBlank() || requestedPackage.isNotBlank()) {
            "An app name or package is required."
        }
        val launchIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val candidates = context.packageManager.queryIntentActivities(launchIntent, 0)
        val matches = candidates.filter { info ->
            val activity = info.activityInfo
            if (requestedPackage.isNotBlank()) {
                activity.packageName == requestedPackage
            } else {
                context.packageManager.getApplicationLabel(activity.applicationInfo)
                    .toString().equals(requestedApp, ignoreCase = true)
            }
        }
        val matchingPackages = matches.map { it.activityInfo.packageName }.distinct()
        require(matchingPackages.size == 1) {
            if (matchingPackages.isEmpty()) "No installed app matched the requested name or package."
            else "More than one app matched; specify its package name."
        }
        val selected = matches.first()
        val activity = selected.activityInfo
        context.startActivity(
            Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setClassName(activity.packageName, activity.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        return "PrismOpenApp opened ${context.packageManager.getApplicationLabel(activity.applicationInfo)}."
    }

    private fun openSettings(arguments: org.json.JSONObject): String {
        val action = when (arguments.optString("page", "main").lowercase()) {
            "main" -> Settings.ACTION_SETTINGS
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            else -> throw IllegalArgumentException("Settings page is not allowlisted.")
        }
        context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return "PrismOpenSettings opened the ${arguments.optString("page", "main")} settings page."
    }

    private fun openWeb(arguments: org.json.JSONObject): String {
        val uri = Uri.parse(arguments.optString("url"))
        require(uri.scheme.equals("https", true) || uri.scheme.equals("http", true)) {
            "Only http and https links are supported."
        }
        require(!uri.host.isNullOrBlank()) { "The URL must include a host." }
        context.startActivity(
            Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        return "PrismOpenWeb opened ${uri.host} in an installed browser."
    }

    private suspend fun createCalendarEvent(arguments: org.json.JSONObject): String {
        val title = arguments.optString("title").trim().take(200)
        val begin = arguments.optLong("begin_epoch_ms", -1)
        val end = arguments.optLong("end_epoch_ms", -1)
        require(title.isNotBlank()) { "An event title is required." }
        require(begin > System.currentTimeMillis() && end > begin) {
            "Provide a future start time and a later end time in epoch milliseconds."
        }
        require(end - begin <= TimeUnit.DAYS.toMillis(1)) {
            "Calendar events longer than 24 hours need manual editing."
        }
        val hasWritePermission = ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.WRITE_CALENDAR
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        require(hasWritePermission || requestCalendarPermission(true)) {
            "Calendar write permission was denied; no event was created."
        }
        val calendarId = findWritableCalendar()
        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, title)
            put(CalendarContract.Events.DTSTART, begin)
            put(CalendarContract.Events.DTEND, end)
            put(CalendarContract.Events.EVENT_TIMEZONE, java.util.TimeZone.getDefault().id)
            put(CalendarContract.Events.ALL_DAY, 0)
        }
        val eventUri = context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
            ?: throw IllegalStateException("Calendar provider did not create the event.")
        return "PrismCreateCalendarEvent created event ${ContentUris.parseId(eventUri)} in the Android calendar provider."
    }

    private suspend fun searchCalendar(arguments: org.json.JSONObject): String {
        val begin = arguments.optLong("begin_epoch_ms", -1)
        val end = arguments.optLong("end_epoch_ms", -1)
        require(begin >= 0 && end > begin && end - begin <= TimeUnit.DAYS.toMillis(31)) {
            "Provide a calendar search range no longer than 31 days in epoch milliseconds."
        }
        val hasReadPermission = ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.READ_CALENDAR
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        require(hasReadPermission || requestCalendarPermission(false)) {
            "Calendar read permission was denied; no calendar data was read."
        }
        val projection = arrayOf(
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND
        )
        val cursor = context.contentResolver.query(
            CalendarContract.Events.CONTENT_URI,
            projection,
            "${CalendarContract.Events.DTSTART} >= ? AND ${CalendarContract.Events.DTSTART} < ?",
            arrayOf(begin.toString(), end.toString()),
            "${CalendarContract.Events.DTSTART} ASC"
        ) ?: throw IllegalStateException("Calendar provider returned no results.")
        cursor.use {
            val titleColumn = it.getColumnIndexOrThrow(CalendarContract.Events.TITLE)
            val startColumn = it.getColumnIndexOrThrow(CalendarContract.Events.DTSTART)
            val endColumn = it.getColumnIndexOrThrow(CalendarContract.Events.DTEND)
            val results = buildList {
                while (it.moveToNext() && size < 30) {
                    add(
                        "${it.getString(titleColumn).orEmpty()} " +
                            "(${it.getLong(startColumn)}-${it.getLong(endColumn)})"
                    )
                }
            }
            return if (results.isEmpty()) "PrismSearchCalendar found no events in that range."
            else "PrismSearchCalendar results (local only):\n${results.joinToString("\n")}"
        }
    }

    private fun findWritableCalendar(): Long {
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.IS_PRIMARY,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL
        )
        val cursor = context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection,
            "${CalendarContract.Calendars.VISIBLE}=1 AND " +
                "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ?",
            arrayOf("500"),
            "${CalendarContract.Calendars.IS_PRIMARY} DESC"
        ) ?: throw IllegalStateException("Calendar provider returned no calendars.")
        cursor.use {
            if (!it.moveToFirst()) {
                throw IllegalStateException("No visible writable calendar is available.")
            }
            return it.getLong(it.getColumnIndexOrThrow(CalendarContract.Calendars._ID))
        }
    }

    private suspend fun searchContacts(arguments: org.json.JSONObject): String {
        val query = arguments.optString("query").trim().take(100)
        require(query.isNotBlank()) { "A contact search query is required." }
        val hasPermission = ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.READ_CONTACTS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        require(hasPermission || requestContactsPermission()) {
            "Contacts permission was denied; no contact data was read."
        }

        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )
        val cursor = context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%$query%"),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
        ) ?: throw IllegalStateException("Contacts provider returned no results.")
        cursor.use {
            val nameColumn = it.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val numberColumn = it.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
            val results = buildList {
                while (it.moveToNext() && size < 20) {
                    add("${it.getString(nameColumn)} — ${it.getString(numberColumn)}")
                }
            }
            return if (results.isEmpty()) "PrismSearchContacts found no matching contacts."
            else "PrismSearchContacts results (local only):\n${results.joinToString("\n")}"
        }
    }

    private fun readNotifications(): String {
        val listener = PrismNotificationListener.instance
            ?: return "Notification access is not connected. Use PrismEnableNotificationAccess, enable Phone Agent AI, then retry."
        val notifications = listener.currentNotifications()
        if (notifications.isEmpty()) return "PrismReadNotifications found no active notifications."
        return notifications.take(30).joinToString(
            prefix = "Active notification summaries (local only):\n",
            separator = "\n"
        ) { notification ->
            val extras = notification.notification.extras
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
            "${notification.packageName}: ${title.take(100)} — ${text.take(240)}"
        }
    }

    private fun replyNotification(arguments: org.json.JSONObject): String {
        val packageName = arguments.optString("package").trim()
        val title = arguments.optString("notification_title").trim().take(100)
        val text = arguments.optString("text").trim().take(500)
        require(packageName.isNotBlank() && title.isNotBlank() && text.isNotBlank()) {
            "Notification package, exact notification title, and reply text are required."
        }
        val listener = PrismNotificationListener.instance
            ?: throw IllegalStateException("Notification access is not connected.")
        require(listener.replyToNotification(packageName, title, text)) {
            "No matching active notification has a supported reply action."
        }
        return "PrismReplyNotification sent a reply through the selected active notification."
    }

    private fun enableNotificationAccess(): String {
        context.startActivity(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        return "PrismEnableNotificationAccess opened Android notification access settings. Enable Phone Agent AI and retry."
    }
}

class PrismNotificationListener : NotificationListenerService() {
    companion object {
        @Volatile
        var instance: PrismNotificationListener? = null
            private set
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
    }

    override fun onListenerDisconnected() {
        instance = null
        super.onListenerDisconnected()
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    fun currentNotifications(): List<StatusBarNotification> =
        activeNotifications?.toList().orEmpty()

    fun replyToNotification(packageName: String, title: String, text: String): Boolean {
        val matchingNotifications = currentNotifications()
            .filter {
                it.packageName == packageName &&
                    it.notification.extras
                        .getCharSequence(Notification.EXTRA_TITLE)
                        ?.toString()
                        ?.take(100) == title
            }
        val notification = matchingNotifications.singleOrNull() ?: return false
        val actions = notification.notification.actions.orEmpty()
        for (action in actions) {
            val remoteInputs = action.remoteInputs.orEmpty()
            val replyInput = remoteInputs.firstOrNull { it.allowFreeFormInput } ?: continue
            val fillInIntent = Intent()
            val results = android.os.Bundle()
            results.putCharSequence(replyInput.resultKey, text)
            RemoteInput.addResultsToIntent(remoteInputs, fillInIntent, results)
            try {
                action.actionIntent.send(this, 0, fillInIntent)
                return true
            } catch (_: PendingIntent.CanceledException) {
                continue
            }
        }
        return false
    }
}
