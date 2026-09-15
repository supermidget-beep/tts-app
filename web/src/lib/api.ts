export interface ChapterData {
  title: string;
  siteName: string | null;
  sourceUrl: string;
  paragraphs: string[];
  nextUrl: string | null;
  prevUrl: string | null;
  tocUrl: string | null;
}

export interface TocChapter {
  title: string;
  url: string;
}

export interface TocData {
  title: string;
  sourceUrl: string;
  chapters: TocChapter[];
}

// Configure via VITE_API_BASE_URL at build time (see README). Falls back to
// same-origin /api, which works when the backend is reverse-proxied behind
// the same host as the static app.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}${path}?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchChapter(url: string): Promise<ChapterData> {
  return getJson<ChapterData>("/api/extract", { url });
}

export function fetchToc(url: string): Promise<TocData> {
  return getJson<TocData>("/api/toc", { url });
}
