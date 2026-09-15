# Wuxia Reader

Listen to wuxia (and other web-novel) chapters read aloud on your phone.
Share a chapter link from Chrome on Android straight into the app; it
strips ads/boilerplate down to just the story, reads it aloud with
adjustable speed/pitch/voice, and automatically moves on to the next
chapter when the current one finishes.

Built as an installable Android web app (PWA), because that's the only
way for "share from Chrome into an app" to work without an Android
developer account, Kotlin/Java build toolchain, and Play Store listing.
See [Platform notes](#platform-notes) below if you also want an iOS
version.

## How it works

```
Chrome "Share" → PWA share target → backend extractor → reader (Web Speech API)
```

- **`server/`** — a small Express API. Given a chapter URL, it fetches the
  page, strips ads/scripts/share-buttons/comments, runs
  [Readability](https://github.com/mozilla/readability) to pull out just
  the article text, and scans the page's links for a "next chapter",
  "previous chapter", and "table of contents" link using text/class/rel
  heuristics (works across sites without needing per-site scrapers). It
  also has a `/api/toc` endpoint that, given a table-of-contents page,
  finds the largest group of similarly-shaped chapter links to build a
  full chapter list.
- **`web/`** — a React + Vite Progressive Web App. It registers as a
  Chrome **share target** (via the manifest's `share_target`), so once
  installed to your home screen it shows up as a destination in Android's
  share sheet. Reading uses the browser's built-in `speechSynthesis` API
  (no server-side TTS, no API keys, works offline once a chapter is
  loaded). Your library (which novels you've read, how far, and each
  novel's chapter list) is stored locally on-device in IndexedDB — nothing
  is synced to a server.

## Features

- Share a chapter link from Chrome → opens straight into the reader
- Ads, scripts, share buttons, comment sections, and common
  aggregator-site boilerplate ("Read the latest chapters at...") are
  stripped before reading
- Play/pause, skip forward/back one paragraph, previous/next chapter
- Speed (0.5x–3x) and pitch (0–2) sliders, plus a voice picker (uses
  whatever TTS voices are installed on the phone)
- Auto-advances to the next chapter the moment the current one finishes
  reading
- Automatically discovers a novel's full chapter list (from a "table of
  contents" link on the page) and lets you jump to any chapter
- A local library of everything you've opened, with your last-read
  chapter remembered per novel
- Paste-a-link fallback in the library for desktop testing or when the
  share sheet isn't available

## Repo layout

```
server/   Express + TypeScript extraction API
web/      Vite + React + TypeScript PWA
```

## Running locally

Requires Node 20+.

```bash
npm install          # installs both workspaces
npm run dev          # runs the API (port 8787) and the web app (port 5173) together
```

Open `http://localhost:5173`. The web app is configured (via
`web/.env.development`) to call the API at `http://localhost:8787` in dev.

Try it without a phone: paste a chapter URL into the library's "Paste a
chapter link…" box, or manually build a share-target URL like
`http://localhost:5173/share-target?url=<encoded chapter URL>`.

## Deploying

Two things need to be hosted, on two different services (this repo is
already wired up for a specific free pair — Render + GitHub Pages — so
this should mostly be pushing buttons rather than configuring things):

### 1. Backend (`server/`) → Render

[`render.yaml`](./render.yaml) is a Render "blueprint" that deploys the
backend with no manual configuration. Click:

**[Deploy to Render](https://render.com/deploy?repo=https://github.com/supermidget-beep/tts-app)**

Sign in with GitHub (free), confirm the branch (`claude/wuxia-tts-reader-app-wtsz9b`,
unless it's since been merged to `main`), and click **Apply**. Render
builds and starts the backend and gives it a URL like
`https://wuxia-tts-reader-api.onrender.com` (or the same with a random
suffix if that exact name is taken). Note the URL — you'll enter it into
the app in the last step. The free plan sleeps after inactivity, so the
first request after a while takes ~30–60s to wake it back up.

### 2. Web app (`web/`) → GitHub Pages

A workflow ([`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml))
already builds and deploys `web/` to GitHub Pages on every push. One-time
setup: in this repo, go to **Settings → Pages → Build and deployment →
Source**, and select **GitHub Actions**. After that (and after the
workflow has run once, from Actions tab, or automatically on the next
push), the app is live at:

```
https://supermidget-beep.github.io/tts-app/
```

(GitHub Pages project sites live under `/<repo-name>/`, not the domain
root — the app is already configured for that.) It's served over HTTPS
automatically, which installability and the share target both require.

The workflow bakes in `https://wuxia-tts-reader-api.onrender.com` as the
backend URL by default. If Render gave you a different URL (a name
collision added a suffix), open the installed app → **Settings** and
paste the real URL into **Backend server URL** — this is read at runtime
from on-device storage, so no redeploy is needed to fix it.

### Deploying somewhere else instead

Any Node host works for the backend (Fly.io, Railway, a VPS, ...):
`npm run build:server && node server/dist/index.js` (reads `PORT`,
defaults to 8787). Any static host with **SPA fallback routing** (rewrite
unmatched paths to `index.html`) works for the web app — `web/public/_redirects`
(Netlify/Cloudflare Pages) and `web/vercel.json` (Vercel) are already set
up; for Nginx, add `try_files $uri /index.html;`. If it's not served under
a subpath, build with `npm run build:web` as-is; under a subpath, set
`VITE_BASE_PATH=/your-subpath/` first. Either way, the backend URL can
always be set/changed afterwards from the app's Settings page — you don't
have to get it right at build time.

## Installing on Android

1. Open `https://supermidget-beep.github.io/tts-app/` in Chrome on Android.
2. Chrome's menu → **Add to Home screen** (or **Install app**). This is
   what registers it as a share target — a page you've only visited,
   without installing, won't show up in the share sheet.
3. Open the app once from the home screen and check **Settings** → the
   backend server URL should already be filled in (from the build
   default); fix it there if Render gave your backend a different URL.
4. In Chrome, open any chapter of a novel, tap **Share**, and choose
   **Wuxia Reader** from the list of apps/targets. It opens straight into
   the reader and starts reading.

If it doesn't appear in the share sheet: confirm the app was actually
installed (check the home screen icon, not just a bookmark), and that the
site is served over HTTPS with a valid manifest (`chrome://apps` or
DevTools → Application → Manifest can help debug this if you're on
desktop Chrome with USB debugging).

## Tuning extraction for a site that doesn't parse well

The next/prev/table-of-contents detection is heuristic (`server/src/linkHeuristics.ts`)
— it looks for link text like "Next Chapter", `rel="next"`, or class/id
names containing "next"/"prev"/"toc". If a particular site uses unusual
wording, add a pattern to the relevant regex there. Ad/junk stripping
(`server/src/extractChapter.ts`) has a `JUNK_SELECTORS` list (CSS
selectors removed before parsing) and a `JUNK_LINE_RE` (text patterns
dropped from the extracted paragraphs, for junk lines aggregator sites
sometimes inject directly into the article body); extend either if a
site slips something through.

## Limitations

- **Android only.** iOS Safari has no equivalent of the Web Share Target
  API — see [Platform notes](#platform-notes).
- Extraction is heuristic, not per-site scrapers, so it won't be perfect
  on every site; see the tuning section above.
- The backend fetches pages server-side and refuses to fetch
  localhost/private-network addresses (basic SSRF protection) — this is
  intentional and shouldn't affect normal use.
- Reading uses the phone's on-device TTS voices via the Web Speech API;
  voice quality/selection depends on what's installed on the device, not
  on this app.

## Platform notes

This was built for Android because that's the platform where "share a
link from Chrome into an installed app" is achievable as a web app (via
the [Web Share Target API](https://w3c.github.io/web-share-target/)),
fully buildable, testable, and deployable without native tooling.

iOS Safari doesn't implement Web Share Target at all — there's no way for
a web app to appear in iOS's native share sheet. Supporting iOS would
mean building a native app with a **Share Extension** in Swift/Xcode,
signed with an Apple Developer account, which requires a Mac and can't be
built, run, or tested from this environment. The backend extraction API
is platform-agnostic, so it could be reused as-is by a future native iOS
client if you want to pursue that separately.
