const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const SEC_CH_UA =
  '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"';

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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        // A best-effort attempt to look like a real browser navigation to
        // anti-bot firewalls that gate on these headers (client hints,
        // fetch metadata, a same-site referer). This won't get past a
        // JS-challenge/IP-reputation block (see the comment on the 403
        // branch below), but it's a cheap, harmless thing to send.
        "sec-ch-ua": SEC_CH_UA,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        Referer: `${url.protocol}//${url.host}/`,
      },
    });
    if (!res.ok) {
      if (res.status === 403) {
        // Almost always an anti-bot firewall blocking this server's IP or
        // TLS/HTTP fingerprint outright, not a broken URL -- the same
        // request from a real browser (different IP, real TLS stack)
        // typically works fine. No amount of header tweaking here can
        // solve an IP-reputation block or a JS challenge.
        throw new FetchError(
          "That site is blocking automated requests (got a 403). It may not work through this reader even though it opens fine in your browser.",
          502,
        );
      }
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
