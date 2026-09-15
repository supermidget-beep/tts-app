import { registerPlugin } from "@capacitor/core";

export interface SpeechSynthesisVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export type PlaybackState = "idle" | "playing" | "paused" | "ended";

interface Chunk {
  text: string;
  paragraphIndex: number;
}

interface NativeTtsPlugin {
  speak(options: { text: string; rate: number; pitch: number; voice?: number }): Promise<void>;
  stop(): Promise<void>;
  getVoices(): Promise<{ voices: SpeechSynthesisVoice[] }>;
  openInstall(): Promise<void>;
}

// Backed by android/.../NativeTtsPlugin.kt -- a from-scratch replacement
// for @capacitor-community/text-to-speech, written after that plugin
// reliably clipped the last word of sentences no matter what was tried
// against it from this side (QueueStrategy.Add instead of Flush,
// whole-paragraph chunks instead of sentence-sized ones, an explicit
// pause between chunks), while Android's own "Select to Speak" reads the
// exact same device/voice with no clipping at all. That ruled out the
// engine/voice itself and pointed at how the community plugin drives it:
// its native speak()/stop()/setSpeechRate() etc. are never explicitly
// dispatched to the main thread, and android.speech.tts.TextToSpeech is
// documented to expect being driven consistently from one thread.
// NativeTtsPlugin.kt pins every engine interaction to the main thread
// instead (the same pattern ChapterExtractorPlugin.kt already used
// successfully), and its stop() properly resolves any pending speak()
// call rather than leaving it hanging forever.
const NativeTts = registerPlugin<NativeTtsPlugin>("NativeTts");

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
    const { voices } = await NativeTts.getVoices();
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
  return NativeTts.openInstall();
}

export interface TtsCallbacks {
  onStateChange?: (state: PlaybackState) => void;
  onParagraphChange?: (paragraphIndex: number) => void;
  onChapterEnd?: () => void;
  onError?: (message: string) => void;
}

// Unlike the old community plugin, NativeTtsPlugin's stop() explicitly
// resolves any pending speak() call, so a still-in-flight chunk always
// settles the moment playback is interrupted -- no cancel-race/hanging-
// promise workaround needed here.
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

  private interrupt() {
    this.generation++;
    void NativeTts.stop();
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
    // The generation check after each await is what keeps only one loop's
    // iterations taking effect: a superseded loop (pause/stop/skip/rate-
    // pitch-voice change firing mid-chunk) always hits that check and
    // returns before speaking again.
    const myGeneration = this.generation;
    while (this.chunkIndex < this.chunks.length) {
      this.reportParagraph();
      const chunk = this.chunks[this.chunkIndex];

      try {
        // interrupt()'s stop() resolves (not rejects) any pending speak()
        // call, so a genuine engine error is the only thing that reaches
        // the catch block below -- an interruption falls through to the
        // generation check right after, same as normal completion.
        await NativeTts.speak({
          text: chunk.text,
          rate: this.rate,
          pitch: this.pitch,
          voice: this.voiceIndex ?? undefined,
        });
      } catch {
        if (myGeneration !== this.generation) return;
        this.callbacks.onError?.("Speech error while reading this chapter.");
        return;
      }
      if (myGeneration !== this.generation) return; // superseded by pause/stop/skip

      this.chunkIndex++;
    }
    if (myGeneration !== this.generation) return;
    this.setState("ended");
    this.callbacks.onChapterEnd?.();
  }
}
