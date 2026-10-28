package com.agent.ai

/**
 * JNI boundary for llama.cpp's local text and vision inference.
 */
class LlamaBridge {
    companion object {
        init {
            System.loadLibrary("phoneagent")
        }
    }

    external fun loadModel(modelPath: String, projectorPath: String, threads: Int): Boolean

    external fun predict(prompt: String, screenshotJpeg: ByteArray): String?

    external fun lastError(): String

    external fun unloadModel()
}
