import * as cheerio from "cheerio";
import { looksLikeChapterText } from "./linkHeuristics.js";

export interface TocChapter {
  title: string;
  url: string;
}

export interface TocResult {
  title: string;
  sourceUrl: string;
  chapters: TocChapter[];
}

function resolveUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

// A table-of-contents page is usually a long list of very similarly-shaped
// links (same parent tag, similar href pattern) whose text looks like
// chapter titles. We group anchors by their parent element and by a
// "shape" derived from their href (path with digits collapsed), then pick
// the largest group that looks chapter-like.
function hrefShape(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\d+/g, "#");
  } catch {
    return url;
  }
}

export function extractToc(html: string, sourceUrl: string): TocResult {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav header, footer").remove();

  const title = $("title").first().text().trim() || "Table of contents";

  interface Entry {
    url: string;
    text: string;
    order: number;
  }

  const groups = new Map<string, Entry[]>();
  let order = 0;

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const url = resolveUrl($el.attr("href"), sourceUrl);
    if (!url || url === sourceUrl) return;
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (!text) return;

    const shape = hrefShape(url);
    const list = groups.get(shape) ?? [];
    list.push({ url, text, order: order++ });
    groups.set(shape, list);
  });

  let bestShape: string | null = null;
  let bestScore = -1;
  for (const [shape, entries] of groups) {
    if (entries.length < 3) continue; // a real chapter list has many entries
    const dedup = new Map(entries.map((e) => [e.url, e]));
    const chapterLike = [...dedup.values()].filter((e) => looksLikeChapterText(e.text)).length;
    // Score favors groups that are both large and mostly chapter-like text.
    const score = dedup.size + chapterLike * 2;
    if (score > bestScore) {
      bestScore = score;
      bestShape = shape;
    }
  }

  if (!bestShape) {
    return { title, sourceUrl, chapters: [] };
  }

  const entries = groups.get(bestShape)!;
  const seen = new Set<string>();
  const chapters: TocChapter[] = [];
  for (const e of entries.sort((a, b) => a.order - b.order)) {
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    chapters.push({ title: e.text, url: e.url });
  }

  return { title, sourceUrl, chapters };
}
