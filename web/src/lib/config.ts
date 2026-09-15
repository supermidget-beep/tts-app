// The backend extraction API's base URL. GitHub Pages (and most static
// hosts) can't run the Node backend on the same origin, and the backend's
// own URL isn't known until it's deployed separately (e.g. Render assigns
// it at deploy time) -- so this is resolved at *runtime* from localStorage
// (editable from Settings) rather than baked in only at build time. A
// VITE_API_BASE_URL set at build time is still used as the initial default.

const STORAGE_KEY = "wuxia-tts-reader:apiBaseUrl";

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getApiBase(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return trimTrailingSlash(stored);
  } catch {
    // localStorage unavailable (private browsing, etc.) -- use the build default.
  }
  return trimTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? "");
}

export function setApiBase(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, trimTrailingSlash(url));
  } catch {
    // Nothing we can do without storage; the app falls back to the build default.
  }
}

export function hasApiBase(): boolean {
  return getApiBase().length > 0;
}
