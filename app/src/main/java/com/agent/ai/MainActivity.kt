package com.agent.ai

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatDelegate
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.agent.ai.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.InputStreamReader
import java.io.IOException
import java.nio.charset.StandardCharsets
import kotlin.coroutines.resume

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val PREFS_NAME = "phone_agent_model"
        private const val MODEL_PATH_KEY = "model_path"
        private const val PROJECTOR_PATH_KEY = "projector_path"
        private const val CLOUD_BASE_URL_KEY = "cloud_base_url"
        private const val DARK_THEME_KEY = "dark_theme"
        private const val MAX_TOOL_FILE_CHARACTERS = 2_000

        private var sharedLlamaBridge: LlamaBridge? = null
        private var sharedModelLoaded = false
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var screenCapture: ScreenCapture
    private var llamaBridge: LlamaBridge? = null
    private lateinit var cloudBridge: CloudBridge
    private lateinit var apiTokenStore: ApiTokenStore

    private var agentLoop: AgentLoop? = null
    private var agentExecutionJob: Job? = null
    private var isAgentRunning = false
    private var modelPath: String? = null
    private var projectorPath: String? = null
    private var pendingFilePicker: CancellableContinuation<String>? = null
    private var pendingContactsPermission: CancellableContinuation<Boolean>? = null
    private var pendingCalendarPermission: CancellableContinuation<Boolean>? = null

    private val toolFilePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        val continuation = pendingFilePicker
        pendingFilePicker = null
        if (continuation == null || !continuation.isActive) return@registerForActivityResult
        if (uri == null) {
            continuation.resume("PrismPickFile was cancelled; no file was read.")
        } else {
            lifecycleScope.launch {
                try {
                    val content = withContext(Dispatchers.IO) { readSelectedText(uri) }
                    if (continuation.isActive) continuation.resume(content)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.e(TAG, "Could not read the selected Prism file", e)
                    if (continuation.isActive) {
                        continuation.resume("PrismPickFile failed: ${e.message ?: e.javaClass.simpleName}")
                    }
                }
            }
        }
    }

    private val contactsPermissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        pendingContactsPermission?.let {
            pendingContactsPermission = null
            if (it.isActive) it.resume(granted)
        }
    }

    private val calendarPermissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        pendingCalendarPermission?.let {
            pendingCalendarPermission = null
            if (it.isActive) it.resume(results.isNotEmpty() && results.values.all { granted -> granted })
        }
    }

    private val modelPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let { importModelFile(it, isProjector = false) } }

    private val projectorPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let { importModelFile(it, isProjector = true) } }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        launchScreenCapturePermissionRequest()
    }

    // MediaProjection permission launcher
    private val mediaProjectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK && result.data != null) {
            try {
                val serviceIntent = Intent(this, ScreenCaptureForegroundService::class.java).apply {
                    action = ScreenCaptureForegroundService.ACTION_START
                    putExtra(ScreenCaptureForegroundService.EXTRA_RESULT_CODE, result.resultCode)
                    putExtra(ScreenCaptureForegroundService.EXTRA_RESULT_DATA, result.data)
                }
                ContextCompat.startForegroundService(this, serviceIntent)
                binding.tvStatus.text = "Starting screen capture..."
                appendLog("Screen-capture permission granted; starting foreground capture.")
                Handler(mainLooper).postDelayed({ updatePermissionStatus() }, 800)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start screen capture", e)
                appendLog("Screen capture failed: ${e.message ?: e.javaClass.simpleName}")
                Toast.makeText(this, "Could not start screen capture", Toast.LENGTH_LONG).show()
            }
        } else {
            appendLog("Screen capture permission denied")
            Toast.makeText(this, "Screen Capture permission is required", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val savedPreferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        AppCompatDelegate.setDefaultNightMode(
            if (savedPreferences.getBoolean(DARK_THEME_KEY, true)) {
                AppCompatDelegate.MODE_NIGHT_YES
            } else {
                AppCompatDelegate.MODE_NIGHT_NO
            },
        )
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        screenCapture = (application as PhoneAgentApplication).screenCapture
        llamaBridge = sharedLlamaBridge
        cloudBridge = CloudBridge(this)
        apiTokenStore = ApiTokenStore(this)
        val preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        modelPath = preferences.getString(MODEL_PATH_KEY, null)
        projectorPath = preferences.getString(PROJECTOR_PATH_KEY, null)
        binding.etCloudUrl.setText(preferences.getString(CLOUD_BASE_URL_KEY, ""))

        setupUI()
        updatePermissionStatus()
        updateModelStatus()
        appendLog("Choose Prism Cloud or local AI for each task. Phone actions execute on this device.")
        offerTaskRecovery()
    }

    private fun setupUI() {
        val preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        binding.switchTheme.isChecked = preferences.getBoolean(DARK_THEME_KEY, true)
        binding.switchTheme.text = if (binding.switchTheme.isChecked) "Dark mode" else "Light mode"
        binding.switchTheme.setOnCheckedChangeListener { _, darkMode ->
            preferences.edit().putBoolean(DARK_THEME_KEY, darkMode).apply()
            binding.switchTheme.text = if (darkMode) "Dark mode" else "Light mode"
            AppCompatDelegate.setDefaultNightMode(
                if (darkMode) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO,
            )
        }
        binding.rgInferenceProvider.setOnCheckedChangeListener { _, _ -> updateProviderFields() }
        binding.etCloudUrl.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: android.text.Editable?) {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                    .putString(CLOUD_BASE_URL_KEY, s?.toString()?.trim()).apply()
            }
        })
        updateProviderFields()

        // Example chips
        binding.chipExample1.setOnClickListener {
            binding.etTask.setText("Open WhatsApp")
        }
        binding.chipExample2.setOnClickListener {
            binding.etTask.setText("Open Settings")
        }
        // Start button
        binding.btnStart.setOnClickListener {
            val task = binding.etTask.text?.toString()?.trim().orEmpty()
            if (task.isEmpty()) {
                Toast.makeText(this, "Please enter a task", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (binding.radioCloud.isChecked) {
                prepareCloudTask(task)
            } else {
                startAgent(task, cloudConfig = null, remember = binding.cbRememberTask.isChecked)
            }
        }

        // Stop button
        binding.btnStop.setOnClickListener {
            stopAgent()
        }

        // Accessibility permission button
        binding.btnAccessibility.setOnClickListener {
            openAccessibilitySettings()
        }

        // Screen Capture permission button
        binding.btnScreenCapture.setOnClickListener {
            if (screenCapture.isRunning()) {
                stopScreenCapture()
            } else {
                requestScreenCapturePermission()
            }
        }

        binding.btnChooseModel.setOnClickListener {
            modelPicker.launch(arrayOf("*/*"))
        }
        binding.btnChooseProjector.setOnClickListener {
            projectorPicker.launch(arrayOf("*/*"))
        }
        binding.btnLoadModel.setOnClickListener {
            loadLocalModel()
        }
    }

    private fun updateProviderFields() {
        binding.layoutCloudSettings.visibility = if (binding.radioCloud.isChecked) {
            android.view.View.VISIBLE
        } else {
            android.view.View.GONE
        }
    }

    private fun localInferenceBridge(): LlamaBridge {
        llamaBridge?.let { return it }
        val bridge = sharedLlamaBridge ?: LlamaBridge().also { sharedLlamaBridge = it }
        llamaBridge = bridge
        return bridge
    }

    private data class CloudConfig(val baseUrl: String, val token: String, val remember: Boolean)

    private fun prepareCloudTask(task: String) {
        val baseUrl = binding.etCloudUrl.text?.toString()?.trim()?.trimEnd('/').orEmpty()
        val enteredToken = binding.etCloudToken.text?.toString()?.trim().orEmpty()

        try {
            val parsedUrl = java.net.URI(baseUrl)
            require(
                parsedUrl.scheme.equals("https", ignoreCase = true) &&
                    !parsedUrl.host.isNullOrBlank() &&
                    parsedUrl.rawUserInfo == null &&
                    parsedUrl.rawQuery == null &&
                    parsedUrl.rawFragment == null &&
                    parsedUrl.path.isNullOrEmpty()
            ) { "Enter only your Prism dashboard HTTPS origin, such as https://prism.example.com." }
            if (enteredToken.isNotBlank()) apiTokenStore.save(enteredToken)
            val token = if (enteredToken.isNotBlank()) enteredToken else apiTokenStore.read()
            if (token.isNullOrBlank()) {
                Toast.makeText(this, "Create a Prism token in your web dashboard and paste it here", Toast.LENGTH_LONG).show()
                return
            }
            val remember = binding.cbRememberTask.isChecked
            val cloudConfig = CloudConfig(baseUrl, token, remember)
            val host = parsedUrl.host
            MaterialAlertDialogBuilder(this)
                .setTitle("Send this task to Prism Cloud?")
                .setMessage(
                    "The task prompt, screenshots, visible accessibility text, and relevant local tool " +
                        "results may be sent over HTTPS to $host and your configured model server. " +
                        "Phone actions still run through Android permissions. Continue only if this data " +
                        "sharing is intended."
                )
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Continue") { _, _ ->
                    binding.etCloudToken.setText("")
                    startAgent(task, cloudConfig, remember)
                }
                .show()
        } catch (e: Exception) {
            Log.e(TAG, "Prism cloud credentials are invalid", e)
            Toast.makeText(this, e.message ?: "Could not read the Prism API token", Toast.LENGTH_LONG).show()
        }
    }

    private fun startAgent(task: String, cloudConfig: CloudConfig?, remember: Boolean) {
        if (cloudConfig == null && !sharedModelLoaded) {
            Toast.makeText(this, "Select and load a local vision model first", Toast.LENGTH_LONG).show()
            return
        }
        if (!isAccessibilityEnabled()) {
            Toast.makeText(this, "Please enable Accessibility Service first", Toast.LENGTH_LONG).show()
            openAccessibilitySettings()
            return
        }

        if (!screenCapture.isRunning()) {
            Toast.makeText(this, "Please grant Screen Capture permission first", Toast.LENGTH_LONG).show()
            requestScreenCapturePermission()
            return
        }

        if (isAgentRunning) {
            Toast.makeText(this, "Agent is already running", Toast.LENGTH_SHORT).show()
            return
        }

        appendLog("Starting ${if (cloudConfig == null) "local" else "Prism Cloud"} agent task: $task")
        saveTaskRecovery(task, cloudConfig != null, remember)
        binding.tvStatus.text = "Running..."
        binding.btnStart.isEnabled = false
        binding.btnStop.isEnabled = true
        isAgentRunning = true

        agentExecutionJob = lifecycleScope.launch {
            val memory = if (!remember) {
                ""
            } else if (cloudConfig != null) {
                cloudBridge.loadMemory(cloudConfig.baseUrl, cloudConfig.token).orEmpty().also {
                    if (cloudBridge.lastError().isNotBlank()) appendLog(cloudBridge.lastError())
                }
            } else {
                withContext(Dispatchers.IO) {
                    PrismMemoryStore(this@MainActivity).use { it.recentContext() }
                }
            }
            val connectorToolGuide = if (cloudConfig == null) {
                ""
            } else {
                cloudBridge.loadConnectorToolGuide(cloudConfig.baseUrl, cloudConfig.token).orEmpty()
                    .also { if (cloudBridge.lastError().isNotBlank()) appendLog(cloudBridge.lastError()) }
            }

            val loop = AgentLoop(
                context = this@MainActivity,
                screenCapture = screenCapture,
                predict = { prompt, screenshot, isPlanning ->
                    if (cloudConfig == null) {
                        withContext(Dispatchers.IO) { localInferenceBridge().predict(prompt, screenshot) }
                    } else {
                        cloudBridge.predict(
                            cloudConfig.baseUrl,
                            cloudConfig.token,
                            prompt,
                            screenshot,
                            isPlanning
                        )
                    }
                },
                inferenceError = {
                    if (cloudConfig == null) localInferenceBridge().lastError() else cloudBridge.lastError()
                },
                pickUserFile = { pickUserTextFile() },
                requestContactsPermission = { requestContactsAccess() },
                requestCalendarPermission = { write -> requestCalendarAccess(write) },
                memoryContext = memory,
                connectorToolGuide = connectorToolGuide,
                executeRemoteConnectorTool = { toolName, arguments ->
                    cloudConfig?.let {
                        cloudBridge.callConnectorTool(it.baseUrl, it.token, toolName, arguments)
                    }
                },
                onLog = { message -> runOnUiThread { appendLog(message) } },
                onPlanApproval = { plan -> confirmPlan(task, plan) },
                onFinished = { success, message ->
                    lifecycleScope.launch {
                        if (!success && cloudConfig != null) {
                            cloudBridge.cancelPersistedJob(cloudConfig.baseUrl, cloudConfig.token)
                        }
                        if (success && remember) {
                            try {
                                if (cloudConfig == null) {
                                    withContext(Dispatchers.IO) {
                                        PrismMemoryStore(this@MainActivity).use {
                                            it.rememberTask(task, message)
                                        }
                                    }
                                } else {
                                    val saved = cloudBridge.saveTaskMemory(
                                        cloudConfig.baseUrl,
                                        cloudConfig.token,
                                        task,
                                        message
                                    )
                                    if (!saved) appendLog(cloudBridge.lastError())
                                    if (cloudBridge.lastError().isNotBlank()) appendLog(cloudBridge.lastError())
                                }
                            } catch (e: Exception) {
                                Log.e(TAG, "Could not save opted-in Prism memory", e)
                                appendLog("Prism memory save failed: ${e.message ?: e.javaClass.simpleName}")
                            }
                        }
                        isAgentRunning = false
                        clearTaskRecovery()
                        agentExecutionJob = null
                        agentLoop = null
                        binding.btnStart.isEnabled = true
                        binding.btnStop.isEnabled = false
                        binding.tvStatus.text = if (success) "Completed" else "Stopped / Failed"
                        appendLog(message)
                    }
                }
            )
            agentLoop = loop
            loop.start(task)
        }
    }

    private fun stopAgent() {
        appendLog("🛑 Stopping agent...")
        agentLoop?.stop()
        agentExecutionJob?.cancel()
        lifecycleScope.launch { cancelInterruptedCloudInference() }
        agentExecutionJob = null
        agentLoop = null
        clearTaskRecovery()
        isAgentRunning = false
        binding.btnStart.isEnabled = true
        binding.btnStop.isEnabled = false
        binding.tvStatus.text = "Stopped"
    }

    private fun saveTaskRecovery(task: String, cloud: Boolean, remember: Boolean) {
        try {
            TaskRecoveryStore(this).save(task.take(1000), cloud, remember)
        } catch (e: Exception) {
            Log.e(TAG, "Could not save encrypted task recovery state", e)
            appendLog("Could not save encrypted task recovery: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun clearTaskRecovery() {
        try {
            TaskRecoveryStore(this).clear()
        } catch (e: Exception) {
            Log.e(TAG, "Could not clear encrypted task recovery state", e)
            appendLog("Could not clear encrypted task recovery: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun offerTaskRecovery() {
        val recovery = try {
            TaskRecoveryStore(this).read()
        } catch (e: Exception) {
            Log.e(TAG, "Could not read encrypted task recovery state", e)
            appendLog("Could not read interrupted task: ${e.message ?: e.javaClass.simpleName}")
            clearTaskRecovery()
            return
        } ?: return
        val task = recovery.task
        val cloud = recovery.cloud
        val remember = recovery.remember
        MaterialAlertDialogBuilder(this)
            .setTitle("Resume interrupted Prism task?")
            .setMessage(
                "The previous task prompt was stored encrypted on this device. The task stopped before " +
                    "completion. Prism will capture the current screen, " +
                    "create a fresh plan, and ask you to approve it again. It will not replay the " +
                    "previous pending phone action."
            )
            .setNegativeButton("Discard task") { _, _ ->
                lifecycleScope.launch { cancelInterruptedCloudInference() }
                clearTaskRecovery()
            }
            .setNeutralButton("Later", null)
            .setPositiveButton("Review and resume") { _, _ ->
                binding.etTask.setText(task)
                binding.cbRememberTask.isChecked = remember
                if (cloud) {
                    binding.radioCloud.isChecked = true
                    lifecycleScope.launch {
                        cancelInterruptedCloudInference()
                        prepareCloudTask(task)
                    }
                } else {
                    binding.radioLocal.isChecked = true
                    startAgent(task, cloudConfig = null, remember = remember)
                }
            }
            .show()
    }

    private suspend fun cancelInterruptedCloudInference() {
        val baseUrl = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(CLOUD_BASE_URL_KEY, "")
            .orEmpty()
        if (baseUrl.isBlank()) return
        try {
            val token = apiTokenStore.read() ?: return
            cloudBridge.cancelPersistedJob(baseUrl, token)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Could not cancel interrupted cloud inference", e)
            appendLog("Could not cancel the previous cloud inference: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    private fun requestScreenCapturePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                this,
                android.Manifest.permission.POST_NOTIFICATIONS
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        launchScreenCapturePermissionRequest()
    }

    private fun launchScreenCapturePermissionRequest() {
        val intent = screenCapture.createScreenCaptureIntent()
        mediaProjectionLauncher.launch(intent)
    }

    private fun stopScreenCapture() {
        stopService(Intent(this, ScreenCaptureForegroundService::class.java))
        binding.tvStatus.text = "Stopping screen capture..."
        Handler(mainLooper).postDelayed({ updatePermissionStatus() }, 300)
    }

    private fun importModelFile(uri: Uri, isProjector: Boolean) {
        if (isAgentRunning) {
            Toast.makeText(this, "Stop the agent before changing its model", Toast.LENGTH_LONG).show()
            return
        }
        binding.tvModelStatus.text = if (isProjector) "Importing vision projector..." else "Importing model..."
        binding.btnLoadModel.isEnabled = false
        lifecycleScope.launch {
            try {
                val destination = withContext(Dispatchers.IO) {
                    copyGgufToPrivateStorage(uri, if (isProjector) "vision-projector.gguf" else "vision-model.gguf")
                }
                if (isProjector) {
                    projectorPath = destination.absolutePath
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                        .putString(PROJECTOR_PATH_KEY, projectorPath).apply()
                } else {
                    modelPath = destination.absolutePath
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                        .putString(MODEL_PATH_KEY, modelPath).apply()
                }
                if (sharedModelLoaded) {
                    withContext(Dispatchers.IO) { localInferenceBridge().unloadModel() }
                }
                sharedModelLoaded = false
                appendLog("${if (isProjector) "Vision projector" else "Model"} imported locally.")
                updateModelStatus()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to import GGUF file", e)
                binding.tvModelStatus.text = "Import failed: ${e.message ?: e.javaClass.simpleName}"
                Toast.makeText(this@MainActivity, "Could not import GGUF file", Toast.LENGTH_LONG).show()
            } finally {
                binding.btnLoadModel.isEnabled = true
            }
        }
    }

    private fun copyGgufToPrivateStorage(uri: Uri, fileName: String): File {
        val directory = File(filesDir, "models")
        if (!directory.exists() && !directory.mkdirs()) {
            throw IOException("Could not create private model storage.")
        }
        val destination = File(directory, fileName)
        val temporary = File(directory, "$fileName.partial")
        val input = contentResolver.openInputStream(uri)
            ?: throw IOException("The selected file could not be opened.")
        input.use { source ->
            temporary.outputStream().buffered().use { output -> source.copyTo(output) }
        }
        if (temporary.length() < 4) {
            temporary.delete()
            throw IOException("The selected file is empty or incomplete.")
        }
        val magic = ByteArray(4)
        FileInputStream(temporary).use { stream ->
            if (stream.read(magic) != magic.size || !magic.contentEquals(byteArrayOf(0x47, 0x47, 0x55, 0x46))) {
                temporary.delete()
                throw IOException("Select a GGUF model or multimodal projector file.")
            }
        }
        if (destination.exists() && !destination.delete()) {
            temporary.delete()
            throw IOException("Could not replace the previously imported file.")
        }
        if (!temporary.renameTo(destination)) {
            temporary.delete()
            throw IOException("Could not finish saving the model.")
        }
        return destination
    }

    private fun loadLocalModel() {
        if (isAgentRunning) {
            Toast.makeText(this, "Stop the agent before loading another model", Toast.LENGTH_LONG).show()
            return
        }
        val selectedModel = modelPath
        val selectedProjector = projectorPath
        if (selectedModel == null || selectedProjector == null) {
            Toast.makeText(this, "Choose both GGUF model files first", Toast.LENGTH_LONG).show()
            return
        }
        if (!File(selectedModel).isFile || !File(selectedProjector).isFile) {
            Toast.makeText(this, "An imported model file is missing; select it again", Toast.LENGTH_LONG).show()
            return
        }

        binding.btnLoadModel.isEnabled = false
        binding.tvModelStatus.text = "Loading on-device model; first load can take a while..."
        lifecycleScope.launch {
            try {
                val loaded = withContext(Dispatchers.IO) {
                    localInferenceBridge().loadModel(
                        selectedModel,
                        selectedProjector,
                        (Runtime.getRuntime().availableProcessors() / 2).coerceIn(1, 8)
                    )
                }
                sharedModelLoaded = loaded
                if (loaded) {
                    appendLog("Local vision model loaded. Inference is offline.")
                } else {
                    val message = localInferenceBridge().lastError()
                    appendLog("Model load failed: $message")
                    Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                sharedModelLoaded = false
                Log.e(TAG, "Local model load failed", e)
                val message = "Model load failed: ${e.message ?: e.javaClass.simpleName}"
                appendLog(message)
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
            } catch (e: LinkageError) {
                sharedModelLoaded = false
                Log.e(TAG, "Native inference library is unavailable", e)
                val message = "Native inference library unavailable: ${e.message ?: e.javaClass.simpleName}"
                appendLog(message)
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
            } finally {
                binding.btnLoadModel.isEnabled = true
                updateModelStatus()
                updatePermissionStatus()
            }
        }
    }

    private suspend fun confirmPlan(task: String, plan: List<String>): Boolean =
        suspendCancellableCoroutine { continuation ->
            runOnUiThread {
                if (!continuation.isActive || isFinishing || isDestroyed) {
                    if (continuation.isActive) continuation.resume(false)
                    return@runOnUiThread
                }

                val dialog = MaterialAlertDialogBuilder(this)
                    .setTitle("Review and approve this task plan")
                    .setMessage(
                        "Task: ${task.take(300)}\n\n" +
                            plan.mapIndexed { i, step -> "${i + 1}. $step" }.joinToString("\n") +
                            "\n\nApproval allows the agent to execute follow-up phone and Prism tool " +
                            "actions for this task. Review the screen; the local model may be wrong."
                    )
                    .setNegativeButton("Stop") { _, _ ->
                        if (continuation.isActive) continuation.resume(false)
                    }
                    .setPositiveButton("Approve task") { _, _ ->
                        if (continuation.isActive) continuation.resume(true)
                    }
                    .setOnCancelListener {
                        if (continuation.isActive) continuation.resume(false)
                    }
                    .create()
                dialog.show()
                continuation.invokeOnCancellation {
                    runOnUiThread { dialog.dismiss() }
                }
            }
        }

    private suspend fun pickUserTextFile(): String =
        suspendCancellableCoroutine { continuation ->
            if (pendingFilePicker != null) {
                continuation.resume("PrismPickFile is already active.")
                return@suspendCancellableCoroutine
            }
            pendingFilePicker = continuation
            continuation.invokeOnCancellation {
                if (pendingFilePicker === continuation) pendingFilePicker = null
            }
            runOnUiThread {
                try {
                    toolFilePicker.launch(arrayOf("text/*", "application/json"))
                } catch (e: Exception) {
                    pendingFilePicker = null
                    if (continuation.isActive) {
                        continuation.resume("PrismPickFile failed: ${e.message ?: e.javaClass.simpleName}")
                    }
                }
            }
        }

    private suspend fun requestContactsAccess(): Boolean {
        if (ContextCompat.checkSelfPermission(
                this,
                android.Manifest.permission.READ_CONTACTS
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return true
        return suspendCancellableCoroutine { continuation ->
            if (pendingContactsPermission != null || isFinishing || isDestroyed) {
                continuation.resume(false)
                return@suspendCancellableCoroutine
            }
            pendingContactsPermission = continuation
            continuation.invokeOnCancellation {
                if (pendingContactsPermission === continuation) pendingContactsPermission = null
            }
            runOnUiThread {
                try {
                    contactsPermissionRequest.launch(android.Manifest.permission.READ_CONTACTS)
                } catch (e: Exception) {
                    pendingContactsPermission = null
                    Log.e(TAG, "Could not request Contacts permission", e)
                    if (continuation.isActive) continuation.resume(false)
                }
            }
        }
    }

    private suspend fun requestCalendarAccess(write: Boolean): Boolean {
        val permissions = if (write) {
            arrayOf(
                android.Manifest.permission.READ_CALENDAR,
                android.Manifest.permission.WRITE_CALENDAR
            )
        } else {
            arrayOf(android.Manifest.permission.READ_CALENDAR)
        }
        if (permissions.all {
                ContextCompat.checkSelfPermission(this, it) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
            }
        ) return true

        return suspendCancellableCoroutine { continuation ->
            if (pendingCalendarPermission != null || isFinishing || isDestroyed) {
                continuation.resume(false)
                return@suspendCancellableCoroutine
            }
            pendingCalendarPermission = continuation
            continuation.invokeOnCancellation {
                if (pendingCalendarPermission === continuation) pendingCalendarPermission = null
            }
            runOnUiThread {
                try {
                    calendarPermissionRequest.launch(permissions)
                } catch (e: Exception) {
                    pendingCalendarPermission = null
                    Log.e(TAG, "Could not request Calendar permission", e)
                    if (continuation.isActive) continuation.resume(false)
                }
            }
        }
    }

    private fun readSelectedText(uri: Uri): String {
        val input = contentResolver.openInputStream(uri)
            ?: throw IOException("The selected document could not be opened.")
        val content = StringBuilder()
        InputStreamReader(input, StandardCharsets.UTF_8).buffered().use { reader ->
            val buffer = CharArray(2048)
            while (content.length < MAX_TOOL_FILE_CHARACTERS) {
                val count = reader.read(
                    buffer,
                    0,
                    minOf(buffer.size, MAX_TOOL_FILE_CHARACTERS - content.length)
                )
                if (count < 0) break
                content.append(buffer, 0, count)
            }
        }
        return "PrismPickFile selected text (locally; at most $MAX_TOOL_FILE_CHARACTERS characters):\n$content"
    }

    private fun updateModelStatus() {
        val modelReady = !modelPath.isNullOrBlank() && File(modelPath!!).isFile
        val projectorReady = !projectorPath.isNullOrBlank() && File(projectorPath!!).isFile
        binding.tvModelStatus.text = when {
            sharedModelLoaded -> "On-device vision model loaded • offline"
            modelReady && projectorReady -> "Both GGUF files imported • ready to load"
            modelReady -> "Model imported • select its matching vision projector"
            projectorReady -> "Vision projector imported • select its matching model"
            else -> "No local model selected"
        }
    }

    private fun openAccessibilitySettings() {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            startActivity(intent)
            Toast.makeText(this, "Please enable Phone Agent AI in Accessibility settings", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open accessibility settings", e)
            Toast.makeText(this, "Could not open Accessibility settings", Toast.LENGTH_SHORT).show()
        }
    }

    private fun isAccessibilityEnabled(): Boolean {
        val am = getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        val enabledServices = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_GENERIC)
        return enabledServices.any { it.resolveInfo.serviceInfo.packageName == packageName }
    }

    private fun updatePermissionStatus() {
        val accessibilityOk = isAccessibilityEnabled()
        val screenCaptureOk = screenCapture.isRunning()
        binding.btnScreenCapture.text = if (screenCaptureOk) {
            "Stop Screen Capture"
        } else {
            "Grant Screen Capture Permission"
        }

        val accText = if (accessibilityOk) "✅" else "❌"
        val scText = if (screenCaptureOk) "✅" else "❌"

        binding.tvPermissionStatus.text = "Accessibility: $accText   Screen Capture: $scText"
        binding.tvPermissionStatus.setTextColor(
            if (accessibilityOk && screenCaptureOk)
                0xFF00FF88.toInt()
            else
                0xFFFF6B6B.toInt()
        )

        if (accessibilityOk && screenCaptureOk && sharedModelLoaded) {
            binding.tvStatus.text = "Ready"
        } else if (accessibilityOk && screenCaptureOk && binding.radioCloud.isChecked) {
            binding.tvStatus.text = "Prism Cloud selected"
        } else if (accessibilityOk && screenCaptureOk) {
            binding.tvStatus.text = "Load local model"
        } else {
            binding.tvStatus.text = "Permissions required"
        }
    }

    private fun appendLog(message: String) {
        val current = binding.tvLog.text.toString()
        binding.tvLog.text = (current + message + "\n").takeLast(6000)

        // Auto scroll to bottom
        binding.cardLog.post {
            val scrollView = binding.cardLog.getChildAt(0) as? android.widget.ScrollView
            scrollView?.fullScroll(android.view.View.FOCUS_DOWN)
        }
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatus()
    }

    override fun onDestroy() {
        super.onDestroy()
        pendingFilePicker?.cancel()
        pendingContactsPermission?.cancel()
        pendingCalendarPermission?.cancel()
        agentLoop?.stop()
        agentExecutionJob?.cancel()
        if (isFinishing) {
            stopService(Intent(this, ScreenCaptureForegroundService::class.java))
        }
    }
}