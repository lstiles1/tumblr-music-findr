import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { ScrapeHttpError, scrapeTumblrAudio } from "./lib/tumblrScraper.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route to scrape Tumblr audio
  app.get("/api/scrape/:username", async (req, res) => {
    const { username } = req.params;
    const rawPath = req.query.path;
    const queryPath = Array.isArray(rawPath) ? rawPath[0] : rawPath;

    try {
      const data = await scrapeTumblrAudio(username, typeof queryPath === "string" ? queryPath : undefined);
      res.json(data);
    } catch (error: any) {
      if (error instanceof ScrapeHttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      console.error("Unexpected scraping error:", error?.message || error);
      res.status(500).json({ error: "Failed to fetch blog data. Please check the username and ensure the blog is public." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
