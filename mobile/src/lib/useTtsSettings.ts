import { useCallback, useEffect, useState } from "react";
import { loadTtsSettings, saveTtsSettings, type TtsSettings } from "./storage";

export function useTtsSettings() {
  const [settings, setSettings] = useState<TtsSettings>({ rate: 1, pitch: 1, voiceURI: null, wordsPerChunk: 5 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTtsSettings().then((s) => {
      if (!cancelled) {
        setSettings(s);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<TtsSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveTtsSettings(next);
      return next;
    });
  }, []);

  return { settings, update, loaded };
}
