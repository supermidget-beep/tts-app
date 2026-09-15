// Chrome's Android share sheet doesn't always populate the share target's
// `url` field cleanly — depending on the page and Android version, the
// link can arrive in `text` (sometimes mixed with a title), in `url`, or
// split across both. Pull the first http(s) URL out of whatever we got.

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

export function extractSharedUrl(params: {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}): string | null {
  for (const value of [params.url, params.text, params.title]) {
    if (!value) continue;
    const match = value.match(URL_RE);
    if (match) {
      // Trim common trailing punctuation that ends up glued to the URL
      // when it was embedded in a sentence.
      return match[0].replace(/[.,;:!?)]+$/, "");
    }
  }
  return null;
}
