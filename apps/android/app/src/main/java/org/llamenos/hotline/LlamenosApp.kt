package org.llamenos.hotline

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class LlamenosApp : Application() {

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: LlamenosApp
            private set
    }
}
