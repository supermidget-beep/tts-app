package com.supermidget.wuxiareader

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

// Handles Android's native "Share" sheet (registered via the ACTION_SEND
// intent-filter in AndroidManifest.xml). A cold start (app not already
// running) stashes the shared text in pendingSharedText for
// ShareReceiverPlugin.consumePending() to pick up once the web app has
// booted and asks for it; a share while the app is already open (caught
// by onNewIntent, since the activity is launchMode="singleTask") is
// pushed live via a window event instead, since there's no boot-time race
// to worry about in that case.
class MainActivity : BridgeActivity() {
    companion object {
        @Volatile
        var pendingSharedText: String? = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ChapterExtractorPlugin::class.java)
        registerPlugin(ShareReceiverPlugin::class.java)
        super.onCreate(savedInstanceState)
        handleIntent(intent, live = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent, live = true)
    }

    private fun handleIntent(intent: Intent?, live: Boolean) {
        if (intent == null || intent.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.getStringExtra(Intent.EXTRA_SUBJECT)
        if (text.isNullOrBlank()) return
        if (live) {
            ShareReceiverPlugin.dispatchLive(bridge, text)
        } else {
            pendingSharedText = text
        }
    }
}
