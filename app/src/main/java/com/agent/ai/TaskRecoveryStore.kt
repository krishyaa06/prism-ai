package com.agent.ai

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class TaskRecoveryStore(context: Context) {
    data class Recovery(val task: String, val cloud: Boolean, val remember: Boolean)

    companion object {
        private const val PREFS_NAME = "prism_task_recovery"
        private const val PAYLOAD_KEY = "encrypted_payload"
        private const val IV_KEY = "payload_iv"
        private const val KEY_ALIAS = "prism_task_recovery_key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }

    private val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun save(task: String, cloud: Boolean, remember: Boolean) {
        require(task.isNotBlank() && task.length <= 1000) { "Task recovery text is invalid." }
        val payload = JSONObject()
            .put("task", task)
            .put("cloud", cloud)
            .put("remember", remember)
            .toString()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = Base64.encodeToString(cipher.doFinal(payload.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        check(
            preferences.edit()
                .putString(PAYLOAD_KEY, encrypted)
                .putString(IV_KEY, iv)
                .commit()
        ) { "Could not save encrypted task recovery state." }
    }

    fun read(): Recovery? {
        val encoded = preferences.getString(PAYLOAD_KEY, null) ?: return null
        val iv = preferences.getString(IV_KEY, null)
            ?: throw IllegalStateException("Saved task recovery data is incomplete.")
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))
            )
            val payload = JSONObject(String(cipher.doFinal(Base64.decode(encoded, Base64.NO_WRAP)), Charsets.UTF_8))
            val task = payload.optString("task")
            require(task.isNotBlank() && task.length <= 1000) { "Saved task recovery text is invalid." }
            Recovery(task, payload.optBoolean("cloud"), payload.optBoolean("remember"))
        } catch (e: Exception) {
            throw IllegalStateException("Could not decrypt saved task recovery data.", e)
        }
    }

    fun clear() {
        check(
            preferences.edit()
                .remove(PAYLOAD_KEY)
                .remove(IV_KEY)
                .commit()
        ) { "Could not clear encrypted task recovery data." }
    }

    private fun getOrCreateKey(): SecretKey {
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}
