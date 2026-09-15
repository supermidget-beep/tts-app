import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Library } from "./pages/Library";
import { Reader } from "./pages/Reader";
import { ShareTarget } from "./pages/ShareTarget";
import { Settings } from "./pages/Settings";

// BrowserRouter (not HashRouter) is required here: Android's share sheet
// navigates to the manifest's share_target "action" path with real query
// params (e.g. /share-target?url=...), and HashRouter would only ever see
// an empty hash for that request and lose them.
//
// `basename` matters when the app is hosted under a subpath (e.g. GitHub
// Pages project sites at /repo-name/, set via VITE_BASE_PATH at build
// time) rather than the domain root. import.meta.env.BASE_URL mirrors
// vite.config.ts's `base` and always has a trailing slash; react-router
// wants no trailing slash on basename.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/reader" element={<Reader />} />
        <Route path="/share-target" element={<ShareTarget />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}
