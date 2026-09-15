import { registerPlugin } from "@capacitor/core";

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

interface ChapterExtractorPlugin {
  extractChapter(options: { url: string }): Promise<ChapterData>;
  extractToc(options: { url: string }): Promise<TocData>;
}

// Backed by android/.../ChapterExtractorPlugin.kt: loads the URL in a
// hidden native WebView (a real browser engine, so it solves anti-bot JS
// challenges the same way the user's own Chrome would) and runs
// Readability + our link heuristics inside that loaded page.
const ChapterExtractor = registerPlugin<ChapterExtractorPlugin>("ChapterExtractor");

export function fetchChapter(url: string): Promise<ChapterData> {
  return ChapterExtractor.extractChapter({ url });
}

export function fetchToc(url: string): Promise<TocData> {
  return ChapterExtractor.extractToc({ url });
}
