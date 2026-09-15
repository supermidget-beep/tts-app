// Wraps the Web Speech API's SpeechSynthesis with paragraph-aware chunking
// (utterances break on real punctuation, not mid-sentence), rate/pitch/voice
// changes that take effect immediately, and an onChapterEnd hook used to
// drive auto-advance to the next chapter.

export type PlaybackState = "idle" | "playing" | "paused" | "ended";

interface Chunk {
  text: string;
  paragraphIndex: number;
}

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

export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const handle = () => {
      const voices = synth.getVoices();
      if (voices.length > 0) {
        synth.removeEventListener("voiceschanged", handle);
        resolve(voices);
      }
    };
    synth.addEventListener("voiceschanged", handle);
    // Some browsers never fire the event if voices load synchronously late.
    setTimeout(() => resolve(synth.getVoices()), 1000);
  });
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
  private voice: SpeechSynthesisVoice | null;
  private state: PlaybackState = "idle";
  private callbacks: TtsCallbacks;
  private lastReportedParagraph = -1;
  private generation = 0;

  constructor(rate: number, pitch: number, callbacks: TtsCallbacks = {}) {
    this.rate = rate;
    this.pitch = pitch;
    this.voice = null;
    this.callbacks = callbacks;
  }

  loadParagraphs(paragraphs: string[], startParagraphIndex = 0) {
    window.speechSynthesis.cancel();
    this.generation++;
    this.chunks = splitIntoChunks(paragraphs);
    this.chunkIndex = this.chunks.findIndex((c) => c.paragraphIndex >= startParagraphIndex);
    if (this.chunkIndex < 0) this.chunkIndex = 0;
    this.lastReportedParagraph = -1;
    this.setState("idle");
  }

  setVoice(voice: SpeechSynthesisVoice | null) {
    this.voice = voice;
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
    if (this.chunks.length === 0) return;
    if (this.state === "paused" && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      this.setState("playing");
      return;
    }
    this.setState("playing");
    this.speakCurrentChunk();
  }

  pause() {
    if (this.state !== "playing") return;
    window.speechSynthesis.pause();
    this.setState("paused");
  }

  stop() {
    window.speechSynthesis.cancel();
    this.generation++;
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
    window.speechSynthesis.cancel();
    this.generation++;
    this.chunkIndex = index;
    if (wasPlaying) {
      this.setState("playing");
      this.speakCurrentChunk();
    } else {
      this.reportParagraph();
    }
  }

  private restartCurrentChunk() {
    window.speechSynthesis.cancel();
    this.generation++;
    this.speakCurrentChunk();
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

  private speakCurrentChunk() {
    const chunk = this.chunks[this.chunkIndex];
    if (!chunk) {
      this.setState("ended");
      this.callbacks.onChapterEnd?.();
      return;
    }
    this.reportParagraph();

    const utterance = new SpeechSynthesisUtterance(chunk.text);
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    if (this.voice) utterance.voice = this.voice;

    const myGeneration = this.generation;
    utterance.onend = () => {
      if (myGeneration !== this.generation) return; // superseded by a skip/restart
      this.chunkIndex++;
      if (this.state === "playing") this.speakCurrentChunk();
    };
    utterance.onerror = (event) => {
      if (myGeneration !== this.generation) return;
      if (event.error === "interrupted" || event.error === "canceled") return;
      this.callbacks.onError?.(`Speech error: ${event.error}`);
    };

    window.speechSynthesis.speak(utterance);
  }
}
