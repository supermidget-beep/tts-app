import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBase, setApiBase } from "../lib/config";
import { getVoices } from "../lib/tts";
import { useTtsSettings } from "../lib/useTtsSettings";

export function Settings() {
  const navigate = useNavigate();
  const { settings, update, loaded } = useTtsSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [apiBaseInput, setApiBaseInput] = useState(() => getApiBase());
  const [apiBaseSaved, setApiBaseSaved] = useState(false);

  useEffect(() => {
    getVoices().then(setVoices);
  }, []);

  if (!loaded) return null;

  return (
    <div className="page">
      <header className="library-header">
        <button type="button" className="back-link" onClick={() => navigate("/")}>
          ← Library
        </button>
        <h1>Settings</h1>
      </header>

      <form
        className="settings-row"
        onSubmit={(e) => {
          e.preventDefault();
          setApiBase(apiBaseInput);
          setApiBaseSaved(true);
          setTimeout(() => setApiBaseSaved(false), 2000);
        }}
      >
        Backend server URL
        <input
          type="url"
          placeholder="https://your-backend.onrender.com"
          value={apiBaseInput}
          onChange={(e) => setApiBaseInput(e.target.value)}
        />
        <button type="submit">{apiBaseSaved ? "Saved ✓" : "Save"}</button>
        <span className="hint">
          The address of the extraction API from the server/ folder (see the README for
          deploying it). Chapters can't be fetched until this is set.
        </span>
      </form>

      <p className="hint">
        These are the defaults used for new chapters. You can still adjust speed and pitch
        per-chapter from the player.
      </p>

      <label className="settings-row">
        Default speed <span>{settings.rate.toFixed(2)}x</span>
        <input
          type="range"
          min={0.5}
          max={3}
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
    </div>
  );
}
