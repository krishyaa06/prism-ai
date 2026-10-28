package com.agent.ai

import android.app.Application

class PhoneAgentApplication : Application() {
    val screenCapture: ScreenCapture by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        ScreenCapture(applicationContext)
    }
}
