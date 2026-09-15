import { TextToSpeech, QueueStrategy } from "@capacitor-community/text-to-speech";
import type { SpeechSynthesisVoice } from "@capacitor-community/text-to-speech";

export type { SpeechSynthesisVoice };
export type PlaybackState = "idle" | "playing" | "paused" | "ended";

interface Chunk {
  text: string;
  paragraphIndex: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pause between consecutive chunks -- see the comment at the speak() call
// site in runLoop() for why this exists. Short enough to be an unnoticed,
// natural-feeling gap between sentences/paragraphs rather than an
// awkward silence.
const SENTENCE_GAP_MS = 250;

// Tried grouping whole paragraphs into one utterance on the theory that
// the clipping was about the boundary *between* our speak() calls -- but
// it turned out to clip mid-paragraph too, inside a single call, which
// only the engine's own internal sentence-to-sentence pacing controls.
// That rules out fixing this by touching fewer boundaries; it means the
// engine's *internal* pacing can't be trusted either. So: back to one
// sentence per chunk, explicitly boundary every sentence ourselves
// (QueueStrategy.Add + SENTENCE_GAP_MS below), and never hand the engine
// more than one sentence to pace on its own.
const MAX_CHUNK_LEN = 220;

function splitIntoChunks(paragraphs: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const sentences = paragraph.match(/[^.!?]+[.!?]*(\s+|$)/g) ?? [paragraph];
    let buffer = "";
    for (const sentence of sentences) {
      if ((buffer + sentence).length > MAX_CHUNK_LEN && buffer) {
        chunks.push({ text: buffer.trim(), paragraphIndex });
        buffer = "";
      }
      buffer += sentence;
      while (buffer.length > MAX_CHUNK_LEN) {
        let cut = buffer.lastIndexOf(" ", MAX_CHUNK_LEN);
        if (cut <= 0) cut = MAX_CHUNK_LEN;
        chunks.push({ text: buffer.slice(0, cut).trim(), paragraphIndex });
        buffer = buffer.slice(cut).trim();
      }
    }
    if (buffer.trim()) chunks.push({ text: buffer.trim(), paragraphIndex });
  });
  return chunks;
}

let voicesCache: SpeechSynthesisVoice[] | null = null;

export async function getVoices(forceRefresh = false): Promise<SpeechSynthesisVoice[]> {
  if (!voicesCache || forceRefresh) {
    const { voices } = await TextToSpeech.getSupportedVoices();
    voicesCache = voices;
  }
  return voicesCache;
}

// Opens Android's system screen for installing/managing TTS voice data
// (Settings > Text-to-speech). This is how you get higher-quality voices
// (e.g. Google's "Wavenet"-style natural voices) beyond whatever shipped
// on the device by default -- it's a system-level install, not something
// this app can do on its own.
export function openVoiceInstall(): Promise<void> {
  return TextToSpeech.openInstall();
}

export interface TtsCallbacks {
  onStateChange?: (state: PlaybackState) => void;
  onParagraphChange?: (paragraphIndex: number) => void;
  onChapterEnd?: () => void;
  onError?: (message: string) => void;
}

// The native TextToSpeech plugin's speak() promise resolves on the
// engine's "utterance done" callback -- but its stop() implementation
// clears pending callbacks WITHOUT ever firing onDone/onError, so an
// in-flight speak() call awaited directly would hang forever the moment
// pause/skip/stop calls stop(). Every chunk's speak() is raced against a
// manually-resolved "cancel" signal instead, so interrupting playback
// always unblocks the loop -- the abandoned native call itself is
// harmless, just never resolves (a known, accepted quirk of the plugin).
export class TtsController {
  private chunks: Chunk[] = [];
  private chunkIndex = 0;
  private rate: number;
  private pitch: number;
  private voiceIndex: number | null = null;
  private state: PlaybackState = "idle";
  private callbacks: TtsCallbacks;
  private lastReportedParagraph = -1;
  private generation = 0;
  private cancelResolvers: Array<() => void> = [];

  constructor(rate: number, pitch: number, callbacks: TtsCallbacks = {}) {
    this.rate = rate;
    this.pitch = pitch;
    this.callbacks = callbacks;
  }

  loadParagraphs(paragraphs: string[], startParagraphIndex = 0) {
    this.interrupt();
    this.chunks = splitIntoChunks(paragraphs);
    this.chunkIndex = this.chunks.findIndex((c) => c.paragraphIndex >= startParagraphIndex);
    if (this.chunkIndex < 0) this.chunkIndex = 0;
    this.lastReportedParagraph = -1;
    this.setState("idle");
  }

