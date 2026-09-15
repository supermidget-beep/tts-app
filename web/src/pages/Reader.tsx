import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchChapter, fetchToc, NoApiBaseError, type ChapterData, type TocChapter } from "../lib/api";
import { TtsController, getVoices, type PlaybackState } from "../lib/tts";
import { saveBookChapters, updateBookPosition, upsertBookFromChapter } from "../lib/storage";
import { useTtsSettings } from "../lib/useTtsSettings";
import { PlayerBar } from "../components/PlayerBar";

export function Reader() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialUrl = searchParams.get("url");
  const autoplayParam = searchParams.get("autoplay") === "1";

  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [chapters, setChapters] = useState<TocChapter[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [currentParagraph, setCurrentParagraph] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const { settings, update: updateSettings, loaded: settingsLoaded } = useTtsSettings();
  const controllerRef = useRef<TtsController | null>(null);
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  // Plain ref (not React state) so onChapterEnd reads the latest chapter
  // without going through a setState updater function — React 18 Strict
  // Mode double-invokes updater functions in dev, which would otherwise
  // fire the chapter-advance side effect twice per real completion.
  const chapterRef = useRef<ChapterData | null>(null);
  // Tracks which library entry this reading session belongs to. Kept as a
  // ref (not just derived fresh each load) so auto-advance/next/prev/TOC-
  // jump always update the SAME entry -- re-deriving a book id from each
  // chapter's own page (bookIdFromChapter, via its next/prev/toc link
  // detection) isn't perfectly consistent chapter to chapter, and doing
  // that on every load risked silently splitting one novel into two
  // library rows and dropping a favorite set on the first one.
  const bookIdRef = useRef<string | null>(null);

  // Create the controller once settings have loaded from IndexedDB.
  useEffect(() => {
    if (!settingsLoaded || controllerRef.current) return;
    controllerRef.current = new TtsController(settings.rate, settings.pitch, {
      onStateChange: setPlaybackState,
      onParagraphChange: setCurrentParagraph,
      onChapterEnd: () => {
        const nextUrl = chapterRef.current?.nextUrl;
        if (nextUrl) void loadChapter(nextUrl, { autoplay: true, push: true });
      },
      onError: (message) => setError(message),
    });
  }, [settingsLoaded, settings.rate, settings.pitch]);

  useEffect(() => {
    getVoices().then(setVoices);
  }, []);

  useEffect(() => {
    if (!settingsLoaded || !controllerRef.current) return;
    const voice = settings.voiceURI ? voices.find((v) => v.voiceURI === settings.voiceURI) ?? null : null;
    controllerRef.current.setVoice(voice);
  }, [settings.voiceURI, voices, settingsLoaded]);

  const loadChapter = useCallback(
    async (url: string, opts: { autoplay: boolean; push: boolean }) => {
      setLoading(true);
      setError(null);
      setNeedsSetup(false);
      try {
        const data = await fetchChapter(url);
        chapterRef.current = data;
        setChapter(data);
        setCurrentParagraph(0);

        const knownBookId = bookIdRef.current;
        const book = knownBookId
          ? ((await updateBookPosition(knownBookId, data.sourceUrl, data.title)) ??
            (await upsertBookFromChapter(data)))
          : await upsertBookFromChapter(data);
        bookIdRef.current = book.id;
        setChapters(book.chapters);

        controllerRef.current?.loadParagraphs(data.paragraphs, 0);
        if (opts.autoplay) controllerRef.current?.play();

        if (opts.push) {
          // Update the address bar directly (not via react-router's
          // navigate/useSearchParams) so this doesn't re-trigger the
          // mount effect below, which reads the URL's `url`/`autoplay`
          // params and would otherwise reload this same chapter a
          // second time, minus autoplay, on every chapter advance.
          window.history.replaceState(
            null,
            "",
            `${import.meta.env.BASE_URL}reader?url=${encodeURIComponent(url)}`,
          );
        }

        if (data.tocUrl && !book.chapters) {
          fetchToc(data.tocUrl)
            .then((toc) => {
              if (toc.chapters.length > 0) {
                setChapters(toc.chapters);
                void saveBookChapters(book.id, toc.chapters);
              }
            })
            .catch(() => {
              // Table of contents is a nice-to-have; ignore failures.
            });
        }
      } catch (err) {
        setError((err as Error).message);
        if (err instanceof NoApiBaseError) setNeedsSetup(true);
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  const loadedInitialUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialUrl || loadedInitialUrlRef.current === initialUrl) return;
    loadedInitialUrlRef.current = initialUrl;
    void loadChapter(initialUrl, { autoplay: autoplayParam, push: false });
    // Only run for the URL we mounted with; subsequent chapter changes go
    // through loadChapter() directly so we don't re-fetch on our own
    // navigate(replace) calls. The ref guard also protects against React
    // Strict Mode's dev-only double-invocation of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  useEffect(() => {
    paragraphRefs.current[currentParagraph]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentParagraph]);

  if (!initialUrl) {
    return (
      <div className="page">
        <p>No chapter URL given.</p>
      </div>
    );
  }

  return (
    <div className="page reader-page">
      <header className="reader-header">
        <button type="button" className="back-link" onClick={() => navigate("/")}>
          ← Library
        </button>
        {chapters && chapters.length > 0 && (
          <select
            className="chapter-jump"
            value={chapter?.sourceUrl ?? ""}
            onChange={(e) => {
              const wasPlaying = playbackState === "playing";
              void loadChapter(e.target.value, { autoplay: wasPlaying, push: true });
            }}
          >
            {chapters.map((c) => (
              <option key={c.url} value={c.url}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </header>

      {loading && <p className="status">Loading chapter…</p>}
      {error && (
        <div className="status error">
          <p>{error}</p>
          {needsSetup ? (
            <button type="button" onClick={() => navigate("/settings")}>
              Go to Settings
            </button>
          ) : (
            <>
              <button type="button" onClick={() => initialUrl && loadChapter(chapter?.sourceUrl ?? initialUrl, { autoplay: false, push: false })}>
                Retry
              </button>
              <a href={chapter?.sourceUrl ?? initialUrl} target="_blank" rel="noreferrer">
                Open original page
              </a>
            </>
          )}
        </div>
      )}

      {chapter && !loading && (
        <>
          <h1>{chapter.title}</h1>
          <article className="chapter-text">
            {chapter.paragraphs.map((p, i) => (
              <p
                key={i}
                ref={(el) => {
                  paragraphRefs.current[i] = el;
                }}
                className={i === currentParagraph ? "current" : undefined}
                onClick={() => controllerRef.current?.jumpToParagraph(i)}
              >
                {p}
              </p>
            ))}
          </article>
        </>
      )}

      {chapter && (
        <PlayerBar
          state={playbackState}
          settings={settings}
          voices={voices}
          hasNext={Boolean(chapter.nextUrl)}
          hasPrev={Boolean(chapter.prevUrl)}
          onPlayPause={() => {
            if (playbackState === "playing") controllerRef.current?.pause();
            else controllerRef.current?.play();
          }}
          onSkipForward={() => controllerRef.current?.skipForward()}
          onSkipBackward={() => controllerRef.current?.skipBackward()}
          onNextChapter={() => chapter.nextUrl && loadChapter(chapter.nextUrl, { autoplay: playbackState === "playing", push: true })}
          onPrevChapter={() => chapter.prevUrl && loadChapter(chapter.prevUrl, { autoplay: playbackState === "playing", push: true })}
          onRateChange={(rate) => {
            updateSettings({ rate });
            controllerRef.current?.setRate(rate);
          }}
          onPitchChange={(pitch) => {
            updateSettings({ pitch });
            controllerRef.current?.setPitch(pitch);
          }}
          onVoiceChange={(voiceURI) => updateSettings({ voiceURI: voiceURI || null })}
        />
      )}
    </div>
  );
}
