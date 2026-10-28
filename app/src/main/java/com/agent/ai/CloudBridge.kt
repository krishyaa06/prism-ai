package com.agent.ai

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID

/**
 * Calls the authenticated Prism gateway and polls its durable model-task queue.
 */
class CloudBridge(context: Context) {
    companion object {
        private const val MAX_RESPONSE_CHARACTERS = 64_000
        private const val MAX_POLL_ATTEMPTS = 150
        private const val POLL_INTERVAL_MS = 2_000L
        private const val JOB_PREFS = "prism_async_jobs"
        private const val ACTIVE_JOB_ID = "active_job_id"
        private const val ACTIVE_REQUEST_ID = "active_request_id"
    }

    private val jobPreferences = context.getSharedPreferences(JOB_PREFS, Context.MODE_PRIVATE)

    @Volatile
    private var error = "No cloud request has been made."

    fun lastError(): String = error

    suspend fun loadMemory(apiBaseUrl: String, token: String): String? =
        withContext(Dispatchers.IO) {
            val response = request(apiBaseUrl, token, "/api/v1/memory", "GET")
                ?: return@withContext null
            val memories = response.optJSONArray("memories")
            if (memories == null) {
                error = "Prism memory response was invalid."
                return@withContext null
            }
            buildList {
                for (index in 0 until memories.length()) {
                    val content = memories.optJSONObject(index)?.optString("content").orEmpty()
                    if (content.isNotBlank()) add(content.take(1000))
                }
            }.takeLast(10).joinToString("\n")
        }

    suspend fun saveTaskMemory(
        apiBaseUrl: String,
        token: String,
        task: String,
        outcome: String
    ): Boolean = withContext(Dispatchers.IO) {
        val content = "Task: ${task.take(500)}\nOutcome: ${outcome.take(400)}".take(1000)
        request(
            apiBaseUrl,
            token,
            "/api/v1/memory",
            "POST",
            JSONObject()
                .put("consent", true)
                .put("category", "workflow")
                .put("content", content)
        ) != null
    }

    suspend fun loadConnectorToolGuide(apiBaseUrl: String, token: String): String? =
        withContext(Dispatchers.IO) {
            val response = request(apiBaseUrl, token, "/api/v1/connectors/tools", "GET")
                ?: return@withContext null
            val tools = response.optJSONArray("tools")
                ?: return@withContext run {
                    error = "Prism connector response was invalid."
                    null
                }
            buildList {
                for (index in 0 until tools.length()) {
                    val tool = tools.optJSONObject(index) ?: continue
                    add(
                        "${tool.optString("name")}: ${tool.optString("description")} " +
                            "Input schema: ${tool.optJSONObject("inputSchema")?.toString()?.take(1200).orEmpty()}"
                    )
                }
            }.take(400).joinToString("\n")
        }

    suspend fun callConnectorTool(
        apiBaseUrl: String,
        token: String,
        qualifiedToolName: String,
        arguments: JSONObject
    ): String? = withContext(Dispatchers.IO) {
        val parts = qualifiedToolName.split('.', limit = 3)
        if (parts.size != 3 || parts[0] != "PrismMcp" ||
            !parts[1].matches(Regex("[a-z0-9][a-z0-9_-]{1,79}")) ||
            !parts[2].matches(Regex("[A-Za-z0-9_-]{2,200}"))
        ) {
            error = "Invalid Prism MCP tool identifier."
            return@withContext null
        }
        val body = JSONObject().put("arguments", arguments)
        val response = request(
            apiBaseUrl,
            token,
            "/api/v1/connectors/${parts[1]}/tools/${parts[2]}",
            "POST",
            body
        ) ?: return@withContext null
        response.optString("result").takeIf(String::isNotBlank).also {
            if (it == null) error = "MCP server returned no tool result."
        }
    }

