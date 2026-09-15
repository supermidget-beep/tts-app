import { useEffect } from "react";
import { HashRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Library } from "./pages/Library";
import { Reader } from "./pages/Reader";
import { Settings } from "./pages/Settings";
import { consumePendingShare, onLiveShare } from "./lib/shareListener";

// Bridges native Android share intents into in-app navigation. Rendered
// inside the router (needs useNavigate) but renders nothing itself.
function ShareBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    consumePendingShare().then((url) => {
      if (!cancelled && url) navigate(`/reader?url=${encodeURIComponent(url)}&autoplay=1`);
    });
    const unsubscribe = onLiveShare((url) => {
      navigate(`/reader?url=${encodeURIComponent(url)}&autoplay=1`);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [navigate]);

  return null;
}

export default function App() {
  return (
    <HashRouter>
      <ShareBridge />
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/reader" element={<Reader />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </HashRouter>
  );
}
