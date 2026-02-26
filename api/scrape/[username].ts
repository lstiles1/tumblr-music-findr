import { ScrapeHttpError, scrapeTumblrAudio } from "../_lib/tumblrScraper";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const usernameParam = req.query?.username;
  const username = Array.isArray(usernameParam) ? usernameParam[0] : usernameParam;
  const queryPathParam = req.query?.path;
  const queryPath = Array.isArray(queryPathParam) ? queryPathParam[0] : queryPathParam;

  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "Missing or invalid username" });
    return;
  }

  try {
    const data = await scrapeTumblrAudio(username, typeof queryPath === "string" ? queryPath : undefined);
    res.json(data);
  } catch (error: any) {
    if (error instanceof ScrapeHttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("Unexpected scraping error:", error?.message || error);
    res.status(500).json({
      error: "Failed to fetch blog data. Please check the username and ensure the blog is public.",
    });
  }
}
