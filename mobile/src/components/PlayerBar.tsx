import type { PlaybackState } from "../lib/tts";
import type { TtsSettings } from "../lib/storage";

interface Props {
  state: PlaybackState;
  settings: TtsSettings;
  voices: SpeechSynthesisVoice[];
  hasNext: boolean;
  hasPrev: boolean;
  onPlayPause: () => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  onNextChapter: () => void;
  onPrevChapter: () => void;
  onRateChange: (rate: number) => void;
  onPitchChange: (pitch: number) => void;
  onVoiceChange: (voiceURI: string) => void;
  onWordsPerChunkChange: (wordsPerChunk: number) => void;
}

export function PlayerBar({
  state,
  settings,
  voices,
  hasNext,
  hasPrev,
  onPlayPause,
  onSkipForward,
  onSkipBackward,
  onNextChapter,
  onPrevChapter,
  onRateChange,
  onPitchChange,
  onVoiceChange,
  onWordsPerChunkChange,
}: Props) {
  return (
    <div className="player-bar">
      <div className="player-transport">
        <button
          type="button"
          onClick={onPrevChapter}
          disabled={!hasPrev}
          aria-label="Previous chapter"
          title="Previous chapter"
        >
          ⏮
        </button>
        <button type="button" onClick={onSkipBackward} aria-label="Back one paragraph" title="Back">
          ◀
        </button>
        <button
          type="button"
          className="play-pause"
          onClick={onPlayPause}
          aria-label={state === "playing" ? "Pause" : "Play"}
        >
          {state === "playing" ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          onClick={onSkipForward}
          aria-label="Forward one paragraph"
          title="Forward"
        >
          ▶▶
        </button>
        <button
          type="button"
          onClick={onNextChapter}
          disabled={!hasNext}
          aria-label="Next chapter"
          title="Next chapter"
        >
          ⏭
        </button>
      </div>

      <div className="player-sliders">
        <label>
          Speed <span>{settings.rate.toFixed(2)}x</span>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.05}
            value={settings.rate}
            onChange={(e) => onRateChange(Number(e.target.value))}
          />
        </label>
        <label>
          Pitch <span>{settings.pitch.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={settings.pitch}
            onChange={(e) => onPitchChange(Number(e.target.value))}
          />
        </label>
        <label>
          Voice
          <select
            value={settings.voiceURI ?? ""}
            onChange={(e) => onVoiceChange(e.target.value)}
          >
            <option value="">Default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <label>
          Words/chunk <span>{settings.wordsPerChunk}</span>
          <input
            type="range"
            min={1}
            max={150}
            step={1}
            value={settings.wordsPerChunk}
            onChange={(e) => onWordsPerChunkChange(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
