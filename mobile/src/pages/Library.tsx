import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteBook, listBooks, setFavorite, type BookRecord } from "../lib/storage";
import { relativeTime } from "../lib/relativeTime";

export function Library() {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    listBooks().then(setBooks);
  }, []);

  const openUrl = (url: string) => {
    navigate(`/reader?url=${encodeURIComponent(url)}`);
  };

  const handleRemove = async (id: string) => {
    await deleteBook(id);
    setBooks((prev) => prev.filter((b) => b.id !== id));
  };

  const handleToggleFavorite = async (book: BookRecord) => {
    const wasFavorite = book.favorite ?? false;
    // Optimistic update, then re-sort the same way listBooks() does
    // (favorites first, most-recently-read first within each group).
    setBooks((prev) =>
      prev
        .map((b) => (b.id === book.id ? { ...b, favorite: !wasFavorite } : b))
        .sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false)),
    );
    await setFavorite(book.id, !wasFavorite);
  };

  return (
    <div className="page">
      <header className="library-header">
        <h1>Wuxia Reader</h1>
        <button type="button" onClick={() => navigate("/settings")} aria-label="Settings">
          ⚙
        </button>
      </header>

      <form
        className="manual-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (manualUrl.trim()) openUrl(manualUrl.trim());
        }}
      >
        <input
          type="url"
          placeholder="Paste a chapter link…"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
        />
        <button type="submit">Open</button>
      </form>

      {books.length === 0 ? (
        <p className="status">
          Nothing here yet. Share a chapter link from Chrome using "Wuxia Reader" in the
          share sheet, or paste a link above.
        </p>
      ) : (
        <ul className="book-list">
          {books.map((book) => (
            <li key={book.id} className="book-item">
              <button
                type="button"
                className="book-favorite"
                onClick={() => handleToggleFavorite(book)}
                aria-label={book.favorite ? `Unfavorite ${book.title}` : `Favorite ${book.title}`}
                aria-pressed={book.favorite ?? false}
              >
                {book.favorite ? "★" : "☆"}
              </button>
              <button type="button" className="book-open" onClick={() => openUrl(book.currentUrl)}>
                <span className="book-title">{book.title}</span>
                <span className="book-sub">{book.currentTitle}</span>
                <span className="book-meta">
                  Last read {relativeTime(book.updatedAt)}
                  {book.chapters ? ` · ${book.chapters.length} chapters found` : ""}
                </span>
              </button>
              <button
                type="button"
                className="book-remove"
                onClick={() => handleRemove(book.id)}
                aria-label={`Remove ${book.title}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
