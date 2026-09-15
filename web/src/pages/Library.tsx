import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteBook, listBooks, type BookRecord } from "../lib/storage";

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
          Nothing here yet. On Android, share a chapter link from Chrome using the "Wuxia
          Reader" option in the share sheet, or paste a link above.
        </p>
      ) : (
        <ul className="book-list">
          {books.map((book) => (
            <li key={book.id} className="book-item">
              <button type="button" className="book-open" onClick={() => openUrl(book.currentUrl)}>
                <span className="book-title">{book.title}</span>
                <span className="book-sub">{book.currentTitle}</span>
                {book.chapters && (
                  <span className="book-meta">{book.chapters.length} chapters found</span>
                )}
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
