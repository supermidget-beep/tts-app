import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

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

interface ChunkPayload {
  id: string;
  text: string;
}

interface NativeTtsPlugin {
  speakChunks(options: { chunks: ChunkPayload[]; rate: number; pitch: number; voice?: number }): Promise<void>;
  stop(): Promise<void>;
  getVoices(): Promise<{ voices: SpeechSynthesisVoice[] }>;
  openInstall(): Promise<void>;
  addListener(eventName: string, listenerFunc: (data: { id: string; message?: string }) => void): Promise<PluginListenerHandle>;
}

// Backed by android/.../NativeTtsPlugin.kt. Four previous approaches here
// (QueueStrategy.Add instead of Flush, whole-paragraph chunks instead of
// sentence-sized ones, pinning every engine call to the main thread, a
// native trailing-silence utterance meant to force a genuine playback-
// drain guarantee before resolving) all clipped the last word of
// sentences identically -- every one of them still called speak() for one
// sentence, awaited that sentence's own completion in JS, and only then
// called speak() again, putting a JS<->native round trip in the middle of
// every sentence boundary.
//
// This instead submits every remaining sentence of the chapter to the
// engine's own QUEUE_ADD queue in a single batch (speakChunks below) and
// tracks progress via events (utteranceStart/utteranceDone) instead of
// gating each speak() call on the previous one settling -- there's no
// longer a JS round trip sitting inside any sentence boundary for the
// engine to trip over.
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

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
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

export class TtsController {
  private chunks: Chunk[] = [];
  private chunkIndex = 0;
  private rate: number;
  private pitch: number;
  private voiceIndex: number | null = null;
  private state: PlaybackState = "idle";
  private callbacks: TtsCallbacks;
  private lastReportedParagraph = -1;
  // Maps an utterance id from the currently-submitted batch back to its
  // index into `chunks`. Replaced wholesale on every submitBatch() call,
  // so an event from a batch that's since been superseded (pause/stop/
  // skip/rate-pitch-voice change) simply won't be found here and is
  // ignored -- no separate generation counter needed for that.
  private idToChunkIndex = new Map<string, number>();

  constructor(rate: number, pitch: number, callbacks: TtsCallbacks = {}) {
    this.rate = rate;
    this.pitch = pitch;
    this.callbacks = callbacks;
    void NativeTts.addListener("utteranceStart", ({ id }) => this.handleUtteranceStart(id));
    void NativeTts.addListener("utteranceDone", ({ id }) => this.handleUtteranceDone(id));
    void NativeTts.addListener("utteranceError", ({ id, message }) => this.handleUtteranceError(id, message));
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
    this.submitBatch();
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
      this.submitBatch();
    } else {
      this.reportParagraph();
    }
  }

  private restartCurrentChunk() {
    this.interrupt();
    this.setState("playing");
    this.submitBatch();
  }

  private interrupt() {
    this.idToChunkIndex = new Map();
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

  // Submits every remaining chunk (from chunkIndex onward) to the engine
  // in one batch and lets it own the pacing between them entirely.
  private submitBatch() {
    const remaining = this.chunks.slice(this.chunkIndex);
    if (remaining.length === 0) {
      this.setState("ended");
      this.callbacks.onChapterEnd?.();
      return;
    }
    const map = new Map<string, number>();
    const payload: ChunkPayload[] = remaining.map((chunk, i) => {
      const id = nextId();
      map.set(id, this.chunkIndex + i);
      return { id, text: chunk.text };
    });
    this.idToChunkIndex = map;
    this.reportParagraph();
    NativeTts.speakChunks({
      chunks: payload,
      rate: this.rate,
      pitch: this.pitch,
      voice: this.voiceIndex ?? undefined,
    }).catch(() => {
      this.callbacks.onError?.("Speech error while reading this chapter.");
    });
  }

  private handleUtteranceStart(id: string) {
    const idx = this.idToChunkIndex.get(id);
    if (idx === undefined) return; // from a batch that's since been superseded
    this.chunkIndex = idx;
    this.reportParagraph();
  }

  private handleUtteranceDone(id: string) {
    const idx = this.idToChunkIndex.get(id);
    if (idx === undefined) return;
    if (idx === this.chunks.length - 1) {
      this.chunkIndex = this.chunks.length;
      this.setState("ended");
      this.callbacks.onChapterEnd?.();
    }
  }

  private handleUtteranceError(id: string, message: string | undefined) {
    if (this.idToChunkIndex.get(id) === undefined) return;
    this.callbacks.onError?.(`Speech error: ${message ?? "unknown"}`);
  }
}
