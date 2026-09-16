import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVoices, openVoiceInstall, type SpeechSynthesisVoice } from "../lib/tts";
import { useTtsSettings } from "../lib/useTtsSettings";

export function Settings() {
  const navigate = useNavigate();
  const { settings, update, loaded } = useTtsSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    getVoices().then(setVoices);
  }, []);

  const refreshVoices = async () => {
    setRefreshing(true);
    try {
      setVoices(await getVoices(true));
    } finally {
      setRefreshing(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="page">
      <header className="library-header">
        <button type="button" className="back-link" onClick={() => navigate("/")}>
          ← Library
        </button>
        <h1>Settings</h1>
      </header>

      <p className="hint">
        These are the defaults used for new chapters. You can still adjust speed and pitch
        per-chapter from the player.
      </p>

      <label className="settings-row">
        Default speed <span>{settings.rate.toFixed(2)}x</span>
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.05}
          value={settings.rate}
          onChange={(e) => update({ rate: Number(e.target.value) })}
        />
      </label>

      <label className="settings-row">
        Default pitch <span>{settings.pitch.toFixed(2)}</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={settings.pitch}
          onChange={(e) => update({ pitch: Number(e.target.value) })}
        />
      </label>

      <label className="settings-row">
        Default words per chunk <span>{settings.wordsPerChunk}</span>
        <input
          type="range"
          min={1}
          max={60}
          step={1}
          value={settings.wordsPerChunk}
          onChange={(e) => update({ wordsPerChunk: Number(e.target.value) })}
        />
      </label>
      <p className="hint">
        How many words get grouped into one TTS request. Lower is more reliable but choppier;
        higher reads more naturally but can drop words on some devices/engines. You can also
        adjust this live from the player while reading.
      </p>

      <label className="settings-row">
        Voice
        <select
          value={settings.voiceURI ?? ""}
          onChange={(e) => update({ voiceURI: e.target.value || null })}
        >
          <option value="">Device default</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>

      <div className="settings-row">
        Want more natural-sounding voices?
        <span className="hint">
          Voices come from your phone's system text-to-speech engine, not this app. Google's
          engine offers higher-quality "natural" voices as a separate download — tap below to
          open the install screen, download one, then come back and tap "Refresh voice list."
        </span>
        <div className="settings-actions">
          <button type="button" onClick={() => openVoiceInstall()}>
            Get more voices
          </button>
          <button type="button" onClick={refreshVoices} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh voice list"}
          </button>
        </div>
      </div>
    </div>
  );
}
