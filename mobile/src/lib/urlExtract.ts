// Chrome's Android share sheet doesn't always populate a share cleanly --
// depending on the sharing app, the link can arrive mixed into a longer
// text blob (title + URL, a sentence, etc). Pull the first http(s) URL
// out of whatever text was shared.
const URL_RE = /https?:\/\/[^\s<>"')]+/i;

export function extractSharedUrl(params: { text?: string | null }): string | null {
  const value = params.text;
  if (!value) return null;
  const match = value.match(URL_RE);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)]+$/, "");
}
