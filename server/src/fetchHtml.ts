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

// A 403 here is almost always a firewall/anti-bot product blocking this
// server's IP or TLS/HTTP fingerprint outright, not a broken URL -- the
// same request from a real browser (different IP, real TLS stack)
// typically works fine, and no amount of request-header tweaking can get
// past an IP-reputation block or a JS challenge. Surface enough of the
// block response (which vendor, headers, a body snippet) that it's
// possible to tell those apart from a simpler, possibly-fixable block.
async function describeBlock(res: Response): Promise<string> {
  const server = res.headers.get("server") ?? "";
  const via = res.headers.get("via") ?? "";
  const cfRay = res.headers.get("cf-ray");
  const bodySnippet = (await res.text().catch(() => ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

  let vendor = "an unidentified firewall/anti-bot service";
  if (cfRay || /cloudflare/i.test(server) || /checking your browser|cf-browser-verification|attention required/i.test(bodySnippet)) {
    vendor = "Cloudflare";
  } else if (/sucuri/i.test(server) || /sucuri/i.test(bodySnippet)) {
    vendor = "Sucuri";
  } else if (/akamaighost/i.test(server)) {
    vendor = "Akamai";
  } else if (res.headers.has("x-iinfo") || /incapsula/i.test(bodySnippet)) {
    vendor = "Imperva/Incapsula";
  }

  const details = [
    server && `server="${server}"`,
    cfRay && `cf-ray="${cfRay}"`,
    via && `via="${via}"`,
    bodySnippet && `body="${bodySnippet}"`,
  ]
    .filter(Boolean)
    .join(" | ");

  return `That site is blocking this server (403, likely ${vendor}). ${details}`;
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
        throw new FetchError(await describeBlock(res), 502);
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
