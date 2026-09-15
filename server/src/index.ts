import express from "express";
import cors from "cors";
import { fetchHtml, FetchError } from "./fetchHtml.js";
import { extractChapter } from "./extractChapter.js";
import { extractToc } from "./extractToc.js";

const app = express();
const PORT = Number(process.env.PORT ?? 8787);

app.use(cors());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/extract", async (req, res) => {
  const url = req.query.url;
  if (typeof url !== "string" || !url) {
    res.status(400).json({ error: "Missing 'url' query parameter" });
    return;
  }
  try {
    const { html, finalUrl } = await fetchHtml(url);
    const chapter = extractChapter(html, finalUrl);
    res.json(chapter);
  } catch (err) {
    if (err instanceof FetchError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to extract chapter content" });
  }
});

app.get("/api/toc", async (req, res) => {
  const url = req.query.url;
  if (typeof url !== "string" || !url) {
    res.status(400).json({ error: "Missing 'url' query parameter" });
    return;
  }
  try {
    const { html, finalUrl } = await fetchHtml(url);
    const toc = extractToc(html, finalUrl);
    res.json(toc);
  } catch (err) {
    if (err instanceof FetchError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to extract table of contents" });
  }
});

app.listen(PORT, () => {
  console.log(`Extraction API listening on http://localhost:${PORT}`);
});