    suspend fun predict(
        apiBaseUrl: String,
        token: String,
        prompt: String,
        screenshotJpeg: ByteArray,
        isPlanning: Boolean
    ): String? = withContext(Dispatchers.IO) {
        if (!isValidToken(token)) {
            error = "Enter a Prism API token from the web dashboard."
            return@withContext null
        }
        var taskId: String? = null
        try {
            cancelPersistedJob(apiBaseUrl, token)
            if (jobPreferences.contains(ACTIVE_JOB_ID) || jobPreferences.contains(ACTIVE_REQUEST_ID)) {
                if (error.isBlank()) error = "Could not cancel the previous pending cloud inference."
                return@withContext null
            }
            val requestId = UUID.randomUUID().toString()
            if (!jobPreferences.edit().putString(ACTIVE_REQUEST_ID, requestId).commit()) {
                error = "Could not save cloud task recovery state; no request was submitted."
                return@withContext null
            }
            val body = JSONObject()
                .put("prompt", prompt)
                .put("is_planning", isPlanning)
                .put("screenshot_jpeg_base64", Base64.encodeToString(screenshotJpeg, Base64.NO_WRAP))
            val queued = request(
                apiBaseUrl,
                token,
                "/api/v1/tasks",
                "POST",
                body,
                mapOf("Idempotency-Key" to requestId)
            ) ?: return@withContext null
            val activeTaskId = queued.optString("task_id").takeIf(String::isNotBlank)
            if (activeTaskId == null) {
                error = "Prism task queue returned no task id."
                return@withContext null
            }
            taskId = activeTaskId
            val savedTaskId = jobPreferences.edit()
                .putString(ACTIVE_JOB_ID, activeTaskId)
                .remove(ACTIVE_REQUEST_ID)
                .commit()
            if (!savedTaskId) {
                jobPreferences.edit().putString(ACTIVE_REQUEST_ID, requestId).commit()
            }

            repeat(MAX_POLL_ATTEMPTS) {
                delay(POLL_INTERVAL_MS)
                val result = request(apiBaseUrl, token, "/api/v1/tasks/$activeTaskId", "GET")
                    ?: return@withContext null
                val task = result.optJSONObject("task")
                when (task?.optString("status")) {
                    "completed" -> {
                        val prediction = task.optString("result").takeIf(String::isNotBlank)
                        clearPersistedJob(activeTaskId)
                        if (prediction == null) {
                            error = "Prism worker completed without a model result."
                            return@withContext null
                        }
                        error = ""
                        return@withContext prediction
                    }
                    "failed", "canceled" -> {
                        clearPersistedJob(activeTaskId)
                        error = task.optString("error").ifBlank { "Prism task ${task.optString("status")}." }
                        return@withContext null
                    }
                }
            }
            cancelTaskById(apiBaseUrl, token, activeTaskId)
            error = "Prism inference timed out after five minutes; cancellation was requested."
            null
        } catch (cancelled: CancellationException) {
            val activeTaskId = taskId
            val activeRequestId = jobPreferences.getString(ACTIVE_REQUEST_ID, null)
            if (activeTaskId != null) {
                withContext(NonCancellable) {
                    cancelTaskById(apiBaseUrl, token, activeTaskId)
                }
            } else if (activeRequestId != null) {
                withContext(NonCancellable) {
                    cancelTaskByRequestId(apiBaseUrl, token, activeRequestId)
                }
            }
            throw cancelled
        }
    }

    suspend fun cancelPersistedJob(apiBaseUrl: String, token: String): Unit = withContext(Dispatchers.IO) {
        val taskId = jobPreferences.getString(ACTIVE_JOB_ID, null)
        if (taskId != null) {
            cancelTaskById(apiBaseUrl, token, taskId)
            if (jobPreferences.getString(ACTIVE_JOB_ID, null) == null) return@withContext
        }
        val requestId = jobPreferences.getString(ACTIVE_REQUEST_ID, null) ?: return@withContext
        cancelTaskByRequestId(apiBaseUrl, token, requestId)
    }

