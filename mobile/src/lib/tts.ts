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

// Backed by android/.../NativeTtsPlugin.kt. Every remaining chunk of the
// chapter is submitted to the engine's own QUEUE_ADD queue in a single
// batch (speakChunks below), tracking progress via events
// (utteranceStart/utteranceDone) instead of gating each speak() call on
// the previous one settling -- there's no JS round trip sitting inside
// any chunk boundary for the engine to trip over. What actually fixed a
// long-standing word-dropping bug wasn't this batching (tried and ruled
// out on its own) but chunking per word instead of per sentence -- see
// the comment on splitIntoChunks() below for the rest of that history.
const NativeTts = registerPlugin<NativeTtsPlugin>("NativeTts");

// Chunk granularity has been tested from sentence-sized (~220 chars) up
// to near Android's ~4000-char per-utterance ceiling (whole paragraphs
// as one speak() call) -- both lost words identically. Chunking one word
// per utterance was what actually fixed the clipping, confirmed by
// testing on-device, but it's slow and choppy: every word is its own
// speak() call, with none of the natural cross-word prosody a real
// sentence gets, and per-utterance overhead accumulates across a whole
// chapter's worth of individually-queued words. Grouping a handful of
// words per chunk is a middle ground: enough utterance boundaries close
// together that whatever fixed the one-word case should still apply, but
// far fewer of them than one-per-word, so both the per-utterance
// overhead and the choppiness should drop. The right group size for this
// trade-off isn't known yet, so it's a user-adjustable setting
// (TtsSettings.wordsPerChunk) rather than a fixed constant -- see
// setWordsPerChunk() below for changing it live, mid-chapter.
export const DEFAULT_WORDS_PER_CHUNK = 5;

function splitIntoChunks(paragraphs: string[], wordsPerChunk: number): Chunk[] {
  const chunks: Chunk[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      chunks.push({ text: words.slice(i, i + wordsPerChunk).join(" "), paragraphIndex });
    }
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
  private paragraphs: string[] = [];
  private wordsPerChunk: number;
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
  // skip/rate-pitch-voice/wordsPerChunk change) simply won't be found
  // here and is ignored -- no separate generation counter needed for
  // that.
  private idToChunkIndex = new Map<string, number>();

  constructor(rate: number, pitch: number, wordsPerChunk: number, callbacks: TtsCallbacks = {}) {
    this.rate = rate;
    this.pitch = pitch;
    this.wordsPerChunk = wordsPerChunk;
    this.callbacks = callbacks;
    void NativeTts.addListener("utteranceStart", ({ id }) => this.handleUtteranceStart(id));
    void NativeTts.addListener("utteranceDone", ({ id }) => this.handleUtteranceDone(id));
    void NativeTts.addListener("utteranceError", ({ id, message }) => this.handleUtteranceError(id, message));
  }

  loadParagraphs(paragraphs: string[], startParagraphIndex = 0) {
    this.interrupt();
    this.paragraphs = paragraphs;
    this.chunks = splitIntoChunks(paragraphs, this.wordsPerChunk);
    this.chunkIndex = this.chunks.findIndex((c) => c.paragraphIndex >= startParagraphIndex);
    if (this.chunkIndex < 0) this.chunkIndex = 0;
    this.lastReportedParagraph = -1;
    this.setState("idle");
  }

  setVoice(voiceIndex: number | null) {
    this.voiceIndex = voiceIndex;
    if (this.state === "playing") this.restartCurrentChunk();
  }

  // Re-chunks the currently-loaded paragraphs at a new group size,
  // resuming from the same paragraph that was current before the change
  // (chunk-level position within that paragraph isn't preserved, same
  // trade-off as a rate/pitch/voice change mid-chunk).
  setWordsPerChunk(wordsPerChunk: number) {
    if (this.wordsPerChunk === wordsPerChunk) return;
    this.wordsPerChunk = wordsPerChunk;
    if (this.paragraphs.length === 0) return;
    const currentParagraph = this.chunks[this.chunkIndex]?.paragraphIndex ?? 0;
    const wasPlaying = this.state === "playing";
    this.interrupt();
    this.chunks = splitIntoChunks(this.paragraphs, this.wordsPerChunk);
    this.chunkIndex = this.chunks.findIndex((c) => c.paragraphIndex >= currentParagraph);
    if (this.chunkIndex < 0) this.chunkIndex = 0;
    if (wasPlaying) {
      this.setState("playing");
      this.submitBatch();
    } else {
      this.reportParagraph();
    }
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
