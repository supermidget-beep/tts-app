package com.supermidget.wuxiareader

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Bundle
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

// A wrapper around android.speech.tts.TextToSpeech. After nine other
// fixes (queue strategy, chunk sizing at both the sentence and near-
// paragraph level, main-thread pinning, a native trailing-silence
// utterance, batching a whole chapter into one native queue, playback
// rate, three different TTS engines, and AudioAttributes tagging) all
// clipped words identically, chunking text per WORD instead of per
// sentence/paragraph (see splitIntoChunks() in tts.ts) turned out to be
// what actually fixed it -- every remaining word of the chapter is
// submitted to the engine's own queue in a single batch (speakChunks()
// below), all via QUEUE_ADD, with no JS round-trip between any of them.
// JS finds out what's currently playing via onStart/onDone events
// (notifyListeners below) instead of gating the next speak() call on
// anything.
//
// One-word utterances are choppier than sentence-level ones by nature
// (no cross-word prosody), so every speak() call also carries a single,
// constant audio session id (audioSessionId below) via
// KEY_PARAM_SESSION_ID, hinting the engine to keep reusing the same
// underlying audio session/AudioTrack across consecutive words instead
// of tearing one down and standing up a fresh one for every single word
// -- aimed at tightening the gap between words without giving up the
// per-word chunking that fixed the clipping.
@CapacitorPlugin(name = "NativeTts")
class NativeTtsPlugin : Plugin() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready = false
    private val pendingInitCalls = mutableListOf<() -> Unit>()
    private var sortedVoices: List<Voice> = emptyList()
    private var audioSessionId = AudioManager.AUDIO_SESSION_ID_GENERATE

    override fun load() {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        audioSessionId = audioManager?.generateAudioSessionId() ?: AudioManager.AUDIO_SESSION_ID_GENERATE
        mainHandler.post {
            tts = TextToSpeech(context) { status ->
                mainHandler.post {
                    ready = status == TextToSpeech.SUCCESS
                    if (ready) {
                        sortedVoices = (tts?.voices ?: emptySet()).sortedBy { it.name }
                        // Untested until now: every previous fix here left
                        // the engine on its default AudioAttributes, which
                        // android.speech.tts.TextToSpeech treats like
                        // generic media playback. Android's own "Select to
                        // Speak" (which reads this same device cleanly) is
                        // an accessibility service and can reasonably be
                        // assumed to tag its output as accessibility
                        // speech, which the OS audio HAL can legitimately
                        // give different stream setup/teardown handling
                        // than plain media -- a real, previously-untried
                        // lever for exactly the per-utterance clipping
                        // seen here, independent of queue strategy, chunk
                        // size, threading, or which engine is doing the
                        // synthesizing (all four of which are now ruled
                        // out).
                        tts?.setAudioAttributes(
                            AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build(),
                        )
                        tts?.setOnUtteranceProgressListener(
                            object : UtteranceProgressListener() {
                                override fun onStart(utteranceId: String?) {
                                    emit("utteranceStart", utteranceId) { }
                                }

                                override fun onDone(utteranceId: String?) {
                                    emit("utteranceDone", utteranceId) { }
                                }

                                @Deprecated("Deprecated in Java")
                                override fun onError(utteranceId: String?) {
                                    emit("utteranceError", utteranceId) { it.put("message", "Speech error") }
                                }

                                override fun onError(utteranceId: String?, errorCode: Int) {
                                    emit("utteranceError", utteranceId) { it.put("message", "Speech error ($errorCode)") }
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

    private fun emit(event: String, utteranceId: String?, extra: (JSObject) -> Unit) {
        val id = utteranceId ?: return
        mainHandler.post {
            val data = JSObject()
            data.put("id", id)
            extra(data)
            notifyListeners(event, data)
        }
    }

    private fun whenReady(action: () -> Unit) {
        mainHandler.post {
            if (ready) action() else pendingInitCalls.add(action)
        }
    }

    @PluginMethod
    fun speakChunks(call: PluginCall) {
        val chunks = call.getArray("chunks")
        if (chunks == null || chunks.length() == 0) {
            call.reject("Missing 'chunks'")
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
            engine.setSpeechRate(rate)
            engine.setPitch(pitch)
            if (voiceIndex in sortedVoices.indices) {
                engine.setVoice(sortedVoices[voiceIndex])
            }
            val params = Bundle()
            if (audioSessionId != AudioManager.AUDIO_SESSION_ID_GENERATE) {
                params.putInt(TextToSpeech.Engine.KEY_PARAM_SESSION_ID, audioSessionId)
            }
            var ok = true
            for (i in 0 until chunks.length()) {
                val obj = chunks.getJSONObject(i)
                val id = obj.getString("id")
                val text = obj.getString("text")
                // Always QUEUE_ADD, including the first chunk: JS always
                // calls stop() before submitting a new batch (see
                // TtsController.interrupt() in tts.ts), so the engine's
                // queue is already empty by the time this runs -- a
                // QUEUE_FLUSH here would be redundant, and flushing forces
                // the engine to internally stop-and-reset right at the
                // moment the new first utterance needs to start.
                val result = engine.speak(text, TextToSpeech.QUEUE_ADD, params, id)
                if (result != TextToSpeech.SUCCESS) {
                    ok = false
                    break
                }
            }
            if (ok) call.resolve() else call.reject("Failed to queue speech")
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        mainHandler.post {
            tts?.stop()
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
