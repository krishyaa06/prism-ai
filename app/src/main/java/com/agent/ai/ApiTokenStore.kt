package com.agent.ai

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts the user's Prism API token with a non-exportable Android Keystore key.
 */
class ApiTokenStore(context: Context) {
    companion object {
        private const val PREFS_NAME = "prism_cloud_credentials"
        private const val TOKEN_CIPHER_KEY = "api_token_cipher"
        private const val TOKEN_IV_KEY = "api_token_iv"
        private const val KEY_ALIAS = "prism_api_token_key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }

    private val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun save(token: String) {
        require(token.startsWith("prism_live_") && token.length >= 40) {
            "Enter a valid Prism API token created in the web dashboard."
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(TOKEN_CIPHER_KEY, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(TOKEN_IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    fun read(): String? {
        val encoded = preferences.getString(TOKEN_CIPHER_KEY, null) ?: return null
        val iv = preferences.getString(TOKEN_IV_KEY, null)
            ?: throw IllegalStateException("Saved Prism token data is incomplete; enter the token again.")
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))
            )
            String(cipher.doFinal(Base64.decode(encoded, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (e: Exception) {
            throw IllegalStateException("Could not decrypt saved Prism token; enter it again.", e)
        }
    }

    fun clear() {
        preferences.edit().remove(TOKEN_CIPHER_KEY).remove(TOKEN_IV_KEY).apply()
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
