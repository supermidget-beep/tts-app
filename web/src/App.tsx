import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Library } from "./pages/Library";
import { Reader } from "./pages/Reader";
import { ShareTarget } from "./pages/ShareTarget";
import { Settings } from "./pages/Settings";

// BrowserRouter (not HashRouter) is required here: Android's share sheet
// navigates to the manifest's share_target "action" path with real query
// params (e.g. /share-target?url=...), and HashRouter would only ever see
// an empty hash for that request and lose them.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/reader" element={<Reader />} />
        <Route path="/share-target" element={<ShareTarget />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}
