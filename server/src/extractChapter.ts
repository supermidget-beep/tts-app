import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import {
  NEXT_TEXT_RE,
  PREV_TEXT_RE,
  TOC_TEXT_RE,
  NEXT_ATTR_RE,
  PREV_ATTR_RE,
  TOC_ATTR_RE,
} from "./linkHeuristics.js";

export interface ChapterResult {
  title: string;
  siteName: string | null;
  sourceUrl: string;
  paragraphs: string[];
  nextUrl: string | null;
  prevUrl: string | null;
  tocUrl: string | null;
}

// Elements that are essentially always ads/chrome/junk, safe to strip before
// Readability scores the page. Kept conservative so we don't nuke real content.
const JUNK_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "ins.adsbygoogle",
  "[id*='google_ads']",
  "[class*='adsbygoogle']",
  "[class*='advertisement' i]",
  "[id*='advertisement' i]",
  "[class~='ads']",
  "[id~='ads']",
  "[class*='banner-ad' i]",
  "[class*='sponsor' i]",
  ".share-buttons",
  ".social-share",
  ".comments",
  "#comments",
  ".disqus",
  "#disqus_thread",
  "form",
  "button",
].join(",");

// Boilerplate lines that some free chapter-aggregator sites inject into the
// article body itself (not just around it), e.g. "Read this chapter at
// FooNovel.com first!". These aren't real ads (no <ins>/<iframe>) so
// Readability keeps them; strip by text pattern instead.
const JUNK_LINE_RE =
  /(^\s*(advertisement|sponsored( content)?|ads?)\s*:?\s*$|read (the )?latest chapters?|please read this chapter|read this chapter (at|on)|visit .* (for|to read)|stolen from|find this and other great novels|support the (author|translator) by reading|bookmark (this|our) (site|page)|this chapter is (updated|translated) by|report ((any )?missing chapters|chapter errors?))/i;

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

interface LinkCandidate {
  href: string;
  score: number;
}

function findNavLink(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  textRe: RegExp,
  attrRe: RegExp,
): string | null {
  const candidates = new Map<string, number>();

  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = resolveUrl($el.attr("href"), baseUrl);
    if (!href || href === baseUrl) return;

    const text = $el.text().trim();
    const rel = ($el.attr("rel") ?? "").toLowerCase();
    const cls = ($el.attr("class") ?? "").toLowerCase();
    const id = ($el.attr("id") ?? "").toLowerCase();
    const aria = ($el.attr("aria-label") ?? "").toLowerCase();

    let score = 0;
    if (rel === "next" || rel === "prev") score += 5;
    if (textRe.test(text)) score += 4;
    if (attrRe.test(cls) || attrRe.test(id)) score += 3;
    if (attrRe.test(aria)) score += 2;
    if (score === 0) return;

    candidates.set(href, Math.max(candidates.get(href) ?? 0, score));
  });

  let best: LinkCandidate | null = null;
  for (const [href, score] of candidates) {
    if (!best || score > best.score) best = { href, score };
  }
  return best?.href ?? null;
}

function findTocLink($: cheerio.CheerioAPI, baseUrl: string): string | null {
  return findNavLink($, baseUrl, TOC_TEXT_RE, TOC_ATTR_RE);
}

function cleanParagraphs(html: string): string[] {
  const $ = cheerio.load(html);
  $(JUNK_SELECTORS).remove();

  const paragraphs: string[] = [];
  $("p, h1, h2, h3, h4, blockquote, li").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    if (JUNK_LINE_RE.test(text)) return;
    if (text.length < 2) return;
    paragraphs.push(text);
  });

  // Some pages render every line as its own <br>-separated text node inside
  // a single <p>/<div> instead of separate paragraphs; fall back to that.
  if (paragraphs.length === 0) {
    const text = $.root().text();
    for (const line of text.split(/\n+/)) {
      const t = line.replace(/\s+/g, " ").trim();
      if (t && !JUNK_LINE_RE.test(t)) paragraphs.push(t);
    }
  }

  return paragraphs;
}

export function extractChapter(html: string, sourceUrl: string): ChapterResult {
  const $orig = cheerio.load(html);
  const nextUrl = findNavLink($orig, sourceUrl, NEXT_TEXT_RE, NEXT_ATTR_RE);
  const prevUrl = findNavLink($orig, sourceUrl, PREV_TEXT_RE, PREV_ATTR_RE);
  const tocUrl = findTocLink($orig, sourceUrl);

  const dom = new JSDOM(html, { url: sourceUrl });
  dom.window.document.querySelectorAll(JUNK_SELECTORS).forEach((el) => el.remove());

  const reader = new Readability(dom.window.document, { keepClasses: false });
  const article = reader.parse();

  const title =
    article?.title?.trim() || $orig("title").first().text().trim() || "Untitled chapter";
  const siteName = article?.siteName ?? null;
  const paragraphs = article?.content
    ? cleanParagraphs(article.content)
    : cleanParagraphs($orig("body").html() ?? "");

  return {
    title,
    siteName,
    sourceUrl,
    paragraphs,
    nextUrl: nextUrl === sourceUrl ? null : nextUrl,
    prevUrl: prevUrl === sourceUrl ? null : prevUrl,
    tocUrl,
  };
}
