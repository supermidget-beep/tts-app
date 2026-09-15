// Heuristics for spotting "next chapter" / "previous chapter" / "table of contents"
// links on wuxia/light-novel reading sites. These sites don't share a common
// template, so we match on link text, rel attributes, and common class/id names.

export const NEXT_TEXT_RE =
  /^\s*(next\s*chapter|next\s*ch\.?|next|下一[章节篇]|下一话|»|>>|→)\s*$/i;
export const PREV_TEXT_RE =
  /^\s*(prev(ious)?\s*chapter|prev(ious)?\s*ch\.?|prev(ious)?|上一[章节篇]|上一话|«|<<|←)\s*$/i;
export const TOC_TEXT_RE =
  /(table of contents|chapter list|all chapters|full chapter list|chapter index|novel index|目录|章节目录|章节列表)/i;

export const NEXT_ATTR_RE = /(^|[\s_-])next([\s_-]|$)/i;
export const PREV_ATTR_RE = /(^|[\s_-])prev(ious)?([\s_-]|$)/i;
export const TOC_ATTR_RE = /(toc|chapter[-_]?list|chapter[-_]?index|catalog)/i;

// Matches URLs / link text that look like a chapter entry, e.g.
// "Chapter 12", "Ch. 12", "c12", "/chapter-12/", "第12章".
export const CHAPTER_LIKE_RE =
  /(chapter|^ch\.?\s*\d|第\s*[\d一二三四五六七八九十百千]+\s*[章节话回])/i;

export function looksLikeChapterText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (CHAPTER_LIKE_RE.test(t)) return true;
  // Bare numbers like "12" or "Ep 12" inside a list of many similar siblings
  // are handled by the caller (sibling-density check), not here.
  return false;
}
