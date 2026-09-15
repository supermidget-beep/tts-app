import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChapterData, TocChapter } from "./api";

export interface BookRecord {
  id: string;
  title: string;
  siteName: string | null;
  tocUrl: string | null;
  chapters: TocChapter[] | null;
  currentUrl: string;
  currentTitle: string;
  favorite: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface TtsSettings {
  rate: number;
  pitch: number;
  voiceURI: string | null;
}

interface ReaderDB extends DBSchema {
  books: {
    key: string;
    value: BookRecord;
    indexes: { updatedAt: number };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null;

function getDb(): Promise<IDBPDatabase<ReaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ReaderDB>("wuxia-tts-reader", 1, {
      upgrade(db) {
        const books = db.createObjectStore("books", { keyPath: "id" });
        books.createIndex("updatedAt", "updatedAt");
        db.createObjectStore("settings");
      },
    });
  }
  return dbPromise;
}

function normalizeKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// Best-effort grouping of chapters into a "book": prefer the table-of-
// contents URL (stable per novel); otherwise assume chapter pages live
// under a shared parent path and use that.
export function bookIdFromChapter(chapter: ChapterData): string {
  if (chapter.tocUrl) return normalizeKey(chapter.tocUrl);
  try {
    const u = new URL(chapter.sourceUrl);
    const segments = u.pathname.split("/").filter(Boolean);
    segments.pop();
    return normalizeKey(`${u.origin}/${segments.join("/")}`);
  } catch {
    return normalizeKey(chapter.sourceUrl);
  }
}

// Chapter titles come in two common shapes: "Chapter 5: Trial by Fire"
// (prefix) or "Novel Name - Chapter 5" (suffix). Strip whichever is
// present to get something closer to just the novel's name for grouping
// chapters into one library entry.
function bookTitleFromChapter(chapter: ChapterData): string {
  const suffixStripped = chapter.title.replace(
    /\s*[-–—|:]\s*chapter\s+\d+([:.\-–].*)?$/i,
    "",
  );
  if (suffixStripped.trim() && suffixStripped !== chapter.title) {
    return suffixStripped.trim();
  }
  const prefixStripped = chapter.title.replace(/^\s*chapter\s+\d+[:.\-–]?\s*/i, "");
  return prefixStripped.trim() || chapter.title;
}

export async function upsertBookFromChapter(chapter: ChapterData): Promise<BookRecord> {
  const db = await getDb();
  const id = bookIdFromChapter(chapter);
  const existing = await db.get("books", id);
  const now = Date.now();
  const record: BookRecord = {
    id,
    title: existing?.title ?? bookTitleFromChapter(chapter),
    siteName: chapter.siteName ?? existing?.siteName ?? null,
    tocUrl: chapter.tocUrl ?? existing?.tocUrl ?? null,
    chapters: existing?.chapters ?? null,
    currentUrl: chapter.sourceUrl,
    currentTitle: chapter.title,
    favorite: existing?.favorite ?? false,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
  };
  await db.put("books", record);
  return record;
}

export async function setFavorite(id: string, favorite: boolean): Promise<BookRecord | undefined> {
  const db = await getDb();
  const existing = await db.get("books", id);
  if (!existing) return undefined;
  const record: BookRecord = { ...existing, favorite };
  await db.put("books", record);
  return record;
}

export async function saveBookChapters(bookId: string, chapters: TocChapter[]): Promise<void> {
  const db = await getDb();
  const existing = await db.get("books", bookId);
  if (!existing) return;
  await db.put("books", { ...existing, chapters, updatedAt: Date.now() });
}

export async function updateBookPosition(
  bookId: string,
  chapterUrl: string,
  chapterTitle: string,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get("books", bookId);
  if (!existing) return;
  await db.put("books", {
    ...existing,
    currentUrl: chapterUrl,
    currentTitle: chapterTitle,
    updatedAt: Date.now(),
  });
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  const db = await getDb();
  return db.get("books", id);
}

export async function listBooks(): Promise<BookRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("books", "updatedAt");
  all.reverse(); // most recently read first
  // Favorites float to the top (still most-recent-first within each group).
  // Records saved before the favorite field existed won't have it at all.
  all.sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false));
  return all;
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("books", id);
}

const DEFAULT_TTS_SETTINGS: TtsSettings = { rate: 1, pitch: 1, voiceURI: null };

export async function loadTtsSettings(): Promise<TtsSettings> {
  const db = await getDb();
  const value = (await db.get("settings", "tts")) as TtsSettings | undefined;
  return value ?? DEFAULT_TTS_SETTINGS;
}

export async function saveTtsSettings(settings: TtsSettings): Promise<void> {
  const db = await getDb();
  await db.put("settings", settings, "tts");
}