  setVoice(voiceIndex: number | null) {
    this.voiceIndex = voiceIndex;
    if (this.state === "playing") this.restartCurrentChunk();
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.state === "playing") this.restartCurrentChunk();
  }

  setPitch(pitch: number) {
    this.pitch = pitch;
    if (this.state === "playing") this.restartCurrentChunk();
  }

  play() {
    if (this.chunks.length === 0 || this.state === "playing") return;
    this.setState("playing");
    void this.runLoop();
  }

  pause() {
    if (this.state !== "playing") return;
    this.interrupt();
    this.setState("paused");
  }

  stop() {
    this.interrupt();
    this.setState("idle");
  }

  skipForward() {
    const paragraph = this.chunks[this.chunkIndex]?.paragraphIndex ?? 0;
    const nextIndex = this.chunks.findIndex((c) => c.paragraphIndex > paragraph);
    if (nextIndex >= 0) this.jumpToChunk(nextIndex);
  }

  skipBackward() {
    const paragraph = this.chunks[this.chunkIndex]?.paragraphIndex ?? 0;
    let target = -1;
    for (let i = this.chunkIndex - 1; i >= 0; i--) {
      if (this.chunks[i].paragraphIndex < paragraph) {
        target = this.chunks.findIndex((c) => c.paragraphIndex === this.chunks[i].paragraphIndex);
        break;
      }
    }
    if (target >= 0) this.jumpToChunk(target);
  }

  jumpToParagraph(paragraphIndex: number) {
    const idx = this.chunks.findIndex((c) => c.paragraphIndex >= paragraphIndex);
    if (idx >= 0) this.jumpToChunk(idx);
  }

  getState(): PlaybackState {
    return this.state;
  }

  private jumpToChunk(index: number) {
    const wasPlaying = this.state === "playing";
    this.interrupt();
    this.chunkIndex = index;
    if (wasPlaying) {
      this.setState("playing");
      void this.runLoop();
    } else {
      this.reportParagraph();
    }
  }

  private restartCurrentChunk() {
    this.interrupt();
    this.setState("playing");
    void this.runLoop();
  }

  // Bumps the generation (so a still-in-flight loop iteration recognizes
  // it's been superseded and gives up cleanly) and resolves every pending
  // cancel-race so nothing is left waiting on a speak() call that will
  // never settle on its own.
  private interrupt() {
    this.generation++;
    void TextToSpeech.stop();
    this.cancelResolvers.forEach((resolve) => resolve());
    this.cancelResolvers = [];
  }

  private setState(state: PlaybackState) {
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }

  private reportParagraph() {
    const p = this.chunks[this.chunkIndex]?.paragraphIndex;
    if (p !== undefined && p !== this.lastReportedParagraph) {
      this.lastReportedParagraph = p;
      this.callbacks.onParagraphChange?.(p);
    }
  }

  private async runLoop() {
    // No "already running" guard here: relying on it would be wrong,
    // because when a restart calls interrupt() + runLoop() synchronously,
    // the previous runLoop call hasn't unwound yet (its cancelled
    // Promise.race only resolves on a later microtask), so a same-tick
    // guard would see a stale "still running" and silently no-op the
    // restart. The generation check below (right after each await) is
    // what keeps only one loop's iterations taking effect: a superseded
    // loop always hits that check and returns before it could speak()
    // again, so it never gets a chance to queue a stray chunk behind the
    // new loop's -- important now that chunks use QueueStrategy.Add
    // rather than Flush (see below), since Add no longer auto-clears
    // whatever a stale caller might otherwise queue.
    const myGeneration = this.generation;
    while (this.chunkIndex < this.chunks.length) {
      this.reportParagraph();
      const chunk = this.chunks[this.chunkIndex];

      this.cancelResolvers = [];
      const cancelPromise = new Promise<"cancelled">((resolve) => {
        this.cancelResolvers.push(() => resolve("cancelled"));
      });
      const speakPromise = TextToSpeech.speak({
        text: chunk.text,
        rate: this.rate,
        pitch: this.pitch,
        voice: this.voiceIndex ?? undefined,
        // Add, not Flush: the native plugin's speak() calls the engine's
        // stop() first for any non-Add request, and that stop() can clip
        // the tail end of the PREVIOUS chunk's audio if it fires just as
        // playback is finishing -- heard as the last word of a sentence
        // getting cut off, right at each chunk boundary. interrupt()
        // already calls stop() explicitly for real interruptions (pause/
        // stop/skip/rate-pitch-voice change), so plain continuation here
        // never needs the engine to stop anything itself.
        queueStrategy: QueueStrategy.Add,
      })
        .then(() => "done" as const)
        .catch(() => "error" as const);

      const result = await Promise.race([speakPromise, cancelPromise]);
      if (myGeneration !== this.generation) return; // superseded by pause/stop/skip

      if (result === "error") {
        this.callbacks.onError?.("Speech error while reading this chapter.");
        return;
      }

      // The plugin's speak() re-applies rate/pitch/voice to the shared
      // TTS engine on every call, and Android's "utterance done" callback
      // is known to sometimes fire a moment before the audio has actually
      // finished draining to the speaker. Calling speak() again
      // immediately risks reconfiguring the engine while the last bit of
      // the previous chunk is still physically playing, clipping it. A
      // short pause here gives that buffer time to actually finish first.
      await sleep(SENTENCE_GAP_MS);
      if (myGeneration !== this.generation) return; // interrupted during the pause

      this.chunkIndex++;
    }
    if (myGeneration !== this.generation) return;
    this.setState("ended");
    this.callbacks.onChapterEnd?.();
  }
}
