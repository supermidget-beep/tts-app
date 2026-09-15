package com.supermidget.wuxiareader

import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

@CapacitorPlugin(name = "ShareReceiver")
class ShareReceiverPlugin : Plugin() {
    // Called once by the web app on startup to ask "was I opened via a
    // share?" -- a pull, not a push, so there's no race with the JS
    // event-listener setup completing.
    @PluginMethod
    fun consumePending(call: PluginCall) {
        val text = MainActivity.pendingSharedText
        MainActivity.pendingSharedText = null
        val result = JSObject()
        result.put("text", text)
        call.resolve(result)
    }

    companion object {
        fun dispatchLive(bridge: Bridge?, text: String) {
            val webView = bridge?.webView ?: return
            val js = "window.dispatchEvent(new CustomEvent('wuxiaShare', { detail: ${JSONObject.quote(text)} }));"
            webView.post { webView.evaluateJavascript(js, null) }
        }
    }
}
