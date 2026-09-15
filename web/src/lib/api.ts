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

import { getApiBase } from "./config";

export class NoApiBaseError extends Error {
  constructor() {
    super("No backend server configured. Set it in Settings.");
  }
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const apiBase = getApiBase();
  if (!apiBase) throw new NoApiBaseError();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${apiBase}${path}?${qs}`);
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
