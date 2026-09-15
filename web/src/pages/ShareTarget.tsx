import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { extractSharedUrl } from "../lib/urlExtract";

// Landing page for Android's share sheet (registered via manifest
// share_target). Chrome GETs this route with whatever the sharing app
// supplied; we pull a URL out of it and bounce straight into the reader.
export function ShareTarget() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = extractSharedUrl({
      url: searchParams.get("url"),
      text: searchParams.get("text"),
      title: searchParams.get("title"),
    });
    if (url) {
      navigate(`/reader?url=${encodeURIComponent(url)}&autoplay=1`, { replace: true });
    } else {
      setError("Couldn't find a link in what was shared.");
    }
  }, [searchParams, navigate]);

  return (
    <div className="page status">
      {error ? (
        <>
          <p>{error}</p>
          <button type="button" onClick={() => navigate("/")}>
            Back to library
          </button>
        </>
      ) : (
        <p>Opening shared chapter…</p>
      )}
    </div>
  );
}
