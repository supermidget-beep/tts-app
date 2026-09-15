package com.supermidget.wuxiareader

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// A real chapter link is loaded in a hidden WebView -- a genuine browser
// engine that executes JavaScript, so it solves Cloudflare-style "Just a
// moment..." challenges the same way the user's own Chrome does -- and
// Readability.js + our link-detection heuristics (bundled as assets) are
// injected into the *loaded page's own* JS context to pull out the
// chapter text, next/prev links, and a table-of-contents link. This is
// what lets sites that block a plain server-side fetch keep working: the
// request still comes from a real, JS-capable browser on the user's own
// device, not a datacenter IP with no JS engine behind it.
private const val STABLE_DELAY_MS = 1500L
private const val OVERALL_TIMEOUT_MS = 25000L
// The stock WebView UA on some Android/WebView versions includes a ";wv"
// marker that flags it as an embedded WebView rather than the Chrome app
// -- a known, trivially-checked anti-bot signal. Override with an
// otherwise-equivalent mobile Chrome UA that doesn't carry that marker.
private const val MOBILE_CHROME_UA =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"

@CapacitorPlugin(name = "ChapterExtractor")
class ChapterExtractorPlugin : Plugin() {

    private var readabilityJsCache: String? = null
    private var extractJsCache: String? = null

    @PluginMethod
    fun extractChapter(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("Missing 'url'")
            return
        }
        runExtraction(url, "window.__wuxiaExtractChapter()", call)
    }

    @PluginMethod
    fun extractToc(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("Missing 'url'")
            return
        }
        runExtraction(url, "window.__wuxiaExtractToc()", call)
    }

    private fun loadAsset(name: String): String =
        context.assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() }

    @SuppressLint("SetJavaScriptEnabled")
    private fun runExtraction(url: String, entryPointExpr: String, call: PluginCall) {
        val readabilityJs = readabilityJsCache ?: loadAsset("readability.js").also { readabilityJsCache = it }
        val extractJs = extractJsCache ?: loadAsset("extract.js").also { extractJsCache = it }
        // One single evaluateJavascript call: readability.js and
        // extract.js's top-level `const`/class declarations are then
        // guaranteed to share a lexical scope with the final expression
        // that invokes them, and that final expression's value becomes
        // the JSON this call resolves with.
        val script = "$readabilityJs\n;$extractJs\n;($entryPointExpr);"

        val mainHandler = Handler(Looper.getMainLooper())
        mainHandler.post {
            val hostActivity = activity
            if (hostActivity == null) {
                call.reject("No activity available")
                return@post
            }

            val webView = WebView(hostActivity)
            val rootView = hostActivity.findViewById<ViewGroup>(android.R.id.content)
            webView.layoutParams = ViewGroup.LayoutParams(1, 1)
            webView.visibility = View.GONE
            rootView?.addView(webView)

            var finished = false
            fun cleanup() {
                mainHandler.post {
                    rootView?.removeView(webView)
                    webView.destroy()
                }
            }

            val stableRunnable = Runnable {
                if (finished) return@Runnable
                finished = true
                webView.evaluateJavascript(script) { rawResult ->
                    mainHandler.post {
                        cleanup()
                        if (rawResult == null || rawResult == "null") {
                            call.reject("Extraction returned no data")
                            return@post
                        }
                        try {
                            call.resolve(JSObject(rawResult))
                        } catch (e: Exception) {
                            call.reject("Failed to parse extraction result: ${e.message}")
                        }
                    }
                }
            }
            val timeoutRunnable = Runnable {
                if (finished) return@Runnable
                finished = true
                cleanup()
                call.reject("Timed out loading the page")
            }

            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
            webView.settings.userAgentString = MOBILE_CHROME_UA
            webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

            webView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, loadedUrl: String?) {
                    super.onPageFinished(view, loadedUrl)
                    // Cloudflare-style interstitials load once, solve
                    // their challenge, then redirect to the real page --
                    // this can fire more than once per navigation, so
                    // only extract once things have been quiet for a bit.
                    mainHandler.removeCallbacks(stableRunnable)
                    mainHandler.postDelayed(stableRunnable, STABLE_DELAY_MS)
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?,
                ) {
                    super.onReceivedError(view, request, error)
                    if (finished || request?.isForMainFrame != true) return
                    finished = true
                    mainHandler.removeCallbacks(stableRunnable)
                    mainHandler.removeCallbacks(timeoutRunnable)
                    cleanup()
                    call.reject("Failed to load the page: ${error?.description ?: "unknown error"}")
                }
            }

            mainHandler.postDelayed(timeoutRunnable, OVERALL_TIMEOUT_MS)
            webView.loadUrl(url)
        }
    }
}
