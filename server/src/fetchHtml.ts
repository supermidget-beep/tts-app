const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

export class FetchError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function assertSafeUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("Only http/https URLs are supported", 400);
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new FetchError("Refusing to fetch local/internal addresses", 400);
  }
}

export async function fetchHtml(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError("Invalid URL", 400);
  }
  assertSafeUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      throw new FetchError(`Upstream site returned ${res.status}`, 502);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      throw new FetchError("URL did not return an HTML page", 415);
    }
    const html = await res.text();
    return { html, finalUrl: res.url || rawUrl };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new FetchError("Timed out fetching the page", 504);
    }
    throw new FetchError(`Failed to fetch page: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}
