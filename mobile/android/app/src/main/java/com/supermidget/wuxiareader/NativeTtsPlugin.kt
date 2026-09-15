package com.supermidget.wuxiareader

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.UUID

// A from-scratch, minimal wrapper around android.speech.tts.TextToSpeech,
// written after @capacitor-community/text-to-speech's speak() reliably
// clipped the tail of sentences no matter what was tried against it
// (QueueStrategy.Add instead of Flush, whole-paragraph chunks instead of
// sentence-sized ones, an explicit pause between chunks) -- while
// Android's own "Select to Speak" reads the exact same device/voice with
// no clipping at all, which rules out the engine/voice itself and points
// squarely at something in how something calls it.
//
// One concrete difference this plugin controls that the community one
// doesn't appear to: every single interaction with the shared
// TextToSpeech instance -- init, speak, stop, rate/pitch/voice changes --
// is explicitly dispatched onto the main thread via this Handler.
// Capacitor plugin methods run on a background thread pool by default,
// and android.speech.tts.TextToSpeech is documented to expect being
// driven consistently from one thread; calling it from Capacitor's
// worker threads (as a plugin that never explicitly posts to the main
// thread would) is a plausible source of exactly this kind of
// intermittent corruption.
@CapacitorPlugin(name = "NativeTts")
class NativeTtsPlugin : Plugin() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready = false
    private val pendingInitCalls = mutableListOf<() -> Unit>()
    private var sortedVoices: List<Voice> = emptyList()
    private val pendingUtterances = mutableMapOf<String, PluginCall>()

    override fun load() {
        mainHandler.post {
            tts = TextToSpeech(context) { status ->
                mainHandler.post {
                    ready = status == TextToSpeech.SUCCESS
                    if (ready) {
                        sortedVoices = (tts?.voices ?: emptySet()).sortedBy { it.name }
                        tts?.setOnUtteranceProgressListener(
                            object : UtteranceProgressListener() {
                                override fun onStart(utteranceId: String?) {}

                                override fun onDone(utteranceId: String?) {
                                    mainHandler.post { resolveUtterance(utteranceId, null) }
                                }

                                @Deprecated("Deprecated in Java")
                                override fun onError(utteranceId: String?) {
                                    mainHandler.post { resolveUtterance(utteranceId, "Speech error") }
                                }

                                override fun onError(utteranceId: String?, errorCode: Int) {
                                    mainHandler.post { resolveUtterance(utteranceId, "Speech error ($errorCode)") }
                                }
                            },
                        )
                    }
                    val pending = pendingInitCalls.toList()
                    pendingInitCalls.clear()
                    pending.forEach { it() }
                }
            }
        }
    }

    private fun resolveUtterance(utteranceId: String?, error: String?) {
        val id = utteranceId ?: return
        val call = pendingUtterances.remove(id) ?: return
        if (error != null) call.reject(error) else call.resolve()
    }

    private fun whenReady(action: () -> Unit) {
        mainHandler.post {
            if (ready) action() else pendingInitCalls.add(action)
        }
    }

    @PluginMethod
    fun speak(call: PluginCall) {
        val text = call.getString("text")
        if (text.isNullOrEmpty()) {
            call.reject("Missing 'text'")
            return
        }
        val rate = call.getFloat("rate", 1.0f)
        val pitch = call.getFloat("pitch", 1.0f)
        val voiceIndex = call.getInt("voice", -1)

        whenReady {
            val engine = tts
            if (engine == null) {
                call.reject("TTS engine not available")
                return@whenReady
            }
            val utteranceId = UUID.randomUUID().toString()
            pendingUtterances[utteranceId] = call

            engine.setSpeechRate(rate)
            engine.setPitch(pitch)
            if (voiceIndex in sortedVoices.indices) {
                engine.setVoice(sortedVoices[voiceIndex])
            }
            // QUEUE_FLUSH is safe here (never clips a still-playing
            // utterance): the JS side always awaits one speak() call's
            // result before starting the next, so nothing is still
            // playing/queued at the point this fires.
            val result = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
            if (result != TextToSpeech.SUCCESS) {
                pendingUtterances.remove(utteranceId)
                call.reject("Failed to start speaking")
            }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        mainHandler.post {
            tts?.stop()
            // A speak() awaiting onDone would otherwise hang forever once
            // stopped, since a manually-stopped utterance never reaches
            // onDone/onError on its own.
            val stale = pendingUtterances.toMap()
            pendingUtterances.clear()
            stale.values.forEach { it.resolve() }
            call.resolve()
        }
    }

    @PluginMethod
    fun getVoices(call: PluginCall) {
        whenReady {
            val voices = JSArray()
            sortedVoices.forEach { voice ->
                val locale = voice.locale
                val obj = JSObject()
                obj.put("voiceURI", voice.name)
                obj.put("name", "${locale.displayLanguage} ${locale.displayCountry}".trim())
                obj.put("lang", locale.toLanguageTag())
                obj.put("localService", !voice.isNetworkConnectionRequired)
                obj.put("default", false)
                voices.put(obj)
            }
            val result = JSObject()
            result.put("voices", voices)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun openInstall(call: PluginCall) {
        mainHandler.post {
            try {
                val intent = Intent().apply {
                    action = TextToSpeech.Engine.ACTION_CHECK_TTS_DATA
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                if (context.packageManager.resolveActivity(intent, 0) != null) {
                    context.startActivity(intent)
                }
                call.resolve()
            } catch (e: Exception) {
                call.reject("Failed to open voice install screen: ${e.message}")
            }
        }
    }

    override fun handleOnDestroy() {
        tts?.stop()
        tts?.shutdown()
        super.handleOnDestroy()
    }
}
