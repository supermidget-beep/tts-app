# Wuxia Reader (native Android app)

A native Android app (built with [Capacitor](https://capacitorjs.com/)) that
solves a problem the [web app](../web) can't: some sites sit behind an
anti-bot firewall (most visibly Cloudflare's "Just a moment..." JS
challenge) that blocks a plain server-side fetch outright, from any host,
no matter the request headers. That challenge can only be solved by
something that actually runs a browser and executes JavaScript.

So this app does exactly that: when you share a chapter link, it loads the
page in a real, hidden `WebView` on your own phone (a full Chromium
engine), lets it solve whatever challenge the site throws at it exactly
like your own Chrome would, then runs
[Readability](https://github.com/mozilla/readability) plus the same
next/prev/table-of-contents link heuristics as the backend — but injected
into that loaded page's own JavaScript context instead of running on a
server. There is no backend for this app; everything happens on-device.
Reading uses Android's native `TextToSpeech` engine instead of the Web
Speech API.

If the sites you read aren't behind that kind of protection, the [web
app](../web) is simpler to install (no sideloading) — use this one when a
site specifically doesn't work there.

## How it's built

- `src/` — the same React reader UI/pattern as `web/`: a Library
  (IndexedDB-backed, same schema), a Reader with the play/pause/speed/
  pitch/voice player bar, and Settings.
- `android/` — the native shell. Two custom Kotlin pieces beyond
  Capacitor's defaults:
  - `ChapterExtractorPlugin.kt` — creates a hidden `WebView`, loads a URL,
    waits for it to go quiet (a Cloudflare interstitial redirects to the
    real page after solving its own challenge, so a page can finish
    loading more than once), then injects `readability.js` +
    `extract.js` (both bundled as Android assets) and returns the result.
  - `MainActivity.kt` / `ShareReceiverPlugin.kt` — Android's native
    "Share" sheet (`ACTION_SEND` intent-filter) instead of the Web Share
    Target API the PWA uses.
  - TTS goes through `@capacitor-community/text-to-speech`, a thin wrapper
    over `android.speech.tts.TextToSpeech`.

## Getting the app onto your phone

This can't be built from a general dev sandbox that lacks the Android SDK
(`dl.google.com`, where it's downloaded from, is blocked in a lot of
network-restricted environments) — it's built by
[`.github/workflows/build-android.yml`](../.github/workflows/build-android.yml)
on GitHub's own runners instead, which produces a downloadable **debug**
APK (not signed for release/Play Store — fine for installing directly on
your own phone).

1. In this repo on GitHub, go to **Actions → Build Android APK** and open
   the latest successful run (it runs automatically on every push that
   touches `mobile/`, or trigger it manually with **Run workflow**).
2. Under **Artifacts**, download `wuxia-reader-debug-apk` (a zip
   containing `app-debug.apk`). You need to be signed in to GitHub to
   download workflow artifacts.
3. Transfer the `.apk` to your phone (e.g. via a cloud drive, or just open
   the GitHub Actions page in Chrome *on* your phone and download it
   there directly).
4. Tap the downloaded `.apk` file to install it. Android will prompt to
   allow installing from this source ("Install unknown apps") the first
   time — allow it for whichever app you used to open the file (Files,
   Chrome, etc). This is expected and normal for any app not from the
   Play Store.
5. Open **Wuxia Reader**, then in Chrome, open a chapter, tap **Share**,
   and choose **Wuxia Reader**.

Since it's a debug build, re-installing a newer APK over an older one
works fine (same debug signing key every build); you don't need to
uninstall first.

## Running/building locally

Only possible somewhere with the Android SDK installed (Android Studio
handles this automatically). Won't work in this dev sandbox.

```bash
npm install
npm run build --workspace mobile
cd mobile && npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Or open `mobile/android/` directly in Android Studio for a normal
edit/run/debug loop on an emulator or physical device.

## Known limitations

- Untested on a real device as of this writing — this was written and
  wired up without access to Android build tooling in the environment
  that built it, so the *first* real test of the native plugin, share
  handling, and TTS behavior is whatever you run into on your phone.
  Report back anything that doesn't work as expected.
- No custom app icon yet (Capacitor's default placeholder icon/splash
  screen).
- A hidden `WebView` still has to fully load each page (including
  waiting out a challenge's own delay, typically a few seconds), so
  opening a chapter is slower than the backend-fetch approach when a site
  *isn't* protected.
- Pausing playback can't resume mid-sentence — it resumes from the start
  of the current chunk (a sentence or so), the same granularity as the
  web app.
