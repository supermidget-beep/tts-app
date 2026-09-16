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
// sentence-sized ones, an explicit JS-side pause between chunks) -- while
// Android's own "Select to Speak" reads the exact same device/voice with
// no clipping at all, which rules out the engine/voice itself.
//
// Pinning every engine interaction to the main thread (all the
// mainHandler.post calls below) didn't fix it either -- the clipping was
// identical even once every call was single-threaded, which rules out
// thread-affinity corruption as the cause too.
//
// What's left, and well documented as an Android TextToSpeech quirk:
// onUtteranceProgressListener.onDone() fires once the engine has handed
// the audio off to be rendered, not once it has actually finished coming
// out of the speaker. Our own runLoop (in tts.ts) awaits that onDone
// before calling speak() again for the next sentence, and this plugin's
// speak() uses QUEUE_FLUSH -- so the moment onDone resolves the promise
// a hair early, the next call's flush can cut off whatever tail of the
// previous sentence's audio was still draining. A plain JS-side
// setTimeout delay after onDone was already tried against the old
// plugin and made no measurable difference, which makes sense: a wall-
// clock guess has no relationship to when the engine's own audio queue
// actually empties. So instead: queue a short silent utterance directly
// behind the real one via QUEUE_ADD (see speak() below), and resolve the
// promise on *that* utterance's onDone -- the engine itself guarantees
// the silence can't start rendering until the real speech is actually
// done, which a timer never could.
@CapacitorPlugin(name = "NativeTts")
class NativeTtsPlugin : Plugin() {
    companion object {
        private const val SILENCE_SUFFIX = "-silence"
        private const val TRAILING_SILENCE_MS = 150L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready = false
    private val pendingInitCalls = mutableListOf<() -> Unit>()
    private var sortedVoices: List<Voice> = emptyList()

    // Keyed by the *content* utterance's id only (never the paired
    // "$id-silence" id) -- see the SILENCE_SUFFIX comment on speak().
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
        if (error == null && !id.endsWith(SILENCE_SUFFIX)) {
            // The *content* utterance finished handing its audio off to be
            // rendered -- not yet a reliable "done" signal (see the class
            // comment). Wait for the silent utterance queued right behind
            // it instead; this call stays pending in the map.
            return
        }
        val baseId = id.removeSuffix(SILENCE_SUFFIX)
        val call = pendingUtterances.remove(baseId) ?: return
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
        // PluginCall.getFloat/getInt return the boxed Java types (Float,
        // Integer) with no non-null annotation, so Kotlin sees them as
        // nullable even with a default supplied -- the "?:" here is just
        // satisfying that static type, since the Java side never actually
        // returns null once a default is given.
        val rate = call.getFloat("rate", 1.0f) ?: 1.0f
        val pitch = call.getFloat("pitch", 1.0f) ?: 1.0f
        val voiceIndex = call.getInt("voice", -1) ?: -1

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
            // utterance): the JS side always awaits this call's result
            // (the silent utterance below, not this one -- see the class
            // comment) before starting the next, so nothing is still
            // playing/queued at the point this fires.
            val result = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
            if (result != TextToSpeech.SUCCESS) {
                pendingUtterances.remove(utteranceId)
                call.reject("Failed to start speaking")
                return@whenReady
            }
            // Queued right behind the real speech with QUEUE_ADD, so the
            // engine itself can't fire this one's onDone until the real
            // utterance has actually finished rendering -- an ordering
            // guarantee no fixed JS-side delay could give us.
            val silenceResult = engine.playSilentUtterance(TRAILING_SILENCE_MS, TextToSpeech.QUEUE_ADD, "$utteranceId$SILENCE_SUFFIX")
            if (silenceResult != TextToSpeech.SUCCESS) {
                pendingUtterances.remove(utteranceId)
                call.reject("Failed to queue trailing silence")
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
