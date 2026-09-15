// Injected (together with readability.js) into the hidden extraction
// WebView after a chapter/TOC page has finished loading for real (JS
// executed, any Cloudflare-style challenge already solved by the WebView
// itself). Ported from server/src/{extractChapter,extractToc,linkHeuristics}.ts,
// using live DOM APIs instead of cheerio since a real document is available
// here. Defines window.__wuxiaExtractChapter / __wuxiaExtractToc; the
// final line of the injected script calls one of them so its return value
// becomes the evaluateJavascript() result.
(function (global) {
  const JUNK_SELECTORS =
    "script, style, noscript, iframe, ins.adsbygoogle, [id*='google_ads'], " +
    "[class*='adsbygoogle'], [class*='advertisement' i], [id*='advertisement' i], " +
    "[class~='ads'], [id~='ads'], [class*='banner-ad' i], [class*='sponsor' i], " +
    ".share-buttons, .social-share, .comments, #comments, .disqus, #disqus_thread, form, button";

  const JUNK_LINE_RE =
    /(^\s*(advertisement|sponsored( content)?|ads?)\s*:?\s*$|read (the )?latest chapters?|please read this chapter|read this chapter (at|on)|visit .* (for|to read)|stolen from|find this and other great novels|support the (author|translator) by reading|bookmark (this|our) (site|page)|this chapter is (updated|translated) by|report ((any )?missing chapters|chapter errors?))/i;

  const NEXT_TEXT_RE = /^\s*(next\s*chapter|next\s*ch\.?|next|下一[章节篇]|下一话|»|>>|→)\s*$/i;
  const PREV_TEXT_RE = /^\s*(prev(ious)?\s*chapter|prev(ious)?\s*ch\.?|prev(ious)?|上一[章节篇]|上一话|«|<<|←)\s*$/i;
  const TOC_TEXT_RE = /(table of contents|chapter list|all chapters|full chapter list|chapter index|novel index|目录|章节目录|章节列表)/i;
  const NEXT_ATTR_RE = /(^|[\s_-])next([\s_-]|$)/i;
  const PREV_ATTR_RE = /(^|[\s_-])prev(ious)?([\s_-]|$)/i;
  const TOC_ATTR_RE = /(toc|chapter[-_]?list|chapter[-_]?index|catalog)/i;
  const CHAPTER_LIKE_RE = /(chapter|^ch\.?\s*\d|第\s*[\d一二三四五六七八九十百千]+\s*[章节话回])/i;

  function looksLikeChapterText(text) {
    const t = (text || "").trim();
    return t ? CHAPTER_LIKE_RE.test(t) : false;
  }

  function resolveUrl(href, base) {
    if (!href) return null;
    try {
      const u = new URL(href, base);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      u.hash = "";
      return u.toString();
    } catch (e) {
      return null;
    }
  }

  function findNavLink(root, baseUrl, textRe, attrRe) {
    const anchors = root.querySelectorAll("a[href]");
    const candidates = new Map();
    anchors.forEach((el) => {
      const href = resolveUrl(el.getAttribute("href"), baseUrl);
      if (!href || href === baseUrl) return;
      const text = (el.textContent || "").trim();
      const rel = (el.getAttribute("rel") || "").toLowerCase();
      const cls = (el.getAttribute("class") || "").toLowerCase();
      const id = (el.getAttribute("id") || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      let score = 0;
      if (rel === "next" || rel === "prev") score += 5;
      if (textRe.test(text)) score += 4;
      if (attrRe.test(cls) || attrRe.test(id)) score += 3;
      if (attrRe.test(aria)) score += 2;
      if (score === 0) return;
      candidates.set(href, Math.max(candidates.get(href) || 0, score));
    });
    let best = null;
    let bestScore = -1;
    candidates.forEach((score, href) => {
      if (score > bestScore) {
        bestScore = score;
        best = href;
      }
    });
    return best;
  }

  function cleanParagraphs(html) {
    const container = document.createElement("div");
    container.innerHTML = html;
    container.querySelectorAll(JUNK_SELECTORS).forEach((el) => el.remove());
    const paragraphs = [];
    container.querySelectorAll("p, h1, h2, h3, h4, blockquote, li").forEach((el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length < 2 || JUNK_LINE_RE.test(text)) return;
      paragraphs.push(text);
    });
    if (paragraphs.length === 0) {
      const text = container.textContent || "";
      text.split(/\n+/).forEach((line) => {
        const t = line.replace(/\s+/g, " ").trim();
        if (t && !JUNK_LINE_RE.test(t)) paragraphs.push(t);
      });
    }
    return paragraphs;
  }

  global.__wuxiaExtractChapter = function () {
    const baseUrl = document.baseURI || location.href;
    const nextUrl = findNavLink(document, baseUrl, NEXT_TEXT_RE, NEXT_ATTR_RE);
    const prevUrl = findNavLink(document, baseUrl, PREV_TEXT_RE, PREV_ATTR_RE);
    const tocUrl = findNavLink(document, baseUrl, TOC_TEXT_RE, TOC_ATTR_RE);

    document.querySelectorAll(JUNK_SELECTORS).forEach((el) => el.remove());

    let title = document.title || "Untitled chapter";
    let siteName = null;
    let paragraphs = [];
    try {
      const reader = new Readability(document, { keepClasses: false });
      const article = reader.parse();
      if (article) {
        title = article.title || title;
        siteName = article.siteName || null;
        paragraphs = cleanParagraphs(article.content || "");
      }
    } catch (e) {
      // Fall through to the plain-body fallback below.
    }
    if (paragraphs.length === 0) {
      paragraphs = cleanParagraphs(document.body ? document.body.innerHTML : "");
    }

    return {
      title: title,
      siteName: siteName,
      sourceUrl: baseUrl,
      paragraphs: paragraphs,
      nextUrl: nextUrl === baseUrl ? null : nextUrl,
      prevUrl: prevUrl === baseUrl ? null : prevUrl,
      tocUrl: tocUrl,
    };
  };

  global.__wuxiaExtractToc = function () {
    const baseUrl = document.baseURI || location.href;
    const groups = new Map();
    let order = 0;
    document.querySelectorAll("a[href]").forEach((el) => {
      const href = resolveUrl(el.getAttribute("href"), baseUrl);
      if (!href || href === baseUrl) return;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      let shape;
      try {
        shape = new URL(href).pathname.replace(/\d+/g, "#");
      } catch (e) {
        shape = href;
      }
      const list = groups.get(shape) || [];
      list.push({ url: href, text: text, order: order++ });
      groups.set(shape, list);
    });

    let bestShape = null;
    let bestScore = -1;
    groups.forEach((entries, shape) => {
      if (entries.length < 3) return;
      const dedup = new Map(entries.map((e) => [e.url, e]));
      let chapterLike = 0;
      dedup.forEach((e) => {
        if (looksLikeChapterText(e.text)) chapterLike++;
      });
      const score = dedup.size + chapterLike * 2;
      if (score > bestScore) {
        bestScore = score;
        bestShape = shape;
      }
    });

    const chapters = [];
    if (bestShape) {
      const seen = new Set();
      const entries = groups.get(bestShape).slice().sort((a, b) => a.order - b.order);
      entries.forEach((e) => {
        if (seen.has(e.url)) return;
        seen.add(e.url);
        chapters.push({ title: e.text, url: e.url });
      });
    }

    return {
      title: document.title || "Table of contents",
      sourceUrl: baseUrl,
      chapters: chapters,
    };
  };
})(window);