    private suspend fun cancelTaskById(apiBaseUrl: String, token: String, taskId: String) {
        val response = request(apiBaseUrl, token, "/api/v1/tasks/$taskId", "DELETE")
        if (response != null || error.contains("terminal", true) || error.contains("not found", true)) {
            clearPersistedJob(taskId)
        }
    }

    private suspend fun cancelTaskByRequestId(apiBaseUrl: String, token: String, requestId: String) {
        val response = request(
            apiBaseUrl,
            token,
            "/api/v1/tasks",
            "DELETE",
            query = "request_id=$requestId"
        )
        if (response != null || error.contains("not found", true)) clearPersistedRequest(requestId)
    }

    private fun clearPersistedJob(taskId: String) {
        if (jobPreferences.getString(ACTIVE_JOB_ID, null) == taskId) {
            jobPreferences.edit().remove(ACTIVE_JOB_ID).remove(ACTIVE_REQUEST_ID).apply()
        }
    }

    private fun clearPersistedRequest(requestId: String) {
        if (jobPreferences.getString(ACTIVE_REQUEST_ID, null) == requestId) {
            jobPreferences.edit().remove(ACTIVE_REQUEST_ID).apply()
        }
    }

    private suspend fun request(
        apiBaseUrl: String,
        token: String,
        path: String,
        method: String,
        body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(),
        query: String? = null
    ): JSONObject? {
        val origin = try {
            URI(apiBaseUrl.trim().trimEnd('/'))
        } catch (_: Exception) {
            error = "Prism API URL is invalid."
            return null
        }
        if (!origin.scheme.equals("https", true) ||
            origin.host.isNullOrBlank() ||
            origin.rawUserInfo != null ||
            origin.rawQuery != null ||
            origin.rawFragment != null ||
            origin.path.isNotEmpty()
        ) {
            error = "Use only your Prism dashboard HTTPS origin, such as https://prism.example.com."
            return null
        }
        if (!isValidToken(token)) {
            error = "Enter a Prism API token from the web dashboard."
            return null
        }

        var connection: HttpURLConnection? = null
        try {
            val endpoint = URI(
                origin.scheme,
                null,
                origin.host,
                origin.port,
                path,
                query,
                null
            ).toURL()
            connection = (endpoint.openConnection() as HttpURLConnection).apply {
                requestMethod = method
                instanceFollowRedirects = false
                connectTimeout = 10_000
                readTimeout = 20_000
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Accept", "application/json")
                headers.forEach { (name, value) -> setRequestProperty(name, value) }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }
            if (body != null) {
                connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body.toString()) }
            }
            val responseCode = connection.responseCode
            val stream = if (responseCode in 200..299) connection.inputStream else connection.errorStream
            val response = runCatching { JSONObject(readLimited(stream)) }.getOrNull()
            if (responseCode !in 200..299) {
                error = response?.optString("error")?.takeIf(String::isNotBlank)
                    ?: "Prism API request failed (HTTP $responseCode)."
                return null
            }
            error = ""
            return response
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = "Prism API request failed: ${e.message ?: e.javaClass.simpleName}"
            return null
        } finally {
            connection?.disconnect()
        }
    }

    private fun isValidToken(token: String): Boolean =
        token.startsWith("prism_live_") && token.length >= 40

    private fun readLimited(stream: InputStream?): String {
        if (stream == null) return ""
        return stream.bufferedReader(Charsets.UTF_8).use { reader ->
            val content = StringBuilder()
            val buffer = CharArray(2048)
            while (content.length < MAX_RESPONSE_CHARACTERS) {
                val count = reader.read(
                    buffer,
                    0,
                    minOf(buffer.size, MAX_RESPONSE_CHARACTERS - content.length)
                )
                if (count < 0) break
                content.append(buffer, 0, count)
            }
            content.toString()
        }
    }
}
