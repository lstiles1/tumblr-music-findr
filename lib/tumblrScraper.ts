import axios from "axios";
import * as cheerio from "cheerio";

export class ScrapeHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ScrapeHttpError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

const isTransientNetworkError = (error: any) => {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    message.includes("socket hang up") ||
    message.includes("timeout")
  );
};

const axiosGetWithRetry = async <T = any>(url: string, config: any, retries = 2) => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await axios.get<T>(url, config);
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === retries) {
        throw error;
      }
      await sleep(500 * (attempt + 1));
    }
  }

  throw lastError;
};

export async function scrapeTumblrAudio(username: string, queryPath?: string) {
  const blogUrl = username.includes(".") ? username : `${username}.tumblr.com`;
  const targetUrl = queryPath ? `https://www.tumblr.com/${username}/${queryPath}` : `https://${blogUrl}/`;

  try {
    const fetchTracks = async (start = 0) => {
      const apiUrl = `https://${blogUrl}/api/read/json?type=audio&num=50&start=${start}`;
      const response = await axiosGetWithRetry(apiUrl, {
        headers: { "User-Agent": userAgent },
        timeout: 10000,
      });
      const rawData = response.data.toString();
      const startIdx = rawData.indexOf("{");
      const endIdx = rawData.lastIndexOf("}");
      if (startIdx === -1 || endIdx === -1) throw new Error("Invalid response format from Tumblr API");
      const jsonStr = rawData.substring(startIdx, endIdx + 1);
      return JSON.parse(jsonStr);
    };

    const data = await fetchTracks(0);
    let allPosts = [...(data.posts || [])];

    if (data["posts-total"] > 50) {
      try {
        const secondPage = await fetchTracks(50);
        if (secondPage?.posts) {
          allPosts = [...allPosts, ...secondPage.posts];
        }
      } catch {
        // Best effort only.
      }
    }

    const tracks = allPosts.map((post: any) => ({
      id: post.id,
      url: post.url,
      date: post.date,
      type: post.type,
      audioEmbed: post["audio-embed"],
      audioCaption: post["audio-caption"],
      audioFileUrl: post["audio-file-url"],
      artist: post["id3-artist"] || "Unknown Artist",
      title: post["id3-title"] || "Unknown Title",
      album: post["id3-album"] || "",
      plays: post["audio-plays"] || 0,
      slug: post.slug,
      rebloggedFrom: post["reblogged-from-name"] || null,
      isReblog: !!post["reblogged-from-url"],
    }));

    if (tracks.length === 0) {
      throw new Error("No tracks found in API");
    }

    return {
      blog: {
        title: data.tumblelog.title,
        name: data.tumblelog.name,
        description: data.tumblelog.description,
      },
      tracks,
    };
  } catch (error: any) {
    console.error("API Scraping error, trying HTML/RSS fallback:", error.message);

    try {
      const htmlResponse = await axiosGetWithRetry(targetUrl, {
        headers: { "User-Agent": userAgent },
        timeout: 10000,
      });
      const html = htmlResponse.data;
      const $ = cheerio.load(html);
      const tracks: any[] = [];

      const stateMatch =
        html.match(/window\.___INITIAL_STATE___\s*=\s*({.*?});\s*<\/script>/s) ||
        html.match(/window\.___INITIAL_STATE___\s*=\s*({.*?});/s);
      if (stateMatch) {
        try {
          const state = JSON.parse(stateMatch[1]);
          let posts: any[] = [];

          if (state.posts && typeof state.posts === "object") {
            posts = Object.values(state.posts);
          } else if (state.queries) {
            posts = Object.values(state.queries).flatMap((q: any) => q.posts || []);
          } else if (state.blogPosts && state.blogPosts[username]) {
            posts = state.blogPosts[username].posts || [];
          }

          if (posts.length > 0) {
            posts.forEach((post: any) => {
              const hasAudioContent = post.content && post.content.some((c: any) => c.type === "audio");
              if (post.type === "audio" || hasAudioContent) {
                const audioContent = post.content?.find((c: any) => c.type === "audio");
                tracks.push({
                  id: post.id,
                  title: post.track_name || post.summary || audioContent?.title || "Audio Track",
                  artist: post.artist || audioContent?.artist || "Unknown Artist",
                  url: post.post_url || post.url || `https://www.tumblr.com/${username}/${post.id}`,
                  audioEmbed: post.player || post.audio_url || audioContent?.url || audioContent?.embed_html,
                  isReblog: !!(post.reblogged_from_name || post.parent_post_id),
                  rebloggedFrom: post.reblogged_from_name || post.parent_tumblelog_name,
                  date: post.date || new Date().toISOString(),
                });
              }
            });
          }
        } catch (parseError) {
          console.warn("Failed to parse INITIAL_STATE", parseError);
        }
      }

      if (tracks.length === 0) {
        $("article, .post, .post-container, [id^='post-']").each((i, el) => {
          const $el = $(el);
          const audioIframe = $el.find("iframe[src*='tumblr.com/audio_file'], iframe[src*='tumblr.com/post/']");
          const hasAudio =
            audioIframe.length > 0 || $el.find("audio").length > 0 || $el.find(".audio_player").length > 0;

          if (hasAudio) {
            const reblogInfo = $el.find(".reblog-link, .reblogged-from, .source-link").first();
            const rebloggedFrom = reblogInfo.text().trim().replace(/^reblogged from\s+/i, "") || null;

            tracks.push({
              id: $el.attr("id") || $el.attr("data-post-id") || `scraped-${i}`,
              title: $el.find(".track-name, .title, h2, h3").first().text().trim() || "Scraped Track",
              artist: $el.find(".artist, .track-artist").first().text().trim() || "Unknown Artist",
              url: $el.find("a[href*='/post/']").first().attr("href") || `https://${blogUrl}/`,
              audioEmbed: audioIframe.length > 0 ? $.html(audioIframe.first()) : null,
              scraped: true,
              isReblog: !!rebloggedFrom,
              rebloggedFrom,
              date: new Date().toISOString(),
            });
          }
        });
      }

      if (tracks.length > 0) {
        return {
          blog: { title: username, name: username, description: "Scraped from HTML" },
          tracks,
        };
      }

      throw new ScrapeHttpError(
        404,
        "No audio tracks found. The blog might be empty, private, or using a theme that hides audio posts.",
      );
    } catch (fallbackError: any) {
      if (fallbackError instanceof ScrapeHttpError) {
        throw fallbackError;
      }
      throw new ScrapeHttpError(
        500,
        "Failed to fetch blog data. Please check the username and ensure the blog is public.",
      );
    }
  }
}
